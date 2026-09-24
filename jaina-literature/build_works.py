#!/usr/bin/env python3
"""
Jaina Literature Portal — build pipeline for the sectioned works
(Kāvyas, Darśana).

Long works that arrive as the running text of a printed edition (not as
hand-authored marker files) are segmented directly. Each section folder holds

    <section>/sources/<slug>.txt   the edition text as digitised
    <section>/sources/<slug>.yml   metadata + parse hints; `format:` picks the parser

and receives (committed, consumed by the shared reader in kavyas/):

    <section>/data/catalog.json          one entry per work
    <section>/data/<slug>/mula.json      metadata, unit (sarga/adhyāya) index, every
                                         verse/sūtra in deva/iast/iso/hk, metre
    <section>/data/<slug>/tika-<n>.json  commentary for unit n (deva + iast), lazy-loaded

Formats
    kavya  "अथ … सर्गः" headings, verses ending ॥N॥ in sequence, ṭīkā paragraphs,
           sarga colophons, optional "अथ प्रशस्तिः". With `samasya:` in the yml,
           "(Megha 1a)"-style tags mark the line borrowed from a source poem, and
           an appendix listing those lines rebuilds the source text.
    sutra  numbered sūtras, each followed by a commentary block opening "इति॥";
           units close with an "इति … अध्यायः" colophon; a contents list gives
           each unit's topics.

Metre is identified by laghu/guru scansion of each pāda, matched against the
common kāvya metres (sama, ardhasama, anuṣṭubh, āryā family). It is labelled
"auto" in the UI because OCR slips can defeat it.

Usage:
    pip install aksharamukha pyyaml
    python build_works.py              # every section
    python build_works.py darshana     # one section
"""

import difflib

import io
import json
import re
import sys
from collections import Counter
from pathlib import Path

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass

import yaml
from aksharamukha import transliterate

ROOT = Path(__file__).parent
SECTIONS = ["kavyas", "darshana", "poetics"]

DIGITS = "०१२३४५६७८९"
_deva_re = re.compile(r"[ऀ-ॿ]")


def devnum(s):
    return int("".join(str(DIGITS.index(c)) for c in s))


# ---------------------------------------------------------------------------
# Transliteration
# ---------------------------------------------------------------------------

def _latin_prep(text):
    # daṇḍas become | and ‖ rather than Aksharamukha's "." / ".."; the Devanagari
    # zero the edition uses as an abbreviation mark after a pratīka ("कोशलेति०")
    # becomes ° instead of the digit 0.
    text = re.sub(r"(?<=[ऀ-ॣॱ-ॿ])०(?![०-९])", "°", text)
    text = re.sub(r"(?<![०-९])०(?=[।॥?,\s])", "°", text)
    return text.replace("॥", " ‖ ").replace("।", " | ").replace("  ", " ")


def tr(text, target):
    if not text:
        return ""
    out = []
    for line in _latin_prep(text).split("\n"):
        out.append(transliterate.process("Devanagari", target, line).strip() if line.strip() else "")
    s = "\n".join(out)
    return re.sub(r" ([|‖])", r" \1", s).replace(" ‖ ‖", " ‖").replace("  ", " ")


def sf(text, scripts=("iast", "iso", "hk")):
    names = {"iast": "IAST", "iso": "ISO", "hk": "HK"}
    text = (text or "").strip()
    if not text:
        return None
    if not _deva_re.search(text):
        return {"deva": "", **{k: text for k in scripts}}
    d = {"deva": text}
    for k in scripts:
        d[k] = tr(text, names[k])
    return d


# ---------------------------------------------------------------------------
# Metre identification
# ---------------------------------------------------------------------------

METRES = [
    # (iast, deva, per-pāda pattern(s): one string for sama, (odd, even) for ardhasama)
    ("anuṣṭubh", "अनुष्टुभ्", None),
    ("indravajrā", "इन्द्रवज्रा", "GGLGGLLGLGG"),
    ("upendravajrā", "उपेन्द्रवज्रा", "LGLGGLLGLGG"),
    ("rathoddhatā", "रथोद्धता", "GLGLLLGLGLG"),
    ("svāgatā", "स्वागता", "GLGLLLGLLGG"),
    ("śālinī", "शालिनी", "GGGGGLGGLGG"),
    ("dodhaka", "दोधक", "GLLGLLGLLGG"),
    ("vaṃśastha", "वंशस्थ", "LGLGGLLGLGLG"),
    ("vaiśvadevī", "वैश्वदेवी", "GGGGGGLGGLGG"),
    ("indravaṃśā", "इन्द्रवंशा", "GGLGGLLGLGLG"),
    ("drutavilambita", "द्रुतविलम्बित", "LLLGLLGLLGLG"),
    ("toṭaka", "तोटक", "LLGLLGLLGLLG"),
    ("bhujaṅgaprayāta", "भुजङ्गप्रयात", "LGGLGGLGGLGG"),
    ("sragviṇī", "स्रग्विणी", "GLGGLGGLGGLG"),
    ("pramitākṣarā", "प्रमिताक्षरा", "LLGLGLLLGLLG"),
    ("mañjubhāṣiṇī", "मञ्जुभाषिणी", "LLGLGLLLGLGLG"),
    ("praharṣiṇī", "प्रहर्षिणी", "GGGLLLLGLGLGG"),
    ("rucirā", "रुचिरा", "LGLGLLLLGLGLG"),
    ("mattamayūra", "मत्तमयूर", "GGGGGLLGGLLGG"),
    ("vasantatilakā", "वसन्ततिलका", "GGLGLLLGLLGLGG"),
    ("mālinī", "मालिनी", "LLLLLLGGGLGGLGG"),
    ("pañcacāmara", "पञ्चचामर", "LGLGLGLGLGLGLGLG"),
    ("śikhariṇī", "शिखरिणी", "LGGGGGLLLLLGGLLLG"),
    ("pṛthvī", "पृथ्वी", "LGLLLGLGLLLGLGGLG"),
    ("mandākrāntā", "मन्दाक्रान्ता", "GGGGLLLLLGGLGGLGG"),
    ("hariṇī", "हरिणी", "LLLLLGGGGGLGLLGLG"),
    ("śārdūlavikrīḍita", "शार्दूलविक्रीडित", "GGGLLGLGLLLGGGLGGLG"),
    ("sragdharā", "स्रग्धरा", "GGGGLGGLLLLLLGGLGGLGG"),
    ("viyoginī", "वियोगिनी", ("LLGLLGLGLG", "LLGGLLGLGLG")),
    ("puṣpitāgrā", "पुष्पिताग्रा", ("LLLLLLGLGLGG", "LLLLGLLGLGLGG")),
]
METRE_DEVA = {m[0]: m[1] for m in METRES}
METRE_DEVA.update({"upajāti": "उपजाति", "āryā": "आर्या", "gīti": "गीति",
                   "upagīti": "उपगीति", "udgīti": "उद्गीति"})
# pairs that combine line-by-line into an Upajāti
UPAJATI_FAMILIES = [{"indravajrā", "upendravajrā"}, {"vaṃśastha", "indravaṃśā"}]

V_SHORT = set("aiufx")
V_LONG = set("AIUFXeEoO")
VOWELS = V_SHORT | V_LONG
CONS = set("kKgGNcCjJYwWqQRtTdDnpPbBmyrlvSzshL")


