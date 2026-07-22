#!/usr/bin/env python3
"""
Jaina Literature Portal — build pipeline.

Source of truth: texts/*.txt   (YAML frontmatter + marker-line verse body)
Build output (committed to git, consumed by the static site):
    data/texts/<slug>.json   — full text with all scripts, per text (lazy-loaded by text.html)
    data/catalog.json        — lightweight metadata-only catalogue (loaded by index.html)
    data/verses-flat.json    — denormalised verse corpus for full-text search (lazy-loaded)

Canonical encoding is Unicode Devanagari. IAST / ISO-15919 / Harvard-Kyoto / SLP1
are DERIVED here via Aksharamukha — never hand-typed — which structurally prevents
the HTML-entity corruption (&ntilde; &rsquo;) and "Devanagari-only" gaps of the old
hand-coded pages. Latin metadata (blurb, about, edition …) is kept verbatim.

Usage:
    pip install -r build_requirements.txt
    python build.py
"""

import io
import json
import re
import sys
from pathlib import Path

# Windows console is cp1252 by default; force UTF-8 so status lines with
# Devanagari/diacritics don't raise UnicodeEncodeError.
try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass

try:
    import yaml
except ImportError:
    sys.exit("Missing dependency: pip install pyyaml")

try:
    from aksharamukha import transliterate
    HAVE_AKSHARA = True
except ImportError:
    HAVE_AKSHARA = False
    print("WARNING: aksharamukha not installed — only Devanagari will be emitted.\n"
          "         Run: pip install aksharamukha", file=sys.stderr)

ROOT = Path(__file__).parent
TEXTS_DIR = ROOT / "texts"
DATA_DIR = ROOT / "data"
DATA_TEXTS_DIR = DATA_DIR / "texts"

# Target scripts derived from Devanagari. HK/SLP1 are ASCII (search/index use).
SCRIPTS = {
    "iast": "IAST",
    "iso": "ISO",
    "hk": "HK",
    "slp1": "SLP1",
}
SCRIPT_KEYS = ["deva", "iast", "iso", "hk", "slp1"]

_entity_re = re.compile(r"&[a-zA-Z]+;|&#\d+;")
_deva_re = re.compile(r"[ऀ-ॿ]")


def dev_to(text, target):
    """Transliterate Devanagari -> target script via Aksharamukha (verse-safe)."""
    if not text or not HAVE_AKSHARA:
        return text if target == "iast" else ""
    # Transliterate line by line so \n verse/pada breaks are preserved verbatim.
    out = []
    for line in text.split("\n"):
        out.append(transliterate.process("Devanagari", target, line) if line.strip() else line)
    return "\n".join(out)


def sf(text):
    """Script-family for a string: {deva, iast, iso, hk, slp1}.

    If the input contains Devanagari it is treated as canonical and every other
    script is derived. If it is already Latin (e.g. a metre name typed as
    "Anuṣṭubh") it is passed through unchanged — no mangling by transliteration.
    Returns None for empty input so callers can omit blank fields.
    """
    text = (text or "").strip()
    if not text:
        return None
    if _deva_re.search(text):
        d = {"deva": text}
        for key, aksh in SCRIPTS.items():
            d[key] = dev_to(text, aksh)
        return d
    # already Latin — keep verbatim across the Latin scripts, no Devanagari source
    return {"deva": "", "iast": text, "iso": text, "hk": text, "slp1": text}


# ---------------------------------------------------------------------------
# Source parsing: YAML frontmatter + marker-line body
# ---------------------------------------------------------------------------
#   @N              -> begins verse N; following non-marker lines are Devanagari padas
#   >xx: text       -> a translation line (xx = ISO-639-1 lang code); indented continuations append
#   #label: text    -> a commentary block under `label` (multi-line until blank/next marker)
#   !apparatus: t   -> an apparatus / footnote entry on the current verse
#   @@colophon      -> begins a colophon block (repeatable); Devanagari until next marker/EOF
# ---------------------------------------------------------------------------

MARKER = re.compile(r"^(@@colophon|@\d+|>[a-z]{2}:|#[a-z0-9_]+:|!apparatus:)", re.IGNORECASE)


