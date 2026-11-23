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
    { session_id: 's1', name: 'Dia 1A', total_actions: 90, has_count: true, counted_at: '2026-10-01T22:00:00Z', breakage: 0,
      by_chip: { c100: { expected: 900, out: 0, in: 0, discarded: 0, in_play: 900, counted: 940, diff: 40 }, c500: { expected: 360, out: 0, in: 0, discarded: 0, in_play: 360, counted: 360, diff: 0 } },
      totals: { expected: 270000, out: 0, in: 0, discarded: 0, in_play: 270000, counted: 274000, diff: 4000 } },
    { session_id: 's2', name: 'Dia 1B', total_actions: 10, has_count: false, breakage: 0,
      by_chip: { c100: { expected: 100, out: 0, in: 0, discarded: 0, in_play: 100, counted: null, diff: null } },
      totals: { expected: 10000, out: 0, in: 0, discarded: 0, in_play: 10000, counted: null, diff: null } },
  ],
  totals: { expected: 280000, out: 0, in: 0, discarded: 0, in_play: 280000, breakage: 0, actions: 100 },
};
let container; let root;
beforeEach(() => { api.apiGet.mockResolvedValue(book); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

describe('TournamentBook', () => {
  it('mostra ações, contado e diferença por sessão; sessão sem contagem aparece como "não feita"', async () => {
    await act(async () => { root.render(<TournamentBook tournamentId="t1" />); });
    await act(async () => {});
    const t = container.textContent;
    expect(api.apiGet).toHaveBeenCalledWith('/tournaments/t1/book');
    expect(t).toContain('Dia 1A'); expect(t).toContain('Dia 1B');
    expect(t).toContain('Contado no fim do dia');
    expect(t).toContain('não feita');
    expect(t).toContain('Quebra das trocas');
    expect(container.querySelector('button')).toBeTruthy(); // CSV / PDF
  });
});
