from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Body, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

import os
from fighterdisplay.core.state import StateStore
from fighterdisplay.core.presets import load_preset, apply_labels
from fighterdisplay.core.config import (
    load_config,
    save_config,
    labels_from_config,
    cc_map_from_config,
    channels_from_config,
    invert_cc_map,
    set_encoder_cc,
)
from fighterdisplay.midi.device import (
    list_input_ports,
    list_output_ports,
    find_twister_port,
    open_input,
    open_output,
    send_cc,
)


state = StateStore()
connections: Set[WebSocket] = set()
update_event = asyncio.Event()
outbound_queue: asyncio.Queue[tuple[int, int, int]] = asyncio.Queue()
_midi_out = None
LED_ECHO = os.getenv("LED_ECHO", "1") not in ("0", "false", "False", "no")
HEARTBEAT_HZ = float(os.getenv("HEARTBEAT_HZ", "10"))  # reduce spam vs 60 Hz
def _safe_name(name: str) -> str | None:
    import re
    base = name.strip()
    if not base:
        return None
    if not base.endswith(".json"):
        base += ".json"
    if not re.match(r"^[A-Za-z0-9._-]+\.json$", base):
        return None
    return base


def _config_dir() -> str:
    cfg_path = os.getenv("CONFIG_PATH")
    if cfg_path:
        try:
            return os.path.dirname(cfg_path) or "assets/presets"
        except Exception:
            return "assets/presets"
    return os.getenv("CONFIG_DIR", "assets/presets")


def _config_path() -> str:
    cfg_path = os.getenv("CONFIG_PATH")
    if cfg_path:
        return cfg_path
    return os.path.join(_config_dir(), current_preset)


app_config = {"banks": {}}
current_preset = "default.json"
cc_map: dict[int, dict[int, int]] = {}
channel_map: dict[int, dict[int, int]] = {}
cc_reverse: dict[int, tuple[int, int]] = {}
_main_loop: asyncio.AbstractEventLoop | None = None
unsaved_changes: bool = False


def _schedule(coro):
    try:
        if _main_loop is not None:
            asyncio.run_coroutine_threadsafe(coro, _main_loop)
    except Exception:
        pass


async def broadcast(payload: dict):
    if not connections:
        return
    living = set()
    for ws in list(connections):
        try:
            await ws.send_json(payload)
            living.add(ws)
        except asyncio.CancelledError:
            # Propagate cancellation so shutdown succeeds
            raise
        except Exception:
            # Drop broken connection
            pass
    connections.clear()
    connections.update(living)


def process_midi_msg(msg: dict) -> None:
    """Process a MIDI-like message dict and update state + LED echo queue.

    Expected keys: 'type' (optional), 'control', 'value', 'channel' (0..15).
    """
    control = msg.get("control")
    value = msg.get("value")
    try:
        channel = int(msg.get("channel", 0))
    except Exception:
        channel = 0
    if control is None or value is None:
        return
    # Bank select message: channel 4 (0-based channel == 3), CC 0..3 with value 127
    try:
        if int(channel) == 3 and int(value) == 127 and int(control) in (0, 1, 2, 3):
            new_bank = int(control) + 1  # 0..3 -> bank 1..4
            snap = state.set_bank(new_bank)
            _schedule(broadcast({"type": "bank", "state": snap.model_dump(), "mapping": cc_map, "channels": channel_map, "dirty": unsaved_changes}))
            loop = asyncio.get_event_loop()
            loop.call_soon_threadsafe(update_event.set)
            return
    except Exception:
        pass
    # Try configured CC mapping; if unmapped, ignore
    bank = None
    enc_index = None
    bank_from_mapping = False
    try:
        pair = cc_reverse.get(int(control))
        if pair:
            bank, enc_index = pair
            bank_from_mapping = True
    except Exception:
        pass
    if bank is None or enc_index is None:
        # Unmapped CC: do nothing
        return
    # Only switch displayed bank if we matched a mapping or bank-select, not from raw channel
    if bank_from_mapping:
        try:
            current_bank = state.snapshot().current_bank
            if int(bank) != int(current_bank):
                snap = state.set_bank(int(bank))
                _schedule(broadcast({"type": "bank", "state": snap.model_dump(), "mapping": cc_map, "channels": channel_map, "dirty": unsaved_changes}))
        except Exception:
            pass
    state.update_encoder(bank, enc_index, int(value))
    if LED_ECHO:
        try:
            outbound_queue.put_nowait((int(control), int(value), channel))
        except Exception:
            pass
    # Notify async loop
    loop = asyncio.get_event_loop()
    loop.call_soon_threadsafe(update_event.set)


