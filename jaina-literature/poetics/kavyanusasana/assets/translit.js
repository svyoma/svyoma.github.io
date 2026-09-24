/*
 * Kāvyānuśāsana reader: transliteration + search normalisation.
 * Plain ES5-compatible script; exposes window.KT (and module.exports under Node for testing).
 *
 *   KT.romanToDev(str)        IAST / Harvard-Kyoto / ITRANS-ish ASCII -> Devanagari
 *   KT.devToIast(str, next)   Devanagari -> IAST (next = following char, for split text nodes)
 *   KT.normalize(str, opts)   -> {n: normalised string, s: Int32Array starts, e: Int32Array ends}
 *   KT.normalizeQuery(str, opts) -> normalised query string (trailing virama dropped)
 *   KT.hasLatin(str)
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Roman -> Devanagari                                                 */
  /* ------------------------------------------------------------------ */

  // [roman spellings..., independent vowel, vowel sign]
  var VOWELS = [
    [['a'], 'अ', ''],
    [['ā', 'aa', 'A'], 'आ', 'ा'],
    [['i'], 'इ', 'ि'],
    [['ī', 'ii', 'I'], 'ई', 'ी'],
    [['u'], 'उ', 'ु'],
    [['ū', 'uu', 'U'], 'ऊ', 'ू'],
    [['ṛ', 'r̥', 'R', 'Ri', 'RRi', 'R^i'], 'ऋ', 'ृ'],
    [['ṝ', 'r̥̄', 'RR', 'RRI', 'R^I'], 'ॠ', 'ॄ'],
    [['ḷ', 'l̥', 'lR', 'LLi', 'L^i'], 'ऌ', 'ॢ'],
    [['ḹ', 'l̥̄', 'lRR', 'LLI', 'L^I'], 'ॡ', 'ॣ'],
    [['e', 'ē'], 'ए', 'े'],
    [['ai'], 'ऐ', 'ै'],
    [['o', 'ō'], 'ओ', 'ो'],
    [['au'], 'औ', 'ौ']
  ];

  // [roman spellings..., consonant sequence (without viramas)]
  var CONSONANTS = [
    [['k'], 'क'], [['kh'], 'ख'], [['g'], 'ग'], [['gh'], 'घ'], [['ṅ', 'G', '~N', 'N^'], 'ङ'],
    [['c'], 'च'], [['ch', 'Ch', 'chh', 'C'], 'छ'], [['j'], 'ज'], [['jh'], 'झ'], [['ñ', 'J', '~n', 'JN'], 'ञ'],
    [['ṭ', 'T'], 'ट'], [['ṭh', 'Th'], 'ठ'], [['ḍ', 'D'], 'ड'], [['ḍh', 'Dh'], 'ढ'], [['ṇ', 'N'], 'ण'],
    [['t'], 'त'], [['th'], 'थ'], [['d'], 'द'], [['dh'], 'ध'], [['n'], 'न'],
    [['p'], 'प'], [['ph'], 'फ'], [['b'], 'ब'], [['bh'], 'भ'], [['m'], 'म'],
    [['y'], 'य'], [['r'], 'र'], [['l'], 'ल'], [['v', 'w'], 'व'],
    [['ś', 'z', 'sh', 'ç', 'Ś'], 'श'], [['ṣ', 'S', 'Sh', 'shh', 'Ṣ'], 'ष'], [['s'], 'स'], [['h'], 'ह'],
    [['ḻ', 'L'], 'ळ'],
    [['kṣ', 'kS', 'kSh', 'ksh', 'x'], 'कष'],
    [['jñ', 'jJ', 'GY', 'dny'], 'जञ']
  ];

  var OTHERS = [
    [['ṃ', 'ṁ', 'M', '.m', '.n'], 'ं'],
    [['ḥ', 'H', '.h'], 'ः'],
    [['m̐', '.N'], 'ँ'],
    [["'", '’', '.a'], 'ऽ'],
    [['||'], '॥'], [['|'], '।']
  ];

  var TOKENS = {}; // roman -> {k:'v'|'c'|'o', ...}
  var MAXLEN = 1;
  function nfc(s) { return s.normalize ? s.normalize('NFC') : s; }
  function addTok(list, kind) {
    list.forEach(function (row) {
      row[0].forEach(function (r) {
        r = nfc(r);
        TOKENS[r] = kind === 'v' ? { k: 'v', ind: row[1], sign: row[2] } : { k: kind, dev: row[1] };
        if (r.length > MAXLEN) MAXLEN = r.length;
      });
    });
  }
  addTok(VOWELS, 'v');
  addTok(CONSONANTS, 'c');
  addTok(OTHERS, 'o');

  var VIRAMA = '्';
  var DEV_DIGITS = '०१२३४५६७८९';

  function romanToDev(input) {
    var s = nfc(String(input));
    var out = '';
    var pending = false; // last output is a consonant awaiting a vowel
    var i = 0;
    while (i < s.length) {
      var tok = null, len = 0;
      for (var L = Math.min(MAXLEN, s.length - i); L > 0; L--) {
        var sub = s.substr(i, L);
        if (TOKENS[sub]) { tok = TOKENS[sub]; len = L; break; }
      }
      if (!tok) {
        // case-insensitive fallback for a single capital letter (e.g. "B", "P", "K")
        var lc = s.charAt(i).toLowerCase();
        if (lc !== s.charAt(i) && TOKENS[lc]) { tok = TOKENS[lc]; len = 1; }
      }
      if (!tok) {
        var ch = s.charAt(i);
        if (pending) { out += VIRAMA; pending = false; }
        if (ch >= '0' && ch <= '9') out += DEV_DIGITS.charAt(+ch);
        else out += ch;
        i++;
        continue;
      }
      if (tok.k === 'v') {
        out += pending ? tok.sign : tok.ind;
        pending = false;
      } else if (tok.k === 'c') {
        var seq = tok.dev;
        for (var j = 0; j < seq.length; j++) {
          if (pending) out += VIRAMA;
          out += seq.charAt(j);
          pending = true;
        }
      } else {
        if (pending) out += VIRAMA;
        pending = false;
        out += tok.dev;
      }
      i += len;
    }
    if (pending) out += VIRAMA;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Devanagari -> IAST                                                  */
  /* ------------------------------------------------------------------ */

  var D_CONS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ṅ', 'च': 'c', 'छ': 'ch', 'ज': 'j', 'झ': 'jh', 'ञ': 'ñ',
    'ट': 'ṭ', 'ठ': 'ṭh', 'ड': 'ḍ', 'ढ': 'ḍh', 'ण': 'ṇ', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'ळ': 'ḻ', 'व': 'v',
    'श': 'ś', 'ष': 'ṣ', 'स': 's', 'ह': 'h', 'ऴ': 'ḻ', 'ऩ': 'n', 'ऱ': 'r',
    'क़': 'q', 'ख़': 'k͟h', 'ग़': 'ġ', 'ज़': 'z', 'ड़': 'ṛ', 'ढ़': 'ṛh', 'फ़': 'f', 'य़': 'ẏ'
  };
  var D_VOW = {
    'अ': 'a', 'आ': 'ā', 'इ': 'i', 'ई': 'ī', 'उ': 'u', 'ऊ': 'ū', 'ऋ': 'ṛ', 'ॠ': 'ṝ', 'ऌ': 'ḷ', 'ॡ': 'ḹ',
    'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऎ': 'e', 'ऒ': 'o', 'ऍ': 'ê', 'ऑ': 'ô'
  };
  var D_SIGN = {
    'ा': 'ā', 'ि': 'i', 'ी': 'ī', 'ु': 'u', 'ू': 'ū', 'ृ': 'ṛ', 'ॄ': 'ṝ', 'ॢ': 'ḷ', 'ॣ': 'ḹ',
    'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॆ': 'e', 'ॊ': 'o', 'ॅ': 'ê', 'ॉ': 'ô'
  };
  var D_OTHER = {
    'ं': 'ṃ', 'ः': 'ḥ', 'ँ': 'm̐', 'ऽ': '’', 'ॐ': 'oṃ', '।': '|', '॥': '||', '॰': '.',
    '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
    '‌': '', '‍': '', '़': ''
  };

  function isDevCombining(c) {
    if (!c) return false;
    var x = c.charCodeAt(0);
    return (x >= 0x0900 && x <= 0x0903) || (x >= 0x093A && x <= 0x094F) || x === 0x0962 || x === 0x0963 ||
      (x >= 0x0951 && x <= 0x0957);
  }

  /**
   * @param {string} s  Devanagari (mixed text allowed; other chars are passed through)
   * @param {string=} next  the character that follows s in the running text (for split text nodes)
   */
  function devToIast(s, next, prev) {
    var out = '';
    var n = s.length;
    var lastInherent = false; // previous output ended with an inherent (written-less) "a"
    var i0 = 0;
    // a leading vowel sign / virama already consumed by the previous text node's consonant
    if (prev && D_CONS[prev] !== undefined) { while (i0 < n && (D_SIGN[s.charAt(i0)] !== undefined || s.charAt(i0) === '्' || s.charAt(i0) === '़')) i0++; }
    for (var i = i0; i < n; i++) {
      var c = s.charAt(i);
      // precomposed nukta letters
      if (s.charAt(i + 1) === '़' && D_CONS[c + '़']) { c = c + '़'; i++; }
      var cons = D_CONS[c];
      if (cons !== undefined) {
        var nx = i + 1 < n ? s.charAt(i + 1) : (next || '');
        if (nx === '़') { i++; nx = i + 1 < n ? s.charAt(i + 1) : (next || ''); }
        if (nx === '्') { out += cons; i++; lastInherent = false; }
        else if (D_SIGN[nx] !== undefined) { out += cons + D_SIGN[nx]; i++; lastInherent = false; }
        else { out += cons + 'a'; lastInherent = true; }
        continue;
      }
      if (D_VOW[c] !== undefined) {
        var v = D_VOW[c];
        // hiatus: "a" + independent i/u written with diaeresis (kaï, kaü) to avoid ai/au ambiguity
        if (lastInherent && (c === 'इ' || c === 'उ')) v = c === 'इ' ? 'ï' : 'ü';
        out += v; lastInherent = false; continue;
      }
      if (D_SIGN[c] !== undefined) { out += D_SIGN[c]; lastInherent = false; continue; }
      if (c === '्') { lastInherent = false; continue; }
      if (D_OTHER[c] !== undefined) { out += D_OTHER[c]; lastInherent = false; continue; }
      out += c; lastInherent = false;
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Search normalisation                                                */
  /* ------------------------------------------------------------------ */

  // characters removed entirely
  var SKIP = {};
  (' \t\n\r\f\v ​‌‍  ﻿।॥|,.;:!?\'"‘’“”()[]{}<>—–-_/\\*+=°º·…॰॒॑').split('').forEach(function (c) { SKIP[c] = 1; });
  var NASALS = { 'ङ': 1, 'ञ': 1, 'ण': 1, 'न': 1, 'म': 1 };
  var LOOSE = {
    'ा': '', 'आ': 'अ', 'ी': 'ि', 'ई': 'इ', 'ू': 'ु', 'ऊ': 'उ', 'ॄ': 'ृ', 'ॠ': 'ऋ',
    'ट': 'त', 'ठ': 'थ', 'ड': 'द', 'ढ': 'ध', 'ण': 'न', 'ङ': 'न', 'ञ': 'न', 'श': 'स', 'ष': 'स', 'ळ': 'ल'
  };

  function isDevConsonant(c) {
    var x = c ? c.charCodeAt(0) : 0;
    return (x >= 0x0915 && x <= 0x0939) || (x >= 0x0958 && x <= 0x095F);
  }
  function isLatinLetter(c) {
    return /[A-Za-zÀ-ɏḀ-ỿ]/.test(c);
  }
  function hasLatin(s) { return /[A-Za-zÀ-ɏḀ-ỿ]/.test(s); }

  var latinCache = {};
  function foldLatin(c) {
    var r = latinCache[c];
    if (r === undefined) {
      r = (c.normalize ? c.normalize('NFD') : c).replace(/[̀-ͯ]/g, '').toLowerCase();
      latinCache[c] = r;
    }
    return r;
  }

  /**
   * Normalise text for substring search; keeps a map back to the original.
   * opts: {avagraha: true (ignore ऽ), loose: false}
   * returns {n, s, e}: s[k]/e[k] = [start,end) in original of normalised char k
   */
  function normalize(text, opts) {
    opts = opts || {};
    var ignoreAv = opts.avagraha !== false;
    var loose = !!opts.loose;
    var n = text.length;
    var out = [];
    var nomap = !!opts.nomap; // index-only: skip the offset map
    var S = nomap ? null : new Int32Array(2 * n + 1), E = nomap ? null : new Int32Array(2 * n + 1);
    var k = 0;
    function emit(str, a, b) {
      for (var q = 0; q < str.length; q++) { out.push(str.charAt(q)); if (!nomap) { S[k] = a; E[k] = b; } k++; }
    }
    for (var i = 0; i < n; i++) {
      var c = text.charAt(i);
      if (SKIP[c]) continue;
      if (c === 'ऽ' && ignoreAv) continue;
      if (c === '़') continue;
      if (NASALS[c] && text.charAt(i + 1) === '्') {
        // nasal + virama before a consonant (possibly across spaces/punctuation) == anusvāra
        var j = i + 2;
        while (j < n && (SKIP[text.charAt(j)] || (ignoreAv && text.charAt(j) === 'ऽ'))) j++;
        if (isDevConsonant(text.charAt(j))) { emit('ं', i, i + 2); i++; continue; }
      }
      if (c === 'ँ') { emit('ं', i, i + 1); continue; }
      var dig = DEV_DIGITS.indexOf(c);
      if (dig >= 0) { emit(String(dig), i, i + 1); continue; }
      if (loose && LOOSE[c] !== undefined) { emit(LOOSE[c], i, i + 1); continue; }
      if (c.charCodeAt(0) < 0x0900 && isLatinLetter(c)) { emit(foldLatin(c), i, i + 1); continue; }
      emit(c, i, i + 1);
    }
    return { n: out.join(''), s: nomap ? null : S.subarray(0, k), e: nomap ? null : E.subarray(0, k) };
  }

  function normalizeQuery(q, opts) {
    var r = normalize(q, opts).n;
    while (r.length && r.charAt(r.length - 1) === '्') r = r.slice(0, -1);
    return r;
  }

  /** Map a hit [a,b) in normalised coordinates back to original [start,end), snapping to akṣara edges. */
  function mapRange(norm, text, a, b) {
    var st = norm.s[a], en = norm.e[b - 1];
    while (st > 0 && isDevCombining(text.charAt(st))) st--;
    while (en < text.length && (isDevCombining(text.charAt(en)) || text.charAt(en) === '़')) en++;
    return [st, en];
  }

  var KT = {
    romanToDev: romanToDev,
    devToIast: devToIast,
    normalize: normalize,
    normalizeQuery: normalizeQuery,
    mapRange: mapRange,
    hasLatin: hasLatin,
    isDevCombining: isDevCombining
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = KT;
  else root.KT = KT;
})(this);