def parse_source(path):
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        raise ValueError(f"{path.name}: missing YAML frontmatter")
    _, fm, body = raw.split("---", 2)
    meta = yaml.safe_load(fm) or {}

    verses = []
    colophons = []           # list of colophon strings (repeatable @@colophon)
    cur_colo = None          # list of lines for the colophon currently open
    cur = None               # current verse dict
    cur_pada_lines = []
    cur_trans = None         # (lang, [lines])
    cur_comm = None          # (label, [lines])

    def flush_padas():
        if cur is not None and cur_pada_lines:
            cur["_deva"] = "\n".join(cur_pada_lines).strip()

    def flush_trans():
        nonlocal cur_trans
        if cur is not None and cur_trans:
            lang, lines = cur_trans
            cur["translations"].append({
                "lang": lang, "translator": None,
                "text": "\n".join(lines).strip(),
            })
        cur_trans = None

    def flush_comm():
        nonlocal cur_comm
        if cur is not None and cur_comm:
            label, lines = cur_comm
            cur["commentary"].append({"label": label, "deva": "\n".join(lines).strip()})
        cur_comm = None

    def flush_colophon():
        nonlocal cur_colo
        if cur_colo is not None:
            txt = "\n".join(l for l in cur_colo if l).strip()
            if txt:
                colophons.append(txt)
        cur_colo = None

    for line in body.splitlines():
        stripped = line.strip()
        m = MARKER.match(stripped)

        if cur_colo is not None and not m:
            cur_colo.append(stripped)
            continue

        if m:
            tag = m.group(1).lower()
            rest = stripped[m.end():].strip()

            # A new marker ends any open translation/commentary accumulation.
            flush_trans()
            flush_comm()

            if tag == "@@colophon":
                flush_padas()
                flush_colophon()
                cur_colo = []
                continue
            if tag.startswith("@"):
                flush_padas()
                flush_colophon()
                if cur is not None:
                    verses.append(cur)
                num = int(tag[1:])
                cur = {"num": num, "translations": [], "commentary": [], "apparatus": []}
                cur_pada_lines = []
                continue
            if tag.startswith(">"):
                cur_trans = (tag[1:-1], [rest])  # >en: -> "en"
                continue
            if tag.startswith("#"):
                cur_comm = (tag[1:-1], [rest])   # #vrtti: -> "vrtti"
                continue
            if tag == "!apparatus:":
                if cur is not None:
                    cur["apparatus"].append({"note": rest, "source": None})
                continue

        # non-marker line: continuation of whatever block is open
        if cur_trans is not None:
            cur_trans[1].append(stripped)
        elif cur_comm is not None:
            cur_comm[1].append(stripped)
        elif cur is not None and stripped:
            cur_pada_lines.append(stripped)

    flush_trans()
    flush_comm()
    flush_padas()
    flush_colophon()
    if cur is not None:
        verses.append(cur)

    meta["_verses"] = verses
    meta["_colophons"] = colophons
    return meta


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def validate(meta, path):
    errors = []
    for field in ("slug", "title", "language", "genre"):
        if not meta.get(field):
            errors.append(f"missing required field: {field}")
    if not (meta.get("title") or {}).get("deva"):
        errors.append("title.deva is required (canonical Devanagari)")
    if not meta.get("_verses"):
        errors.append("no verses parsed")
    seen = set()
    for v in meta.get("_verses", []):
        if not v.get("_deva"):
            errors.append(f"verse {v.get('num')} has empty Devanagari body")
        if v["num"] in seen:
            errors.append(f"duplicate verse number: {v['num']}")
        seen.add(v["num"])
        # regression guard: reject HTML-entity corruption before it is ever committed
        if _entity_re.search(v.get("_deva", "")):
            errors.append(f"verse {v['num']}: HTML entity found in source text")
    if errors:
        raise ValueError(f"{path.name}:\n  - " + "\n  - ".join(errors))


# ---------------------------------------------------------------------------
# Build one text -> per-text JSON dict
# ---------------------------------------------------------------------------

def build_metre(m):
    out = {"name": sf((m.get("name") or "")), "verses": m.get("verses")}
    lak = sf(m.get("lakshana") or "")
    if lak:
        out["lakshana"] = lak
    return out


