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
  metrics: { activeTournamentsCount: 1, totalChipsInStock: 1200, stockValue: 150000, chipsInPlay: 300, valueInPlay: 40000, availableCases: 2, chipRacesToday: 1 },
  recentTournaments: [{ _id: 't1', name: 'Warm Up', status: 'running', start_time: '20:00' }],
  recentActivities: [],
  free_binders: [{ _id: 'b1', name: 'Clássica', code: null, stamp: 'Dragão', chips: 1000 }, { _id: 'b2', name: 'TESTE', code: 'T-1', stamp: null, chips: 10 }],
  tournament_chips: { rows: [{ tournament: { _id: 't1', name: 'Warm Up' }, quantity: 300, value: 75000, chips: [{ chip: c100, quantity: 250 }, { chip: c500, quantity: 50 }] }, { tournament: { _id: 't2', name: 'High Roller' }, quantity: 40, value: 20000, chips: [{ chip: c500, quantity: 40 }] }], totals: { quantity: 340, value: 95000 } },
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

const asRole = (role) => localStorage.setItem('genesis_user', JSON.stringify({ role }));
beforeEach(() => {
  asRole('admin'); // painel completo; Salão/Material veem o painel enxuto
  payload = full();
  api.apiGet.mockReset();
  api.apiGet.mockImplementation(async (path, params) => {
    if (/\/tournaments\/t1\/clock$/.test(path)) return { tournament_id: 't1', clock_status: 'stopped', level: { row_type: 'level', small_blind: 100, big_blind: 200 }, level_number: 1, remaining_ms: 1800000, server_time: Date.now(), actual_players: 300 };
    if (path !== '/dashboard/stats') return [];
    if (!params?.blocks) return payload;
    return Object.fromEntries(params.blocks.split(',').map((b) => [b, payload[b]]));
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Relógios dos torneios em andamento', () => {
  it('lista os torneios rodando com relógio; em intervalo o cartão muda de cor', async () => {
    await mount();
    const cards = container.querySelectorAll('[data-testid="running-clock"]');
    expect(cards.length).toBe(2);
    expect(container.querySelector('[data-testid="running-clocks"]').textContent).toContain('Warm Up');
    expect(container.querySelectorAll('[data-break="true"]').length).toBe(0);
    // parado: o estado inicial vem por REST (não fica 00:00 esperando o socket)
    const first = container.querySelectorAll('[data-testid="running-clock"]')[0];
    expect(first.textContent).toContain('30:00');
    expect(first.textContent).toContain('Nível 1');
    // chega um pulso do servidor: Warm Up em intervalo (volta no nível 6)
    await act(async () => {
      (sock.handlers.tournamentClock || new Set()).forEach((f) => f({
        tournament_id: 't1', clock_status: 'running', is_break: true, level: { row_type: 'break', label: 'Break 15 min' }, level_number: null,
        next_play_level: { level_number: 6, small_blind: 400, big_blind: 800 }, remaining_ms: 600000, server_time: Date.now(), actual_players: 300,
      }));
    });
    const brk = container.querySelectorAll('[data-break="true"]');
    expect(brk.length).toBe(1);
    expect(brk[0].textContent).toContain('Intervalo');
    expect(brk[0].textContent).toContain('Nível 6');
    expect(brk[0].textContent).toContain('10:00');
  });
});

describe('Cards do overview', () => {
  it('só três cards: torneios ativos, fichários livres (clique lista quais) e fichas em jogo total e por torneio', async () => {
    await mount();
    const q = (id) => container.querySelector(`[data-testid="${id}"]`);
    expect(q('metric-tournaments').textContent).toContain('Torneios ativos');
    expect(q('metric-chips-in-play').textContent).toContain('340');
    expect(q('chips-by-tournament').textContent).toContain('Warm Up');
    expect(q('chips-by-tournament').textContent).toContain('300 fichas');
    for (const gone of ['Fichas nos Fichários', 'Valor em Fichários', 'Chip Races Hoje']) expect(container.textContent).not.toContain(gone);
    // os painéis abaixo dos cards continuam
    expect(q('chip-summary')).toBeTruthy(); expect(q('timeline')).toBeTruthy(); expect(q('occurrences')).toBeTruthy();
    expect(q('free-binders')).toBeNull();
    await act(async () => { q('metric-free-binders').click(); });
    expect(q('free-binders').textContent).toContain('Clássica');
    expect(q('free-binders').textContent).toContain('T-1');
    await act(async () => { q('metric-free-binders').click(); });
    expect(q('free-binders')).toBeNull();
  });
});

describe('Dashboard enxuto (Salão/Material)', () => {
  it.each(['salao', 'material'])('%s: sem denominações, linha do tempo, feed nem detalhamento de fichários; mantém cards, ocorrências, Chip Race e reentradas', async (role) => {
    asRole(role);
    payload = {
      ...full(),
      requests: [{ _id: 'q1', type: 'CHIP_RACE', status: 'requested', tables: 4, tournament_id: { name: 'Warm Up' } }],
      reentries: [{ tournament: { _id: 't1', name: 'Warm Up' }, stacks_available: 90, label: 'Reentrada', composition: [{ chip: c500, quantity: 2 }] }],
    };
    await mount();
    for (const id of ['chip-summary', 'in-play', 'timeline', 'binder-matrix', 'flows']) expect(container.querySelector(`[data-testid="${id}"]`)).toBeNull();
    expect(container.textContent).not.toContain('Feed de Atividades');
    expect(panel('occurrences')).toBeTruthy();
    expect(panel('requests').textContent).toContain('Chip Race · Warm Up · 4 mesa(s)');
    expect(panel('reentries').textContent).toContain('90 stacks disponíveis'.replace('stacks disponíveis', 'stack(s) disponível(is)'));
    expect(container.querySelector('[data-testid="chips-by-tournament"]')).toBeTruthy();
  });
});

describe('Dashboard (G10)', () => {
  it('responde "onde estão as fichas": por denominação (fichários, reservado, livre, em jogo, divergência)', async () => {
    await mount();
    const t = panel('chip-summary').textContent;
    for (const h of ['Em fichários', 'Reservado', 'Livre', 'No Salão', 'Divergência']) expect(t).toContain(h);
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

  it('os cards vêm dos blocos do servidor (torneios ativos, fichários livres, fichas em jogo); falha do servidor não quebra', async () => {
    await mount();
    expect(container.textContent).toContain('Torneios ativos');
    expect(container.textContent).toContain('Fichários livres');
    expect(container.textContent).toContain('Fichas em jogo');
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
