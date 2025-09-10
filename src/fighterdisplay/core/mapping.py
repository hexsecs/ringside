from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Tuple


CcMap = Dict[int, Dict[int, int]]  # bank -> encoder -> cc
RevMap = Dict[int, Tuple[int, int]]  # cc -> (bank, encoder)


def load_cc_map(path: str | Path) -> CcMap:
    p = Path(path)
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
        result: CcMap = {}
        for bank_str, encs in (data or {}).get("banks", {}).items():
            try:
                bank = int(bank_str)
            except Exception:
                continue
            bank_map: Dict[int, int] = {}
            for enc_str, cc in (encs or {}).items():
                try:
                    bank_map[int(enc_str)] = int(cc)
                except Exception:
                    pass
            if bank_map:
                result[bank] = bank_map
        return result
    except Exception:
        return {}


def save_cc_map(path: str | Path, mapping: CcMap) -> bool:
    try:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        data = {"banks": {str(b): {str(e): int(c) for e, c in encs.items()} for b, encs in mapping.items()}}
        p.write_text(json.dumps(data, indent=2))
        return True
    except Exception:
        return False


def invert_cc_map(mapping: CcMap) -> RevMap:
    rev: RevMap = {}
    for bank, encs in mapping.items():
        for enc, cc in encs.items():
            rev[int(cc)] = (int(bank), int(enc))
    return rev


def set_cc(mapping: CcMap, bank: int, encoder: int, cc: int) -> CcMap:
    encs = mapping.setdefault(int(bank), {})
    encs[int(encoder)] = int(cc)
    return mapping


def get_cc(mapping: CcMap, bank: int, encoder: int) -> int | None:
    return mapping.get(int(bank), {}).get(int(encoder))

