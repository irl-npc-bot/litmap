// Reproduces exactly what the browser does when a date is clicked:
// unauthenticated fetchWindow() call with the same concurrency/pages
// as js/booksApi.js. Used to check whether unauthenticated requests
// are getting rate-limited in practice.
import { fetchWindow } from "../js/booksApi.js";

const start = Date.now();
try {
  const { fromISO, toISO, releases } = await fetchWindow("2026-08-15", 30);
  console.log(`window: ${fromISO} to ${toISO}`);
  console.log(`releases found: ${releases.length}`);
  console.log(`took ${Date.now() - start}ms`);
} catch (e) {
  console.log("FAILED:", e.message);
}
