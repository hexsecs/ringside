from __future__ import annotations

from typing import Callable, List, Optional


def _safe_import_mido():
    try:
        import mido  # type: ignore

        return mido
    except Exception:  # ImportError or backend issues
        return None


def list_input_ports() -> List[str]:
    mido = _safe_import_mido()
    if not mido:
        return []
    try:
        return list(mido.get_input_names())
    except Exception:
        return []


def list_output_ports() -> List[str]:
    mido = _safe_import_mido()
    if not mido:
        return []
    try:
        return list(mido.get_output_names())
    except Exception:
        return []


def find_twister_port(candidates: List[str]) -> Optional[str]:
    for name in candidates:
        if "midi fighter twister" in name.lower():
            return name
    return None


def open_input(port_name: str, callback: Callable[[dict], None]):
    """Open a MIDI input and invoke callback with parsed dict messages.

    The callback receives a minimal dict: {"type", "control", "value", ...}
    """
    mido = _safe_import_mido()
    if not mido:
        return None
    try:
        def _on_msg(msg):
            data = {"type": msg.type}
            # Common CC mapping for Twister
            if hasattr(msg, "control"):
                data["control"] = getattr(msg, "control")
            if hasattr(msg, "value"):
                data["value"] = getattr(msg, "value")
            if hasattr(msg, "channel"):
                data["channel"] = getattr(msg, "channel")
            callback(data)

        inp = mido.open_input(port_name, callback=_on_msg)
        return inp  # caller may keep ref and close later
    except Exception:
        return None


def open_output(port_name: str):
    mido = _safe_import_mido()
    if not mido:
        return None
    try:
        return mido.open_output(port_name)
    except Exception:
        return None


def send_cc(output, control: int, value: int, channel: int = 0) -> bool:
    mido = _safe_import_mido()
    if not (mido and output):
        return False
    try:
        msg = mido.Message("control_change", control=int(control), value=int(value), channel=int(channel))
        output.send(msg)
        return True
    except Exception:
        return False
