// scripts/fetch-releases.js
//
// Queries the Google Books API for science fiction titles from six major
// publishing groups and writes a normalized dataset to data/releases.json.
//
// Run with:  node scripts/fetch-releases.js
// Optional:  GOOGLE_BOOKS_API_KEY env var raises Google's fair-use quota.
//
// WHY SEARCH BY IMPRINT, NOT JUST THE PARENT COMPANY:
// Google Books stores the *imprint* as a book's publisher field (e.g.
// "Del Rey", "Tor Books"), almost never the parent corporation. Searching
// only "Penguin Random House" would miss nearly everything it actually
// publishes. So each parent group below is mapped to its own name plus its
// best-known science fiction imprints, and every result is tagged with the
// parent group for display/filtering.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "..", "data", "releases.json");

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY || "";
const API_BASE = "https://www.googleapis.com/books/v1/volumes";

// How far back/forward from today to keep releases. Wide enough to be a
// useful calendar, narrow enough to skip decades of backlist noise.
const PAST_MONTHS = 6;
const FUTURE_MONTHS = 18;

// Pages of 40 results to pull per search term. Raise cautiously — this
// multiplies directly against Google's request quota.
const MAX_PAGES_PER_TERM = 3;
const PAGE_SIZE = 40;
const REQUEST_DELAY_MS = 350;

// Publisher group -> search terms (parent name + known SF imprints).
// Extend these lists as you discover more relevant imprints.
const PUBLISHERS = {
  "Penguin Random House": [
    "Penguin Random House", "Del Rey", "Ace Books", "DAW Books",
    "Ballantine Books", "Berkley",
  ],
  "HarperCollins": [
    "HarperCollins", "Harper Voyager", "Avon",
  ],
  "Simon & Schuster": [
    "Simon & Schuster", "Saga Press", "Gallery Books",
  ],
  "Hachette Book Group": [
    "Hachette Book Group", "Orbit", "Redhook Books",
  ],
  "Macmillan Publishers": [
    "Macmillan", "Tor Books", "Tordotcom", "Forge Books",
  ],
  "Bloomsbury Publishing": [
    "Bloomsbury Publishing", "Bloomsbury",
  ],
};

const FULL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SCI_FI_RE = /science fiction/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function monthsFromNow(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setMonth(d.getMonth() + n);
  return d;
}

function buildQuery(term) {
  const q = `inpublisher:"${term}" subject:"Science Fiction"`;
  const params = new URLSearchParams({
    q,
    country: "US",
    maxResults: String(PAGE_SIZE),
    printType: "books",
    orderBy: "newest",
    showPreorders: "true",
  });
  if (API_KEY) params.set("key", API_KEY);
  return params;
}

async function fetchPage(term, startIndex) {
  const params = buildQuery(term);
  params.set("startIndex", String(startIndex));
  const url = `${API_BASE}?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for term "${term}" (startIndex ${startIndex})`);
  }
  return res.json();
}

function toHttps(url) {
  return url ? url.replace(/^http:\/\//, "https://") : url;
}

function normalizeItem(item, publisherGroup) {
  const info = item.volumeInfo || {};
  const releaseDate = info.publishedDate || "";

  if (!FULL_DATE_RE.test(releaseDate)) return null; // need day-level precision

  const categories = info.categories || [];
  if (categories.length > 0 && !categories.some((c) => SCI_FI_RE.test(c))) {
    return null; // query matched but categories don't actually mention sci-fi
  }

  return {
    id: item.id,
    title: info.title || "Untitled",
    authors: info.authors || [],
    publisher: info.publisher || publisherGroup,
    publisherGroup,
    releaseDate,
    genreTags: categories,
    coverUrl: toHttps(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || ""),
    infoLink: info.infoLink || info.canonicalVolumeLink || "",
  };
}

async function fetchForTerm(term, publisherGroup, resultsMap) {
  for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
    const startIndex = page * PAGE_SIZE;
    let data;
    try {
      data = await fetchPage(term, startIndex);
    } catch (err) {
      console.warn(`  ! ${term}: ${err.message}`);
      break;
    }

    const items = data.items || [];
    const totalItems = data.totalItems || 0;
    if (process.env.DEBUG_FETCH) {
      console.log(`    [debug] totalItems=${totalItems} itemsThisPage=${items.length}`);
      for (const item of items.slice(0, 3)) {
        const info = item.volumeInfo || {};
        console.log(`    [debug] sample: title="${info.title}" publishedDate="${info.publishedDate}" categories=${JSON.stringify(info.categories || [])} publisher="${info.publisher}"`);
      }
    }
    for (const item of items) {
      const normalized = normalizeItem(item, publisherGroup);
      if (normalized) resultsMap.set(normalized.id, normalized);
    }

    await sleep(REQUEST_DELAY_MS);
    if (startIndex + PAGE_SIZE >= totalItems || items.length === 0) break;
  }
}

async function main() {
  const resultsMap = new Map(); // id -> normalized release, deduped across terms
  const cutoffPast = monthsFromNow(-PAST_MONTHS);
  const cutoffFuture = monthsFromNow(FUTURE_MONTHS);

  console.log(`Fetching science fiction releases between ${cutoffPast.toISOString().slice(0, 10)} and ${cutoffFuture.toISOString().slice(0, 10)}`);
  if (!API_KEY) {
    console.log("No GOOGLE_BOOKS_API_KEY set — using unauthenticated requests (lower quota).");
  }

  for (const [publisherGroup, terms] of Object.entries(PUBLISHERS)) {
    console.log(`\n${publisherGroup}`);
    for (const term of terms) {
      console.log(`  querying "${term}"...`);
      await fetchForTerm(term, publisherGroup, resultsMap);
    }
  }

  const inWindow = [...resultsMap.values()].filter((r) => {
    const d = new Date(r.releaseDate + "T00:00:00");
    return d >= cutoffPast && d <= cutoffFuture;
  });

  inWindow.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));

  const counts = {};
  for (const r of inWindow) counts[r.publisherGroup] = (counts[r.publisherGroup] || 0) + 1;

  console.log("\n--- Summary ---");
  for (const [group, count] of Object.entries(counts)) console.log(`${group}: ${count}`);
  console.log(`Total: ${inWindow.length}`);

  const output = {
    generatedAt: new Date().toISOString(),
    count: inWindow.length,
    dateWindow: {
      from: cutoffPast.toISOString().slice(0, 10),
      to: cutoffFuture.toISOString().slice(0, 10),
    },
    releases: inWindow,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf-8");
  console.log(`\nWrote ${inWindow.length} releases to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
