(function () {
  "use strict";

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  const MAX_DOTS = 5;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = isoDate(today);

  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let selectedDate = todayISO;

  /** @type {Record<string, Array<Object>>} day ISO -> releases */
  let releasesByDate = {};
  /** month-precision entries: YYYY-MM -> releases */
  let releasesByMonth = {};

  const els = {
    grid:          document.getElementById("calendar-grid"),
    monthLabel:    document.getElementById("month-label"),
    prevBtn:       document.getElementById("prev-month"),
    nextBtn:       document.getElementById("next-month"),
    dispatchDate:  document.getElementById("dispatch-date"),
    dispatchList:  document.getElementById("dispatch-list"),
    dataStatus:    document.getElementById("data-status"),
  };

  // ── helpers ────────────────────────────────────────────────────────────────

  function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseIsoDate(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function isPast(dateISO) {
    return dateISO < todayISO;
  }

  function isCurrentMonth(y, m) {
    return y === today.getFullYear() && m === today.getMonth();
  }

  // ── data loading ────────────────────────────────────────────────────────────

  const FULL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTH_DATE_RE = /^\d{4}-\d{2}$/;

  async function loadData() {
    els.dataStatus.textContent = "Loading…";
    try {
      const res = await fetch("data/releases.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      releasesByDate = {};
      releasesByMonth = {};

      for (const r of (json.releases || [])) {
        if (!r.releaseDate) continue;

        if (FULL_DATE_RE.test(r.releaseDate)) {
          r._precision = "day";
          if (!releasesByDate[r.releaseDate]) releasesByDate[r.releaseDate] = [];
          releasesByDate[r.releaseDate].push(r);
        } else if (MONTH_DATE_RE.test(r.releaseDate)) {
          r._precision = "month";
          if (!releasesByMonth[r.releaseDate]) releasesByMonth[r.releaseDate] = [];
          releasesByMonth[r.releaseDate].push(r);
          // Also bucket under the 1st so the calendar can show a dot
          const bucketDay = r.releaseDate + "-01";
          if (!releasesByDate[bucketDay]) releasesByDate[bucketDay] = [];
          releasesByDate[bucketDay].push(r);
        }
      }

      const total = (json.releases || []).length;
      const future = (json.releases || []).filter(r => {
        const key = FULL_DATE_RE.test(r.releaseDate) ? r.releaseDate : r.releaseDate + "-01";
        return key >= todayISO;
      }).length;
      els.dataStatus.textContent =
        `${future} upcoming release${future === 1 ? "" : "s"} · updated from Locus Magazine`;
    } catch (err) {
      console.error("Failed to load releases:", err);
      els.dataStatus.textContent = "Couldn't load release data.";
    }
  }

  // ── calendar ────────────────────────────────────────────────────────────────

  function renderCalendar() {
    els.monthLabel.textContent = `${MONTHS[viewMonth]} ${viewYear}`;

    // Disable prev button if we're already at the current month
    els.prevBtn.disabled = isCurrentMonth(viewYear, viewMonth);

    els.grid.innerHTML = "";
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startOffset = firstOfMonth.getDay();
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
      const past = isPast(dateStr);

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "day-cell";
      if (past) cell.classList.add("is-past");
      if (dateStr === todayISO) cell.classList.add("is-today");
      if (dateStr === selectedDate) cell.classList.add("is-selected");
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label",
        `${MONTHS[viewMonth]} ${day}, ${viewYear}${releases.length ? `, ${releases.length} release(s)` : ""}`);

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
          dot.className = releases[i]._precision === "month"
            ? "release-mark-approx"
            : "release-mark";
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
      });

      els.grid.appendChild(cell);
    }
  }

  // ── dispatch (day detail panel) ─────────────────────────────────────────────

  function formatDate(dateISO, precision) {
    if (precision === "month") {
      const [y, m] = dateISO.split("-").map(Number);
      return new Date(y, m - 1, 1)
        .toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    return parseIsoDate(dateISO)
      .toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  }

  function buildCard(r) {
    const card = document.createElement("article");
    card.className = "release-card";

    // No cover image in manual data — show imprint initial as placeholder
    const ph = document.createElement("div");
    ph.className = "release-cover placeholder";
    ph.textContent = (r.imprint || "?").charAt(0).toUpperCase();
    card.appendChild(ph);

    const body = document.createElement("div");

    const title = document.createElement("p");
    title.className = "release-title";
    title.textContent = r.title || "Untitled";
    body.appendChild(title);

    if (r.authors && r.authors.length) {
      const author = document.createElement("p");
      author.className = "release-author";
      author.textContent = r.authors.join(", ");
      body.appendChild(author);
    }

    const meta = document.createElement("div");
    meta.className = "release-meta";

    if (r._precision === "month") {
      const aTag = document.createElement("span");
      aTag.className = "tag tag-approx";
      aTag.textContent = "date approximate";
      meta.appendChild(aTag);
    }

    if (r.imprint) {
      const iTag = document.createElement("span");
      iTag.className = "tag tag-publisher";
      iTag.textContent = r.imprint;
      meta.appendChild(iTag);
    }

    if (r.notes) {
      const nTag = document.createElement("span");
      nTag.className = "tag";
      nTag.textContent = r.notes;
      meta.appendChild(nTag);
    }

    body.appendChild(meta);
    card.appendChild(body);
    return card;
  }

  function renderDispatch() {
    // Show the month-precision entries for the selected date's month, too
    const monthKey = selectedDate.slice(0, 7); // "YYYY-MM"
    const dayReleases = (releasesByDate[selectedDate] || [])
      .filter(r => r._precision === "day");
    const monthReleases = (releasesByMonth[monthKey] || []);

    const dateObj = parseIsoDate(selectedDate);
    els.dispatchDate.textContent = dateObj.toLocaleDateString(undefined, {
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    });

    els.dispatchList.innerHTML = "";

    if (dayReleases.length === 0 && monthReleases.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No releases on this date.";
      els.dispatchList.appendChild(empty);
      return;
    }

    // Exact-day releases first
    dayReleases
      .slice().sort((a, b) => (a.title || "").localeCompare(b.title || ""))
      .forEach(r => els.dispatchList.appendChild(buildCard(r)));

    // Then month-precision entries for this month (if any), with a divider
    if (monthReleases.length > 0) {
      const divider = document.createElement("p");
      divider.className = "dispatch-month-note";
      divider.textContent = `Also releasing sometime in ${MONTHS[dateObj.getMonth()]}:`;
      els.dispatchList.appendChild(divider);
      monthReleases
        .slice().sort((a, b) => (a.title || "").localeCompare(b.title || ""))
        .forEach(r => els.dispatchList.appendChild(buildCard(r)));
    }
  }

  // ── nav ─────────────────────────────────────────────────────────────────────

  els.prevBtn.addEventListener("click", () => {
    // Don't go before the current month
    if (isCurrentMonth(viewYear, viewMonth)) return;
    viewMonth -= 1;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    renderCalendar();
    renderDispatch();
  });

  els.nextBtn.addEventListener("click", () => {
    viewMonth += 1;
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    renderCalendar();
    renderDispatch();
  });

  // ── init ────────────────────────────────────────────────────────────────────

  (async function init() {
    await loadData();
    renderCalendar();
    renderDispatch();
  })();
})();
