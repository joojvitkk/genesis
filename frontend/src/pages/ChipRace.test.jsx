// Chip Race / Color Up (G6): a tela lança retirado/colocado; VALORES e QUEBRA vêm do servidor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../lib/api', () => api);
const auth = vi.hoisted(() => ({ role: 'material' }));
vi.mock('../lib/auth', () => ({ getStoredUser: () => ({ role: auth.role }) }));

import ChipRace from './ChipRace';
import { AlertProvider } from '../contexts/AlertContext';

const c100 = { _id: 'c100', name: 'Ficha 100', value: 100, color: '#000' };
const c500 = { _id: 'c500', name: 'Ficha 500', value: 500, color: '#f00' };
const data = {
  '/tournaments': [{ _id: 't1', name: 'Warm Up', status: 'running' }, { _id: 't0', name: 'Encerrado', status: 'finished' }],
  '/chips': [c100, c500],
  '/tournaments/t1/sessions': [{ _id: 's1', name: 'Dia Único', status: 'running' }],
  '/allocations': [{ _id: 'a1', binder_id: { _id: 'b1', name: 'LISA 1' }, chips: [{ chip_id: c500, remaining: 300 }, { chip_id: c100, remaining: 0 }] }],
  '/tournaments/t1/material': { rows: [{ chip: c100, on_table: 2000, in_play: 2000 }, { chip: c500, on_table: 0, in_play: 0 }] },
  '/conversions': [
    { _id: 'v1', type: 'CHIP_RACE', status: 'active', outs: [{ chip_id: c100, quantity: 100 }], ins: [{ chip_id: c500, quantity: 20 }], value_out: 10000, value_in: 10000, math_breakage: 0, createdAt: '2026-10-01T12:00:00Z', user_name: 'Maria', binder_id: { name: 'LISA 1' } },
    { _id: 'v2', type: 'COLOR_UP', status: 'reversed', reverse_reason: 'erro', outs: [{ chip_id: c100, quantity: 50 }], ins: [{ chip_id: c500, quantity: 10 }], value_out: 5000, value_in: 5500, math_breakage: 500, createdAt: '2026-10-01T13:00:00Z', user_name: 'João' },
    { _id: 'v3', type: 'CHIP_RACE', status: 'active', legacy: true, outs: [{ chip_id: c100, quantity: 5 }], ins: [{ chip_id: c500, quantity: 1 }], value_out: 500, value_in: 500, math_breakage: 0, createdAt: '2026-09-01T12:00:00Z', user_name: 'Migração G6' },
  ],
};

let root; let container;
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label) || b.title?.includes(label));
const setValue = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
// linhas em ordem de valor: [0] = ficha 100 (Retirado, Colocado), [1] = ficha 500
const outInput = (i) => container.querySelectorAll('tbody tr')[i].querySelectorAll('input')[0];
const inInput = (i) => container.querySelectorAll('tbody tr')[i].querySelectorAll('input')[1];

async function mount(role = 'material') {
  auth.role = role;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<AlertProvider><ChipRace /></AlertProvider>); });
  await flush(60);
}

