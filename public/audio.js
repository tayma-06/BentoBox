(() => {
  'use strict';

  /* ============================================================
     BentoBox ambient engine — original lo-fi jazz loop
     ============================================================
     Runs through the shared audio graph owned by soundtrack.js
     (master -> compressor). This file only schedules an original
     generative jazz loop into the ambience bus: soft swung chords,
     a quiet walking-ish bass, brushed noise, occasional vibes-like
     sparkle. No copyrighted recordings, no copied melodies.

     Idle level and preview-ducking are handled by soundtrack.js.
     ============================================================ */

  const STORE_KEY = 'bentobox-music';
  const TEMPO = 78;
  const BEAT = 60 / TEMPO;
  const BAR = BEAT * 4;
  const LOOKAHEAD = 1.2;
  const TICK_MS = 80;

  const PENTA = [0, 2, 4, 7, 9, 12];

  // Original, generic ii–V–I–IV-style changes (A minor / C major blend).
  // These are functional harmony root movements, not a song.
  const PROGRESSION = [
    { root: 110.0, chord: [0, 3, 7, 10, 14] },    // Am9
    { root: 146.83, chord: [0, 3, 7, 10, 14] },   // Dm9
    { root: 98.0, chord: [0, 4, 7, 10, 14] },     // G13
    { root: 130.81, chord: [0, 4, 7, 11, 14] },   // Cmaj9
    { root: 87.31, chord: [0, 4, 7, 11, 14] },    // Fmaj9
    { root: 123.47, chord: [0, 3, 6, 10, 13] },   // Bm7b5
    { root: 82.41, chord: [0, 4, 7, 10, 14] },    // E7
    { root: 110.0, chord: [0, 3, 7, 10, 14] },    // Am9
  ];

  let on = false;
  let engine = null;

  function semitone(freq, n) {
    return freq * Math.pow(2, n / 12);
  }

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

  /* ---------------- small synth primitives ---------------- */

  function pad(ctx, out, opts) {
    const t = opts.time;
    (opts.freqs || []).forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      osc.detune.value = (Math.random() * 6 - 3) + i * 1.2;
      const g = ctx.createGain();
      const attack = Math.min(0.4, opts.dur * 0.22);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(opts.peak || 0.02, t + attack);
      g.gain.setValueAtTime(opts.peak || 0.02, t + opts.dur - attack);
      g.gain.linearRampToValueAtTime(0, t + opts.dur);
      osc.connect(g).connect(out);
      osc.start(t);
      osc.stop(t + opts.dur + 0.1);
    });
  }

  function bass(ctx, out, opts) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = opts.freq;
    const g = ctx.createGain();
    const t = opts.time;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.peak || 0.04, t + 0.02);
    g.gain.setValueAtTime(opts.peak || 0.04, t + opts.dur - 0.05);
    g.gain.linearRampToValueAtTime(0, t + opts.dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + opts.dur + 0.05);
  }

  function kick(ctx, out, opts) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const t = opts.time;
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.peak || 0.03, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  function pluck(ctx, out, opts) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = opts.freq;
    const g = ctx.createGain();
    const t = opts.time;
    g.gain.setValueAtTime(0, t);
    g.gain.setValueAtTime(opts.peak || 0.02, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + opts.dur + 0.05);
  }

  function brush(ctx, out, opts) {
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.2), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = opts.freq || 6500;
    filter.Q.value = 0.7;
    const g = ctx.createGain();
    const t = opts.time;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.peak || 0.012, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(filter).connect(g).connect(out);
    src.start(t);
    src.stop(t + opts.dur + 0.05);
  }

  /* ---------------- jazz engine ---------------- */

  function createJazzEngine(ctx, bus) {
    const jazzGain = ctx.createGain();
    jazzGain.gain.value = 0;
    jazzGain.connect(bus);

    let bar = 0;
    let nextBarTime = 0;
    let timer = null;
    let running = false;

    function scheduleBar(b, t) {
      const entry = PROGRESSION[b % PROGRESSION.length];
      const root = entry.root;
      const chord = entry.chord.map((i) => semitone(root * 2, i));

      pad(ctx, jazzGain, { freqs: chord, time: t + BEAT * 0.05, dur: BAR * 0.92, peak: 0.02 });

      bass(ctx, jazzGain, { freq: root, time: t, dur: BEAT * 1.6, peak: 0.045 });
      bass(ctx, jazzGain, { freq: semitone(root, 7), time: t + BEAT * 2, dur: BEAT * 1.6, peak: 0.04 });
      bass(ctx, jazzGain, { freq: semitone(root, 3), time: t + BEAT * 3, dur: BEAT * 0.9, peak: 0.028 });

      kick(ctx, jazzGain, { time: t, peak: 0.026 });
      kick(ctx, jazzGain, { time: t + BEAT * 2, peak: 0.022 });

      for (let beat = 0; beat < 4; beat += 1) {
        const swing = beat % 2 === 0 ? 0.18 : -0.08;
        const offbeat = t + beat * BEAT + BEAT * 0.5 + BEAT * swing;
        brush(ctx, jazzGain, { time: offbeat, dur: 0.13, peak: 0.011, freq: 6200 + (beat % 2) * 800 });
      }

      if (b % 2 === 0) {
        const notes = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < notes; i += 1) {
          const deg = PENTA[Math.floor(Math.random() * PENTA.length)] + 12;
          pluck(ctx, jazzGain, {
            freq: semitone(root * 2, deg),
            time: t + BEAT * (0.5 + i * 0.55 + Math.random() * 0.2),
            dur: 1.5,
            peak: 0.018,
          });
        }
      }
    }

    function tick() {
      if (!running) return;
      const horizon = ctx.currentTime + LOOKAHEAD;
      while (nextBarTime < horizon) {
        scheduleBar(bar, nextBarTime);
        bar += 1;
        nextBarTime += BAR;
      }
    }

    return {
      start() {
        if (running) return;
        running = true;
        nextBarTime = ctx.currentTime + 0.1;
        bar = 0;
        jazzGain.gain.cancelScheduledValues(ctx.currentTime);
        jazzGain.gain.setValueAtTime(jazzGain.gain.value, ctx.currentTime);
        jazzGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.6);
        tick();
        timer = setInterval(tick, TICK_MS);
      },
      stop() {
        running = false;
        clearInterval(timer);
        timer = null;
        const now = ctx.currentTime;
        jazzGain.gain.cancelScheduledValues(now);
        jazzGain.gain.setValueAtTime(jazzGain.gain.value, now);
        jazzGain.gain.linearRampToValueAtTime(0, now + 1.2);
      },
    };
  }

  /* ---------------- public API ---------------- */

  const api = {
    isOn() {
      return on;
    },

    start() {
      on = true;
      setPref(true);
      const ST = window.BentoSoundtrack;
      if (!ST) return false;
      const ctx = ST.ensureStarted();
      const bus = ST.getAmbienceBus();
      if (!ctx || !bus) return false;
      if (!engine) engine = createJazzEngine(ctx, bus);
      engine.start();
      ST.setAmbienceLevel(0.07, 1.6);
      window.dispatchEvent(new CustomEvent('bentobox:ambience'));
      return true;
    },

    stop() {
      on = false;
      setPref(false);
      if (engine) engine.stop();
      const ST = window.BentoSoundtrack;
      if (ST) ST.setAmbienceLevel(0, 1.2);
      window.dispatchEvent(new CustomEvent('bentobox:ambience'));
    },

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
