from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Any

from .state import StateStore


def load_preset(path: str | Path) -> Dict[int, Dict[int, str]]:
    p = Path(path)
    if not p.exists():
        return {}
    try:
        data: Dict[str, Any] = json.loads(p.read_text())
    except Exception:
        return {}
    labels: Dict[int, Dict[int, str]] = {}
    for bank_str, cfg in data.get("banks", {}).items():
        try:
            bank = int(bank_str)
        except Exception:
            continue
        encs = {}
        for enc_str, label in (cfg or {}).get("encoders", {}).items():
            try:
                encs[int(enc_str)] = str(label)
            except Exception:
                pass
        if encs:
            labels[bank] = encs
    return labels


def apply_labels(store: StateStore, labels_by_bank: Dict[int, Dict[int, str]]) -> None:
    """Apply encoder labels by bank, preserving existing values.

    For any provided bank/encoder, set the label while keeping the current value if present,
    defaulting to 0 otherwise.
    """
    snapshot = store.snapshot()
    for bank, encs in labels_by_bank.items():
        for enc_idx, label in encs.items():
            current_value = 0
            try:
                current_value = snapshot.banks[bank].encoders[enc_idx].value
            except Exception:
                # Bank or encoder might not exist yet; keep default 0
                pass
            store.update_encoder(bank, enc_idx, current_value, label=label)
