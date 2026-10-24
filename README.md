# Heads-Up Honey

A private, calendar-first cycle tracker for one couple. One person logs; it runs as an iPhone Home Screen web app (Safari → Share → Add to Home Screen).

- **Files:** `index.html` (everything, no build step), `apple-touch-icon.png`, `icon-512.png`, `tests.mjs`, and `assets/pots/` (the header pot's 17 images as WebP; `src/` holds the untouched originals and is never loaded).
- **Data lives on this device only.** It is stored in the browser under the key `heads-up-honey-data-v1`. The code makes no network calls and contains no personal data, so a public copy of this repo opens as a blank app.
- **Back up:** Settings → Export JSON (full backup) or Export CSV (spreadsheet). Restore with Settings → Import JSON; the file is checked in full before anything is replaced, and replacing existing data needs a second tap.
- **Skins:** Settings → Skin switches Honey Midnight (default) / Honey Cream; the choice is per device (`heads-up-honey-ui-v1`), never in backups, and Reset leaves it alone.
- **Pot motion:** Settings → Pot motion (off by default) keeps the honey level to real gravity, slow like honey: tip the phone sideways and it climbs to the lip, upside down it clings there with one slow drip, and it never pours out; turning it on asks for motion access, and nothing moves without it.
- **Calendar file:** Settings → Add predicted window to calendar (.ics) downloads one 🍯 all-day event; import it into a private calendar for widgets and re-download when a new prediction appears.
- **Reset:** Settings → Reset this app’s data clears only this app’s key, never other apps on the same site.
- **Checks:** `node tests.mjs` (Node 18+, no packages).