def weights(slp):
    s = "".join(c for c in slp if c in VOWELS or c in CONS or c in "MH")
    pos = [i for i, c in enumerate(s) if c in VOWELS]
    out = []
    for k, i in enumerate(pos):
        if s[i] in V_LONG:
            out.append("G")
            continue
        nxt = pos[k + 1] if k + 1 < len(pos) else len(s)
        between = s[i + 1:nxt]
        if "M" in between or "H" in between:
            out.append("G")
        elif sum(1 for c in between if c in CONS) >= (2 if k + 1 < len(pos) else 1):
            out.append("G")
        else:
            out.append("L")
    return "".join(out)


def clean_for_scan(deva):
    deva = re.sub(r"॥\s*[०-९]+\s*॥.*$", "", deva, flags=re.S)         # number + tail
    deva = re.sub(r"[।॥,;:?!\"'“”‘’()\[\]०-९.–—\-ऽ]", " ", deva)
    return deva


def _match(p, pat):
    # final syllable of a pāda is anceps
    return len(p) == len(pat) and p[:-1] == pat[:-1]


def _matra(p, last_heavy):
    m = sum(2 if c == "G" else 1 for c in p[:-1]) if p else 0
    return m + (2 if last_heavy else 1) if p else 0


PATTERNS = {m[0]: m[2] for m in METRES}


def _sama(padas):
    best, best_score = None, 0
    for name, pat in PATTERNS.items():
        if pat is None:
            continue
        if isinstance(pat, tuple):
            score = sum(_match(p, pat[i % 2]) for i, p in enumerate(padas))
        else:
            score = sum(_match(p, pat) for p in padas)
        if score > best_score:
            best, best_score = name, score
    for fam in UPAJATI_FAMILIES:
        hits = [next((n for n in fam if _match(p, PATTERNS[n])), None) for p in padas]
        if len(set(h for h in hits if h)) == 2 and sum(1 for h in hits if h) >= 3:
            return "upajāti"
    return best if best_score >= 3 else None


def identify_metre(deva):
    lines = [l for l in clean_for_scan(deva).split("\n") if l.strip()]
    pats = [weights(transliterate.process("Devanagari", "SLP1", l)) for l in lines]
    pats = [p for p in pats if p]
    if not pats:
        return None
    # a two-line śloka with one syllable lost or doubled in transmission
    if len(pats) == 2 and all(15 <= len(p) <= 17 for p in pats) and 31 <= len(pats[0] + pats[1]) <= 33:
        return "anuṣṭubh"
    # normalise to four pādas: 2 printed lines of even length → split in halves
    padas = pats
    if len(pats) == 2:
        padas = []
        for p in pats:
            h = len(p) // 2
            padas += [p[:h], p[h:]] if len(p) % 2 == 0 else [p]
    if len(padas) != 4:
        joined = "".join(pats)
        if len(joined) % 4 == 0:
            q = len(joined) // 4
            padas = [joined[i * q:(i + 1) * q] for i in range(4)]
    if len(padas) != 4:
        return None

    lens = [len(p) for p in padas]
    # anuṣṭubh: 8-syllable pādas (tolerate one hypermetric slip)
    if sum(1 for n in lens if n == 8) >= 3 and all(7 <= n <= 9 for n in lens):
        return "anuṣṭubh"

    found = _sama(padas)
    if found:
        return found
    # printed line breaks sometimes fall mid-pāda: re-split the whole verse evenly
    joined = "".join(padas)
    if len(joined) % 4 == 0:
        q = len(joined) // 4
        found = _sama([joined[i * q:(i + 1) * q] for i in range(4)])
        if found:
            return found

    # mātrā metres: āryā family, by half-verse (pādas 1+2, 3+4)
    halves = [padas[0] + padas[1], padas[2] + padas[3]]
    ms = [{_matra(h, True), _matra(h, False)} for h in halves]
    for name, (a, b) in (("āryā", (30, 27)), ("gīti", (30, 30)),
                         ("upagīti", (27, 27)), ("udgīti", (27, 30))):
        if a in ms[0] and b in ms[1]:
            return name
    return None


# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------

SARGA_RE = re.compile(r"^(?:अथ\s+)?(\S+)\s+सर्गः(?:\s+प्रारभ्यते)?$")
PRASASTI_RE = re.compile(r"अथ\s+प्रशस्तिः")
NUM_RE = re.compile(r"॥\s*([०-९]+)\s*॥")
DIVIDER_RE = re.compile(r"^[\s\-–—_~♦.*]+$")
GROUP_RE = re.compile(r"(युग्मम्|त्रिभिर्विशेषकम्|विशेषकम्|चतुर्भिः\s*कलापकम्|कलापकम्|कुलकम्)")
GROUP_SIZE = {"युग्मम्": 2, "त्रिभिर्विशेषकम्": 3, "विशेषकम्": 3,
              "कलापकम्": 4, "कुलकम्": 5}
RUBRIC_RE = re.compile(r"^॥[^०-९॥]+॥$")
LOOSE_NUM_RE = re.compile(r"॥\s*([०-९]+)\s*॥?\s*$")
QUOTE_START = tuple('"“‘\'(')
MAX_VERSE_LINE = 90


def blocks_of(lines):
    out, cur = [], []
    for l in lines:
        if l.strip() == "":
            if cur:
                out.append(cur)
                cur = []
        else:
            cur.append(l.rstrip())
    if cur:
        out.append(cur)
    return out


def is_divider(b):
    return all(DIVIDER_RE.match(l) for l in b)


def verse_like(b):
    return all(len(l.strip()) < MAX_VERSE_LINE for l in b) and not b[0].strip().startswith(QUOTE_START)


def numbered(b):
    m = NUM_RE.search(b[-1])
    return (devnum(m.group(1)), m) if m else (None, None)


def ends_sentence(s):
    return bool(re.search(r"[।॥?!]\s*$|[०-९]+\s*॥\s*$", s.strip()))


def to_devnum(n):
    return str(n).translate(str.maketrans("0123456789", DIGITS))


def clean_text(text):
    return text.replace("​", "").replace("﻿", "").replace("᳚", "")


def parse_frontmatter(lines, cfg):
    if not cfg:
        return []
    try:
        a = next(i for i, l in enumerate(lines) if l.strip().startswith(cfg["start"]))
        b = next(i for i, l in enumerate(lines) if i > a and l.strip().startswith(cfg["end"]))
    except StopIteration:
        return []
    items = []
    blocks = blocks_of(lines[a:b])
    for i, blk in enumerate(blocks):
        if is_divider(blk):
            continue
        txt = "\n".join(l.rstrip() for l in blk)
        # numbered list lines (works of the author etc.) merge into one list
        if all(re.match(r"^\s*[०-९]+\s", l) for l in blk):
            li = [l.strip() for l in blk]
            if items and items[-1]["t"] == "ol":
                items[-1]["items"] += li
            else:
                items.append({"t": "ol", "items": li})
            continue
        # headings: short single line, optionally underlined by ~~~ on the next line
        underlined = len(blk) == 2 and DIVIDER_RE.match(blk[1])
        if (len(blk) == 1 and len(txt.strip()) < 40 and not txt.startswith(" ")) or underlined:
            items.append({"t": "h", "text": blk[0].strip().rstrip(":")})
            continue
        # tabular blocks (lineage, signature) keep their spacing
        if any(re.search(r"\S\s{4,}\S", l) for l in blk) or (len(blk) > 1 and all(len(l) < 60 for l in blk)):
            items.append({"t": "pre", "text": "\n".join(l for l in blk if not DIVIDER_RE.match(l))})
            continue
        for l in blk:        # Latin front matter keeps one paragraph per line
            if l.strip():
                items.append({"t": "p", "text": l.strip()})
    return items