def _midi_callback(msg: dict):
    process_midi_msg(msg)


async def _midi_watcher():
    # Try opening Twister input/output if available; otherwise idle.
    global _midi_out
    inp = None
    in_ports = list_input_ports()
    out_ports = list_output_ports()
    in_name = find_twister_port(in_ports) if in_ports else None
    out_name = find_twister_port(out_ports) if out_ports else None
    if in_name:
        inp = open_input(in_name, _midi_callback)
    if out_name:
        _midi_out = open_output(out_name)
    # Periodically emit heartbeats so UI can stay responsive.
    try:
        while True:
            # Drain outbound MIDI messages
            try:
                control, value, channel = outbound_queue.get_nowait()
                if _midi_out is not None:
                    send_cc(_midi_out, control, value, channel)
            except asyncio.QueueEmpty:
                pass
            await asyncio.sleep(max(0.05, 1.0 / HEARTBEAT_HZ))
            await broadcast({"type": "heartbeat", "state": state.snapshot().model_dump(), "mapping": cc_map, "channels": channel_map, "dirty": unsaved_changes})
    finally:
        if inp is not None:
            try:
                inp.close()
            except Exception:
                pass
        if _midi_out is not None:
            try:
                _midi_out.close()
            except Exception:
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load unified config (labels + CC mapping)
    global app_config, cc_map, channel_map, cc_reverse, current_preset, _main_loop, unsaved_changes
    try:
        _main_loop = asyncio.get_running_loop()
        # Resolve initial preset from env
        cfg_path_env = os.getenv("CONFIG_PATH", "assets/presets/default.json")
        try:
            current_preset = os.path.basename(cfg_path_env)
        except Exception:
            current_preset = "default.json"
        app_config = load_config(_config_path())
        labels = labels_from_config(app_config)
        if labels:
            apply_labels(state, labels)
        cc_map = cc_map_from_config(app_config)
        channel_map = channels_from_config(app_config)
        cc_reverse = invert_cc_map(cc_map)
        unsaved_changes = False
    except Exception:
        app_config = {"banks": {}}
        cc_map, channel_map, cc_reverse = {}, {}, {}
        unsaved_changes = False
    task = asyncio.create_task(_midi_watcher())
    try:
        yield
    finally:
        task.cancel()
        # On Python 3.11+, asyncio.CancelledError derives from BaseException.
        # Suppress it here to allow clean shutdown without ERROR logs.
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static UI will be mounted after API routes to avoid route shadowing


@app.get("/api/ports")
def api_ports():
    return {"inputs": list_input_ports(), "outputs": list_output_ports()}


@app.get("/api/state")
def api_state():
    return {"state": state.snapshot().model_dump(), "mapping": cc_map, "channels": channel_map, "preset": os.path.basename(_config_path()), "dirty": unsaved_changes}


@app.post("/api/bank")
async def api_set_bank(payload: dict = Body(...)):
    bank = int(payload.get("bank", 1))
    snap = state.set_bank(bank)
    # Also emit a bank-select MIDI message to the connected device so the host
    # hardware follows UI bank changes (channel 4, control bank-1, value 127)
    try:
        control = max(0, min(3, int(bank) - 1))
        outbound_queue.put_nowait((control, 127, 3))
    except Exception:
        pass
    await broadcast({"type": "bank", "state": snap.model_dump(), "mapping": cc_map, "channels": channel_map, "dirty": unsaved_changes})
    return {"ok": True}


@app.post("/api/midi")
async def api_midi(payload: dict = Body(...)):
    # Accept a MIDI-like dict from Web MIDI frontend and process it
    try:
        process_midi_msg(payload)
    except Exception:
        pass
    return {"ok": True}


@app.get("/api/mapping")
def api_get_mapping():
    return {"mapping": cc_map, "channels": channel_map}


