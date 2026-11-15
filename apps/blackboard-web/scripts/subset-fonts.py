#!/usr/bin/env python3
"""Regenerate the QuBlack Latin subsets committed under public/fonts/.

The app ships only the Latin/punctuation side of each face; the CJK side comes from the installed
QuBlack at runtime via local() (see app/fonts.css). Run this once per QuBlack release — it is not
part of `bun run build`, and a rebuild is a deliberate re-commit of the four woff2 files.

    python3 scripts/subset-fonts.py [--src DIR] [--out DIR] [--check]

--src defaults to ~/code/gjuoun/qublack/dist (the release folder with the woff2 faces).
--check only reports what is already committed; it never writes.
"""
from __future__ import annotations

import argparse
import pathlib
import subprocess
import sys

# Basic Latin, Latin-1/Extended-A, general punctuation (dashes/quotes), currency, arrows,
# box drawing and geometric shapes (CLI output pasted into docs). Deliberately no CJK.
UNICODES = "U+0000-024F,U+2000-206F,U+20A0-20BF,U+2190-21FF,U+2500-257F"
FACES = [
    ("QuBlackSans-Regular", "qb-sans-latin"),
    ("QuBlackSans-Bold", "qb-sans-bold-latin"),
    ("QuBlackMono-Regular", "qb-mono-latin"),
    ("QuBlackMono-Bold", "qb-mono-bold-latin"),
]
BUDGET = 200 * 1024


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(pathlib.Path.home() / "code/gjuoun/qublack/dist"))
    ap.add_argument("--out", default=str(pathlib.Path(__file__).resolve().parent.parent / "public/fonts"))
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    src = pathlib.Path(args.src)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    if not src.is_dir():
        print(f"error: no QuBlack release folder at {src} (pass --src)", file=sys.stderr)
        return 2

    total = 0
    for face, name in FACES:
        target = out / f"{name}.woff2"
        if not args.check:
            source = src / f"{face}.woff2"
            if not source.exists():
                # 1.2.0 ships the variable faces; fall back to the static pair when present.
                print(f"error: missing {source}", file=sys.stderr)
                return 2
            cmd = [
                sys.executable, "-m", "fontTools.subset", str(source),
                f"--unicodes={UNICODES}", "--flavor=woff2", "--layout-features=",
                f"--output-file={target}",
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                print(f"error: subset {face} failed\n{proc.stderr.strip()}", file=sys.stderr)
                return proc.returncode
        if not target.exists():
            print(f"error: {target} is missing (run without --check)", file=sys.stderr)
            return 1
        size = target.stat().st_size
        total += size
        print(f"{target.name} {size} B")
    print(f"total {total / 1024:.1f} KB ({'under' if total <= BUDGET else 'OVER'} 200 KB)")
    return 0 if total <= BUDGET else 1


if __name__ == "__main__":
    raise SystemExit(main())
