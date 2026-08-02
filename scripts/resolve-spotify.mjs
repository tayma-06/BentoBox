import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOUNDTRACKS_FILE = path.join(ROOT, 'data', 'soundtracks.json');

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SEARCH_URL = 'https://api.spotify.com/v1/search';

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getToken() {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET } = process.env;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required in .env');
  }
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Spotify token request failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  return data.access_token;
}

function scoreTrack(track, wantName, wantArtist) {
  const tName = normalize(track.name);
  const tArtists = (track.artists || []).map((a) => normalize(a.name));
  let score = 0;
  if (tName === wantName) score += 4;
  else if (tName.includes(wantName) || wantName.includes(tName)) score += 2;
  if (tArtists.some((a) => a === wantArtist)) score += 3;
  else if (tArtists.some((a) => a.includes(wantArtist) || wantArtist.includes(a))) score += 1.5;
  return { score, popularity: track.popularity || 0 };
}

async function searchTrack(token, cfg) {
  const wantName = normalize(cfg.preferredTrack);
  const wantArtist = normalize(cfg.artistName);
  const params = new URLSearchParams({ q: cfg.term, type: 'track', limit: '10' });
  const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Spotify search failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const tracks = (data.tracks && data.tracks.items) || [];
  if (!tracks.length) return null;

  let best = null;
  for (const track of tracks) {
    const { score, popularity } = scoreTrack(track, wantName, wantArtist);
    if (!best || score > best.score || (score === best.score && popularity > best.popularity)) {
      best = { track, score, popularity };
    }
  }
  if (!best || best.score < 3) return null;
  return best.track;
}

const soundtracks = JSON.parse(fs.readFileSync(SOUNDTRACKS_FILE, 'utf8'));
const token = await getToken();

let resolved = 0;
let skipped = 0;

for (const entry of soundtracks) {
  const cfg = entry.spotify;
  if (!cfg) continue;
  if (cfg.trackUri && cfg.externalUrl) {
    console.log(`• ${entry.movieSlug}: already set`);
    skipped += 1;
    continue;
  }
  try {
    const track = await searchTrack(token, cfg);
    if (!track) {
      console.warn(`✗ ${entry.movieSlug}: no confident match for "${cfg.term}"`);
      continue;
    }
    cfg.trackUri = `spotify:track:${track.id}`;
    cfg.externalUrl = `https://open.spotify.com/track/${track.id}`;
    cfg.trackName = track.name;
    cfg.artistName = (track.artists || []).map((a) => a.name).join(', ');
    console.log(`✓ ${entry.movieSlug}: ${cfg.trackName} — ${cfg.artistName}`);
    resolved += 1;
  } catch (err) {
    console.warn(`✗ ${entry.movieSlug}: ${err.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
}

fs.writeFileSync(SOUNDTRACKS_FILE, `${JSON.stringify(soundtracks, null, 2)}\n`);
console.log(`\nDone. ${resolved} resolved, ${skipped} already set.`);