beforeEach(() => {
  api.apiGet.mockReset(); api.apiPost.mockReset();
  api.apiGet.mockImplementation(async (path) => data[path] ?? []);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Chip Race / Color Up', () => {
  it('escolhe o torneio em andamento e mostra em jogo × reservado por ficha', async () => {
    await mount();
    const t = container.textContent;
    expect(t).toContain('Warm Up');
    expect(t).not.toContain('Encerrado · ');
    expect(t).toContain('2.000');            // em jogo: 100
    expect(t).toContain('300');              // reservado para colocar: 500
    expect(container.textContent).toContain('não é perda física');
  });

  it('só habilita Retirado onde há fichas em jogo e Colocado onde há reserva', async () => {
    await mount();
    expect(outInput(0).disabled).toBe(false);   // 100 tem 2.000 em jogo
    expect(inInput(0).disabled).toBe(true);     // 100 não tem reserva
    expect(outInput(1).disabled).toBe(true);    // 500 não tem nada em jogo
    expect(inInput(1).disabled).toBe(false);    // 500 tem 300 reservadas
  });

  it('valores e quebra exibidos são os do SERVIDOR (não uma conta local)', async () => {
    // valores propositalmente diferentes da conta real: se a tela calculasse sozinha, não apareceriam
    api.apiPost.mockImplementation(async (path) => (path === '/conversions/preview' ? { value_out: 777, value_in: 888, math_breakage: 111 } : {}));
    await mount();
    await act(async () => { setValue(outInput(0), '1030'); });
    await act(async () => { setValue(inInput(1), '207'); });
    await flush(400); // debounce da prévia

    expect(api.apiPost).toHaveBeenCalledWith('/conversions/preview', { outs: [{ chip_id: 'c100', quantity: 1030 }], ins: [{ chip_id: 'c500', quantity: 207 }] });
    const t = container.textContent;
    expect(t).toContain('777'); expect(t).toContain('888'); expect(t).toContain('+111');
  });

  it('sem os dois lados preenchidos não pede prévia nem registra', async () => {
    await mount();
    await act(async () => { setValue(outInput(0), '10'); });
    await flush(400);
    expect(api.apiPost).not.toHaveBeenCalled();
    await act(async () => { button('Registrar Chip Race').click(); });
    await flush();
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it('registra: confirma e envia tipo, torneio, sessão e as linhas ao servidor', async () => {
    api.apiPost.mockImplementation(async (path) => (path === '/conversions/preview' ? { value_out: 103000, value_in: 103500, math_breakage: 500 } : {}));
    await mount();
    await act(async () => { button('Color Up').click(); });
    await act(async () => { setValue(outInput(0), '1030'); });
    await act(async () => { setValue(inInput(1), '207'); });
    await flush(400);
    await act(async () => { button('Registrar Color Up').click(); });
    await flush();
    expect(container.textContent).toContain('quebra matemática +500'); // o resumo da confirmação usa a prévia do servidor
    await act(async () => { button('Confirmar').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/conversions', {
      tournament_id: 't1', type: 'COLOR_UP', session_id: 's1', binder_id: 'b1',
      outs: [{ chip_id: 'c100', quantity: 1030 }], ins: [{ chip_id: 'c500', quantity: 207 }], note: undefined,
    });
  });

  it('o salão só consulta: campos desabilitados e sem botão de registrar', async () => {
    await mount('salao');
    expect(outInput(0).disabled).toBe(true);
    expect(button('Registrar Chip Race')).toBeFalsy();
    expect(container.textContent).toContain('Somente consulta');
  });

  it('histórico: modelo anterior e estornada sinalizados; só o admin estorna, e só a ativa do modelo novo', async () => {
    await mount('material');
    expect(container.textContent).toContain('modelo anterior');
    expect(container.textContent).toContain('estornada');
    expect(container.textContent).toContain('quebra +500');
    expect(button('Estornar')).toBeFalsy();
    act(() => root.unmount()); container.remove();

    await mount('admin');
    expect([...container.querySelectorAll('button')].filter((b) => b.title === 'Estornar')).toHaveLength(1);
  });

  it('erro do servidor no registro é exibido e nada é limpo', async () => {
    api.apiPost.mockImplementation(async (path) => {
      if (path === '/conversions/preview') return { value_out: 1, value_in: 2, math_breakage: 1 };
      throw Object.assign(new Error('Saldo insuficiente: jogo no torneio "Warm Up" tem 2000'), { status: 409 });
    });
    await mount();
    await act(async () => { setValue(outInput(0), '9999'); });
    await act(async () => { setValue(inInput(1), '1'); });
    await flush(400);
    await act(async () => { button('Registrar Chip Race').click(); });
    await flush();
    await act(async () => { button('Confirmar').click(); });
    await flush();
    expect(container.textContent).toContain('tem 2000');
    expect(outInput(0).value).toBe('9999');
  });
});
