// Salão de um toque (item 10) + escolha explícita de sessão (item 9) + painel "Salão agora".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), newOpId: vi.fn() }));
vi.mock('../lib/api', () => api);
vi.mock('../lib/socket', () => ({ socket: { on: () => {}, off: () => {}, emit: () => {}, connected: true }, connectSocket: () => {}, trackRoom: () => () => {} }));
vi.mock('../lib/auth', () => ({ getStoredUser: () => ({ id: 'u1', role: 'salao' }), getToken: () => 't' }));
const clock = vi.hoisted(() => ({ value: { entries_total: 133, actual_players: 120, level_number: 4, remainingMs: 600000, clock_status: 'running', is_break: false } }));
vi.mock('../hooks/useTournamentClock', () => ({ useTournamentClock: () => clock.value, formatClock: (ms) => `${Math.floor(ms / 60000)}:00` }));

import SalaoSessao from './SalaoSessao';
import SalaoAgora from '../components/SalaoAgora';
import { AlertProvider } from '../contexts/AlertContext';

let root; let container;
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const btn = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const mount = async (path = '/salao-sessao/t1/s1b') => {
  await act(async () => {
    root.render(<AlertProvider><MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/salao-sessao/:tid/:sid" element={<SalaoSessao />} />
      <Route path="/salao" element={<SalaoAgora />} />
    </Routes></MemoryRouter></AlertProvider>);
  });
  await flush();
};

beforeEach(() => {
  let n = 0;
  api.newOpId.mockImplementation(() => `op-test-${++n}-xxxxxxxx`);
  api.apiGet.mockImplementation((url) => Promise.resolve(
    url === '/tournaments/t1' ? { _id: 't1', name: 'Main Event Light', number: 3 }
      : url === '/tournaments/t1/sessions' ? [{ _id: 's1a', name: 'Dia 1A', status: 'running' }, { _id: 's1b', name: 'Dia 1B', status: 'running', type: 'QUALIFIER' }]
        : url === '/salao/now' ? [
          { tournament_id: 't1', tournament_name: 'Warm Up', tournament_number: 1, session_id: 's1a', session_name: 'Dia 1A', clock_status: 'running', remaining_ms: 60000, server_time: Date.now(), level_number: 2, entries_total: 10, playing: 9, variant: 'TURBO' },
          { tournament_id: 't2', tournament_name: 'Warm Up', tournament_number: 2, session_id: 's2', session_name: 'Dia 1A', clock_status: 'running', remaining_ms: 60000, server_time: Date.now(), level_number: 5, entries_total: 30, playing: 25, variant: 'HYPER' },
        ] : {},
  ));
  api.apiPost.mockResolvedValue({ _id: 'e1', number: 134 });
  api.apiPut.mockResolvedValue({ active: 118 });
  sessionStorage.clear();
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

describe('Salão de um toque', () => {
  it('mostra torneio e sessão em destaque, contadores e envia SEMPRE o session_id com uma Idempotency-Key', async () => {
    await mount();
    expect(container.textContent).toContain('Main Event Light');
    expect(container.querySelector('[data-testid="session-badge"]').textContent).toContain('Dia 1B');
    expect(container.querySelector('[data-testid="c-entries"]').textContent).toBe('133');
    await act(async () => { btn('+1 entrada').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/entries', { type: 'buy-in', quantity: 1, session_id: 's1b' }, { idempotencyKey: 'op-test-1-xxxxxxxx' });
    expect(container.querySelector('[data-testid="toast"]').textContent).toContain('Entrada #134 registrada · Dia 1B');
  });

  it('toque duplo NÃO gera dois lançamentos (travado enquanto o primeiro está em curso)', async () => {
    let release; api.apiPost.mockImplementation(() => new Promise((r) => { release = () => r({ _id: 'e1', number: 1 }); }));
    await mount();
    const b = btn('+1 entrada');
    await act(async () => { b.click(); b.click(); b.click(); });
    expect(api.apiPost).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    await flush();
    expect(btn('+1 entrada').disabled).toBe(false);
  });

  it('lote, reentrada e eliminação: payloads por sessão; desfazer imediato cancela sem pedir motivo', async () => {
    api.apiPost.mockImplementation((url) => Promise.resolve(url.endsWith('/eliminations') ? { ok: true, elimination_id: 'x1', position: 7 } : { _id: 'e9', number: 9 }));
    await mount();
    const input = container.querySelector('input[aria-label="Quantidade em lote"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '5'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { btn('+5 reentrada').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/entries', { type: 're-entry', quantity: 5, session_id: 's1b' }, expect.any(Object));
    await act(async () => { btn('−1 eliminação').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/eliminations', { session_id: 's1b' }, expect.any(Object));
    expect(container.textContent).toContain('Eliminação registrada (posição 7)');
    await act(async () => { btn('Desfazer').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenLastCalledWith('/tournaments/t1/eliminations/x1/cancel', { reason: 'Desfeito logo após o lançamento' }, expect.any(Object));
  });

  it('conferir jogando envia a contagem real da sessão (PUT active-players)', async () => {
    await mount();
    const input = container.querySelector('input[aria-label="Contagem real de jogadores"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '118'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { btn('Conferir').click(); });
    await flush();
    expect(api.apiPut).toHaveBeenCalledWith('/tournaments/t1/active-players', { active_players: 118, session_id: 's1b' }, expect.any(Object));
  });

  it('botões principais têm alvo de toque ≥ 44 px (min-h) e ficam na barra inferior', async () => {
    await mount();
    const bar = container.querySelector('[data-testid="primary-actions"]');
    expect(bar.className).toContain('fixed');
    for (const b of bar.querySelectorAll('button')) expect(b.className).toMatch(/min-h-\[(56|44)px\]/);
  });

  it('sessão escolhida no painel ≠ sessão da tela → pede confirmação antes de gravar; recusar não grava', async () => {
    sessionStorage.setItem('genesis:salao:chosen', 's1a');
    await mount('/salao-sessao/t1/s1b');
    await act(async () => { btn('+1 entrada').click(); });
    await flush();
    expect(container.textContent).toContain('Você escolheu outra sessão no painel');
    expect(api.apiPost).not.toHaveBeenCalled();
  });
});

describe('Salão agora', () => {
  it('lista as sessões de torneios parecidos com nº, tipo e etiqueta própria, e abre a sessão escolhida', async () => {
    await mount('/salao');
    const cards = [...container.querySelectorAll('[data-testid="agora-card"]')];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain('#01 Warm Up'); expect(cards[0].textContent).toContain('TURBO');
    expect(cards[1].textContent).toContain('#02 Warm Up'); expect(cards[1].textContent).toContain('HYPER');
    expect(cards[0].getAttribute('href')).toBe('/salao-sessao/t1/s1a');
    expect(cards[1].getAttribute('href')).toBe('/salao-sessao/t2/s2');
    await act(async () => { cards[1].click(); });
    expect(sessionStorage.getItem('genesis:salao:chosen')).toBe('s2');
  });
});
