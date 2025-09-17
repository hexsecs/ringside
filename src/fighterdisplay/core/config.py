from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Any, Tuple


# Config schema (normalized in memory):
# {
#   "banks": {
#     "1": { "encoders": {
#       "1": {"id": 1, "label": "Cutoff", "cc": 14, "channel": 1},
#       ...
#     }},
#     ...
#   }
# }


Config = Dict[str, Any]
LabelsMap = Dict[int, Dict[int, str]]
CcMap = Dict[int, Dict[int, int]]
ChanMap = Dict[int, Dict[int, int]]
RevMap = Dict[int, Tuple[int, int]]


def _ensure_int_keys(d: Dict[str, Any]) -> Dict[int, Any]:
    out: Dict[int, Any] = {}
    for k, v in (d or {}).items():
        try:
            out[int(k)] = v
        except Exception:
            pass
    return out


def load_config(path: str | Path) -> Config:
    p = Path(path)
    if not p.exists():
        return {"banks": {}}
    try:
        data: Config = json.loads(p.read_text())
        if not isinstance(data, dict):
            return {"banks": {}}
        # Normalize presence
        data.setdefault("banks", {})
        return data
    except Exception:
        return {"banks": {}}


def save_config(path: str | Path, config: Config) -> bool:
    try:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(config, indent=2))
        return True
    except Exception:
        return False


def labels_from_config(config: Config) -> LabelsMap:
    labels: LabelsMap = {}
    banks = config.get("banks", {})
    for b, bdata in _ensure_int_keys(banks).items():
        encs = (bdata or {}).get("encoders", {})
        bank_labels: Dict[int, str] = {}
        for e, edata in _ensure_int_keys(encs).items():
            if isinstance(edata, dict):
                lab = str(edata.get("label", ""))
            else:
                # Back-compat: plain string label
                lab = str(edata)
            if lab:
                bank_labels[e] = lab
        if bank_labels:
            labels[b] = bank_labels
    return labels


def cc_map_from_config(config: Config) -> CcMap:
    cmap: CcMap = {}
    banks = config.get("banks", {})
    for b, bdata in _ensure_int_keys(banks).items():
        encs = (bdata or {}).get("encoders", {})
        bank_map: Dict[int, int] = {}
        for e, edata in _ensure_int_keys(encs).items():
            if isinstance(edata, dict) and "cc" in edata:
                try:
                    bank_map[e] = int(edata["cc"])
                except Exception:
                    pass
        if bank_map:
            cmap[b] = bank_map
    return cmap


def channels_from_config(config: Config) -> ChanMap:
    cmap: ChanMap = {}
    banks = config.get("banks", {})
    for b, bdata in _ensure_int_keys(banks).items():
        encs = (bdata or {}).get("encoders", {})
        bank_map: Dict[int, int] = {}
        for e, edata in _ensure_int_keys(encs).items():
            ch = 1
            if isinstance(edata, dict) and "channel" in edata:
                try:
                    ch = int(edata["channel"])
                except Exception:
                    ch = 1
            bank_map[e] = max(1, min(16, int(ch or 1)))
        if bank_map:
            cmap[b] = bank_map
    return cmap


def invert_cc_map(mapping: CcMap) -> RevMap:
    rev: RevMap = {}
    for bank, encs in mapping.items():
        for enc, cc in encs.items():
            rev[int(cc)] = (int(bank), int(enc))
    return rev


def set_encoder_cc(config: Config, bank: int, encoder: int, cc: int, label: str | None = None, channel: int | None = None) -> Config:
    banks = config.setdefault("banks", {})
    b = banks.setdefault(str(int(bank)), {})
    encs = b.setdefault("encoders", {})
    enc = encs.setdefault(str(int(encoder)), {"id": int(encoder), "label": "", "cc": int(cc), "channel": int(channel or 1)})
    if not isinstance(enc, dict):
        enc = {"id": int(encoder), "label": str(enc), "cc": int(cc), "channel": int(channel or 1)}
    enc["id"] = int(encoder)
    enc["cc"] = int(cc)
    # Default to channel 1 if not provided
    if channel is None:
        try:
            channel = int(enc.get("channel", 1))
        except Exception:
            channel = 1
    enc["channel"] = max(1, min(16, int(channel or 1)))
    if label is not None:
        enc["label"] = str(label)
    encs[str(int(encoder))] = enc
    return config
