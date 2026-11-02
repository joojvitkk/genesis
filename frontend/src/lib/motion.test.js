import { describe, it, expect } from 'vitest';
import { SPRING, SPRING_SNAP, SPRING_SHEET, EXIT, modalMotion, scrimMotion, riseMotion } from './motion';

describe('movimento (Apple Design)', () => {
  it('mola padrão é criticamente amortecida; quique só na gaveta com momento', () => {
    expect(SPRING.bounce).toBe(0);
    expect(SPRING_SNAP.bounce).toBe(0);
    expect(SPRING_SHEET.bounce).toBeGreaterThan(0);
    expect(SPRING_SHEET.bounce).toBeLessThanOrEqual(0.2);
  });
  it('saída é mais rápida que a entrada e usa curva espelhada', () => {
    expect(EXIT.duration).toBeLessThan(SPRING.duration);
    expect(EXIT.ease).toEqual([0.8, 0.22, 1, 0.2]);
  });
  it('modal materializa (escala + opacidade + desfoque) e sai pelo mesmo caminho', () => {
    expect(modalMotion.initial).toMatchObject({ opacity: 0 });
    expect(modalMotion.initial.scale).toBeLessThan(1);
    expect(modalMotion.initial.filter).toMatch(/blur/);
    expect(modalMotion.animate).toMatchObject({ opacity: 1, scale: 1, y: 0 });
    expect(modalMotion.exit.scale).toBeLessThan(1);
    expect(modalMotion.exit.y).toBeGreaterThanOrEqual(0);
  });
  it('scrim e bloco de página são só opacidade/pequeno deslocamento', () => {
    expect(scrimMotion.initial).toEqual({ opacity: 0 });
    expect(Math.abs(riseMotion.initial.y)).toBeLessThanOrEqual(8);
  });
});
