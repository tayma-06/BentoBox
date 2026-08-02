import 'dotenv/config';

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SEEDS_FILE = path.join(ROOT, 'data', 'movie-seeds.json');
const MOVIES_FILE = path.join(ROOT, 'data', 'movies.json');
const POSTERS_DIR = path.join(ROOT, 'public', 'assets', 'images', 'posters');
const BACKDROPS_DIR = path.join(ROOT, 'public', 'assets', 'images', 'backdrops');
const PLACEHOLDER_DIR = '/assets/images/placeholders';

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const POSTER_SIZE = 'w500';
const BACKDROP_SIZE = 'w1280';
const MAX_RETRIES = 3;
const TIMEOUT_MS = 15000;
const REFRESH = process.argv.includes('--refresh');

function normalizeTitle(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(title, year) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base}-${year}`;
}

async function apiFetch(token, url) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`TMDB responded ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function searchMovie(token, title, year) {
  const params = new URLSearchParams({ query: title, include_adult: 'false' });
  if (year) params.set('year', String(year));
  const url = `${API_BASE}/search/movie?${params.toString()}`;
  const data = await apiFetch(token, url);
  const results = (data && data.results) || [];
  if (!results.length) return null;

  const wanted = normalizeTitle(title);
  let exactMatch = null;
  let titleMatch = null;

  for (const result of results) {
    const titleMatches =
      normalizeTitle(result.title) === wanted ||
      normalizeTitle(result.original_title) === wanted;
    const yearMatches = year
      ? String(result.release_date || '').startsWith(String(year))
      : true;

    if (titleMatches && yearMatches) {
      exactMatch = result;
      break;
    }
    if (titleMatches && !titleMatch) titleMatch = result;
  }

  return exactMatch || titleMatch || results[0];
}

async function getDetails(token, id) {
  return apiFetch(token, `${API_BASE}/movie/${id}?append_to_response=credits`);
}

function pickDirector(credits) {
  if (!credits || !Array.isArray(credits.crew)) return null;
  const director = credits.crew.find((person) => person.job === 'Director');
  return director ? director.name : null;
}

function pickCast(credits, limit = 5) {
  if (!credits || !Array.isArray(credits.cast)) return [];
  return credits.cast
    .slice()
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, limit)
    .map((person) => person.name)
    .filter(Boolean);
}

async function downloadImage(token, url, filePath) {
  if (!url) return false;
  if (fs.existsSync(filePath) && !REFRESH) return true;

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Image responded ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      await fsPromises.writeFile(filePath, buffer);
      return true;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  console.warn(`    Download failed for ${url}: ${lastError.message}`);
  return false;
}

function imagePath(kind, slug, downloaded) {
  if (downloaded) {
    return kind === 'poster'
      ? `/assets/images/posters/${slug}.jpg`
      : `/assets/images/backdrops/${slug}.jpg`;
  }
  return `${PLACEHOLDER_DIR}/${slug}.svg`;
}

function readSeeds() {
  if (!fs.existsSync(SEEDS_FILE)) {
    throw new Error(`Missing seed file: ${SEEDS_FILE}`);
  }
  const data = JSON.parse(fs.readFileSync(SEEDS_FILE, 'utf8'));
  if (!Array.isArray(data)) throw new Error('movie-seeds.json must be an array');
  return data;
}

