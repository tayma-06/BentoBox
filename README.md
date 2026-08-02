# BentoBox

A personal bento-box gallery of favorite animated movies — webtoon-style UI, with soundtrack mode (full songs via Spotify for Premium users, Apple Music previews for everyone else).

**Live:** https://bentobox-orpin.vercel.app

## Quick start

```bash
npm install
npm start   # http://localhost:3000
```

## .env

```env
PORT=3000
TMDB_BEARER_TOKEN=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
```

## Scripts

- `npm run fetch:movies` — pull movie data from TMDB
- `npm run resolve:spotify` — fill Spotify track URIs
- `npm run check` — syntax check

## Deploy

Push to GitHub, import the repo on Vercel, and set `SPOTIFY_CLIENT_ID` + `SPOTIFY_REDIRECT_URI` (your live URL) in the project's environment variables.
