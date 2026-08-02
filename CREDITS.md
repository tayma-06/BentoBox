# Credits & Attribution

## Project

**BentoBox — My Favorite Animation Universe**
“The most random thing I built in the most random time.”

## TMDB data & artwork

Movie metadata (titles, years, synopses, genres, runtimes, ratings, cast, director, posters, backdrops) is provided by **The Movie Database (TMDB)** whenever a TMDB API token is configured and `npm run fetch:movies` is run.

Images are downloaded once and served locally from `public/assets/images/` — nothing is hotlinked from third-party servers.

### Required notice

> This product uses the TMDB API but is not endorsed or certified by TMDB.

The website displays this notice in its **About / Credits** section, along with a text link to https://www.themoviedb.org/.

Please keep this attribution in place in `public/index.html` (the `.tmdb-notice` element) and do not remove it when redistributing the project.

## Interface design

The visual system — bento layout, comic panels, halftone textures, speech bubbles, ink borders, glowing gradients, custom cursor, sparkle trails, and all placeholder artwork — is **original**. It is not a copy of any webtoon, animation studio, streaming platform, or existing website.

## Audio

No copyrighted music is shipped or hotlinked. The soundtrack system is built around three levels:

1. **Spotify full tracks (via the Spotify Web Playback SDK)** — when a visitor connects their own Spotify **Premium** account through the audio panel (PKCE OAuth), hovering a card streams the movie’s original song directly from Spotify via `spotify.trackUri`. No audio passes through or is stored by this site; the SDK only controls playback on the visitor’s own Spotify session.
2. **Official 30-second OST previews (Apple iTunes Search API)** — the guest fallback. When soundtrack mode is on, hovering a movie queries the Apple iTunes Search API and streams Apple’s official 30-second `previewUrl` for a matching track (e.g. “Remember Me” for *Coco*). Only Apple’s official preview endpoint is used; the audio is streamed, never downloaded or copied, and the mini-player links back to Apple as the source. Availability depends on the track being on Apple Music.
3. **Optional lo-fi jazz ambience** — generated at runtime through the same shared audio engine.

To add a real local clip for a movie, see **section 13 (How Soundtrack Playback Works)** of the README. Only use music you have the rights to distribute.

## Fonts

The site loads these **open-license** fonts from Google Fonts, with system-font fallbacks:

- **Bangers** — Open Font License (display)
- **Nunito Sans** — Open Font License (body)

## Placeholder artwork

All SVG placeholder images under `public/assets/images/placeholders/` are original abstract artwork created for this project. They do not reproduce any copyrighted characters.
