// Usuários (G11): escopo por torneio — o admin escolhe os torneios que o usuário pode acessar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../lib/api', () => api);
vi.mock('../lib/auth', () => ({ getStoredUser: () => ({ role: 'admin', email: 'root@x.com' }), getToken: () => 't' }));

import Usuarios from './Usuarios';
import { AlertProvider } from '../contexts/AlertContext';

const users = [{ _id: 'u1', name: 'Operador', email: 'op@x.com', role: 'material', allowed_tournament_ids: ['t1'] }, { _id: 'u2', name: 'Chefe', email: 'root@x.com', role: 'admin', allowed_tournament_ids: [] }];
const tournaments = [{ _id: 't1', name: 'Torneio A' }, { _id: 't2', name: 'Torneio B' }];
let root; let container;
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const scope = () => container.querySelector('[data-testid="tournament-scope"]');
const box = (name) => [...scope().querySelectorAll('label')].find((l) => l.textContent.includes(name)).querySelector('input');
const setValue = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };

beforeEach(async () => {
  Object.values(api).forEach((f) => f.mockReset());
  api.apiGet.mockImplementation(async (path) => (path === '/users' ? users : path === '/tournaments' ? tournaments : []));
  api.apiPost.mockResolvedValue({}); api.apiPut.mockResolvedValue({});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<AlertProvider><Usuarios /></AlertProvider>); });
  await flush(60);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Usuarios — escopo por torneio', () => {
  it('editar: mostra os torneios já permitidos e envia a lista alterada', async () => {
    await act(async () => { container.querySelectorAll('button[class*="hover:text-blue-500"]')[0].click(); });
    expect(scope()).toBeTruthy();
    expect(box('Torneio A').checked).toBe(true);
    expect(box('Torneio B').checked).toBe(false);
    await act(async () => { box('Torneio B').click(); });
    await act(async () => { box('Torneio A').click(); });
    await act(async () => { button('Salvar Alterações').click(); });
    await flush();
    expect(api.apiPut).toHaveBeenCalledWith('/users/u1', expect.objectContaining({ role: 'material', allowed_tournament_ids: ['t2'] }));
  });

  it('criar: sem nenhum marcado = sem restrição (lista vazia)', async () => {
    await act(async () => { button('Novo').click(); });
    const inputs = [...container.querySelectorAll('form input:not([type="checkbox"])')];
    await act(async () => { setValue(inputs[0], 'Nova Pessoa'); setValue(inputs[1], 'nova@x.com'); setValue(inputs[2], 'secret123'); setValue(inputs[3], 'secret123'); });
    await act(async () => { button('Criar Membro').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/users', expect.objectContaining({ email: 'nova@x.com', allowed_tournament_ids: [] }));
  });

  it('administrador não tem escopo: o seletor some e nada é enviado', async () => {
    await act(async () => { container.querySelectorAll('button[class*="hover:text-blue-500"]')[1].click(); });
    expect(scope()).toBeFalsy();
    await act(async () => { button('Salvar Alterações').click(); });
    await flush();
    expect(api.apiPut).toHaveBeenCalledWith('/users/u2', expect.objectContaining({ allowed_tournament_ids: [] }));
  });
});
