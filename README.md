# BentoBox — My Favorite Animation Universe

> The most random thing I built in the most random time.

A personal, hand-built gallery of my favorite animated movies presented in a bento-box layout with an original webtoon-inspired aura: comic panels, halftone dots, speech bubbles, ink borders, glowing gradients, sparkles, and a custom cursor.

No frameworks. No bundler. No database. Just semantic HTML, modern CSS, vanilla JavaScript, and a tiny Express backend.

---

## 1. Features

- Strict **12-column bento-box grid** with explicit per-movie placement (no holes, no layout shift on hover); responsive 6-column tablet and 2-column mobile layouts
- Floating keyboard-accessible navigation with a movie-count badge
- Search, genre filter, and sort (no page reloads, debounced)
- Desktop **hover pop-up** with quick facts + a **full modal** for details (comic-frame transition)
- **Soundtrack mode**: hover a card to hear that movie’s original song — full tracks streamed through the **Spotify Web Playback SDK** (once you connect a premium account), with official 30-second Apple Music previews as the guest fallback — plus a mini now-playing player, an audio panel, and ARIA announcements
- Optional **lo-fi jazz ambience** running through the same shared Web Audio engine
- **Custom cartoon cursor** (simple circle-ring cursor) that disables itself on touch devices and with reduced motion
- Scroll-reveal animations and glowing auras (aura is sound-reactive while a cue plays)
- Fallback data + original SVG placeholder art so the site works with **no TMDB token**
- Full keyboard support, ARIA live regions, focus trapping, reduced-motion support
- Responsive at 1440 / 1280 / 1100 / 700 / 480 / 375 px

## 2. Technologies

- Semantic HTML5
- Modern CSS (custom properties, CSS Grid, `:focus-visible`, `dialog`, media queries)
- Vanilla JavaScript (ES modules not required — plain deferred scripts)
- Node.js + Express.js
- dotenv
- Native `fetch` (Node 18+)
- Nodemon (dev dependency only)

## 3. Folder structure

```text
bentobox/
├── public/
│   ├── index.html
│   ├── callback.html    ← Spotify OAuth redirect page
│   ├── styles.css
│   ├── app.js
│   ├── soundtrack.js
│   ├── spotify.js       ← Spotify Web Playback SDK bridge (PKCE OAuth)
│   ├── audio.js
│   ├── cursor.js
│   └── assets/
│       ├── images/
│       │   ├── posters/      ← TMDB posters land here
│       │   ├── backdrops/    ← TMDB backdrops land here
│       │   └── placeholders/ ← original SVG placeholder art
│       ├── audio/
│       │   └── soundtracks/  ← licensed clips go here (gitignored)
│       └── icons/
├── data/
│   ├── movie-seeds.json      ← the titles + years you want to fetch
│   ├── movies.json           ← the working collection data
│   └── soundtracks.json      ← per-movie song slots (Spotify + iTunes) + configs
├── scripts/
│   ├── fetch-movies.mjs      ← downloads metadata + artwork from TMDB
│   └── resolve-spotify.mjs   ← fills spotify track URIs via the Search API
├── server.js
├── package.json
├── .env.example
├── .gitignore
├── README.md
├── CREDITS.md
└── AGENTS.md
```

## 4. Installation

```bash
npm install
```

Requires **Node.js 18 or newer**.

## 5. Create your `.env`

```bash
cp .env.example .env
```

`.env` lives in the project root:

```env
PORT=3000
TMDB_BEARER_TOKEN=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
```

### Spotify (optional — for full-song playback)

To enable full original tracks instead of Apple previews:

