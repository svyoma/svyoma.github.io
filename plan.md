# svyoma.github.io — Roadmap

A living plan for the three properties in this repo: the **main site + blog**, the
**Jaina Literature (JL) portal**, and the **SHS / Siddhahema grammar portal**.
Guiding principle throughout: **static-only (GitHub Pages), no Jekyll, a local
Python build step whose output is committed, and separation of content (data)
from presentation (template).**

Legend:  ✅ done · 🔨 in progress · ⏳ planned · 💡 prospect

---

## 0. Cross-cutting foundation

| Status | Item |
|:--:|---|
| ✅ | Dead files removed (`presentation.html`, `blogs-1.html`, `header/footer/navigation.html`, `style.js`, empty stubs) |
| ✅ | Dead `/dailyverse` links removed everywhere |
| ✅ | Duplicate analytics blocks de-duplicated |
| ✅ | `<title>` normalized to one descriptive title per page (30 pages) |
| ✅ | `robots.txt` + regenerated `sitemap.xml` (50 URLs) |
| ✅ | Internal links made extensionless (`.html` no longer required; GH Pages resolves it) |
| ✅ | Person / WebSite / ProfilePage JSON-LD on hub pages; `cv.html` rebuilt from the DOCX |
| ⏳ | **Consolidate analytics** — GA *and* Umami both load; keep one (Umami = better privacy). Update the SHS README claim of "no tracking / zero dependencies". |
| ⏳ | **Self-host / subset Font Awesome** and Google Fonts (currently CDN — render-blocking + privacy). |
| 💡 | Shared header/footer via a tiny client-side include (`fetch` a partial) or a Python "stamp" step, so nav/analytics live in ONE place instead of being pasted into every file. |
| 💡 | A single design-token stylesheet (the parchment palette is duplicated inline across pages). |

---

## 1. Main site & blog

### Content integrity
| Status | Item |
|:--:|---|
| ✅ | Broken Anekārtha card / empty `img src` fixed; oversized cover image lazy-loaded + sized |
| ✅ | Orphan posts recovered into `posts.json` (`anekartha-2`, `brhattippanika-1`, `jinastuti`…); empty/duplicate posts retired (`parsvanatha_bilhana` deleted, `brhattippanika`→`-1` redirect, `chapannayagahao` removed as a Pārśvacandra duplicate) |
| ⏳ | Compress `blogs/images/cover-images/antarikshji.png` (~1.7 MB → <200 KB) and audit other covers |
| ⏳ | Backfill the remaining `needsMetadata`/undated posts in `posts.json` (`gita-bhagavat-mbh`, etc.) |
| ⏳ | Per-post `meta description` + OpenGraph on the older posts that still lack them |
| ⏳ | JSON-LD `BlogPosting` + author on each post |

### Blog system (the real leverage)
The blog was 31 hand-copied HTML files with a hand-maintained index that drifted.
Since Jekyll is off the table, it now uses the **same data→build→render pattern
as the portals**:

| Status | Item |
|:--:|---|
| ✅ | **`blogs/posts.json`** — one record per post (slug, title, date, tags, series, excerpt, url); seeded from the curated cards + recovered orphan essays. 17 posts (text-editions relocated to JL). |
| ✅ | **Auto-rendered blog index** from `posts.json` via `blog.js` (no more hand-editing cards); dated posts newest-first. |
| ✅ | **Client-side tag filter** (chips with counts) — browsable by theme (Sanskrit, Prakrit, Stuti, scholars…). |
| ✅ | **Series classification** (`series` field): Two Tongues One Verse, Bhāṣāśleṣa, Raghuvilāsa, Anekārthī Kāvya — a "Series" filter row + per-card badge. |
| ✅ | **RSS 2.0 feed** `blogs/feed.xml` generated from `posts.json` by `blogs/build_feed.py`; autodiscovery `<link>` added. |
| ✅ | **Client-side search** over title/excerpt/tags/series (live filter box). |
| ⏳ | Backfill the remaining undated posts in `posts.json` (e.g. `gita-bhagavat-mbh`) so they enter the RSS and sort chronologically. |
| 💡 | A post "template" file + build step so a new post is *content only*, not a full HTML copy-paste. |

### UX / a11y / SEO polish
| Status | Item |
|:--:|---|
| 💡 | **Dark mode** toggle (long verse-reading sessions); the palette already has the variables. |
| 💡 | A11y pass: one `<h1>`/logical heading order, real `<a>` (not `onclick`), focus-visible states, alt text. |
| 💡 | Consistent `.woff2` + `font-display:swap`; drop shipped `.ttf`s and the `Junicode.ttf.ttf` typo file. |

