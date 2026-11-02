// Ativos da marca e do PWA (GENESIS — Identidade visual): existem, têm o tamanho certo e o manifesto aponta para eles.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const pub = (f) => path.resolve(__dirname, '../public', f);
const png = (f) => { const b = fs.readFileSync(pub(f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
const cfg = fs.readFileSync(path.resolve(__dirname, '../vite.config.js'), 'utf8');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');

describe('ativos da marca', () => {
  it.each([['pwa-192x192.png', 192], ['pwa-512x512.png', 512], ['pwa-maskable-512x512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32x32.png', 32], ['favicon-16x16.png', 16], ['favicon-48x48.png', 48]])('%s tem %i px', (f, n) => {
    expect(png(f)).toEqual({ w: n, h: n });
  });
  it('og-image 1200×630 e favicon.ico com 3 tamanhos', () => {
    expect(png('og-image.png')).toEqual({ w: 1200, h: 630 });
    const ico = fs.readFileSync(pub('favicon.ico')); expect(ico.readUInt16LE(2)).toBe(1); expect(ico.readUInt16LE(4)).toBe(3);
  });
  it('SVGs oficiais: símbolo vermelho #d10a0a com o G; sem gradiente nem sombra', () => {
    for (const f of ['favicon.svg', 'brand/genesis-simbolo.svg', 'brand/genesis-logo-horizontal.svg', 'brand/genesis-mono-preta.svg', 'brand/genesis-wordmark.svg', 'masked-icon.svg']) {
      const s = fs.readFileSync(pub(f), 'utf8'); expect(s, f).toMatch(/<svg/); expect(s, f).not.toMatch(/gradient|filter|shadow/i);
    }
    expect(fs.readFileSync(pub('favicon.svg'), 'utf8')).toContain('#d10a0a');
    expect(fs.readFileSync(pub('brand/genesis-logo-horizontal.svg'), 'utf8')).not.toMatch(/<text/); // wordmark em contornos (não depende de fonte)
  });
  it('manifesto PWA: cores da marca, ícone maskable e referências existentes', () => {
    expect(cfg).toContain("theme_color: '#d10a0a'"); expect(cfg).toContain("background_color: '#0b0d10'");
    expect(cfg).toContain("purpose: 'maskable'");
    for (const m of cfg.matchAll(/src: '([^']+\.(?:png|svg))'/g)) expect(fs.existsSync(pub(m[1])), m[1]).toBe(true);
  });
  it('index.html liga favicons, apple-touch-icon, theme-color e og:image', () => {
    for (const s of ['/favicon.svg', '/favicon.ico', '/favicon-32x32.png', '/apple-touch-icon.png', 'name="theme-color" content="#d10a0a"', 'og:image']) expect(html).toContain(s);
  });
});
