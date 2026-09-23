# AllRoads - Optimal Meeting Place Finder

A simple web application that helps groups find the perfect meeting place based on everyone's travel times. Instead of using simple geographic centrality, this app considers actual travel times to find the most convenient location for everyone.

## Features

- Add people with Google Places autocomplete (or "Use my location")
- Search for anything: "coffee", "tacos", or a specific place like "Starbucks" (brand searches only show that brand)
- Drive, transit, or walking travel times
- Results ranked by the fairest trip (shortest longest-trip, then shortest average)
- Per-person directions, hours and website, and a shareable link
- Mobile-first layout; on desktop the map sits beside the results

## How it Works

The static site (`index.html`, `script.js`, `styles.css`) is served from GitHub Pages. Map display and address autocomplete run in the browser with a referrer-restricted Maps JavaScript API key.

Everything else goes through a single Firebase HTTPS function, `api` (`functions/index.js`, search logic in `functions/meet.js`), which uses a server-side key stored as the `GOOGLE_MAPS_API_KEY` secret:

- `search`: runs a Places Text Search around the middle of the group, then one batched Distance Matrix call for all candidates, and returns them ranked
- `details`: hours, website and phone for a place, only when a user asks for them
- `geocode`: addresses typed without picking a suggestion, and reverse geocoding for "Use my location"

The page pings the function on load so it's warm by the time people have been entered.

## Deploying

1. Deploy the function first (the site calls `https://api-clevp6kv7a-uc.a.run.app`):
   ```bash
   cd functions && npm run deploy
   ```
2. Push the site to `main` for GitHub Pages.

When changing `script.js` or `styles.css`, bump the `?v=` query on their tags in `index.html` so browsers don't mix a new page with old cached files.

## Local development

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. The browser key is restricted to the production domain, so the map and autocomplete only work on localhost if `localhost` is added to the key's allowed referrers.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
