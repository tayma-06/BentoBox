require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'movies.json');
const SOUNDTRACKS_FILE = path.join(__dirname, 'data', 'soundtracks.json');

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

function readMovies() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[BentoBox] Could not read data/movies.json:', err.message);
    return [];
  }
}

app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/callback', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'callback.html'));
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'BentoBox',
    movieCount: readMovies().length,
  });
});

app.get('/api/spotify/config', (req, res) => {
  res.json({
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    redirectUri: process.env.SPOTIFY_REDIRECT_URI || '',
  });
});

app.get('/api/movies', (req, res) => {
  res.json(readMovies());
});

app.get('/api/soundtracks', (req, res) => {
  try {
    const raw = fs.readFileSync(SOUNDTRACKS_FILE, 'utf8');
    const data = JSON.parse(raw);
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.warn('[BentoBox] Could not read data/soundtracks.json:', err.message);
    res.json([]);
  }
});

app.get('/api/movies/:slug', (req, res) => {
  const slug = String(req.params.slug || '').trim();
  if (!slug) {
    return res.status(400).json({ error: 'Missing movie slug' });
  }
  const movies = readMovies();
  const movie = movies.find((m) => m && m.slug === slug);
  if (!movie) {
    return res.status(404).json({ error: 'Movie not found', slug });
  }
  res.json(movie);
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Unknown API route', path: req.originalUrl });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`BentoBox is running at http://localhost:${PORT}`);
  });
}

module.exports = app;