1. Go to https://developer.spotify.com/dashboard and create an app.
2. Add a Redirect URI matching your `SPOTIFY_REDIRECT_URI` (for local dev: `http://localhost:3000/callback`).
3. Copy the **Client ID** and **Client Secret** into `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in `.env`.
4. Restart the server. The audio panel will then show a **Connect Spotify** row; connecting requires a **Premium** account.
5. Fill in the 18 track URIs (one-time, needs `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`):

```bash
npm run resolve:spotify
```

Without `SPOTIFY_CLIENT_ID`, the Spotify row is hidden and the site quietly uses Apple previews.

## 6. Where to put the TMDB bearer token

1. Go to https://www.themoviedb.org/ and create a free account.
2. Open **Settings → API** and request an API key.
3. The v3 **API Read Access Token** is a long string like `eyJhbGciOi...`.
4. Paste it into `.env`:

```env
TMDB_BEARER_TOKEN=your_token_here
```

Keep `.env` private — it is already in `.gitignore` and is never sent to the browser.

## 7. Fetch movie information

```bash
npm run fetch:movies
```

This script:

- Reads `data/movie-seeds.json`
- Searches TMDB for each exact title + release year
- Prefers an exact title-and-year match
- Pulls details + credits, picks the director and up to 5 cast members
- Downloads posters and backdrops into `public/assets/images/`
- Writes everything into `data/movies.json`

> `npm run fetch:movies` **requires** a TMDB bearer token in `.env`.

Tips:

- Re-run it any time; files already on disk are **not re-downloaded**.
- Force a refresh of images with `npm run fetch:movies -- --refresh`.
- If one movie fails, the rest keep going and the failed movie keeps its previous data.

## 8. Run development mode

```bash
npm run dev
```

Nodemon restarts the server automatically when you change files. Open http://localhost:3000.

## 9. Run production mode

```bash
npm start
```

Then open http://localhost:3000.

## 10. Customize movie titles

Edit `data/movie-seeds.json`:

```json
[
  { "title": "Coco", "year": 2017 }
]
```

Add, remove, or reorder entries. **The order in `movie-seeds.json` is the display order in the bento grid.** After editing, run `npm run fetch:movies` to pull fresh metadata.

For a new movie, add a `bentoClass` and an `accent` color in `data/movies.json` (fallback entries already include them):

```json
{
  "slug": "coco-2017",
  "bentoClass": "bento-coco",
  "accent": "#ff9f5e",
  "accentSecondary": "#ffd75e",
  "textOnAccent": "#12101c",
  "world": "Santa Cecilia",
  "moodLine": "A family memory turned bright, musical, and unforgettable."
}
```

`bentoClass` must match a placement rule in `public/styles.css` (e.g. `.bento-coco`), which sets explicit `grid-column`/`grid-row` tracks on the strict 12-column grid. Add a new placement rule if you add a movie so the grid never gains holes.

## 11. Edit personal notes

In `data/movies.json`, edit the `personalNote` field. These appear in the movie modal under the label **“Favorite thought”**:

```json
{
  "personalNote": "Family memory turned bright, musical, and unforgettable."
}
```

Notes are placeholders written in original wording — not claims about anyone’s real opinions. Change them however you like.

## 12. Change colors

All colors are CSS custom properties in `public/styles.css`, at the top:

```css
:root {
  --bg-deep: #0b1026;
  --paper: #fff7e8;
  --ink: #12101c;
  --cyan: #59e7ff;
  --violet: #a875ff;
  --coral: #ff738d;
  --yellow: #ffd75e;
  --mint: #7ff0c8;
  ...
}
```

Each movie card also has its own `--accent` color set from `data/movies.json` → `accent`.

## 13. How Soundtrack Playback Works

Soundtrack mode is **silent until you enable it**. Each movie points at one real, original song. The app tries full Spotify playback first, then falls back to Apple’s official 30-second preview.

### The three levels

1. **Level 1 — licensed local clip.** Place a file you have rights to in `public/assets/audio/soundtracks/` and set `audioPath` on the movie. Keep `available: true` only when a real, rights-cleared file ships.
2. **Level 2 — Spotify full track (default when connected).** After a user connects a Spotify **Premium** account from the audio panel (PKCE OAuth + the Spotify Web Playback SDK), hovering a card streams the full original song via `spotify.trackUri`. If a URI is missing, this level is skipped silently.
3. **Level 3 — official Apple Music preview.** Each entry in `data/soundtracks.json` has an `itunes` object (`term`, optional `preferredTrack` / `preferredCollection`). The app queries the **Apple iTunes Search API** (`https://itunes.apple.com/search`), picks the best matching song with a preview, and streams its official 30-second `previewUrl` through the shared Web Audio engine.

### The `spotify` + `itunes` configs

```json
{
  "movieSlug": "coco-2017",
  "sourceType": "spotify-track",
  "available": false,
  "itunes": {
    "term": "coco remember me",
    "preferredTrack": "Remember Me",
    "preferredCollection": "Coco"
  },
  "spotify": {
    "term": "remember me coco",
    "preferredTrack": "Remember Me",
    "artistName": "Coco - Cast",
    "trackName": "Remember Me (Ernesto de la Cruz)",
    "trackUri": "spotify:track:...",
    "externalUrl": "https://open.spotify.com/track/..."
  }
}
```

