// Tracking Sheet: cadastrar/editar/excluir níveis, breaks sem incrementar nível, salvar, e somente leitura para Material/Salão.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../lib/api', () => api);
const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('../lib/auth', () => ({ getStoredUser: () => ({ role: auth.role }), getToken: () => 't' }));

import TrackingSheet from './TrackingSheet';
import { AlertProvider } from '../contexts/AlertContext';

const L = (n, sb, bb, ante = 0, duration = 20) => ({ row_type: 'level', small_blind: sb, big_blind: bb, ante, duration });
const tpl = { _id: 't1', name: 'Warm Up', notes: '', rows: [L(1, 100, 200), L(2, 200, 400, 0, 30), { row_type: 'break', duration: 15, label: 'Break 15 min' }] };
let root; let container;
const flush = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const btn = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(text));
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); await flush(); };
const setVal = async (el, v) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const mount = async (role = 'admin') => {
  auth.role = role;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<AlertProvider><TrackingSheet /></AlertProvider>); });
  await flush();
};
const rowsCount = () => container.querySelectorAll('[data-testid="blind-rows"] tbody tr').length;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.apiGet.mockResolvedValue([tpl]);
  api.apiPost.mockImplementation(async (_u, b) => ({ _id: 'new', ...b }));
  api.apiPut.mockImplementation(async (_u, b) => ({ _id: 't1', ...b }));
  api.apiDelete.mockResolvedValue({});
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Tracking Sheet', () => {
  it('admin: lista estruturas e abre a escolhida no editor com níveis e break', async () => {
    await mount();
    expect(container.textContent).toContain('Warm Up');
    await click(btn('Warm Up'));
    expect(rowsCount()).toBe(3);
    expect(container.textContent).toContain('2 níveis');
  });

  it('adicionar nível copia o último (sem dobrar) e numera +1; break não incrementa', async () => {
    await mount();
    await click(btn('Warm Up'));
    await click(btn('Nível'));
    const sb = container.querySelector('input[aria-label="small_blind nível 3"]');
    expect(sb.value).toBe('200');
    expect(container.querySelector('input[aria-label="duration nível 3"]').value).toBe('30');
    await click(btn('Dinner Break 60'));
    await click(btn('Nível'));
    expect(container.querySelector('input[aria-label="small_blind nível 4"]')).toBeTruthy();
    expect(container.querySelector('input[aria-label="small_blind nível 5"]')).toBeFalsy();
  });

  it('editar SB e salvar envia PUT com as linhas editadas', async () => {
    await mount();
    await click(btn('Warm Up'));
    await setVal(container.querySelector('input[aria-label="small_blind nível 1"]'), '150');
    await click(btn('Salvar'));
    expect(api.apiPut).toHaveBeenCalledTimes(1);
    const [url, body] = api.apiPut.mock.calls[0];
    expect(url).toBe('/blind-templates/t1');
    expect(body.rows[0].small_blind).toBe(150);
    expect(body.rows[1].small_blind).toBe(200);
  });

  it('nova estrutura sem nome ou sem níveis não salva; com dados faz POST', async () => {
    await mount();
    await click(btn('Nova estrutura'));
    await setVal(container.querySelector('#ts-name'), 'Main Event');
    await click(btn('Salvar'));
    expect(api.apiPost).not.toHaveBeenCalled(); // sem níveis
    await click(btn('Nível'));
    await click(btn('Salvar'));
    expect(api.apiPost).toHaveBeenCalledTimes(1);
    expect(api.apiPost.mock.calls[0][0]).toBe('/blind-templates');
    expect(api.apiPost.mock.calls[0][1].name).toBe('Main Event');
  });

  it('excluir linha remove o nível; duplicar vira nova estrutura (POST)', async () => {
    await mount();
    await click(btn('Warm Up'));
    await click(container.querySelectorAll('button[aria-label="Remover linha"]')[1]);
    expect(rowsCount()).toBe(2);
    await click(btn('Duplicar'));
    expect(container.querySelector('#ts-name').value).toBe('Warm Up (cópia)');
    await click(btn('Salvar'));
    expect(api.apiPost).toHaveBeenCalledTimes(1);
    expect(api.apiPut).not.toHaveBeenCalled();
  });

  it.each(['material', 'salao'])('%s: somente leitura (sem salvar, editar, nova estrutura)', async (role) => {
    await mount(role);
    expect(btn('Nova estrutura')).toBeFalsy();
    await click(btn('Warm Up'));
    expect(rowsCount()).toBe(3);
    expect(container.querySelectorAll('[data-testid="blind-rows"] input').length).toBe(0);
    expect(btn('Salvar')).toBeFalsy();
    expect(btn('Nível')).toBeFalsy();
    expect(container.querySelector('#ts-name').disabled).toBe(true);
  });
});