### SEO goal — rank first for "vyom sanskrit"
| Status | Item |
|:--:|---|
| ✅ | Keyword-tuned titles/descriptions, Person schema with `alternateName` + `sameAs` social profiles |
| ⏳ | Get inbound links from the `sameAs` profiles (academia.edu, LinkedIn, etc.) *back* to svyoma.github.io — off-page signal matters most for a name query |
| ⏳ | Submit `sitemap.xml` in Google Search Console; verify indexing of `/cv`, `/shs`, `/jaina-literature` |
| 💡 | A short, keyword-natural bio paragraph on the homepage & `/about` ("Vyom Shah, Sanskrit & Prakrit scholar…") — already partly there |

---

## 2. Jaina Literature portal — text-first

Architecture chosen: hand-authored `texts/<slug>.txt` (YAML front-matter + marker-line
body) → `build.py` (Aksharamukha) → `data/texts/*.json` + `catalog.json` +
`verses-flat.json` → `text.html` + `jl.js` renderer. Canonical encoding = **Devanagari**;
all other scripts generated (kills entity corruption + Devanagari-only gaps by construction).

### ✅ P0 — end-to-end slice (shipped)
- `build.py`, schema/validation, `text.html`, `jl.js`, `jl.css`, `README.md`.
- `virajinathava_abhayadeva` migrated; 4-script toggle, Compare (interlinear) view,
  per-verse permalinks (`#v17`), BibTeX citation export — browser-verified.

### 🔨 P1 — migrate all texts
**11 texts migrated** (JLP-001..007, 011..014), incl. blog text-editions
(`jinapati_sripura_parsvanatha`, `mahavira_dhanapala`, `parsvacandra_mahavira`) and
the **Vividha Stuti Saṅgraha** anthology (`jinastuti`) — which fit the single-text
schema via `sections` (Jina-wise headings) + per-verse `apparatus` (source works).
No separate anthology model was needed.

| Status | Item |
|:--:|---|
| ✅ | Reconciled pipeline: rich hand-authored JSON folded back into `texts/*.txt`; `build.py` emits rich fields **and** derives all 5 scripts. `catalog.json` reconciled. |
| ✅ | Blog→JL extraction (`scratchpad/extract_jl.py`): Devanagari-only (avoids entity-corrupted IAST); vṛtti commentary + source apparatus preserved. `chapannayagahao` dropped (a Pārśvacandra duplicate). |
| ⏳ | Migrate the **3 remaining** `misc-works/*.html` (`jnanapancamistuti`, `viranirvanastuti`, `virastutidvatrimsika_ratnakarasuri`, JLP-008..010). `viranirvanastuti` is a genuine multi-author anthology — needs a sub-work model. |
| 💡 | Re-extract the real **Chappaṇṇaya Gāhāo** (56 gāthās) from its blog `<p>` blocks as a distinct text, if wanted. |

### ⏳ P2 — catalogue & search
| Status | Item |
|:--:|---|
| ⏳ | **Faceted `index.html`** rendered from `catalog.json` (filters: language, genre, author, metre, period, sect) — replaces the hand-coded `<article>` cards. |
| ⏳ | **Corpus-wide full-text search** — vendor MiniSearch (`vendor/minisearch.js`, no npm), lazy-load `verses-flat.json`, diacritic-insensitive `processTerm`, search *inside* verses across scripts. |
| ⏳ | A "Search inside texts" toggle on the catalogue → results deep-link to `text?slug=…#vN`. |