# ---------------------------------------------------------------------------
# Samasyā (a kāvya built on lines borrowed from another poem)
# ---------------------------------------------------------------------------

def samasya_tools(cfg):
    """Regexes for a yml `samasya:` block, or None."""
    sc = cfg.get("samasya")
    if not sc:
        return None
    tag = re.escape(sc.get("tag", "Megha"))
    return {
        "cfg": sc,
        # "(Megha 1a)", "(Megha 62c )", and the unclosed "(Megha 50c"
        "tag": re.compile(r"\(\s*" + tag + r"\s+(\d+)\s*([a-d])\s*\)?"),
        "var": re.compile(r"(?:^|\s+)var\b\s*(.*)$"),
    }


def strip_samasya(block, st):
    """Remove source tags and 'var …' notes from a block's lines.
    Returns (clean lines, [(line index, ref)], [variant notes])."""
    lines, refs, variants = [], [], []
    for i, l in enumerate(block):
        for m in st["tag"].finditer(l):
            refs.append((i, m.group(1) + m.group(2)))
        l2 = st["tag"].sub("", l)
        vm = st["var"].search(l2)
        if vm:
            if vm.group(1).strip():
                variants.append(vm.group(1).strip())
            l2 = l2[:vm.start()]
        lines.append(l2.rstrip())
    return lines, refs, variants


def _norm(s):
    return re.sub(r"[^ऀ-ॣॱ-ॿ]", "", s)


def parse_samasya_appendix(lines, st):
    """Source-poem lines listed after the work: '<line> ॥ N ॥ (Megha 1a)'."""
    out = {}
    for l in lines:
        m = st["tag"].search(l)
        if not m or not _deva_re.search(l):
            continue
        text = st["tag"].sub("", l)
        text = st["var"].sub("", text)
        text = NUM_RE.sub("", text)
        text = re.sub(r"॥\s*[०-९]+\s*$", "", text)       # "॥ १४" missing its closing daṇḍa
        text = text.replace("॥", "").replace("।", "").strip()
        out.setdefault(m.group(1) + m.group(2), text)
    return out


def locate_samasya(verse_lines, refs, appendix):
    """For each borrowed-line ref, find which printed line of the verse carries it."""
    found = []
    for tag_line, ref in refs:
        src = appendix.get(ref)
        best, best_r = tag_line, 0.0
        if src:
            for i, l in enumerate(verse_lines):
                r = difflib.SequenceMatcher(None, _norm(src), _norm(l)).ratio()
                if r > best_r:
                    best, best_r = i, r
        found.append({"ref": ref, "l": best if best_r >= 0.5 or not src else tag_line,
                      "ok": bool(src) and best_r >= 0.5})
    return found


# ---------------------------------------------------------------------------
# Kāvya format
# ---------------------------------------------------------------------------

def is_sarga_heading(b):
    if len(b) != 1:
        return None
    t = b[0].strip().strip("॥। ").strip()
    return t if len(t) < 60 and SARGA_RE.match(t) else None


def is_sarga_colophon(joined):
    j = re.sub(r"^[\s॥।]+", "", joined)
    if not j.startswith("इत") or len(j) < 40:          # इति / इत्य…
        return False
    # "… सर्गव्याख्या समाप्ता॥३॥" (ṭīkā) or "… नाम प्रथमः सर्गः ॥" (mūla)
    return "सर्गव्याख्या" in j or (bool(re.search(r"सर्गः\s*[।॥\s]*$", j)) and not NUM_RE.search(j))


