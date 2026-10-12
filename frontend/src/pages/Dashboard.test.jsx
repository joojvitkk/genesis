// Dashboard (G10): "onde estão as fichas / o que acontece agora" sobre os movimentos; KO (G9); atualização por bloco.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', () => api);
const sock = vi.hoisted(() => { const h = {}; return { handlers: h, socket: { on: (e, f) => { (h[e] ||= new Set()).add(f); }, off: (e, f) => h[e]?.delete(f) } }; });
vi.mock('../lib/socket', () => ({ socket: { ...sock.socket, emit: () => {}, connected: true }, connectSocket: () => {} }));

import Dashboard from './Dashboard';
import { EVENT_BLOCKS } from '../lib/useDashboard';

const c100 = { _id: 'c100', name: 'Ficha 100', value: 100, color: '#000' };
const c500 = { _id: 'c500', name: 'Ficha 500', value: 500, color: '#f00' };
const full = () => ({
  metrics: { activeTournamentsCount: 1, availableCases: 2 },
  running_clocks: [
    { tournament_id: 't1', session_id: 's1', session_name: 'Dia 1A', name: 'Warm Up', clock_status: 'running', actual_players: 120, remaining_ms: 600000, server_time: Date.now(), level: { row_type: 'level', small_blind: 100, big_blind: 200 }, level_number: 1 },
    { tournament_id: 't1', session_id: 's2', session_name: 'Dia 1B', name: 'Warm Up', clock_status: 'paused', actual_players: 80, remaining_ms: 900000, server_time: Date.now(), level: { row_type: 'level', small_blind: 100, big_blind: 200 }, level_number: 1 },
  ],
  recentTournaments: [{ _id: 't1', name: 'Warm Up', status: 'running', start_time: '20:00' }],
  recentActivities: [],
  free_binders: [{ _id: 'b1', name: 'Clássica', code: null, chips_total: 1000, chips: [{ chip: { _id: 'c100', value: 100, color: '#000' }, quantity: 1000 }] }, { _id: 'b2', name: 'TESTE', code: 'T-1', chips_total: 10, chips: [] }],
  tournament_chips: { rows: [{ tournament: { _id: 't1', name: 'Warm Up' }, quantity: 300, value: 75000, chips: [{ chip: c100, quantity: 250 }, { chip: c500, quantity: 50 }], sessions: [{ session: { _id: 's1', name: 'Dia 1A' }, quantity: 200, chips: [{ chip: c100, quantity: 200 }] }, { session: { _id: 's2', name: 'Dia 1B' }, quantity: 100, chips: [{ chip: c100, quantity: 50 }, { chip: c500, quantity: 50 }] }] }, { tournament: { _id: 't2', name: 'High Roller' }, quantity: 40, value: 20000, chips: [{ chip: c500, quantity: 40 }] }], totals: { quantity: 340, value: 95000 } },
  occurrences: { open_by_severity: { GREEN: 2, YELLOW: 0, RED: 1 }, open_total: 3, pending_justification: 1, recovered: { occurrences: 1, quantity: 1 }, missing_quantity: 4 },
  requests: [{ _id: 'q1', type: 'CHIP_RACE', status: 'requested', tables: 4, tournament_id: { name: 'Warm Up' }, session_id: { name: 'Dia 1A' }, chip_id: { value: 100 } }],
});
let payload; let root; let container;
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const panel = (id) => container.querySelector(`[data-testid="${id}"]`);

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><Dashboard /></MemoryRouter>); });
  await flush(60);
}
const fire = async (ev) => { await act(async () => { sock.handlers[ev].forEach((f) => f({})); }); await flush(320); };
const statsCalls = () => api.apiGet.mock.calls.filter(([p]) => p === '/dashboard/stats');

