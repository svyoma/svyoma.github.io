/* jl.js — generic text renderer for the Jaina Literature Portal.
   Loads data/texts/<slug>.json (built by build.py) and renders it into text.html.
   Unified rich schema: title/author/metre/section-heading/colophon carry all 5
   scripts (deva, iast, iso, hk, slp1); blurb/about/overview/note/edition are
   literal prose. Zero dependencies. */
(function () {
  "use strict";

  var SCRIPTS = [
    { key: "deva", label: "देव" },
    { key: "iast", label: "IAST" },
    { key: "iso", label: "ISO" },
    { key: "hk", label: "HK" }
  ];
  var STORE_KEY = "jl-script";
  var STORE_TRANS = "jl-trans";

  function qs(name) { return new URLSearchParams(location.search).get(name); }
  function langLabel(code) {
    var m = { en: "English", hi: "हिन्दी", gu: "ગુજરાતી", sa: "Sanskrit", mr: "मराठी" };
    return m[code] || (code || "").toUpperCase();
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return (s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  // pick a script-family object's value for the active script, falling back to deva
  function pick(obj) {
    if (!obj) return "";
    return obj[currentScript()] || obj.deva || obj.iast || "";
  }

  var state = { text: null, script: localStorage.getItem(STORE_KEY) || "deva", mode: "single",
    showTrans: localStorage.getItem(STORE_TRANS) === "1", scrolled: false };

  function currentScript() {
    return SCRIPTS.some(function (s) { return s.key === state.script; }) ? state.script : "deva";
  }

  function padaHTML(padas, key) {
    var cls = "pada-block" + (key === "deva" ? " deva" : "");
    return '<p class="' + cls + '">' + esc(padas[key] || "") + "</p>";
  }

  function verseNode(v) {
    var node = el("section", "verse");
    node.id = "v" + v.num;
    node.innerHTML = '<span class="verse-num">' + v.num + "</span>" +
      '<a class="verse-permalink" href="#v' + v.num + '" title="Link to verse ' + v.num + '">¶</a>';

    var body = el("div", "stack");
    if (state.mode === "compare") {
      SCRIPTS.forEach(function (s) {
        if (v.padas[s.key]) {
          body.insertAdjacentHTML("beforeend",
            padaHTML(v.padas, s.key).replace('class="pada-block',
              'data-s="' + s.key + '" class="pada-block'));
        }
      });
    } else {
      body.insertAdjacentHTML("beforeend", padaHTML(v.padas, currentScript()));
    }
    node.appendChild(body);

    if (state.showTrans) {
      (v.translations || []).forEach(function (t) {
        node.appendChild(el("div", "translation",
          '<span class="lbl">' + esc(langLabel(t.lang)) + "</span>" + esc(t.text)));
      });
    }
    (v.commentary || []).forEach(function (c) {
      node.appendChild(el("div", "commentary",
        "<strong>" + esc(cap(c.label)) + ".</strong> " + esc(pick(c))));
    });
    (v.apparatus || []).forEach(function (a) {
      node.appendChild(el("div", "apparatus", esc(a.note)));
    });

    var cite = el("button", "cite-btn", "Cite");
    var box = el("div", "cite-box");
    cite.addEventListener("click", function () {
      if (!box.classList.contains("open")) {
        box.innerHTML = "";
        box.appendChild(el("pre", null, esc(bibtex(state.text, v))));
        var copy = el("button", "copy", "Copy BibTeX");
        copy.addEventListener("click", function () {
          navigator.clipboard.writeText(bibtex(state.text, v));
          copy.textContent = "Copied ✓";
        });
        box.appendChild(copy);
      }
      box.classList.toggle("open");
    });
    node.appendChild(cite);
    node.appendChild(box);
    return node;
  }

  function bibtex(t, v) {
    var ed = t.edition || {};
    var key = t.slug + "_v" + v.num;
    var title = ((t.title && (t.title.iast || t.title.deva)) || t.slug) + ", v. " + v.num;
    var author = ed.author_display ||
      (t.author && t.author.name && (t.author.name.iast || t.author.name.deva)) || "";
    var url = location.origin + location.pathname + "?slug=" + t.slug + "#v" + v.num;
    var L = ["@incollection{" + key + ","];
    L.push("  author    = {" + author + "},");
    L.push("  title     = {" + title + "},");
    if (ed.editor) L.push("  editor    = {" + ed.editor + "},");
    if (ed.publication) L.push("  booktitle = {" + ed.publication + "},");
    if (ed.publisher) L.push("  publisher = {" + ed.publisher + "},");
    if (ed.year) L.push("  year      = {" + ed.year + "},");
    if (ed.digitized_by) L.push("  note      = {Digitized by " + ed.digitized_by + "},");
    L.push("  url       = {" + url + "}");
    L.push("}");
    return L.join("\n");
  }

  function langTag(lang) {
    var map = { sanskrit: "tag-sanskrit", prakrit: "tag-prakrit",
      apabhramsha: "tag-apabhramsha", sauraseni: "tag-sauraseni" };
    return '<span class="tag ' + (map[lang] || "tag-prakrit") + '">' + esc(cap(lang)) + "</span>";
  }

  function metaPanel(t) {
    var ed = t.edition || {};
    var rows = [
      ["Edition", ed.name],
      ["Publisher", ed.publisher],
      ["Publication", ed.publication],
      ["Editor", ed.editor],
      ["Period", t.period || (t.author && t.author.period)],
      ["Sect", t.sect || (t.author && t.author.sect)],
      ["Digitised by", ed.digitized_by]
    ].filter(function (r) { return r[1]; });
    if (!rows.length) return null;
    var meta = el("div", "meta-panel");
    meta.innerHTML = '<p class="meta-panel-label">Publication Details</p><div class="meta-grid">' +
      rows.map(function (r) {
        return '<span class="meta-key">' + r[0] + '</span><span class="meta-val">' + esc(r[1]) + "</span>";
      }).join("") + "</div>";
    return meta;
  }

  function analysisNode(extras) {
    if (!extras || !extras.analysisTable || !extras.analysisTable.length) return null;
    var d = el("details", "analysis");
    var rows = extras.analysisTable.map(function (r) {
      return '<span class="ana-cell"><b>' + esc(r[0]) + "</b> " + r[1] + "</span>";
    }).join("");
    d.innerHTML = "<summary>Akṣara frequency (" + extras.analysisTable.length +
      " characters)</summary><div class=\"ana-grid\">" + rows + "</div>";
    return d;
  }

  function render() {
    var t = state.text;
    var title = cap((t.title && (t.title.iast || t.title.deva)) || t.slug);
    var authorObj = t.author || {};
    var authorName = authorObj.name ? cap(authorObj.name.iast || authorObj.name.deva || "") : "";
    document.title = title + " — Jaina Literature Portal";

    // ---- header ----
    var head = document.getElementById("jl-header");
    head.innerHTML =
      '<div class="header-inner">' +
      '<a class="back-link" href="./">&#8592; Jaina Literature Portal</a>' +
      (t.accession ? '<span class="accession-badge">' + esc(t.accession.replace("-", " · ")) + "</span>" : "") +
      '<h1 class="text-title">' + esc(title) + "</h1>" +
      (authorName ? '<p class="text-author">' + esc(authorName) +
        (authorObj.note ? ' <span class="author-note">— ' + esc(authorObj.note) + "</span>" : "") + "</p>" : "") +
      '<div class="tags">' +
        (t.language || []).map(langTag).join("") +
        (t.genre ? '<span class="tag tag-genre">' + esc(cap(t.genre)) + "</span>" : "") +
      "</div>" +
      "</div>";

    // ---- main ----
    var main = document.getElementById("jl-main");
    main.innerHTML = "";

    if (t.blurb) main.appendChild(el("p", "blurb", esc(t.blurb)));

    var mp = metaPanel(t);
    if (mp) main.appendChild(mp);

    if (t.about && t.about.length) {
      var about = el("div", "about");
      about.innerHTML = '<p class="section-label">About this text</p>' +
        t.about.map(function (p) { return "<p>" + p + "</p>"; }).join(""); // about is trusted HTML
      main.appendChild(about);
    }

    if (t.overview && t.overview.length) {
      var ov = el("div", "overview");
      ov.innerHTML = '<p class="section-label">Structure</p><ul>' +
        t.overview.map(function (li) { return "<li>" + esc(li) + "</li>"; }).join("") + "</ul>";
      main.appendChild(ov);
    }

    if (t.note) main.appendChild(el("div", "note-callout", esc(t.note)));

    if (t.metre && t.metre.length) {
      var mtxt = t.metre.map(function (m) {
        var nm = cap(pick(m.name));
        var lak = m.lakshana ? ' <span class="lakshana">' + esc(pick(m.lakshana)) + "</span>" : "";
        return "<strong>" + esc(nm) + "</strong>" + (m.verses ? " (" + esc(m.verses) + ")" : "") + lak;
      }).join("; ");
      main.appendChild(el("div", "metre-info", "<p><span class=\"section-label\">Metre</span> " + mtxt + "</p>"));
    }

    // toolbar: script toggle + compare
    var bar = el("div", "script-toolbar");
    var toggle = el("div", "script-toggle");
    SCRIPTS.forEach(function (s) {
      var b = el("button", "toggle-btn" + (s.key === currentScript() ? " active" : ""), s.label);
      b.addEventListener("click", function () {
        state.script = s.key; localStorage.setItem(STORE_KEY, s.key); rerender();
      });
      b.dataset.k = s.key;
      toggle.appendChild(b);
    });
    bar.appendChild(toggle);
    var cmp = el("button", "mode-btn" + (state.mode === "compare" ? " active" : ""), "Compare");
    cmp.addEventListener("click", function () {
      state.mode = state.mode === "compare" ? "single" : "compare";
      cmp.classList.toggle("active");
      renderVerses();
    });
    bar.appendChild(cmp);

    // translation toggle — only offered when the text actually carries translations
    var hasTrans = (t.verses || []).some(function (v) {
      return v.translations && v.translations.length;
    });
    if (hasTrans) {
      var tr = el("button", "mode-btn" + (state.showTrans ? " active" : ""), "Translation");
      tr.addEventListener("click", function () {
        state.showTrans = !state.showTrans;
        localStorage.setItem(STORE_TRANS, state.showTrans ? "1" : "0");
        tr.classList.toggle("active");
        renderVerses();
      });
      bar.appendChild(tr);
    }
    main.appendChild(bar);

    var vwrap = el("div", "verses");
    vwrap.id = "jl-verses";
    main.appendChild(vwrap);

    (t.colophon || []).forEach(function (c) {
      main.appendChild(el("div", "colophon", esc(pick(c))));
    });

    var ana = analysisNode(t.extras);
    if (ana) main.appendChild(ana);

    renderVerses();
    if (location.hash && !state.scrolled) {
      var tgt = document.getElementById(location.hash.slice(1));
      if (tgt) { tgt.scrollIntoView(); state.scrolled = true; }
    }
  }

  function renderVerses() {
    var wrap = document.getElementById("jl-verses");
    if (!wrap) return;
    wrap.innerHTML = "";
    var t = state.text;
    var byBefore = {};
    (t.sections || []).forEach(function (s) { if (s.before != null) byBefore[s.before] = s; });
    t.verses.forEach(function (v) {
      var sec = byBefore[v.num];
      if (sec) wrap.appendChild(el("h2", "section-heading", esc(pick(sec.heading))));
      wrap.appendChild(verseNode(v));
    });
  }

  // full re-render on script change so header/metre/colophon/sections follow the script too
  function rerender() { if (state.text) render(); }

  function init() {
    var slug = qs("slug");
    var main = document.getElementById("jl-main");
    if (!slug) { main.innerHTML = '<p class="error">No text specified.</p>'; return; }
    main.innerHTML = '<p class="loading">Loading…</p>';
    fetch("data/texts/" + slug + ".json")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { state.text = data; render(); })
      .catch(function () { main.innerHTML = '<p class="error">Could not load “' + esc(slug) + '”.</p>'; });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
