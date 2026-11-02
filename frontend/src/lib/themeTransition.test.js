import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { animateThemeChange, originOf, coverRadius } from './themeTransition';

const setReduced = (v) => { window.matchMedia = vi.fn().mockReturnValue({ matches: v }); };
beforeEach(() => { document.documentElement.className = ''; document.documentElement.removeAttribute('style'); });
afterEach(() => { delete document.startViewTransition; });

describe('onda de troca de tema', () => {
  it('raio cobre o canto mais distante a partir do ponto clicado', () => {
    expect(coverRadius(0, 0, 100, 50)).toBeCloseTo(Math.hypot(100, 50));
    expect(coverRadius(100, 50, 100, 50)).toBeCloseTo(Math.hypot(100, 50));
    expect(coverRadius(50, 25, 100, 50)).toBeCloseTo(Math.hypot(50, 25));
  });
  it('origem = centro do botão; sem botão = centro da tela', () => {
    const el = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 40, height: 20 }) };
    expect(originOf(el)).toEqual({ x: 30, y: 30 });
    expect(originOf(null)).toEqual({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  });
  it('sem suporte a View Transitions: aplica na hora', () => {
    setReduced(false); const apply = vi.fn();
    expect(animateThemeChange(null, apply)).toBeNull();
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it('movimento reduzido: troca instantânea, sem transição', () => {
    setReduced(true); const apply = vi.fn(); document.startViewTransition = vi.fn();
    animateThemeChange(null, apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(document.startViewTransition).not.toHaveBeenCalled();
  });
  it('com suporte: aplica dentro da transição, guarda a origem e limpa ao final', async () => {
    setReduced(false);
    let finish; const finished = new Promise((r) => { finish = r; });
    const apply = vi.fn();
    document.startViewTransition = vi.fn((cb) => { cb(); return { ready: Promise.resolve(), finished }; });
    document.documentElement.animate = vi.fn();
    const el = { getBoundingClientRect: () => ({ left: 100, top: 40, width: 20, height: 20 }) };
    animateThemeChange(el, apply);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue('--tx')).toBe('110px');
    expect(document.documentElement.style.getPropertyValue('--ty')).toBe('50px');
    expect(document.documentElement.classList.contains('theme-wave')).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    expect(document.documentElement.animate).toHaveBeenCalledWith(expect.objectContaining({ '--theme-r': expect.any(Array) }), expect.objectContaining({ duration: 850 }));
    finish(); await finished; await Promise.resolve();
    expect(document.documentElement.classList.contains('theme-wave')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--tx')).toBe('');
  });
});