def parse_kavya(text, cfg):
    text = clean_text(text)
    st = samasya_tools(cfg)
    lines = text.split("\n")
    appendix = {}
    if st and st["cfg"].get("appendix_start"):
        cut = next((i for i, l in enumerate(lines) if l.strip().startswith(st["cfg"]["appendix_start"])), None)
        if cut is not None:
            appendix = parse_samasya_appendix(lines[cut:], st)
            lines = lines[:cut]
    blocks = blocks_of(lines)

    sargas, prasasti = [], None
    cur_sarga = None
    cur_verse = None
    expect = 1
    pending = []           # half-verse lines split off by a page break
    note_mode = False
    mula_only = not cfg.get("commentary")

    KULAKA_RE = re.compile(r"^\[?\s*(\S+?)ः?\s+(कुलकम्|कलापकम्|विशेषकम्)\s*\]?$")
    COUNT_WORD = {"द्वाभ्यां": 2, "त्रिभि": 3, "चतुर्भि": 4, "पञ्चभि": 5, "षड्भि": 6,
                  "सप्तभि": 7, "अष्टभि": 8, "नवभि": 9, "दशभि": 10}

    def next_number(j):
        while j < len(blocks) and is_divider(blocks[j]):
            j += 1
        if j >= len(blocks):
            return None
        nb = strip_samasya(blocks[j], st)[0] if st else blocks[j]
        nb = [l for l in nb if l.strip()]
        if not nb:
            return None
        nn, _ = numbered(nb)
        if nn is None:
            lm = LOOSE_NUM_RE.search(nb[-1])
            nn = devnum(lm.group(1)) if lm else None
        return nn

    def new_comm_target():
        if cur_verse is not None:
            return cur_verse["tika"]
        return cur_sarga["intro"]

    def add_comm(blk, kind=None):
        tgt = new_comm_target()
        lines_ = [l.strip() for l in blk]
        if kind is None:
            kind = "v" if len(blk) >= 2 and verse_like(blk) else "p"
        if not _deva_re.search("".join(lines_)):
            kind = "note"            # the encoder's English remarks
        body = "\n".join(lines_) if kind == "v" else " ".join(lines_)
        # rejoin a paragraph broken mid-sentence by a page break
        if kind == "p" and tgt and tgt[-1]["t"] == "p" and not ends_sentence(tgt[-1]["deva"]) \
                and not blk[0][:1].isspace():
            tgt[-1]["deva"] += " " + body
            return
        tgt.append({"t": kind, "deva": body})

    i = 0
    while i < len(blocks):
        b = blocks[i]
        refs, variants = [], []
        if st and cur_sarga is not None:
            b, refs, variants = strip_samasya(b, st)
            b = [l for l in b if l.strip()] or blocks[i]
        joined = "\n".join(b).strip()

        head = is_sarga_heading(b)
        if head:
            cur_sarga = {"num": len(sargas) + 1, "heading": head, "intro": [],
                         "verses": [], "colophon": None}
            sargas.append(cur_sarga)
            cur_verse, expect, pending = None, 1, []
            i += 1
            continue
        if cur_sarga is None:
            i += 1
            continue
        if PRASASTI_RE.search(joined) and len(joined) < 60:
            prasasti = {"heading": "प्रशस्तिः", "verses": [], "colophon": []}
            i += 1
            while i < len(blocks):
                pb = [l for l in blocks[i] if not DIVIDER_RE.match(l)]
                if pb:
                    n, m = numbered(pb)
                    body = "\n".join(l.strip() for l in pb)
                    if n is not None or (verse_like(pb) and len(pb) >= 2):
                        if n is not None:
                            body = "\n".join(l.strip() for l in pb[:-1] + [pb[-1][:m.start()]]).strip()
                        prasasti["verses"].append({"num": n, "deva": body})
                    else:
                        prasasti["colophon"].append(body)
                i += 1
            break

        if is_divider(b):
            # a short indented block fenced by two dividers is an editor's note
            if i + 2 < len(blocks) and is_divider(blocks[i + 2]) and numbered(blocks[i + 1])[0] is None:
                note_mode = True
            i += 1
            continue
        if note_mode:
            new_comm_target().append({"t": "note", "deva": joined})
            note_mode = False
            i += 1
            continue

        if is_sarga_colophon(joined):
            cur_sarga["colophon"] = " ".join(l.strip() for l in b).strip("॥ ")
            i += 1
            continue

        km = KULAKA_RE.match(joined) if len(b) == 1 else None
        if km and km.group(1) in COUNT_WORD:
            # printed after the run it closes, like "युग्मम्" after a pair
            size = COUNT_WORD[km.group(1)]
            if cur_verse is not None:
                cur_verse["group"] = {"label": joined.strip("[] "),
                                      "from": max(1, cur_verse["num"] - size + 1), "to": cur_verse["num"]}
            i += 1
            continue

        n, m = numbered(b)
        irregular = None
        if mula_only:
            # a mūla-only edition: tolerate numbering slips instead of demoting verses
            if n is None:
                lm = LOOSE_NUM_RE.search(b[-1])
                if lm:
                    n, m = devnum(lm.group(1)), lm
                    irregular = "Verse number printed without its closing daṇḍa"
            if n is not None and expect < n <= expect + 3:
                if next_number(i + 1) == n:
                    # the same number printed twice: this one is the missing verse
                    irregular = f"Printed as ॥{to_devnum(n)}॥ (the number is repeated in the source)"
                    n = expect
                else:
                    irregular = f"Numbering jumps from {expect - 1} to {n} in the source"
                    expect = n
            if n is None and verse_like(b) and 3 <= len(b) <= 5 and not RUBRIC_RE.match(b[0].strip()):
                n, m = expect, re.search(r"$", b[-1])
                irregular = "No verse number printed in the source"
        # an in-text section rubric ("॥इत्यष्टाविंशतिश्लोकैः …॥") printed atop a verse
        rubric = None
        if n == expect and len(b) > 2 and RUBRIC_RE.match(b[0].strip()):
            rubric, b = b[0].strip().strip("॥"), b[1:]
            refs = [(li - 1, r) for li, r in refs]
        elif n is None and len(b) == 1 and RUBRIC_RE.match(joined):
            label = joined.strip("॥ ")
            g = GROUP_RE.fullmatch(label)
            if cur_verse is not None and g:
                size = 4 if label.startswith("चतुर्भिः") else GROUP_SIZE.get(label, 2)
                cur_verse["group"] = {"label": label, "from": max(1, cur_verse["num"] - size + 1),
                                      "to": cur_verse["num"]}
            elif cur_verse is not None:
                cur_verse["rubric"] = label
            i += 1
            continue
        if n == expect and verse_like(b):
            tail = b[-1][m.end():].strip()
            body_lines = [l.strip() for l in b[:-1]] + [b[-1][:m.start()].strip()]
            shift = len(pending)
            all_lines = pending + body_lines
            body = "\n".join(all_lines)
            v = {"num": n, "deva": body + "॥" + to_devnum(n) + "॥", "tika": []}
            if st:
                v["sam"] = locate_samasya(all_lines, [(li + shift, r) for li, r in refs], appendix)
                v["var"] = variants
            if irregular:
                v.setdefault("var", []).append(irregular)

            pending = []
            g = GROUP_RE.search(tail)
            if g:
                size = GROUP_SIZE.get(re.sub(r"^चतुर्भिः\s*", "", g.group(1)), 2)
                if g.group(1).startswith("चतुर्भिः"):
                    size = 4
                v["group"] = {"label": g.group(1), "from": max(1, n - size + 1), "to": n}
            if rubric:
                # the rubric closes the preceding run of verses
                if cur_verse is not None:
                    cur_verse["rubric"] = rubric
                else:
                    v["rubric"] = rubric
            cur_sarga["verses"].append(v)
            cur_verse = v
            expect += 1
            i += 1
            continue

        # a verse-like, unnumbered, unindented block that the next real verse
        # completes (page-break split) is held and prepended to it
        if n is None and verse_like(b) and not b[0][:1].isspace() and len(b) <= 3:
            j = i + 1
            while j < len(blocks) and (is_divider(blocks[j]) or
                                       (j > 0 and is_divider(blocks[j - 1]) and j + 1 < len(blocks)
                                        and is_divider(blocks[j + 1]))):
                j += 1
            if j < len(blocks):
                nb = strip_samasya(blocks[j], st)[0] if st else blocks[j]
                nj, _ = numbered(nb)
                if nj == expect and verse_like(nb) and len(b) + len(nb) <= 4:
                    pending = [l.strip() for l in b]
                    i += 1
                    continue

        add_comm(b)
        i += 1

    return sargas, prasasti, appendix


# ---------------------------------------------------------------------------
# Sūtra format (sūtra + vṛtti, e.g. Dharmabindu)
# ---------------------------------------------------------------------------

COMM_START_RE = re.compile(r"^\s*इति\s*[।॥]")                 # "इति॥ …" opens the vṛtti
UNIT_HEAD_RE = re.compile(r"^\S+ोऽध्यायः\s*[।॥]*$")
UNIT_COLOPHON_RE = re.compile(r"^\s*इति\s+श्री.*ध्यायः")      # …प्रथमोऽध्यायः (avagraha)
LEAD_END_RE = re.compile(r"(आह|यति|ते|तथा|यथा|च|सूत्रम्|सूत्रद्वयम्)\s*[।॥]\s*$")
TRAIL_OK_RE = re.compile(r"^[\s॥।०-९]*$")


def parse_topics(lines, cfg):
    """Per-unit topic lists from the edition's contents (no page/sūtra numbers)."""
    tc = cfg.get("contents")
    if not tc:
        return []
    try:
        a = next(i for i, l in enumerate(lines) if l.strip() == tc["start"])
        b = next(i for i, l in enumerate(lines) if i > a and l.strip() == tc["end"])
    except StopIteration:
        return []
    units, skip = [], set(tc.get("skip", []))
    for l in lines[a + 1:b]:
        t = l.strip().rstrip(" .")
        if not t or not _deva_re.search(t) or t in skip:
            continue
        if UNIT_HEAD_RE.match(t):
            units.append([])
            continue
        if units:
            sub = len(l.replace("\t", "")) - len(l.replace("\t", "").lstrip(" ")) > 0
            units[-1].append({"t": t, "sub": sub})
    return units


ORDINALS = "प्रथम|द्वितीय|तृतीय|चतुर्थ|पञ्चम|षष्ठ|सप्तम|अष्टम|नवम|दशम"
COLOPHON_END_RE = re.compile(r"ध्यायः[^॥]*॥(\s*[०-९]+\s*॥)?")


def split_colophon(text):
    """'इति … प्रथमोऽध्यायः॥ १॥ द्वितीयो ऽध्यायः।' → (colophon, remainder)."""
    m = COLOPHON_END_RE.search(text)
    if not m:
        return text.strip(), ""
    return text[:m.end()].strip(), text[m.end():].strip()


