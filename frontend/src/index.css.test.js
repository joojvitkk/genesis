// Contrato do design system (Apple Design v3): paridade de tokens claro/escuro, contraste AA e fallbacks de acessibilidade.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const css = fs.readFileSync(path.resolve(__dirname, 'index.css'), 'utf8');
const block = (sel) => {
  const start = css.indexOf(`${sel} {`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const map = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) map[m[1]] = m[2].trim();
  return map;
};
const light = block(':root');
const dark = block('.dark');

const hex = (h) => { const v = h.replace('#', ''); const n = v.length === 3 ? v.split('').map((c) => c + c).join('') : v; return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)); };
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe('tokens', () => {
  it('todo token do tema claro existe no escuro (e vice-versa), exceto os do tema', () => {
    const only = (a, b) => Object.keys(a).filter((k) => !(k in b));
    const shared = ['ease-out', 'ease-in'];       // curvas não dependem de tema
    expect(only(light, dark).filter((k) => !shared.includes(k))).toEqual([]);
    expect(only(dark, light)).toEqual([]);
  });
  it('define materiais, on-danger/on-info e curvas espelhadas', () => {
    for (const k of ['material', 'material-thick', 'material-edge', 'material-line', 'on-danger', 'on-info', 'shadow-overlay']) {
      expect(light[k], `claro ${k}`).toBeTruthy(); expect(dark[k], `escuro ${k}`).toBeTruthy();
    }
    expect(light['ease-out']).toMatch(/cubic-bezier/); expect(light['ease-in']).toMatch(/cubic-bezier/);
  });
  it.each([['claro', light], ['escuro', dark]])('contraste AA (≥ 4,5:1) dos pares de texto — tema %s', (_n, t) => {
    const pairs = [['fg', 'surface'], ['fg-muted', 'surface'], ['fg-subtle', 'surface'], ['fg', 'canvas'], ['fg-subtle', 'sunken'], ['fg-subtle', 'raised'], ['fg-muted', 'raised'],
      ['brand-fg', 'surface'], ['brand-fg', 'brand-soft'], ['ok', 'ok-soft'], ['warn', 'warn-soft'], ['danger', 'danger-soft'], ['info', 'info-soft'],
      ['on-ok', 'ok'], ['on-warn', 'warn'], ['on-danger', 'danger'], ['on-info', 'info']];
    for (const [fg, bg] of pairs) expect(ratio(t[fg], t[bg]), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it('texto branco sobre o preenchimento da marca ≥ 4,5:1', () => {
    expect(ratio('#ffffff', light.brand)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('acessibilidade e movimento no CSS', () => {
  it('há fallback para reduced-motion, reduced-transparency e prefers-contrast', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
    expect(css).toMatch(/@media \(prefers-contrast: more\)/);
    expect(css).toMatch(/@supports not \(\(backdrop-filter/);
  });
  it('feedback no pressionar em botões e itens de navegação', () => {
    expect(css).toMatch(/\.btn:active:not\(:disabled\)\s*\{\s*transform: scale\(0\.97\)/);
    expect(css).toMatch(/\.nav-item:active/);
  });
  it('materiais usam blur + saturação; cartão de conteúdo não é translúcido', () => {
    expect(css).toMatch(/\.material \{[^}]*backdrop-filter: blur\(20px\) saturate\(180%\)/);
    const card = css.match(/\.card \{[^}]*\}/)[0];
    expect(card).not.toMatch(/backdrop-filter/);   // conteúdo não é translúcido; só sombra suave no claro
  });
  it('nenhum texto abaixo de 12 px nem font-black nas classes do sistema', () => {
    expect(css).not.toMatch(/font-size:\s*0\.[0-6]\d*rem/);
    expect(css).not.toMatch(/font-black|font-weight:\s*900/);
  });
});
