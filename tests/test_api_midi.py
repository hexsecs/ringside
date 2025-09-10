from fighterdisplay.ui.backend.main import app, state
from fastapi.testclient import TestClient


def test_api_midi_updates_state():
    # Use TestClient without context-manager to avoid shutdown CancelledError noise
    client = TestClient(app)
    try:
        # Send a CC message on channel 0 (maps to bank 1)
        payload = {"type": "control_change", "control": 1, "value": 99, "channel": 0}
        r = client.post("/api/midi", json=payload)
        assert r.status_code == 200
        # Verify state updated (control 1 -> encoder index 2 due to %16 + 1)
        snap = state.snapshot()
        assert snap.banks[1].encoders[2].value == 99
    finally:
        try:
            client.close()
        except Exception:
            pass
