from fighterdisplay.midi.device import list_input_ports, list_output_ports


def test_list_ports_returns_lists():
    ins = list_input_ports()
    outs = list_output_ports()
    assert isinstance(ins, list)
    assert isinstance(outs, list)

