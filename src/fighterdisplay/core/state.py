from __future__ import annotations

import threading
from typing import Dict, Optional

from pydantic import BaseModel, Field


class EncoderState(BaseModel):
    label: str = ""
    value: int = 0  # 0-127


class BankState(BaseModel):
    encoders: Dict[int, EncoderState] = Field(default_factory=lambda: {i: EncoderState() for i in range(1, 17)})


class AppState(BaseModel):
    current_bank: int = 1
    banks: Dict[int, BankState] = Field(default_factory=lambda: {i: BankState() for i in range(1, 5)})
    last_message: Optional[dict] = None


class StateStore:
    """Thread-safe in-memory state store."""

    def __init__(self) -> None:
        self._state = AppState()
        # Use RLock to avoid deadlocks when snapshot() is called from
        # other locked methods like update_encoder.
        self._lock = threading.RLock()

    def snapshot(self) -> AppState:
        with self._lock:
            return AppState.model_validate(self._state.model_dump())

    def update_encoder(self, bank: int, encoder: int, value: int, label: Optional[str] = None) -> AppState:
        with self._lock:
            bank_state = self._state.banks.setdefault(bank, BankState())
            enc = bank_state.encoders.setdefault(encoder, EncoderState())
            enc.value = max(0, min(127, int(value)))
            if label is not None:
                enc.label = label
            self._state.last_message = {"bank": bank, "encoder": encoder, "value": enc.value}
            return self.snapshot()

    def set_bank(self, bank: int) -> AppState:
        with self._lock:
            self._state.current_bank = bank
            return self.snapshot()