def unit_name_from_colophon(c):
    m = re.search(r"(?:वृत्तौ|विवृत्तौ)\s+(.+?)\s*(" + ORDINALS + r")ो\s*ऽ?ध्यायः", c)
    if not m:
        return None
    name = m.group(1).strip()
    # sandhi before the ordinal: विधिस्तृतीयो / विधिश्चतुर्थो / विधिरष्टमो → विधिः
    name = re.sub(r"(स्|श्|र्)$", "ः", name)
    return name or None


def parse_sutra(text, cfg):
    text = clean_text(text).replace("||", "॥")          # OCR's ASCII daṇḍas
    lines = text.split("\n")
    start = cfg.get("body_start")
    if start:
        k = next((i for i, l in enumerate(lines) if l.strip() == start), None)
        if k is not None:
            lines = lines[k + 1:]
    blocks = []
    for blk in blocks_of(lines):
        # drop printed rules and bare "प्रथमोऽध्यायः।" headings inside blocks
        blk = [l for l in blk if not DIVIDER_RE.match(l) and not UNIT_HEAD_RE.match(l.strip())]
        if not blk:
            continue
        # "सूत्रम्॥३२॥" and its "   इति॥ …" often share a block: split before the vṛtti
        cur_b = []
        for l in blk:
            if cur_b and COMM_START_RE.match(l):
                blocks.append(cur_b)
                cur_b = []
            cur_b.append(l)
        blocks.append(cur_b)
    names = {int(k): v for k, v in (cfg.get("unit_names") or {}).items()}
    first_sutra = cfg.get("first_sutra")
    seen_first = not first_sutra

    units, closing = [], None
    cur, item = None, None
    expect = 1

    def open_unit():
        nonlocal cur, item, expect
        cur = {"num": len(units) + 1, "heading": None, "intro": [], "verses": [], "colophon": None}
        units.append(cur)
        item, expect = None, 1

    def target():
        return item["tika"] if item is not None else cur["intro"]

    def add_comm(blk):
        tgt = target()
        ls = [l.strip() for l in blk]
        kind = "v" if len(blk) >= 2 and verse_like(blk) and not COMM_START_RE.match(blk[0]) else "p"
        body = "\n".join(ls) if kind == "v" else " ".join(ls)
        if kind == "p" and tgt and tgt[-1]["t"] == "p" and not ends_sentence(tgt[-1]["deva"]) \
                and not blk[0][:1].isspace() and not COMM_START_RE.match(body):
            tgt[-1]["deva"] += " " + body
            return
        tgt.append({"t": kind, "deva": body})

    def next_block_opens_comm(j):
        while j < len(blocks) and is_divider(blocks[j]):
            j += 1
        return j < len(blocks) and bool(COMM_START_RE.match(blocks[j][0]))

    def take_leads():
        """Short lead-in sentences ('कुत एतदित्याह ।') that introduce the next sūtra."""
        src = target()
        leads = []
        while src and src[-1]["t"] == "p" and len(src[-1]["deva"]) < 220 \
                and not COMM_START_RE.match(src[-1]["deva"]) and (len(src) > 1 or item is None):
            leads.insert(0, dict(src.pop(), t="lead"))
        return leads

    def add_item(seg_lines, printed, leads, trust_jump=False):
        nonlocal item, expect
        seg_lines = [l.strip() for l in seg_lines if l.strip()]
        # lead-in lines printed directly above the sūtra, in the same block
        while len(seg_lines) > 1 and LEAD_END_RE.search(seg_lines[0]) and len(seg_lines[0]) < 120:
            leads.append({"t": "lead", "deva": seg_lines.pop(0)})
        if printed is None:
            num = expect
        elif expect <= printed <= expect + 2 or (trust_jump and expect < printed <= expect + 10):
            num = printed
        else:
            num = expect
        body = "\n".join(seg_lines)
        kind = "v" if len(seg_lines) >= 2 and verse_like(seg_lines) else "s"
        notes = []
        if printed is None:
            notes.append("No sūtra number printed in the edition")
        elif printed != num:
            notes.append(f"Printed as ॥{to_devnum(printed)}॥ in the edition")
        elif num > expect:
            notes.append(f"Numbering jumps from {expect - 1} to {num} in the edition")
        it = {"num": num, "deva": body + "॥" + to_devnum(num) + "॥", "tika": leads, "kind": kind, "var": notes}
        cur["verses"].append(it)
        item = it
        expect = num + 1

    def sutra_candidate(text_b, j_next):
        """Number matches that make this block one or more sūtras, or None."""
        ms = list(NUM_RE.finditer(text_b))
        if not ms or not TRAIL_OK_RE.match(text_b[ms[-1].end():]):
            return None
        last = devnum(ms[-1].group(1))
        opens = next_block_opens_comm(j_next)
        seg_lines = [l for l in text_b.split("\n") if l.strip()]
        if len(seg_lines) >= 2 and verse_like(seg_lines) and not opens \
                and devnum(ms[0].group(1)) != expect:
            return None                             # a verse quoted inside the vṛtti
        if expect <= last <= expect + len(ms) + 1:
            return [mm for mm in ms if devnum(mm.group(1)) >= expect]
        if last < expect - 3 and last <= 3:
            return None                             # a quoted verse's own "॥ १ ॥"
        if opens:
            return [ms[-1]]                         # a jump or a printed-number slip
        return None

    def unnumbered_sutra(blk, j_next):
        """A sūtra printed without a number: a single prose line closed by ॥,
        possibly under its lead-in, immediately followed by the vṛtti ("इति॥")."""
        body = [l for l in blk if l.strip()]
        while len(body) > 1 and LEAD_END_RE.search(body[0]):
            body = body[1:]
        shape_ok = len(body) == 1 or (len(body) == 2 and verse_like(body))     # prose, or a kārikā
        return shape_ok and bool(re.search(r"॥\s*$", body[-1])) and not NUM_RE.search("\n".join(body)) \
            and next_block_opens_comm(j_next)

    open_unit()
    i = 0
    while i < len(blocks):
        b = blocks[i]
        joined = "\n".join(b).strip()
        if is_divider(b):
            i += 1
            continue
        if not seen_first:
            if joined.startswith(first_sutra):
                seen_first = True
            else:
                add_comm(b)                           # the commentator's own maṅgala
                i += 1
                continue
        if UNIT_COLOPHON_RE.match(joined):
            colophon, rest = split_colophon(" ".join(l.strip() for l in b))
            cur["colophon"] = colophon
            cur["heading"] = names.get(cur["num"]) or unit_name_from_colophon(colophon)
            if len(units) >= cfg.get("units", 99):
                closing = {"heading": cfg.get("closing_heading", "उपसंहारः"), "verses": [], "colophon": []}
                tail_blocks = ([[rest]] if rest else []) + blocks[i + 1:]
                for pb in tail_blocks:
                    pb = [l for l in pb if not DIVIDER_RE.match(l)]
                    if not pb:
                        continue
                    body = "\n".join(l.strip() for l in pb)
                    if body.startswith("इति"):
                        closing["colophon"].append(body)
                    elif closing["verses"] and not NUM_RE.search(closing["verses"][-1]["deva"]) \
                            and len(closing["verses"][-1]["deva"].split("\n")) < 4 and verse_like(pb):
                        closing["verses"][-1]["deva"] += "\n" + body      # halves split by blank lines
                    else:
                        closing["verses"].append({"num": None, "deva": body})
                for v in closing["verses"]:
                    v["deva"] = re.sub(r"[।॥\s]+$", "", v["deva"].replace("-\n", "-\n")) + "॥"
                break
            open_unit()
            if rest and not UNIT_HEAD_RE.match(rest):
                cur["intro"].append({"t": "p", "deva": re.sub(r"^\S+ोऽध्यायः\s*[।॥]*\s*", "", rest)})
            i += 1
            continue
        if len(b) == 1 and UNIT_HEAD_RE.match(joined):
            i += 1                                   # "चतुर्थोऽध्यायः।" — the unit is already open
            continue

        # a verse split across blank lines: gather unnumbered verse-like halves
        if not COMM_START_RE.match(b[0]) and not b[0][:1].isspace() and NUM_RE.search(joined) is None \
                and verse_like(b) and not LEAD_END_RE.search(joined) and 18 <= len(joined) <= 80:
            j, acc = i, []
            while j < len(blocks) and not NUM_RE.search("\n".join(blocks[j])) and verse_like(blocks[j]) \
                    and not blocks[j][0][:1].isspace() and len(acc) + len(blocks[j]) <= 3 \
                    and all(re.search(r"[।,]\s*$|[^।॥\s]$", l.strip()) and "इति" not in l for l in blocks[j]) \
                    and not LEAD_END_RE.search("\n".join(blocks[j])):
                acc += blocks[j]
                j += 1
            half = [len(l.strip()) for l in acc]
            if j < len(blocks) and acc and len(blocks[j]) <= 2 \
                    and all(abs(h - len(blocks[j][-1].strip())) < 0.45 * max(h, 1) + 6 for h in half):
                nb_text = "\n".join(blocks[j])
                cand = sutra_candidate(nb_text, j + 1)
                if cand and len(cand) == 1 and verse_like(blocks[j]):
                    add_item(acc + nb_text[:cand[0].start()].split("\n"), devnum(cand[0].group(1)), take_leads())
                    i = j + 1
                    continue

        # one block may hold several consecutive sūtras ("… ॥ २॥\n … ॥३॥")
        if not COMM_START_RE.match(b[0]):
            text_b = "\n".join(b)
            cand = sutra_candidate(text_b, i + 1)
            if cand:
                pos, leads = 0, take_leads()
                opens = next_block_opens_comm(i + 1)
                for k, mm in enumerate(cand):
                    seg = text_b[pos:mm.start()]
                    pos = mm.end()
                    if seg.strip():
                        add_item(seg.split("\n"), devnum(mm.group(1)), leads if k == 0 else [], trust_jump=opens)
                i += 1
                continue
            if unnumbered_sutra(b, i + 1):
                add_item(b, None, take_leads())
                i += 1
                continue
        # a vṛtti block whose last line is the next sūtra (no blank line between)
        if COMM_START_RE.match(b[0]) and len(b) >= 2 and next_block_opens_comm(i + 1):
            last_line = b[-1].strip()
            lm = NUM_RE.search(last_line)
            if re.search(r"॥\s*([०-९]+\s*॥)?\s*$", last_line) and len(last_line) < 160:
                head_lines = b[:-1]
                lead = None
                if LEAD_END_RE.search(head_lines[-1]):
                    lead = head_lines[-1].strip()
                    head_lines = head_lines[:-1]
                if head_lines:
                    add_comm(head_lines)
                leads = [{"t": "lead", "deva": lead}] if lead else []
                if lm:
                    add_item([last_line[:lm.start()]], devnum(lm.group(1)), leads, trust_jump=True)
                else:
                    add_item([last_line], None, leads)
                i += 1
                continue
        add_comm(b)
        i += 1

    if units and not units[-1]["verses"] and not units[-1]["intro"]:
        units.pop()
    return units, closing


