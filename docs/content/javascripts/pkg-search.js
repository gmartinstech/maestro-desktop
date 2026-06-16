/*
 * Scoped package search.
 *
 * Every generated package-overview page (see docs/gen_pages.py) carries a
 * `<div class="pkg-search" data-scope="backend/apps/agents/" ...>` marker. This
 * turns each into an in-page search box that queries ONLY that package's subtree
 * of the site search index (site/search.json) — classes, functions, attributes,
 * and prose under `data-scope`, deep-linked to their anchors.
 *
 * The full index is fetched lazily (first focus) and cached across widgets. While
 * a query is active the card grid is hidden and ranked results take its place;
 * clearing the box restores the grid. Everything is wrapped in try/catch and
 * degrades to the plain card grid if anything goes wrong or JS is disabled.
 */
(function () {
  "use strict";

  var MAX_RESULTS = 40;

  // --- shared index (fetched once) -----------------------------------------

  var indexPromise = null;

  function siteBase() {
    try {
      var cfg = JSON.parse(document.getElementById("__config").textContent);
      return String(cfg.base || ".").replace(/\/?$/, "/");
    } catch (e) {
      return "./";
    }
  }
  var BASE = siteBase();

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(new URL(BASE + "search.json", location.href).href)
        .then(function (r) { return r.json(); })
        .then(function (d) { return (d && d.items) || []; })
        .catch(function () { return []; });
    }
    return indexPromise;
  }

  // --- helpers --------------------------------------------------------------

  var SCRATCH = document.createElement("div");
  function stripTags(html) {
    if (!html) return "";
    SCRATCH.innerHTML = html;
    return (SCRATCH.textContent || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function resolve(location_) {
    try {
      return new URL(BASE + location_, location.href).href;
    } catch (e) {
      return location_;
    }
  }

  // Build a ~160-char window of `text` around the first matched term, with every
  // term wrapped in <mark>. Operates on already-stripped plain text.
  function snippet(text, terms) {
    if (!text) return "";
    var lower = text.toLowerCase();
    var at = -1;
    for (var i = 0; i < terms.length; i++) {
      var p = lower.indexOf(terms[i]);
      if (p !== -1 && (at === -1 || p < at)) at = p;
    }
    var start = at === -1 ? 0 : Math.max(0, at - 40);
    var slice = text.slice(start, start + 160);
    if (start > 0) slice = "… " + slice;
    if (start + 160 < text.length) slice = slice + " …";

    var out = escapeHtml(slice);
    terms.forEach(function (t) {
      if (!t) return;
      var re = new RegExp("(" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
      out = out.replace(re, "<mark>$1</mark>");
    });
    return out;
  }

  function rank(items, scope, selfPage, terms) {
    var results = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var loc = it.location || "";
      if (loc.indexOf(scope) !== 0) continue;           // outside this subtree
      if (loc === selfPage || loc.indexOf(selfPage + "#") === 0) continue; // self

      var title = stripTags(it.title);
      var text = stripTags(it.text);
      var hayTitle = title.toLowerCase();
      var hayText = text.toLowerCase();

      var score = 0, ok = true;
      for (var t = 0; t < terms.length; t++) {
        var inTitle = hayTitle.indexOf(terms[t]) !== -1;
        var inText = hayText.indexOf(terms[t]) !== -1;
        if (!inTitle && !inText) { ok = false; break; }
        score += inTitle ? 10 : 1;
      }
      if (!ok) continue;

      results.push({ href: resolve(loc), title: title, text: text,
                     path: it.path || [], score: score });
    }
    results.sort(function (a, b) {
      return b.score - a.score || a.title.length - b.title.length;
    });
    return results.slice(0, MAX_RESULTS);
  }

  // --- widget ---------------------------------------------------------------

  function mount(widget) {
    if (widget.__pkgWired) return;
    widget.__pkgWired = true;

    var scope = widget.getAttribute("data-scope") || "";
    var label = widget.getAttribute("data-label") || "this package";
    var selfPage = scope + "index.html";
    var grid = widget.parentElement
      ? widget.parentElement.querySelector(".grid.cards")
      : null;

    var input = document.createElement("input");
    input.type = "search";
    input.className = "pkg-search__input";
    input.placeholder = "Search " + label + "…";
    input.setAttribute("aria-label", "Search " + label);

    var results = document.createElement("div");
    results.className = "pkg-search__results";
    results.hidden = true;

    widget.appendChild(input);
    widget.appendChild(results);

    function showGrid(show) {
      if (grid) grid.style.display = show ? "" : "none";
    }

    function render(list, terms, q) {
      if (!list.length) {
        results.innerHTML =
          '<p class="pkg-search__empty">No matches for “' +
          escapeHtml(q) + "” in " + escapeHtml(label) + ".</p>";
        return;
      }
      var html = ['<ul class="pkg-search__list">'];
      list.forEach(function (r) {
        var crumb = r.path.length
          ? '<span class="pkg-search__crumb">' +
            escapeHtml(r.path.join(" / ")) + "</span>"
          : "";
        var snip = r.text
          ? '<span class="pkg-search__snip">' + snippet(r.text, terms) + "</span>"
          : "";
        html.push(
          '<li><a href="' + r.href + '">' +
          '<span class="pkg-search__title">' + escapeHtml(r.title) + "</span>" +
          crumb + snip + "</a></li>"
        );
      });
      html.push("</ul>");
      results.innerHTML = html.join("");
    }

    var scheduled = false;
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        run();
      });
    }

    function run() {
      var q = input.value.trim();
      if (!q) {
        results.hidden = true;
        results.innerHTML = "";
        showGrid(true);
        return;
      }
      var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      showGrid(false);
      results.hidden = false;
      loadIndex().then(function (items) {
        if (input.value.trim() !== q) return; // superseded by newer keystroke
        render(rank(items, scope, selfPage, terms), terms, q);
      });
    }

    input.addEventListener("focus", loadIndex, { once: true });
    input.addEventListener("input", schedule);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { input.value = ""; run(); }
    });
  }

  function start() {
    try {
      var widgets = document.querySelectorAll(".pkg-search[data-scope]");
      for (var i = 0; i < widgets.length; i++) mount(widgets[i]);
    } catch (e) {
      /* leave the card grid as-is */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
