"""Build local Maple Mono CN webfont subsets from the official release archive.

Usage: python3 scripts/sync-fonts.py --archive /path/to/MapleMono-CN-unhinted.zip
Normal homepage builds use the committed assets and do not need Python.
"""

import argparse
import hashlib
import json
import tempfile
import zipfile
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "src/assets/fonts/maple-mono-cn"
VERSION = "v7.9"
ARCHIVE_SHA256 = "d41cb72721e99cfe4fbd1a7b0f182a013457de46aa612018f924dd024699d3b9"
WEIGHTS = {400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold"}


def unicode_range(codepoints):
    ranges = []
    start = end = codepoints[0]
    for point in codepoints[1:]:
        if point == end + 1:
            end = point
        else:
            ranges.append(f"U+{start:X}" if start == end else f"U+{start:X}-{end:X}")
            start = end = point
    ranges.append(f"U+{start:X}" if start == end else f"U+{start:X}-{end:X}")
    return ",".join(ranges)


def build_weight(job):
    weight, source_path, groups = job
    rules = []
    sizes = {"woff2": 0, "woff": 0}
    for name, points in groups:
        font = TTFont(source_path, recalcTimestamp=False)
        options = subset.Options()
        options.hinting = False
        options.drop_tables += ["meta"]
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.name_legacy = True
        options.name_languages = ["*"]
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=points)
        subsetter.subset(font)
        if set(font.getBestCmap()) != set(points):
            raise ValueError(f"Lost characters in {weight}/{name}")
        stem = f"maple-mono-cn-{weight}-{name}"
        for extension in sizes:
            font.flavor = extension
            target = DESTINATION / f"{stem}.{extension}"
            font.save(target)
            sizes[extension] += target.stat().st_size
        font.close()
        rules.append(
            "@font-face {\n"
            "  font-family: 'Maple Mono CN';\n"
            "  font-style: normal;\n"
            f"  font-weight: {weight};\n"
            "  font-display: swap;\n"
            f"  src: url('./{stem}.woff2') format('woff2'),\n"
            f"       url('./{stem}.woff') format('woff');\n"
            f"  unicode-range: {unicode_range(points)};\n"
            "}\n"
        )
    print(f"Weight {weight}: {len(groups)} subsets generated", flush=True)
    return rules, sizes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    args = parser.parse_args()
    with args.archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if digest != ARCHIVE_SHA256:
        raise ValueError(f"Expected official {VERSION} MapleMono-CN-unhinted.zip")
    DESTINATION.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="jiying-maple-") as temporary:
        with zipfile.ZipFile(args.archive) as archive:
            sources = {}
            for weight, style in WEIGHTS.items():
                filename = f"MapleMono-CN-{style}.ttf"
                member = next(item for item in archive.namelist() if Path(item).name == filename)
                target = Path(temporary) / filename
                target.write_bytes(archive.read(member))
                sources[weight] = target
            license_member = next(item for item in archive.namelist() if Path(item).name in {"LICENSE", "LICENSE.txt", "OFL.txt"})
            license_text = archive.read(license_member)

        with TTFont(sources[400]) as font:
            coverage = set(font.getBestCmap())
        for weight, path in sources.items():
            with TTFont(path) as font:
                if font["OS/2"].usWeightClass != weight or "fvar" in font:
                    raise ValueError(f"Unexpected source weight: {weight}")
                if set(font.getBestCmap()) != coverage:
                    raise ValueError(f"Inconsistent character coverage: {weight}")

        # Put current site copy in small subsets; retain every other source
        # character in fallback subsets so future copy never needs system fonts.
        page_characters = set()
        for path in (ROOT / "src").rglob("*"):
            if path.suffix in {".astro", ".ts", ".tsx", ".css"} and "assets" not in path.parts:
                page_characters.update(map(ord, path.read_text()))
        latin = sorted(point for point in coverage if point <= 0x024F)
        common = sorted((page_characters & coverage) - set(latin))
        remaining = sorted(coverage - set(latin) - set(common))
        groups = [("latin", latin)]
        for label, points, chunk_size in [("common", common, 256), ("extended", remaining, 1024)]:
            groups.extend((f"{label}-{index // chunk_size:02d}", points[index:index + chunk_size]) for index in range(0, len(points), chunk_size))
        with ProcessPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(build_weight, [(weight, path, groups) for weight, path in sources.items()]))

    header = (
        "/* Generated by scripts/sync-fonts.py. Do not edit manually.\n"
        f" * Maple Mono CN {VERSION}, SIL OFL-1.1. Static weights: 400, 500, 600, 700.\n"
        " * Local WOFF2 with WOFF fallback; disjoint unicode-range subsets.\n"
        " */\n\n"
    )
    (DESTINATION / "font.css").write_text(header + "\n".join(rule for rules, _ in results for rule in rules))
    (DESTINATION / "LICENSE").write_bytes(license_text)
    metadata = {
        "family": "Maple Mono CN", "version": VERSION,
        "source": f"https://github.com/subframe7536/maple-font/releases/download/{VERSION}/MapleMono-CN-unhinted.zip",
        "sha256": ARCHIVE_SHA256, "weights": list(WEIGHTS),
        "characters": len(coverage), "subsetsPerWeight": len(groups),
        "bytes": {extension: sum(sizes[extension] for _, sizes in results) for extension in ["woff2", "woff"]},
    }
    (DESTINATION / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    expected = {f"maple-mono-cn-{weight}-{name}.{extension}" for weight in WEIGHTS for name, _ in groups for extension in ("woff", "woff2")}
    for asset in DESTINATION.glob("*.woff*"):
        if asset.name not in expected:
            asset.unlink()
    print(json.dumps(metadata, indent=2), flush=True)


if __name__ == "__main__":
    main()
