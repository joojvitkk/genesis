// Tracking da sessão (item 2): folha digital só de leitura, no PWA — celular, tablet/desktop e sem internet.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', () => api);
vi.mock('../lib/socket', () => ({ socket: { on: () => {}, off: () => {}, emit: () => {}, connected: true }, connectSocket: () => {}, trackRoom: () => () => {} }));
let user = { id: 'u1', role: 'salao' };
vi.mock('../lib/auth', () => ({ getStoredUser: () => user, getToken: () => 't' }));

import TrackingSessao from './TrackingSessao';

const sheet = {
  tournament: { _id: 't1', name: 'Main Event', number: 2, timezone: 'America/Sao_Paulo', rules: 'Late registration até o nível 12.' },
  sessions: [
    { _id: 's1', name: 'Dia 1A', type: 'QUALIFIER', starts_at: '2026-10-01T17:00:00Z', level_minutes: 20, registration_until_level: 12 },
    { _id: 's2', name: 'Dia 1B', type: 'QUALIFIER', starts_at: '2026-10-01T21:00:00Z', level_minutes: 20, registration_until_level: 12 },
  ],
  session: { _id: 's1', name: 'Dia 1A', status: 'running' },
  has_history: true,
  rows: [
    { index: 0, kind: 'actual', row_type: 'level', level_number: 1, small_blind: 100, big_blind: 200, ante: 0, duration_min: 20, start: '2026-10-01T17:00:00Z', end: '2026-10-01T17:25:00Z', entries_total: 30, playing: 30, floor_counts: [{ counted: 28, calculated: 30, diff: -2, user_name: 'Ana', reason: 'mesa 3' }] },
    { index: 1, kind: 'current', row_type: 'level', level_number: 2, small_blind: 200, big_blind: 400, ante: 0, duration_min: 20, start: '2026-10-01T17:25:00Z', end: '2026-10-01T17:45:00Z', entries_total: 41, playing: 40, floor_counts: [] },
    { index: 2, kind: 'forecast', row_type: 'break', label: 'Break', duration_min: 10, start: '2026-10-01T17:45:00Z', end: '2026-10-01T17:55:00Z' },
    { index: 3, kind: 'forecast', row_type: 'end_day', duration_min: 0, start: '2026-10-01T17:55:00Z', end: '2026-10-01T17:55:00Z' },
  ],
  forecast: { registration_ends_at: null, day_ends_at: '2026-10-01T17:55:00Z' },
  day: { entries_total: 41, entries_initial: 38, entries_reentries: 3, qualified_count: null, qualified_log: [], started_at: '2026-10-01T17:00:00Z', ended_at: null, duration_ms: null, duration_net_ms: null, peak_players: 41, levels_played: 2, stopped: null },
  tournament_summary: { days: [], totals: { entries_initial: 38, entries_reentries: 3, qualified: 0 } },
};
let root; let container;
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const mount = async () => {
  await act(async () => { root.render(<MemoryRouter initialEntries={['/tracking-sessao/t1/s1']}><Routes><Route path="/tracking-sessao/:tid/:sid" element={<TrackingSessao />} /></Routes></MemoryRouter>); });
  await flush();
};
beforeEach(() => { localStorage.clear(); user = { id: 'u1', role: 'salao' }; api.apiGet.mockResolvedValue(sheet); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

describe('Tracking da sessão', () => {
  it('mostra cabeçalho, grade no formato da folha, rodapé e resumo — sem stack inicial nem dinheiro', async () => {
    await mount();
    const t = container.textContent;
    expect(api.apiGet).toHaveBeenCalledWith('/tournaments/t1/sessions/s1/tracking');
    expect(t).toContain('#02 Main Event'); expect(t).toContain('Dia 1B'); expect(t).toContain('Late registration');
    expect(container.querySelectorAll('[data-testid="grid"] tbody tr')).toHaveLength(4);
    expect(container.querySelector('[data-testid="grid"] [data-kind="current"]')).toBeTruthy();
    expect(t).toContain('Fechamento do dia'); expect(t).toContain('Resumo do torneio');
    expect(t).not.toMatch(/stack inicial|R\$|buy-in de/i);
  });

  it('horário previsto é marcado com * e a diferença da conferência do floor aparece em destaque', async () => {
    await mount();
    const rows = [...container.querySelectorAll('[data-testid="grid"] tbody tr')];
    expect(rows[2].textContent).toContain('*');
    expect(rows[0].textContent).not.toContain('*');
    expect(rows[0].textContent).toContain('28 (-2)');
    expect(rows[0].querySelector('td.text-red-600')).toBeTruthy();
  });

  it('celular: lista compacta com o nível atual fixo no topo e cabeçalho recolhível', async () => {
    await mount();
    expect(container.querySelector('[data-testid="list"]').children).toHaveLength(4);
    const pinned = container.querySelector('[data-testid="current-pinned"]');
    expect(pinned.className).toContain('sticky');
    expect(pinned.textContent).toContain('200/400');
    expect(container.textContent).not.toContain('Sessões do torneio'.repeat(2));
  });

  it('sem internet mostra o ÚLTIMO estado sincronizado com data e hora; o cache é de cada usuário', async () => {
    await mount();
    expect(localStorage.getItem('genesis:tracking:u1:s1')).toBeTruthy();
    act(() => root.unmount());
    api.apiGet.mockRejectedValue(Object.assign(new Error('Falha de conexão'), { status: 0 }));
    root = createRoot(container);
    await mount();
    expect(container.querySelector('[data-testid="stale"]').textContent).toContain('Sem conexão');
    expect(container.textContent).toContain('Main Event');
    // outro usuário não enxerga o cache do primeiro
    act(() => root.unmount());
    user = { id: 'u2', role: 'material' };
    root = createRoot(container);
    await mount();
    expect(container.querySelector('[data-testid="tracking-sessao"]')).toBeFalsy();
    expect(container.textContent).toContain('Carregando');
  });
});
