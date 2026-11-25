// Livro do torneio: planilha só de leitura (denominações × sessões) com contado e diferença.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', () => api);
vi.mock('../lib/socket', () => ({ socket: { on: () => {}, off: () => {} } }));
import TournamentBook from './TournamentBook';

const book = {
  tournament: { _id: 't1', name: 'Warm Up' },
  chips: [{ _id: 'c100', value: 100, color: '#000' }, { _id: 'c500', value: 500, color: '#f00' }],
  sessions: [
    { session_id: 's1', name: 'Dia 1A', inherits: false, actions: { buy_in: 90 }, total_actions: 90, has_count: true, counted_at: '2026-10-01T22:00:00Z', breakage: 3000,
      trades: [
        { n: 1, type: 'CHIP_RACE', breakage: 0, outs: { c100: 900 }, ins: { c500: 180 } },
        { n: 2, type: 'COLOR_UP', breakage: 3000, outs: { c500: 100 }, ins: {} },
      ],
      by_chip: { c100: { expected: 900, out: 900, in: 0, discarded: 0, in_play: 0, counted: 0, diff: 0 }, c500: { expected: 360, out: 100, in: 180, discarded: 0, in_play: 440, counted: 440, diff: 0 } },
      totals: { expected: 270000, out: 0, in: 0, discarded: 0, in_play: 220000, counted: 220000, diff: 0 } },
    { session_id: 's2', name: 'Dia Final', inherits: true, actions: {}, total_actions: 0, has_count: false, breakage: 0, trades: [],
      by_chip: { c500: { expected: 440, out: 0, in: 0, discarded: 0, in_play: 440, counted: null, diff: null } },
      totals: { expected: 220000, out: 0, in: 0, discarded: 0, in_play: 220000, counted: null, diff: null } },
  ],
  totals: { expected: 270000, out: 0, in: 0, discarded: 0, in_play: 220000, breakage: 3000, actions: 90, closing: { delivered: 270000, breakage: 3000, discarded: 0, final_trades: 0, balance: 273000 } },
};
let container; let root;
beforeEach(() => { api.apiGet.mockImplementation((url) => Promise.resolve(url.endsWith('/closing') ? { status: 'awaiting_count', open_occurrences: 0, rows: [], totals: { delivered: 0, trades: 0, discarded: 0, occurrences: 0, expected: 0, counted: null, diff: null }, divergences: [], binders: { all_returned: true, still_out: [] } } : book)); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

describe('TournamentBook', () => {
  const mount = async () => { await act(async () => { root.render(<TournamentBook tournamentId="t1" />); }); await act(async () => {}); };
  const tab = (name) => [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === name);

  it('uma aba por sessão, como linha do tempo: Em jogo → Saiu/Entrou de cada troca → Saldo → Contado e Diferença', async () => {
    await mount();
    expect(api.apiGet).toHaveBeenCalledWith('/tournaments/t1/book');
    expect([...container.querySelectorAll('[role="tab"]')].map((b) => b.textContent)).toEqual(['Dia 1A', 'Dia Final', 'Resumo']);
    const heads = [...container.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(heads).toEqual(['Denominação', 'Em jogo', 'Chip Race 1 · Saiu', 'Chip Race 1 · Entrou', 'Color Up 2 · Saiu', 'Color Up 2 · Entrou', 'Saldo em jogo', 'Contado', 'Diferença']);
    expect(container.querySelector('[data-testid="book-top"]').textContent).toContain('Buy-in 90');
    expect(container.querySelector('[data-testid="book-top"]').textContent).toContain('✓'); // contagem bate
    expect(container.querySelector('tfoot').textContent).toContain('3.000'); // quebra da troca
  });

  it('a fase herdada abre em "Herdado" e não tem Esperado', async () => {
    await mount();
    await act(async () => { tab('Dia Final').click(); });
    const heads = [...container.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(heads.slice(0, 2)).toEqual(['Denominação', 'Herdado']);
    expect(container.textContent).not.toContain('Esperado');
  });

  it('resumo do torneio traz a conta de fechamento sem duplicar o herdado', async () => {
    await mount();
    await act(async () => { tab('Resumo').click(); });
    const t = container.querySelector('[data-testid="book-summary"]').textContent;
    expect(t).toContain('Ações × montagem'); expect(t).toContain('270.000');
    expect(container.querySelector('[data-testid="book-balance"]').textContent).toBe('273.000');
    expect(container.querySelector('[data-testid="closing"]').textContent).toContain('Aguardando a contagem final');
    expect(container.querySelector('button')).toBeTruthy(); // CSV / PDF
  });
});