def build_text(meta):
    slug = meta["slug"]
    author = meta.get("author", {}) or {}
    # author name may be nested (author.name.deva) or flat (author.deva)
    a_name = author.get("name")
    if isinstance(a_name, dict):
        author_name_deva = a_name.get("deva", "")
    else:
        author_name_deva = author.get("deva", "") or (a_name or "")
    author_out = {
        "name": sf(author_name_deva) or {},
        "note": author.get("note"),
        "period": author.get("period"),
        "sect": author.get("sect"),
    }

    verses_out = []
    for v in meta["_verses"]:
        vid = f"{slug}-v{v['num']}"
        verses_out.append({
            "id": vid,
            "num": v["num"],
            "padas": sf(v["_deva"]),
            "translations": [t for t in v["translations"] if t.get("text")],
            "commentary": [
                {"label": c["label"], **(sf(c["deva"]) or {})} for c in v["commentary"]
            ],
            "apparatus": v["apparatus"],
        })

    sections = []
    for s in meta.get("sections", []) or []:
        sections.append({
            "before": s.get("before") or s.get("beforeVerse"),
            "heading": sf(s.get("heading") or ""),
        })

    colophons = [sf(c) for c in meta.get("_colophons", []) if c]
    colophons = [c for c in colophons if c]

    return {
        "slug": slug,
        "accession": meta.get("accession"),
        "title": sf(meta["title"]["deva"]),
        "author": author_out,
        "language": meta["language"],
        "genre": meta["genre"],
        "period": meta.get("period"),
        "sect": meta.get("sect"),
        "sourceScript": meta.get("sourceScript"),
        "metre": [build_metre(m) for m in meta.get("metre", []) or []],
        "edition": meta.get("edition", {}) or {},
        "blurb": meta.get("blurb"),
        "about": meta.get("about", []) or [],
        "overview": meta.get("overview", []) or [],
        "note": meta.get("note"),
        "sections": sections,
        "colophon": colophons,
        "extras": meta.get("extras"),
        "verses": verses_out,
    }


def catalog_entry(text):
    a = text["author"]
    return {
        "slug": text["slug"],
        "accession": text.get("accession"),
        "title": text["title"],
        "author": {"name": a.get("name", {}), "note": a.get("note"),
                   "period": a.get("period"), "sect": a.get("sect")},
        "language": text["language"],
        "genre": text["genre"],
        "period": text.get("period"),
        "sect": text.get("sect"),
        "metre": [(m.get("name") or {}).get("iast", "") for m in text.get("metre", [])],
        "blurb": text.get("blurb"),
        "verse_count": len(text["verses"]),
        "path": f"data/texts/{text['slug']}.json",
    }


def flat_verses(text):
    rows = []
    for v in text["verses"]:
        padas = v["padas"] or {}
        rows.append({
            "id": v["id"],
            "slug": text["slug"],
            "num": v["num"],
            "title_iast": (text["title"] or {}).get("iast", ""),
            "author_iast": text["author"].get("name", {}).get("iast", ""),
            "language": text["language"],
            "deva": padas.get("deva", ""),
            "iast": padas.get("iast", ""),
            "hk": padas.get("hk", ""),
            "translation": " ".join(t.get("text", "") for t in v["translations"]),
        })
    return rows


def main():
    if not TEXTS_DIR.exists():
        sys.exit(f"No texts/ directory at {TEXTS_DIR}")
    DATA_TEXTS_DIR.mkdir(parents=True, exist_ok=True)

    catalog, flat = [], []
    sources = sorted(TEXTS_DIR.glob("*.txt"))
    if not sources:
        sys.exit("No source texts found in texts/*.txt")

    for path in sources:
        meta = parse_source(path)
        validate(meta, path)
        text = build_text(meta)
        (DATA_TEXTS_DIR / f"{text['slug']}.json").write_text(
            json.dumps(text, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
        )
        catalog.append(catalog_entry(text))
        flat.extend(flat_verses(text))
        print(f"  built {text['slug']}: {len(text['verses'])} verses")

    # Stable catalogue order: by accession when present, else by slug.
    catalog.sort(key=lambda c: (c.get("accession") or "zzz", c["slug"]))

    (DATA_DIR / "catalog.json").write_text(
        json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    (DATA_DIR / "verses-flat.json").write_text(
        json.dumps(flat, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print(f"\nDone: {len(catalog)} text(s), {len(flat)} verses.")
    print("  -> data/catalog.json, data/verses-flat.json, data/texts/*.json")


if __name__ == "__main__":
    main()
