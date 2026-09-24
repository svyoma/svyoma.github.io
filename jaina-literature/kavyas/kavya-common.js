/* kavya-common.js — helpers shared by the Kāvya catalogue (index.html) and
   reader (reader.html): escaping, diacritic/space-insensitive search with
   highlight maps, metre patterns. Exposes window.KV. Zero dependencies. */
(function () {
  "use strict";

  function esc(s) {
    return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  var DEVA = /[ऀ-ॿ]/;
  // characters that count for matching: Latin letters/digits, Devanagari letters + signs
  var KEEP_LATIN = /[a-z0-9]/;
  var KEEP_DEVA = /[ऀ-ॣॱ-ॿ]/;   // excludes daṇḍas, digits

  // Fold a string for matching and keep an index map back into the original.
  // Spaces and punctuation are dropped, so "kosala iti" matches "kośaleti" and
  // a query typed without sandhi spacing still finds joined words.
  function foldMap(s, deva) {
    s = s || "";
    var folded = "", map = [], i, j, nf;
    for (i = 0; i < s.length; i++) {
      if (deva) {
        if (KEEP_DEVA.test(s[i])) { folded += s[i]; map.push(i); }
        continue;
      }
      nf = s[i].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      for (j = 0; j < nf.length; j++) {
        if (KEEP_LATIN.test(nf[j])) { folded += nf[j]; map.push(i); }
      }
    }
    map.push(s.length);
    return { folded: folded, map: map };
  }

  // A query is a list of terms (split on whitespace); every term must match.
  function parseQuery(q) {
    q = (q || "").trim();
    if (!q) return null;
    var deva = DEVA.test(q);
    var terms = q.split(/\s+/).map(function (t) { return foldMap(t, deva).folded; })
      .filter(function (t) { return t.length > 0; });
    return terms.length ? { deva: deva, terms: terms, raw: q } : null;
  }

  // Returns [[start,end],…] ranges in the ORIGINAL string, or null if any term misses.
  function findRanges(str, query) {
    if (!str || !query) return null;
    var fm = foldMap(str, query.deva), ranges = [], ok = true;
    query.terms.forEach(function (t) {
      var from = 0, idx, hit = false;
      while ((idx = fm.folded.indexOf(t, from)) !== -1) {
        ranges.push([fm.map[idx], fm.map[idx + t.length - 1] + 1]);
        from = idx + t.length;
        hit = true;
      }
      if (!hit) ok = false;
    });
    if (!ok) return null;
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    });
    return merged;
  }

  function markRanges(str, ranges) {
    if (!ranges || !ranges.length) return esc(str);
    var out = "", pos = 0;
    ranges.forEach(function (r) {
      out += esc(str.slice(pos, r[0])) + "<mark>" + esc(str.slice(r[0], r[1])) + "</mark>";
      pos = r[1];
    });
    return out + esc(str.slice(pos));
  }

  function highlight(str, query) {
    return markRanges(str || "", query ? findRanges(str, query) : null);
  }

  // A window of `radius` chars around the first hit, highlighted.
  function snippet(str, query, radius) {
    var ranges = findRanges(str, query);
    if (!ranges) return null;
    radius = radius || 90;
    var a = Math.max(0, ranges[0][0] - radius), b = Math.min(str.length, ranges[0][1] + radius * 1.6);
    // snap to spaces so words are not cut
    if (a > 0) { var sp = str.indexOf(" ", a); if (sp !== -1 && sp < ranges[0][0]) a = sp + 1; }
    if (b < str.length) { var sp2 = str.lastIndexOf(" ", b); if (sp2 > ranges[0][1]) b = sp2; }
    var part = str.slice(a, b);
    var shifted = ranges.filter(function (r) { return r[0] >= a && r[1] <= b; })
      .map(function (r) { return [r[0] - a, r[1] - a]; });
    return (a > 0 ? "… " : "") + markRanges(part, shifted) + (b < str.length ? " …" : "");
  }

  // Laghu/guru patterns (L/G) of the metres the build step identifies; shown in
  // the chandas index. Ardhasama metres carry [odd, even].
  var METRE_PATTERNS = {
    "indravajrā": "GGLGGLLGLGG", "upendravajrā": "LGLGGLLGLGG",
    "upajāti": ["GGLGGLLGLGG", "LGLGGLLGLGG"],
    "rathoddhatā": "GLGLLLGLGLG", "svāgatā": "GLGLLLGLLGG", "śālinī": "GGGGGLGGLGG",
    "dodhaka": "GLLGLLGLLGG", "vaṃśastha": "LGLGGLLGLGLG", "vaiśvadevī": "GGGGGGLGGLGG",
    "indravaṃśā": "GGLGGLLGLGLG", "drutavilambita": "LLLGLLGLLGLG", "toṭaka": "LLGLLGLLGLLG",
    "bhujaṅgaprayāta": "LGGLGGLGGLGG", "sragviṇī": "GLGGLGGLGGLG",
    "pramitākṣarā": "LLGLGLLLGLLG", "mañjubhāṣiṇī": "LLGLGLLLGLGLG",
    "praharṣiṇī": "GGGLLLLGLGLGG", "rucirā": "LGLGLLLLGLGLG", "mattamayūra": "GGGGGLLGGLLGG",
    "vasantatilakā": "GGLGLLLGLLGLGG", "mālinī": "LLLLLLGGGLGGLGG",
    "pañcacāmara": "LGLGLGLGLGLGLGLG", "śikhariṇī": "LGGGGGLLLLLGGLLLG",
    "pṛthvī": "LGLLLGLGLLLGLGGLG", "mandākrāntā": "GGGGLLLLLGGLGGLGG",
    "hariṇī": "LLLLLGGGGGLGLLGLG", "śārdūlavikrīḍita": "GGGLLGLGLLLGGGLGGLG",
    "sragdharā": "GGGGLGGLLLLLLGGLGGLGG",
    "viyoginī": ["LLGLLGLGLG", "LLGGLLGLGLG"], "puṣpitāgrā": ["LLLLLLGLGLGG", "LLLLGLLGLGLGG"]
  };
  var METRE_NOTES = {
    "anuṣṭubh": "8 syllables per pāda; 5th laghu, 6th guru; 7th guru in odd, laghu in even pādas",
    "upajāti": "Indravajrā and Upendravajrā pādas mixed within one verse",
    "āryā": "mātrā metre: 30 + 27 morae", "gīti": "mātrā metre: 30 + 30 morae",
    "upagīti": "mātrā metre: 27 + 27 morae", "udgīti": "mātrā metre: 27 + 30 morae"
  };
  function patternHTML(p) {
    return '<span class="lg">' + p.split("").map(function (c) {
      return c === "G" ? '<b title="guru">–</b>' : '<i title="laghu">⏑</i>';
    }).join("") + "</span>";
  }

  // stable, parchment-friendly palette for metre chips/bars (ranked by frequency)
  var PALETTE = ["#7a1f1f", "#a07820", "#3e6b8a", "#5a7a3a", "#8a4a7a", "#b8622a",
    "#2f6f6a", "#6b5a3a", "#9a3a4a", "#4a5a9a", "#7a8a2a", "#5a3a2a"];

  window.KV = {
    esc: esc, cap: cap, parseQuery: parseQuery, findRanges: findRanges,
    highlight: highlight, snippet: snippet, markRanges: markRanges,
    METRE_PATTERNS: METRE_PATTERNS, METRE_NOTES: METRE_NOTES, patternHTML: patternHTML,
    PALETTE: PALETTE,
    store: {
      get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
    }
  };
})();
