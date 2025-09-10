from fighterdisplay.ui.backend.main import app
from fastapi.testclient import TestClient
from pathlib import Path
import json


def test_list_load_save_presets(tmp_path, monkeypatch):
    # Prepare preset dir and initial preset
    preset_dir = tmp_path / 'presets'
    preset_dir.mkdir()
    init = {"banks": {"1": {"encoders": {"1": {"id": 1, "label": "Init", "cc": 14}}}}}
    (preset_dir / 'init.json').write_text(json.dumps(init))
    monkeypatch.setenv('CONFIG_DIR', str(preset_dir))
    monkeypatch.setenv('CONFIG_PATH', str(preset_dir / 'init.json'))

    c = TestClient(app)

    # List presets
    r = c.get('/api/presets')
    assert r.status_code == 200
    js = r.json()
    assert 'init.json' in js['presets']
    assert js['current'] == 'init.json'

    # Save current as new preset
    r = c.post('/api/presets/save', json={'name': 'new_preset'})
    assert r.status_code == 200
    js = r.json()
    assert js['ok'] is True
    assert (preset_dir / 'new_preset.json').exists()

    # Load initial preset back
    r = c.post('/api/presets/load', json={'name': 'init.json'})
    assert r.status_code == 200
    js = r.json()
    assert js['ok'] is True
    assert js['preset'] == 'init.json'

