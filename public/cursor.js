(() => {
  'use strict';

  const cursor = document.getElementById('cursor');
  const dot = cursor.querySelector('.cursor-dot');
  const sparkleLayer = document.getElementById('sparkle-layer');

  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!finePointer || !('requestAnimationFrame' in window)) return;

  let mouseX = window.innerWidth / 2;
  let mouseY = window.innerHeight / 2;
  let dotX = mouseX;
  let dotY = mouseY;
  let active = false;
  let lastSparkle = 0;
  let sparkleCount = 0;

  function onMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!active) {
      dotX = mouseX;
      dotY = mouseY;
      active = true;
    }
    maybeSparkle(dotX, dotY);
  }

  function maybeSparkle(x, y) {
    if (reducedMotion) return;
    const now = performance.now();
    if (now - lastSparkle < 90) return;
    if (sparkleCount >= 10) return;
    lastSparkle = now;

    const span = document.createElement('span');
    span.className = 'sparkle-pop';
    span.textContent = Math.random() > 0.5 ? '✦' : '✧';
    const angle = Math.random() * Math.PI * 2;
    const dist = 10 + Math.random() * 14;
    span.style.left = `${x + (Math.random() * 6 - 3)}px`;
    span.style.top = `${y + (Math.random() * 6 - 3)}px`;
    span.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    span.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    sparkleLayer.appendChild(span);
    sparkleCount += 1;

    span.addEventListener('animationend', () => {
      span.remove();
      sparkleCount -= 1;
    });
  }

  function render() {
    if (reducedMotion) {
      dotX = mouseX;
      dotY = mouseY;
    } else {
      dotX += (mouseX - dotX) * 0.85;
      dotY += (mouseY - dotY) * 0.85;
    }

    dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0)`;

    requestAnimationFrame(render);
  }

  document.addEventListener('pointermove', onMove, { passive: true });

  document.documentElement.classList.add('has-custom-cursor');
  render();
})();
