from fighterdisplay.core.state import StateStore
from fighterdisplay.core.presets import apply_labels


def test_apply_labels_sets_labels_and_preserves_values():
    store = StateStore()
    # Pre-set a value for bank 1 encoder 1
    store.update_encoder(1, 1, 64)

    labels = {1: {1: "Cutoff", 2: "Resonance"}, 2: {1: "Param"}}
    apply_labels(store, labels)

    snap = store.snapshot()
    assert snap.banks[1].encoders[1].label == "Cutoff"
    assert snap.banks[1].encoders[1].value == 64  # preserved
    assert snap.banks[1].encoders[2].label == "Resonance"
    assert snap.banks[1].encoders[2].value == 0  # default when not previously set
    assert snap.banks[2].encoders[1].label == "Param"


def test_apply_labels_handles_missing_banks_and_encoders():
    store = StateStore()
    # Apply a label to a bank/encoder that doesn't exist yet
    apply_labels(store, {3: {16: "Level"}})
    snap = store.snapshot()
    assert snap.banks[3].encoders[16].label == "Level"
    assert snap.banks[3].encoders[16].value == 0

