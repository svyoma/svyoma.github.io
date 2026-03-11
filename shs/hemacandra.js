/**
 * Hemacandra Śabdānuśāsana — Shared JS v2
 * Haimavyākaraṇa Digitization Project
 *
 * All transliterations are pre-baked in sutras.json — no runtime API calls.
 * Search works simultaneously across all scripts (Devanagari, IAST, ISO15919, HK).
 */

(function () {
  "use strict";

  const SCRIPTS = ["Devanagari", "IAST", "ISO15919", "HK"];

  const SCRIPT_LABELS = {
    Devanagari: "देव",
    IAST:       "IAST",
    ISO15919:   "ISO",
    HK:         "HK",
  };

  const STORAGE_KEY = "hemacandra_script_v2";
  const DEV_DIGITS  = "०१२३४५६७८९";

  let _currentScript = localStorage.getItem(STORAGE_KEY) || "Devanagari";

  // Validate stored value
  if (!SCRIPTS.includes(_currentScript)) _currentScript = "Devanagari";

  const HC = {
    SCRIPTS,
    SCRIPT_LABELS,

    getCurrentScript() { return _currentScript; },

    setCurrentScript(script) {
      if (!SCRIPTS.includes(script)) return;
      _currentScript = script;
      localStorage.setItem(STORAGE_KEY, script);
      document.documentElement.dataset.script = script;
    },

    /**
     * Format a ref string (e.g. "1.2.3") for display in the current script.
     *   Devanagari → ॥१।२।३॥
     *   Roman      → 1.2.3
     */
    formatRef(ref, script) {
      script = script || _currentScript;
      if (script === "Devanagari") {
        const devRef = ref
          .replace(/\d/g, d => DEV_DIGITS[+d])
          .replace(/\./g, "।");
        return `॥${devRef}॥`;
      }
      return ref;
    },

    /**
     * Search helper: returns true if any transliteration of the sutra
     * matches the query string.  Works for Devanagari input, IAST, or any script.
     */
    sutraMatchesQuery(sutra, query) {
      if (!query) return true;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      // Search sūtra text across all scripts
      if (Object.values(sutra.texts).some(t => t.toLowerCase().includes(q))) return true;
      // Search in ref
      if (sutra.ref.toLowerCase().includes(q)) return true;
      // Search in commentary
      if (sutra.commentaries && sutra.commentaries.length > 0) {
        for (const comm of sutra.commentaries) {
          if (Object.values(comm).some(v =>
            typeof v === "string" && v.toLowerCase().includes(q)
          )) return true;
        }
      }
      return false;
    },

    /**
     * Escape HTML special chars.
     */
    escHtml(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    },

    /**
     * Highlight query matches in text. Returns HTML string.
     */
    highlight(text, query) {
      if (!query || !query.trim()) return HC.escHtml(text);
      const q = query.trim();
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      return HC.escHtml(text).replace(re, m => `<mark>${m}</mark>`);
    },

    /**
     * Build a script-toggle widget inside container.
     * opts.onSwitch(script) called on selection.
     */
    buildScriptToggle(container, opts = {}) {
      const wrap = document.createElement("div");
      wrap.className = "script-toggle";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "Script selection");

      SCRIPTS.forEach(script => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = SCRIPT_LABELS[script];
        btn.dataset.script = script;
        btn.title = script === "Devanagari"
          ? "Devanagari (Sanskrit script)"
          : script === "IAST"
            ? "International Alphabet of Sanskrit Transliteration"
            : script === "ISO15919"
              ? "ISO 15919 transliteration"
              : "Harvard-Kyoto transliteration";

        if (script === _currentScript) btn.classList.add("active");

        btn.addEventListener("click", () => {
          wrap.querySelectorAll("button").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          HC.setCurrentScript(script);
          if (opts.onSwitch) opts.onSwitch(script);
        });

        wrap.appendChild(btn);
      });

      container.innerHTML = "";
      container.appendChild(wrap);
      return wrap;
    },
  };

  // Initialize document data-script attribute
  document.documentElement.dataset.script = _currentScript;

  window.HC = HC;
})();
