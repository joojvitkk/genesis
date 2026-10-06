import { describe, it, expect } from 'vitest';
import { formatOffset, offsetMinutes, timezoneOptions } from './timezones';

describe('fusos horários', () => {
  it('formata o deslocamento', () => {
    expect(formatOffset(-180)).toBe('UTC−03:00');
    expect(formatOffset(60)).toBe('UTC+01:00');
    expect(formatOffset(0)).toBe('UTC');
    expect(formatOffset(-330)).toBe('UTC−05:30');
  });
  it('calcula o deslocamento real (Brasília −3, Manaus −4, sem horário de verão)', () => {
    const at = new Date('2026-10-05T12:00:00Z');
    expect(offsetMinutes('America/Sao_Paulo', at)).toBe(-180);
    expect(offsetMinutes('America/Manaus', at)).toBe(-240);
    expect(offsetMinutes('UTC', at)).toBe(0);
  });
  it('opções ordenadas do oeste ao leste, com rótulo "(UTC−03:00) Nome", e preservam um fuso salvo fora da lista', () => {
    const at = new Date('2026-10-05T12:00:00Z');
    const opts = timezoneOptions('Asia/Tokyo', at);
    expect(opts.find((o) => o.value === 'America/Sao_Paulo').label).toBe('(UTC−03:00) Brasília, São Paulo e Rio de Janeiro');
    expect(opts.find((o) => o.value === 'Asia/Tokyo').label).toBe('(UTC+09:00) Tokyo');
    const offs = opts.map((o) => offsetMinutes(o.value, at));
    expect([...offs].sort((a, b) => a - b)).toEqual(offs);
  });
});
