from fighterdisplay.ui.backend.main import app, state
from fastapi.testclient import TestClient


def test_update_label_and_cc_updates_state(tmp_path, monkeypatch):
    monkeypatch.setenv('CONFIG_PATH', str(tmp_path / 'config.json'))
    c = TestClient(app)
    # Set label and cc for bank1 enc1
    r = c.post('/api/mapping', json={'bank': 1, 'encoder': 1, 'cc': 14, 'label': 'MyLabel'})
    assert r.status_code == 200
    js = r.json()
    assert js['ok'] is True
    # Check state label updated
    snap = state.snapshot()
    assert snap.banks[1].encoders[1].label == 'MyLabel'
