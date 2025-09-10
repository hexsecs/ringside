#!/usr/bin/env python3
from fighterdisplay.midi.device import list_input_ports, list_output_ports


def main():
    ins = list_input_ports()
    outs = list_output_ports()
    print("Inputs:")
    for n in ins:
        print(f"  - {n}")
    print("\nOutputs:")
    for n in outs:
        print(f"  - {n}")


if __name__ == "__main__":
    main()