# ---------------------------------------------------------------------------
# Vyākhyā format (a mūla that survives only inside its commentary, e.g. the
# Dvādaśāranayacakra embedded in Siṃhasūri's Nyāyāgamānusāriṇī)
# ---------------------------------------------------------------------------

RULE_RE = re.compile(r"^\s*[—–\-_]{8,}\s*$")
DEVA_ONLY_RE = re.compile(r"[^ऀ-ॣॱ-ॿ]")
# a gloss opens by quoting its passage: "द्रव्यार्थपर्यायार्थेत्यादि," / "(तदिति)" / "अथोच्येतेति,"
PRATIKA_RE = re.compile(r"^\(?\s*([^\s,।()]{2,}?(?:\s[^\s,।()]+){0,4}?)\s*"
                        r"(?:इत्यादि|त्यादि|इति|ेति|ीति|ूति)\s*[,)।]")
SECTION_RE = re.compile(r"^अथ\s+\S+(?:\s+\S+)?\s*$")          # "अथ नियतिवादः"


def _pratika_of(para):
    m = PRATIKA_RE.match(para)
    return DEVA_ONLY_RE.sub("", m.group(1)) if m else None


def _quotes(gloss, passage, min_len=2):
    """Does `gloss` open by quoting the beginning of `passage`?"""
    x = _pratika_of(gloss)
    if not x or len(x) < min_len:
        return False
    k = max(3, len(x) - 2)
    return DEVA_ONLY_RE.sub("", passage)[:k] == x[:k]


def volume_paragraphs(text, start, stop_after):
    """Paragraphs of one volume's body: blank lines and printed rules separate them."""
    lines = clean_text(text).split("\n")
    a = next(i for i, l in enumerate(lines) if l.strip() == start and not l.startswith("\t\t"))
    paras, cur = [], []
    for l in lines[a:]:
        if not l.strip() or RULE_RE.match(l):
            if cur:
                paras.append(cur)
                cur = []
            continue
        cur.append(l.rstrip())
    if cur:
        paras.append(cur)
    return paras


