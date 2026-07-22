# Jaina Literature Portal — text-first build pipeline

A lightweight, static, data-driven home for digitized Jain Sanskrit, Prakrit and
Apabhraṃśa texts. Hosted on GitHub Pages — **no server, no Jekyll**. Texts are
authored once as plain-text source; a Python build step pre-bakes every script
(Devanagari, IAST, ISO-15919, Harvard-Kyoto, SLP1) and emits the JSON the site renders.

> Live at **https://svyoma.github.io/jaina-literature/**

## Why this structure

The old portal hand-coded each text as two duplicated `misc-works/*.html` blocks
(one per script), which caused HTML-entity corruption (`&ntilde;`, `&rsquo;`),
Devanagari-only gaps, and drift against `blogs/` copies. Now:

- **One source of truth per text** — you type only Devanagari; every other script
  is *generated*, so IAST corruption and missing-script gaps are impossible.
- **One renderer** (`text.html` + `jl.js`) for all texts — consistent layout,
  4-script switching, an interlinear **Compare** view, per-verse permalinks
  (`text?slug=<slug>#v17`), and BibTeX citation export.

## Pipeline

```
texts/<slug>.txt   →   build.py   →   data/texts/<slug>.json   (full text, all scripts)
(hand-authored)        (Aksharamukha)  data/catalog.json        (lightweight catalogue)
                                        data/verses-flat.json    (search corpus)
```

### Build

```bash
pip install -r build_requirements.txt   # aksharamukha, pyyaml
python build.py
```

Commit the regenerated `data/` output alongside the source.

## Authoring a text — `texts/<slug>.txt`

YAML frontmatter (metadata) + a marker-line body (verses). You only ever type
Devanagari; IAST/ISO/HK/SLP1 are derived at build time.

```
---
slug: my_text
accession: JLP-008          # optional catalogue number
title:
  deva: मूलशीर्षकम्           # Devanagari only; iast/iso/hk/slp1 are derived
author:
  name:
    deva: कर्तृनाम
  note: "Disciple of X"     # optional descriptive note
  period: 12th century CE
  sect: Śvetāmbara
language: [prakrit]         # sanskrit | prakrit | apabhramsha | sauraseni ...
genre: stotra               # stotra | sutra | kavya | caritra | sataka | didactic ...
sourceScript: both          # optional: provenance note (both | Devanagari …)
metre:
  - name: अनुष्टुभ्           # Devanagari (or Latin) — derived to all scripts
    verses: "1-20, 22"
    lakshana: "पञ्च..."      # optional metre definition (Devanagari)
edition:
  name: "Display name of the edition"
  publisher: "Publisher, City"
  year: 1932
  publication: "Anthology / journal name"
  editor: Editor Name
  digitized_by: Vyom A. Shah
blurb: "One-paragraph summary shown at the top of the reader and in the catalogue."
about:                      # optional longer prose (HTML allowed, e.g. <em>)
  - "Editorial / manuscript background paragraph."
overview:                   # optional structural outline (rendered as a list)
  - "Verses 1–5: …"
sections:                   # optional headings interleaved before a verse
  - before: 1
    heading: पहला खण्ड        # Devanagari; derived to all scripts
note: "Optional standalone editorial callout."
---

@1
पहला पाद।
दूसरा पाद॥१॥
>en: Optional English translation of verse 1.

@2
अगला श्लोक॥२॥
#vrtti: Optional Devanagari commentary attached to this verse.
!apparatus: Optional textual/variant note on this verse.

@@colophon
इति समाप्तम्॥
```

Everything under a Devanagari key (`title`, `author.name`, `metre.name`,
`metre.lakshana`, `sections.heading`, verse padas, colophons) is transliterated
to `iast/iso/hk/slp1` at build time. Prose in English (`blurb`, `about`,
`overview`, `note`, `edition.*`) is kept verbatim. `@@colophon` is repeatable.

### Body markers

| Marker | Meaning |
|--------|---------|
| `@N` | begins verse *N*; following non-marker lines are Devanagari pādas |
| `>xx:` | a translation line (`xx` = ISO-639-1 code, e.g. `en`); indent continuations |
| `#label:` | a commentary block under `label` (e.g. `#vrtti:`) |
| `!apparatus:` | an apparatus / footnote entry on the current verse |
| `@@colophon` | everything after (to EOF) is colophon text |

