# Wiki Guessr

A GeoGuessr-inspired geography guessing game built entirely on open data — no API keys, no backend, no build step.

**[Play it →](https://ranjithsiji.github.io/wikiguessr/)**

---

## How it works

Each round shows you a set of photos from a random location on Earth. Click the map to place your guess, then submit to see how close you were. Five rounds per game, up to 5 000 points per round.

Images come from **Wikimedia Commons** (geotagged photos within 10 km of the location, filtered and ranked for geographic content). Location data and coordinates come from **Wikidata** via SPARQL. The interactive map is powered by **OpenStreetMap** tiles via Leaflet.

---

## Features

- **Instant round starts** — locations are pre-fetched in the background while you're playing. A curated fallback pool of 20 geographically diverse locations ensures the first round begins without any wait.
- **No repeat locations** — every location played in a session is tracked and never shown again, including across multiple games.
- **Geographic image filtering** — Commons images are scored against 28 landscape/terrain keywords and ranked so the most geographically informative photos appear first. Portraits, logos, flags, and non-photographic files are excluded.
- **Gallery and slideshow modes** — toggle between a thumbnail grid and an auto-advancing slideshow at any time, including mid-round. Your choice persists across rounds.
- **Exponential scoring** — score = 5 000 × e^(−distance / 2 000 km), capped at zero beyond 20 000 km.
- **Polar region exclusion** — SPARQL queries filter out latitudes above ±70° to avoid uninhabited ice locations.
- **No famous landmarks** — fallback locations are deliberately challenging (fjords, river deltas, volcanic highlands, island archipelagos) rather than instantly recognisable monuments.

---

## Scoring guide

| Distance | Points |
|---|---|
| < 1 km | ~5 000 |
| 10 km | ~4 750 |
| 100 km | ~3 900 |
| 500 km | ~2 100 |
| 1 000 km | ~820 |
| 2 000 km | ~180 |
| ≥ 20 000 km | 0 |

---

## Technology stack

| Component | Library / Service |
|---|---|
| Map | [Leaflet](https://leafletjs.com/) 1.7 + OpenStreetMap tiles |
| DOM / AJAX | jQuery 3.7 |
| Icons | Font Awesome 6 |
| Location data | [Wikidata](https://www.wikidata.org/) SPARQL query service |
| Images | [Wikimedia Commons](https://commons.wikimedia.org/) MediaWiki API |
| Hosting | GitHub Pages (static, no server) |

---

## Running locally

No build step needed — open `index.html` directly in a browser, or serve the directory with any static file server:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

---

## Architecture notes

`game.js` is a single self-contained jQuery module (~430 lines). Key pieces:

- **`locationPool`** — module-level object holding pre-fetched Wikidata locations. `refillLocationPool()` fires a `LIMIT 10 OFFSET <random>` SPARQL batch whenever the pool drops below 3, keeping the next round ready without blocking the UI.
- **`FALLBACK_LOCATIONS`** — 20 hardcoded entries used as an instant fallback when the Wikidata pool hasn't filled yet (first round on page load). Each carries a synthetic `fallback:*` item ID so `seenItems` deduplication treats them identically to Wikidata items.
- **`seenItems`** — module-level `Set` persisting across game restarts in the same browser session; prevents any location repeating.
- **`getImagesFromCommons()`** — fetches 50 candidates at 10 km radius, discards non-BITMAP media, filters portrait/logo/flag categories, ranks survivors by `geoRelevanceScore()`, returns top 20.
- **`getImagesFromWikidata()`** — fallback for locations where Commons geosearch returns nothing.

---

## Credits

Inspired by [guessr](https://guessr.blinry.org/) by [blinry](https://github.com/blinry), which is itself based on [whereami](https://github.com/webdevbrian/whereami) by Brian Kinney.

Coded by [Ranjithsiji](https://github.com/ranjithsiji).  
Supported by [Wikimedians of Kerala User Group](https://meta.wikimedia.org/wiki/Wikimedians_of_Kerala_User_Group).  
Not affiliated with GeoGuessr.

All images displayed from Wikimedia Commons under their respective Creative Commons licences.  
Source code: [MIT License](LICENSE).