def parse_vyakhya(section_dir, cfg):
    close_re = re.compile(cfg["unit_close"])        # the notes-writer's colophon closes an ara
    names = {int(k): v for k, v in (cfg.get("unit_names") or {}).items()}
    comm_colophon_re = re.compile(cfg.get("comm_colophon", r"$^"))
    units, cur = [], None

    def open_unit():
        nonlocal cur
        cur = {"num": len(units) + 1, "heading": names.get(len(units) + 1), "intro": [], "verses": [],
               "colophon": None, "_paras": []}
        units.append(cur)

    for vol in cfg["volumes"]:
        text = (section_dir / "sources" / vol["file"]).read_text(encoding="utf-8")
        paras = volume_paragraphs(text, vol["body_start"], None)
        if cur is None or cur["_paras"]:
            open_unit()
        opened_by_close, finished = None, False
        i = 0
        while i < len(paras):
            blk = paras[i]
            joined = " ".join(l.strip() for l in blk)
            if close_re.search(joined):
                # the colophon may run on into the next paragraph ("… द्वितीयो विधिविध्यरः समाप्तः॥")
                col = joined
                if not re.search(r"(समाप्तः|रः)\s*[।॥]*\s*$", joined) and i + 1 < len(paras):
                    i += 1
                    col += " " + " ".join(l.strip() for l in paras[i])
                cur["_colophons"] = cur.get("_colophons", []) + [col]
                if len(units) < cfg.get("units", 99):
                    open_unit()
                    opened_by_close = cur
                else:
                    finished, opened_by_close = True, None   # the last ara is closed: the rest is back matter
                i += 1
                continue
            if not finished:
                cur["_paras"].append(blk)
            i += 1
        # each volume ends an ara: anything after its last colophon (booklists, adverts) is dropped
        if opened_by_close is cur:
            cur["_paras"] = []
    if units and not units[-1]["_paras"]:
        units.pop()

    for u in units:
        paras = [" ".join(l.strip() for l in b) if not (len(b) >= 2 and verse_like(b)) else "\n".join(l.strip() for l in b)
                 for b in u.pop("_paras")]
        # the ara's own heading / colophon lines are not text
        skip = set()
        for k, p in enumerate(paras[:4]):
            if len(p) < 40 and re.search(r"(रः|नयः|भयम्)\s*[।॥]?\s*$", p):
                skip.add(k)
        is_mula = [False] * len(paras)
        for k in range(len(paras)):
            if k in skip or _pratika_of(paras[k]) is not None:
                continue
            # the gloss usually follows at once; a notes paragraph or two may sit in
            # between, so further away a longer pratīka is required
            for j in range(k + 1, min(k + 5, len(paras))):
                if _quotes(paras[j], paras[k], 2 if j == k + 1 else 5):
                    is_mula[k] = True
                    break
        item, pending_head = None, None
        for k, p in enumerate(paras):
            if k in skip:
                continue
            if comm_colophon_re.search(p):
                u["colophon_comm"] = p
                continue
            if SECTION_RE.match(p) and len(p) < 40:
                pending_head = p
                continue
            if is_mula[k]:
                lines_ = p.split("\n")
                item = {"num": len(u["verses"]) + 1, "deva": p.rstrip("।॥ ,") + "॥", "tika": [],
                        "kind": "v" if len(lines_) >= 2 and verse_like(lines_) else "s"}
                if pending_head:
                    item["head"], pending_head = pending_head, None
                u["verses"].append(item)
                continue
            tgt = item["tika"] if item else u["intro"]
            if pending_head:
                tgt.append({"t": "h", "deva": pending_head})
                pending_head = None
            tgt.append({"t": "v" if "\n" in p else "p", "deva": p})
        cols = ([u["colophon_comm"]] if u.get("colophon_comm") else []) + u.pop("_colophons", [])
        u.pop("colophon_comm", None)
        u["colophon"] = " — ".join(cols) if cols else None
    return units, None


def vyakhya_frontmatter(section_dir, cfg):
    items = []
    for part in (cfg.get("frontmatter") or {}).get("parts", []):
        vol = next(v for v in cfg["volumes"] if v["file"] == part["file"])
        lines = clean_text((section_dir / "sources" / vol["file"]).read_text(encoding="utf-8")).split("\n")
        got = parse_frontmatter(lines, part)
        if got:
            items.append({"t": "h", "text": part.get("heading", "")})
            items += [it for it in got if not (it["t"] == "h" and it["text"] == part.get("start"))]
    return items


# ---------------------------------------------------------------------------
# Edition-JSON format (a work already structured as JSON: chapters → sections
# with a sūtra and layered commentaries, e.g. the Kāvyānuśāsana with
# Alaṅkāracūḍāmaṇi + Viveka, ṭippaṇa notes and a chāyā appendix)
# ---------------------------------------------------------------------------

import html as _html


def html_to_text(h):
    h = re.sub(r"<br\s*/?>", "\n", h or "")
    h = re.sub(r"<[^>]+>", "", h)
    return "\n".join(l.strip() for l in _html.unescape(h).split("\n")).strip()


def parse_edition_json(section_dir, cfg):
    src = json.loads((section_dir / "sources" / cfg["json"]).read_text(encoding="utf-8"))
    layers = cfg.get("layers") or ["vritti", "viveka"]
    tips = {}
    for a in src.get("appendices") or []:
        for n in a.get("notes") or []:
            tips[n["id"]] = n
    TYPE = {"prose": "p", "lead": "lead", "example": "v", "verse": "v", "quote": "v",
            "citation": "v", "source": "src", "note": "note"}

    def block_item(b, layer):
        text = html_to_text(b.get("html")) or b.get("text", "")
        kind = TYPE.get(b.get("type"), "p")
        if kind == "v" and "\n" not in text and len(text) > 160:
            kind = "p"                                   # a long prose citation
        it = {"t": kind, "deva": text, "l": layer, "pg": b.get("page")}
        if b.get("type") == "example" and b.get("num"):
            it["n"] = b["num"]
        if b.get("chaya"):
            it["chaya"] = b["chaya"]
        tl = []
        for tid in b.get("tippana") or []:
            n = tips.get(tid)
            if n:
                tl.append(f"{n.get('lemma', '').strip()} {n.get('gloss', '').strip()}".strip())
        if tl:
            it["tips"] = tl
        return it

    units = []
    for ch in src["chapters"]:
        u = {"num": ch["n"], "heading": ch.get("topic") or ch.get("title"), "intro": [], "verses": [],
             "colophon": " — ".join(html_to_text(c.get("html")) or c.get("text", "") for c in ch.get("colophons") or []) or None,
             "topic_en": ch.get("topic_en")}
        for sec in ch["sections"]:
            comm = [block_item(b, L) for L in layers for b in (sec.get(L) or [])]
            s = sec.get("sutra")
            if not s:
                (u["verses"][-1]["tika"] if u["verses"] else u["intro"]).extend(comm)
                continue
            text = html_to_text(s.get("html")) or s.get("text", "")
            lines = text.split("\n")
            u["verses"].append({"num": int(s["n"]), "deva": text.rstrip("।॥ ") + "॥" + to_devnum(int(s["n"])) + "॥",
                                "tika": comm, "kind": "v" if len(lines) >= 2 and verse_like(lines) else "s",
                                "pg": s.get("page"), "gnum": s.get("g"), "sid": sec.get("id")})
        units.append(u)
    front = []
    for f in src.get("front") or []:
        front.append({"t": "h", "text": f.get("title", "")})
        for b in f.get("blocks") or []:
            t = html_to_text(b.get("html")) or b.get("text", "")
            if t:
                front.append({"t": "h" if b.get("type") in ("heading", "h") else "p", "text": t})
    return units, None, front


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

def comm_item(it):
    out = {k: v for k, v in it.items() if v not in (None, "", [])}
    out["iast"] = tr(it["deva"], "IAST")
    if it.get("chaya"):
        out["chaya_iast"] = tr(it["chaya"], "IAST")
    if it.get("tips"):
        out["tips_iast"] = [tr(t, "IAST") for t in it["tips"]]
    return out


def label(cfg, key, deva, iast):
    u = cfg.get(key) or {}
    return {"deva": u.get("deva", deva), "iast": u.get("iast", iast), "plural": u.get("plural")}


