from fighterdisplay.core.presets import load_preset


def test_load_preset_default_file():
    labels = load_preset("assets/presets/default.json")
    assert isinstance(labels, dict)
    assert 1 in labels
    assert 1 in labels[1]
    assert labels[1][1] == "Cutoff"

