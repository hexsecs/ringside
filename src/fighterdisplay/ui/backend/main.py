from __future__ import annotations

import asyncio
import contextlib
from contextlib import asynccontextmanager
from typing import Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import os
from fighterdisplay.core.state import StateStore
from fighterdisplay.core.presets import load_preset, apply_labels
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


async def broadcast(payload: dict):
    if not connections:
        return
    living = set()
    for ws in list(connections):
        try:
            await ws.send_json(payload)
            living.add(ws)
        except Exception:
            # Drop broken connection
            pass
    connections.clear()
    connections.update(living)


def _midi_callback(msg: dict):
    # Very basic mapping: CC value updates encoder value on current bank.
    control = msg.get("control")
    value = msg.get("value")
    channel = int(msg.get("channel", 0))
    if control is not None and value is not None:
        # Derive bank from channel (1..4), fallback to current
        derived_bank = max(1, min(4, channel + 1))
        current = state.snapshot().current_bank
        bank = derived_bank or current
        enc_index = (int(control) % 16) + 1
        snap = state.update_encoder(bank, enc_index, int(value))
        if LED_ECHO:
            try:
                outbound_queue.put_nowait((int(control), int(value), channel))
            except Exception:
                pass
        # Notify async loop
        loop = asyncio.get_event_loop()
        loop.call_soon_threadsafe(update_event.set)


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
            await asyncio.sleep(1 / 60)
            await broadcast({"type": "heartbeat", "state": state.snapshot().model_dump()})
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
    # Load labels from preset if present
    try:
        labels = load_preset("assets/presets/default.json")
        if labels:
            apply_labels(state, labels)
    except Exception:
        pass
    task = asyncio.create_task(_midi_watcher())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(Exception):
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
    return state.snapshot().model_dump()


@app.post("/api/bank")
async def api_set_bank(payload: dict = Body(...)):
    bank = int(payload.get("bank", 1))
    snap = state.set_bank(bank)
    await broadcast({"type": "bank", "state": snap.model_dump()})
    return {"ok": True}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    connections.add(ws)
    # Send initial snapshot
    await ws.send_json({"type": "init", "state": state.snapshot().model_dump()})
    try:
        while True:
            # Wait for state updates or client messages; cancel pending task to avoid leaks
            wait_task = asyncio.create_task(update_event.wait())
            recv_task = asyncio.create_task(ws.receive_text())
            done, pending = await asyncio.wait(
                [wait_task, recv_task], return_when=asyncio.FIRST_COMPLETED
            )
            for p in pending:
                p.cancel()
                with contextlib.suppress(Exception):
                    await p
            # If the update_event fired, clear it before sending
            if wait_task in done:
                update_event.clear()
            # Always send current state after any trigger
            await ws.send_json({"type": "update", "state": state.snapshot().model_dump()})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        connections.discard(ws)

# Serve static UI (mounted last so API routes take precedence)
app.mount("/", StaticFiles(directory="src/fighterdisplay/ui/frontend", html=True), name="static")
