// js/booksApi.js
//
// Client-side Google Books querying, run directly from the browser (no
// backend). Google's search endpoint sends CORS headers and doesn't require
// auth for search, so this works as a plain fetch() from any origin.
//
// This mirrors the imprint/genre logic in scripts/fetch-releases.js:
//   - pure imprints (Del Rey, Orbit, Tor, ...) are trusted without a
//     category check, since the imprint itself is the genre signal.
//   - broad/parent-catalog terms (Penguin Random House, HarperCollins, ...)
//     get a genre check, since those catalogs cover every genre the house
//     publishes.

const API_BASE = "https://www.googleapis.com/books/v1/volumes";
// Substituted at deploy time by .github/workflows/deploy-pages.yml from the
// GOOGLE_BOOKS_API_KEY repo secret. Left as-is (unauthenticated) this key
// stays a literal placeholder and requests will get rate-limited almost
// immediately -- Google's unauthenticated Books API quota is too tight for
// this many parallel requests per date click (confirmed: every request
// failed with HTTP 429 in testing). The key is necessarily visible in the
// deployed page's JS source once substituted; restrict it in Google Cloud
// Console to your Pages domain via HTTP referrer + Books API scope only.
const API_KEY = "__GOOGLE_BOOKS_API_KEY__";
const PAGE_SIZE = 40;
const MAX_PAGES_PER_TERM = 5; // was 3; safe to raise now requests are authenticated
const CONCURRENCY = 8;

export const PUBLISHERS = {
  "Penguin Random House": {
    pure: ["Del Rey", "Ace Books", "DAW Books"],
    broad: ["Penguin Random House", "Ballantine Books", "Berkley"],
  },
  "HarperCollins": {
    pure: ["Harper Voyager"],
    broad: ["HarperCollins", "Avon"],
  },
  "Simon & Schuster": {
    pure: ["Saga Press"],
    broad: ["Simon & Schuster", "Gallery Books"],
  },
  "Hachette Book Group": {
    pure: ["Orbit", "Redhook Books"],
    broad: ["Hachette Book Group"],
  },
  "Macmillan Publishers": {
    pure: ["Tor Books", "Tordotcom", "Forge Books"],
    broad: ["Macmillan"],
  },
  "Bloomsbury Publishing": {
    pure: [],
    broad: ["Bloomsbury Publishing", "Bloomsbury"],
  },
};

const FULL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_DATE_RE = /^\d{4}-\d{2}$/;
const GENRE_RE = /science.?fiction|fantasy|dystopia|apocalyp|speculative fiction|space opera|alien|extraterrestrial|time travel|cyberpunk|dragon|robot|magic/i;

export function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Last calendar day of a "YYYY-MM" string, as "YYYY-MM-DD". */
function monthEndDate(yyyymm) {
  const [y, m] = yyyymm.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last day of this month
  return `${yyyymm}-${String(lastDay).padStart(2, "0")}`;
}

