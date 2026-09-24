/* kavya.js — reader for the Jaina Literature Portal's sectioned works
   (Kāvyas, Darśana). Loads data/<slug>/mula.json (built by ../build_works.py)
   and lazily data/<slug>/tika-<n>.json per unit (sarga / adhyāya). Hash routes:
     #overview · #s3 (unit 3) · #3.24 (unit 3, item 24) · #metres · #intro · #prasasti
     · #source (the poem a samasyā kāvya is built on) · #search
   A page sets window.KV_SECTION = {name, href} for its back link.
   Zero dependencies beyond kavya-common.js (window.KV). */
(function () {
  "use strict";

  var esc = KV.esc, cap = KV.cap;
  var SCRIPTS = [
    { key: "deva", label: "देव" }, { key: "iast", label: "IAST" },
    { key: "iso", label: "ISO" }, { key: "hk", label: "HK" }
  ];
  var TIKA_MODES = [
    { key: "off", label: "Off" }, { key: "fold", label: "On tap" }, { key: "open", label: "Open" }
  ];

  var S = {
    slug: new URLSearchParams(location.search).get("k"),
    d: null,
    tika: {},              // sarga num -> tika json
    tikaP: {},             // sarga num -> promise
    script: KV.store.get("jl-script", "deva"),
    tikaMode: KV.store.get("kv-tika", "fold"),
    parallel: KV.store.get("kv-parallel", "0") === "1",
    scale: parseFloat(KV.store.get("kv-scale", "1")) || 1,
    showMetre: KV.store.get("kv-metre", "1") === "1",
    showSam: KV.store.get("kv-samasya", "1") === "1",
    layerOpen: KV.store.get("kv-layer2", "0") === "1",   // later commentary layers (e.g. Viveka) unfolded
    open: {},              // "s.v" -> true (ṭīkā opened in fold mode)
    metreFilter: null,
    query: "",
    q: null,               // parsed query used for highlighting
    scope: { mula: true, tika: true },
    view: null
  };
  // ?script=iast&tika=open&q=… override the stored preferences for this visit
  (function () {
    var p = new URLSearchParams(location.search);
    if (p.get("script")) S.script = p.get("script");
    if (/^(off|fold|open)$/.test(p.get("tika") || "")) S.tikaMode = p.get("tika");
    if (p.get("q")) { S.query = p.get("q"); S.q = KV.parseQuery(S.query); }
  })();
  if (!SCRIPTS.some(function (s) { return s.key === S.script; })) S.script = "deva";

  var SECTION = window.KV_SECTION || { name: "Kāvyas", href: "./" };
  var $main, $view, $toc, $search;

  // ── helpers ───────────────────────────────────────────────────────
  function pick(o, key) {
    if (!o) return "";
    key = key || S.script;
    return o[key] || o.iast || o.deva || "";
  }
  function isDeva() { return S.script === "deva"; }
  function latinKey() { return isDeva() ? "iast" : S.script; }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function toast(msg) {
    var t = document.getElementById("kv-toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }
  function copy(text, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(function () { toast(msg || "Copied"); }, function () { toast("Copy not available"); });
  }
  function metreName(m) {
    if (!m) return "";
    if (isDeva()) {
      var mn = S.d.metre_names[m];
      if (mn && mn.deva) return mn.deva;
    }
    return cap(m);
  }
  var metreColor = {};
  function colorOf(m) { return metreColor[m] || "#9a8a6a"; }
  function unitName() { return isDeva() ? S.d.unit.deva : cap(S.d.unit.iast); }
  function units() { return S.d.unit.plural || S.d.unit.iast + "s"; }
  function itemNoun(n) {
    var it = S.d.item || { iast: "verse" };
    return n === 1 ? it.iast : (it.plural || it.iast + "s");
  }
  function isSutraWork() { return S.d.format === "sutra" || S.d.format === "vyakhya" || S.d.format === "json"; }
  function verseByNum(s, n) {
    for (var i = 0; i < s.verses.length; i++) if (s.verses[i].n === n) return s.verses[i];
    return null;
  }
  function commName() {                       // "Ṭīkā", "Vṛtti"
    var c = (S.d.commentary || [])[0];
    if (c && c.short) return c.short;
    return c && c.name ? cap(pick(c.name, "iast")) : "Commentary";
  }
  function genreLabel(g) {
    return { mahakavya: "Mahākāvya", kavya: "Kāvya", prakarana: "Prakaraṇa", tarka: "Tarka", alankara: "Alaṅkāra", chandas: "Chandas" }[g] || cap(g || "");
  }

  function sargaName(s) {
    var h = pick(s.heading).replace(/[|‖।॥]/g, " ").trim();
    var w = h.split(/\s+/), i;
    for (i = 1; i < w.length; i++) {
      if (/^(sarg|सर्ग)/i.test(w[i])) return w[i - 1] + " " + w[i];
    }
    return h;
  }
  function introTitle() {
    var fm = S.d.frontmatter || {};
    return fm.lang === "gu" ? "Prastāvanā" : fm.lang === "sa" ? "Upodghāta" : "Introduction";
  }
  function title() {
    if (!isDeva() && S.d.display_title) return S.d.display_title;
    return pick(S.d.short_title) || pick(S.d.title);
  }
  function plainTitle() { return S.d.display_title || cap(pick(S.d.short_title, "iast")); }
  function ref(s, v) { return s + "." + v; }

  function metreBar(metres, total, big) {
    return '<div class="metre-bar' + (big ? " big" : "") + '">' + metres.map(function (m) {
      return '<span style="width:' + (m[1] * 100 / total) + "%;background:" + colorOf(m[0]) +
        '" title="' + esc(metreName(m[0]) + " · " + m[1]) + '"></span>';
    }).join("") + "</div>";
  }
  function metreLegend(metres, clickable) {
    return '<div class="metre-legend">' + metres.map(function (m) {
      var inner = '<i style="background:' + colorOf(m[0]) + '"></i>' + esc(metreName(m[0])) + " <b>" + m[1] + "</b>";
      return clickable ? '<button data-metre="' + esc(m[0]) + '" title="Show only ' + esc(cap(m[0])) + ' verses">' + inner + "</button>"
        : "<span>" + inner + "</span>";
    }).join("") + "</div>";
  }

  // ── ṭīkā loading ─────────────────────────────────────────────────
  function loadTika(n) {
    if (S.tika[n]) return Promise.resolve(S.tika[n]);
    if (!S.tikaP[n]) {
      S.tikaP[n] = fetch("data/" + S.slug + "/tika-" + n + ".json")
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (j) { S.tika[n] = j; return j; });
    }
    return S.tikaP[n];
  }
  function loadAllTika() {
    return Promise.all(S.d.sargas.map(function (s) { return loadTika(s.num); }));
  }
  function hasTika() { return S.d.commentary && S.d.commentary.length; }
  function commentaryLabel() {
    var c = (S.d.commentary || [])[0];
    if (!c) return "Commentary";
    var nm = isDeva() ? pick(c.name, "deva") : commName();
    var au = c.author ? pick(c.author, isDeva() ? "deva" : latinKey()) : "";
    return nm + (au ? " · " + cap(au) : "");
  }

  // ── header & TOC ─────────────────────────────────────────────────
  function renderHeader() {
    var d = S.d, a = d.author || {}, c = (d.commentary || [])[0];
    document.title = plainTitle() + " — " + SECTION.name + " · Jaina Literature Portal";
    var tags = (d.language || []).map(function (l) {
      return '<span class="tag tag-' + esc(l) + '">' + esc(cap(l)) + "</span>";
    }).join("") + '<span class="tag tag-genre">' + esc(genreLabel(d.genre)) + "</span>" +
      (d.tags || []).map(function (t) { return '<span class="tag tag-genre">' + esc(t) + "</span>"; }).join("") +
      (c ? '<span class="tag tag-comm">With ' + esc(commName()) + "</span>" : '<span class="tag tag-genre">Mūla</span>');
    document.getElementById("kv-header").innerHTML =
      '<div class="header-inner">' +
      '<a class="back-link" href="' + esc(SECTION.href) + '">&#8592; ' + esc(SECTION.name) + "</a>" +
      '<div class="kv-header-row"><div>' +
      (d.accession ? '<span class="accession-badge">' + esc(d.accession.replace("-", " · ")) + "</span>" : "") +
      '<h1 class="text-title">' + esc(cap(title())) + "</h1>" +
      (pick(d.title) !== title() ? '<p class="text-subtitle">' + esc(cap(pick(d.title))) + "</p>" : "") +
      (a.name ? '<p class="text-author">' + esc(cap(pick(a.name))) + "</p>" : "") +
      (c && c.author ? '<p class="comm-line">' + (isDeva() ? esc(pick(c.author, "deva")) + "कृतया " +
          esc(pick(c.name, "deva")).replace(/ा$/, "या").replace(/[िी]$/, "्या") + " सहितम्"
        : "with the " + esc(commName().toLowerCase()) + " of " + esc(cap(pick(c.author)))) + "</p>" : "") +
      '<div class="tags">' + tags + "</div></div>" +
      '<div class="kv-header-stats"><div><b>' + d.sargas.length + "</b><span>" + esc(units()) + "</span></div>" +
      "<div><b>" + d.verse_count + "</b><span>" + esc(itemNoun()) + "</span></div>" +
      (d.samasya ? "<div><b>" + d.samasya.verses.reduce(function (a, v) { return a + v.lines.length; }, 0) +
        "</b><span>" + esc(cap(pick(d.samasya.name, "iast"))) + " lines</span></div>"
        : "<div><b>" + d.metres.length + "</b><span>" + (d.metres.length === 1 ? "metre" : "metres") + "</span></div>") + "</div>" +
      "</div></div>";
  }

  function renderTOC() {
    var d = S.d, h = [];
    h.push('<button class="kv-btn kv-toc-close" type="button" aria-label="Close contents">✕</button>');
    h.push('<p class="kv-toc-label">Guide</p>');
    h.push('<a href="#overview" data-v="overview"><span class="n">❦</span><span class="t">Overview</span></a>');
    if (d.frontmatter && d.frontmatter.items && d.frontmatter.items.length)
      h.push('<a href="#intro" data-v="intro"><span class="n">¶</span><span class="t">' + esc(introTitle()) +
        "<small>Edition\'s introduction</small></span></a>");
    if (d.samasya)
      h.push('<a href="#source" data-v="source"><span class="n">☁</span><span class="t">' + esc(cap(pick(d.samasya.name, "iast"))) +
        "<small>The borrowed lines, rebuilt</small></span></a>");
    if (d.metres.length)
      h.push('<a href="#metres" data-v="metres"><span class="n">⏑</span><span class="t">Chandas index<small>' + d.metres.length + (d.metres.length === 1 ? " metre" : " metres") + "</small></span></a>");
    h.push('<p class="kv-toc-label">' + esc(cap(units())) + "</p>");
    d.sargas.forEach(function (s) {
      var main = isSutraWork() ? s.count + " " + itemNoun() : (s.metres[0] ? metreName(s.metres[0][0]) : "");
      h.push('<a href="#s' + s.num + '" data-v="s' + s.num + '"><span class="n">' + s.num + "</span>" +
        '<span class="t">' + esc(cap(sargaName(s))) + "<small>" + esc(main) + "</small></span>" +
        '<span class="c">' + s.count + "</span></a>");
    });
    if (d.prasasti) {
      h.push('<p class="kv-toc-label">Close</p>');
      h.push('<a href="#prasasti" data-v="prasasti"><span class="n">✦</span><span class="t">' +
        esc(cap(pick(d.prasasti.heading))) + "<small>Closing verses &amp; colophon</small></span></a>");
    }
    $toc.innerHTML = h.join("");
    $toc.querySelector(".kv-toc-close").addEventListener("click", function () { $toc.classList.remove("open"); });
    $toc.addEventListener("click", function (e) { if (e.target.closest("a")) $toc.classList.remove("open"); });
    markTOC();
  }
  function markTOC() {
    var key = S.view && (S.view.name === "sarga" ? "s" + S.view.s : S.view.name);
    $toc.querySelectorAll("a").forEach(function (a) { a.classList.toggle("active", a.dataset.v === key); });
  }

  // ── toolbar (rendered once; buttons re-synced) ───────────────────
  function renderToolbar() {
    var bar = el("div", "kv-toolbar");
    bar.id = "kv-toolbar";
    bar.innerHTML =
      '<button class="kv-btn kv-toc-toggle" type="button" data-act="toc">☰ ' + esc(cap(units())) + "</button>" +
      '<div class="kv-seg" data-group="script" role="group" aria-label="Script">' +
      SCRIPTS.map(function (s) { return '<button type="button" data-val="' + s.key + '">' + s.label + "</button>"; }).join("") +
      "</div>" +
      (hasTika() ? '<span class="kv-seg-label">' + esc(commName()) + '</span><div class="kv-seg" data-group="tika" role="group" aria-label="Commentary">' +
        TIKA_MODES.map(function (m) { return '<button type="button" data-val="' + m.key + '">' + m.label + "</button>"; }).join("") +
        "</div>" : "") +
      '<button class="kv-btn" type="button" data-act="parallel" title="Show IAST under Devanagari (or Devanagari under Latin)">Parallel</button>' +
      (S.d.metres.length ? '<button class="kv-btn" type="button" data-act="metre" title="Show metre of each verse">Chandas</button>' : "") +
      (S.d.samasya ? '<button class="kv-btn" type="button" data-act="samasya" title="Mark the line borrowed from ' +
        esc(cap(pick(S.d.samasya.name, "iast"))) + '">Samasyā</button>' : "") +
      '<div class="kv-seg" role="group" aria-label="Text size"><button type="button" data-act="smaller" title="Smaller text">A−</button>' +
      '<button type="button" data-act="larger" title="Larger text">A+</button></div>' +
      '<div class="kv-goto"><input type="text" id="kv-goto" placeholder="3.24" aria-label="Go to ' + esc(S.d.unit.iast) + "." +
        esc(itemNoun(1)) + '" title="Go to ' + esc(itemNoun(1)) + ', e.g. 3.24"></div>' +
      '<div class="kv-search"><input type="search" id="kv-q" placeholder="Search mūla &amp; ' + esc(commName().toLowerCase()) +
        '…" aria-label="Search this work" autocomplete="off"></div>';
    $main.insertBefore(bar, $view);

    bar.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var grp = b.parentNode.dataset.group;
      if (grp === "script") {
        S.script = b.dataset.val; KV.store.set("jl-script", S.script);
        renderHeader(); renderTOC(); syncToolbar(); renderView(true);
      } else if (grp === "tika") {
        S.tikaMode = b.dataset.val; KV.store.set("kv-tika", S.tikaMode);
        S.open = {};
        syncToolbar(); renderView(true);
      } else if (b.dataset.act === "parallel") {
        S.parallel = !S.parallel; KV.store.set("kv-parallel", S.parallel ? "1" : "0");
        syncToolbar(); renderView(true);
      } else if (b.dataset.act === "samasya") {
        S.showSam = !S.showSam; KV.store.set("kv-samasya", S.showSam ? "1" : "0");
        syncToolbar(); renderView(true);
      } else if (b.dataset.act === "metre") {
        S.showMetre = !S.showMetre; KV.store.set("kv-metre", S.showMetre ? "1" : "0");
        syncToolbar(); renderView(true);
      } else if (b.dataset.act === "smaller" || b.dataset.act === "larger") {
        S.scale = Math.max(0.8, Math.min(1.6, S.scale + (b.dataset.act === "larger" ? 0.1 : -0.1)));
        KV.store.set("kv-scale", S.scale.toFixed(2));
        applyScale();
      } else if (b.dataset.act === "toc") {
        $toc.classList.add("open");
      }
    });

    var go = document.getElementById("kv-goto");
    go.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var m = go.value.trim().match(/^(\d+)(?:[.,:\s]+(\d+))?$/);
      var cur = S.view && S.view.name === "sarga" ? S.view.s : 1;
      if (!m) { toast("Type " + S.d.unit.iast + "." + itemNoun(1) + ", e.g. 3.24"); return; }
      var s = m[2] ? +m[1] : cur, v = m[2] ? +m[2] : +m[1];
      var sg = S.d.sargas[s - 1];
      if (!sg || !verseByNum(sg, v)) { toast("No " + itemNoun(1) + " " + s + "." + v); return; }
      go.value = ""; go.blur();
      navigate("#" + s + "." + v);
    });

    $search = document.getElementById("kv-q");
    if (!hasTika()) $search.placeholder = "Search the " + itemNoun() + "…";
    if (S.query) $search.value = S.query;
    var t;
    $search.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        S.query = $search.value.trim();
        S.q = KV.parseQuery(S.query);
        if (S.q) {
          if (!S.view || S.view.name !== "search") {
            S.returnTo = location.hash || "#overview";
            navigate("#search");
          } else renderView(true);
        } else if (S.view && S.view.name === "search") {
          navigate(S.returnTo || "#overview");
        }
      }, 220);
    });
    $search.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { $search.value = ""; $search.dispatchEvent(new Event("input")); $search.blur(); }
    });
    syncToolbar();
    applyScale();
  }
  function syncToolbar() {
    var bar = document.getElementById("kv-toolbar");
    bar.querySelectorAll('[data-group="script"] button').forEach(function (b) { b.classList.toggle("active", b.dataset.val === S.script); });
    bar.querySelectorAll('[data-group="tika"] button').forEach(function (b) { b.classList.toggle("active", b.dataset.val === S.tikaMode); });
    bar.querySelector('[data-act="parallel"]').classList.toggle("active", S.parallel);
    var mb = bar.querySelector('[data-act="metre"]'); if (mb) mb.classList.toggle("active", S.showMetre);
    var sb = bar.querySelector('[data-act="samasya"]'); if (sb) sb.classList.toggle("active", S.showSam);
  }
  function applyScale() { document.documentElement.style.setProperty("--reader-scale", S.scale); }

  // ── routing ───────────────────────────────────────────────────────
  function parseHash() {
    var h = decodeURIComponent(location.hash.slice(1));
    var m;
    if ((m = h.match(/^s(\d+)$/))) return { name: "sarga", s: +m[1] };
    if ((m = h.match(/^(\d+)\.(\d+)$/))) return { name: "sarga", s: +m[1], v: +m[2] };
    if ((m = h.match(/^source(?:-(\d+))?$/))) return { name: "source", n: m[1] ? +m[1] : null };
    if (h === "metres" || h === "intro" || h === "prasasti" || h === "search") return { name: h };
    return { name: "overview" };
  }
  function navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }
  function route() {
    var v = parseHash();
    if (v.name === "sarga" && !S.d.sargas[v.s - 1]) v = { name: "overview" };
    if (v.name === "search" && !S.q) v = { name: "overview" };
    var sameSarga = S.view && S.view.name === "sarga" && v.name === "sarga" && S.view.s === v.s;
    if (!sameSarga) S.metreFilter = null;
    S.view = v;
    markTOC();
    if (sameSarga && v.v && document.getElementById("v" + v.v)) { focusVerse(v.v); return; }
    renderView(false);
  }

  function renderView(keepScroll) {
    var y = window.scrollY;
    var v = S.view;
    $view.innerHTML = "";
    if (v.name === "sarga") renderSarga(v);
    else if (v.name === "metres") renderMetres();
    else if (v.name === "intro") renderIntro();
    else if (v.name === "prasasti") renderPrasasti();
    else if (v.name === "search") renderSearch();
    else if (v.name === "source" && S.d.samasya) renderSource(v);
    else renderOverview();
    if (keepScroll) window.scrollTo(0, y);
    else if (v.name === "source" && v.n) {
      var tgt = document.getElementById("src-" + v.n);
      if (tgt) tgt.scrollIntoView({ block: "start" });
    } else if (!(v.name === "sarga" && v.v)) window.scrollTo(0, 0);
  }

  // ── overview ──────────────────────────────────────────────────────
  function renderOverview() {
    var d = S.d, ed = d.edition || {}, h = [];
    if (d.blurb) h.push('<p class="blurb">' + esc(d.blurb) + "</p>");
    var comm = (d.commentary || []).map(function (c) {
      return cap(pick(c.name, "iast")) + (c.author ? " of " + cap(pick(c.author, "iast")) : "") + (c.note ? " — " + c.note : "");
    }).join("; ");
    var a = d.author || {};
    var rows = [
      [a.role || (isSutraWork() ? "Author" : "Poet"), a.name ? cap(pick(a.name, "iast")) + (a.note ? " — " + a.note : "") : ""],
      ["Period", a.period], ["Sect", a.sect],
      ["Commentary", comm],
      ["Edition", ed.name], ["Series", ed.series], ["Publisher", ed.publisher],
      ["Year", ed.year], ["Editors", ed.editor],
      ["Text source", ed.source_url ? '<a href="' + esc(ed.source_url) + '" target="_blank" rel="noopener">' + esc(ed.source) + "</a>" : esc(ed.source)],
      ["Digitised by", ed.digitized_by]
    ].filter(function (r) { return r[1]; });
    h.push('<div class="meta-panel"><p class="meta-panel-label">Work &amp; Edition</p><div class="meta-grid">' +
      rows.map(function (r) {
        var val = r[0] === "Text source" ? r[1] : esc(r[1]);
        return '<span class="meta-key">' + r[0] + '</span><span class="meta-val">' + val + "</span>";
      }).join("") + "</div></div>");
    if (d.about && d.about.length) {
      h.push('<div class="about kv-block"><p class="section-label">About the work</p>' +
        d.about.map(function (p) { return "<p>" + p + "</p>"; }).join("") + "</div>");  // trusted HTML from source yml
    }
    // sargas table
    var sutra = isSutraWork();
    var hasTopics = d.sargas.some(function (s) { return s.topics && s.topics.length; });
    h.push('<div class="kv-block"><h2 class="kv-h2">' + esc(cap(units())) + "</h2>" +
      '<table class="sarga-table"><thead><tr><th>#</th><th>' + esc(cap(d.unit.iast)) + "</th>" +
      (sutra ? (hasTopics ? '<th class="mt">Topics</th>' : "") : '<th class="mt">Principal metre</th><th class="bar-cell">Metrical profile</th>') +
      '<th class="cnt">' + esc(cap(itemNoun())) + "</th></tr></thead><tbody>" +
      d.sargas.map(function (s) {
        var main = s.metres[0];
        return '<tr data-href="#s' + s.num + '"><td class="num">' + s.num + '</td><td class="nm"><a href="#s' + s.num + '">' +
          esc(cap(sargaName(s))) + "</a></td>" +
          (sutra ? (!hasTopics ? "" : '<td class="mt">' + esc((s.topics || []).filter(function (t) { return !t.sub; }).slice(0, 3)
              .map(function (t) { return pick(t.t); }).join(" · ")) + ((s.topics || []).length > 3 ? " …" : "") + "</td>")
            : '<td class="mt">' + (main ? esc(metreName(main[0])) : "—") + '</td><td class="bar-cell">' + metreBar(s.metres, s.count) + "</td>") +
          '<td class="cnt">' + s.count + "</td></tr>";
      }).join("") + "</tbody></table></div>");
    if (d.samasya) {
      var nLines = d.samasya.verses.reduce(function (a, v) { return a + v.lines.length; }, 0);
      h.push('<div class="kv-block"><h2 class="kv-h2">Samasyā: ' + esc(cap(pick(d.samasya.name, "iast"))) + "</h2>" +
        '<p class="about">' + esc(nLines) + " lines of " + esc(d.samasya.author || "the source poem") + "'s " +
        esc(cap(pick(d.samasya.name, "iast"))) + " are embedded in this poem. Each verse marks its borrowed line, and the " +
        'rebuilt text links every line back to the verse that uses it.</p><p><a href="#source" style="color:var(--rust)">Read the ' +
        esc(cap(pick(d.samasya.name, "iast"))) + " as embedded →</a></p></div>");
    }
    // metre profile of the whole poem
    if (d.metres.length) {
      var scanned = d.metres.reduce(function (a, m) { return a + m[1]; }, 0);
      h.push('<div class="kv-block"><h2 class="kv-h2">' + (sutra ? "Metres of the verse portions" : "Metres of the poem") + "</h2>" +
        '<p class="section-label">' + (sutra ? scanned + " verses among the " + itemNoun() : d.verse_count + " verses") +
        " · identified by scansion</p>" +
        metreBar(d.metres, sutra ? scanned : d.verse_count, true) + metreLegend(d.metres, false) +
        '<p style="margin-top:12px"><a class="read-more" href="#metres" style="color:var(--rust)">Open the chandas index →</a></p></div>');
    }
    // links
    var links = ['<a class="kv-card-link" href="#s1"><b>Begin reading</b><span>' + esc(cap(sargaName(d.sargas[0]))) + " · " +
      d.sargas[0].count + " " + esc(itemNoun()) + "</span></a>"];
    if (d.frontmatter && d.frontmatter.items.length)
      links.push('<a class="kv-card-link" href="#intro"><b>' + esc(introTitle()) + "</b><span>" + esc(d.frontmatter.label || "") + "</span></a>");
    if (d.prasasti) links.push('<a class="kv-card-link" href="#prasasti"><b>' + esc(cap(pick(d.prasasti.heading, "iast"))) +
      "</b><span>" + esc(d.prasasti.note || "Closing verses and colophon") + "</span></a>");
    h.push('<div class="kv-links kv-block">' + links.join("") + "</div>");
    h.push('<p class="kbd-hint"><kbd>/</kbd> search &nbsp; <kbd>←</kbd> <kbd>→</kbd> previous / next ' + esc(d.unit.iast) +
      (hasTika() ? " &nbsp; <kbd>t</kbd> cycle " + esc(commName().toLowerCase()) : "") + " &nbsp; <kbd>g</kbd> go to " + esc(itemNoun(1)) + "</p>");
    $view.innerHTML = h.join("");
    $view.querySelectorAll("tr[data-href]").forEach(function (tr) {
      tr.addEventListener("click", function () { navigate(tr.dataset.href); });
    });
  }

  // ── sarga ─────────────────────────────────────────────────────────
  function padaHTML(text, cls, q) {
    return '<p class="kv-pada ' + cls + '">' + (q ? KV.highlight(text, q) : esc(text)) + "</p>";
  }
  function qFor(deva) {
    // highlight only in the representation the query was typed in
    if (!S.q) return null;
    return S.q.deva === deva ? S.q : null;
  }

  // the main text, with the samasyā (borrowed) lines marked
  function mainTextHTML(v, text, deva, q) {
    var sam = S.showSam && v.sam && v.sam.length ? v.sam : null;
    if (!sam) return padaHTML(text, deva ? "deva" : "", q);
    var byLine = {};
    sam.forEach(function (x) { (byLine[x.l] = byLine[x.l] || []).push(x.ref); });
    var tag = S.d.samasya.tag || "Src";
    var lines = text.split("\n");
    return '<p class="kv-pada ' + (deva ? "deva" : "") + '">' + lines.map(function (l, i) {
      var inner = q ? KV.highlight(l, q) : esc(l);
      if (!byLine[i]) return inner;
      return '<span class="sam-line" title="Borrowed from ' + esc(cap(pick(S.d.samasya.name, "iast"))) + " " + byLine[i].join(", ") + '">' +
        inner + '</span><a class="sam-ref" href="#source-' + parseInt(byLine[i][0], 10) + '">' + esc(tag) + " " + byLine[i].join(", ") + "</a>";
    }).join("\n") + "</p>";
  }

  function verseNode(s, v) {
    var node = el("section", "kv-verse" + (v.k === "s" ? " kv-sutra" : ""));
    node.id = "v" + v.n;
    node.dataset.metre = v.m || "";
    var main = pick(v.t);
    var h = '<a class="kv-vnum" href="#' + ref(s.num, v.n) + '" title="Permalink">' + ref(s.num, v.n) + "</a>";
    h += mainTextHTML(v, main, isDeva(), qFor(isDeva()));
    if (S.parallel) {
      h += isDeva() ? padaHTML(v.t.iast, "alt", qFor(false)) : padaHTML(v.t.deva, "alt deva", qFor(true));
    }
    var meta = "";
    if (S.showMetre && v.m) {
      meta += '<button class="chip auto" type="button" data-metre="' + esc(v.m) + '" title="Show only ' + esc(cap(v.m)) +
        ' verses (identified automatically by scansion)"><i style="background:' + colorOf(v.m) + '"></i>' + esc(metreName(v.m)) + " </button>";
    }
    if (v.g) {
      meta += '<span class="chip grp-chip" title="Syntactic unit spanning ' + v.g.from + "–" + v.g.to + '">' +
        esc(isDeva() ? v.g.label : groupLabel(v.g.label)) + " " + s.num + "." + v.g.from + "–" + v.g.to + "</span>";
    }
    var notes = (v["var"] || []).map(function (x) {
      return /[\u0900-\u097F]/.test(x) && !/^Printed|^No |^Numbering|^Verse/.test(x)
        ? '<span class="lbl">var.</span> ' + esc(x) : esc(x);
    }).concat((v.notes || []).map(esc));
    var acts = "";
    if (hasTika() && S.tikaMode === "fold" && v.c) {
      var isOpen = !!S.open[ref(s.num, v.n)];
      acts += '<button class="kv-act tika-btn' + (isOpen ? " open" : "") + '" type="button" data-act="tika">' + esc(commName()) + "</button>";
    }
    acts += '<button class="kv-act" type="button" data-act="copy" title="Copy ' + esc(itemNoun(1)) + '">Copy</button>' +
      '<button class="kv-act" type="button" data-act="link" title="Copy link to this verse">Link</button>' +
      '<button class="kv-act" type="button" data-act="cite" title="BibTeX citation">Cite</button>';
    if (v.pg != null) meta += '<span class="kv-pg inline" title="Page of the printed edition">p. ' + esc(v.pg) + "</span>";
    h += '<div class="kv-vmeta">' + meta + '<span class="kv-actions">' + acts + "</span></div>";
    if (notes.length) h += notes.map(function (x) { return '<p class="kv-app">' + x + "</p>"; }).join("");
    node.innerHTML = h;
    return node;
  }
  var GROUP_IAST = { "युग्मम्": "yugmam", "त्रिभिर्विशेषकम्": "tribhir viśeṣakam", "विशेषकम्": "viśeṣakam",
    "कलापकम्": "kalāpakam", "कुलकम्": "kulakam", "नवभि कुलकम्": "navabhiḥ kulakam" };
  function groupLabel(l) {
    if (GROUP_IAST[l]) return GROUP_IAST[l];
    if (/चतुर्भिः/.test(l)) return "caturbhiḥ kalāpakam";
    return l;
  }

  // group membership: n -> {first,last}
  function groupsOf(s) {
    var map = {};
    s.verses.forEach(function (v) {
      if (!v.g) return;
      for (var i = v.g.from; i <= v.g.to; i++) map[i] = { from: v.g.from, to: v.g.to };
    });
    return map;
  }

  function tikaItemsHTML(items, q) {
    var dv = isDeva(), lastPg = null;
    return items.map(function (it) {
      var pg = "";
      if (it.pg != null && it.pg !== lastPg) {
        pg = '<span class="kv-pg" title="Page of the printed edition">p. ' + esc(it.pg) + "</span>";
        lastPg = it.pg;
      }
      return pg + tikaItemHTML(it, dv, q) + extrasHTML(it, dv);
    }).join("");
  }
  function extrasHTML(it, dv) {
    var h = "";
    if (it.chaya) {
      h += '<p class="kv-chaya"><span class="lbl">chāyā</span>' + esc(dv ? it.chaya : (it.chaya_iast || it.chaya)) + "</p>";
    }
    if (it.tips && it.tips.length) {
      var tips = dv ? it.tips : (it.tips_iast || it.tips);
      h += '<ul class="kv-tips"><li class="lbl">ṭippaṇa</li>' +
        tips.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>";
    }
    return h;
  }
  function tikaItemHTML(it, dv, q) {
    var txt = dv ? it.deva : it.iast;
    if (it.t === "v") return '<p class="q' + (it.n ? " ex" : "") + '">' +
      (it.n ? '<span class="ex-num" title="Example ' + esc(it.n) + '">' + esc(it.n) + "</span>" : "") +
      (q ? KV.highlight(txt, q) : esc(txt)) + "</p>";
    if (it.t === "src") return '<p class="src">' + esc(txt) + "</p>";
    if (it.t === "note") return '<p class="ed-note">' + esc(txt) + "</p>";
    if (it.t === "h") return '<h4 class="kv-sec">' + esc(txt) + "</h4>";
    if (it.t === "lead") return '<p class="lead">' + (q ? KV.highlight(txt, q) : esc(txt)) + "</p>";
    // pratīka: opening citation of the verse, closed by the abbreviation mark
    var m = txt.match(dv ? /^(.{1,80}?[०॰])(\s*[।,]?)/ : /^(.{1,80}?°)(\s*[|,]?)/);
    if (m && !/[('‘(]/.test(m[1])) {           // a citation like "(सम्मति कां०" is not a pratīka
      var rest = txt.slice(m[0].length);
      return '<p><span class="pratika">' + (q ? KV.highlight(m[1], q) : esc(m[1])) + "</span>" + esc(m[2]) +
        (q ? KV.highlight(rest, q) : esc(rest)) + "</p>";
    }
    return "<p>" + (q ? KV.highlight(txt, q) : esc(txt)) + "</p>";
  }
  function layerLabel(key) {
    var cs = S.d.commentary || [], c = null;
    cs.forEach(function (x) { if (x.label === key) c = x; });
    if (!c) return commentaryLabel();
    var nm = isDeva() ? pick(c.name, "deva") : cap(pick(c.name, latinKey()));
    var au = c.author ? pick(c.author, isDeva() ? "deva" : latinKey()) : "";
    return nm + (au ? " · " + cap(au) : "");
  }
  function tikaBlock(items) {
    var box = el("div", "kv-tika" + (isDeva() ? " deva" : ""));
    var q = S.q && (S.q.deva === isDeva()) ? S.q : null;
    // group by commentary layer, keeping order of first appearance
    var order = [], by = {};
    items.forEach(function (it) {
      var k = it.l || "_";
      if (!by[k]) { by[k] = []; order.push(k); }
      by[k].push(it);
    });
    var h = "";
    order.forEach(function (k, i) {
      var label = k === "_" ? commentaryLabel() : layerLabel(k);
      if (i === 0) {
        h += '<p class="kv-tika-label">' + esc(label) + "</p>" + tikaItemsHTML(by[k], q);
      } else {
        h += '<details class="kv-layer"' + (S.layerOpen || q ? " open" : "") + '><summary>' + esc(label) +
          ' <span class="cnt">' + by[k].length + "</span></summary>" + tikaItemsHTML(by[k], q) + "</details>";
      }
    });
    box.innerHTML = h;
    box.addEventListener("toggle", function (e) {
      if (e.target.classList && e.target.classList.contains("kv-layer")) {
        S.layerOpen = e.target.open; KV.store.set("kv-layer2", S.layerOpen ? "1" : "0");
      }
    }, true);
    return box;
  }

  function attachTika(node, s, v, t, groups) {
    var old = node.querySelector(".kv-tika, .kv-tika-ref, .kv-tika-loading");
    while (old) { old.remove(); old = node.querySelector(".kv-tika, .kv-tika-ref, .kv-tika-loading"); }
    var items = t.verses[String(v.n)];
    if (items) { node.appendChild(tikaBlock(items)); return; }
    var g = groups[v.n];
    if (g && g.to !== v.n) {
      node.appendChild(el("p", "kv-tika-ref", esc(commName()) + " for this " + esc(itemNoun(1)) + " is given with <a href=\"#" + ref(s.num, g.to) + "\">" +
        ref(s.num, g.to) + "</a>, where the unit closes."));
    }
  }

  function topicsHTML(s) {
    if (!s.topics || !s.topics.length) return "";
    return '<details class="kv-topics"><summary>Topics · ' + s.topics.length + "</summary><ul>" +
      s.topics.map(function (t) { return '<li class="' + (t.sub ? "sub" : "") + '">' + esc(pick(t.t)) + "</li>"; }).join("") +
      "</ul></details>";
  }

  function renderSarga(view) {
    var s = S.d.sargas[view.s - 1];
    var groups = groupsOf(s);
    var head = el("div", "sarga-head");
    head.innerHTML = '<div class="sarga-kicker">' + esc(unitName()) + " " + s.num + " / " + S.d.sargas.length + "</div>" +
      '<h2 class="sarga-title">' + esc(cap(sargaName(s))) + "</h2>" +
      (s.subtitle ? '<div class="sarga-en">' + esc(s.subtitle) + "</div>" : "") +
      '<div class="sarga-sub">' + s.count + " " + esc(itemNoun(s.count)) + "</div>" +
      (s.metres.length && !isSutraWork() ? metreBar(s.metres, s.count) : "") + (s.metres.length ? metreLegend(s.metres, true) : "") +
      topicsHTML(s) +
      (S.metreFilter ? '<div class="filter-pill">Showing only ' + esc(metreName(S.metreFilter)) +
        ' <button type="button" data-act="clear-filter" aria-label="Clear filter">✕</button></div>' : "");
    $view.appendChild(head);

    var wrap = el("div", "kv-verses");
    var introBox = el("div");
    wrap.appendChild(introBox);
    var nodes = {};
    s.verses.forEach(function (v) {
      var n = verseNode(s, v);
      var g = groups[v.n];
      if (g) {
        n.classList.add("grp");
        if (v.n === g.from) n.classList.add("grp-first");
        if (v.n === g.to) n.classList.add("grp-last");
      }
      if (S.metreFilter && v.m !== S.metreFilter) n.classList.add("dim");
      if (v.h && !S.metreFilter) wrap.appendChild(el("h3", "kv-sec-head", esc(pick(v.h, isDeva() ? "deva" : latinKey()))));
      nodes[v.n] = n;
      wrap.appendChild(n);
      if (v.r && !S.metreFilter) wrap.appendChild(el("div", "kv-rubric", esc(pick(v.r, isDeva() ? "deva" : latinKey()))));
    });
    $view.appendChild(wrap);

    if (s.colophon) {
      $view.appendChild(el("p", "kv-colophon", esc(isDeva() ? s.colophon.deva : s.colophon.iast)));
    }
    // pager
    var pager = el("nav", "kv-pager");
    var prev = S.d.sargas[s.num - 2], next = S.d.sargas[s.num];
    pager.innerHTML =
      (prev ? '<a class="prev" href="#s' + prev.num + '"><small>← ' + esc(unitName()) + " " + prev.num + "</small>" + esc(cap(sargaName(prev))) + "</a>" : "") +
      (next ? '<a class="next" href="#s' + next.num + '"><small>' + esc(unitName()) + " " + next.num + " →</small>" + esc(cap(sargaName(next))) + "</a>"
        : (S.d.prasasti ? '<a class="next" href="#prasasti"><small>Close →</small>' + esc(cap(pick(S.d.prasasti.heading))) + "</a>" : ""));
    $view.appendChild(pager);

    // interactions
    head.addEventListener("click", function (e) {
      var b = e.target.closest("[data-metre],[data-act]");
      if (!b) return;
      S.metreFilter = b.dataset.act === "clear-filter" || S.metreFilter === b.dataset.metre ? null : b.dataset.metre;
      renderView(true);
    });
    wrap.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      var node = b.closest(".kv-verse"), vn = +node.id.slice(1);
      var v = verseByNum(s, vn);
      if (b.dataset.metre) {
        S.metreFilter = S.metreFilter === b.dataset.metre ? null : b.dataset.metre;
        renderView(true);
        if (!S.metreFilter) focusVerse(vn, true);
        return;
      }
      var act = b.dataset.act;
      if (act === "tika") {
        var key = ref(s.num, vn);
        if (S.open[key]) {
          delete S.open[key];
          b.classList.remove("open");
          var tb = node.querySelector(".kv-tika"); if (tb) tb.remove();
        } else {
          S.open[key] = true;
          b.classList.add("open");
          var ld = el("p", "kv-tika-loading", "Loading " + commName().toLowerCase() + "…");
          node.appendChild(ld);
          loadTika(s.num).then(function (t) { ld.remove(); attachTika(node, s, v, t, groups); });
        }
      } else if (act === "copy") {
        copy(pick(v.t) + "\n— " + plainTitle() + " " + ref(s.num, vn), cap(itemNoun(1)) + " copied");
      } else if (act === "link") {
        copy(location.origin + location.pathname + "?k=" + S.slug + "#" + ref(s.num, vn), "Link copied");
      } else if (act === "cite") {
        var box = node.querySelector(".cite-box");
        if (box) { box.remove(); return; }
        box = el("div", "cite-box");
        var bib = bibtex(s, v);
        box.innerHTML = "<pre>" + esc(bib) + '</pre><button type="button">Copy BibTeX</button>';
        box.querySelector("button").addEventListener("click", function () { copy(bib, "BibTeX copied"); });
        node.appendChild(box);
      }
    });

    // ṭīkā for the whole sarga
    var wantAll = hasTika() && S.tikaMode === "open";
    var wantSome = hasTika() && S.tikaMode === "fold" && Object.keys(S.open).some(function (k) { return k.indexOf(s.num + ".") === 0; });
    if (wantAll || wantSome) {
      loadTika(s.num).then(function (t) {
        if (!S.view || S.view.name !== "sarga" || S.view.s !== s.num) return;
        if (t.intro && t.intro.length && wantAll) introBox.appendChild(tikaBlock(t.intro));
        var todo = s.verses.filter(function (v) { return wantAll || S.open[ref(s.num, v.n)]; });
        if (todo.length > 12 && "IntersectionObserver" in window) {
          // a long unit: render each commentary as its passage comes within ~2 screens
          if (S.io) S.io.disconnect();
          var byNode = new Map();
          S.io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
              if (!en.isIntersecting) return;
              var v = byNode.get(en.target);
              S.io.unobserve(en.target);
              if (v && en.target.isConnected) attachTika(en.target, s, v, t, groups);
            });
          }, { rootMargin: "1600px 0px 1600px 0px" });
          todo.forEach(function (v) { byNode.set(nodes[v.n], v); S.io.observe(nodes[v.n]); });
        } else {
          todo.forEach(function (v) { attachTika(nodes[v.n], s, v, t, groups); });
        }
        if (view.v) focusVerse(view.v);
      });
    }
    if (view.v) focusVerse(view.v);
  }

  function focusVerse(n, quiet) {
    var node = document.getElementById("v" + n);
    if (!node) return;
    if (node.classList.contains("dim")) { S.metreFilter = null; renderView(true); node = document.getElementById("v" + n); }
    node.scrollIntoView({ block: "start" });
    if (!quiet) {
      node.classList.remove("flash");
      void node.offsetWidth;
      node.classList.add("flash");
    }
  }

  function bibtex(s, v) {
    var d = S.d, ed = d.edition || {};
    var L = ["@incollection{" + d.slug + "_" + s.num + "_" + v.n + ","];
    L.push("  author    = {" + cap(pick(d.author.name, "iast")) + "},");
    L.push("  title     = {" + cap(pick(d.title, "iast")) + ", " + d.unit.iast + " " + s.num + ", " +
      (isSutraWork() ? "sū." : "v.") + " " + v.n + "},");
    if (ed.editor) L.push("  editor    = {" + ed.editor + "},");
    if (ed.series) L.push("  series    = {" + ed.series + "},");
    if (ed.publisher) L.push("  publisher = {" + ed.publisher + "},");
    if (ed.year) L.push("  year      = {" + ed.year + "},");
    if (ed.source) L.push("  note      = {" + ed.source + "; Jaina Literature Portal},");
    L.push("  url       = {" + location.origin + location.pathname + "?k=" + d.slug + "#" + ref(s.num, v.n) + "}");
    L.push("}");
    return L.join("\n");
  }

  // ── chandas index ─────────────────────────────────────────────────
  function renderMetres() {
    var d = S.d, h = [];
    h.push('<div class="sarga-head"><div class="sarga-kicker">Chandas index</div><h2 class="sarga-title">' +
      (isDeva() ? "छन्दःसूची" : (isSutraWork() ? "Metres of the verse portions" : "Metres of the poem")) +
      '</h2><div class="sarga-sub">' + d.metres.length + " metres across " +
      d.verse_count + " verses. Each verse was scanned laghu/guru and matched to a known metre, so an OCR slip can cause a miss.</div></div>");
    // sequence strip: every verse coloured by metre, grouped by sarga
    h.push('<div class="kv-block"><p class="section-label">Metrical sequence, verse by verse</p>');
    d.sargas.forEach(function (s) {
      h.push('<div style="display:flex;gap:10px;align-items:center"><span class="lg-row"><small>' + s.num + '</small></span><div class="sequence">' +
        s.verses.filter(function (v) { return v.k !== "s"; }).map(function (v) {
          return '<a href="#' + ref(s.num, v.n) + '" style="background:' + (v.m ? colorOf(v.m) : "#d8ceb0") + '" title="' +
            ref(s.num, v.n) + " · " + esc(v.m ? cap(v.m) : "unidentified") + '"></a>';
        }).join("") + "</div></div>");
    });
    h.push(metreLegend(d.metres, false) + "</div>");
    d.metres.forEach(function (m) {
      var name = m[0], pat = KV.METRE_PATTERNS[name], note = KV.METRE_NOTES[name];
      var patHTML = "";
      if (Array.isArray(pat)) {
        patHTML = '<div class="lg-row"><small>' + (name === "upajāti" ? "a" : "odd") + "</small>" + KV.patternHTML(pat[0]) + "</div>" +
          '<div class="lg-row"><small>' + (name === "upajāti" ? "b" : "even") + "</small>" + KV.patternHTML(pat[1]) + "</div>";
      } else if (pat) {
        patHTML = '<div class="lg-row"><small>pāda</small>' + KV.patternHTML(pat) + "</div>";
      }
      var refs = [];
      d.sargas.forEach(function (s) {
        var vs = s.verses.filter(function (v) { return v.m === name; });
        if (!vs.length) return;
        refs.push('<span class="sep">' + esc(unitName()) + " " + s.num + " · " + vs.length + "</span>");
        vs.forEach(function (v) { refs.push('<a href="#' + ref(s.num, v.n) + '">' + ref(s.num, v.n) + "</a>"); });
      });
      h.push('<div class="chandas-row" id="m-' + esc(name) + '"><h3><i style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' +
        colorOf(name) + '"></i>' + esc(cap(name)) + '<span class="deva">' + esc((d.metre_names[name] || {}).deva || "") + "</span>" +
        '<span class="cnt">' + m[1] + " verses</span></h3>" + patHTML +
        (note ? '<p class="note">' + esc(note) + "</p>" : "") +
        '<div class="refs">' + refs.join("") + "</div></div>");
    });
    var unid = [];
    d.sargas.forEach(function (s) { s.verses.forEach(function (v) { if (!v.m && v.k !== "s") unid.push(ref(s.num, v.n)); }); });
    if (unid.length) {
      h.push('<div class="chandas-row"><h3>Unidentified<span class="cnt">' + unid.length + " verses</span></h3>" +
        '<p class="note">Scansion found no match, usually because of a slip in the source text.</p><div class="refs">' +
        unid.map(function (r) { return '<a href="#' + r + '">' + r + "</a>"; }).join("") + "</div></div>");
    }
    $view.innerHTML = h.join("");
  }

  // ── prastāvanā / praśasti ────────────────────────────────────────
  function renderIntro() {
    var fm = S.d.frontmatter || {}, h = [];
    h.push('<div class="sarga-head"><div class="sarga-kicker">Front matter</div><h2 class="sarga-title">' +
      (fm.lang === "gu" ? "प्रस्तावना" : esc(introTitle())) + "</h2>" +
      '<div class="sarga-sub">' + esc(fm.label || "") + "</div></div>");
    h.push('<p class="lang-note">' + esc(fm.note || (fm.lang === "gu"
      ? "Reproduced as printed in the edition. The language is Gujarati, set in Devanagari type."
      : "Reproduced as printed.")) + "</p>");
    h.push('<div class="fm' + (fm.lang === "en" ? " latin" : "") + '" lang="' + esc(fm.lang || "") + '">');
    (fm.items || []).forEach(function (it) {
      if (it.t === "h") h.push("<h3>" + esc(it.text) + "</h3>");
      else if (it.t === "pre") h.push("<pre>" + esc(it.text) + "</pre>");
      else if (it.t === "ol") h.push("<ol>" + it.items.map(function (li) { return "<li>" + esc(li) + "</li>"; }).join("") + "</ol>");
      else h.push("<p>" + esc(it.text) + "</p>");
    });
    h.push("</div>");
    $view.innerHTML = h.join("");
  }

  function renderPrasasti() {
    var p = S.d.prasasti, h = [];
    h.push('<div class="sarga-head"><div class="sarga-kicker">Close of the work</div><h2 class="sarga-title">' +
      esc(pick(p.heading)) + '</h2><div class="sarga-sub">' + esc(p.note || "") + "</div></div>");
    h.push('<div class="kv-verses">');
    p.verses.forEach(function (v, i) {
      h.push('<section class="kv-verse" id="p' + (i + 1) + '"><span class="kv-vnum">' + (v.n || "") + "</span>" +
        padaHTML(pick(v.t), isDeva() ? "deva" : "", null) +
        (S.parallel ? (isDeva() ? padaHTML(v.t.iast, "alt", null) : padaHTML(v.t.deva, "alt deva", null)) : "") + "</section>");
    });
    h.push("</div>");
    (p.colophon || []).forEach(function (c) { h.push('<p class="kv-colophon">' + esc(pick(c)) + "</p>"); });
    var last = S.d.sargas[S.d.sargas.length - 1];
    h.push('<nav class="kv-pager"><a class="prev" href="#s' + last.num + '"><small>← ' + esc(unitName()) + " " + last.num + "</small>" +
      esc(cap(sargaName(last))) + '</a><a class="next" href="#overview"><small>Back to</small>Overview</a></nav>');
    $view.innerHTML = h.join("");
  }

  // ── samasyā source: the borrowed poem, rebuilt ───────────────────
  function renderSource(view) {
    var src = S.d.samasya, h = [];
    var name = cap(pick(src.name, "iast"));
    var nLines = src.verses.reduce(function (a, v) { return a + v.lines.length; }, 0);
    h.push('<div class="sarga-head"><div class="sarga-kicker">Samasyā source</div><h2 class="sarga-title">' +
      esc(isDeva() ? pick(src.name, "deva") : name) + "</h2>" +
      '<div class="sarga-sub">' + esc(src.author || "") + " · " + src.verses.length + " verses, " + nLines +
      " lines as embedded in " + esc(plainTitle()) + "</div></div>");
    if (src.note) h.push('<p class="lang-note">' + esc(src.note) + " Each line links to the verse that takes it up.</p>");
    h.push('<div class="kv-verses">');
    src.verses.forEach(function (v) {
      var body = "abcd".split("").map(function (p) {
        var line = null;
        v.lines.forEach(function (l) { if (l.p === p) line = l; });
        if (!line) return '<span class="src-line missing"><i>' + p + "</i> — not embedded in this text</span>";
        var uses = line.used.map(function (r) { return '<a href="#' + r + '">' + r + "</a>"; }).join(" ");
        return '<span class="src-line"><i>' + p + "</i>" + esc(pick(line.t)) +
          (uses ? '<span class="src-uses">→ ' + uses + "</span>" : "") + "</span>";
      }).join("");
      h.push('<section class="kv-verse src-verse" id="src-' + v.n + '"><span class="kv-vnum">' + v.n + "</span>" +
        '<div class="kv-pada' + (isDeva() ? " deva" : "") + '">' + body + "</div></section>");
    });
    h.push("</div>");
    $view.innerHTML = h.join("");
  }

  // ── search ────────────────────────────────────────────────────────
  function renderSearch() {
    var q = S.q, d = S.d;
    var head = el("div", "kv-results-head");
    head.innerHTML = '<h2>Results for “' + esc(S.query) + '”</h2><span class="kv-scope">' +
      '<label><input type="checkbox" data-scope="mula"' + (S.scope.mula ? " checked" : "") + ">Mūla</label>" +
      (hasTika() ? '<label><input type="checkbox" data-scope="tika"' + (S.scope.tika ? " checked" : "") + ">" + esc(commName()) + "</label>" : "") +
      "</span>";
    $view.appendChild(head);
    head.addEventListener("change", function (e) {
      S.scope[e.target.dataset.scope] = e.target.checked;
      renderView(true);
    });
    var body = el("div");
    $view.appendChild(body);
    var info = el("p", "section-label");
    info.style.marginTop = "14px";
    body.appendChild(info);

    var field = q.deva ? "deva" : "iast";
    var mulaHits = [];
    if (S.scope.mula) {
      d.sargas.forEach(function (s) {
        s.verses.forEach(function (v) {
          var r = KV.findRanges(v.t[field], q);
          if (r) mulaHits.push({ s: s, v: v, html: KV.markRanges(v.t[field], r) });
        });
      });
    }
    function draw(tikaHits, tikaPending) {
      var total = mulaHits.length + (tikaHits ? tikaHits.length : 0);
      info.textContent = mulaHits.length + " in the mūla" + (hasTika() && S.scope.tika ?
        (tikaPending ? " · searching the " + commName().toLowerCase() + "…" : " · " + tikaHits.length + " in the " + commName().toLowerCase()) : "") +
        (q.deva ? " · Devanagari match" : " · diacritics and spacing ignored");
      var list = body.querySelector(".hits") || el("div", "hits");
      var bySarga = {};
      mulaHits.forEach(function (h) { (bySarga[h.s.num] = bySarga[h.s.num] || []).push(h); });
      (tikaHits || []).forEach(function (h) { (bySarga[h.s.num] = bySarga[h.s.num] || []).push(h); });
      var html = [], shown = 0, LIMIT = 400;
      Object.keys(bySarga).map(Number).sort(function (a, b) { return a - b; }).forEach(function (sn) {
        var hs = bySarga[sn].sort(function (a, b) { return a.v.n - b.v.n || (a.kind ? 1 : -1); });
        html.push('<p class="hit-group-h">' + esc(unitName()) + " " + sn + " · " + esc(cap(sargaName(d.sargas[sn - 1]))) + " · " + hs.length + "</p>");
        hs.forEach(function (h) {
          if (shown++ >= LIMIT) return;
          html.push('<a class="hit' + (h.kind ? " tika-hit" : "") + '" href="#' + ref(sn, h.v.n) + '" data-tika="' + (h.kind ? ref(sn, h.v.n) : "") + '">' +
            '<div class="hit-head"><b>' + ref(sn, h.v.n) + '</b><span class="kind">' + (h.kind ? commName().toLowerCase() : "mūla") + "</span>" +
            (h.v.m ? "<span>" + esc(metreName(h.v.m)) + "</span>" : "") + "</div>" +
            '<div class="hit-body' + (q.deva ? " deva" : "") + (h.kind ? " small" : "") + '">' + h.html + "</div></a>");
        });
      });
      if (shown > LIMIT) html.push('<p class="kv-empty">Showing the first ' + LIMIT + " of " + total + " results. Add a word to narrow the search.</p>");
      if (!total && !tikaPending) html.push('<p class="kv-empty">Nothing found. Try fewer letters, or type in Devanagari.</p>');
      list.innerHTML = html.join("");
      if (!list.parentNode) body.appendChild(list);
    }
    draw(null, hasTika() && S.scope.tika);
    body.addEventListener("click", function (e) {
      var a = e.target.closest("a.hit");
      if (a && a.dataset.tika) {
        if (S.tikaMode === "off") { S.tikaMode = "fold"; syncToolbar(); }
        S.open[a.dataset.tika] = true;
      }
    });
    if (hasTika() && S.scope.tika) {
      var myQuery = S.query;
      loadAllTika().then(function () {
        if (S.query !== myQuery || S.view.name !== "search") return;
        var hits = [];
        d.sargas.forEach(function (s) {
          var t = S.tika[s.num];
          Object.keys(t.verses).forEach(function (vn) {
            var items = t.verses[vn], i, sn;
            for (i = 0; i < items.length; i++) {
              sn = KV.snippet(items[i][field], q, 90);
              if (sn) { hits.push({ s: s, v: verseByNum(s, +vn), html: sn, kind: "tika" }); break; }
            }
          });
        });
        draw(hits, false);
      }, function () { info.textContent += " · could not load the " + commName().toLowerCase(); });
    }
  }

  // ── keyboard ──────────────────────────────────────────────────────
  function onKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if (e.key === "/") { e.preventDefault(); $search.focus(); return; }
    if (e.key === "g") { e.preventDefault(); document.getElementById("kv-goto").focus(); return; }
    if (e.key === "t" && hasTika()) {
      var i = TIKA_MODES.findIndex(function (m) { return m.key === S.tikaMode; });
      S.tikaMode = TIKA_MODES[(i + 1) % TIKA_MODES.length].key;
      KV.store.set("kv-tika", S.tikaMode); S.open = {};
      syncToolbar(); renderView(true);
      toast(commName() + ": " + TIKA_MODES.find(function (m) { return m.key === S.tikaMode; }).label);
      return;
    }
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && S.view && S.view.name === "sarga") {
      var n = S.view.s + (e.key === "ArrowRight" ? 1 : -1);
      if (S.d.sargas[n - 1]) navigate("#s" + n);
      else if (n > S.d.sargas.length && S.d.prasasti) navigate("#prasasti");
    }
  }

  // ── init ──────────────────────────────────────────────────────────
  function init() {
    $main = document.getElementById("kv-main");
    $toc = document.getElementById("kv-toc");
    if (!S.slug) { $main.innerHTML = '<p class="error">No kāvya specified. <a href="./">Browse the Kāvyas</a>.</p>'; return; }
    fetch("data/" + S.slug + "/mula.json")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        S.d = d;
        d.metres.forEach(function (m, i) { metreColor[m[0]] = KV.PALETTE[i % KV.PALETTE.length]; });
        $main.innerHTML = "";
        $view = el("div", "kv-view");
        $view.id = "kv-view";
        $main.appendChild($view);
        renderHeader();
        renderTOC();
        renderToolbar();
        window.addEventListener("hashchange", route);
        document.addEventListener("keydown", onKey);
        route();
      })
      .catch(function (err) {
        $main.innerHTML = '<p class="error">Could not load “' + esc(S.slug) + '”.</p>';
        if (window.console) console.error(err);
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
