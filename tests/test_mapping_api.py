from fighterdisplay.ui.backend.main import app
from fastapi.testclient import TestClient


def test_mapping_roundtrip_and_state_includes_mapping(tmp_path, monkeypatch):
    # Use a temp path for CC map persistence
    monkeypatch.setenv('CC_MAP_PATH', str(tmp_path / 'cc_map.json'))
    client = TestClient(app)
    # Set mapping bank1 enc1 -> cc14
    r = client.post('/api/mapping', json={'bank': 1, 'encoder': 1, 'cc': 14})
    assert r.status_code == 200
    data = r.json()
    assert data['ok'] is True
    # Fetch state and ensure mapping included
    r = client.get('/api/state')
    assert r.status_code == 200
    js = r.json()
    assert 'mapping' in js
    mapping = js['mapping']
    # Mapping may be serialized with string keys
    b1 = mapping.get('1') or mapping.get(1)
    assert b1
    e1 = b1.get('1') or b1.get(1)
    assert int(e1) == 14

