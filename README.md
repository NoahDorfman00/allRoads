# all roads

Find the fairest place for a group to meet. Everyone enters where they're
coming from, you type what you're after ("coffee", "tacos", "Starbucks"), and
all roads ranks real places by the trip of whoever has it worst. Live at
[allroads.noahgdorfman.com](https://allroads.noahgdorfman.com).

<p align="center">
  <img src="assets/social.png" alt="Illustration: three friends as map pins, with dashed routes converging on a single pin in the middle of a city map, under the title 'all roads: find the perfect meeting place'" width="560">
</p>

## Why

Every time family, friends or coworkers needed somewhere to meet, I ended up
doing it by hand: open a map, guess at a spot in the middle, check
everyone's trip, try another spot. all roads does that part for me.

The obvious answer is the geographic midpoint, but straight-line distance
isn't travel time. all roads ignores the midpoint for ranking and uses
actual drive, transit or walking times for every person.

## How it works

A search is two Google calls on the backend: one to find candidate places,
one to time every person's trip to every candidate.

**1. Pick a search area.** The backend averages everyone's coordinates into a
centroid, then measures how far the farthest person is from it (haversine).
The search radius is half that spread, clamped between 1.5 km and 50 km, so
a group across one neighborhood and a group across a state both get a
sensible area.

**2. Find candidates.** A Places **Text Search** runs for whatever you typed,
biased to the centroid and radius. "Biased" is doing a lot of work there:
Text Search treats location as a suggestion, so results more than
`2 × radius + 2 km` from the middle get dropped, along with anything marked
permanently closed.

**3. Brand filter.** If you search "starbucks", you want Starbucks, not
the coffee shop next door that Google thinks is relevant. When enough
results contain every word of the query in their name (at least three, or
half of them), only those are kept. Generic queries like "coffee" rarely
match many names, so they pass through untouched. The top 20 survive.

**4. Time every trip.** One **Distance Matrix** request covers everyone ×
every candidate, in the selected mode (drive, transit or walk). The matrix
API caps a request at 100 elements and 25 destinations, so destinations are
chunked to `min(25, floor(100 / people))` per request and the chunks run in
parallel. With the max of 10 people, that's two requests for 20 candidates.
A place that anyone can't reach is dropped.

**5. Rank by fairness.** Venues are sorted by their **longest** trip,
rounded to the minute, with the **average** trip breaking ties. The first
version minimized total travel time instead, which happily sends one
friend on a 50-minute drive if it saves the other two ten minutes each.
Minimizing the worst trip is the fairer rule. Rounding to the minute turns
near-ties into real ties, and among those the lower average wins.

**Everything else is on demand.** Hours, website and phone come from a
**Place Details** call only when someone taps "Hours & info", and the
result is cached per place until the page reloads. Addresses usually come straight
from the browser's Places Autocomplete with coordinates attached; anything
typed without picking a suggestion is geocoded on search. "Use my location"
takes the browser's position and reverse-geocodes it, so a shared link says
an address instead of "My location".

**Share links are the state.** The URL holds each person's rounded
coordinates and label, the query, the mode, and the selected venue, e.g.
`?p=39.95,-75.16,Center+City&p=...&q=tacos&m=t`. Opening one re-runs the
search. Links from before the 2026 redesign used a base64 JSON `?state=`
param; those still decode.

### Google Maps APIs used

| Where | API | For |
|-------|-----|-----|
| Browser | Maps JavaScript API (`places`, `marker` libraries) | Map, Places Autocomplete, Advanced Markers (needs a Map ID) |
| Backend | Places API: Text Search | Candidate venues |
| Backend | Distance Matrix API | Travel time from every person to every candidate |
| Backend | Places API: Place Details | Hours, website, phone (on tap) |
| Backend | Geocoding API | Typed addresses and reverse geocoding |

## Architecture

```
GitHub Pages (index.html, script.js, styles.css)
  │  browser key, referrer-restricted: map + autocomplete only
  │
  └─ POST { action } ─▶ Firebase Function `api` (Node 22, us-central1)
                          │  server key from Secret Manager
                          ├─ search   → Text Search + batched Distance Matrix
                          ├─ details  → Place Details
                          └─ geocode  → Geocoding (forward or reverse)
```

- **Frontend:** plain HTML, CSS and JavaScript. No framework, no build step.
  Mobile-first layout; at 960px and up the map sits beside the results.
- **Backend:** a single Firebase Functions v2 HTTPS function. Search logic
  lives in `functions/meet.js` as pure functions that take a `mapsGet`
  callback, so the ranking doesn't know or care about HTTP.
- **Warm-up ping:** the page sends a `GET` to the function on load. By the
  time people have typed in two addresses, the cold start is already paid.
- **Keys:** the browser key can only do maps and autocomplete and is locked
  to the production domain. Everything that costs real money (search, matrix,
  details, geocoding) runs server-side with a key the browser never sees.

It didn't start this way. The first version did everything in the browser.
The second (January 2025) moved Google calls into five separate Cloud
Functions, and the page chained them: find venues, then a Distance Matrix
call **per venue**. The September 2026 redesign collapsed that into one
function, one text search and one batched matrix call.

## Running it locally

The site is static:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

The browser key is restricted to the production domain, so the map and
autocomplete only work on localhost if `localhost` is added to the key's
allowed referrers. Searches go to the deployed function, whose URL is the
`API_URL` constant at the top of `script.js`. The browser key and Map ID are
constants there too (`MAPS_API_KEY`, `MAP_ID`).

To run or deploy your own backend (needs the Firebase CLI and a project with
the Places, Distance Matrix and Geocoding APIs enabled):

```bash
cd functions
npm install
firebase functions:secrets:set GOOGLE_MAPS_API_KEY   # server-side key
npm run serve     # local emulator
npm run deploy    # firebase deploy --only functions
```

Then point `API_URL` in `script.js` at your function. When changing
`script.js` or `styles.css`, bump the `?v=` query on their tags in
`index.html` so browsers don't mix a new page with old cached files.

## Lessons learned

1. **Fair isn't the same as efficient.** Minimizing total travel time (v1) can stick one person with the worst trip, so ranking moved to the longest trip first.
2. **A static site can't keep a secret.** An attempt to hide the key behind a build workflow and `config.js` was rolled back within the hour; the real fix was a server-side key plus a referrer-locked browser key.
3. **Count round trips, not functions.** Five endpoints and a matrix call per venue became one function, one search and one batched matrix request.
4. **"Location bias" means bias.** Text Search will return results well outside the radius you give it, so the distance filter has to happen on your side.
5. **Share links are an API.** Once people have sent links around, the old format has to keep working after a redesign.

## Repo layout

```
index.html        page markup, meta tags
script.js         people, autocomplete, results, map markers, share links
styles.css        mobile-first styles
assets/           favicon, logo, social card
functions/
  index.js        the `api` HTTPS function: routing, validation, Maps calls
  meet.js         search area, brand filter, batched matrix, fairness ranking
firebase.json     Functions config
CNAME             custom domain for GitHub Pages
```

## Credits

Built on [Google Maps Platform](https://developers.google.com/maps).

