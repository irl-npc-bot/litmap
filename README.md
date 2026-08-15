# Almanac — Sci-Fi Release Calendar

A static calendar site tracking science fiction book releases from six major
publishing groups: Penguin Random House, HarperCollins, Simon & Schuster,
Hachette Book Group, Macmillan Publishers, and Bloomsbury Publishing (US
editions). Click a date to see what's releasing that day.

**Live once Pages is enabled:** `https://<your-username>.github.io/<repo-name>/`

## How it works

- **Frontend** (`index.html`, `css/style.css`, `js/app.js`) — a dependency-free
  static site. It fetches `data/releases.json` and renders a month calendar;
  clicking a date shows that day's releases in the panel alongside it.
- **Data pipeline** (`scripts/fetch-releases.js`) — a Node script that queries
  the [Google Books API](https://developers.google.com/books) for each
  publisher and known science-fiction imprint, filters to titles with a
  full (day-level) US release date within a rolling window, and writes the
  result to `data/releases.json`.
- **Automation** (`.github/workflows/update-releases.yml`) — a GitHub Actions
  workflow that runs the fetch script every Monday and on manual trigger,
  committing the refreshed `data/releases.json` back to the repo.

Because the site just reads a checked-in JSON file, GitHub Pages can serve it
with no server and no exposed API keys.

## One-time setup

1. **Enable GitHub Pages**
   Repo → Settings → Pages → Source: "Deploy from a branch" → Branch: `main`,
   folder `/ (root)` → Save.

2. **(Optional) Add a Google Books API key**
   The script works without one, but Google's unauthenticated quota is low
   and undocumented. For reliable weekly runs:
   - Create a key in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
     with the Books API enabled.
   - Repo → Settings → Secrets and variables → Actions → New repository
     secret → name it `GOOGLE_BOOKS_API_KEY`.

3. **Run the workflow once manually**
   Repo → Actions → "Update sci-fi release data" → Run workflow.
   This populates real data — the repo currently ships with an empty
   `data/releases.json` since this environment couldn't reach the Google
   Books API to seed it (network restrictions on the machine that generated
   this project). Check the Action logs for a per-publisher count summary.

## Local development

```bash
node scripts/fetch-releases.js   # populate data/releases.json
python3 -m http.server 8000      # or any static file server
# open http://localhost:8000
```

## Known limitations

- **Imprint mapping, not perfect.** Google Books stores the *imprint*
  (e.g. "Del Rey", "Tor Books") as a title's publisher, not the parent
  company. `scripts/fetch-releases.js` maps each of the six groups to its
  own dedicated SF/Fantasy imprints (`pure`, trusted without a genre check)
  plus general parent-catalog terms (`broad`, genre-filtered since those
  catalogs cover every genre the house publishes) — extend either list in
  the `PUBLISHERS` object if you notice a well-known imprint is missing.
- **Coverage is uneven across publishers, and that's expected.** In
  practice, imprints like Tor, Orbit, and Saga Press turn up plenty of
  day-precise forthcoming titles, while others (Del Rey, Harper Voyager)
  often only have a bare year or year-month in Google's metadata until
  much closer to release — those titles won't appear here yet even though
  the fetch queries ran and returned data. This is a source-data gap, not
  a fetch failure; check `data/releases.json`'s `count` and the Action's
  run summary if a publisher looks sparse.
- **Forthcoming-title coverage is incomplete.** Google Books (and book
  metadata aggregators generally) index titles as they're cataloged, not
  from publisher pre-announcements — a book may not appear until close to
  its release date. `showPreorders=true` and `orderBy=newest` are set to
  surface as many upcoming titles as Google has, but this will still
  under-represent titles announced far in advance. If that turns out to
  matter a lot in practice, a paid, industry-specific source (e.g. ISBNdb,
  Edelweiss) is the upgrade path.
- **Genre tagging is Google's, not the publishers'.** For `pure` imprint
  terms, the imprint itself is treated as the genre signal (no category
  check). For `broad` terms, a title must have a category tag matching a
  fairly wide SFF-adjacent pattern (`science fiction`, `fantasy`,
  `dystopia`, `space opera`, `dragon`, etc.) — Google's own tags are
  inconsistent enough that a strict "science fiction" match rejects most
  real matches, so this is intentionally broad rather than strict.
- **Day-level dates only.** Titles with only a year or year-month in Google's
  data (no specific day) are excluded, since they can't be placed on a
  calendar date.
- **US editions only**, per the current scope.

## Extending

- Add a publisher/imprint: edit the `PUBLISHERS` map in
  `scripts/fetch-releases.js`.
- Widen or narrow the date window: adjust `PAST_MONTHS` / `FUTURE_MONTHS` in
  the same file.
- Change the refresh cadence: edit the `cron` schedule in
  `.github/workflows/update-releases.yml`.
