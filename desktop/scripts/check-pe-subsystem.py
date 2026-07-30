#!/usr/bin/env python3
"""Assert the Windows PE subsystem of a packaged executable."""

import argparse
import struct
from pathlib import Path


SUBSYSTEMS = {
    "gui": 2,  # IMAGE_SUBSYSTEM_WINDOWS_GUI
    "console": 3,  # IMAGE_SUBSYSTEM_WINDOWS_CUI
}


def pe_subsystem(path: Path) -> int:
    data = path.read_bytes()
    if len(data) < 0x40 or data[:2] != b"MZ":
        raise ValueError("not a PE executable (missing MZ header)")
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    if pe_offset + 24 + 70 > len(data) or data[pe_offset : pe_offset + 4] != b"PE\0\0":
        raise ValueError("invalid PE header")
    optional_header = pe_offset + 24
    magic = struct.unpack_from("<H", data, optional_header)[0]
    if magic not in (0x10B, 0x20B):
        raise ValueError(f"unsupported PE optional-header magic 0x{magic:04x}")
    return struct.unpack_from("<H", data, optional_header + 68)[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("executable", type=Path)
    parser.add_argument("expected", choices=SUBSYSTEMS)
    args = parser.parse_args()

    actual = pe_subsystem(args.executable)
    expected = SUBSYSTEMS[args.expected]
    if actual != expected:
        raise SystemExit(
            f"{args.executable}: PE subsystem is {actual}, expected {expected} ({args.expected})"
        )
    print(f"{args.executable}: PE subsystem {actual} ({args.expected})")


if __name__ == "__main__":
    main()
