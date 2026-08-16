import { fetchWindow, isoDate as isoDateFmt } from "./booksApi.js";

(function () {
  "use strict";

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const MAX_DOTS = 5;
  const RADIUS_DAYS = 30;

  /** @type {Record<string, Array<Object>>} */
  let releasesByDate = {};
  /** ISO date strings we've already queried live (empty result still counts as "covered"). */
  const coveredDays = new Set();
  let activeFetchController = null;

  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-indexed
  let selectedDate = isoDate(today);

  const els = {
    grid: document.getElementById("calendar-grid"),
    monthLabel: document.getElementById("month-label"),
    prevBtn: document.getElementById("prev-month"),
    nextBtn: document.getElementById("next-month"),
    dispatchDate: document.getElementById("dispatch-date"),
    dispatchList: document.getElementById("dispatch-list"),
    dataStatus: document.getElementById("data-status"),
  };

  function isoDate(d) {
    return isoDateFmt(d);
  }

  function parseIsoDate(str) {
    // Avoid UTC-shift bugs by constructing from parts rather than `new Date(str)`
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(dateStr, n) {
    const d = parseIsoDate(dateStr);
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }

  function isWindowCovered(anchorDateStr) {
    let cursor = addDays(anchorDateStr, -RADIUS_DAYS);
    const end = addDays(anchorDateStr, RADIUS_DAYS);
    while (cursor <= end) {
      if (!coveredDays.has(cursor)) return false;
      cursor = addDays(cursor, 1);
    }
    return true;
  }

  function markWindowCovered(fromISO, toISO) {
    let cursor = fromISO;
    while (cursor <= toISO) {
      coveredDays.add(cursor);
      cursor = addDays(cursor, 1);
    }
  }

  function mergeReleases(fromISO, toISO, releases) {
    // Live results supersede anything previously held for this range.
    let cursor = fromISO;
    while (cursor <= toISO) {
      delete releasesByDate[cursor];
      cursor = addDays(cursor, 1);
    }
    releases.forEach((r) => {
      if (!releasesByDate[r.releaseDate]) releasesByDate[r.releaseDate] = [];
      releasesByDate[r.releaseDate].push(r);
    });
  }

  /** Ensures live data is loaded for [anchorDate-30, anchorDate+30], fetching only if needed. */
  async function ensureWindow(anchorDateStr) {
    if (isWindowCovered(anchorDateStr)) return;

    if (activeFetchController) activeFetchController.abort();
    const controller = new AbortController();
    activeFetchController = controller;

    const fromLabel = parseIsoDate(addDays(anchorDateStr, -RADIUS_DAYS))
      .toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const toLabel = parseIsoDate(addDays(anchorDateStr, RADIUS_DAYS))
      .toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    els.dataStatus.textContent = `Searching ${fromLabel} – ${toLabel}…`;
    els.dataStatus.classList.add("is-loading");

    try {
      const { fromISO, toISO, releases } = await fetchWindow(anchorDateStr, RADIUS_DAYS, controller.signal);
      mergeReleases(fromISO, toISO, releases);
      markWindowCovered(fromISO, toISO);
      renderStatus(fromLabel, toLabel, releases.length);
    } catch (err) {
      if (err.name === "AbortError") return; // superseded by a newer query
      console.error("Live query failed:", err);
      els.dataStatus.textContent = "Couldn't reach Google Books just now — try again in a moment.";
      els.dataStatus.classList.remove("is-loading");
      return;
    }

    if (activeFetchController === controller) activeFetchController = null;
    renderCalendar();
    renderDispatch();
  }

  function renderStatus(fromLabel, toLabel, count) {
    els.dataStatus.classList.remove("is-loading");
    els.dataStatus.textContent = `${count} title${count === 1 ? "" : "s"} found, ${fromLabel} – ${toLabel} (live from Google Books)`;
  }

  function renderCalendar() {
    els.monthLabel.textContent = `${MONTHS[viewMonth]} ${viewYear}`;
    els.grid.innerHTML = "";

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startOffset = firstOfMonth.getDay(); // 0 = Sunday
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < startOffset; i++) {
      const filler = document.createElement("div");
      filler.className = "day-cell is-empty";
      els.grid.appendChild(filler);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(viewYear, viewMonth, day);
      const dateStr = isoDate(cellDate);
      const releases = releasesByDate[dateStr] || [];

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", `${MONTHS[viewMonth]} ${day}, ${viewYear}${releases.length ? `, ${releases.length} release(s)` : ""}`);

      if (dateStr === isoDate(today)) cell.classList.add("is-today");
      if (dateStr === selectedDate) cell.classList.add("is-selected");

      const num = document.createElement("span");
      num.className = "day-number";
      num.textContent = String(day);
      cell.appendChild(num);

      if (releases.length > 0) {
        const marks = document.createElement("span");
        marks.className = "release-marks";
        const dotCount = Math.min(releases.length, MAX_DOTS);
        for (let i = 0; i < dotCount; i++) {
          const dot = document.createElement("span");
          dot.className = "release-mark";
          marks.appendChild(dot);
        }
        if (releases.length > MAX_DOTS) {
          const overflow = document.createElement("span");
          overflow.className = "release-mark-overflow";
          overflow.textContent = `+${releases.length - MAX_DOTS}`;
          marks.appendChild(overflow);
        }
        cell.appendChild(marks);
      }

      cell.addEventListener("click", () => {
        selectedDate = dateStr;
        renderCalendar();
        renderDispatch();
        ensureWindow(selectedDate);
      });

      els.grid.appendChild(cell);
    }
  }

  function renderDispatch() {
    const dateObj = parseIsoDate(selectedDate);
    els.dispatchDate.textContent = dateObj.toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    const releases = (releasesByDate[selectedDate] || [])
      .slice()
      .sort((a, b) => (a.title || "").localeCompare(b.title || ""));

    els.dispatchList.innerHTML = "";

    if (releases.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No science fiction releases found for this date.";
      els.dispatchList.appendChild(empty);
      return;
    }

    releases.forEach((r) => {
      const card = document.createElement("article");
      card.className = "release-card";

      if (r.coverUrl) {
        const img = document.createElement("img");
        img.className = "release-cover";
        img.src = r.coverUrl;
        img.alt = "";
        img.loading = "lazy";
        card.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "release-cover placeholder";
        ph.textContent = "No cover";
        card.appendChild(ph);
      }

      const body = document.createElement("div");

      const title = document.createElement("p");
      title.className = "release-title";
      if (r.infoLink) {
        const a = document.createElement("a");
        a.href = r.infoLink;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = r.title || "Untitled";
        title.appendChild(a);
      } else {
        title.textContent = r.title || "Untitled";
      }
      body.appendChild(title);

      if (r.authors && r.authors.length) {
        const author = document.createElement("p");
        author.className = "release-author";
        author.textContent = r.authors.join(", ");
        body.appendChild(author);
      }

      const meta = document.createElement("div");
      meta.className = "release-meta";
      if (r.publisherGroup) {
        const pTag = document.createElement("span");
        pTag.className = "tag tag-publisher";
        pTag.textContent = r.publisherGroup;
        meta.appendChild(pTag);
      }
      if (r.publisher && r.publisher !== r.publisherGroup) {
        const iTag = document.createElement("span");
        iTag.className = "tag";
        iTag.textContent = r.publisher;
        meta.appendChild(iTag);
      }
      body.appendChild(meta);

      card.appendChild(body);
      els.dispatchList.appendChild(card);
    });
  }

  els.prevBtn.addEventListener("click", () => {
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    renderCalendar();
    ensureWindow(isoDate(new Date(viewYear, viewMonth, 15)));
  });

  els.nextBtn.addEventListener("click", () => {
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    renderCalendar();
    ensureWindow(isoDate(new Date(viewYear, viewMonth, 15)));
  });

  (async function init() {
    renderCalendar();
    renderDispatch();
    await ensureWindow(selectedDate); // ±30 days around today, on first load
  })();
})();
