/* blog.js — renders the blog index from blogs/posts.json (single source of truth),
   with a tag filter and a client-side text search. No build step needed to update
   the index: edit posts.json and the page re-renders. Zero dependencies. */
(function () {
  "use strict";

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var grid, filterBar, searchInput, emptyMsg, countEl;
  var posts = [], activeTag = null, activeSeries = null, query = "";

  function esc(s) {
    return (s || "").replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return MONTHS[(+p[1]) - 1] + " " + (+p[2]) + ", " + p[0];
  }

  function cardHTML(p) {
    var cats = (p.tags || []).map(function (t) {
      return '<span class="category-tag" data-tag="' + esc(t) + '" role="button" tabindex="0">' + esc(t) + "</span>";
    }).join("");
    var date = p.date
      ? '<div class="blog-meta"><span><i class="far fa-calendar"></i> ' + esc(fmtDate(p.date)) + "</span></div>"
      : "";
    var exc = p.excerpt ? '<div class="blog-excerpt"><p>' + esc(p.excerpt) + "</p></div>" : "";
    var series = p.series
      ? '<span class="series-badge" data-series="' + esc(p.series) + '" role="button" tabindex="0"><i class="fas fa-layer-group"></i> ' + esc(p.series) + " series</span>"
      : "";
    return '<article class="blog-card"><div class="blog-content">' +
      '<div class="vintage-corner top-left"></div><div class="vintage-corner top-right"></div>' +
      '<div class="vintage-corner bottom-left"></div><div class="vintage-corner bottom-right"></div>' +
      (series ? '<div class="blog-series">' + series + "</div>" : "") +
      (cats ? '<div class="blog-categories">' + cats + "</div>" : "") +
      '<a href="' + esc(p.url) + '" style="text-decoration:none;"><h3 class="blog-title">' + esc(p.title) + "</h3></a>" +
      date + exc +
      '<a href="' + esc(p.url) + '" class="read-more">Read More <i class="fas fa-arrow-right"></i></a>' +
      "</div></article>";
  }

  function matches(p) {
    if (activeSeries && p.series !== activeSeries) return false;
    if (activeTag && (p.tags || []).indexOf(activeTag) < 0) return false;
    if (query) {
      var hay = (p.title + " " + (p.excerpt || "") + " " + (p.tags || []).join(" ") + " " + (p.series || "")).toLowerCase();
      if (hay.indexOf(query) < 0) return false;
    }
    return true;
  }

  function renderGrid() {
    var list = posts.filter(matches);
    grid.innerHTML = list.map(cardHTML).join("");
    if (emptyMsg) emptyMsg.style.display = list.length ? "none" : "block";
    if (countEl) countEl.textContent = list.length + (list.length === 1 ? " post" : " posts") +
      (activeTag ? ' tagged “' + activeTag + '”' : "");
    grid.querySelectorAll(".category-tag").forEach(function (el) {
      el.addEventListener("click", function () { setTag(el.dataset.tag); });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setTag(el.dataset.tag); }
      });
    });
    grid.querySelectorAll(".series-badge").forEach(function (el) {
      el.addEventListener("click", function () { setSeries(el.dataset.series); });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSeries(el.dataset.series); }
      });
    });
  }

  function setTag(t) {
    activeTag = (activeTag === t) ? null : t;
    syncFilter(); renderGrid();
    if (filterBar) filterBar.scrollIntoView({ block: "nearest" });
  }
  function setSeries(s) {
    activeSeries = (activeSeries === s) ? null : s;
    syncFilter(); renderGrid();
    if (filterBar) filterBar.scrollIntoView({ block: "nearest" });
  }

  function renderFilter() {
    var counts = {}, series = {};
    posts.forEach(function (p) {
      (p.tags || []).forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
      if (p.series) series[p.series] = (series[p.series] || 0) + 1;
    });
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    var seriesNames = Object.keys(series).sort(function (a, b) { return series[b] - series[a] || a.localeCompare(b); });

    var html = "";
    if (seriesNames.length) {
      html += '<div class="filter-row"><span class="filter-label">Series</span>' +
        seriesNames.map(function (s) {
          return '<button class="filter-chip series-chip" data-series="' + esc(s) + '">' + esc(s) +
            ' <span class="chip-n">' + series[s] + "</span></button>";
        }).join("") + "</div>";
    }
    html += '<div class="filter-row"><span class="filter-label">Topics</span>' +
      '<button class="filter-chip" data-tag="">All</button>' +
      tags.map(function (t) {
        return '<button class="filter-chip" data-tag="' + esc(t) + '">' + esc(t) +
          ' <span class="chip-n">' + counts[t] + "</span></button>";
      }).join("") + "</div>";
    filterBar.innerHTML = html;

    filterBar.querySelectorAll(".filter-chip[data-tag]").forEach(function (b) {
      b.addEventListener("click", function () { setTag(b.dataset.tag || null); });
    });
    filterBar.querySelectorAll(".series-chip").forEach(function (b) {
      b.addEventListener("click", function () { setSeries(b.dataset.series || null); });
    });
    syncFilter();
  }

  function syncFilter() {
    if (!filterBar) return;
    filterBar.querySelectorAll(".filter-chip[data-tag]").forEach(function (b) {
      b.classList.toggle("active", (b.dataset.tag || null) === activeTag);
    });
    filterBar.querySelectorAll(".series-chip").forEach(function (b) {
      b.classList.toggle("active", (b.dataset.series || null) === activeSeries);
    });
  }

  function init() {
    grid = document.getElementById("blog-grid");
    filterBar = document.getElementById("blog-filter");
    searchInput = document.getElementById("blog-search");
    emptyMsg = document.getElementById("blog-empty");
    countEl = document.getElementById("blog-count");
    if (!grid) return;
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        query = searchInput.value.trim().toLowerCase();
        renderGrid();
      });
    }
    fetch("/blogs/posts.json")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { posts = data; renderFilter(); renderGrid(); })
      .catch(function () { grid.innerHTML = '<p class="blog-error">Could not load posts.</p>'; });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
