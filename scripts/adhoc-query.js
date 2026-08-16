// One-off query: science-fiction-specific titles, Jan 1 - Aug 1 2026,
// across the 6 publisher groups' known imprints. Not part of the main
// site pipeline (see fetch-releases.js) -- this is for direct inspection.
import { writeFile } from "node:fs/promises";

const API_KEY = process.env.GOOGLE_BOOKS_API_KEY || "";
const API_BASE = "https://www.googleapis.com/books/v1/volumes";
const PAGE_SIZE = 40;
const MAX_PAGES_PER_TERM = 6;
const REQUEST_DELAY_MS = 300;

const WINDOW_FROM = "2026-01-01";
const WINDOW_TO = "2026-08-01";

const PUBLISHERS = {
  "Penguin Random House": ["Del Rey", "Ace Books", "DAW Books", "Ballantine Books", "Berkley", "Penguin Random House"],
  "HarperCollins": ["Harper Voyager", "Avon", "HarperCollins"],
  "Simon & Schuster": ["Saga Press", "Gallery Books", "Simon & Schuster"],
  "Hachette Book Group": ["Orbit", "Redhook Books", "Hachette Book Group"],
  "Macmillan Publishers": ["Tor Books", "Tordotcom", "Forge Books", "Macmillan"],
  "Bloomsbury Publishing": ["Bloomsbury Publishing", "Bloomsbury"],
};

const SCI_FI_SIGNAL_RE = /\bspaceship|space station|starship|\bspace opera|cyberpunk|dystopia|post-?apocalyp|time travel|artificial intelligence|\bAI\b|\balien|extraterrestrial|\brobot|android|cyborg|galax|interstellar|near-future|colonization of (mars|the moon)|first contact|generation ship|terraform|dyst[oa]pian future|sci-?fi|science fiction/i;
const FANTASY_SIGNAL_RE = /\bdragon|\bmagic\b|sorcer|wizard|\belf\b|\belves\b|prophecy|kingdom|witch|spell\b|enchant|fae\b|fairy|goblin|orc\b|realm of|throne\b/i;

function guessGenre(title, description) {
  const text = `${title} ${description}`;
  const sf = SCI_FI_SIGNAL_RE.test(text);
  const fantasy = FANTASY_SIGNAL_RE.test(text);
  if (sf && !fantasy) return "likely sci-fi";
  if (fantasy && !sf) return "likely fantasy";
  if (sf && fantasy) return "sci-fi/fantasy mix?";
  return "unclear (no signal)";
}

const FULL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function toHttps(u) { return u ? u.replace(/^http:\/\//, "https://") : u; }

async function fetchPage(term, startIndex) {
  const params = new URLSearchParams({
    q: `inpublisher:"${term}"`,
    country: "US",
    maxResults: String(PAGE_SIZE),
    printType: "books",
    orderBy: "relevance",
  });
  params.set("startIndex", String(startIndex));
  if (API_KEY) params.set("key", API_KEY);
  const res = await fetch(`${API_BASE}?${params.toString()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for "${term}" @ ${startIndex}`);
  return res.json();
}

async function fetchForTerm(term, publisherGroup, resultsMap) {
  let startIndex = 0;
  for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
    let data;
    try {
      data = await fetchPage(term, startIndex);
    } catch (err) {
      console.warn(`  ! ${term}: ${err.message}`);
      break;
    }
    const items = data.items || [];
    const totalItems = data.totalItems || 0;
    for (const item of items) {
      const info = item.volumeInfo || {};
      const releaseDate = info.publishedDate || "";
      if (!FULL_DATE_RE.test(releaseDate)) continue;
      if (releaseDate < WINDOW_FROM || releaseDate > WINDOW_TO) continue;
      const categories = info.categories || [];
      const description = info.description || "";
      const title = info.title || "Untitled";
      resultsMap.set(item.id, {
        title,
        authors: info.authors || [],
        publisher: info.publisher || term,
        publisherGroup,
        releaseDate,
        categories,
        genreGuess: guessGenre(title, description),
        descriptionSnippet: description.slice(0, 160),
        infoLink: toHttps(info.infoLink || info.canonicalVolumeLink || ""),
      });
    }
    await sleep(REQUEST_DELAY_MS);
    if (items.length === 0) break;
    startIndex += items.length;
    if (startIndex >= totalItems) break;
  }
}

async function main() {
  const resultsMap = new Map();
  for (const [group, terms] of Object.entries(PUBLISHERS)) {
    for (const term of terms) {
      console.log(`querying "${term}" (${group})...`);
      await fetchForTerm(term, group, resultsMap);
    }
  }
  const list = [...resultsMap.values()].sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  console.log(`\nTotal sci-fi titles ${WINDOW_FROM} to ${WINDOW_TO}: ${list.length}`);
  await writeFile("adhoc-results.json", JSON.stringify(list, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
