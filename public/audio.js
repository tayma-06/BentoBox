(() => {
  'use strict';

  /* ============================================================
     BentoBox ambient engine — real jazz tracks
     ============================================================
     Background jazz plays a REAL licensed jazz standard, streamed
     from Apple's official iTunes preview endpoint and looped into
     the shared ambience bus at low volume. Nothing is downloaded.
     A different real track is picked at random each time you start.

     Idle level and preview-ducking are handled by soundtrack.js.
     ============================================================ */

  const STORE_KEY = 'bentobox-music';
  const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
  const AMBIENCE_IDLE = 0.07;
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

  const JAZZ_TRACKS = [
    {
      term: 'take five dave brubeck',
      preferredTrack: 'Take Five',
      preferredCollection: 'Time Out',
      label: 'Take Five — The Dave Brubeck Quartet',
    },
    {
      term: 'so what miles davis',
      preferredTrack: 'So What',
      preferredCollection: 'Kind of Blue',
      label: 'So What — Miles Davis',
    },
    {
      term: 'cantaloupe island herbie hancock',
      preferredTrack: 'Cantaloupe Island',
      preferredCollection: 'Empyrean Isles',
      label: 'Cantaloupe Island — Herbie Hancock',
    },
    {
      term: 'freddie freeloader miles davis',
      preferredTrack: 'Freddie Freeloader',
      preferredCollection: 'Kind of Blue',
      label: 'Freddie Freeloader — Miles Davis',
    },
    {
      term: 'sing sing sing benny goodman',
      preferredTrack: 'Sing, Sing, Sing',
      preferredCollection: 'Sing, Sing, Sing',
      label: 'Sing, Sing, Sing — Benny Goodman',
    },
  ];

  let on = false;
  let el = null;
  let source = null;
  let itunesCache = new Map();

  function getPref() {
    try {
      return localStorage.getItem(STORE_KEY) === 'on';
    } catch {
      return false;
    }
  }

  function setPref(value) {
    try {
      localStorage.setItem(STORE_KEY, value ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }

  function announce(message) {
    const node = document.getElementById('audio-announcer');
    if (node) node.textContent = message || '';
  }

  function pickTrack(tracks, cfg) {
    const withPreview = (tracks || []).filter(
      (t) => t && typeof t.previewUrl === 'string' && t.previewUrl.length > 0
    );
    if (!withPreview.length) return null;
    const trackQ = String(cfg.preferredTrack || '').toLowerCase();
    for (const t of withPreview) {
      const name = String(t.trackName || '').toLowerCase();
      if (trackQ && name.includes(trackQ)) return t;
    }
    return withPreview[0];
  }

  async function resolveTrack(cfg) {
    const key = String(cfg.term || '').trim();
    if (!key) return null;
    const cached = itunesCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return pickTrack(cached.tracks, cfg);
    }
    try {
      const url = `${ITUNES_SEARCH_URL}?term=${encodeURIComponent(key)}&media=music&entity=song&limit=25`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      const tracks = Array.isArray(json.results) ? json.results : [];
      itunesCache.set(key, { at: Date.now(), tracks });
      return pickTrack(tracks, cfg);
    } catch {
      return null;
    }
  }

  function stopSource(duration) {
    const ST = window.BentoSoundtrack;
    if (ST) ST.setAmbienceLevel(0, duration || 1.2);
    if (el && source) {
      window.setTimeout(() => {
        try { el.pause(); } catch { /* ignore */ }
        try { source.disconnect(); } catch { /* ignore */ }
        try { el.src = ''; } catch { /* ignore */ }
      }, ((duration || 1.2) + 0.2) * 1000);
    }
    el = null;
    source = null;
  }

  async function start() {
    if (on) return true;
    on = true;
    setPref(true);

    const ST = window.BentoSoundtrack;
    if (!ST) {
      on = false;
      return false;
    }
    const ac = ST.ensureStarted();
    const bus = ST.getAmbienceBus();
    if (!ac || !bus) {
      on = false;
      setPref(false);
      return false;
    }

    const cfg = JAZZ_TRACKS[Math.floor(Math.random() * JAZZ_TRACKS.length)];
    const track = await resolveTrack(cfg);
    if (!on) return true; // toggled off while resolving

    if (!track) {
      on = false;
      setPref(false);
      announce('That jazz track is unavailable right now — try again.');
      window.dispatchEvent(new CustomEvent('bentobox:ambience'));
      return false;
    }

    try {
      el = document.createElement('audio');
      el.crossOrigin = 'anonymous';
      el.src = track.previewUrl;
      el.loop = true;
      el.preload = 'auto';
      source = ac.createMediaElementSource(el);
      source.connect(bus);
    } catch {
      on = false;
      setPref(false);
      el = null;
      source = null;
      return false;
    }

    el.addEventListener('error', () => {
      if (!on) return;
      on = false;
      setPref(false);
      stopSource(0.2);
      announce('That jazz track is unavailable right now — try again.');
      window.dispatchEvent(new CustomEvent('bentobox:ambience'));
    });

    ST.setAmbienceLevel(AMBIENCE_IDLE, 1.6);
    const playResult = el.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => { /* autoplay is user-gesture gated */ });
    }
    window.dispatchEvent(new CustomEvent('bentobox:ambience'));
    return true;
  }

  function stop() {
    if (!on && !el) return;
    on = false;
    setPref(false);
    stopSource(1.2);
    window.dispatchEvent(new CustomEvent('bentobox:ambience'));
  }

  const api = {
    isOn() {
      return on;
    },
    start,
    stop,
    toggle() {
      if (on) this.stop();
      else this.start();
    },
  };

  window.BentoAmbience = api;

  /* ---------------- wiring ---------------- */

  if (getPref()) {
    const kickoff = () => {
      document.removeEventListener('pointerdown', kickoff);
      document.removeEventListener('keydown', kickoff);
      if (!on) api.start();
    };
    document.addEventListener('pointerdown', kickoff, { once: true });
    document.addEventListener('keydown', kickoff, { once: true });
  }
})();
