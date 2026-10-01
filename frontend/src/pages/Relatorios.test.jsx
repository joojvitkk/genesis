// Relatórios (G10): estoque, distribuição, descartes/perdas/recuperações e comparativo vêm dos movimentos.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', () => api);
const csv = vi.hoisted(() => ({ exportToCSV: vi.fn() }));
vi.mock('../utils/csvExport', () => csv);
vi.mock('recharts', () => {
  const Box = ({ children }) => <div>{children}</div>;
  return { BarChart: Box, Bar: Box, XAxis: Box, YAxis: Box, CartesianGrid: Box, Tooltip: Box, ResponsiveContainer: Box, PieChart: Box, Pie: Box, Cell: Box, Legend: Box };
});

import Relatorios from './Relatorios';
import { AlertProvider } from '../contexts/AlertContext';

const report = {
  stats: {
    totalTournaments: 3, finishedTournaments: 1, totalChipRaces: 2, totalChips: 1500, stockValue: 190000, chipsInBinders: 1200, chipsInPlay: 300, chipsLost: 3,
    discardedChips: 5, discardedValue: 500, lostChips: 5, lostValue: 900, recoveredChips: 1, recoveredValue: 100, openOccurrences: 3, redOccurrences: 1,
  },
  charts: { chipDistribution: [{ name: 'Ficha 100', value: 1250, color: '#000', in_binders: 1000, in_play: 250, lost: 3 }, { name: 'Ficha 500', value: 250, color: '#f00', in_binders: 200, in_play: 50, lost: 0 }], byLocation: [], racesByTournament: [] },
  logs: [], pagination: { total: 0, page: 1, pages: 1 },
};
const comparison = [{ _id: 't1', name: 'Warm Up', date: '2026-10-01', total_entries: 10, addons: 0, prize_pool: 900, bounty_pool: 0, rake_collected: 100, winner: 'Ana',
  material: { sent_value: 51000, returned_value: 1000, discarded_value: 400, lost_value: 777, ko_settled_value: 3, math_breakage: 555 } }];
let root; let container;
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));

beforeEach(async () => {
  api.apiGet.mockReset(); csv.exportToCSV.mockReset();
  api.apiGet.mockImplementation(async (path) => (path === '/reports/comparison' ? comparison : report));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<AlertProvider><Relatorios /></AlertProvider>); });
  await flush(60);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Relatorios (G10)', () => {
  it('cards de fichas: total (em fichários + em jogo), valor, descartadas, perdidas, recuperadas e ocorrências', () => {
    const t = container.textContent;
    expect(t).toContain('1.500');
    expect(t).toContain('1.200 em fichários');
    expect(t).toContain('300 em jogo');
    const flow = container.querySelector('[data-testid="chip-flow-stats"]').textContent;
    for (const s of ['Descartadas', 'Perdidas', 'Recuperadas', 'Ocorrências abertas', '1 vermelha(s)']) expect(flow).toContain(s);
    expect(flow).toContain('valor 500');
    expect(flow).toContain('valor 900');
  });

  it('comparativo mostra o material por torneio (enviado, descartado, perdido, quebra)', async () => {
    await act(async () => { button('Comparar').click(); });
    await flush();
    const t = container.textContent;
    for (const h of ['Fichas enviadas', 'Descartado', 'Perdido', 'Quebra chip race']) expect(t).toContain(h);
    for (const v of ['51.000', '400', '777', '555']) expect(t).toContain(v); // enviado, descartado, perdido, quebra
  });

  it('CSV de fichas usa a distribuição derivada (em fichários, em jogo, divergência); o CSV de logs segue existindo', async () => {
    await act(async () => { button('CSV fichas').click(); });
    expect(csv.exportToCSV).toHaveBeenCalledTimes(1);
    const [rows, name] = csv.exportToCSV.mock.calls[0];
    expect(rows).toEqual([
      { ficha: 'Ficha 100', em_ficharios: 1000, em_jogo: 250, em_divergencia: 3, existentes: 1250 },
      { ficha: 'Ficha 500', em_ficharios: 200, em_jogo: 50, em_divergencia: 0, existentes: 250 },
    ]);
    expect(name).toMatch(/^genesis-fichas-/);
    expect(button('CSV logs')).toBeTruthy();
    expect(button('PDF')).toBeTruthy();
  });
});
