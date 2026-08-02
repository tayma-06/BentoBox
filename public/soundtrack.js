(() => {
  'use strict';

  /* ============================================================
     BentoBox soundtrack manager
     ============================================================
     One shared Web Audio graph, one master gain, an optional
     ambience bus (real jazz, driven by audio.js) and a preview
     bus (movie cues). Cues resolve in three levels:

       Level 1  local, properly licensed clip (available:false
                until real audio files exist)
       Level 2  full original song streamed with the Spotify Web
                Playback SDK when the visitor authorizes Spotify
       Level 3  official 30-second OST preview streamed from the
                Apple iTunes Search API (music must be available
                on Apple Music for a preview to play)

     Gains (Web Audio values, NOT percentages):
       master max      0.25
       default master  0.12
       preview cue     0.08 - 0.14
       ambience idle   0.07
       ambience during preview  0.018
     ============================================================ */

  const STORE_KEY = 'bentobox-soundtrack-mode';
  const MASTER_MAX = 0.25;
  const MASTER_DEFAULT = 0.12;
  const AMBIENCE_IDLE = 0.07;
  const AMBIENCE_PREVIEW = 0.018;
  const CUE_FADE_IN_S = 0.9;
  const CUE_FADE_OUT_S = 0.5;
  const ITUNES_SEARCH_URL = 'https://itunes.apple.com/search';
  const ITUNES_TTL_MS = 6 * 60 * 60 * 1000;

  let ctx = null;
  let masterGain = null;
  let compressor = null;
  let ambienceBus = null;
  let previewBus = null;
  let analyser = null;

  let soundtrackEnabled = false;
  let activeCue = null; // { slug, type, stop(dur), cancelled }
  let activeSlug = null;
  let activeMovie = null;
  let activeItunesTrack = null; // metadata of the currently playing iTunes preview
  let activeRequestId = 0;
  let masterVolume = MASTER_DEFAULT;
  let muted = false;
  let visualRaf = null;
  let pendingResume = false;
  let soundtracksIndex = {}; // movieSlug -> soundtracks.json entry
  let itunesCache = new Map(); // search term -> { at, tracks }

  /* ---------------- helpers ---------------- */

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function getPref() {
    try {
      return localStorage.getItem(STORE_KEY) === 'on';
    } catch {
      return false;
    }
  }

  function setPref(on) {
    try {
      localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }

  function broadcast() {
    window.dispatchEvent(
      new CustomEvent('bentobox:soundtrack', {
        detail: {
          enabled: soundtrackEnabled,
          activeSlug,
          mode: activeCue ? activeCue.type : null,
        },
      })
    );
  }

  function announce(message) {
    const node = document.getElementById('audio-announcer');
    if (node) node.textContent = message || '';
  }

  /* ---------------- audio graph ---------------- */

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();

      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 20;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.24;
      compressor.connect(ctx.destination);

      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : clamp(masterVolume, 0, MASTER_MAX);
      masterGain.connect(compressor);

      ambienceBus = ctx.createGain();
      ambienceBus.gain.value = 0;
      ambienceBus.connect(masterGain);

      previewBus = ctx.createGain();
      previewBus.gain.value = 1;
      previewBus.connect(masterGain);

      analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.8;
      previewBus.connect(analyser);

      return ctx;
    } catch {
      ctx = null;
      return null;
    }
  }

  function resumeContext() {
    if (!ctx) return Promise.resolve(false);
    if (ctx.state === 'suspended') {
      return ctx.resume().then(
        () => true,
        () => false
      );
    }
    return Promise.resolve(ctx.state === 'running');
  }

  /* ---------------- public API ---------------- */

  const api = {
    getContext: () => ctx,
    getAmbienceBus: () => ambienceBus,
    getMasterVolume: () => masterVolume,
    isSoundtrackEnabled: () => soundtrackEnabled,
    isMuted: () => muted,
    getActiveSlug: () => activeSlug,
    isSlugActive: (slug) => activeSlug === slug && !!activeCue,

    setCueConfigs(entries) {
      soundtracksIndex = {};
      (Array.isArray(entries) ? entries : []).forEach((entry) => {
        if (entry && entry.movieSlug) soundtracksIndex[entry.movieSlug] = entry;
      });
    },

    fadeAudioNode(node, target, duration, when) {
      if (!node || !ctx) return;
      const now = when !== undefined ? when : ctx.currentTime;
      const dur = Math.max(0.001, duration || 0.5);
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(clamp(target, 0, 1), now + dur);
    },

    setMasterVolume(value) {
      const v = clamp(Number(value), 0, MASTER_MAX);
      if (!Number.isFinite(v)) return;
      masterVolume = v;
      if (masterGain && ctx) {
        const now = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(muted ? 0 : masterVolume, now);
      }
      syncVolumeInputs();
    },

    setMuted(m) {
      muted = Boolean(m);
      if (masterGain && ctx) {
        const now = ctx.currentTime;
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(muted ? 0 : masterVolume, now);
      }
      syncMuteButtons();
    },

    toggleMute() {
      api.setMuted(!muted);
      return muted;
    },

    ensureStarted() {
      const ac = ensureContext();
      if (ac) resumeContext();
      return ac;
    },

    setAmbienceLevel(level, duration) {
      setAmbienceLevel(level, duration);
    },

    enableSoundtrackMode() {
      const ac = ensureContext();
      if (!ac) return false;
      resumeContext();
      soundtrackEnabled = true;
      setPref(true);
      broadcast();
      updateUi();
      return true;
    },

    disableSoundtrackMode() {
      stopCurrentTrack(true);
      soundtrackEnabled = false;
      setPref(false);
      broadcast();
      updateUi();
    },

    activateMovieSoundtrack(slug, opts) {
      return crossfadeToMovie(slug, opts);
    },

    deactivateMovieSoundtrack(slug) {
      if (!slug || activeSlug !== slug || !activeCue) return;
      stopCurrentTrack(false);
    },

    stopCurrentTrack(immediate) {
      stopCurrentTrack(immediate);
    },

    crossfadeToMovie(slug, opts) {
      return crossfadeToMovie(slug, opts);
    },

    playMovieNow(slug, opts) {
      if (!api.enableSoundtrackMode()) return;
      api.crossfadeToMovie(slug, opts);
    },

    pauseForHiddenPage() {
      if (!ctx) return;
      stopCurrentTrack(false);
      if (ctx.state === 'running') {
        pendingResume = true;
        ctx.suspend();
      }
    },

    resumeAfterVisiblePage() {
      if (!ctx) return;
      if (pendingResume && ctx.state === 'suspended') {
        pendingResume = false;
        ctx.resume().catch(() => {});
      }
    },

    updateNowPlayingUI(movie) {
      updateNowPlayingUI(movie);
    },
  };

  function beginPreviewSession() {
    setAmbienceLevel(AMBIENCE_PREVIEW, 1.2);
    startVisuals();
    document.documentElement.classList.add('cue-active');
  }

  function endPreviewSession() {
    setAmbienceLevel(AMBIENCE_IDLE, 1.8);
    stopVisuals();
    document.documentElement.classList.remove('cue-active');
  }

  function stopCurrentTrack(immediate) {
    const prev = activeCue;
    const wasActive = !!prev;
    activeCue = null;
    activeSlug = null;
    activeMovie = null;
    activeItunesTrack = null;
    if (prev) {
      prev.cancelled = true;
      prev.stop(immediate ? 0.08 : CUE_FADE_OUT_S);
    }
    if (wasActive) endPreviewSession();
    updateNowPlayingUI(null);
    if (wasActive) announce('');
    broadcast();
    updateUi();
  }

  function setAmbienceLevel(level, duration) {
    if (!ctx || !ambienceBus) return;
    const now = ctx.currentTime;
    ambienceBus.gain.cancelScheduledValues(now);
    ambienceBus.gain.setValueAtTime(ambienceBus.gain.value, now);
    ambienceBus.gain.linearRampToValueAtTime(clamp(level, 0, 1), now + (duration || 1.2));
  }

  /* ---------------- cue selection ---------------- */

  function cueEntryFor(slug) {
    return soundtracksIndex[slug] || null;
  }

  async function startCue(movie, requestId) {
    const slug = movie.slug;
    const audio = movie.audio || {};
    const entry = cueEntryFor(slug);

    // Level 1: properly licensed local file.
    const wantLicensed = audio.mode === 'licensed' && audio.available && (audio.localPath || audio.previewUrl);
    if (wantLicensed && entry && entry.available) {
      const started = startLicensedPreview(movie, entry, requestId);
      if (started) {
        activeCue = started;
        return true;
      }
    }

    // Level 2: full original song via the Spotify Web Playback SDK.
    // Requires an authorized premium Spotify account.
    if (window.BentoSpotify && window.BentoSpotify.isReady() && entry && entry.spotify && entry.spotify.trackUri) {
      try {
        const ok = await window.BentoSpotify.playTrack(entry.spotify.trackUri);
        if (activeRequestId !== requestId) return true; // user moved on
        if (ok) {
          activeCue = {
            type: 'spotify',
            slug: movie.slug,
            cancelled: false,
            stop() {
              window.BentoSpotify.pause();
            },
          };
          activeItunesTrack = null;
          return true;
        }
      } catch {
        if (activeRequestId !== requestId) return true;
      }
    }

    // Level 3: official 30-second OST preview via the Apple iTunes
    // Search API. Nothing plays until the preview resolves.
    if (entry && entry.itunes && entry.itunes.term) {
      const cue = await startItunesPreview(movie, entry, requestId);
      if (cue && activeRequestId === requestId) {
        activeCue = cue;
        return true;
      }
    }

    return false;
  }

  async function crossfadeToMovie(slug, opts) {
    const id = ++activeRequestId;
    if (!soundtrackEnabled) return id;
    if (!slug) return id;
    const movie = (opts && opts.movie) || activeMovie;
    if (!movie) return id;

    if (activeSlug === slug && activeCue && !activeCue.cancelled) {
      return id;
    }

    const hadCue = !!activeCue;
    const prev = activeCue;
    if (prev) {
      prev.cancelled = true;
      prev.stop(CUE_FADE_OUT_S);
    }

    activeCue = null;
    activeSlug = slug;
    activeMovie = movie;
    activeItunesTrack = null;

    const started = await startCue(movie, id);
    if (activeRequestId !== id) return id;

    if (!started) {
      activeCue = null;
      activeSlug = null;
      activeMovie = null;
      if (hadCue) endPreviewSession();
      broadcast();
      updateUi();
      return id;
    }

    if (!hadCue) beginPreviewSession();
    updateNowPlayingUI(movie);
    announce(nowPlayingMessage(movie));
    broadcast();
    updateUi();
    return id;
  }

  /* ---------------- licensed preview (Level 1) ---------------- */

  function startLicensedPreview(movie, cfg, requestId) {
    const src = (movie.audio && (movie.audio.localPath || movie.audio.previewUrl)) || cfg.audioPath || cfg.previewUrl;
    if (!src) return false;
    const cue = playStream(movie, src, {
      requestId,
      level: 0.1,
      startAt: cfg.startAt,
      type: 'licensed',
    });
    return Boolean(cue);
  }

  /* ---------------- official preview stream (Level 3) ---------------- */

  function playStream(movie, src, opts) {
    const ac = ensureContext();
    if (!ac || !src) return null;
    const requestId = opts.requestId;

    let el;
    let source;
    try {
      el = document.createElement('audio');
      el.crossOrigin = 'anonymous';
      el.src = src;
      el.preload = 'auto';
      source = ac.createMediaElementSource(el);
    } catch {
      return null;
    }

    const cueGain = ac.createGain();
    cueGain.gain.setValueAtTime(0, ac.currentTime);
    const level = clamp(opts.level || 0.1, 0.05, 0.14);
    cueGain.gain.linearRampToValueAtTime(level, ac.currentTime + CUE_FADE_IN_S);
    source.connect(cueGain).connect(previewBus);

    if (opts.startAt) el.currentTime = opts.startAt;

    const onError = () => {
      el.removeEventListener('error', onError);
      el.removeEventListener('ended', onEnd);
      try { el.pause(); } catch { /* ignore */ }
      if (activeCue && activeCue.slug === movie.slug && activeRequestId === requestId) {
        stopCurrentTrack(true);
        announce('That preview is unavailable — hover another movie.');
      }
    };

    const onEnd = () => {
      if (activeCue && activeCue.slug === movie.slug && activeRequestId === requestId) {
        stopCurrentTrack(false);
      }
    };

    el.addEventListener('error', onError);
    if (!el.loop) el.addEventListener('ended', onEnd);

    const playResult = el.play();
    if (playResult && typeof playResult.catch === 'function') {
      playResult.catch(() => onError());
    }

    return {
      type: opts.type || 'licensed',
      slug: movie.slug,
      cancelled: false,
      stop(dur) {
        el.removeEventListener('error', onError);
        el.removeEventListener('ended', onEnd);
        const now = ac.currentTime;
        cueGain.gain.cancelScheduledValues(now);
        cueGain.gain.setValueAtTime(cueGain.gain.value, now);
        cueGain.gain.linearRampToValueAtTime(0, now + (dur || 0.5));
        window.setTimeout(() => {
          try { el.pause(); } catch { /* ignore */ }
          try { source.disconnect(); } catch { /* ignore */ }
          try { cueGain.disconnect(); } catch { /* ignore */ }
          el.src = '';
        }, ((dur || 0.5) + 0.1) * 1000);
      },
    };
  }

  /* ---------------- iTunes Search API (Level 3 lookup) ---------------- */

  function pickTrack(tracks, cfg) {
    const withPreview = (tracks || []).filter(
      (t) => t && typeof t.previewUrl === 'string' && t.previewUrl.length > 0
    );
    if (!withPreview.length) return null;
    const trackQ = String(cfg.preferredTrack || '').toLowerCase();
    const collQ = String(cfg.preferredCollection || '').toLowerCase();
    let best = null;
    let bestScore = -1;
    for (const t of withPreview) {
      const name = String(t.trackName || '').toLowerCase();
      const coll = String(t.collectionName || '').toLowerCase();
      const artist = String(t.artistName || '').toLowerCase();
      let score = 0;
      if (trackQ && name.includes(trackQ)) score += 4;
      if (collQ && (coll.includes(collQ) || artist.includes(collQ))) score += 2;
      if (/\b(soundtrack|score|music from the)\b/.test(coll)) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best || withPreview[0];
  }

  async function resolveItunesTrack(cfg) {
    if (!cfg || !cfg.term) return null;
    const key = String(cfg.term).trim();
    if (!key) return null;
    const cached = itunesCache.get(key);
    if (cached && Date.now() - cached.at < ITUNES_TTL_MS) {
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

  async function startItunesPreview(movie, entry, requestId) {
    const track = await resolveItunesTrack(entry.itunes);
    if (!track) return null;
    if (activeRequestId !== requestId) return null;
    const cue = playStream(movie, track.previewUrl, {
      requestId,
      level: 0.1,
      type: 'itunes',
    });
    if (!cue) return null;
    activeItunesTrack = track;
    return cue;
  }

  /* ---------------- now-playing UI + mini player ---------------- */

  function nowPlayingMessage(movie) {
    if (!movie) return '';
    const entry = cueEntryFor(movie.slug);
    const a = movie.audio || {};
    if (activeCue && activeCue.type === 'spotify' && entry && entry.spotify) {
      return `Now playing: ${entry.spotify.trackName || a.trackTitle || movie.title} — full song on Spotify.`;
    }
    if (activeCue && activeCue.type === 'itunes' && activeItunesTrack) {
      return `Now playing: ${activeItunesTrack.trackName} — OST preview.`;
    }
    if (activeCue && activeCue.type === 'licensed') {
      return `Now playing: ${entry ? entry.trackTitle : a.trackTitle || movie.title} — OST preview.`;
    }
    return '';
  }

  function updateNowPlayingUI(movie) {
    const player = document.getElementById('mini-player');
    if (!player) return;

    const titleEl = document.getElementById('mini-title');
    const movieEl = document.getElementById('mini-movie');
    const composerEl = document.getElementById('mini-composer');
    const labelEl = document.getElementById('mini-label');
    const playBtn = document.getElementById('mini-play');
    const sourceEl = document.getElementById('mini-source');

    if (!movie) {
      if (titleEl) titleEl.textContent = 'Hover a movie to preview';
      if (movieEl) movieEl.textContent = 'Soundtrack mode is on';
      if (composerEl) composerEl.textContent = soundtrackEnabled ? 'Full original songs via Spotify, or official previews' : 'Enable soundtrack mode to listen';
      if (labelEl) labelEl.textContent = 'STANDBY';
      if (playBtn) playBtn.setAttribute('aria-pressed', 'false');
      if (sourceEl) {
        sourceEl.hidden = true;
        sourceEl.removeAttribute('href');
      }
      return;
    }

    const a = movie.audio || {};
    const entry = cueEntryFor(movie.slug);
    const isSpotify = activeCue && activeCue.type === 'spotify';
    const isItunes = activeCue && activeCue.type === 'itunes';
    const isStreaming = isSpotify || isItunes || (activeCue && activeCue.type === 'licensed');

    const spotify = (entry && entry.spotify) || null;

    if (titleEl) {
      titleEl.textContent = isItunes && activeItunesTrack
        ? activeItunesTrack.trackName
        : isSpotify && spotify
          ? spotify.trackName
          : a.trackTitle || movie.title;
    }
    if (movieEl) movieEl.textContent = movie.title;
    if (composerEl) {
      composerEl.textContent = isItunes && activeItunesTrack
        ? activeItunesTrack.artistName
        : isSpotify && spotify
          ? spotify.artistName
          : (entry && entry.composer) || a.composer || 'Unknown';
    }
    if (labelEl) labelEl.textContent = isSpotify ? 'SPOTIFY' : isStreaming ? 'OST PREVIEW' : 'STANDBY';
    if (playBtn) playBtn.setAttribute('aria-pressed', 'true');

    if (sourceEl) {
      const link = isItunes && activeItunesTrack
        ? activeItunesTrack.trackViewUrl || null
        : isSpotify && spotify
          ? spotify.externalUrl || null
          : isStreaming
            ? (entry && (entry.storeUrl || (a && a.storeUrl))) || null
            : null;
      if (link) {
        sourceEl.hidden = false;
        sourceEl.href = link;
        sourceEl.textContent = 'Listen at source ↗';
      } else {
        sourceEl.hidden = true;
        sourceEl.removeAttribute('href');
      }
    }
  }

  /* ---------------- visuals (analyser) ---------------- */

  function startVisuals() {
    if (!ctx || !analyser || visualRaf) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      window.dispatchEvent(new CustomEvent('bentobox:analyser', { detail: { active: true, reduced: true } }));
      return;
    }
    const loop = () => {
      if (!activeCue) {
        stopVisuals();
        return;
      }
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i];
      const avg = sum / data.length;
      window.dispatchEvent(
        new CustomEvent('bentobox:analyser', { detail: { active: true, data: Array.from(data), avg } })
      );
      visualRaf = requestAnimationFrame(loop);
    };
    visualRaf = requestAnimationFrame(loop);
  }

  function stopVisuals() {
    if (visualRaf) {
      cancelAnimationFrame(visualRaf);
      visualRaf = null;
    }
    window.dispatchEvent(new CustomEvent('bentobox:analyser', { detail: { active: false } }));
  }

  /* ---------------- UI wiring (nav, panel, mini player) ---------------- */

  function syncVolumeInputs() {
    document.querySelectorAll('[data-volume-slider]').forEach((input) => {
      const percent = String(Math.round((masterVolume / MASTER_MAX) * 100));
      if (input.value !== percent) input.value = percent;
    });
  }

  function syncMuteButtons() {
    document.querySelectorAll('[data-mute-button]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(muted));
      btn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
      const label = btn.querySelector('[data-mute-label]');
      if (label) label.textContent = muted ? 'Unmuted' : 'Muted';
    });
  }

  function syncPanelState() {
    const panelToggle = document.getElementById('soundtrack-panel-toggle');
    if (panelToggle) {
      const label = panelToggle.querySelector('[data-label]');
      if (label) label.textContent = soundtrackEnabled ? 'Disable Soundtrack Mode' : 'Enable Soundtrack Mode';
      panelToggle.setAttribute('aria-pressed', String(soundtrackEnabled));
    }
  }

  function updateUi() {
    syncPanelState();
    syncMuteButtons();
  }

  function bindUi() {
    const modeBtn = document.getElementById('soundtrack-mode-btn');
    if (modeBtn) {
      const update = () => {
        const text = modeBtn.querySelector('.btn-soundtrack-text');
        if (text) text.textContent = soundtrackEnabled ? 'Soundtrack Mode On' : 'Enable Soundtrack Mode';
        modeBtn.setAttribute('aria-pressed', String(soundtrackEnabled));
      };
      modeBtn.addEventListener('click', () => {
        if (soundtrackEnabled) {
          api.disableSoundtrackMode();
          announce('Soundtrack mode off');
        } else {
          const ok = api.enableSoundtrackMode();
          if (!ok) announce('Audio is not supported in this browser');
          else announce('Soundtrack mode enabled. Hover a movie to hear its song.');
        }
      });
      window.addEventListener('bentobox:soundtrack', update);
      update();
    }

    const panelToggleBtn = document.getElementById('soundtrack-panel-toggle');
    if (panelToggleBtn) {
      panelToggleBtn.addEventListener('click', () => {
        if (soundtrackEnabled) {
          api.disableSoundtrackMode();
          announce('Soundtrack mode off');
        } else {
          const ok = api.enableSoundtrackMode();
          announce(ok ? 'Soundtrack mode enabled. Hover a movie to hear its song.' : 'Audio is not supported in this browser');
        }
      });
    }

    const musicBtn = document.getElementById('music-toggle');
    const audioPanel = document.getElementById('audio-panel');
    if (musicBtn && audioPanel) {
      musicBtn.addEventListener('click', () => {
        const opening = audioPanel.hidden;
        if (opening) {
          audioPanel.hidden = false;
          const first = audioPanel.querySelector('button, input, [tabindex]:not([tabindex="-1"])');
          if (first) first.focus();
        } else {
          audioPanel.hidden = true;
        }
      });
      const closeBtn = document.getElementById('audio-panel-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => {
          audioPanel.hidden = true;
          if (musicBtn) musicBtn.focus();
        });
      }
      audioPanel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          audioPanel.hidden = true;
          if (musicBtn) musicBtn.focus();
        }
      });
    }

    const ambienceToggle = document.getElementById('ambience-toggle');
    if (ambienceToggle && window.BentoAmbience) {
      const update = () => {
        const on = window.BentoAmbience.isOn();
        ambienceToggle.setAttribute('aria-pressed', String(on));
        const label = ambienceToggle.querySelector('[data-label]');
        if (label) label.textContent = on ? 'On' : 'Off';
      };
      ambienceToggle.addEventListener('click', () => {
        if (window.BentoAmbience.isOn()) window.BentoAmbience.stop();
        else window.BentoAmbience.start();
      });
      window.addEventListener('bentobox:ambience', update);
      update();
    }

    const mini = document.getElementById('mini-player');
    const miniPlay = document.getElementById('mini-play');
    if (mini && miniPlay) {
      miniPlay.addEventListener('click', () => {
        if (activeCue) {
          api.stopCurrentTrack(true);
          announce('');
        } else if (activeSlug) {
          api.crossfadeToMovie(activeSlug, { movie: activeMovie });
        } else {
          announce('Hover or focus a movie card to start a preview.');
        }
      });
    }

    const miniOff = document.getElementById('mini-off');
    if (miniOff) {
      miniOff.addEventListener('click', () => {
        api.disableSoundtrackMode();
        announce('Soundtrack mode off');
      });
    }

    document.querySelectorAll('[data-volume-slider]').forEach((input) => {
      input.addEventListener('input', () => {
        api.setMasterVolume(Number(input.value));
        if (muted) api.setMuted(false);
      });
    });

    document.querySelectorAll('[data-mute-button]').forEach((btn) => {
      btn.addEventListener('click', () => {
        api.toggleMute();
      });
    });

    window.addEventListener('bentobox:soundtrack', () => {
      const player = document.getElementById('mini-player');
      if (player) {
        const hasActivity = soundtrackEnabled;
        player.hidden = !hasActivity;
        if (hasActivity) document.body.classList.add('soundtrack-mode');
        else document.body.classList.remove('soundtrack-mode');
      }
      updateUi();
    });
  }

  function refreshMiniPlayerVisibility() {
    const player = document.getElementById('mini-player');
    if (player) {
      player.hidden = !soundtrackEnabled;
      document.body.classList.toggle('soundtrack-mode', soundtrackEnabled);
    }
  }

  /* ---------------- init ---------------- */

  function init() {
    fetch('/api/soundtracks')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => api.setCueConfigs(data))
      .catch(() => {});

    bindUi();

    const pref = getPref();
    if (pref) {
      // Stored preference updates the UI only — real playback waits for
      // a fresh, valid user interaction (autoplay policy).
      const kickoff = () => {
        document.removeEventListener('pointerdown', kickoff);
        document.removeEventListener('keydown', kickoff);
        api.enableSoundtrackMode();
      };
      document.addEventListener('pointerdown', kickoff, { once: true });
      document.addEventListener('keydown', kickoff, { once: true });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) api.pauseForHiddenPage();
      else api.resumeAfterVisiblePage();
    });

    refreshMiniPlayerVisibility();
    window.addEventListener('bentobox:soundtrack', refreshMiniPlayerVisibility);
  }

  window.BentoSoundtrack = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