function toHttps(url) {
  return url ? url.replace(/^http:\/\//, "https://") : url;
}

function normalizeItem(item, publisherGroup, requireGenreMatch) {
  const info = item.volumeInfo || {};
  const rawDate = info.publishedDate || "";

  let precision, releaseDate, rangeStart, rangeEnd;
  if (FULL_DATE_RE.test(rawDate)) {
    precision = "day";
    releaseDate = rawDate;
    rangeStart = rawDate;
    rangeEnd = rawDate;
  } else if (MONTH_DATE_RE.test(rawDate)) {
    precision = "month";
    releaseDate = rawDate;
    rangeStart = `${rawDate}-01`;
    rangeEnd = monthEndDate(rawDate);
  } else {
    return null; // year-only or missing dates are too vague to place usefully
  }

  const categories = info.categories || [];
  if (requireGenreMatch && !categories.some((c) => GENRE_RE.test(c))) return null;

  return {
    id: item.id,
    title: info.title || "Untitled",
    authors: info.authors || [],
    publisher: info.publisher || publisherGroup,
    publisherGroup,
    releaseDate,   // "YYYY-MM-DD" or "YYYY-MM"
    precision,     // "day" | "month"
    rangeStart,    // always a concrete "YYYY-MM-DD", for range-overlap checks
    rangeEnd,
    genreTags: categories,
    coverUrl: toHttps(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || ""),
    infoLink: info.infoLink || info.canonicalVolumeLink || "",
  };
}

async function fetchPage(term, startIndex, signal) {
  const params = new URLSearchParams({
    q: `inpublisher:"${term}"`,
    country: "US",
    maxResults: String(PAGE_SIZE),
    printType: "books",
    orderBy: "newest",
    showPreorders: "true",
  });
  params.set("startIndex", String(startIndex));
  if (API_KEY && !API_KEY.startsWith("__")) params.set("key", API_KEY);

  const url = `${API_BASE}?${params.toString()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { signal });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt)); // 500ms, then 1000ms
      continue;
    }
    throw new Error(`HTTP ${res.status} for term "${term}"`);
  }
}

async function fetchForTerm(term, publisherGroup, requireGenreMatch, fromISO, toISO, resultsMap, signal, failedTerms, dayPrecisionOnly) {
  let startIndex = 0;
  for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
    let data;
    try {
      data = await fetchPage(term, startIndex, signal);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      console.warn(`  ! ${term}: ${err.message}`);
      failedTerms.push(term);
      break;
    }
    const items = data.items || [];
    const totalItems = data.totalItems || 0;
    for (const item of items) {
      const normalized = normalizeItem(item, publisherGroup, requireGenreMatch);
      if (!normalized) continue;
      if (dayPrecisionOnly && normalized.precision !== "day") continue;
      // Interval overlap: include if [rangeStart, rangeEnd] intersects [fromISO, toISO]
      if (normalized.rangeStart <= toISO && normalized.rangeEnd >= fromISO) {
        resultsMap.set(normalized.id, normalized);
      }
    }
    if (items.length === 0) break;
    startIndex += items.length;
    if (startIndex >= totalItems) break;
  }
}

/** Runs async task factories with a concurrency cap. */
async function runPool(taskFns, limit) {
  const executing = new Set();
  for (const fn of taskFns) {
    const p = fn().finally(() => executing.delete(p));
    executing.add(p);
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.allSettled(executing);
}

/**
 * Query Google Books for releases in [anchorDate - radiusDays, anchorDate + radiusDays].
 * Includes both day-precision and month-precision results (month-precision
 * entries are useful context even though they can't be pinned to an exact
 * calendar cell -- the caller decides how to display them).
 * Returns { fromISO, toISO, releases, failedTerms }.
 */
export async function fetchWindow(anchorDate, radiusDays = 30, signal) {
  const from = new Date(anchorDate);
  from.setDate(from.getDate() - radiusDays);
  const to = new Date(anchorDate);
  to.setDate(to.getDate() + radiusDays);
  const fromISO = isoDate(from);
  const toISO = isoDate(to);

  const resultsMap = new Map();
  const failedTerms = [];
  const taskFns = [];
  for (const [group, { pure = [], broad = [] }] of Object.entries(PUBLISHERS)) {
    for (const term of pure) {
      taskFns.push(() => fetchForTerm(term, group, false, fromISO, toISO, resultsMap, signal, failedTerms, false));
    }
    for (const term of broad) {
      taskFns.push(() => fetchForTerm(term, group, true, fromISO, toISO, resultsMap, signal, failedTerms, false));
    }
  }

  await runPool(taskFns, CONCURRENCY);

  return { fromISO, toISO, releases: [...resultsMap.values()], failedTerms };
}

/**
 * Query Google Books for everything releasing between today and
 * `monthsAhead` months out -- day-precision AND month-precision both
 * included, since the point of this view is "what's coming", not "what
 * date exactly". Meant for a standing "Upcoming Releases" list, not the
 * day-by-day calendar grid.
 * Returns { fromISO, toISO, releases, failedTerms }.
 */
export async function fetchUpcoming(monthsAhead = 12, signal) {
  const from = new Date();
  const to = new Date();
  to.setMonth(to.getMonth() + monthsAhead);
  const fromISO = isoDate(from);
  const toISO = isoDate(to);

  const resultsMap = new Map();
  const failedTerms = [];
  const taskFns = [];
  for (const [group, { pure = [], broad = [] }] of Object.entries(PUBLISHERS)) {
    for (const term of pure) {
      taskFns.push(() => fetchForTerm(term, group, false, fromISO, toISO, resultsMap, signal, failedTerms, false));
    }
    for (const term of broad) {
      taskFns.push(() => fetchForTerm(term, group, true, fromISO, toISO, resultsMap, signal, failedTerms, false));
    }
  }

  await runPool(taskFns, CONCURRENCY);

  return { fromISO, toISO, releases: [...resultsMap.values()], failedTerms };
}
