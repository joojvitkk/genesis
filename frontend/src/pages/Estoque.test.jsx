// Estoque (G10): a tabela de fichas mostra o saldo DERIVADO (GET /inventory/by-chip), não o cache da ficha.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../lib/api', () => api);
const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('../lib/auth', () => ({ getStoredUser: () => ({ role: auth.role }), getToken: () => 't' }));

import Estoque from './Estoque';
import { AlertProvider } from '../contexts/AlertContext';

// as fichas trazem números LEGADOS absurdos de propósito: a tela não pode usá-los
const chips = [
  { _id: 'c100', name: 'Ficha 100', value: 100, color: '#000000', kind: 'TOURNAMENT', active: true, total_quantity: 999999, reserved_quantity: 888888, available_quantity: 777777 },
  { _id: 'c5', name: 'Ficha 5', value: 5, color: '#00ff00', kind: 'TOURNAMENT', active: true, total_quantity: 424242, reserved_quantity: 1, available_quantity: 2 },
];
const inventory = { rows: [{ chip: { _id: 'c100' }, in_binders: 1000, reserved: 200, free: 800, in_play: 250, lost: 0 }] };
let root; let container;
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

async function mountAs(role) {
  act(() => root.unmount()); container.remove();
  auth.role = role;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<AlertProvider><Estoque /></AlertProvider>); });
  await flush(80);
}
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));

beforeEach(async () => {
  auth.role = 'admin';
  api.apiGet.mockReset();
  api.apiGet.mockImplementation(async (path) => (path === '/chips' ? chips : path === '/inventory/by-chip' ? inventory : []));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<AlertProvider><Estoque /></AlertProvider>); });
  await flush(80);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Estoque (G10)', () => {
  it('colunas derivadas: em fichários, reservado, livre, em jogo — e o cache legado não aparece', () => {
    const head = container.querySelector('thead').textContent;
    for (const h of ['Em fichários', 'Reservado', 'Livre', 'Em jogo']) expect(head).toContain(h);
    expect(head).not.toContain('*');
    const cells = [...container.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Ficha 100')).querySelectorAll('td');
    expect([...cells].slice(3, 7).map((c) => c.textContent)).toEqual(['1.000', '200', '800', '250']);
    for (const legacy of ['999.999', '888.888', '777.777', '424.242']) expect(container.textContent).not.toContain(legacy);
  });

  it('ficha sem movimento aparece com zeros (não some nem mostra o cache)', () => {
    const cells = [...container.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Ficha 5')).querySelectorAll('td');
    expect([...cells].slice(3, 7).map((c) => c.textContent)).toEqual(['0', '0', '0', '0']);
  });

  it('falha do endpoint de saldos não derruba a lista de fichas', async () => {
    act(() => root.unmount()); container.remove();
    api.apiGet.mockImplementation(async (path) => { if (path === '/inventory/by-chip') throw new Error('x'); return path === '/chips' ? chips : []; });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    await act(async () => { root.render(<AlertProvider><Estoque /></AlertProvider>); });
    await flush(80);
    expect(container.textContent).toContain('Ficha 100');
  });

  it('permissão por AÇÃO: admin cadastra e movimenta; material só opera (perda), sem cadastrar ficha; salão só consulta', async () => {
    expect(button('Nova Ficha')).toBeTruthy();
    expect(button('Movimentar')).toBeTruthy();
    expect(container.querySelector('button[title="Editar"]')).toBeTruthy();

    await mountAs('material');
    expect(button('Nova Ficha')).toBeFalsy();
    expect(container.querySelector('button[title="Editar"]')).toBeFalsy();
    expect(container.querySelector('button[title="Desativar"]')).toBeFalsy();
    expect(button('Movimentar')).toBeTruthy();

    await mountAs('salao');
    expect(button('Nova Ficha')).toBeFalsy();
    expect(button('Movimentar')).toBeFalsy();
    expect(container.textContent).toContain('Ficha 100');
  });

  it('cadastro de ficha: só valor NOMINAL e cor — sem tipo (nem KO) e sem valor monetário; payload enxuto', async () => {
    api.apiPost.mockResolvedValue({});
    await act(async () => { button('Nova Ficha').click(); });
    const text = container.textContent;
    expect(text).not.toMatch(/monetário|R\$|\bKO\b|Tipo/);
    expect(container.querySelector('[data-testid="color-picker"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/Hex/);
    const value = container.querySelector('input[type="number"]');
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(value, '1'); value.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { container.querySelector('[data-color="#00b050"]').click(); });   // escolhe o verde na paleta
    await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledTimes(1);
    const [path, body] = api.apiPost.mock.calls[0];
    expect(path).toBe('/chips');
    expect(body).toEqual({ value: 1, color: '#00b050' });
  });
});
