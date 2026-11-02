// Troca de tema com "onda": o tema novo se propaga em círculo a partir do botão clicado até cobrir a tela
// (View Transitions API + máscara radial com borda suavizada). Sem suporte ou com movimento reduzido: troca instantânea.
const DURATION = 850;      // ms
const FEATHER = 140;       // px de borda suave na frente da onda
const EASE = 'cubic-bezier(0.22, 0.8, 0.2, 1)';

/** Centro do elemento de origem (o botão); sem origem, o centro da tela. */
export function originOf(el) {
  if (el && el.getBoundingClientRect) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/** Raio que cobre o canto mais distante da tela a partir de (x, y). */
export const coverRadius = (x, y, w = window.innerWidth, h = window.innerHeight) => Math.hypot(Math.max(x, w - x), Math.max(y, h - y));

/**
 * @param {Element|null} origin elemento clicado (a onda nasce no centro dele)
 * @param {() => void} apply   aplica o tema de forma SÍNCRONA (classe no <html> + estado)
 */
export function animateThemeChange(origin, apply) {
  const root = document.documentElement;
  let reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
  if (reduced || typeof document.startViewTransition !== 'function') { apply(); return null; }

  const { x, y } = originOf(origin);
  const radius = coverRadius(x, y) + FEATHER;
  root.style.setProperty('--tx', `${x}px`);
  root.style.setProperty('--ty', `${y}px`);
  root.classList.add('theme-wave');           // desliga transições CSS: o novo quadro precisa nascer já no tema final

  const transition = document.startViewTransition(apply);
  transition.ready.then(() => {
    root.animate({ '--theme-r': ['0px', `${radius}px`] }, { duration: DURATION, easing: EASE });
  }).catch(() => {});
  const done = () => { root.classList.remove('theme-wave'); root.style.removeProperty('--tx'); root.style.removeProperty('--ty'); };
  transition.finished.then(done, done);
  return transition;
}
