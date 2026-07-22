/* Jaina Literature Portal — catalogue + corpus search
   Renders the catalogue from data/catalog.json (+ data/misc-catalog.json for
   texts not yet in the pipeline) and provides a diacritic-insensitive
   full-text search over data/verses-flat.json. No external dependencies. */
(function () {
  "use strict";

  var LANG_LABEL = {
    sanskrit: "Sanskrit", prakrit: "Prākṛta",
    apabhramsha: "Apabhraṃśa", sauraseni: "Śaurasenī"
  };
  var LANG_CLASS = {
    sanskrit: "tag-sanskrit", prakrit: "tag-prakrit",
    apabhramsha: "tag-apabhramsha", sauraseni: "tag-sauraseni"
  };
  var GENRE_LABEL = {
    stotra: "Stotra", carita: "Carita", didactic: "Didactic"
  };

  // ── diacritic folding ────────────────────────────────────────────
  // Returns a lowercase ASCII-folded string; combining marks stripped.
  function fold(s) {
    return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  // Fold + keep an index map back into the ORIGINAL string (for highlighting).
  function foldMap(s) {
    s = s || "";
    var folded = "", map = [], i, ch, nf, j;
    for (i = 0; i < s.length; i++) {
      ch = s[i];
      nf = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      for (j = 0; j < nf.length; j++) { folded += nf[j]; map.push(i); }
    }
    map.push(s.length);
    return { folded: folded, map: map };
  }
  function tokens(q) {
    return fold(q).split(/[^a-z0-9]+/).filter(function (t) { return t.length > 0; });
  }

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function esc(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── state ────────────────────────────────────────────────────────
  var texts = [];          // merged catalogue entries
  var verses = null;       // lazy-loaded verse corpus
  var versesPromise = null;
  var mode = "browse";     // "browse" | "corpus"
  var query = "";
  var facets = { language: null, genre: null, metre: null };

  var el = {};

  // ── catalogue rendering ──────────────────────────────────────────
  function langTags(langs) {
    return (langs || []).map(function (l) {
      return '<span class="tag ' + (LANG_CLASS[l] || "") + '">' +
        esc(LANG_LABEL[l] || cap(l)) + "</span>";
    }).join("");
  }

  function metreList(m) {
    return (m || []).map(function (x) { return cap(x); }).join(" & ");
  }

  function cardHTML(t) {
    var titleIast = (t.title && t.title.iast) || t.slug;
    var authorNote = t.author && t.author.note;
    var authorName = t.author && t.author.name && (t.author.name.iast || t.author.name.deva);
    var period = (t.author && t.author.period) || t.period;
    var metre = metreList(t.metre);

    var meta = [];
    if (t.verse_count) meta.push(t.verse_count + " verses");
    if (metre) meta.push(metre + (t.metre.length > 1 ? " metres" : " metre"));
    if (period) meta.push(period);
    if (t.meta_note) meta.push(t.meta_note);
    else if (authorNote) meta.push(authorNote);

    var metaHTML = meta.map(function (m) {
      return '<span class="meta-item"><span class="meta-dot"></span>' + esc(m) + "</span>";
    }).join("");

    var accNum = (t.accession || "").replace(/^JLP-?/, "");
    var href = t.href || ("text?slug=" + t.slug);
    var ext = t.href ? ' target="_blank" rel="noopener"' : "";

    return '<article class="entry">' +
      '<span class="accession">JLP · ' + esc(accNum) + "</span>" +
      '<div class="entry-header">' +
        '<h2 class="entry-title">' + esc(cap(titleIast)) + "</h2>" +
        '<div class="tags">' + langTags(t.language) + "</div>" +
      "</div>" +
      (authorName ? '<p class="entry-author">' + esc(cap(authorName)) + "</p>" : "") +
      (metaHTML ? '<div class="entry-meta">' + metaHTML + "</div>" : "") +
      (t.blurb ? '<p class="entry-desc">' + esc(t.blurb) + "</p>" : "") +
      '<div class="entry-footer"><a href="' + href + '" class="read-link"' + ext +
        ">Read Text</a></div>" +
    "</article>";
  }

  function matchesFacets(t) {
    if (facets.language && (t.language || []).indexOf(facets.language) === -1) return false;
    if (facets.genre && t.genre !== facets.genre) return false;
    if (facets.metre) {
      var ms = (t.metre || []).map(fold);
      if (ms.indexOf(facets.metre) === -1) return false;
    }
    return true;
  }

  function matchesQuery(t) {
    if (!query) return true;
    var hay = fold([
      t.title && t.title.iast, t.title && t.title.deva,
      t.author && t.author.name && t.author.name.iast,
      t.author && t.author.note, t.blurb, t.slug, t.accession
    ].join(" "));
    return tokens(query).every(function (tok) { return hay.indexOf(tok) !== -1; });
  }

  function renderCatalogue() {
    var shown = texts.filter(function (t) { return matchesFacets(t) && matchesQuery(t); });
    el.catalogue.innerHTML = shown.map(cardHTML).join("");
    el.count.textContent = shown.length === 1 ? "Showing 1 text" : "Showing " + shown.length + " texts";
    el.noResults.style.display = shown.length === 0 ? "block" : "none";
  }

  // ── facet chips ──────────────────────────────────────────────────
  function buildFacetRow(label, key, options) {
    if (options.length < 2) return "";
    var chips = options.map(function (o) {
      return '<button class="filter-btn" data-facet="' + key + '" data-value="' +
        esc(o.value) + '">' + esc(o.label) + "</button>";
    }).join("");
    return '<div class="facet-row"><span class="facet-label">' + label + "</span>" +
      '<div class="facet-chips">' +
      '<button class="filter-btn active" data-facet="' + key + '" data-value="">All</button>' +
      chips + "</div></div>";
  }

  function buildFacets() {
    var langs = {}, genres = {}, metres = {};
    texts.forEach(function (t) {
      (t.language || []).forEach(function (l) { langs[l] = true; });
      if (t.genre) genres[t.genre] = true;
      (t.metre || []).forEach(function (m) { var k = fold(m); if (k) metres[k] = cap(m); });
    });
    var langOpts = Object.keys(langs).sort().map(function (l) {
      return { value: l, label: LANG_LABEL[l] || cap(l) };
    });
    var genreOpts = Object.keys(genres).sort().map(function (g) {
      return { value: g, label: GENRE_LABEL[g] || cap(g) };
    });
    var metreOpts = Object.keys(metres).sort().map(function (k) {
      return { value: k, label: metres[k] };
    });
    el.facets.innerHTML =
      buildFacetRow("Language", "language", langOpts) +
      buildFacetRow("Genre", "genre", genreOpts) +
      buildFacetRow("Metre", "metre", metreOpts);

    el.facets.querySelectorAll(".filter-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.dataset.facet, val = btn.dataset.value;
        facets[key] = val || null;
        el.facets.querySelectorAll('[data-facet="' + key + '"]').forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        renderCatalogue();
      });
    });
  }

  // ── corpus search ────────────────────────────────────────────────
  function loadVerses() {
    if (versesPromise) return versesPromise;
    versesPromise = fetch("data/verses-flat.json")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        verses = d.map(function (v) {
          v._hay = fold([v.deva, v.iast, v.hk, v.translation].join(" "));
          return v;
        });
        return verses;
      });
    return versesPromise;
  }

  function highlight(str, toks) {
    var fm = foldMap(str), lower = fm.folded, ranges = [];
    toks.forEach(function (tok) {
      var from = 0, idx;
      while ((idx = lower.indexOf(tok, from)) !== -1) {
        ranges.push([fm.map[idx], fm.map[idx + tok.length]]);
        from = idx + tok.length;
      }
    });
    if (!ranges.length) return esc(str);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [ranges[0].slice()], i;
    for (i = 1; i < ranges.length; i++) {
      var last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
      else merged.push(ranges[i].slice());
    }
    var out = "", pos = 0;
    merged.forEach(function (r) {
      out += esc(str.slice(pos, r[0])) + "<mark>" + esc(str.slice(r[0], r[1])) + "</mark>";
      pos = r[1];
    });
    return out + esc(str.slice(pos));
  }

  function renderCorpus() {
    var toks = tokens(query);
    if (!toks.length) {
      el.catalogue.innerHTML = "";
      el.count.textContent = "Type to search inside the verses";
      el.noResults.style.display = "none";
      return;
    }
    var hits = [];
    verses.forEach(function (v) {
      var score = 0, ok = true;
      toks.forEach(function (tok) {
        if (v._hay.indexOf(tok) === -1) ok = false;
        else score += (v._hay.split(tok).length - 1);
      });
      if (ok) hits.push({ v: v, score: score });
    });
    hits.sort(function (a, b) {
      return b.score - a.score || a.v.slug.localeCompare(b.v.slug) || a.v.num - b.v.num;
    });
    var capped = hits.slice(0, 80);
    el.count.textContent = hits.length === 1 ? "1 verse found" :
      hits.length + " verses found" + (hits.length > capped.length ? " (showing 80)" : "");
    el.noResults.style.display = hits.length === 0 ? "block" : "none";
    el.catalogue.innerHTML = capped.map(function (h) {
      var v = h.v;
      return '<a class="verse-hit" href="text?slug=' + v.slug + "#v" + v.num + '">' +
        '<div class="verse-hit-head">' +
          '<span class="verse-hit-title">' + esc(cap(v.title_iast || v.slug)) + "</span>" +
          '<span class="verse-hit-num">v. ' + v.num + "</span>" +
        "</div>" +
        '<div class="verse-hit-deva">' + highlight(v.deva || "", toks) + "</div>" +
        '<div class="verse-hit-iast">' + highlight(v.iast || "", toks) + "</div>" +
      "</a>";
    }).join("");
  }

  function render() {
    if (mode === "browse") renderCatalogue();
    else renderCorpus();
  }

  // ── mode toggle ──────────────────────────────────────────────────
  function setMode(m) {
    mode = m;
    el.tabBrowse.classList.toggle("active", m === "browse");
    el.tabCorpus.classList.toggle("active", m === "corpus");
    el.facets.style.display = m === "browse" ? "" : "none";
    el.catalogue.classList.toggle("corpus-mode", m === "corpus");
    el.search.placeholder = m === "browse"
      ? "Search by title or author…"
      : "Search inside the texts (diacritics optional)…";
    if (m === "corpus") { loadVerses().then(render); } else { render(); }
  }

  // ── init ─────────────────────────────────────────────────────────
  function init() {
    el.catalogue = document.getElementById("catalogue");
    el.count     = document.getElementById("catalogueCount");
    el.noResults = document.getElementById("noResults");
    el.facets    = document.getElementById("facets");
    el.search    = document.getElementById("searchInput");
    el.tabBrowse = document.getElementById("tabBrowse");
    el.tabCorpus = document.getElementById("tabCorpus");

    el.search.addEventListener("input", function (e) {
      query = e.target.value.trim();
      render();
    });
    el.tabBrowse.addEventListener("click", function () { setMode("browse"); });
    el.tabCorpus.addEventListener("click", function () { setMode("corpus"); });

    Promise.all([
      fetch("data/catalog.json").then(function (r) { return r.json(); }),
      fetch("data/misc-catalog.json").then(function (r) { return r.json(); }).catch(function () { return []; })
    ]).then(function (res) {
      texts = res[0].concat(res[1]);
      texts.sort(function (a, b) { return (a.accession || "").localeCompare(b.accession || ""); });
      buildFacets();
      renderCatalogue();
    }).catch(function (err) {
      el.catalogue.innerHTML = '<p class="no-results" style="display:block">Could not load the catalogue.</p>';
      if (window.console) console.error(err);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
