import { describe, it, expect } from 'vitest';
import { levelNumberAt, nextLevelRow, breakRow, cloneRows, validateRows, totalMinutes } from './blinds';

const L = (sb, bb, ante = 0, duration = 20) => ({ row_type: 'level', small_blind: sb, big_blind: bb, ante, duration });

describe('blinds helpers', () => {
  it('numeração ignora breaks e marcadores', () => {
    const rows = [L(100, 200), breakRow(15), L(200, 400), { row_type: 'end_day', label: 'x' }, breakRow(60, true), L(300, 600)];
    expect([0, 1, 2, 3, 4, 5].map((i) => levelNumberAt(rows, i))).toEqual([1, null, 2, null, null, 3]);
  });
  it('Adicionar Nível: número seguinte e valores do ÚLTIMO nível (sem dobrar, sem voltar ao Nível 1)', () => {
    const rows = [L(100, 200), L(1600, 3200, 3200, 30), breakRow(15)];
    const next = nextLevelRow(rows);
    expect(next).toMatchObject({ level: 3, small_blind: 1600, big_blind: 3200, ante: 3200, duration: 30 });
  });
  it('estrutura vazia usa o padrão 50/100', () => {
    expect(nextLevelRow([])).toMatchObject({ level: 1, small_blind: 50, big_blind: 100 });
  });
  it('break/dinner têm duração própria e não são nível', () => {
    expect(breakRow(60, true)).toEqual({ row_type: 'break', duration: 60, label: 'Dinner Break 60 min' });
  });
  it('cloneRows copia por valor e remove _id', () => {
    const src = [{ _id: 'a', ...L(1, 2) }];
    const c = cloneRows(src); c[0].small_blind = 9;
    expect(src[0].small_blind).toBe(1);
    expect(c[0]._id).toBeUndefined();
  });
  it('validateRows', () => {
    expect(validateRows([])).toMatch(/ao menos um nível/);
    expect(validateRows([L(0, 200)])).toMatch(/Nível 1/);
    expect(validateRows([L(100, 200, 0, 0)])).toMatch(/duração/);
    expect(validateRows([L(100, 200)])).toBeNull();
  });
  it('totalMinutes soma níveis e breaks', () => {
    expect(totalMinutes([L(1, 2, 0, 20), breakRow(15), { row_type: 'end_day' }])).toBe(35);
  });
});