Translations, commentary and apparatus are all **optional** — a text with only
verses is valid. Fill them in incrementally; the schema already has the slots.

## Files

```
build.py                 # parse → validate → transliterate → emit
build_requirements.txt    # aksharamukha, pyyaml
texts/                    # SOURCE OF TRUTH (hand-authored .txt, one per text)
data/                     # BUILD OUTPUT (committed): catalog.json, verses-flat.json, texts/*.json
text.html                 # generic renderer shell
jl.js                     # renderer runtime (script toggle, compare, permalinks, cite)
jl.css                    # verse / toggle / citation styles (extends assets/css/text-style.css)
index.html                # faceted catalogue + corpus search (rendered by catalog.js)
catalog.js                # catalogue renderer, facet filters, in-text verse search
data/misc-catalog.json    # hand-kept entries for texts not yet in the pipeline
misc-works/               # legacy hand-coded pages (being migrated into texts/)
```

## Catalogue & search (`index.html` + `catalog.js`)

The catalogue is no longer hand-coded — `catalog.js` renders every card from
`data/catalog.json`, merged with `data/misc-catalog.json` (the handful of texts
still living in `misc-works/`, so nothing disappears before it is migrated).

- **Faceted browse** — chip filters for language, genre and metre are built
  from the data at load time, plus a free-text title/author/blurb search. All
  filtering is diacritic-insensitive (type `sardula` or `śārdūla`).
- **Search inside texts** — a second mode lazy-loads `data/verses-flat.json`
  and searches the verse corpus itself (all scripts folded to plain ASCII),
  highlighting matches and deep-linking each hit to `text?slug=<slug>#v<N>`.

No search library is vendored — the corpus is small enough that a folded linear
scan is instant and keeps the page dependency-free.

## Validation

`build.py` rejects a source before it can be committed if it: is missing required
metadata, has an empty Devanagari verse, has duplicate verse numbers, or contains
any HTML entity (`&…;`) — a regression guard against the old paste-corruption.

## Migration status

**11 of 14 texts** are on the reconciled `texts/*.txt` → `build.py` → `text.html`
pipeline, each with all five scripts auto-derived:

- ✅ `adinatha_ramacandra` (JLP-001) · `anandaghana_siddha` (002) ·
  `jinasadharana_haribhadrasuri` (003) · `mahaviracariu_jinaprabhasuri` (004) ·
  `caturvimsatistavana_ratnasekhara` (005) · `murkhasataka_ratnasekharasuri` (006) ·
  `virajinathava_abhayadeva` (007) · `jinapati_sripura_parsvanatha` (011) ·
  `mahavira_dhanapala` (012) · `parsvacandra_mahavira` (013) ·
  `jinastuti` / Vividha Stuti Saṅgraha (014).
- ⏳ 3 remaining are **multi-work anthologies** (`jnanapancamistuti` JLP-010,
  `viranirvanastuti` 008, `virastutidvatrimsika_ratnakarasuri` 009) — they hold
  several sub-works by different authors and need an anthology/section model
  before they fit the single-text schema cleanly. They still render from their
  canonical `misc-works/*.html` pages, and are kept in the catalogue via
  `data/misc-catalog.json`.

### Legacy consolidation (done)

Superseded copies were retired into `<meta refresh>` + `rel=canonical` redirect
stubs (no link rot, SEO consolidated onto the portal):

- `blogs/<slug>.html` (7 drifted text-editions) → JL canonical URLs.
- `misc-works/<slug>.html` for the 7 migrated texts → `text?slug=<slug>`.
- `blogs.html` cards and `sitemap.xml` now point at the JL canonical URLs.

### Reconciled schema note

The earlier parallel hand-authored JSONs (`{n, deva[], iast[]}` with rich
`accession`/`blurb`/`about`/`overview`/`sections`/`extras`) were folded back into
`texts/*.txt` as the single source of truth. `build.py` now emits those rich
fields **and** derives `iast/iso/hk/slp1` for every Devanagari field (title,
author, metre + lakṣaṇa, section headings, verses, colophons). Type only
Devanagari; never hand-type a transliteration.
