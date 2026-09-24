/*
 * Kāvyānuśāsana reader — static, dependency-free.
 * Requires assets/translit.js (window.KT). Data URL comes from data-src on #kavya-app
 * (relative to the page), or window.KAVYA_DATA_URL.
 */
(function () {
  'use strict';

  var KT = window.KT;
  var APP = document.getElementById('kavya-app');
  if (!APP || !KT) return;
  var $ = function (id) { return document.getElementById(id); };
  var VIEW = $('kv-view');
  var DATA_URL = window.KAVYA_DATA_URL || APP.getAttribute('data-src') || 'data/kavyanusasana.json';

  /* ------------------------------------------------------------------ */
  /* Settings (persisted; storage may be unavailable)                    */
  /* ------------------------------------------------------------------ */
  var SKEY = 'kavya.settings';
  var settings = { vritti: true, viv: 'collapsed', pages: true, chaya: true, script: 'deva', size: 100 };
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  try {
    var saved = JSON.parse(load(SKEY) || 'null');
    if (saved && typeof saved === 'object') for (var sk in settings) if (saved[sk] !== undefined) settings[sk] = saved[sk];
  } catch (e) { /* ignore */ }
  function saveSettings() { store(SKEY, JSON.stringify(settings)); }

  /* ------------------------------------------------------------------ */
  /* Utilities                                                           */
  /* ------------------------------------------------------------------ */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function debounce(fn, ms) {
    var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
  }
  var DEVNUM = '०१२३४५६७८९';
  function toast(msg) {
    var t = $('kv-toast'); t.textContent = msg; t.classList.add('kv-show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('kv-show'); }, 1800);
  }
  function pageLabel(b) {
    if (b.pages && b.pages.length > 1) return 'pp. ' + b.pages[0] + '–' + b.pages[b.pages.length - 1];
    return b.page != null ? 'p. ' + b.page : '';
  }
  function tx(s) { return settings.script === 'iast' ? KT.devToIast(s) : s; }

  /* ------------------------------------------------------------------ */
  /* Data + derived indexes                                              */
  /* ------------------------------------------------------------------ */
  var D = null;
  var CH = {};          // n -> chapter
  var SEC = {};         // '1.3' -> {ch, sec}
  var BLK = {};         // block id -> {ch, sec, layer, b}
  var FRONT = {}, APPX = {};
  var TIP = {};         // ṭippaṇa note id -> note
  var ANY = {};         // any rendered block id -> {k: kind, o: object}  (used to re-render a block's text)
  var ENTRIES = [];     // search entries
  var LAYER_SA = { sutra: 'सूत्रम्', vritti: 'वृत्तिः', viveka: 'विवेकः' };
  var TYPE_SA = { example: 'उदाहरणम्', citation: 'प्रमाणम्', quote: 'उद्धरणम्', verse: 'श्लोकः', source: 'आकरः', note: 'Editor’s note', colophon: 'पुष्पिका', lead: 'अवतरणिका' };
  var X_TYPES = { example: 1, citation: 1, quote: 1, verse: 1, source: 1 };

  function prepareData(d) {
    D = d;
    d.appendices.forEach(function (a) { (a.notes || []).forEach(function (n) { TIP[n.id] = n; }); });
    d.chapters.forEach(function (ch) {
      CH[ch.n] = ch;
      ch.sections.forEach(function (s) {
        SEC[s.id] = { ch: ch, sec: s };
        if (s.sutra) {
          ENTRIES.push({ id: s.id, route: s.id, cat: 's', typ: 't', ch: ch.n, text: s.sutra.text,
            loc: s.id + ' · ' + LAYER_SA.sutra + ' [' + s.sutra.g + ']', page: s.sutra.page });
        }
        ['vritti', 'viveka'].forEach(function (layer) {
          (s[layer] || []).forEach(function (b) {
            BLK[b.id] = { ch: ch, sec: s, layer: layer, b: b };
            ANY[b.id] = { k: 'block', o: b };
            var typ = X_TYPES[b.type] ? 'x' : 't';
            var loc = s.id + ' · ' + LAYER_SA[layer];
            if (TYPE_SA[b.type]) loc += ' · ' + TYPE_SA[b.type] + (b.type === 'example' && b.num ? ' ' + b.num : '');
            ENTRIES.push({ id: b.id, route: b.id, cat: layer === 'vritti' ? 'a' : 'v', typ: typ, ch: ch.n, text: b.text,
              loc: loc, page: pageLabel(b), en: b.type === 'note' });
          });
        });
      });
      (ch.colophons || []).forEach(function (c, i) {
        c.id = ch.n + '.c' + i;
        ANY[c.id] = { k: 'html', o: c };
        ENTRIES.push({ id: c.id, route: c.id, cat: c.layer === 'viveka' ? 'v' : 'a', typ: 't', ch: ch.n, text: c.text,
          loc: ch.n + ' · ' + (c.layer === 'viveka' ? LAYER_SA.viveka + ' · ' : '') + TYPE_SA.colophon, page: c.page != null ? 'p. ' + c.page : '' });
      });
    });
    d.front.forEach(function (f) {
      FRONT[f.id] = f;
      f.blocks.forEach(function (b) {
        ANY[b.id] = { k: 'html', o: b };
        ENTRIES.push({ id: b.id, route: 'front/' + f.id + '/' + b.id, cat: 'p', typ: 't', ch: 0, text: b.text, loc: f.title, en: true, page: '' });
      });
    });
    d.appendices.forEach(function (a) {
      APPX[a.id] = a;
      (a.blocks || []).forEach(function (b) {   // generic / older shape
        ANY[b.id] = { k: 'html', o: b };
        ENTRIES.push({ id: b.id, route: 'app/' + a.id + '/' + b.id, cat: 'p', typ: 't', ch: 0, text: b.text, loc: a.title, page: pageLabel(b) });
      });
      (a.notes || []).forEach(function (n) {    // ṭippaṇa
        ANY[n.id] = { k: 'tip', o: n };
        ENTRIES.push({ id: n.id, route: 'app/' + a.id + '/' + n.id, cat: 'p', typ: 't', ch: n.chapter || 0, text: (n.lemma || '') + ' ' + (n.gloss || ''),
          loc: a.title + ' · ' + (n.section || (n.chapter ? n.chapter + '' : '')), page: n.page != null ? 'p. ' + n.page : '' });
      });
      (a.entries || []).forEach(function (e) {  // chāyā
        ANY[e.id] = { k: 'chaya', o: e };
        var r0 = (e.refs || [])[0], sec = r0 && r0.block && BLK[r0.block] ? BLK[r0.block] : null;
        ENTRIES.push({ id: e.id, route: 'app/' + a.id + '/' + e.id, cat: 'p', typ: 'x', ch: sec ? sec.ch.n : 0, text: chayaText(e),
          loc: a.title + (sec ? ' · ' + sec.sec.id : ''), page: r0 && r0.page != null ? 'p. ' + r0.page : '' });
      });
    });
  }
  function chayaText(e) {
    // must match the text content of chayaInner() for highlighting
    return (e.incipit || '') + ' ' + (e.src || '') + ' ' + (e.chaya || '');
  }

  /* ------------------------------------------------------------------ */
  /* Rendering helpers                                                   */
  /* ------------------------------------------------------------------ */
  function copyBtn(route) {
    return '<button type="button" class="kv-cl" data-link="' + esc(route) + '" aria-label="Copy link to ' + esc(route) + '" title="Copy link"></button>';
  }
  function pgSpan(label, isNew) {
    if (!label) return '';
    return '<span class="kv-pg' + (isNew ? ' kv-pg-new' : '') + '" lang="en" aria-label="page ' + esc(label.replace(/^pp?\. /, '')) + '">' + esc(label) + '</span>';
  }
  function blockHtml(b, route, tracker) {
    var lbl = pageLabel(b);
    var isNew = false;
    if (tracker && b.page != null) { isNew = tracker.last !== lbl && tracker.lastPage !== b.page; tracker.last = lbl; tracker.lastPage = b.pages ? b.pages[b.pages.length - 1] : b.page; }
    var en = b.type === 'note' ? ' lang="en"' : '';
    return '<div class="kv-b kv-t-' + esc(b.type) + (b.lemma ? ' kv-has-lemma' : '') + '" id="b-' + esc(b.id) + '">' +
      pgSpan(lbl, isNew) + '<div class="kv-bt"' + en + '>' + btInner(b) + '</div>' +
      (b.chaya ? '<div class="kv-chaya-txt"><span class="kv-chaya-label">छाया</span>' + esc(b.chaya).replace(/\n/g, '<br>') + '</div>' : '') +
      copyBtn(route || b.id) + '</div>';
  }
  /** inner html of a block's text holder (text + ṭippaṇa marker) */
  function btInner(b) { return b.html + tipBtn(b.tippana); }
  function tipBtn(ids) {
    return '';  // inline ṭippaṇa markers are switched off; the notes stay in the appendix
    if (!ids || !ids.length) return '';
    var ok = ids.filter(function (i) { return TIP[i]; });
    if (!ok.length) return '';
    return '<button type="button" class="kv-tipref" data-tips="' + esc(ok.join(',')) + '" aria-expanded="false" title="Ṭippaṇa (palm-leaf gloss): ' + ok.length + (ok.length > 1 ? ' notes' : ' note') + '">टि.' +
      (ok.length > 1 ? '<sup>' + ok.length + '</sup>' : '') + '</button>';
  }
  function tipNoteInner(n) {
    return '<b>' + esc(n.lemma || '') + '</b> ' + esc(n.gloss || '').replace(/\n/g, '<br>');
  }
  function chayaInner(e) {
    return '<b>' + esc(e.incipit || '') + '</b> <span class="kv-ce-src">' + esc(e.src || '') + '</span> <span class="kv-ce-chaya">' + esc(e.chaya || '').replace(/\n/g, '<br>') + '</span>';
  }
  /** re-creatable inner html of any block's .kv-bt, by id */
  function innerFor(id) {
    var a = ANY[id];
    if (!a) return null;
    if (a.k === 'block') return btInner(a.o);
    if (a.k === 'tip') return tipNoteInner(a.o);
    if (a.k === 'chaya') return chayaInner(a.o);
    return a.o.html;
  }
  function toggleTips(btn) {
    var holder = btn.closest('.kv-b, .kv-sutra');
    var panel = holder.querySelector(':scope > .kv-tips');
    var open = btn.getAttribute('aria-expanded') === 'true';
    if (open) { if (panel) panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); return; }
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'kv-tips';
      panel.setAttribute('lang', 'sa');
      panel.innerHTML = '<p class="kv-tips-h">टिप्पणम् <span lang="en">· anonymous palm-leaf gloss</span></p>' +
        btn.getAttribute('data-tips').split(',').map(function (id) {
          var n = TIP[id];
          return '<div class="kv-tip">' + tipNoteInner(n) + ' <a class="kv-tip-link" lang="en" href="#/app/tippana/' + esc(id) + '">' + esc(id.replace('tip.', 'Ṭ ')) + '</a></div>';
        }).join('');
      var bt = holder.querySelector(':scope > .kv-bt, :scope > .kv-sutra-text');
      if (bt && bt.nextSibling) holder.insertBefore(panel, bt.nextSibling); else holder.appendChild(panel);
      translitTree(panel);
    }
    panel.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  }
  function firstWords(t, max) {
    max = max || 30;
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    var cut = t.lastIndexOf(' ', max);
    return t.slice(0, cut > 12 ? cut : max) + '…';
  }

  /** Devanagari -> IAST on all text nodes below root (runs only in IAST mode). */
  function translitTree(root) {
    if (settings.script !== 'iast' || !root) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return /[ऀ-ॿ]/.test(n.data) && !(n.parentNode.closest && n.parentNode.closest('.kv-notx')) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    var nodes = [], n;
    while ((n = w.nextNode())) nodes.push(n);
    var orig = nodes.map(function (x) { return x.data; });
    for (var i = 0; i < nodes.length; i++) {
      // neighbours only matter when they are adjacent pieces of the same word
      var next = i + 1 < nodes.length && sameBlock(nodes[i], nodes[i + 1]) ? orig[i + 1].charAt(0) : '';
      var prev = i > 0 && sameBlock(nodes[i - 1], nodes[i]) ? orig[i - 1].charAt(orig[i - 1].length - 1) : '';
      nodes[i].data = KT.devToIast(orig[i], next, prev);
    }
  }
  function sameBlock(a, b) {
    var pa = a.parentNode.closest('.kv-bt,.kv-sutra-text,.kv-snip,p,li,h1,h2');
    return pa && pa.contains(b);
  }

  /* ------------------------------------------------------------------ */
  /* Query preparation + highlight                                       */
  /* ------------------------------------------------------------------ */
  function prepareQuery(raw, userLoose, avag) {
    raw = (raw || '').trim();
    var latin = KT.hasLatin(raw);
    var dev = latin ? KT.romanToDev(raw) : raw;
    var autoLoose = latin && /^[a-z0-9\s.\-]+$/.test(raw);
    var loose = !!userLoose || autoLoose;
    var opts = { avagraha: avag !== false, loose: loose };
    var qd = KT.normalizeQuery(dev, opts);
    var ql = latin ? KT.normalize(raw, { avagraha: opts.avagraha }).n : '';
    if (ql === qd) ql = '';
    return { raw: raw, latin: latin, dev: dev.replace(/्$/, ''), autoLoose: autoLoose && !userLoose, opts: opts, qd: qd, ql: ql };
  }

  function findAll(norm, q) {
    var out = [];
    if (!q) return out;
    var i = norm.indexOf(q);
    while (i >= 0) { out.push(i); i = norm.indexOf(q, i + q.length); }
    return out;
  }

  /** Wrap all occurrences of prepared query P inside element el in <mark>. Returns count. */
  function highlightIn(el, P) {
    if (!el || !P || (!P.qd && !P.ql)) return 0;
    var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode.closest('.kv-pg,.kv-cl,.kv-tipref,.kv-tips') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    var nodes = [], offs = [], text = '', n;
    while ((n = w.nextNode())) { nodes.push(n); offs.push(text.length); text += n.data; }
    var N = KT.normalize(text, P.opts);
    var ranges = [];
    [P.qd, P.ql].forEach(function (q) {
      if (!q) return;
      findAll(N.n, q).forEach(function (a) { ranges.push(KT.mapRange(N, text, a, a + q.length)); });
    });
    ranges.sort(function (x, y) { return y[0] - x[0]; });
    ranges.forEach(function (r) {
      for (var i = nodes.length - 1; i >= 0; i--) {
        var o = offs[i], L = nodes[i].data.length;
        var a = Math.max(r[0], o) - o, b = Math.min(r[1], o + L) - o;
        if (a >= b) continue;
        var node = nodes[i];
        if (b < node.data.length) node.splitText(b);
        var mid = a > 0 ? node.splitText(a) : node;
        var m = document.createElement('mark');
        m.className = 'kv-hit';
        mid.parentNode.insertBefore(m, mid);
        m.appendChild(mid);
      }
    });
    return ranges.length;
  }

  /* ------------------------------------------------------------------ */
  /* TOC                                                                 */
  /* ------------------------------------------------------------------ */
  function renderToc() {
    var h = '<ul class="kv-toc-list">';
    h += '<li><a class="kv-toc-link" href="#/" data-route="">About this edition</a></li>';
    h += '<li class="kv-toc-grp" lang="en">Front matter</li>';
    D.front.forEach(function (f) { h += '<li><a class="kv-toc-link" lang="en" href="#/front/' + esc(f.id) + '" data-route="front/' + esc(f.id) + '">' + esc(f.title) + '</a></li>'; });
    h += '<li class="kv-toc-grp">Adhyāyas <span lang="sa">(अध्यायाः)</span></li>';
    D.chapters.forEach(function (ch) {
      var sut = ch.sections.filter(function (s) { return s.sutra; });
      h += '<li class="kv-toc-ch" data-ch="' + ch.n + '"><div class="kv-toc-row">' +
        '<button type="button" class="kv-toc-tg" aria-expanded="false" aria-controls="kv-toc-ch-' + ch.n + '" aria-label="Show sūtras of adhyāya ' + ch.n + '"></button>' +
        '<a class="kv-toc-link kv-toc-chlink" href="#/' + ch.n + '" data-route="' + ch.n + '"><span class="kv-toc-num">' + ch.n + '</span>' +
        '<span class="kv-toc-chtxt"><span lang="sa">' + esc(ch.title) + '</span><small lang="en">' + esc(ch.topic_en || '') + '</small></span></a></div>' +
        '<ol class="kv-toc-sutras" id="kv-toc-ch-' + ch.n + '" hidden>';
      sut.forEach(function (s) {
        h += '<li><a href="#/' + s.id + '" data-sec="' + s.id + '" title="' + s.id + '"><span class="kv-toc-g">' + s.sutra.g + '</span><span lang="sa">' + esc(firstWords(s.sutra.text)) + '</span></a></li>';
      });
      h += '</ol></li>';
    });
    h += '<li><a class="kv-toc-link" href="#/sutras" data-route="sutras">Sūtrapāṭha <span lang="sa">(सूत्रपाठः)</span></a></li>';
    h += '<li class="kv-toc-grp">Appendices <span lang="sa">(परिशिष्टानि)</span></li>';
    D.appendices.forEach(function (a) {
      h += '<li><a class="kv-toc-link" href="#/app/' + esc(a.id) + '" data-route="app/' + esc(a.id) + '"><span lang="sa">' + esc(a.title) + '</span>' +
        (a.title_en && a.title_en !== a.title ? '<small lang="en">' + esc(a.title_en) + '</small>' : '') + '</a></li>';
    });
    h += '</ul>';
    var inner = $('kv-toc-inner');
    inner.innerHTML = h;
    translitTree(inner);
  }
  function tocExpand(n, open) {
    var li = APP.querySelector('.kv-toc-ch[data-ch="' + n + '"]');
    if (!li) return;
    li.querySelector('.kv-toc-tg').setAttribute('aria-expanded', open ? 'true' : 'false');
    li.querySelector('.kv-toc-sutras').hidden = !open;
  }
  function tocMark(routeKey, secId) {
    var toc = $('kv-toc-inner');
    Array.prototype.forEach.call(toc.querySelectorAll('[aria-current]'), function (a) { a.removeAttribute('aria-current'); });
    var a = toc.querySelector('.kv-toc-link[data-route="' + routeKey + '"]');
    if (a) a.setAttribute('aria-current', 'page');
    if (secId) tocMarkSec(secId);
  }
  function tocMarkSec(secId) {
    var toc = $('kv-toc-inner');
    var old = toc.querySelector('.kv-toc-sutras a.kv-cur');
    if (old) old.classList.remove('kv-cur');
    var s = toc.querySelector('a[data-sec="' + secId + '"]');
    if (s) {
      s.classList.add('kv-cur');
      var nav = $('kv-toc');
      if (!nav.matches(':hover')) {
        var r = s.getBoundingClientRect(), nr = nav.getBoundingClientRect();
        if (r.top < nr.top + 40 || r.bottom > nr.bottom - 20) nav.scrollTop += r.top - nr.top - nr.height / 3;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Views                                                               */
  /* ------------------------------------------------------------------ */
  var current = { key: '' };
  var lastSearchHash = '';
  var spy = null;

  function setView(html, key, lang) {
    if (spy) { spy.disconnect(); spy = null; }
    VIEW.innerHTML = html;
    VIEW.setAttribute('lang', lang || 'en');
    translitTree(VIEW);
    current = { key: key };
  }

  function chapterNav(ch) {
    var prev = CH[ch.n - 1], next = CH[ch.n + 1];
    return '<nav class="kv-chnav" aria-label="Adhyāya navigation" lang="en">' +
      (prev ? '<a href="#/' + prev.n + '" rel="prev">← <span lang="sa">' + esc(prev.title) + '</span></a>' : '<a href="#/front/' + esc(D.front[D.front.length - 1].id) + '" rel="prev">← Front matter</a>') +
      (next ? '<a href="#/' + next.n + '" rel="next"><span lang="sa">' + esc(next.title) + '</span> →</a>' : '<a href="#/app/' + esc(D.appendices[0].id) + '" rel="next">Appendices →</a>') +
      '</nav>';
  }

  function renderChapter(ch) {
    var h = [];
    var vt = {}, vv = {};
    h.push('<article class="kv-chapter" data-ch="' + ch.n + '">');
    h.push('<header class="kv-ch-head"><p class="kv-eyebrow" lang="en">Adhyāya ' + ch.n + ' of ' + D.chapters.length + '</p>' +
      '<h1 lang="sa">' + esc(ch.title) + '</h1>' +
      (ch.topic ? '<p class="kv-ch-topic" lang="sa">' + esc(ch.topic) + '</p>' : '') +
      (ch.topic_en ? '<p class="kv-ch-topic-en" lang="en">' + esc(ch.topic_en) + '</p>' : '') + '</header>');
    h.push(chapterNav(ch));
    ch.sections.forEach(function (s) {
      h.push('<section class="kv-sec' + (s.sutra ? '' : ' kv-intro') + '" id="b-' + s.id + '" data-sec="' + s.id + '"' +
        (s.sutra ? ' aria-labelledby="h-' + s.id + '"' : ' aria-label="Introduction"') + '>');
      var vr = s.vritti || [];
      var lead = s.sutra && vr.length && vr[0].type === 'lead' ? vr[0] : null;
      if (lead) {
        // the vṛtti's short announcing phrase ("…माह—") stands just above the sūtra
        h.push('<div class="kv-vritti kv-lead-wrap">' + blockHtml(lead, lead.id, vt) + '</div>');
        vr = vr.slice(1);
      }
      if (s.sutra) {
        var su = s.sutra;
        h.push('<div class="kv-sutra"><div class="kv-sutra-meta">' +
          '<a class="kv-badge" href="#/' + s.id + '" title="Sūtra ' + s.id + ' (no. ' + su.g + ' of 208)">' + s.id + '</a>' +
          '<span class="kv-g" lang="en" title="Running sūtra number">' + su.g + '</span>' + tipBtn(su.tippana) + copyBtn(s.id) + '</div>' +
          '<h2 class="kv-sutra-text" id="h-' + s.id + '">' + su.html + '</h2>' +
          (su.page != null ? pgSpan('p. ' + su.page, true) : '') + '</div>');
      }
      if (vr.length) {
        h.push('<div class="kv-vritti">');
        vr.forEach(function (b) { h.push(blockHtml(b, b.id, vt)); });
        h.push('</div>');
      }
      if (s.viveka && s.viveka.length) {
        h.push('<details class="kv-viveka"' + (settings.viv === 'open' ? ' open' : '') + '><summary><span class="kv-viv-label">विवेकः</span>' +
          '<span class="kv-viv-count" lang="en">' + s.viveka.length + (s.viveka.length === 1 ? ' note' : ' notes') + '</span></summary><div class="kv-viv-body">');
        s.viveka.forEach(function (b) { h.push(blockHtml(b, b.id, vv)); });
        h.push('</div></details>');
      }
      h.push('</section>');
    });
    if (ch.colophons && ch.colophons.length) {
      h.push('<div class="kv-colophons">');
      ch.colophons.forEach(function (c) {
        h.push('<div class="kv-b kv-colophon' + (c.layer === 'viveka' ? ' kv-col-viv' : '') + '" id="b-' + c.id + '">' +
          pgSpan(c.page != null ? 'p. ' + c.page : '', true) +
          (c.layer === 'viveka' ? '<span class="kv-col-label">विवेकः</span>' : '') +
          '<div class="kv-bt">' + c.html + '</div>' + copyBtn(c.id) + '</div>');
      });
      h.push('</div>');
    }
    h.push(chapterNav(ch));
    h.push('</article>');
    setView(h.join(''), 'ch:' + ch.n, 'sa');
    startSpy();
  }

  function startSpy() {
    if (!('IntersectionObserver' in window)) return;
    var visible = {};
    spy = new IntersectionObserver(function (ents) {
      ents.forEach(function (e) { if (e.isIntersecting) visible[e.target.getAttribute('data-sec')] = e.target; else delete visible[e.target.getAttribute('data-sec')]; });
      var best = null, bt = Infinity;
      for (var k in visible) { var t = visible[k].getBoundingClientRect().top; if (t < bt) { bt = t; best = k; } }
      if (best) tocMarkSec(best);
    }, { rootMargin: '-80px 0px -55% 0px' });
    Array.prototype.forEach.call(VIEW.querySelectorAll('.kv-sec'), function (s) { spy.observe(s); });
  }

  function renderDoc(kind, doc) {
    var isFront = kind === 'front';
    var h = '<article class="kv-doc kv-doc-' + kind + '"><header class="kv-ch-head">' +
      '<p class="kv-eyebrow" lang="en">' + (isFront ? 'Front matter' : 'Appendix') + '</p>' +
      '<h1' + (isFront ? ' lang="en"' : ' lang="sa"') + '>' + esc(doc.title) + '</h1>' +
      (!isFront && doc.title_en && doc.title_en !== doc.title ? '<p class="kv-ch-topic-en" lang="en">' + esc(doc.title_en) + '</p>' : '') +
      '</header><div class="kv-doc-body' + (doc.id === 'chaya' ? ' kv-chaya' : '') + '">';
    var t = {};
    if (doc.intro) h += '<div class="kv-doc-intro"><p>' + esc(doc.intro).replace(/\n/g, '<br>') + '</p></div>';
    (doc.blocks || []).forEach(function (b) {
      if (b.type === 'heading') h += '<h2 class="kv-doc-h" id="b-' + esc(b.id) + '">' + b.html + '</h2>';
      else h += blockHtml(b, kind + '/' + doc.id + '/' + b.id, t);
    });
    if (doc.notes) h += tippanaHtml(doc);
    if (doc.entries) h += chayaHtml(doc);
    if (doc.rows) h += rowsHtml(doc);
    h += '</div></article>';
    setView(h, kind + ':' + doc.id, isFront ? 'en' : 'sa');
  }

  function secLink(target, section, page) {
    var sid = section || (BLK[target] ? BLK[target].sec.id : target);
    return '<a class="kv-xref" lang="en" href="#/' + esc(target) + '">→ ' + esc(sid) + (page != null ? ' · p. ' + esc(page) : '') + '</a>';
  }
  function tippanaHtml(doc) {
    var h = '', cur = null;
    doc.notes.forEach(function (n) {
      if (n.chapter !== cur) {
        if (cur !== null) h += '</div>';
        cur = n.chapter;
        var ch = CH[cur];
        h += '<h2 class="kv-doc-h" id="tip-ch-' + esc(cur) + '">' + (ch ? esc(ch.title) : esc(cur)) +
          (ch && ch.topic_en ? ' <small lang="en">' + esc(ch.topic_en) + '</small>' : '') + '</h2><div class="kv-tiplist">';
      }
      var meta = [];
      if (n.line != null) meta.push('<span lang="en">l. ' + esc(n.line) + '</span>');
      if (n.target) meta.push(secLink(n.target, n.section, n.page));
      else if (n.page != null) meta.push('<span lang="en">p. ' + esc(n.page) + '</span>');
      h += '<div class="kv-b kv-tipnote" id="b-' + esc(n.id) + '"><div class="kv-bt">' + tipNoteInner(n) + '</div>' +
        '<div class="kv-b-meta">' + meta.join(' · ') + '</div>' + copyBtn('app/' + doc.id + '/' + n.id) + '</div>';
    });
    if (cur !== null) h += '</div>';
    return h;
  }
  function chayaHtml(doc) {
    var h = '<div class="kv-chayalist">';
    doc.entries.forEach(function (e) {
      var refs = (e.refs || []).map(function (r) {
        var lbl = (r.num != null ? 'ex. ' + r.num : '') + (r.page != null ? (r.num != null ? ', ' : '') + 'p. ' + r.page : '');
        return r.block ? '<a class="kv-xref" href="#/' + esc(r.block) + '">→ ' + esc((BLK[r.block] ? BLK[r.block].sec.id + ' · ' : '') + lbl) + '</a>' : '<span>' + esc(lbl) + '</span>';
      });
      h += '<div class="kv-b kv-chaya-entry" id="b-' + esc(e.id) + '"><div class="kv-bt">' + chayaInner(e) + '</div>' +
        '<div class="kv-b-meta" lang="en"><span class="kv-layer-tag kv-lt-' + esc(e.layer || '') + '" lang="sa">' + esc(LAYER_SA[e.layer] || '') + '</span> ' + refs.join(' ') + '</div>' +
        copyBtn('app/' + doc.id + '/' + e.id) + '</div>';
    });
    return h + '</div>';
  }
  function rowsHtml(doc) {
    var max = 1;
    doc.rows.forEach(function (r) { if (r.cells && r.cells.length > max) max = r.cells.length; });
    var h = '<div class="kv-table-wrap"><table class="kv-corr"><tbody>';
    doc.rows.forEach(function (r) {
      if (r.kind === 'text' || !r.cells) { h += '<tr class="kv-corr-text"><td colspan="' + max + '">' + esc(r.text || '') + '</td></tr>'; return; }
      h += '<tr class="kv-corr-' + esc(r.kind) + '">' + r.cells.map(function (c, i) {
        return '<td' + (i === r.cells.length - 1 && r.cells.length < max ? ' colspan="' + (max - i) + '"' : '') + '>' + esc(c) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  function renderSutras() {
    var h = '<article class="kv-sutrapatha"><header class="kv-ch-head"><p class="kv-eyebrow" lang="en">The bare text</p>' +
      '<h1 lang="sa">सूत्रपाठः</h1><p class="kv-ch-topic-en" lang="en">All 208 sūtras of the Kāvyānuśāsana. Select a number to read it with the commentaries.</p></header>';
    D.chapters.forEach(function (ch) {
      h += '<section class="kv-sp-ch" aria-labelledby="sp-' + ch.n + '"><h2 id="sp-' + ch.n + '"><a href="#/' + ch.n + '"><span lang="sa">' + esc(ch.title) + '</span></a>' +
        ' <small lang="en">' + esc(ch.topic_en || '') + '</small></h2><ol class="kv-sp-list">';
      ch.sections.forEach(function (s) {
        if (!s.sutra) return;
        h += '<li class="kv-sp-item" id="b-sp-' + s.id + '"><a class="kv-badge" href="#/' + s.id + '">' + s.id + '</a>' +
          '<span class="kv-g" lang="en">' + s.sutra.g + '</span><span class="kv-sp-text">' + s.sutra.html + '</span>' + copyBtn(s.id) + '</li>';
      });
      h += '</ol></section>';
    });
    h += '</article>';
    setView(h, 'sutras', 'sa');
  }

  function renderHome() {
    var m = D.meta || {};
    var h = '<article class="kv-home" lang="en">' +
      '<header class="kv-home-head"><h1><span lang="sa" class="kv-home-sa">' + esc(m.title || 'काव्यानुशासनम्') + '</span>' +
      '<span class="kv-home-en">' + esc(m.title_en || '') + '</span></h1>' +
      '<p class="kv-home-sub">' + esc(m.subtitle || '') + '</p><p class="kv-muted">' + esc(m.edition || '') + '</p></header>' +
      '<section aria-labelledby="kv-about-h"><h2 id="kv-about-h">About this text</h2>' +
      '<p>Ācārya Hemacandra (1088–1172), the Jaina polymath of Aṇahilapāṭaka, composed the Kāvyānuśāsana as the poetics companion to his grammar, the Siddhahemaśabdānuśāsana. The work has three layers, all by Hemacandra himself, and this reader keeps them visually apart:</p>' +
      '<dl class="kv-layers">' +
      '<div class="kv-layer kv-layer-s"><dt><span lang="sa">सूत्रम्</span> Sūtra</dt><dd>208 concise rules in eight adhyāyas, shown large and bold with their number within the adhyāya (e.g. <b>1.3</b>) and their running number (1–208).</dd></div>' +
      '<div class="kv-layer kv-layer-a"><dt><span lang="sa">अलङ्कारचूडामणिः</span> Vṛtti</dt><dd>Hemacandra’s own commentary on the sūtras, the main running text. It explains each rule and illustrates it with verses from the poets (examples numbered throughout the book), citing earlier authorities.</dd></div>' +
      '<div class="kv-layer kv-layer-v"><dt><span lang="sa">विवेकः</span> Viveka</dt><dd>His own further annotation on difficult points of the vṛtti. Each note opens with the pratīka (the word or phrase glossed, in bold). It appears in a tinted panel under the sūtra it belongs to, and can be shown, collapsed, or hidden.</dd></div>' +
      '<div class="kv-layer kv-layer-p"><dt><span lang="sa">टिप्पणम्</span> Ṭippaṇa</dt><dd>An anonymous gloss from the margins of a palm-leaf manuscript, printed by the editor as an appendix. It is given in the <a href="#/app/tippana">Ṭippaṇa appendix</a>, where each note that can be tied to a passage links to it. The Sanskrit chāyā of Prākṛt verses is shown under each verse (labelled <span lang="sa">छाया</span>) and listed in its own appendix.</dd></div>' +
      '</dl>' +
      '<p>Page numbers in the margin (<span class="kv-pg-demo">p. 12</span>) refer to the printed 1938 edition by Rasiklal C. Parikh, so you can cite it. Every sūtra and paragraph has a link button for sharing a precise reference.</p></section>' +
      '<section aria-labelledby="kv-contents-h"><h2 id="kv-contents-h">Contents</h2><ol class="kv-cards">';
    D.chapters.forEach(function (ch) {
      var ns = ch.sections.filter(function (s) { return s.sutra; });
      h += '<li><a class="kv-card" href="#/' + ch.n + '"><span class="kv-card-n">' + ch.n + '</span><span class="kv-card-t" lang="sa">' + esc(ch.title) + '</span>' +
        '<span class="kv-card-topic" lang="sa">' + esc(ch.topic || '') + '</span><span class="kv-card-en">' + esc(ch.topic_en || '') + '</span>' +
        '<span class="kv-card-meta">Sūtras ' + ns[0].sutra.g + '–' + ns[ns.length - 1].sutra.g + '</span></a></li>';
    });
    h += '</ol><p class="kv-home-links"><a href="#/sutras">Sūtrapāṭha (all sūtras)</a> · ' +
      D.front.map(function (f) { return '<a href="#/front/' + esc(f.id) + '">' + esc(f.title) + '</a>'; }).join(' · ') + ' · ' +
      D.appendices.map(function (a) { return '<a href="#/app/' + esc(a.id) + '">' + esc(a.title_en || a.title) + '</a>'; }).join(' · ') + '</p></section>' +
      '<section aria-labelledby="kv-help-h"><h2 id="kv-help-h">Searching</h2>' + searchHelp() + '</section>';
    var last = load('kavya.last');
    if (last && /^#\/\d/.test(last)) h += '<p class="kv-resume"><a class="kv-btn" href="' + esc(last) + '">Continue reading at ' + esc(last.slice(2).split('?')[0]) + ' →</a></p>';
    h += '</article>';
    setView(h, 'home', 'en');
  }

  function searchHelp() {
    return '<p>Type in Devanagari, or in Roman: IAST (<code>pratibhā</code>, <code>alaṅkāra</code>) or Harvard-Kyoto / ITRANS ASCII (<code>pratibhA</code>, <code>alaMkAra</code>, <code>kSa</code>, <code>jJa</code>/<code>GY</code>, <code>sh</code>, <code>R</code>=ṛ, <code>M</code>=ṃ, <code>H</code>=ḥ). HK is case-sensitive: capitals mark long vowels and retroflexes. Plain lower-case ASCII (<code>alankara</code>) switches on loose matching automatically.</p>' +
      '<p>Matching ignores spaces, daṇḍas and punctuation (Sanskrit words are fused by sandhi, so any part of a compound is found), treats anusvāra and a nasal+virāma before a consonant as the same (<span lang="sa">संकेत</span> = <span lang="sa">सङ्केत</span>), and can ignore the avagraha. <i>Loose</i> matching also ignores vowel length, retroflex vs dental, and ś/ṣ/s.</p>';
  }

  /* ---------------- Search view ---------------- */
  var INDEX = {};   // optsKey -> [normalised strings]
  function getIndex(opts) {
    var key = (opts.avagraha ? 1 : 0) + ':' + (opts.loose ? 1 : 0);
    if (!INDEX[key]) {
      var o = { avagraha: opts.avagraha, loose: opts.loose, nomap: true };
      INDEX[key] = ENTRIES.map(function (e) { return KT.normalize(e.text, o).n; });
    }
    return INDEX[key];
  }

  var S = { q: '', layers: 'savp', types: 'tx', ch: '', loose: false, av: true, limit: 150 };
  function searchParams(p) {
    S.q = p.get('q') || '';
    S.layers = p.get('l') || 'savp';
    S.types = p.get('t') || 'tx';
    S.ch = p.get('ch') || '';
    S.loose = p.get('loose') === '1';
    S.av = p.get('av') !== '0';
  }
  function searchHash() {
    var parts = ['q=' + encodeURIComponent(S.q)];
    if (S.layers !== 'savp') parts.push('l=' + S.layers);
    if (S.types !== 'tx') parts.push('t=' + S.types);
    if (S.ch) parts.push('ch=' + S.ch);
    if (S.loose) parts.push('loose=1');
    if (!S.av) parts.push('av=0');
    return '#/search?' + parts.join('&');
  }
  function hlSuffix(P) {
    return '?hl=' + encodeURIComponent(P.raw) + (S.loose ? '&loose=1' : '') + (S.av ? '' : '&av=0');
  }

  function renderSearchShell() {
    var chOpts = '<option value="">All adhyāyas</option>' + D.chapters.map(function (c) {
      return '<option value="' + c.n + '">' + c.n + ' · ' + esc(c.topic_en || c.title) + '</option>';
    }).join('');
    var h = '<section class="kv-search-view" aria-labelledby="kv-sr-h" lang="en">' +
      '<h1 id="kv-sr-h" class="kv-sr-title">Search</h1>' +
      '<p class="kv-sr-query" id="kv-sr-query" aria-live="polite"></p>' +
      '<form class="kv-filters" id="kv-filters">' +
      '<fieldset><legend>Layer</legend>' +
      '<label class="kv-chip"><input type="checkbox" name="l" value="s"> Sūtra <span class="kv-cnt" data-c="s"></span></label>' +
      '<label class="kv-chip"><input type="checkbox" name="l" value="a"> Vṛtti <span class="kv-cnt" data-c="a"></span></label>' +
      '<label class="kv-chip"><input type="checkbox" name="l" value="v"> Viveka <span class="kv-cnt" data-c="v"></span></label>' +
      '<label class="kv-chip"><input type="checkbox" name="l" value="p"> Appendices &amp; front matter <span class="kv-cnt" data-c="p"></span></label></fieldset>' +
      '<fieldset><legend>Kind</legend>' +
      '<label class="kv-chip"><input type="checkbox" name="t" value="t"> Running text <span class="kv-cnt" data-c="t"></span></label>' +
      '<label class="kv-chip"><input type="checkbox" name="t" value="x"> Examples, verses &amp; citations <span class="kv-cnt" data-c="x"></span></label></fieldset>' +
      '<fieldset class="kv-f-row"><legend>Scope &amp; options</legend>' +
      '<label class="kv-sel"><span class="kv-sr">Adhyāya</span><select name="ch">' + chOpts + '</select></label>' +
      '<label class="kv-chip"><input type="checkbox" name="av"> Ignore avagraha (ऽ)</label>' +
      '<label class="kv-chip"><input type="checkbox" name="loose"> Loose matching</label></fieldset>' +
      '</form>' +
      '<p class="kv-sr-count" id="kv-sr-count" role="status"></p>' +
      '<ol class="kv-results" id="kv-results"></ol>' +
      '<div id="kv-sr-more"></div>' +
      '<details class="kv-sr-help"><summary>How search works</summary>' + searchHelp() + '</details>' +
      '</section>';
    setView(h, 'search', 'en');
    var f = $('kv-filters');
    f.addEventListener('change', function () {
      var l = '', t = '';
      Array.prototype.forEach.call(f.querySelectorAll('input[name=l]:checked'), function (i) { l += i.value; });
      Array.prototype.forEach.call(f.querySelectorAll('input[name=t]:checked'), function (i) { t += i.value; });
      S.layers = l; S.types = t; S.ch = f.elements.ch.value; S.av = f.elements.av.checked; S.loose = f.elements.loose.checked;
      history.replaceState(null, '', searchHash());
      lastSearchHash = location.hash;
      runSearch();
    });
  }
  function syncFilters() {
    var f = $('kv-filters');
    Array.prototype.forEach.call(f.querySelectorAll('input[name=l]'), function (i) { i.checked = S.layers.indexOf(i.value) >= 0; });
    Array.prototype.forEach.call(f.querySelectorAll('input[name=t]'), function (i) { i.checked = S.types.indexOf(i.value) >= 0; });
    f.elements.ch.value = S.ch; f.elements.av.checked = S.av; f.elements.loose.checked = S.loose;
  }

  function runSearch(more) {
    var qEl = $('kv-sr-query'), cEl = $('kv-sr-count'), list = $('kv-results'), moreEl = $('kv-sr-more');
    if (!more) S.limit = 150;
    if (!S.q.trim()) {
      qEl.textContent = 'Type a word or phrase in the search box above.';
      cEl.textContent = ''; list.innerHTML = ''; moreEl.innerHTML = '';
      Array.prototype.forEach.call(APP.querySelectorAll('.kv-cnt'), function (c) { c.textContent = ''; });
      return;
    }
    var P = prepareQuery(S.q, S.loose, S.av);
    var shown = settings.script === 'iast' ? KT.devToIast(P.dev) : P.dev;
    qEl.innerHTML = 'Searching: <b lang="sa" class="kv-notx">' + esc(shown) + '</b>' +
      (settings.script === 'iast' ? ' <span lang="sa" class="kv-muted kv-notx">(' + esc(P.dev) + ')</span>' : '') +
      (P.latin && P.ql ? ' <span class="kv-muted">and “' + esc(P.raw) + '” in English text</span>' : '') +
      (P.opts.loose ? ' <span class="kv-tag">loose' + (P.autoLoose ? ' (auto: no diacritics typed)' : '') + '</span>' : '');
    if (!P.qd && !P.ql) { cEl.textContent = 'Nothing to search for.'; list.innerHTML = ''; moreEl.innerHTML = ''; return; }

    var t0 = performance.now();
    var idx = getIndex(P.opts);
    var hits = [], counts = { s: 0, a: 0, v: 0, p: 0, t: 0, x: 0 };
    var chN = S.ch ? +S.ch : 0;
    for (var i = 0; i < idx.length; i++) {
      var e = ENTRIES[i], nstr = idx[i];
      var c = 0;
      if (P.qd) c = countIn(nstr, P.qd);
      if (P.ql) c += countIn(nstr, P.ql);
      if (!c) continue;
      if (chN && e.ch !== chN) continue;
      // facet counts: layer counts respect the kind filter and vice versa
      if (S.types.indexOf(e.typ) >= 0) counts[e.cat]++;
      if (S.layers.indexOf(e.cat) >= 0) counts[e.typ]++;
      if (S.layers.indexOf(e.cat) < 0 || S.types.indexOf(e.typ) < 0) continue;
      hits.push({ i: i, c: c });
    }
    var occ = hits.reduce(function (a, h) { return a + h.c; }, 0);
    var ms = Math.round(performance.now() - t0);
    Array.prototype.forEach.call(APP.querySelectorAll('.kv-cnt'), function (el) { el.textContent = counts[el.getAttribute('data-c')] || '0'; });
    cEl.textContent = hits.length ? hits.length + ' passage' + (hits.length === 1 ? '' : 's') + ', ' + occ + ' occurrence' + (occ === 1 ? '' : 's') + ' (' + ms + ' ms)' :
      'No matches.' + (!P.opts.loose ? ' Try loose matching, or a shorter part of the word.' : '');

    var out = [];
    var lim = Math.min(hits.length, S.limit);
    for (var k = 0; k < lim; k++) out.push(resultHtml(ENTRIES[hits[k].i], hits[k].c, P));
    list.innerHTML = out.join('');
    translitTree(list);
    moreEl.innerHTML = hits.length > lim ? '<button type="button" class="kv-btn" id="kv-more-btn">Show more (' + (hits.length - lim) + ' remaining)</button>' : '';
    if (hits.length > lim) $('kv-more-btn').addEventListener('click', function () { S.limit += 300; runSearch(true); });
  }
  function countIn(s, q) {
    var c = 0, i = s.indexOf(q);
    while (i >= 0) { c++; i = s.indexOf(q, i + q.length); }
    return c;
  }
  function resultHtml(e, count, P) {
    var N = KT.normalize(e.text, P.opts);
    var a = P.qd ? N.n.indexOf(P.qd) : -1, q = P.qd;
    if (a < 0 && P.ql) { a = N.n.indexOf(P.ql); q = P.ql; }
    var r = a >= 0 ? KT.mapRange(N, e.text, a, a + q.length) : [0, 0];
    var t = e.text, st = Math.max(0, r[0] - 70), en = Math.min(t.length, r[1] + 110);
    if (st > 0) { var sp = t.indexOf(' ', st); if (sp > 0 && sp < r[0]) st = sp + 1; }
    if (en < t.length) { var sp2 = t.lastIndexOf(' ', en); if (sp2 > r[1]) en = sp2; }
    function clean(s) { return esc(s).replace(/\n/g, ' <span class="kv-lb">/</span> '); }
    var snip = (st > 0 ? '… ' : '') + clean(t.slice(st, r[0])) + '<mark class="kv-hit">' + clean(t.slice(r[0], r[1])) + '</mark>' + clean(t.slice(r[1], en)) + (en < t.length ? ' …' : '');
    var catCls = { s: 'kv-r-s', a: 'kv-r-a', v: 'kv-r-v', p: 'kv-r-p' }[e.cat];
    return '<li class="kv-r ' + catCls + (e.typ === 'x' ? ' kv-r-x' : '') + '"><a href="#/' + esc(e.route) + hlSuffix(P) + '">' +
      '<span class="kv-r-loc"><span' + (e.cat === 'p' && e.en ? ' lang="en"' : ' lang="sa"') + '>' + esc(e.loc) + '</span>' + (e.page ? ' <span lang="en">· ' + esc(e.page) + '</span>' : '') +
      (count > 1 ? ' <span class="kv-r-n" lang="en">×' + count + '</span>' : '') + '</span>' +
      '<span class="kv-snip"' + (e.en ? ' lang="en"' : ' lang="sa"') + '>' + snip + '</span></a></li>';
  }

  /* ------------------------------------------------------------------ */
  /* Router                                                              */
  /* ------------------------------------------------------------------ */
  function parseHash() {
    var h = location.hash.replace(/^#\/?/, '');
    var qi = h.indexOf('?');
    var path = qi >= 0 ? h.slice(0, qi) : h;
    var params = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '');
    try { path = decodeURIComponent(path); } catch (e) { /* keep raw */ }
    return { path: path, params: params };
  }

  function route() {
    if (!D) return;
    closeDrawer();
    var r = parseHash(), p = r.path, m;
    var hl = r.params.get('hl');
    var P = hl ? prepareQuery(hl, r.params.get('loose') === '1', r.params.get('av') !== '0') : null;
    APP.classList.toggle('kv-in-search', p === 'search');
    updateBackPill(p);

    if (p === 'search') {
      searchParams(r.params);
      if ($('kv-q').value !== S.q) $('kv-q').value = S.q;
      if (current.key !== 'search') renderSearchShell();
      syncFilters();
      lastSearchHash = location.hash;
      runSearch();
      tocMark('search');
      document.title = (S.q ? S.q + ' — ' : '') + 'Search · Kāvyānuśāsana';
      return;
    }
    if (p === '' ) { renderHome(); tocMark(''); scrollTop(); document.title = 'Kāvyānuśāsana Reader'; return; }
    if (p === 'sutras') { renderSutras(); tocMark('sutras'); scrollTop(); document.title = 'Sūtrapāṭha · Kāvyānuśāsana'; return; }
    if ((m = /^(front|app)\/([^/]+)(?:\/(.+))?$/.exec(p))) {
      var doc = m[1] === 'front' ? FRONT[m[2]] : APPX[m[2]];
      if (!doc) return notFound(p);
      if (current.key !== m[1] + ':' + doc.id) renderDoc(m[1], doc); else clearMarks();
      tocMark(m[1] + '/' + doc.id);
      document.title = (doc.title_en || doc.title) + ' · Kāvyānuśāsana';
      if (m[3]) focusTarget($('b-' + m[3]), P); else scrollTop();
      return;
    }
    if ((m = /^(\d+)(?:\.(.+))?$/.exec(p))) {
      var ch = CH[+m[1]];
      if (!ch) return notFound(p);
      if (current.key !== 'ch:' + ch.n) renderChapter(ch); else clearMarks();
      tocMark(String(ch.n));
      tocExpand(ch.n, true);
      document.title = ch.title + (m[2] ? ' ' + p : '') + ' · Kāvyānuśāsana';
      store('kavya.last', '#/' + p);
      if (m[2]) {
        var el = $('b-' + p);
        if (!el) return notFound(p);
        focusTarget(el, P);
        var secId = el.classList.contains('kv-sec') ? p : (el.closest('.kv-sec') ? el.closest('.kv-sec').getAttribute('data-sec') : null);
        if (secId) tocMarkSec(secId);
      } else scrollTop();
      return;
    }
    notFound(p);
  }

  function notFound(p) {
    setView('<div class="kv-empty" lang="en"><h1>Not found</h1><p>No passage “' + esc(p) + '”. <a href="#/">Go to the start</a>.</p></div>', 'nf', 'en');
  }
  function scrollTop() { window.scrollTo(0, 0); }

  function clearMarks() {
    Array.prototype.forEach.call(VIEW.querySelectorAll('mark.kv-hit'), function (mk) {
      var par = mk.parentNode;
      while (mk.firstChild) par.insertBefore(mk.firstChild, mk);
      par.removeChild(mk);
      par.normalize();
    });
    Array.prototype.forEach.call(VIEW.querySelectorAll('.kv-target'), function (t) { t.classList.remove('kv-target'); });
  }

  function focusTarget(el, P) {
    if (!el) return;
    var target = el.classList.contains('kv-sec') ? (el.querySelector('.kv-sutra') || el) : el;
    // make sure its layer is visible
    if (target.closest('.kv-vritti') && !settings.vritti) { settings.vritti = true; applySettings(); saveSettings(); }
    if (target.closest('.kv-viveka') || target.classList.contains('kv-col-viv')) {
      if (settings.viv === 'hidden') { settings.viv = 'collapsed'; applySettings(); saveSettings(); }
      var det = target.closest('details');
      if (det) det.open = true;
    }
    if (P) {
      // in IAST mode the DOM is romanised: re-render the block's Devanagari first
      var holder = target.querySelector('.kv-bt,.kv-sutra-text') || target;
      if (settings.script === 'iast') restoreDev(holder, target);
      highlightIn(holder, P);
      translitTree(holder);
    }
    target.classList.add('kv-target');
    var scrollEl = el.classList.contains('kv-sec') && settings.vritti ? el : target;
    requestAnimationFrame(function () {
      scrollEl.scrollIntoView({ block: 'start' });
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  }
  function restoreDev(holder, target) {
    var id = (target.id || '').replace(/^b-/, '');
    var src = null;
    if (holder.classList.contains('kv-sutra-text')) {
      var secEl = target.closest('.kv-sec'), s = secEl && SEC[secEl.getAttribute('data-sec')];
      if (s && s.sec.sutra) src = s.sec.sutra.html;
    }
    else src = innerFor(id);
    if (src != null) holder.innerHTML = src;
  }

  function updateBackPill(p) {
    var pill = $('kv-back-pill');
    if (!pill) {
      pill = document.createElement('a');
      pill.id = 'kv-back-pill'; pill.className = 'kv-back-pill'; pill.setAttribute('lang', 'en');
      pill.textContent = '← Back to results';
      APP.appendChild(pill);
    }
    var show = lastSearchHash && p !== 'search';
    pill.hidden = !show;
    if (show) pill.href = lastSearchHash;
  }

  /* ------------------------------------------------------------------ */
  /* Settings UI                                                         */
  /* ------------------------------------------------------------------ */
  function applySettings() {
    APP.classList.toggle('kv-no-vritti', !settings.vritti);
    APP.classList.toggle('kv-viv-hidden', settings.viv === 'hidden');
    APP.classList.toggle('kv-no-pages', !settings.pages);
    APP.classList.toggle('kv-no-chaya', !settings.chaya);
    $('kv-l-chaya').checked = settings.chaya;
    APP.classList.toggle('kv-iast', settings.script === 'iast');
    APP.style.setProperty('--kv-scale', settings.size / 100);
    $('kv-size-val').textContent = settings.size + '%';
    $('kv-l-vritti').checked = settings.vritti;
    $('kv-l-pages').checked = settings.pages;
    Array.prototype.forEach.call(APP.querySelectorAll('input[name=kv-viv]'), function (r) { r.checked = r.value === settings.viv; });
    Array.prototype.forEach.call(APP.querySelectorAll('input[name=kv-script]'), function (r) { r.checked = r.value === settings.script; });
    var only = !settings.vritti && settings.viv === 'hidden';
    $('kv-sutras-only').textContent = only ? 'Show commentaries again' : 'Sūtras only';
    $('kv-sutras-only').setAttribute('aria-pressed', only ? 'true' : 'false');
  }
  function setViv(mode) {
    settings.viv = mode;
    Array.prototype.forEach.call(VIEW.querySelectorAll('details.kv-viveka'), function (d) { d.open = mode === 'open'; });
    applySettings(); saveSettings();
  }
  function rerender() {
    current.key = '';
    if (D) { renderToc(); route(); }
  }

  function bindUi() {
    $('kv-l-vritti').addEventListener('change', function () { settings.vritti = this.checked; applySettings(); saveSettings(); });
    $('kv-l-pages').addEventListener('change', function () { settings.pages = this.checked; applySettings(); saveSettings(); });
    $('kv-l-chaya').addEventListener('change', function () { settings.chaya = this.checked; applySettings(); saveSettings(); });
    Array.prototype.forEach.call(APP.querySelectorAll('input[name=kv-viv]'), function (r) {
      r.addEventListener('change', function () { if (this.checked) setViv(this.value); });
    });
    Array.prototype.forEach.call(APP.querySelectorAll('input[name=kv-script]'), function (r) {
      r.addEventListener('change', function () { if (this.checked) { settings.script = this.value; applySettings(); saveSettings(); rerender(); } });
    });
    $('kv-sutras-only').addEventListener('click', function () {
      var only = !settings.vritti && settings.viv === 'hidden';
      settings.vritti = only; setViv(only ? 'collapsed' : 'hidden');
    });
    $('kv-size-dn').addEventListener('click', function () { settings.size = Math.max(70, settings.size - 10); applySettings(); saveSettings(); });
    $('kv-size-up').addEventListener('click', function () { settings.size = Math.min(180, settings.size + 10); applySettings(); saveSettings(); });

    // theme
    if ($('kv-theme-btn')) $('kv-theme-btn').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      if (!cur) cur = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      var next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      store('kavya.theme', next);
    });

    // display panel
    var vb = $('kv-view-btn'), vp = $('kv-view-panel');
    function panel(open) { vp.hidden = !open; vb.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    vb.addEventListener('click', function (e) { e.stopPropagation(); panel(vp.hidden); });
    document.addEventListener('click', function (e) { if (!vp.hidden && !$('kv-view-menu').contains(e.target)) panel(false); });

    // TOC drawer + chapter toggles
    $('kv-toc-btn').addEventListener('click', function () {
      if (window.matchMedia('(max-width: 959px)').matches) openDrawer();
      else { APP.classList.toggle('kv-toc-collapsed'); this.setAttribute('aria-expanded', APP.classList.contains('kv-toc-collapsed') ? 'false' : 'true'); }
    });
    $('kv-toc-close').addEventListener('click', closeDrawer);
    $('kv-scrim').addEventListener('click', closeDrawer);
    $('kv-toc').addEventListener('click', function (e) {
      var tg = e.target.closest('.kv-toc-tg');
      if (tg) { var li = tg.closest('.kv-toc-ch'); tocExpand(li.getAttribute('data-ch'), tg.getAttribute('aria-expanded') !== 'true'); return; }
      if (e.target.closest('a') && parseHash().path === e.target.closest('a').getAttribute('href').slice(2)) { closeDrawer(); route(); }
    });

    // search box
    var qIn = $('kv-q');
    var doSearch = debounce(function () {
      S.q = qIn.value;
      var h = searchHash();
      if (parseHash().path === 'search') { history.replaceState(null, '', h); lastSearchHash = h; route(); }
      else if (S.q.trim()) { location.hash = h; }
    }, 220);
    qIn.addEventListener('input', doSearch);
    $('kv-search-form').addEventListener('submit', function (e) { e.preventDefault(); S.q = qIn.value; if (parseHash().path !== 'search') location.hash = searchHash(); else route(); });
    qIn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { var first = APP.querySelector('.kv-results a'); if (first) { e.preventDefault(); first.focus(); } }
    });
    VIEW.addEventListener('keydown', function (e) {
      var a = e.target.closest && e.target.closest('.kv-results a');
      if (!a || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      var li = a.parentNode, sib = e.key === 'ArrowDown' ? li.nextElementSibling : li.previousElementSibling;
      e.preventDefault();
      if (sib) sib.querySelector('a').focus(); else if (e.key === 'ArrowUp') qIn.focus();
    });

    // ṭippaṇa markers + copy links
    APP.addEventListener('click', function (e) {
      var tb = e.target.closest('.kv-tipref');
      if (tb) { e.preventDefault(); toggleTips(tb); return; }
      var b = e.target.closest('.kv-cl');
      if (!b) return;
      var url = location.href.split('#')[0] + '#/' + b.getAttribute('data-link');
      copyText(url).then(function () { toast('Link copied: ' + b.getAttribute('data-link')); }, function () { window.prompt('Copy this link:', url); });
    });

    // keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); qIn.focus(); qIn.select(); }
      else if (e.key === 'Escape') {
        if (!vp.hidden) { panel(false); vb.focus(); }
        else if (APP.classList.contains('kv-drawer-open')) closeDrawer();
        else if (e.target === qIn && qIn.value) { qIn.value = ''; }
      }
    });

    window.addEventListener('hashchange', route);
  }
  function copyText(t) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
    return new Promise(function (res, rej) {
      var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta); ok ? res() : rej();
    });
  }
  function openDrawer() {
    APP.classList.add('kv-drawer-open'); $('kv-scrim').hidden = false; $('kv-toc-btn').setAttribute('aria-expanded', 'true');
    var cur = $('kv-toc').querySelector('[aria-current], a.kv-cur') || $('kv-toc-close');
    setTimeout(function () { cur.focus(); }, 30);
  }
  function closeDrawer() {
    if (!APP.classList.contains('kv-drawer-open')) return;
    APP.classList.remove('kv-drawer-open'); $('kv-scrim').hidden = true; $('kv-toc-btn').setAttribute('aria-expanded', 'false');
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  function fetchJson(url, onProgress) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      var total = +res.headers.get('Content-Length') || 0;
      if (!res.body || !res.body.getReader || !window.TextDecoder) return res.json();
      var reader = res.body.getReader(), chunks = [], got = 0;
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            var all = new Uint8Array(got), o = 0;
            chunks.forEach(function (c) { all.set(c, o); o += c.length; });
            return JSON.parse(new TextDecoder('utf-8').decode(all));
          }
          chunks.push(r.value); got += r.value.length;
          onProgress(total ? Math.min(99, Math.round(got / total * 100)) + '%' : Math.round(got / 1024) + ' KB');
          return pump();
        });
      }
      return pump();
    });
  }

  applySettings();
  bindUi();
  fetchJson(DATA_URL, function (p) { $('kv-load-pct').textContent = '(' + p + ')'; }).then(function (d) {
    prepareData(d);
    var m = d.meta || {};
    if (m.title_en) $('kv-title-en').textContent = m.title_en;
    if (m.subtitle) $('kv-subtitle').textContent = m.subtitle;
    if (m.edition) { $('kv-edition').textContent = '· ' + m.edition; $('kv-footer-ed').textContent = 'Text: ' + m.edition + '. Page numbers in the margin refer to this edition.'; }
    $('kv-loading').hidden = true;
    renderToc();
    route();
    // build the default search index when idle so the first search is instant
    var idle = window.requestIdleCallback || function (f) { setTimeout(f, 400); };
    idle(function () { getIndex({ avagraha: true, loose: false }); });
  }).catch(function (err) {
    $('kv-loading').innerHTML = '<p class="kv-error"><b>Could not load the text.</b> ' + esc(err.message || err) + '</p>' +
      (location.protocol === 'file:' ? '<p>Browsers block loading data from <code>file://</code> pages. Serve this folder with any static web server, e.g. <code>python -m http.server</code>, and open <code>http://localhost:8000/</code>.</p>' : '<p>Check that <code>' + esc(DATA_URL) + '</code> exists next to this page.</p>');
  });
})();
