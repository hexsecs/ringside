from fighterdisplay.ui.backend.main import app, state
from fastapi.testclient import TestClient


def test_unmapped_cc_does_nothing(tmp_path, monkeypatch):
    # Isolate config path so mapping starts empty
    monkeypatch.setenv('CONFIG_PATH', str(tmp_path / 'config.json'))
    client = TestClient(app)
    try:
        before = state.snapshot().last_message
        # Send an unmapped CC message
        payload = {"type": "control_change", "control": 99, "value": 88, "channel": 0}
        r = client.post("/api/midi", json=payload)
        assert r.status_code == 200
        # State should remain unchanged for unmapped CCs
        after = state.snapshot().last_message
        assert after == before
    finally:
        try:
            client.close()
        except Exception:
            pass


def test_api_midi_updates_state_when_mapped(tmp_path, monkeypatch):
    # Isolate config path so we can set a mapping safely
    monkeypatch.setenv('CONFIG_PATH', str(tmp_path / 'config.json'))
    client = TestClient(app)
    try:
        # Map bank 1 encoder 2 to CC 1
        r = client.post('/api/mapping', json={'bank': 1, 'encoder': 2, 'cc': 1})
        assert r.status_code == 200
        # Send a CC message on channel 0
        payload = {"type": "control_change", "control": 1, "value": 99, "channel": 0}
        r = client.post("/api/midi", json=payload)
        assert r.status_code == 200
        # Verify state updated for the mapped encoder
        snap = state.snapshot()
        assert snap.banks[1].encoders[2].value == 99
    finally:
        try:
            client.close()
        except Exception:
            pass
