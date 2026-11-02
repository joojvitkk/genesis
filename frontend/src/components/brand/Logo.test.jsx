import { describe, it, expect, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import Logo from './Logo';
import { WORDMARK_D, WORDMARK_W } from './wordmark';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root; let c;
const draw = async (el) => { c = document.createElement('div'); document.body.appendChild(c); root = createRoot(c); await act(async () => { root.render(el); }); return c.querySelector('svg'); };
afterEach(() => { act(() => root.unmount()); c.remove(); });

describe('Logo (conceito 02 · G modular)', () => {
  it('símbolo: quadrado 32×32 com cantos 6 e o G em contraste', async () => {
    const svg = await draw(<Logo variant="symbol" height={48} />);
    expect(svg.getAttribute('viewBox')).toBe('0 0 32 32'); expect(svg.getAttribute('width')).toBe('48');
    expect(svg.querySelector('rect').getAttribute('rx')).toBe('6');
    expect(svg.querySelector('circle').getAttribute('r')).toBe('8.5');
    expect(svg.getAttribute('role')).toBe('img'); expect(svg.getAttribute('aria-label')).toBe('GENESIS');
  });
  it('horizontal mantém a proporção e usa o wordmark em contornos (herda a cor do texto)', async () => {
    const svg = await draw(<Logo height={32} />);
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(45 + WORDMARK_W, 1);
    expect(svg.querySelector('path[fill="currentColor"]').getAttribute('d')).toBe(WORDMARK_D);
  });
  it('wordmark isolado', async () => {
    const svg = await draw(<Logo variant="wordmark" height={21} />);
    expect(svg.querySelector('circle')).toBeNull();
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(WORDMARK_W, 1);
  });
});
