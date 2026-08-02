(() => {
  'use strict';

  /* ============================================================
     BentoBox Spotify bridge (Web Playback SDK, PKCE auth)
     ============================================================
     Enables full original songs for an authorized premium account.
     - PKCE authorization code flow, no server secret needed.
     - Tokens live in localStorage; the SDK streams to the browser.
     - Guests (no token) keep the iTunes preview fallback.
     Config (clientId + redirectUri) comes from /api/spotify/config,
     which reads SPOTIFY_CLIENT_ID / SPOTIFY_REDIRECT_URI from .env.
     ============================================================ */

  const AUTH_KEY = 'bentobox-spotify-auth';
  const VERIFIER_KEY = 'bentobox-spotify-verifier';
  const STATE_KEY = 'bentobox-spotify-state';
  const TOKEN_URL = 'https://accounts.spotify.com/api/token';
  const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
  const SDK_URL = 'https://sdk.scdn.co/playback-sdk.js';
  const SCOPES = 'streaming user-read-playback-state user-modify-playback-state';

  let config = null;
  let player = null;
  let sdkLoaded = false;
  let status = 'unavailable'; // unavailable | idle | ready
  let activationArmed = false;

  /* ---------------- small helpers ---------------- */

  function emit(detail) {
    window.dispatchEvent(
      new CustomEvent('bentobox:spotify', {
        detail: Object.assign({ status }, detail || {}),
      })
    );
  }

  function randomString(len) {
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < bytes.length; i += 1) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
  }

  async function sha256(input) {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return String.fromCharCode.apply(null, new Uint8Array(buf));
  }

  function base64url(str) {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function readAuth() {
    try {
      const raw = localStorage.getItem(AUTH_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeAuth(auth) {
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    } catch {
      /* ignore */
    }
  }

  function clearAuth() {
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      /* ignore */
    }
  }

  async function refreshToken(auth) {
    if (!auth || !auth.refresh_token || !config) return null;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refresh_token,
      client_id: config.clientId,
    });
    try {
      const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) return null;
      const json = await res.json();
      const next = {
        access_token: json.access_token,
        refresh_token: json.refresh_token || auth.refresh_token,
        expires_at: Date.now() + json.expires_in * 1000,
      };
      writeAuth(next);
      return next;
    } catch {
      return null;
    }
  }

  async function validToken() {
    const auth = readAuth();
    if (!auth || !auth.access_token) return null;
    if (auth.expires_at && Date.now() > auth.expires_at - 60000) {
      const refreshed = await refreshToken(auth);
      return refreshed ? refreshed.access_token : null;
    }
    return auth.access_token;
  }

  function loadSdk() {
    if (window.Spotify && window.Spotify.Player) return Promise.resolve();
    if (sdkLoaded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      sdkLoaded = true;
      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Spotify SDK failed to load'));
      document.head.appendChild(script);
    });
  }

  /* ---------------- player ---------------- */

  function setStatus(next) {
    if (status === next) return;
    status = next;
    emit();
    syncUi();
  }

  function createPlayer(token) {
    if (!window.Spotify || !window.Spotify.Player) return null;
    const p = new window.Spotify.Player({
      name: 'BentoBox Player',
      getOAuthToken: (cb) => {
        cb(token);
      },
      volume: 0.7,
    });

    p.addListener('ready', () => {
      setStatus('ready');
    });

    p.addListener('not_ready', () => {
      tearDownPlayer();
      setStatus('idle');
    });

    p.addListener('authentication_error', () => {
      tearDownPlayer();
      bootPlayer();
    });

    p.addListener('initialization_error', () => {
      tearDownPlayer();
      setStatus('idle');
    });

    p.addListener('player_state_changed', (state) => {
      emit({ playing: state ? !state.paused : false });
    });

    p.connect().catch(() => setStatus('idle'));
    return p;
  }

  function tearDownPlayer() {
    if (player) {
      try {
        player.disconnect();
      } catch {
        /* ignore */
      }
      player = null;
    }
  }

  async function bootPlayer() {
    const token = await validToken();
    if (!token) {
      setStatus('idle');
      return;
    }
    try {
      await loadSdk();
    } catch {
      setStatus('idle');
      return;
    }
    if (!window.Spotify || !window.Spotify.Player) {
      setStatus('idle');
      return;
    }
    tearDownPlayer();
    player = createPlayer(token);
  }

  /* ---------------- UI sync ---------------- */

  function syncUi() {
    const row = document.getElementById('spotify-option');
    const btn = document.getElementById('spotify-toggle');
    const text = document.getElementById('spotify-status');
    if (row) row.hidden = status === 'unavailable';
    if (btn && text) {
      if (status === 'ready') {
        btn.textContent = 'Disconnect';
        btn.setAttribute('aria-pressed', 'true');
        text.textContent = 'Connected · full original songs';
      } else {
        btn.textContent = 'Connect';
        btn.setAttribute('aria-pressed', 'false');
        text.textContent = status === 'idle' ? 'Not connected · previews only' : 'Connect to play full songs';
      }
    }
  }

  /* ---------------- public API ---------------- */

  const api = {
    isAvailable() {
      return status !== 'unavailable';
    },
    isReady() {
      return status === 'ready' && !!player;
    },
    getStatus() {
      return status;
    },

    async init() {
      try {
        const res = await fetch('/api/spotify/config');
        config = res.ok ? await res.json() : null;
      } catch {
        config = null;
      }
      if (!config || !config.clientId) {
        status = 'unavailable';
        syncUi();
        return;
      }
      status = 'idle';
      syncUi();
      bootPlayer();
    },

    connect() {
      if (!config || !config.clientId) return;
      const verifier = randomString(64);
      const state = randomString(16);
      try {
        sessionStorage.setItem(VERIFIER_KEY, verifier);
        sessionStorage.setItem(STATE_KEY, state);
      } catch {
        /* ignore */
      }
      sha256(verifier).then((hashed) => {
        const challenge = base64url(hashed);
        const params = new URLSearchParams({
          client_id: config.clientId,
          response_type: 'code',
          redirect_uri: config.redirectUri,
          scope: SCOPES,
          state,
          code_challenge_method: 'S256',
          code_challenge: challenge,
        });
        window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
      });
    },

    disconnect() {
      clearAuth();
      tearDownPlayer();
      setStatus('idle');
    },

    async playTrack(uri) {
      if (!api.isReady() || !player) return false;
      const token = await validToken();
      if (!token) return false;
      try {
        const result = await player.play({ uris: [uri] });
        return result !== false;
      } catch {
        return false;
      }
    },

    async pause() {
      if (!api.isReady() || !player) return;
      try {
        await player.pause();
      } catch {
        /* ignore */
      }
    },

    async resume() {
      if (!api.isReady() || !player) return;
      try {
        await player.resume();
      } catch {
        /* ignore */
      }
    },
  };

  window.BentoSpotify = api;

  /* ---------------- activation + wiring ---------------- */

  // The SDK needs a real user activation before it will play audio.
  function armActivation() {
    if (activationArmed) return;
    if (!api.isReady() || !player) return;
    activationArmed = true;
    try {
      player.activateElement();
    } catch {
      /* ignore */
    }
  }

  document.addEventListener('pointerdown', armActivation, { passive: true, once: true });
  document.addEventListener('keydown', armActivation, { passive: true, once: true });
  window.addEventListener('bentobox:spotify', () => {
    if (api.isReady()) armActivation();
  });

  function wireUi() {
    const btn = document.getElementById('spotify-toggle');
    if (btn) {
      btn.addEventListener('click', () => {
        if (api.isReady()) api.disconnect();
        else api.connect();
      });
    }
    window.addEventListener('bentobox:spotify', syncUi);
    syncUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      wireUi();
      api.init();
    });
  } else {
    wireUi();
    api.init();
  }
})();
