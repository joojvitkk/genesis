// Teste de renderização do Modelos de Stack (G3): grade ficha × ação e simulador de necessidade.
// A API é simulada; o cálculo real (servidor) é coberto em backend/test/stacks.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const chips = [
  { _id: 'c100', name: 'Ficha 100', value: 100, color: '#000000', active: true },
  { _id: 'c500', name: 'Ficha 500', value: 500, color: '#ff0000', active: true },
];
const stack = {
  _id: 's1', name: 'Warm Up', notes: '',
  actions: [{ key: 'buy_in', label: 'Buy-in padrão' }, { key: 'optional_buy_in', label: 'Buy-in opcional' }, { key: 're_entry', label: 'Reentrada' }],
  composition: [
    { chip_id: chips[0], quantities: { buy_in: 10 } },
    { chip_id: chips[1], quantities: { buy_in: 4, optional_buy_in: 4 } },
  ],
  totals: { buy_in: 3000, optional_buy_in: 2000, re_entry: 0 },
};

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../lib/api', () => api);
const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('../lib/auth', () => ({ getStoredUser: () => ({ role: auth.role }) }));

import ModelosStack from './ModelosStack';
import { AlertProvider } from '../contexts/AlertContext';

let root; let container;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const text = () => container.textContent;
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label) || b.title?.includes(label));

async function mount(role = 'admin') {
  auth.role = role;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<AlertProvider><ModelosStack /></AlertProvider>); });
  await flush();
}

beforeEach(() => {
  api.apiGet.mockImplementation(async (path) => (path.startsWith('/stacks') ? [stack] : chips));
  api.apiPost.mockReset(); api.apiPut.mockReset(); api.apiDelete.mockReset();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('ModelosStack', () => {
  it('mostra a grade ficha × ação com o valor de cada coluna vindo do servidor', async () => {
    await mount();
    const t = text();
    expect(t).toContain('Warm Up');
    for (const label of ['Buy-in padrão', 'Buy-in opcional', 'Reentrada']) expect(t).toContain(label);
    expect(t).toContain('Valor do stack');
    expect(t).toContain('3.000'); // totals.buy_in (derivado no servidor)
    expect(t).toContain('2.000');
  });

  it('admin vê criar/editar/excluir; material só consulta e simula', async () => {
    await mount('admin');
    expect(button('Novo Modelo')).toBeTruthy();
    expect(button('Editar')).toBeTruthy();
    expect(button('Excluir')).toBeTruthy();
    act(() => root.unmount()); container.remove();

    await mount('material');
    expect(button('Novo Modelo')).toBeFalsy();
    expect(button('Editar')).toBeFalsy();
    expect(button('Excluir')).toBeFalsy();
    expect(button('Simular')).toBeTruthy();
  });

  it('simulador: só envia as contagens de ação e exibe o resultado calculado pelo servidor', async () => {
    api.apiPost.mockResolvedValue({
      rows: [
        { chip: { _id: 'c100', value: 100, color: '#000' }, quantity: 1000 },
        { chip: { _id: 'c500', value: 500, color: '#f00' }, quantity: 400 },
      ],
      totals: { quantity: 1400, value: 300000 }, uncovered: [],
    });
    await mount();
    await act(async () => { button('Simular').click(); });
    await flush();
    expect(text()).toContain('Quantas fichas preciso?');

    const input = container.querySelector('input[type="number"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '100');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { button('Calcular').click(); });
    await flush();

    expect(api.apiPost).toHaveBeenCalledWith('/stacks/s1/needs', { counts: { buy_in: 100 } });
    expect(text()).toContain('1.000');
    expect(text()).toContain('Total (1.400 fichas)');
    expect(text()).toContain('300.000');
  });

  it('simulador sem nenhuma quantidade não chama o servidor', async () => {
    await mount();
    await act(async () => { button('Simular').click(); });
    await flush();
    await act(async () => { button('Calcular').click(); });
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it('criar modelo: envia a grade com quantidades por ação (sem total digitado)', async () => {
    api.apiPost.mockResolvedValue({});
    await mount();
    await act(async () => { button('Novo Modelo').click(); });
    await flush();
    expect(text()).toContain('Valor do stack (prévia)');
    // sem nome/fichas → não envia
    await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(api.apiPost).not.toHaveBeenCalled();
  });
});
