// Seletor de cor no estilo Excel: grade cores × tons, cores padrão e "Personalizar cor" — sem digitar hexadecimal.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import ColorPicker, { PALETTE, STANDARD } from './ColorPicker';

let root; let container; let onChange;
const mount = async (value) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<ColorPicker value={value} onChange={onChange} />); });
};
beforeEach(() => { onChange = vi.fn(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('ColorPicker', () => {
  it('a grade tem 10 colunas (cinza + 9 cores) × 5 tons, todas em #rrggbb, sem repetir dentro da coluna', async () => {
    await mount('#ff0000');
    expect(PALETTE).toHaveLength(10);
    for (const col of PALETTE) {
      expect(col.colors).toHaveLength(5);
      for (const hex of col.colors) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(new Set(col.colors).size).toBe(5);
    }
    expect(PALETTE[0].colors[0]).toBe('#ffffff');
    expect(PALETTE[0].colors[4]).toBe('#000000');
    expect(container.querySelectorAll('[role="group"][aria-label="Cores do tema"] button')).toHaveLength(50);
    expect(container.querySelectorAll('[role="group"][aria-label="Cores padrão"] button')).toHaveLength(STANDARD.length);
  });

  it('cada coluna vai do tom claro ao escuro (luminosidade decrescente)', () => {
    const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
    for (const col of PALETTE) for (let i = 1; i < 5; i += 1) expect(lum(col.colors[i]), `${col.name} tom ${i}`).toBeLessThan(lum(col.colors[i - 1]));
  });

  it('clicar num tom chama onChange com o hexadecimal; a cor atual fica marcada (aria-pressed)', async () => {
    await mount('#00b050');
    expect(container.querySelector('[data-color="#00b050"]').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-color="#ff0000"]').getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('[data-testid="color-current"]').style.backgroundColor).not.toBe('');
    await act(async () => { container.querySelector('[data-color="#0070c0"]').click(); });
    expect(onChange).toHaveBeenCalledWith('#0070c0');
    const tone = PALETTE[1].colors[2];
    await act(async () => { container.querySelector(`[role="group"][aria-label="Cores do tema"] [data-color="${tone}"]`).click(); });
    expect(onChange).toHaveBeenLastCalledWith(tone);
  });

  it('cada amostra tem nome acessível (cor e tom), sem exigir hexadecimal do usuário', async () => {
    await mount('#ff0000');
    const labels = [...container.querySelectorAll('button[data-color]')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toContain('Azul — médio');
    expect(labels).toContain('Cinza — preto');
    expect(labels).toContain('Vermelho escuro');
    expect(container.textContent).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it('"Personalizar cor" abre o seletor do navegador e envia a cor escolhida (minúscula)', async () => {
    await mount('#ff0000');
    const input = container.querySelector('input[type="color"]');
    const click = vi.spyOn(input, 'click');
    await act(async () => { [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Personalizar cor')).click(); });
    expect(click).toHaveBeenCalled();
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#AB12CD'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith('#ab12cd');
  });

  it('cor fora da paleta aparece como "Cor personalizada"; sem cor pede para escolher', async () => {
    await mount('#123456');
    expect(container.textContent).toContain('Cor personalizada');
    expect(container.querySelector('button[aria-pressed="true"]')).toBeFalsy();
    act(() => root.unmount()); container.remove();
    await mount('');
    expect(container.textContent).toContain('Escolha uma cor');
  });
});
