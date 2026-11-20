"""Check the load segments that Android maps from 64-bit native libraries."""
import struct
import sys
import zipfile
from pathlib import PurePosixPath


def check_library(data, name):
    if data[:6] != b"\x7fELF\x02\x01" or len(data) < 64:
        raise ValueError(f"{name}: expected a little-endian ELF64 shared library")
    offset = struct.unpack_from("<Q", data, 32)[0]
    size, count = struct.unpack_from("<HH", data, 54)
    if size < 56 or offset + count * size > len(data):
        raise ValueError(f"{name}: invalid program header table")
    loads = 0
    for index in range(count):
        kind, _, pos, address, _, _, _, alignment = struct.unpack_from(
            "<IIQQQQQQ", data, offset + index * size
        )
        if kind == 1:
            loads += 1
            if alignment < 16384 or alignment & (alignment - 1) or (address - pos) % 16384:
                raise ValueError(f"{name}: PT_LOAD is incompatible with 16 KiB pages")
    if not loads:
        raise ValueError(f"{name}: no loadable ELF segments")


def main(path):
    checked = 0
    with zipfile.ZipFile(path) as bundle:
        for filename in bundle.namelist():
            parts = PurePosixPath(filename).parts
            if (len(parts) >= 4 and parts[-3] == "lib"
                    and parts[-2] in {"arm64-v8a", "x86_64"} and filename.endswith(".so")):
                check_library(bundle.read(filename), filename)
                checked += 1
    if not checked:
        raise ValueError("Expected packaged 64-bit native libraries for React Native")
    print(f"Verified 16 KiB ELF load alignment in {checked} packaged libraries")


if __name__ == "__main__":
    main(sys.argv[1])
