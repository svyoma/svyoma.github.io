/* section.js — catalogue + cross-work search for a section of sectioned works
   (Kāvyas, Darśana). Reads data/catalog.json of the page's own folder and
   links into the shared reader. The page sets
     window.KV_SECTION = { name, noun, reader }   e.g. {name:"Darśana", noun:"work", reader:"reader.html"}
   Needs kavya-common.js (window.KV). */
(function () {
  "use strict";
  var esc = KV.esc, cap = KV.cap;
  var SEC = window.KV_SECTION || {};
  var NAME = SEC.name || "Kāvyas", NOUN = SEC.noun || "kāvya", READER = SEC.reader || "reader.html";
  var works = [], mode = "browse", facet = "all", mula = {}, tika = {};
  var $list = document.getElementById("list"), $count = document.getElementById("count"),
      $q = document.getElementById("q"), $facets = document.getElementById("facets"),
      $scope = document.getElementById("scope"), $scopeTika = document.getElementById("scopeTika");

  function genreLabel(g) {
    return { mahakavya: "Mahākāvya", kavya: "Kāvya", prakarana: "Prakaraṇa", tarka: "Tarka", alankara: "Alaṅkāra", chandas: "Chandas" }[g] || cap(g || "");
  }
  function plural(n, word) { return n + " " + (n === 1 ? word : word + "s"); }
  function itemWord(k) { return (k.item && k.item.iast) || "verse"; }
  function commName(c) { return c && c.short ? c.short : c && c.name ? cap(c.name.iast) : "commentary"; }

  // a work with its own app (e.g. the Kāvyānuśāsana reader) is linked there instead of the shared reader
  function readHref(k, unit) {
    if (k.app) return k.app + (unit ? "#/" + unit : "");
    return READER + "?k=" + k.slug + (unit ? "#s" + unit : "");
  }
  function hitHref(k, unit, v) {
    if (k.app) return k.app + "#/" + (v.sid || unit);
    return READER + "?k=" + k.slug + "#" + unit + "." + v.n;
  }

  function card(k) {
    var c = (k.commentary || [])[0];
    var main = (k.metres || []).slice(0, 3).map(function (m) { return cap(m[0]); }).join(", ");
    var maxC = Math.max.apply(null, k.sarga_counts);
    var strip = k.sarga_counts.map(function (n, i) {
      return '<a href="' + readHref(k, i + 1) + '" style="height:' + (35 + 65 * n / maxC) + '%" title="' +
        esc(cap(k.unit.iast)) + " " + (i + 1) + " · " + plural(n, itemWord(k)) + '"><span>' + (i + 1) + "</span></a>";
    }).join("");
    return '<article class="entry">' +
      (k.accession ? '<span class="accession">' + esc(k.accession.replace("-", " · ")) + "</span>" : "") +
      '<h2 class="entry-title">' + esc(k.display_title || cap(k.short_title.iast)) + '<span class="deva">' + esc(k.title.deva) + "</span></h2>" +
      '<p class="entry-author">' + esc(cap(k.author.name.iast)) + (k.author.period ? ' <span style="opacity:.7">· ' + esc(k.author.period) + "</span>" : "") + "</p>" +
      (c ? '<p class="entry-comm">with the ' + esc(commName(c).toLowerCase()) + " of " + esc(cap(c.author.iast)) + "</p>" : "") +
      '<div class="tags">' + (k.language || []).map(function (l) { return '<span class="tag tag-' + l + '">' + esc(cap(l)) + "</span>"; }).join("") +
        '<span class="tag tag-genre">' + esc(genreLabel(k.genre)) + "</span>" +
        (k.tags || []).map(function (t) { return '<span class="tag tag-genre">' + esc(t) + "</span>"; }).join("") +
        (c ? '<span class="tag tag-comm">With ' + esc(commName(c)) + "</span>" : '<span class="tag tag-genre">Mūla</span>') + "</div>" +
      '<div class="entry-meta"><span>' + plural(k.sarga_count, k.unit.iast) + "</span><span>" + plural(k.verse_count, itemWord(k)) + "</span>" +
        (main && k.format === "kavya" ? "<span>" + esc(main) + "</span>" : "") + "</div>" +
      (k.blurb ? '<p class="entry-desc">' + esc(k.blurb) + "</p>" : "") +
      '<p class="strip-label">' + esc(cap(k.unit.iast)) + "s · click to open</p>" +
      '<div class="sarga-strip">' + strip + "</div>" +
      '<div class="entry-footer"><a class="read-link" href="' + readHref(k) + '">Read</a></div>' +
      "</article>";
  }

  function renderBrowse() {
    var q = KV.parseQuery($q.value);
    var shown = works.filter(function (k) {
      if (facet === "tika" && !(k.commentary || []).length) return false;
      if (facet === "mula" && (k.commentary || []).length) return false;
      if (!q) return true;
      var c = (k.commentary || [])[0] || {};
      var hay = [k.title.iast, k.title.deva, k.short_title.iast, k.display_title, k.author.name.iast, k.author.name.deva,
        c.author && c.author.iast, c.author && c.author.deva, k.blurb, k.genre, (k.tags || []).join(" ")].join(" ");
      return !!KV.findRanges(hay, q);
    });
    $list.innerHTML = shown.map(card).join("") || '<p class="kv-empty">Nothing matches.</p>';
    $count.textContent = plural(shown.length, NOUN);
  }

  function loadMula(k) {
    if (mula[k.slug]) return Promise.resolve(mula[k.slug]);
    return fetch("data/" + k.slug + "/mula.json").then(function (r) { return r.json(); })
      .then(function (d) { mula[k.slug] = d; return d; });
  }
  function loadTika(k, d) {
    if (tika[k.slug]) return Promise.resolve(tika[k.slug]);
    return Promise.all(d.sargas.map(function (s) {
      return fetch("data/" + k.slug + "/tika-" + s.num + ".json")
        .then(function (r) { return r.ok ? r.json() : { verses: {} }; }, function () { return { verses: {} }; });
    })).then(function (arr) { tika[k.slug] = arr; return arr; });
  }

  var searchSeq = 0;
  function renderSearch() {
    var q = KV.parseQuery($q.value), seq = ++searchSeq;
    if (!q) { $list.innerHTML = ""; $count.textContent = "Type to search the texts" + ($scopeTika.checked ? " and commentaries" : ""); return; }
    $count.textContent = "Searching…";
    var field = q.deva ? "deva" : "iast";
    Promise.all(works.map(function (k) {
      return loadMula(k).then(function (d) {
        var wantTika = $scopeTika.checked && (k.commentary || []).length;
        return (wantTika ? loadTika(k, d) : Promise.resolve(null)).then(function (t) { return { k: k, d: d, t: t }; });
      });
    })).then(function (all) {
      if (seq !== searchSeq) return;
      var html = [], nM = 0, nT = 0, LIMIT = 300, shown = 0;
      all.forEach(function (x) {
        var hits = [], cn = commName((x.k.commentary || [])[0]).toLowerCase();
        x.d.sargas.forEach(function (s, si) {
          s.verses.forEach(function (v) {
            var r = KV.findRanges(v.t[field], q);
            if (r) { nM++; hits.push({ s: s.num, v: v, html: KV.markRanges(v.t[field], r) }); }
            if (x.t) {
              var items = x.t[si].verses[String(v.n)] || [];
              for (var i = 0; i < items.length; i++) {
                var sn = KV.snippet(items[i][field], q, 90);
                if (sn) { nT++; hits.push({ s: s.num, v: v, html: sn, tika: cn }); break; }
              }
            }
          });
        });
        if (!hits.length) return;
        html.push('<p class="hit-group-h">' + esc(x.k.display_title || cap(x.k.short_title.iast)) + " · " + hits.length + "</p>");
        hits.forEach(function (h) {
          if (shown++ >= LIMIT) return;
          var r = h.s + "." + h.v.n;
          html.push('<a class="hit' + (h.tika ? " tika-hit" : "") + '" href="' + hitHref(x.k, h.s, h.v) + '">' +
            '<div class="hit-head"><b>' + r + '</b><span class="kind">' + (h.tika || "mūla") + "</span>" +
            (h.v.m ? "<span>" + esc(cap(h.v.m)) + "</span>" : "") + "</div>" +
            '<div class="hit-body' + (q.deva ? " deva" : "") + (h.tika ? " small" : "") + '">' + h.html + "</div></a>");
        });
      });
      if (shown > LIMIT) html.push('<p class="kv-empty">Showing the first ' + LIMIT + " results. Add a word to narrow the search.</p>");
      $list.innerHTML = html.join("") || '<p class="kv-empty">Nothing found. Try fewer letters, or type in Devanagari.</p>';
      $count.textContent = nM + " in the mūla" + ($scopeTika.checked ? " · " + nT + " in the commentaries" : "");
    });
  }

  function render() { if (mode === "browse") renderBrowse(); else renderSearch(); }

  function setMode(m) {
    mode = m;
    document.getElementById("tabBrowse").classList.toggle("active", m === "browse");
    document.getElementById("tabSearch").classList.toggle("active", m === "search");
    $facets.hidden = m !== "browse";
    $scope.hidden = m !== "search";
    $q.placeholder = m === "browse" ? "Filter by title, author, commentator…" : "Search the texts & commentaries (e.g. dharma, धर्म)…";
    $q.focus();
    render();
  }

  var t;
  $q.addEventListener("input", function () { clearTimeout(t); t = setTimeout(render, mode === "search" ? 250 : 0); });
  $scopeTika.addEventListener("change", render);
  document.getElementById("tabBrowse").addEventListener("click", function () { setMode("browse"); });
  document.getElementById("tabSearch").addEventListener("click", function () { setMode("search"); });

  fetch("data/catalog.json").then(function (r) { return r.json(); }).then(function (list) {
    works = list;
    var withT = list.filter(function (k) { return (k.commentary || []).length; }).length;
    $facets.innerHTML = [["all", "All"], ["tika", "With commentary · " + withT], ["mula", "Mūla only · " + (list.length - withT)]]
      .map(function (f) { return '<button class="filter-btn' + (f[0] === facet ? " active" : "") + '" data-f="' + f[0] + '">' + f[1] + "</button>"; }).join("");
    $facets.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      facet = b.dataset.f;
      $facets.querySelectorAll("button").forEach(function (x) { x.classList.toggle("active", x === b); });
      render();
    });
    render();
  }).catch(function () { $count.textContent = "Could not load the " + NAME + " catalogue."; });
})();