### 🔨 P3 — de-duplicate & retire legacy
| Status | Item |
|:--:|---|
| ✅ | Retired the drifted `blogs/*` text-edition copies → `meta refresh` + `rel=canonical` stubs pointing at `text?slug=…`; `blogs.html` + `sitemap.xml` repointed to JL. |
| ✅ | Migrated `misc-works/*.html` (the 11 covered texts) turned into the same redirect stubs. |
| ⏳ | Relocate/relabel `translations/jaina-samskrta-sahitya.html` (it's a history essay, not a translation). |

### ⏳ P4 — scholarly depth (schema already has the slots)
| Status | Item |
|:--:|---|
| ⏳ | **Translations** per verse (`>en:` in source) — the single biggest content gap; portal has none today. |
| ⏳ | **Commentary layers** (`#label:`) and **structured apparatus** (`!apparatus:`) replacing inline `(?)` marks. |
| 💡 | Parallel-translation pane in Compare mode (script + translit + translation columns). |
| 💡 | Citation export as CSL-JSON in addition to BibTeX; per-text "cite" as well as per-verse. |
| 💡 | Downloadable formats (plain-text, PDF, TEI-XML) generated at build time. |
| 💡 | Cross-references between related texts (e.g. the three Vīra-nirvāṇa works). |

---

## 3. SHS / Siddhahema grammar portal

Current state: two disconnected apps in `shs/` — **System A** (curated `sutras.json`
pipeline, Adhyāya 1 only, 85 sūtras, Laghuvṛtti only) and **System B** (`shs.html`,
undocumented raw-OCR search over adhyāyas 1–7). Data model, UX, and pipeline are sound
but cover <2% of the grammar and don't yet scale.

### ⏳ P0 — consolidate & correct
| Status | Item |
|:--:|---|
| ⏳ | **Unify the two systems** — let an OCR hit in `shs.html` deep-link to a curated `sutra.html` once that sūtra is digitized; cross-link them at minimum. |
| ⏳ | Fix README claims ("no tracking / zero dependencies / offline") or actually remove GA+Umami and inline/​self-host the four Google Fonts (also enables true offline). |
| ⏳ | **Sort in `build.py`** by `(adhyaya, pada, num, subdivision)` so prev/next is order-independent. |
| ⏳ | Fix `parse_id` so subdivided sūtras (`1.1.42.1`) don't collide with `num=42`; add a `kind` field (sūtra vs. illustrative verse). |

### ⏳ P1 — richer schema (unlocks the rest)
| Status | Item |
|:--:|---|
| ⏳ | Extend each record: `anuvṛtti`, `padaccheda`, `udāharaṇa[]`, `pratyudāharaṇa[]`, layered `commentaries[]` (add Bṛhadvṛtti as a 2nd entry — schema already supports it), `paniniParallels[]`, `topics[]`, `xrefs[]`. |
| ⏳ | Auto-link `xrefs` and inline sūtra citations inside vṛtti text into hyperlinks. |
| ⏳ | **Split JSON for scale** — one file per pāda (or adhyāya) + a lightweight index; lazy-load instead of one growing monolith. |

### ⏳ P2 — navigation, citation, search
| Status | Item |
|:--:|---|
| ⏳ | **Adhyāya → Pāda → Sūtra tree** sidebar + breadcrumb (browsing is a flat list today). |
| ⏳ | Stable canonical permalinks (`/shs/1/1/4`, `rel=canonical`) + citation export (BibTeX/CSL). |
| ⏳ | Search upgrade: prebuilt inverted index; diacritic/script folding; fielded + fuzzy; filter by pāda/topic; fix HK case-sensitivity + cross-script highlight. |

### ⏳ P3 — scholarly depth & platform
| Status | Item |
|:--:|---|
| 💡 | Worked **prakriyā** (derivation) examples; index of grammatical terms / saṃjñās; paribhāṣā & pratyāhāra reference pages. |
| 💡 | Ancillary texts as linked datasets: gaṇapāṭha, dhātupāṭha, uṇādi, liṅgānuśāsana. |
| 💡 | Contributor workflow beyond CSV (nested commentary/examples don't fit a flat CSV) — per-sūtra YAML/JSON or a small editing form + CI validation. |
| 💡 | Offline PWA (manifest + service worker), dark mode, `prefers-reduced-motion`, `:focus-visible`, skip-link. |
| 💡 | TEI / structured export for interoperability. |

### Coverage goal
| Status | Item |
|:--:|---|
| ⏳ | Digitize beyond Adhyāya 1 — the whole grammar is 8 adhyāyas / ~32 pādas; Adhyāya 8 (the only systematic Prakrit grammar) is the flagship. |
| ⏳ | Add the Bṛhadvṛtti commentary layer alongside the Laghuvṛtti. |

---

## 4. Suggested sequencing

1. ~~Finish JL P1~~ — **done** for 11 texts; only the 3 `misc-works` anthologies remain (one needs a sub-work model).
2. ~~Blog `posts.json` + auto-index + RSS + tags/series~~ — **done**; drift stopped.
3. **JL P2 search + faceted catalogue** — render `index.html` from `catalog.json`; vendor MiniSearch over `verses-flat.json`. Next-highest payoff.
4. **SHS P0 consolidation + sort/id fixes** — cheap, corrects real bugs, unifies the two apps.
5. **JL P4 translations/commentary** & **SHS P1 richer schema** — long-tail scholarly depth, filled in incrementally.
6. Cross-cutting polish (analytics consolidation, self-hosted fonts, dark mode, a11y) as it fits.

> **Shipped & deployed** (commit `0cdde49`, authored by svyoma): reconciled JL
> pipeline (11 texts), blog data-model with tag/series filters + RSS, blog→JL
> migrations with redirect stubs, sitemap/robots/JSON-LD, dead-file cleanup,
> `.gitignore`.

---

## 5. Prospects (bigger bets)

- **A shared "critical-edition" toolkit** — JL and SHS increasingly want the same
  primitives (canonical Devanagari → multi-script build, verse/sūtra permalinks,
  citation export, cross-script search). Factor these into one small vendored JS
  module + one `build_common.py` used by both portals.
- **Contribution pipeline** — a documented, validated source format (already true for
  JL) plus GitHub issue/PR templates could turn these from solo projects into
  community-editable editions.
- **Interlinking the properties** — a blog post on a text links to its portal edition
  and its relevant Siddhahema sūtras; the portal links back to the essays. One
  scholarly web, three surfaces.
- **Discoverability** — register the editions with relevant catalogues (e.g. Jaina
  studies / Sanskrit digital-humanities directories) for inbound links and citations.
