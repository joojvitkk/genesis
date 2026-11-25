// Chip Race / Color Up (G6): a tela lança retirado/colocado; VALORES e QUEBRA vêm do servidor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
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
  '/tournaments/t1/sessions': [{ _id: 's1', name: 'Dia Único', status: 'running', players: { active: 40 } }],
  '/tournaments/t1/material': {
    rows: [{ chip: c100, on_table: 2000, in_play: 2000 }, { chip: c500, on_table: 500, in_play: 0 }],
    binders: [{ binder: { _id: 'b1', name: 'LISA 1' }, balances: { c500: 300 } }],
  },
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
  api.apiGet.mockReset(); api.apiPost.mockReset(); api.apiPut.mockReset(); api.apiPut.mockResolvedValue({});
  api.apiGet.mockImplementation(async (path) => data[path] ?? []);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Chip Race / Color Up', () => {
  it('tabela única Ficha | Em jogo | Saída | Entrada, só com as denominações usadas, sem textos explicativos', async () => {
    await mount();
    const t = container.textContent;
    expect(t).toContain('Warm Up');
    expect(t).not.toContain('Encerrado · ');
    expect(t).toContain('2.000');            // em jogo: 100
    const heads = [...container.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(heads).toEqual(['Ficha', 'Em jogo', 'Saída', 'Entrada']);
    expect(t).not.toContain('não é perda física');
    expect(t).not.toContain('Ficha(s) a retirar');
    expect(container.querySelectorAll('[role="group"] button[aria-pressed]')).toHaveLength(0);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2); // 100 e 500; sem 100.000/250.000…
  });

  it('o saldo físico do fichário fica nos detalhes', async () => {
    await mount();
    const det = container.querySelector('details');
    expect(det.textContent).toContain('saldo do fichário');
    expect(det.textContent).toContain('300');
  });

  it('Saída só habilita onde há fichas em jogo', async () => {
    await mount();
    expect(outInput(0).disabled).toBe(false);   // 100 tem 2.000 em jogo
    expect(outInput(1).disabled).toBe(false);   // 500 está no salão
    expect(container.querySelector('[aria-label="Saída 100"]')).toBeTruthy();
  });

  it('método das mesas: escolhe a ficha que sai, a que entra e as mesas; a Entrada vem preenchida pelo servidor', async () => {
    api.apiPost.mockImplementation(async (path) => {
      if (path === '/conversions/plan') return { chip_out: { _id: 'c100', in_play: 1000, value_in_play: 100000 }, chip_in: { _id: 'c500', value: 500 }, tables: 36, per_table_value: 3000, per_table_quantity: 6, quantity_in: 216, value_in: 108000 };
      return { value_out: 100000, value_in: 108000, math_breakage: 8000 };
    });
    await mount();
    const pickFromSelect = async (id, label) => {
      await act(async () => { container.querySelector(`#${id}`).click(); });
      const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.trim() === label);
      await act(async () => { opt.click(); });
    };
    await pickFromSelect('cr-out', '100'); await pickFromSelect('cr-in', '500');
    await act(async () => { setValue(container.querySelector('#cr-tables'), '36'); });
    await flush(400);
    expect(api.apiPost).toHaveBeenCalledWith('/conversions/plan', { tournament_id: 't1', session_id: 's1', chip_out_id: 'c100', chip_in_id: 'c500', tables: 36 });
    expect(container.querySelector('[data-testid="table-plan"]').textContent).toContain('3.000 por mesa');
    expect(inInput(1).value).toBe('216');
    expect(outInput(0).value).toBe('1000');
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

describe('Chip Race / Color Up — por sessão e chamados', () => {
  const call = (over = {}) => ({ _id: 'r1', type: 'CHIP_RACE', status: 'in_preparation', tables: 4, chip_id: c100, session_id: { _id: 's1', name: 'Dia Único' }, tournament_id: { _id: 't1' }, snapshot: { active_players: 40, in_play_quantity: 2000 }, estimate: { players_per_table: 10, per_table: [{ value: 100, per_table: 500 }] }, requested_by: 'Ana', createdAt: '2026-10-01T12:00:00Z', ...over });

  it('com chamado selecionado traz jogadores ativos da SESSÃO e as mesas do chamado', async () => {
    data['/conversion-requests'] = [call()];
    await mount();
    await act(async () => { button('Registrar a troca deste chamado').click(); });
    // o chamado sugere a ficha que sai e as mesas; a ficha que entra é do Material
    const base = container.querySelector('[data-testid="session-base"]').textContent;
    expect(base).toContain('Dia Único'); expect(base).toContain('40 jogando');
    expect(container.querySelector('#cr-tables').value).toBe('4');
    delete data['/conversion-requests'];
  });

  it('um chamado cancelado deixa de estar vinculado: a próxima troca não leva o id antigo', async () => {
    data['/conversion-requests'] = [call()];
    api.apiPost.mockImplementation(async (path) => (path === '/conversions/preview' ? { value_out: 1, value_in: 2, math_breakage: 1 } : {}));
    await mount();
    await act(async () => { button('Registrar a troca deste chamado').click(); });
    // cancela pela tela (com confirmação): o servidor passa a devolver o chamado como cancelado
    data['/conversion-requests'] = [call({ status: 'cancelled' })];
    await act(async () => { button('Cancelar chamado').click(); });
    await flush();
    await act(async () => { button('Confirmar').click(); });
    await flush();
    expect(api.apiPut).toHaveBeenCalledWith('/conversion-requests/r1', { status: 'cancelled' });
    await act(async () => { setValue(outInput(0), '10'); });
    await act(async () => { setValue(inInput(1), '1'); });
    await flush(400);
    await act(async () => { button('Registrar Chip Race').click(); });
    await flush();
    await act(async () => { button('Confirmar').click(); });
    await flush();
    const body = api.apiPost.mock.calls.find((c) => c[0] === '/conversions')?.[1];
    expect(body).toBeTruthy();
    expect(body.request_id).toBeUndefined();
    delete data['/conversion-requests'];
  });
});