const asRole = (role) => localStorage.setItem('genesis_user', JSON.stringify({ role }));
beforeEach(() => {
  asRole('admin'); // painel completo; Salão/Material veem o painel enxuto
  payload = full();
  api.apiGet.mockReset();
  api.apiGet.mockImplementation(async (path, params) => {
    if (/\/tournaments\/t1\/clock$/.test(path)) return { tournament_id: 't1', session_id: params?.session_id, clock_status: 'stopped', level: { row_type: 'level', small_blind: 100, big_blind: 200 }, level_number: 1, remaining_ms: 1800000, server_time: Date.now(), actual_players: 300 };
    if (path !== '/dashboard/stats') return [];
    if (!params?.blocks) return payload;
    return Object.fromEntries(params.blocks.split(',').map((b) => [b, payload[b]]));
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Relógios dos torneios em andamento', () => {
  it('um relógio por SESSÃO; em intervalo o cartão muda de cor e cada sessão recebe só os seus pulsos', async () => {
    await mount();
    const cards = container.querySelectorAll('[data-testid="running-clock"]');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('Warm Up'); expect(cards[0].textContent).toContain('Dia 1A');
    expect(cards[1].textContent).toContain('Dia 1B');
    // pulso do 1B em intervalo: o 1A não muda
    await act(async () => {
      (sock.handlers.tournamentClock || new Set()).forEach((f) => f({
        tournament_id: 't1', session_id: 's2', clock_status: 'running', is_break: true, level: { row_type: 'break', label: 'Break 15 min' }, level_number: null,
        next_play_level: { level_number: 6, small_blind: 400, big_blind: 800 }, remaining_ms: 600000, server_time: Date.now(), actual_players: 80,
      }));
    });
    const brk = container.querySelectorAll('[data-break="true"]');
    expect(brk.length).toBe(1);
    expect(brk[0].textContent).toContain('Dia 1B');
    expect(brk[0].textContent).toContain('Nível 6');
    expect(container.querySelectorAll('[data-testid="running-clock"]')[0].getAttribute('data-break')).toBeNull();
  });
});

describe('Cards do overview', () => {
  it('três cards (torneios ativos, fichários livres, chamados em aberto); sem card geral de fichas em jogo', async () => {
    await mount();
    const q = (id) => container.querySelector(`[data-testid="${id}"]`);
    expect(q('metric-tournaments').textContent).toContain('Torneios ativos');
    expect(q('metric-open-calls').textContent).toContain('Chamados em aberto');
    expect(q('metric-chips-in-play')).toBeNull();
    // fichas em jogo continuam POR TORNEIO e por sessão — o efetivamente em jogo
    expect(q('chips-by-tournament').textContent).toContain('Warm Up');
    expect(q('chips-by-tournament').textContent).toContain('300 fichas');
    expect(q('chips-by-tournament').textContent).toContain('Dia 1A');
    expect(q('chips-by-tournament').textContent).toContain('Dia 1B');
    for (const gone of ['Fichas nos Fichários', 'Valor em Fichários', 'Chip Races Hoje']) expect(container.textContent).not.toContain(gone);
    expect(q('free-binders')).toBeNull();
    await act(async () => { q('metric-free-binders').click(); });
    expect(q('free-binders').textContent).toContain('Clássica');
    expect(q('free-binders').textContent).toContain('T-1');
    await act(async () => { q('free-binders').querySelector('li button').click(); });
    expect(q('free-binders').textContent).toContain('100 × 1.000');
    await act(async () => { q('metric-free-binders').click(); });
    expect(q('free-binders')).toBeNull();
  });
});

describe.each(['admin', 'salao', 'material'])('Dashboard enxuto (%s)', (role) => {
  it('sem estoque geral, fichário × denominação, localização das fichas, reentradas, linha do tempo, feed nem tag de Chip Race', async () => {
    asRole(role);
    await mount();
    for (const id of ['chip-summary', 'in-play', 'timeline', 'binder-matrix', 'flows', 'reentries', 'conflicts']) expect(container.querySelector(`[data-testid="${id}"]`)).toBeNull();
    for (const gone of ['Feed de Atividades', 'Reentradas enviadas', 'Linha do tempo', 'Fichas por denominação', 'Onde estão as fichas']) expect(container.textContent).not.toContain(gone);
    expect(panel('occurrences')).toBeTruthy();
    expect(panel('requests').textContent).toContain('Chip Race · Warm Up · Dia 1A · ficha 100 · 4 mesa(s)');
    expect(container.querySelector('[data-testid="chips-by-tournament"]')).toBeTruthy();
    expect(container.textContent).toContain('Grade de Torneios');
  });
});

describe('Dashboard (alertas e ocorrências)', () => {
  it('ocorrências por semáforo e faixa de alertas (vermelhas, sem justificativa)', async () => {
    await mount();
    for (const [lvl, v] of [['RED', '1'], ['YELLOW', '0'], ['GREEN', '2']]) expect(panel('occurrences').querySelector(`[data-count="${lvl}"]`).textContent).toBe(v);
    expect(panel('occurrences').textContent).toContain('Faltam 4');
    const strip = panel('alert-strip');
    expect(strip.querySelector('[data-alert="red"]').textContent).toContain('1 ocorrência(s) vermelha(s)');
    expect(strip.querySelector('[data-alert="just"]').textContent).toContain('1 ocorrência(s) sem justificativa');
  });

  it('sem alertas a faixa some', async () => {
    payload.occurrences = { ...payload.occurrences, open_by_severity: { GREEN: 0, YELLOW: 0, RED: 0 }, pending_justification: 0 };
    await mount();
    expect(panel('alert-strip')).toBeFalsy();
  });

  it('não existe painel de KO (nem tipo de ficha): nada de KO no dashboard', async () => {
    await mount();
    expect(container.querySelector('[data-testid="ko-panel"]')).toBeFalsy();
    expect(container.textContent).not.toMatch(/\bKO\b/);
  });

  it('falha do servidor não quebra a tela', async () => {
    api.apiGet.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
    await mount();
    expect(container.textContent).toContain('Dashboard Overview');
  });
});

describe('atualização em tempo real POR BLOCO', () => {
  it('cada evento refaz só os blocos que ele afeta, juntando vários eventos numa chamada', async () => {
    await mount();
    const initial = statsCalls().length;
    expect(statsCalls()[0][1]).toBeUndefined(); // carga completa
    await fire('balancesChanged');
    const call = statsCalls().at(-1)[1];
    expect(statsCalls().length).toBe(initial + 1);
    expect(call.blocks.split(',').sort()).toEqual([...EVENT_BLOCKS.balancesChanged].sort());
    expect(call.blocks).not.toContain('flows');

    await act(async () => { sock.handlers.occurrenceOpened.forEach((f) => f({})); sock.handlers.occurrenceUpdated.forEach((f) => f({})); });
    await flush(320);
    expect(statsCalls().length).toBe(initial + 2);
    expect(statsCalls().at(-1)[1].blocks.split(',').sort()).toEqual([...new Set([...EVENT_BLOCKS.occurrenceOpened, ...EVENT_BLOCKS.occurrenceUpdated])].sort());
  });

  it('chamados e relógios por sessão têm eventos próprios; o painel muda na tela', async () => {
    await mount();
    expect(EVENT_BLOCKS.conversionRequestsChanged).toContain('requests');
    expect(EVENT_BLOCKS.tournamentsChanged).toContain('running_clocks');
    payload.requests = [];
    await fire('conversionRequestsChanged');
    expect(panel('requests').textContent).toContain('Nenhum chamado em aberto');
  });

  it('desmontar remove todas as assinaturas', async () => {
    await mount();
    act(() => root.unmount()); container.remove();
    for (const ev of Object.keys(EVENT_BLOCKS)) expect(sock.handlers[ev].size).toBe(0);
    await mount();
  });
});
