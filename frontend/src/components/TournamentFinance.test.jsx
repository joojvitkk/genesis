// Eliminação por ENTRADA (não há cadastro de jogadores): "Entrada #n".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../lib/api', () => api);
vi.mock('../lib/offlineQueue', () => ({ enqueue: vi.fn() }));

import TournamentFinance from './TournamentFinance';
import { AlertProvider } from '../contexts/AlertContext';

const finance = {
  tournament: { _id: 't1', name: 'T', status: 'running', buy_in: 100, rake: 0, addon_value: 0, addon_chips: 0, bounty_value: 0, payout_template: null },
  summary: { buyins: 3, reentries: 0, addons: 0, total_entries: 3, gross: 300, rake_collected: 0, prize_pool: 300, bounty_pool: 0, bounty_paid: 0 },
  payouts: [], players_remaining: 3,
  entries_in_play: [{ _id: 'e1', number: 1, type: 'buy-in', label: 'Entrada #1' }, { _id: 'e2', number: 2, type: 'buy-in', label: 'Entrada #2' }, { _id: 'e3', number: 3, type: 're-entry', label: 'Entrada #3' }],
  eliminations: [{ _id: 'x9', position: 4, entry_id: 'e9', label: 'Entrada #9' }],
};
let root; let container;
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const option = (label) => [...container.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes(label));

beforeEach(async () => {
  Object.values(api).forEach((f) => f.mockReset());
  api.apiGet.mockImplementation(async (path) => (path.endsWith('/finance') ? finance : path.endsWith('/results') ? [{ position: 4, label: 'Entrada #9', prize: 0 }] : []));
  api.apiPost.mockResolvedValue({ ...finance, players_remaining: 2 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<AlertProvider><TournamentFinance tournament={{ _id: 't1', status: 'running', buy_in: 100 }} canEdit onTournamentChange={() => {}} /></AlertProvider>); });
  await flush(60);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('TournamentFinance — eliminação por entrada', () => {
  it('lista as entradas em jogo pelo número, elimina por entry_id e não pede jogador nem eliminador', async () => {
    expect(container.textContent).toContain('Entradas em jogo');
    expect(container.textContent).not.toMatch(/Eliminador|Jogador eliminado/);
    expect(button('Registrar eliminação').disabled).toBe(true);
    await act(async () => { button('Entrada eliminada').click(); });
    await act(async () => { option('Entrada #3').click(); });
    await act(async () => { button('Registrar eliminação').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/eliminations', { entry_id: 'e3' });
  });

  it('resultado mostra "Entrada #n"; cancelar a eliminação pede motivo e usa o endpoint de cancelamento', async () => {
    expect(container.textContent).toContain('Entrada #9');
    await act(async () => { container.querySelector('button[title="Desfazer"]').click(); });
    await flush();
    const dlg = document.querySelector('[role="dialog"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(dlg.querySelector('input'), 'engano'); dlg.querySelector('input').dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { [...dlg.querySelectorAll('button')].find((b) => b.textContent.includes('Cancelar eliminação')).click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/eliminations/x9/cancel', { reason: 'engano' });
  });
});
