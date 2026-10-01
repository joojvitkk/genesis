// Dashboard (G10): "onde estão as fichas / o que acontece agora" sobre os movimentos; KO (G9); atualização por bloco.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('../lib/api', () => api);
const sock = vi.hoisted(() => { const h = {}; return { handlers: h, socket: { on: (e, f) => { (h[e] ||= new Set()).add(f); }, off: (e, f) => h[e]?.delete(f) } }; });
vi.mock('../lib/socket', () => ({ socket: sock.socket }));

import Dashboard from './Dashboard';
import { EVENT_BLOCKS } from '../lib/useDashboard';

const c100 = { _id: 'c100', name: 'Ficha 100', value: 100, color: '#000' };
const c500 = { _id: 'c500', name: 'Ficha 500', value: 500, color: '#f00' };
const full = () => ({
  metrics: { activeTournamentsCount: 1, totalChipsInStock: 1200, stockValue: 150000, chipsInPlay: 300, valueInPlay: 40000, availableCases: 2, chipRacesToday: 1 },
  recentTournaments: [{ _id: 't1', name: 'Warm Up', status: 'running', start_time: '20:00' }],
  recentActivities: [],
  inventory: {
    rows: [
      { chip: c100, in_binders: 1000, reserved: 200, free: 800, in_play: 250, lost: 3, settled: 0 },
      { chip: c500, in_binders: 200, reserved: 0, free: 200, in_play: 50, lost: 0, settled: 0 },
    ],
    totals: { in_binders: 1200, reserved: 200, free: 1000, in_play: 300, lost: 3, settled: 0 },
    matrix: { chips: [c100, c500], rows: [{ binder: { _id: 'b1', name: 'LISA A' }, cells: { c100: 900, c500: 200 }, total: 1100, value: 190000 }, { binder: { _id: 'b2', name: 'LISA B' }, cells: { c100: 100 }, total: 100, value: 10000 }] },
  },
  in_play: { rows: [{ tournament: { _id: 't1', name: 'Warm Up' }, quantity: 300, value: 75000, chips: [{ chip: c100, quantity: 250 }, { chip: c500, quantity: 50 }], sessions: [{ session: { _id: 's1', name: 'Dia 1A' }, quantity: 200, value: 50000 }, { session: { _id: 's2', name: 'Dia 1B' }, quantity: 100, value: 25000 }, { session: null, quantity: 0, value: 0 }] }], totals: { quantity: 300, value: 75000 } },
  flows: {
    sent: { quantity: 330, value: 51000 }, returned: { quantity: 10, value: 1000 }, discarded: { quantity: 5, value: 500 }, chip_race: { out: { quantity: 5, value: 500 }, in: { quantity: 2, value: 1000 }, count: 1, math_breakage: 500 }, color_up: { out: { quantity: 0, value: 0 }, in: { quantity: 0, value: 0 }, count: 0, math_breakage: 0 },
    lost: { quantity: 5, value: 900 }, found: { quantity: 0, value: 0 }, recovered: { quantity: 1, value: 100 },
  },
  occurrences: { open_by_severity: { GREEN: 2, YELLOW: 0, RED: 1 }, open_total: 3, pending_justification: 1, recovered: { occurrences: 1, quantity: 1 }, missing_quantity: 4 },
  conflicts: [],
  timeline: [{ _id: 'm1', type: 'SEND_ADDITIONAL', quantity: 100, chip_id: c100, tournament_id: { name: 'Warm Up' }, binder_id: { name: 'LISA A' }, createdAt: '2026-10-01T20:00:00Z', user_name: 'Ana' }],
  binders: { total: 3, free: 2, allocated: 1 },
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

beforeEach(() => {
  payload = full();
  api.apiGet.mockReset();
  api.apiGet.mockImplementation(async (path, params) => {
    if (path !== '/dashboard/stats') return [];
    if (!params?.blocks) return payload;
    return Object.fromEntries(params.blocks.split(',').map((b) => [b, payload[b]]));
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Dashboard (G10)', () => {
  it('responde "onde estão as fichas": por denominação (fichários, reservado, livre, em jogo, divergência)', async () => {
    await mount();
    const t = panel('chip-summary').textContent;
    for (const h of ['Em fichários', 'Reservado', 'Livre', 'Em jogo', 'Divergência']) expect(t).toContain(h);
    const row = panel('chip-summary').querySelector('tbody tr').textContent;
    expect(row).toContain('1.000');
    expect(row).toContain('800');
    expect(row).toContain('250');
    expect(panel('chip-summary').querySelector('tfoot').textContent).toContain('1.200');
  });

  it('matriz fichário × denominação com totais; células vazias aparecem como traço', async () => {
    await mount();
    const rows = panel('binder-matrix').querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('LISA A');
    expect(rows[0].textContent).toContain('900');
    expect(rows[1].textContent).toContain('—');
    expect(rows[1].textContent).toContain('10.000');
  });

  it('em jogo: por torneio, com as fichas e as sessões (a sessão nula não aparece)', async () => {
    await mount();
    const t = panel('in-play').textContent;
    expect(t).toContain('Warm Up');
    expect(t).toContain('300 fichas');
    expect(t).toContain('100 × 250');
    expect(t).toContain('Dia 1A: 200');
    expect(t).toContain('Dia 1B: 100');
    expect(t).not.toContain('null');
  });

  it('"o que acontece agora": fluxos (enviadas/devolvidas/descartadas/perdidas/recuperadas) e chip race com a quebra', async () => {
    await mount();
    const flow = (label) => panel('flows').querySelector(`[data-flow="${label}"]`).textContent;
    expect(flow('Enviadas')).toContain('330');
    expect(flow('Devolvidas')).toContain('10');
    expect(flow('Descartadas')).toContain('500');
    expect(flow('Perdidas')).toContain('5');
    expect(flow('Recuperadas')).toContain('1');
    expect(flow('Chip race')).toContain('quebra matemática 500');
    expect(flow('Chip race')).toContain('não é perda');
  });

  it('ocorrências por semáforo, faixa de alertas (vermelhas, sem justificativa) e linha do tempo', async () => {
    await mount();
    for (const [lvl, v] of [['RED', '1'], ['YELLOW', '0'], ['GREEN', '2']]) expect(panel('occurrences').querySelector(`[data-count="${lvl}"]`).textContent).toBe(v);
    expect(panel('occurrences').textContent).toContain('Faltam 4');
    const strip = panel('alert-strip');
    expect(strip.querySelector('[data-alert="red"]').textContent).toContain('1 ocorrência(s) vermelha(s)');
    expect(strip.querySelector('[data-alert="just"]').textContent).toContain('1 ocorrência(s) sem justificativa');
    expect(strip.querySelector('[data-alert="conf"]')).toBeFalsy();
    expect(panel('timeline').textContent).toContain('Envio · 100 × 100 · Warm Up · LISA A');
    expect(container.textContent).toContain('Onde estão as fichas?');
    expect(container.textContent).toContain('O que acontece agora?');
  });

  it('sem alertas a faixa some; conflitos de alocação aparecem', async () => {
    payload.occurrences = { ...payload.occurrences, open_by_severity: { GREEN: 0, YELLOW: 0, RED: 0 }, pending_justification: 0 };
    await mount();
    expect(panel('alert-strip')).toBeFalsy();
    act(() => root.unmount()); container.remove();

    payload.conflicts = [{ allocation_id: 'a1', binder: { name: 'LISA A' }, tournament: { name: 'Warm Up' }, chips: [{ chip: c100, shortfall: 710, balance: 10 }] }];
    await mount();
    expect(panel('conflicts').textContent).toContain('faltam 710 de 100');
    expect(panel('alert-strip').querySelector('[data-alert="conf"]').textContent).toContain('1 alocação(ões)');
  });

  it('não existe painel de KO (nem tipo de ficha): nada de KO no dashboard', async () => {
    await mount();
    expect(container.querySelector('[data-testid="ko-panel"]')).toBeFalsy();
    expect(container.textContent).not.toMatch(/\bKO\b/);
  });

  it('as métricas vêm do movimento (fichas nos fichários e em jogo); falha do servidor não quebra', async () => {
    await mount();
    expect(container.textContent).toContain('Fichas nos Fichários');
    expect(container.textContent).toContain('1.200');
    expect(container.textContent).toContain('Fichas em Jogo');
    act(() => root.unmount()); container.remove();
    api.apiGet.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
    await mount();
    expect(container.textContent).toContain('Dashboard Overview');
    expect(panel('chip-summary')).toBeTruthy();
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
    expect(call.blocks).not.toContain('ko');

    await act(async () => { sock.handlers.occurrenceOpened.forEach((f) => f({})); sock.handlers.occurrenceUpdated.forEach((f) => f({})); });
    await flush(320);
    expect(statsCalls().length).toBe(initial + 2);
    expect(statsCalls().at(-1)[1].blocks.split(',').sort()).toEqual([...new Set([...EVENT_BLOCKS.occurrenceOpened, ...EVENT_BLOCKS.occurrenceUpdated])].sort());
  });

  it('movementsPosted atualiza estoque, em jogo, fluxos e linha do tempo; o painel muda na tela', async () => {
    await mount();
    expect(EVENT_BLOCKS.movementsPosted).toEqual(expect.arrayContaining(['inventory', 'in_play', 'flows', 'timeline', 'metrics']));
    payload.flows = { ...payload.flows, discarded: { quantity: 99, value: 9900 } };
    await fire('movementsPosted');
    expect(panel('flows').querySelector('[data-flow="Descartadas"]').textContent).toContain('99');
    expect(panel('chip-summary')).toBeTruthy();
  });

  it('desmontar remove todas as assinaturas', async () => {
    await mount();
    act(() => root.unmount()); container.remove();
    for (const ev of Object.keys(EVENT_BLOCKS)) expect(sock.handlers[ev].size).toBe(0);
    await mount();
  });
});
