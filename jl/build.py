#!/usr/bin/env python3
"""
build.py — Hemacandra Grammar Digitization Project
Converts haima-vyākaraṇa.csv → sutras.json with pre-baked transliterations.

Transliteration engine: Aksharamukha (https://aksharamukha.appspot.com/)
Requirements: pip install aksharamukha
Usage: python build.py
"""

import csv
import json
import re
import sys
import os

try:
    from aksharamukha import transliterate as amukha
except ImportError:
    print("ERROR: aksharamukha not found.")
    print("Install with: pip install aksharamukha")
    sys.exit(1)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE   = os.path.join(SCRIPT_DIR, "haima-vyākaraṇa.csv")
OUT_FILE   = os.path.join(SCRIPT_DIR, "sutras.json")

# Aksharamukha script names
_AM_TARGETS = {
    "IAST":      "IAST",
    "ISO15919":  "ISO",
    "HK":        "HK",
}


def dev_to(text: str, target: str) -> str:
    """Transliterate Devanagari text to a target script using Aksharamukha."""
    if not text:
        return ""
    am_target = _AM_TARGETS.get(target, target)
    try:
        result = amukha.process("Devanagari", am_target, text)
        # Normalise double-daṇḍa ॥ → || (Aksharamukha outputs "..")
        result = result.replace("..", "||")
        # Single daṇḍa . → | (sometimes)
        # result = result.replace(".", "|")  # careful — can affect abbreviations
        return result
    except Exception:
        return text


def parse_id(sutra_id: str):
    """Parse '1.2.3' → (adhyaya=1, pada=2, num=3)."""
    parts = sutra_id.strip().split(".")
    try:
        adhyaya = int(parts[0]) if len(parts) > 0 else 1
        pada    = int(parts[1]) if len(parts) > 1 else 1
        # num may be fractional like "42.1" in the original — keep as string
        num_str = ".".join(parts[2:]) if len(parts) > 2 else "0"
        try:
            num = int(parts[2]) if len(parts) > 2 else 0
        except ValueError:
            num = 0
    except (ValueError, IndexError):
        adhyaya, pada, num, num_str = 1, 1, 0, "0"
    return adhyaya, pada, num


def all_texts(dev_text: str) -> dict:
    return {
        "Devanagari": dev_text,
        "IAST":       dev_to(dev_text, "IAST"),
        "ISO15919":   dev_to(dev_text, "ISO15919"),
        "HK":         dev_to(dev_text, "HK"),
    }


def main():
    sutras = []

    with open(CSV_FILE, encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        next(reader)  # skip header row

        for row in reader:
            if len(row) < 2:
                continue

            sutra_id  = row[0].strip()
            dev_sutra = row[1].strip()
            dev_comm  = row[2].strip() if len(row) > 2 else ""

            if not sutra_id or not dev_sutra:
                continue

            adhyaya, pada, num = parse_id(sutra_id)

            commentaries = []
            if dev_comm:
                commentaries.append({
                    "label": "Laghuvṛtti",
                    **all_texts(dev_comm),
                })

            sutras.append({
                "id":           sutra_id,
                "ref":          sutra_id,
                "adhyaya":      adhyaya,
                "pada":         pada,
                "num":          num,
                "texts":        all_texts(dev_sutra),
                "commentaries": commentaries,
            })

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(sutras, f, ensure_ascii=False, indent=None, separators=(",", ":"))

    print("Generated %d sutras -> sutras.json" % len(sutras))

    # Print pada summary
    from collections import Counter
    padas = Counter("%s.%s" % (s['adhyaya'], s['pada']) for s in sutras)
    for k in sorted(padas):
        parts = k.split('.')
        print("  Adhyaya %s, Pada %s: %d sutras" % (parts[0], parts[1], padas[k]))


if __name__ == "__main__":
    main()