@app.post("/api/mapping")
async def api_set_mapping(payload: dict = Body(...)):
    global app_config, cc_map, channel_map, cc_reverse, unsaved_changes
    try:
        bank = int(payload.get("bank"))
        encoder = int(payload.get("encoder"))
    except Exception:
        return {"ok": False, "error": "invalid payload"}
    label = payload.get("label")
    channel_val = payload.get("channel")
    cc_val = payload.get("cc")
    if cc_val is None and label is None:
        return {"ok": False, "error": "no fields to update"}
    if cc_val is not None:
        try:
            cc_int = int(cc_val)
        except Exception:
            return {"ok": False, "error": "invalid cc"}
        if not (0 <= cc_int <= 127):
            return {"ok": False, "error": "cc out of range"}
    else:
        # Keep existing cc for this encoder if present
        cc_int = cc_map.get(bank, {}).get(encoder, 0)
    # Channel parsing (1-16, default 1, preserve if omitted)
    if channel_val is not None:
        try:
            ch_int = int(channel_val)
        except Exception:
            return {"ok": False, "error": "invalid channel"}
        if not (1 <= ch_int <= 16):
            return {"ok": False, "error": "channel out of range"}
    else:
        ch_int = channel_map.get(bank, {}).get(encoder, 1)
    # Update unified config (cc and optional label)
    app_config = set_encoder_cc(dict(app_config), bank, encoder, cc_int, label=label if label is not None else None, channel=ch_int)
    cc_map = cc_map_from_config(app_config)
    channel_map = channels_from_config(app_config)
    cc_reverse = invert_cc_map(cc_map)
    save_config(_config_path(), app_config)
    unsaved_changes = False
    # If label changed, update runtime state label immediately
    if label is not None:
        snap = state.snapshot()
        current_val = 0
        try:
            current_val = snap.banks[bank].encoders[encoder].value
        except Exception:
            pass
        state.update_encoder(bank, encoder, current_val, label=str(label))
    await broadcast({"type": "mapping", "mapping": cc_map, "channels": channel_map, "state": state.snapshot().model_dump(), "dirty": unsaved_changes})
    return {"ok": True, "mapping": cc_map, "channels": channel_map}


@app.post("/api/mapping/temp")
async def api_set_mapping_temp(payload: dict = Body(...)):
    """Update mapping and labels in memory only (no file save).

    Useful for staging edits until the user chooses Save/Save As.
    """
    global app_config, cc_map, channel_map, cc_reverse, unsaved_changes
    try:
        bank = int(payload.get("bank"))
        encoder = int(payload.get("encoder"))
    except Exception:
        return {"ok": False, "error": "invalid payload"}
    label = payload.get("label")
    channel_val = payload.get("channel")
    cc_val = payload.get("cc")
    if cc_val is None and label is None:
        return {"ok": False, "error": "no fields to update"}
    if cc_val is not None:
        try:
            cc_int = int(cc_val)
        except Exception:
            return {"ok": False, "error": "invalid cc"}
        if not (0 <= cc_int <= 127):
            return {"ok": False, "error": "cc out of range"}
    else:
        cc_int = cc_map.get(bank, {}).get(encoder, 0)
    # Channel parsing (1-16, default 1, preserve if omitted)
    if channel_val is not None:
        try:
            ch_int = int(channel_val)
        except Exception:
            return {"ok": False, "error": "invalid channel"}
        if not (1 <= ch_int <= 16):
            return {"ok": False, "error": "channel out of range"}
    else:
        ch_int = channel_map.get(bank, {}).get(encoder, 1)
    # Update in-memory config only
    app_config = set_encoder_cc(dict(app_config), bank, encoder, cc_int, label=label if label is not None else None, channel=ch_int)
    cc_map = cc_map_from_config(app_config)
    channel_map = channels_from_config(app_config)
    cc_reverse = invert_cc_map(cc_map)
    # Update runtime label if provided
    if label is not None:
        snap = state.snapshot()
        current_val = 0
        try:
            current_val = snap.banks[bank].encoders[encoder].value
        except Exception:
            pass
        state.update_encoder(bank, encoder, current_val, label=str(label))
    unsaved_changes = True
    await broadcast({"type": "mapping", "mapping": cc_map, "channels": channel_map, "state": state.snapshot().model_dump(), "dirty": unsaved_changes})
    return {"ok": True, "mapping": cc_map, "channels": channel_map}


