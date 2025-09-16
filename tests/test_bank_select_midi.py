from fighterdisplay.ui.backend.main import app, state
from fastapi.testclient import TestClient


def test_bank_select_cc_on_channel4_sets_bank():
    c = TestClient(app)
    # Start from known state
    snap = state.snapshot()
    assert 1 <= snap.current_bank <= 4
    # Send bank select: channel 4 (0-based 3), control 2 -> bank 3, value 127
    r = c.post('/api/midi', json={'type': 'control_change', 'control': 2, 'value': 127, 'channel': 3})
    assert r.status_code == 200
    snap2 = state.snapshot()
    assert snap2.current_bank == 3

