(() => {
  'use strict';

  const GRID = document.getElementById('movie-grid');
  const HOVER = document.getElementById('hover-preview');
  const MODAL = document.getElementById('movie-modal');
  const MODAL_BODY = document.getElementById('modal-body');
  const MODAL_CLOSE = document.getElementById('modal-close');
  const SEARCH = document.getElementById('search-input');
  const GENRE = document.getElementById('genre-select');
  const SORT = document.getElementById('sort-select');
  const RESET = document.getElementById('reset-filters');
  const EMPTY_RESET = document.getElementById('empty-reset');
  const STATUS = document.getElementById('results-status');
  const EMPTY = document.getElementById('grid-empty');
  const COUNT_BADGE = document.getElementById('nav-count');
  const ERROR_AREA = document.getElementById('error-area');

  const INTENT_DELAY = 500;
  const LEAVE_GRACE = 120;

  const state = {
    allMovies: [],
    visible: [],
    genre: 'all',
    sort: 'collection',
    search: '',
    intentTimer: null,
    hideTimer: null,
    hoverCard: null,
    lastFocused: null,
    modalMovie: null,
    debounceTimer: null,
  };

  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function formatRuntime(minutes) {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return 'Unknown';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }

  function fallbackImage(movie) {
    return movie.placeholder || `/assets/images/placeholders/${movie.slug}.svg`;
  }

  function posterImage(movie) {
    return movie.poster || fallbackImage(movie);
  }

  function backdropImage(movie) {
    return movie.backdrop || movie.poster || fallbackImage(movie);
  }

  function genrePills(movie, limit) {
    const genres = Array.isArray(movie.genres) && movie.genres.length ? movie.genres : ['Animation'];
    return genres.slice(0, limit || 2);
  }

  function movieFor(card) {
    return state.allMovies.find((m) => m.slug === card.dataset.slug) || null;
  }

  /* -------------------- data fetching -------------------- */

  async function fetchMovies() {
    try {
      const res = await fetch('/api/movies');
      if (!res.ok) throw new Error(`server responded ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('unexpected payload');
      return data;
    } catch (err) {
      renderErrorState(err);
      return [];
    }
  }

  /* -------------------- rendering -------------------- */

  function createMovieCard(movie, index) {
    const card = el('article', `movie-card ${movie.bentoClass || 'bento-standard'} reveal`);
    card.dataset.slug = movie.slug;
    card.style.setProperty('--accent', movie.accent || '#ffd75e');
    card.style.setProperty('--accent-secondary', movie.accentSecondary || movie.accent || '#ffd75e');
    card.style.setProperty('--on-accent', movie.textOnAccent || '#141a33');

    const img = el('img', 'card-art');
    img.src = posterImage(movie);
    img.alt = `Poster for ${movie.title}, released in ${movie.year}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = () => {
      img.onerror = null;
      img.src = fallbackImage(movie);
    };

    const shade = el('div', 'card-shade');
    const panelNum = el('span', 'panel-num', String(index + 1).padStart(2, '0'));

    const info = el('div', 'card-info');
    const title = el('h3', 'card-title', movie.title);
    const meta = el('div', 'card-meta');
    const year = el('span', 'card-year', String(movie.year));
    const pills = el('span', 'card-pills');
    genrePills(movie, 2).forEach((g) => pills.appendChild(el('span', 'pill', g)));
    const rating = el('span', 'card-rating');
    if (typeof movie.rating === 'number' && Number.isFinite(movie.rating)) {
      rating.textContent = `★ ${movie.rating.toFixed(1)}`;
    }
    const mood = el('span', 'card-mood', movie.moodLine || '');
    info.append(mood, title, meta);

    const world = el('span', 'card-world', movie.world || '');

    const audio = movie.audio || {};
    const sound = el('span', 'card-sound');
    sound.setAttribute('aria-hidden', 'true');
    sound.textContent = '♪';
    sound.title = audio.trackTitle ? `Soundtrack: ${audio.trackTitle}` : 'Original song plays on hover';

    const openBtn = el('button', 'card-open');
    openBtn.type = 'button';
    openBtn.textContent = 'VIEW';
    openBtn.setAttribute('aria-label', `View story for ${movie.title}`);

    card.append(img, shade, panelNum, info, world, sound, openBtn);
    return card;
  }

  function renderMovies(movies) {
    stopIntent();
    GRID.querySelectorAll('.movie-card').forEach((node) => node.remove());
    ERROR_AREA.hidden = true;
    EMPTY.hidden = true;

    const filtered = isFiltered();
    GRID.classList.toggle('movie-bento--filtered', filtered);

    if (!movies.length) {
      EMPTY.hidden = false;
      state.visible = [];
      updateCount();
      updateProgressStrip();
      return;
    }

    const fragment = document.createDocumentFragment();
    movies.forEach((movie, index) => fragment.appendChild(createMovieCard(movie, index)));
    GRID.appendChild(fragment);

    state.visible = movies;
    updateCount();
    updateProgressStrip();
    setupIntersectionAnimations();
  }

  function isFiltered() {
    return state.genre !== 'all' || state.sort !== 'collection' || state.search.trim() !== '';
  }

  function updateCount() {
    const total = state.allMovies.length;
    COUNT_BADGE.textContent = total ? String(total) : '—';
    const heroCount = document.getElementById('hero-count');
    if (heroCount) heroCount.textContent = total ? String(total) : '—';
  }

  function updateProgressStrip() {
    const set = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };

    set('ps-count', String(state.visible.length));

    const worlds = new Set(state.allMovies.map((m) => m.world).filter(Boolean));
    set('ps-worlds', worlds.size ? String(worlds.size) : '—');

    const runtimes = state.allMovies.map((m) => m.runtime).filter((n) => typeof n === 'number');
    set('ps-runtime', runtimes.length ? formatRuntime(runtimes.reduce((a, b) => a + b, 0)) : '—');

    const ST = window.BentoSoundtrack;
    const slug = ST ? ST.getActiveSlug() : null;
    const active = state.allMovies.find((m) => m.slug === slug);
    set('ps-active', active ? active.title : '—');

    set('ps-filter', state.genre === 'all' ? 'all' : state.genre);
  }

  function renderErrorState(err) {
    ERROR_AREA.hidden = false;
    const msg = ERROR_AREA.querySelector('.error-msg');
    if (msg) {
      msg.textContent = `Couldn't load the collection (${err.message}). Make sure the server is running, then try again.`;
    }
    GRID.querySelectorAll('.movie-card').forEach((node) => node.remove());
    EMPTY.hidden = true;
    COUNT_BADGE.textContent = '—';
  }

  /* -------------------- hero -------------------- */

  function renderHero(movies) {
    const movie = movies[0];
    if (!movie) return;

    const img = document.getElementById('hero-visual');
    if (img) {
      img.src = backdropImage(movie);
      img.alt = `Backdrop for ${movie.title}`;
      img.onerror = () => {
        img.onerror = null;
        img.src = fallbackImage(movie);
      };
    }

    const label = document.getElementById('hero-pick-label');
    if (label) {
      const genres = genrePills(movie, 2).join(' · ');
      label.textContent = `${movie.year} · ${genres}`;
    }
  }

  /* -------------------- hover preview -------------------- */

  function buildPreviewContent(movie) {
    HOVER.innerHTML = '';
    const title = el('h3', 'preview-title', movie.title);
    const meta = el('div', 'preview-meta');
    meta.appendChild(el('span', null, String(movie.year)));
    const runtime = el('span', null, formatRuntime(movie.runtime));
    meta.appendChild(runtime);
    if (typeof movie.rating === 'number') {
      meta.appendChild(el('span', null, `★ ${movie.rating.toFixed(1)}`));
    }
    genrePills(movie, 3).forEach((g) => meta.appendChild(el('span', 'pill', g)));

    const overview = el('p', 'preview-overview');
    const text = movie.overview || 'No overview yet — check back after the TMDB fetch.';
    overview.textContent = text.length > 150 ? `${text.slice(0, 150)}…` : text;

    const audio = movie.audio || {};
    const soundLine = el('p', 'preview-sound');
    soundLine.textContent = audio.trackTitle
      ? `♪ ${audio.trackTitle} — original song`
      : '♪ Original song plays on hover';

    const open = el('button', 'preview-open');
    open.type = 'button';
    open.textContent = 'View story →';
    open.addEventListener('click', () => {
      hideHoverPreview(true);
      openMovieModal(movie);
    });

    HOVER.append(title, meta, overview, soundLine, open);
  }

  function positionHover(card) {
    const rect = card.getBoundingClientRect();
    const pw = HOVER.offsetWidth;
    const ph = HOVER.offsetHeight;
    let left = rect.right + 14;
    if (left + pw > window.innerWidth - 10) left = rect.left - pw - 14;
    if (left < 10) left = 10;
    let top = rect.top + rect.height / 2 - ph / 2;
    top = Math.max(10, Math.min(top, window.innerHeight - ph - 10));
    HOVER.style.left = `${left}px`;
    HOVER.style.top = `${top}px`;
  }

  function showHoverPreview(card, movie) {
    if (!finePointer || !card || !movie) return;
    clearTimeout(state.hideTimer);
    buildPreviewContent(movie);
    HOVER.hidden = false;
    positionHover(card);
  }

  function hideHoverPreview(immediate) {
    clearTimeout(state.intentTimer);
    clearTimeout(state.hideTimer);
    const doHide = () => {
      HOVER.hidden = true;
      state.hoverCard = null;
    };
    if (immediate) doHide();
    else state.hideTimer = setTimeout(doHide, LEAVE_GRACE);
  }

  /* -------------------- hover / focus intent -------------------- */

  function startIntent(card) {
    const movie = movieFor(card);
    if (!movie) return;
    clearTimeout(state.intentTimer);
    clearTimeout(state.hideTimer);
    state.hoverCard = card;
    state.intentTimer = setTimeout(() => {
      if (state.hoverCard !== card) return;
      showHoverPreview(card, movie);
      const ST = window.BentoSoundtrack;
      if (ST && ST.isSoundtrackEnabled()) {
        ST.crossfadeToMovie(movie.slug, { movie });
      }
    }, INTENT_DELAY);
  }

  function stopIntent() {
    clearTimeout(state.intentTimer);
    const card = state.hoverCard;
    state.hoverCard = null;
    hideHoverPreview(true);
    if (card && window.BentoSoundtrack && window.BentoSoundtrack.isSoundtrackEnabled()) {
      window.BentoSoundtrack.deactivateMovieSoundtrack(card.dataset.slug);
    }
  }

  function scheduleStopIntent() {
    clearTimeout(state.intentTimer);
    clearTimeout(state.hideTimer);
    const card = state.hoverCard;
    state.hoverCard = null;
    state.hideTimer = setTimeout(() => {
      if (card && window.BentoSoundtrack && window.BentoSoundtrack.isSoundtrackEnabled()) {
        window.BentoSoundtrack.deactivateMovieSoundtrack(card.dataset.slug);
      }
    }, LEAVE_GRACE);
  }

  /* -------------------- modal -------------------- */

  function buildModalContent(movie) {
    MODAL_BODY.innerHTML = '';

    const backdropWrap = el('div', 'modal-backdrop');
    const backdropImg = el('img', null);
    backdropImg.src = backdropImage(movie);
    backdropImg.alt = `Backdrop for ${movie.title}`;
    backdropImg.onerror = () => {
      backdropImg.onerror = null;
      backdropImg.src = fallbackImage(movie);
    };
    backdropWrap.appendChild(backdropImg);

    const content = el('div', 'modal-content');

    const posterWrap = el('div', 'modal-poster');
    const posterImg = el('img', null);
    posterImg.src = posterImage(movie);
    posterImg.alt = `Poster for ${movie.title}`;
    posterImg.loading = 'lazy';
    posterImg.onerror = () => {
      posterImg.onerror = null;
      posterImg.src = fallbackImage(movie);
    };
    posterWrap.appendChild(posterImg);

    const info = el('div', 'modal-info');

    const title = el('h2', 'modal-title', movie.title);
    title.id = 'modal-title';
    info.appendChild(title);

    if (movie.tagline) info.appendChild(el('p', 'modal-tagline', movie.tagline));

    const facts = el('div', 'modal-facts');
    facts.appendChild(el('span', 'modal-fact', String(movie.year)));
    facts.appendChild(el('span', 'modal-fact', formatRuntime(movie.runtime)));
    if (typeof movie.rating === 'number') {
      const ratingText = Number.isFinite(movie.voteCount)
        ? `★ ${movie.rating.toFixed(1)} (${movie.voteCount.toLocaleString()} votes)`
        : `★ ${movie.rating.toFixed(1)}`;
      facts.appendChild(el('span', 'modal-fact', ratingText));
    }
    genrePills(movie, 6).forEach((g) => facts.appendChild(el('span', 'pill', g)));
    info.appendChild(facts);

    const people = el('div', 'modal-people');
    const directorBox = el('div', 'modal-person');
    directorBox.appendChild(el('strong', null, 'Directed by'));
    directorBox.appendChild(el('span', null, movie.director || 'Unknown'));
    people.appendChild(directorBox);
    if (Array.isArray(movie.cast) && movie.cast.length) {
      const castBox = el('div', 'modal-person');
      castBox.appendChild(el('strong', null, 'Cast'));
      castBox.appendChild(el('span', null, movie.cast.join(', ')));
      people.appendChild(castBox);
    }
    info.appendChild(people);

    const overview = el('p', 'modal-overview', movie.overview || 'No synopsis available yet — the fallback data is neutral, and TMDB metadata will fill this in after running npm run fetch:movies.');

    const audio = movie.audio || {};
    if (audio.trackTitle) {
      const soundBlock = el('div', 'modal-sound');
      const soundTitle = el('div', 'modal-sound-title');
      soundTitle.textContent = `♪ ${audio.trackTitle}`;
      const soundMeta = el('div', 'modal-sound-meta');
      soundMeta.textContent = audio.composer
        ? `Composer: ${audio.composer} · original song`
        : 'Original song plays on hover';
      soundBlock.append(soundTitle, soundMeta);
      info.appendChild(soundBlock);
    }

    if (movie.personalNote) {
      const note = el('div', 'modal-note');
      note.appendChild(el('span', 'modal-note-label', 'Favorite thought'));
      note.appendChild(el('span', 'modal-note-text', movie.personalNote));
      info.appendChild(overview);
      info.appendChild(note);
      content.append(posterWrap, info);
    } else {
      info.appendChild(overview);
      content.append(posterWrap, info);
    }

    const actions = el('div', 'modal-actions');
    if (movie.tmdbUrl) {
      const tmdb = el('a', 'modal-tmdb', 'View on TMDB ↗');
      tmdb.href = movie.tmdbUrl;
      tmdb.target = '_blank';
      tmdb.rel = 'noopener noreferrer';
      actions.appendChild(tmdb);
    }
    const closeBtn = el('button', 'btn btn-ghost', 'Close');
    closeBtn.type = 'button';
    closeBtn.style.color = 'var(--ink)';
    closeBtn.addEventListener('click', closeMovieModal);
    actions.appendChild(closeBtn);
    info.appendChild(actions);

    MODAL_BODY.append(backdropWrap, content);
  }

  function openMovieModal(movie) {
    if (!movie) return;
    state.lastFocused = document.activeElement;
    state.modalMovie = movie;
    stopIntent();
    buildModalContent(movie);
    document.documentElement.classList.add('modal-open');
    if (!MODAL.open) MODAL.showModal();
    MODAL_CLOSE.focus();
  }

  function closeMovieModal() {
    if (!MODAL.open) return;
    MODAL.close();
    document.documentElement.classList.remove('modal-open');
    if (state.lastFocused && typeof state.lastFocused.focus === 'function') {
      state.lastFocused.focus();
    }
    const ST = window.BentoSoundtrack;
    if (ST) {
      const activeSlug = ST.getActiveSlug();
      const modal = state.modalMovie;
      if (activeSlug && modal && activeSlug !== modal.slug) {
        ST.stopCurrentTrack(false);
      }
    }
    state.modalMovie = null;
  }

  function trapModalFocus(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMovieModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusables = Array.from(
      MODAL.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((node) => !node.disabled && node.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* -------------------- filters -------------------- */

  function populateGenreFilter() {
    const set = new Set();
    state.allMovies.forEach((movie) => {
      (movie.genres || []).forEach((g) => set.add(g));
    });
    const genres = Array.from(set).sort();
    GENRE.length = 1;
    genres.forEach((g) => {
      const option = document.createElement('option');
      option.value = g;
      option.textContent = g;
      GENRE.appendChild(option);
    });
  }

  function applyFilters() {
    const term = state.search.trim().toLowerCase();
    let list = state.allMovies.filter((movie) => {
      const genreOk = state.genre === 'all' || (movie.genres || []).includes(state.genre);
      const titleOk = !term || movie.title.toLowerCase().includes(term);
      return genreOk && titleOk;
    });

    if (state.sort === 'title-asc') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    } else if (state.sort === 'year-asc') {
      list = [...list].sort((a, b) => a.year - b.year);
    } else if (state.sort === 'year-desc') {
      list = [...list].sort((a, b) => b.year - a.year);
    } else if (state.sort === 'rating-desc') {
      list = [...list].sort((a, b) => (typeof b.rating === 'number' ? b.rating : -1) - (typeof a.rating === 'number' ? a.rating : -1));
    }

    renderMovies(list);
    announceResults();
  }

  function announceResults() {
    if (!STATUS) return;
    STATUS.textContent = state.visible.length === state.allMovies.length
      ? `Showing all ${state.allMovies.length} movies.`
      : `Showing ${state.visible.length} of ${state.allMovies.length} movies.`;
  }

  function setupSearch() {
    SEARCH.addEventListener('input', () => {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        state.search = SEARCH.value;
        applyFilters();
      }, 250);
    });

    GENRE.addEventListener('change', () => {
      state.genre = GENRE.value;
      applyFilters();
    });

    SORT.addEventListener('change', () => {
      state.sort = SORT.value;
      applyFilters();
    });

    const resetAll = () => {
      SEARCH.value = '';
      GENRE.value = 'all';
      SORT.value = 'collection';
      state.search = '';
      state.genre = 'all';
      state.sort = 'collection';
      applyFilters();
    };

    RESET.addEventListener('click', resetAll);
    if (EMPTY_RESET) EMPTY_RESET.addEventListener('click', resetAll);
  }

  /* -------------------- stats -------------------- */

  function renderStats(movies) {
    const setText = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    };

    setText('stat-count', String(movies.length));

    const years = movies.map((m) => m.year).filter(Boolean);
    if (years.length) {
      const min = Math.min(...years);
      const max = Math.max(...years);
      setText('stat-years', min === max ? String(min) : `${min} – ${max}`);
    }

    const runtimes = movies.map((m) => m.runtime).filter((n) => typeof n === 'number');
    const runtimeTile = document.getElementById('stat-runtime-tile');
    if (runtimes.length) {
      setText('stat-runtime', formatRuntime(runtimes.reduce((a, b) => a + b, 0)));
      runtimeTile.hidden = false;
    }

    const ratings = movies.map((m) => m.rating).filter((n) => typeof n === 'number');
    const ratingTile = document.getElementById('stat-rating-tile');
    if (ratings.length) {
      setText('stat-rating', (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1));
      ratingTile.hidden = false;
    }
  }

  /* -------------------- animations -------------------- */

  function setupIntersectionAnimations() {
    const cards = GRID.querySelectorAll('.movie-card.reveal:not(.in-view)');
    const sections = document.querySelectorAll('.reveal-section:not(.in-view)');

    if (reducedMotion || !('IntersectionObserver' in window)) {
      cards.forEach((c) => c.classList.add('in-view'));
      sections.forEach((s) => s.classList.add('in-view'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -30px 0px' }
    );

    cards.forEach((c) => io.observe(c));
    sections.forEach((s) => io.observe(s));
  }

  /* -------------------- soundtrack + aura wiring -------------------- */

  function syncCardSoundStates() {
    const ST = window.BentoSoundtrack;
    const on = ST ? ST.isSoundtrackEnabled() : false;
    document.body.classList.toggle('soundtrack-off', !on);

    GRID.querySelectorAll('.movie-card.is-playing').forEach((n) => n.classList.remove('is-playing'));
    if (on && ST) {
      const slug = ST.getActiveSlug();
      if (slug) {
        const card = GRID.querySelector(`.movie-card[data-slug="${slug}"]`);
        if (card) card.classList.add('is-playing');
      }
    }
    updateProgressStrip();
  }

  function setupAura() {
    const toggle = document.getElementById('aura-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const off = document.body.classList.toggle('aura-off');
        toggle.setAttribute('aria-pressed', String(!off));
        toggle.title = off ? 'Ambient aura off' : 'Ambient aura on';
      });
    }

    window.addEventListener('bentobox:analyser', (e) => {
      const detail = e.detail || {};
      if (!detail.active) {
        document.documentElement.classList.remove('aura-live');
        return;
      }
      document.documentElement.classList.add('aura-live');
      if (detail.reduced || reducedMotion) return;
      const level = Math.min(1, ((detail.avg || 0) / 160) * 2.2);
      document.documentElement.style.setProperty('--aura-intensity', level.toFixed(3));
    });
  }

  /* -------------------- event wiring -------------------- */

  function setupGridListeners() {
    GRID.addEventListener('pointerover', (e) => {
      const card = e.target.closest('.movie-card');
      if (card && finePointer && card !== state.hoverCard) startIntent(card);
    }, { passive: true });

    GRID.addEventListener('pointerout', (e) => {
      const next = e.relatedTarget;
      const inside = next && next.closest ? Boolean(next.closest('.movie-card')) : false;
      if (!inside) scheduleStopIntent();
    }, { passive: true });

    GRID.addEventListener('focusin', (e) => {
      const btn = e.target.closest('.card-open');
      const card = btn && btn.closest('.movie-card');
      if (card && card !== state.hoverCard) startIntent(card);
    });

    GRID.addEventListener('focusout', (e) => {
      const btn = e.target.closest('.card-open');
      if (btn) scheduleStopIntent();
    });

    GRID.addEventListener('click', (e) => {
      const openBtn = e.target.closest('.card-open');
      const card = (openBtn || e.target).closest('.movie-card');
      if (!card) return;
      const movie = movieFor(card);
      if (!movie) return;

      if (!openBtn && !finePointer && window.BentoSoundtrack) {
        window.BentoSoundtrack.playMovieNow(movie.slug, { movie });
      }
      openMovieModal(movie);
    });

    HOVER.addEventListener('mouseenter', () => clearTimeout(state.hideTimer));
    HOVER.addEventListener('mouseleave', () => scheduleStopIntent());

    window.addEventListener('bentobox:soundtrack', syncCardSoundStates);
  }

  function setupGlobalListeners() {
    MODAL_CLOSE.addEventListener('click', closeMovieModal);
    MODAL.addEventListener('keydown', trapModalFocus);
    MODAL.addEventListener('click', (e) => {
      if (e.target === MODAL) closeMovieModal();
    });

    let lastScroll = 0;
    window.addEventListener(
      'scroll',
      () => {
        const now = Date.now();
        if (now - lastScroll > 120) {
          lastScroll = now;
          hideHoverPreview(true);
        }
      },
      { passive: true }
    );

    window.addEventListener('resize', () => hideHoverPreview(true));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) hideHoverPreview(true);
    });

    const heroBtn = document.querySelector('.hero .btn-primary');
    if (heroBtn) {
      heroBtn.addEventListener('click', () => {
        document.getElementById('favorites')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
      });
    }
  }

  /* -------------------- init -------------------- */

  async function init() {
    document.body.classList.add('hero-in');

    const movies = await fetchMovies();
    state.allMovies = movies;

    populateGenreFilter();
    renderHero(movies);
    renderStats(movies);
    applyFilters();
    setupSearch();
    setupGridListeners();
    setupGlobalListeners();
    setupAura();
    syncCardSoundStates();

    const retry = document.getElementById('retry-button');
    if (retry) retry.addEventListener('click', init);

    setupIntersectionAnimations();
  }

  init();
})();
