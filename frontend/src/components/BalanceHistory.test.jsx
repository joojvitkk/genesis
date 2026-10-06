// Histórico de saldo (G11): cada movimento com o efeito no saldo e o saldo depois.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', () => api);
import BalanceHistory from './BalanceHistory';

const chip = { _id: 'c100', name: 'Ficha 100', value: 100 };
const row = (over) => ({ _id: 'm1', type: 'LOSS', quantity: 4, chip_id: chip, reason: 'caíram 4', user_name: 'Ana', createdAt: '2026-10-01T12:00:00Z', effects: [{ location: { kind: 'binder', id: 'b1' }, delta: -4, balance_after: 76 }, { location: { kind: 'lost', id: 'b1' }, delta: 4, balance_after: 4 }], reversed_by: null, ...over });
const payload = { entity: { type: 'binder', name: 'LISA' }, balances: [], pagination: { total: 2, page: 1, pages: 1 }, rows: [row({}), row({ _id: 'm0', type: 'ASSEMBLY', reason: 'montagem', effects: [{ location: { kind: 'binder', id: 'b1' }, delta: 100, balance_after: 100 }], reversed_by: { user_name: 'Chefe', reason: 'engano' } })] };
let root; let container;
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const option = (label) => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes(label));

beforeEach(async () => {
  api.apiGet.mockReset();
  api.apiGet.mockImplementation(async (path) => {
    if (path === '/binders') return [{ _id: 'b1', name: 'LISA' }];
    if (path === '/chips') return [chip];
    if (path === '/tournaments') return [{ _id: 't1', name: 'Warm Up' }];
    if (path === '/audit/history') return payload;
    return [];
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<BalanceHistory />); });
  await flush(60);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const pickBinder = async () => { await act(async () => { button('Escolha').click(); }); await act(async () => { option('LISA').click(); }); await flush(); };

describe('BalanceHistory', () => {
  it('sem escolha não consulta; ao escolher o fichário mostra os movimentos com efeito e saldo depois', async () => {
    expect(api.apiGet).not.toHaveBeenCalledWith('/audit/history', expect.anything());
    await pickBinder();
    expect(api.apiGet).toHaveBeenCalledWith('/audit/history', { binder_id: 'b1', page: 1, limit: 50 });
    const t = container.querySelector('[data-testid="balance-history"]').textContent;
    expect(t).toContain('Perda · Ficha 100');
    expect(t).toContain('caíram 4');
    const effects = [...container.querySelectorAll('[data-effect]')].map((e) => e.textContent.replace(/\s+/g, ' ').trim());
    expect(effects[0]).toContain('Fichário −4 → saldo 76');
    expect(effects[1]).toContain('Divergência +4 → saldo 4');
    expect(effects[2]).toContain('+100 → saldo 100');
    expect(t).toContain('2 movimentos · LISA');
  });

  it('movimento estornado aparece riscado com quem estornou e por quê', async () => {
    await pickBinder();
    const m = container.querySelector('[data-movement="m0"]');
    expect(m.textContent).toContain('estornado');
    expect(m.textContent).toContain('Estornado por Chefe: engano');
    expect(container.querySelector('[data-movement="m1"]').textContent).not.toContain('estornado');
  });

  it('filtra por ficha dentro do fichário; trocar o tipo limpa a escolha', async () => {
    await pickBinder();
    await act(async () => { button('Todas as fichas').click(); });
    await act(async () => { option('Ficha 100').click(); });
    await flush();
    expect(api.apiGet).toHaveBeenLastCalledWith('/audit/history', { binder_id: 'b1', chip_id: 'c100', page: 1, limit: 50 });

    await act(async () => { button('Fichário').click(); });
    await act(async () => { option('Torneio').click(); });
    expect(container.querySelector('[data-testid="balance-history"]')).toBeFalsy();
    await act(async () => { button('Escolha').click(); });
    await act(async () => { option('Warm Up').click(); });
    await flush();
    expect(api.apiGet).toHaveBeenLastCalledWith('/audit/history', { tournament_id: 't1', page: 1, limit: 50 });
  });

  it('erro do servidor é exibido; paginação pede a página seguinte', async () => {
    api.apiGet.mockImplementation(async (path, params) => {
      if (path === '/binders') return [{ _id: 'b1', name: 'LISA' }];
      if (path === '/audit/history') return { ...payload, pagination: { total: 120, page: params.page, pages: 3 } };
      return [];
    });
    await pickBinder();
    await act(async () => { container.querySelector('button[aria-label="Próxima página"]').click(); });
    await flush();
    expect(api.apiGet).toHaveBeenLastCalledWith('/audit/history', { binder_id: 'b1', page: 2, limit: 50 });
    expect(container.textContent).toContain('2 / 3');
  });

  it('erro do servidor é exibido e some a tabela', async () => {
    api.apiGet.mockImplementation(async (path) => { if (path === '/audit/history') throw Object.assign(new Error('Fichário não encontrado.'), { status: 404 }); return path === '/binders' ? [{ _id: 'b1', name: 'LISA' }] : []; });
    await pickBinder();
    expect(container.querySelector('[role="alert"]').textContent).toContain('Fichário não encontrado');
    expect(container.querySelector('[data-testid="balance-history"]')).toBeFalsy();
  });
});