def build(section_dir, slug_yml):
    cfg = yaml.safe_load(slug_yml.read_text(encoding="utf-8"))
    slug = cfg["slug"]
    fmt = cfg.get("format", "kavya")
    appendix, topics = {}, []
    if fmt == "vyakhya":
        sargas, prasasti = parse_vyakhya(section_dir, cfg)
        front = vyakhya_frontmatter(section_dir, cfg)
    elif fmt == "json":
        sargas, prasasti, front = parse_edition_json(section_dir, cfg)
    else:
        raw = (section_dir / "sources" / f"{slug}.txt").read_text(encoding="utf-8")
        if fmt == "sutra":
            sargas, prasasti = parse_sutra(raw, cfg)
        else:
            sargas, prasasti, appendix = parse_kavya(raw, cfg)
        raw_lines = clean_text(raw).split("\n")
        front = parse_frontmatter(raw_lines, cfg.get("frontmatter"))
        topics = parse_topics(raw_lines, cfg)

    out_dir = section_dir / "data" / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("tika-*.json"):
        old.unlink()

    sarga_index = []
    used = {}                       # samasyā ref -> ["s.v", …]
    has_comm = bool(cfg.get("commentary"))
    for s in sargas:
        verses_out, metres = [], Counter()
        for v in s["verses"]:
            is_prose = v.get("kind") == "s"
            metre = None if is_prose else identify_metre(v["deva"])
            if metre:
                metres[metre] += 1
            vo = {"n": v["num"], "t": sf(v["deva"]), "m": metre}
            if v.get("kind"):
                vo["k"] = v["kind"]
            if v.get("group"):
                vo["g"] = v["group"]
            if v.get("rubric"):
                vo["r"] = sf(v["rubric"])
            if v.get("head"):
                vo["h"] = sf(v["head"])          # section heading printed before this passage
            if v.get("pg"):
                vo["pg"] = v["pg"]               # page of the printed edition
            if v.get("sid"):
                vo["sid"] = v["sid"]             # the work's own section id (for its dedicated app)
            if v.get("sam"):
                vo["sam"] = v["sam"]
                for sm in v["sam"]:
                    used.setdefault(sm["ref"], []).append(f"{s['num']}.{v['num']}")
            if v.get("var"):
                vo["var"] = v["var"]
            if not has_comm and v["tika"]:
                # a mūla-only edition: stray blocks are the encoder's notes, shown with the verse
                vo["notes"] = [it["deva"] for it in v["tika"]]
                v["tika"] = []
            if v["tika"]:
                vo["c"] = 1          # has commentary
            verses_out.append(vo)
        idx = {
            "num": s["num"],
            "heading": sf(s["heading"]) if s["heading"] else None,
            "subtitle": s.get("topic_en"),
            "count": len(s["verses"]),
            "metres": metres.most_common(),
            "colophon": sf(s["colophon"], ("iast",)) if s["colophon"] else None,
            "verses": verses_out,
        }
        if topics and s["num"] <= len(topics):
            idx["topics"] = [{"t": sf(t["t"]), "sub": t["sub"]} for t in topics[s["num"] - 1]]
        sarga_index.append(idx)
        tika = {"sarga": s["num"],
                "intro": [comm_item(it) for it in s["intro"]],
                "verses": {}}
        for v in s["verses"]:
            if v["tika"]:
                tika["verses"][str(v["num"])] = [comm_item(it) for it in v["tika"]]
        if any(s["verses"]) and (tika["intro"] or tika["verses"]):
            (out_dir / f"tika-{s['num']}.json").write_text(
                json.dumps(tika, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        tik_words = sum(len(it["deva"].split()) for v in s["verses"] for it in v["tika"])
        extra = ""
        if fmt == "kavya" and cfg.get("samasya"):
            extra = f", samasyā lines located {sum(1 for v in s['verses'] for x in v.get('sam', []) if x['ok'])}"
        print(f"  unit {s['num']:>2}: {len(s['verses']):>3} items, "
              f"{sum(metres.values()):>3} metres identified, commentary {tik_words} words{extra}"
              + (f"  [{s['heading']}]" if fmt == "sutra" else ""))

    all_metres = Counter()
    for s in sarga_index:
        for name, c in s["metres"]:
            all_metres[name] += c

    comm = []
    for c in cfg.get("commentary", []) or []:
        comm.append({"label": c.get("label", "tika"), "name": sf((c.get("name") or {}).get("deva")),
                     "short": c.get("short"),
                     "author": sf((c.get("author") or {}).get("deva")), "note": c.get("note")})

    author = cfg.get("author") or {}
    meta = {
        "slug": slug,
        "accession": cfg.get("accession"),
        "format": fmt,
        "title": sf(cfg["title"]["deva"]),
        "short_title": sf((cfg.get("short_title") or cfg["title"])["deva"]),
        "display_title": cfg.get("display_title"),
        "app": cfg.get("app"),                  # a dedicated reader, used instead of the shared one
        "author": {"name": sf(author.get("deva")), "note": author.get("note"),
                   "period": author.get("period"), "sect": author.get("sect"),
                   "role": author.get("role")},
        "commentary": comm,
        "language": cfg.get("language", ["sanskrit"]),
        "genre": cfg.get("genre", "kavya"),
        "tags": cfg.get("tags") or [],
        "unit": label(cfg, "unit", "सर्ग", "sarga"),
        "item": label(cfg, "item", "श्लोक", "verse"),
        "edition": cfg.get("edition") or {},
        "blurb": cfg.get("blurb"),
        "about": cfg.get("about") or [],
        "metre_names": {k: {"iast": k, "deva": METRE_DEVA.get(k, "")} for k in all_metres},
        "metres": all_metres.most_common(),
        "verse_count": sum(s["count"] for s in sarga_index),
    }
    fm_cfg = cfg.get("frontmatter") or {}
    mula = dict(meta,
                frontmatter={"label": fm_cfg.get("label"), "lang": fm_cfg.get("lang"),
                             "note": fm_cfg.get("note"), "items": front},
                sargas=sarga_index,
                prasasti=None if not prasasti else {
                    "heading": sf(prasasti["heading"]),
                    "note": cfg.get("closing_note"),
                    "verses": [{"n": v["num"], "t": sf(v["deva"])} for v in prasasti["verses"]],
                    "colophon": [sf(c) for c in prasasti["colophon"]],
                })
    if appendix:
        sc = cfg["samasya"]
        by_verse = {}
        for ref, text in appendix.items():
            m = re.match(r"(\d+)([a-d])", ref)
            if sc.get("verses") and int(m.group(1)) > sc["verses"]:
                print(f"  ! ignoring out-of-range source ref {ref}")
                continue
            by_verse.setdefault(int(m.group(1)), {})[m.group(2)] = {"t": sf(text), "used": used.get(ref, [])}
        mula["samasya"] = {
            "name": sf(sc["name"]["deva"]), "author": sc.get("author"), "tag": sc.get("tag"),
            "note": sc.get("note"),
            "verses": [{"n": n, "lines": [dict(p=p, **by_verse[n][p]) for p in "abcd" if p in by_verse[n]]}
                       for n in sorted(by_verse)],
        }
    (out_dir / "mula.json").write_text(
        json.dumps(mula, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    entry = dict(meta, sarga_count=len(sarga_index),
                 sarga_counts=[s["count"] for s in sarga_index],
                 has_commentary=bool(comm))
    identified = sum(all_metres.values())
    print(f"  built {slug}: {len(sarga_index)} units, {entry['verse_count']} items, "
          f"metre identified for {identified}"
          + (f", {len(appendix)} source lines in the samasyā appendix" if appendix else ""))
    return entry


def main():
    wanted = sys.argv[1:] or SECTIONS
    for sec in wanted:
        section_dir = ROOT / sec
        srcs = sorted((section_dir / "sources").glob("*.yml"))
        print(f"[{sec}]")
        (section_dir / "data").mkdir(exist_ok=True)
        catalog = [build(section_dir, p) for p in srcs]
        catalog.sort(key=lambda c: (c.get("accession") or "zzz", c["slug"]))
        (section_dir / "data" / "catalog.json").write_text(
            json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"Done: {len(catalog)} work(s) -> {sec}/data/\n")


if __name__ == "__main__":
    main()
