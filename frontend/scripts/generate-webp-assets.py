#!/usr/bin/env python3
"""Generate compact, visually faithful WebP variants of TrackMyRMC UI artwork.

The PNG originals intentionally remain for rollback and native resources.
Requires Google's libwebp CLI: sudo apt-get install webp.
"""
from pathlib import Path
import subprocess

ASSETS = {
    "Mixer.png": 88,
    "KYC-verification.png": 88,
    "Free-Calculator.png": 88,
    "Cashfree.png": 88,
    "CountryMap.png": 88,
    "TrackMyRMC_Login_Top_Banner_light.png": 90,
    "TrackMyRMC_Login_Top_Banner_Dark.png": 90,
    "Background Light Theme.png": 89,
    "Background Dark Theme.png": 89,
    "support-agent-mascot.png": 91,
    "Plant _Owner_All_staff_top_card.png": 100,
}
LOSSLESS_ASSETS = {"Plant _Owner_All_staff_top_card.png"}
ROOT = Path(__file__).resolve().parents[1] / "assets" / "images"


def main():
    total_original = total_webp = 0
    for name, quality in ASSETS.items():
        source = ROOT / name
        target = source.with_suffix(".webp")
        if not source.is_file():
            raise FileNotFoundError(f"Missing PNG source: {source}")
        # The new owner/staff hero must remain pixel-exact, not just visually similar.
        options = (["-lossless", "-z", "9"] if name in LOSSLESS_ASSETS else
                   ["-q", str(quality), "-m", "6", "-alpha_q", "100"])
        subprocess.run(
            ["cwebp", "-quiet", *options, "-mt", str(source), "-o", str(target)],
            check=True,
        )
        original = source.stat().st_size
        compressed = target.stat().st_size
        data = target.read_bytes()[:16]
        if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
            raise RuntimeError(f"Invalid WebP output: {target}")
        if compressed >= original:
            raise RuntimeError(f"WebP is not smaller than original: {name}")
        total_original += original
        total_webp += compressed
        print(f"{name}: {original:,} -> {compressed:,} bytes ({(1 - compressed / original)*100:.1f}% smaller)")
    print(f"TOTAL: {total_original:,} -> {total_webp:,} bytes; {(1 - total_webp/total_original)*100:.1f}% saved")


if __name__ == "__main__":
    main()