@app.get("/api/presets")
def api_list_presets():
    try:
        files = [f for f in os.listdir(_config_dir()) if f.endswith('.json')]
        files.sort()
    except Exception:
        files = []
    return {"presets": files, "current": os.path.basename(_config_path())}


@app.post("/api/presets/load")
async def api_load_preset(payload: dict = Body(...)):
    global app_config, cc_map, channel_map, cc_reverse, current_preset, unsaved_changes
    name = str(payload.get("name", "")).strip()
    safe = _safe_name(name)
    if not safe:
        return {"ok": False, "error": "invalid name"}
    path = os.path.join(_config_dir(), safe)
    if not os.path.exists(path):
        return {"ok": False, "error": "not found"}
    try:
        # Load and apply
        app_config = load_config(path)
        labels = labels_from_config(app_config)
        # Apply provided labels first
        if labels:
            apply_labels(state, labels)
        # Clear labels for any encoder not defined in the preset ("empty encoders")
        try:
            snap = state.snapshot()
            for bank in range(1, 5):
                bank_labels = labels.get(bank, {}) if isinstance(labels, dict) else {}
                for enc in range(1, 17):
                    if not bank_labels.get(enc):
                        # Preserve current value, clear label
                        try:
                            current_val = snap.banks[bank].encoders[enc].value
                        except Exception:
                            current_val = 0
                        state.update_encoder(bank, enc, current_val, label="")
        except Exception:
            # If clearing fails, continue without aborting load
            pass
        cc_map = cc_map_from_config(app_config)
        channel_map = channels_from_config(app_config)
        cc_reverse = invert_cc_map(cc_map)
        current_preset = safe
        unsaved_changes = False
        await broadcast({"type": "preset", "preset": current_preset, "mapping": cc_map, "channels": channel_map, "state": state.snapshot().model_dump(), "dirty": unsaved_changes})
        return {"ok": True, "preset": current_preset}
    except Exception:
        return {"ok": False, "error": "load failed"}


@app.post("/api/presets/save")
def api_save_preset(payload: dict = Body(...)):
    global current_preset, unsaved_changes
    name = str(payload.get("name", "")).strip()
    # If no name, use current preset
    if not name:
        safe = current_preset
    else:
        safe = _safe_name(name)
        if not safe:
            return {"ok": False, "error": "invalid name"}
    path = os.path.join(_config_dir(), safe)
    ok = save_config(path, app_config)
    if ok:
        current_preset = safe
        unsaved_changes = False
        try:
            files = [f for f in os.listdir(_config_dir()) if f.endswith('.json')]
            files.sort()
        except Exception:
            files = []
        return {"ok": True, "preset": current_preset, "presets": files, "dirty": unsaved_changes}
    return {"ok": False, "error": "save failed"}


@app.get("/api/presets/download")
def api_download_preset(name: str | None = Query(None)):
    """Download a preset file by name, or the current preset if not provided."""
    try:
        safe = _safe_name(name) if name else current_preset
        if not safe:
            return JSONResponse({"ok": False, "error": "invalid name"}, status_code=400)
        path = os.path.join(_config_dir(), safe)
        if not os.path.exists(path):
            return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
        return FileResponse(path, media_type="application/json", filename=safe)
    except Exception:
        return JSONResponse({"ok": False, "error": "download failed"}, status_code=500)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    connections.add(ws)
    # Send initial snapshot
    await ws.send_json({"type": "init", "state": state.snapshot().model_dump(), "mapping": cc_map, "channels": channel_map, "dirty": unsaved_changes})
    try:
        # Drain incoming messages to keep the connection healthy. All updates are
        # pushed via broadcast() (heartbeat + state changes).
        while True:
            try:
                await ws.receive_text()
            except WebSocketDisconnect:
                break
            except asyncio.CancelledError:
                # Shutdown signal; exit loop
                break
            except Exception:
                # Ignore malformed client messages and continue
                pass
    finally:
        connections.discard(ws)

# Serve static UI (mounted last so API routes take precedence)
app.mount("/", StaticFiles(directory="src/fighterdisplay/ui/frontend", html=True), name="static")