function readExistingMovies() {
  if (!fs.existsSync(MOVIES_FILE)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(MOVIES_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function run() {
  const token = process.env.TMDB_BEARER_TOKEN;
  if (!token) {
    console.error('No TMDB_BEARER_TOKEN found in .env');
    console.error('Copy .env.example to .env, add your token, then run npm run fetch:movies again.');
    process.exit(1);
  }

  const seeds = readSeeds();
  const existing = new Map(readExistingMovies().map((movie) => [movie.slug, movie]));

  await fsPromises.mkdir(POSTERS_DIR, { recursive: true });
  await fsPromises.mkdir(BACKDROPS_DIR, { recursive: true });

  const summary = [];
  const finalMovies = [];

  for (const seed of seeds) {
    const { title, year } = seed;
    const slug = slugify(title, year);
    const previous = existing.get(slug) || {};
    console.log(`\n== ${title} (${year}) ==`);

    try {
      const searchResult = await searchMovie(token, title, year);
      if (!searchResult) throw new Error('No search result found on TMDB');

      const details = await getDetails(token, searchResult.id);
      if (!details) throw new Error('Details request returned nothing');

      const posterUrl = details.poster_path
        ? `${IMAGE_BASE}/${POSTER_SIZE}${details.poster_path}`
        : null;
      const backdropUrl = details.backdrop_path
        ? `${IMAGE_BASE}/${BACKDROP_SIZE}${details.backdrop_path}`
        : null;

      const posterDownloaded = posterUrl
        ? await downloadImage(token, posterUrl, path.join(POSTERS_DIR, `${slug}.jpg`))
        : false;
      const backdropDownloaded = backdropUrl
        ? await downloadImage(token, backdropUrl, path.join(BACKDROPS_DIR, `${slug}.jpg`))
        : false;

      const movie = {
        id: details.id ?? null,
        slug,
        title: details.title || title,
        originalTitle: details.original_title || null,
        year: Number(year) || (details.release_date ? Number(details.release_date.slice(0, 4)) : null),
        releaseDate: details.release_date || null,
        runtime: typeof details.runtime === 'number' ? details.runtime : null,
        genres: Array.isArray(details.genres) ? details.genres.map((g) => g.name) : [],
        overview: details.overview || null,
        tagline: details.tagline || null,
        rating: typeof details.vote_average === 'number' ? Number(details.vote_average.toFixed(1)) : null,
        voteCount: typeof details.vote_count === 'number' ? details.vote_count : null,
        director: pickDirector(details.credits),
        cast: pickCast(details.credits),
        poster: imagePath('poster', slug, posterDownloaded),
        backdrop: imagePath('backdrop', slug, backdropDownloaded),
        placeholder: `${PLACEHOLDER_DIR}/${slug}.svg`,
        tmdbUrl: details.id ? `https://www.themoviedb.org/movie/${details.id}` : null,
        featured: previous.featured ?? false,
        bentoSize: previous.bentoSize || 'standard',
        bentoClass: previous.bentoClass || null,
        accent: previous.accent || '#ffd75e',
        accentSecondary: previous.accentSecondary || '#a875ff',
        textOnAccent: previous.textOnAccent || '#ffffff',
        world: previous.world || null,
        moodLine: previous.moodLine || null,
        personalNote: previous.personalNote || null,
        audio: previous.audio || null,
      };

      finalMovies.push(movie);
      summary.push({
        slug,
        title: movie.title,
        ok: true,
        poster: posterDownloaded,
        backdrop: backdropDownloaded,
      });
    } catch (err) {
      const kept = Object.keys(previous).length ? { ...previous } : null;
      if (kept) {
        kept.placeholder = `${PLACEHOLDER_DIR}/${slug}.svg`;
        finalMovies.push(kept);
      }
      summary.push({ slug, title, ok: false, reason: err.message, kept: Boolean(kept) });
      console.warn(`    Failed: ${err.message}`);
    }
  }

  await fsPromises.writeFile(MOVIES_FILE, `${JSON.stringify(finalMovies, null, 2)}\n`, 'utf8');

  console.log('\n============================');
  console.log('Summary');
  console.log('============================');
  for (const s of summary) {
    if (s.ok) {
      console.log(`  OK   ${s.slug}  (poster: ${s.poster ? 'saved' : 'missing'}, backdrop: ${s.backdrop ? 'saved' : 'missing'})`);
    } else {
      console.log(`  FAIL ${s.slug}  ${s.reason}${s.kept ? ' (kept previous fallback)' : ''}`);
    }
  }

  const succeeded = summary.filter((s) => s.ok).length;
  console.log(`\nFetched ${succeeded}/${seeds.length} movies.`);
  if (succeeded < seeds.length) {
    console.log('Failed movies were kept as-is in data/movies.json.');
  }
}

run().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