- `term` / `preferredTrack` / `preferredCollection` bias the iTunes pick toward the famous song and its OST album (the app prefers official soundtrack versions over covers). Results are cached in memory for 6 hours, so repeated hovers are instant.
- `spotify.trackUri` is set by `npm run resolve:spotify` (searching the Spotify API for the best `preferredTrack` / `artistName` match); it can also be authored by hand. Only streamed through the SDK, never downloaded.
- Only **Apple’s official preview URL** is streamed for guests, and only when the track is available on Apple Music. Nothing is downloaded or copied, and the mini-player “Listen at source ↗” links to Spotify (connected) or Apple (guests).
- For Level 1 clips: `startAt` trims to a preview moment; `composer` and `storeUrl` power the mini-player “Listen at source ↗” link.
- **Never copy soundtrack files from the web into the repo.** `.gitignore` ignores `public/assets/audio/soundtracks/` content, so the site works with zero audio files shipped.

## 14. Accessibility

- Semantic landmarks, logical heading order, skip-to-content link
- Keyboard-accessible movie cards (real buttons, visible focus states; focusing a card starts its soundtrack)
- Full modal semantics with focus trapping, Escape close, and focus return
- `aria-live` regions announce search/filter results and soundtrack changes (`#audio-announcer`)
- Audio panel is fully keyboard operable (Escape closes it, focus returns to the toggle)
- Color is never the only signal (text + icons accompany accents)
- Custom cursor is disabled for `pointer: coarse` devices and never hides the native cursor unless it initialized
- `prefers-reduced-motion` disables parallax, cursor trails, sound-reactive effects, and long transitions

## 15. Attribution

See `CREDITS.md`. The site displays the required TMDB notice in its About section:

> This product uses the TMDB API but is not endorsed or certified by TMDB.

## 16. Troubleshooting

**`npm run fetch:movies` says “No TMDB_BEARER_TOKEN found”** — you need a token in `.env` (see section 6). The fallback site still runs without one.

**`/api/health` shows `movieCount: 0`** — `data/movies.json` is missing or invalid. Restore it from Git or re-run `npm run fetch:movies`.

**Images don’t change after fetching** — existing files are preserved on purpose. Use `npm run fetch:movies -- --refresh` to overwrite them.

**No sound at all** — Soundtrack mode is off by default; enable it from the ♪ audio panel. Very old browsers lack Web Audio; the site then runs silently.

**A preview won’t play** — without a connected Spotify account the app relies on Apple Music previews; the track may not be available on Apple Music (the app then announces it and plays nothing). For local Level 1 clips the file may be missing or the browser blocked the codec. With Spotify connected, check that the account is **Premium** (the SDK rejects free accounts) and that `SPOTIFY_CLIENT_ID` is in `.env`.

**Port already in use** — change `PORT` in `.env` or run `node server.js` with `PORT=3001 npm start`.

**Falling back to placeholders** — if a poster/backdrop is missing or fails to load, the app automatically swaps in the matching SVG placeholder.

## 17. Deployment notes

The whole app is one Node process, and it is Vercel-ready.

- **Vercel (recommended):** push to GitHub, then import the repo at https://vercel.com/new. `vercel.json` routes everything through `server.js` as a serverless function. In **Project → Settings → Environment Variables** add:
  - `SPOTIFY_CLIENT_ID` — required for the Connect-Spotify row to appear.
  - `SPOTIFY_REDIRECT_URI` — must be your live URL, e.g. `https://<your-project>.vercel.app/callback`. **Add that same URL to your Spotify app's Redirect URIs** in the dashboard, or login will fail.
  - `TMDB_BEARER_TOKEN` — optional; the fallback data works without it.
  - `PORT` is unnecessary on Vercel.
- **Local/VM:** `npm install && npm start` (optionally `PORT=8080`).
- **Platform with `.env` support** (Render, Railway, Fly.io, a VPS, etc.): add the same variables as secrets so they never sit in Git.
- **Static-only hosts** (GitHub Pages, Netlify static) **can’t** run the `/api` endpoints. For those, the page works only if you also host `data/movies.json` — the API is what makes the collection load, so keep the Express server as the host.

---

Built with pixels, memories, and a little movie magic. ✦
