// SessionBar (G4): sessões do torneio, escolha da ativa e quem pode mudar o quê.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../lib/api', () => api);

import SessionBar from './SessionBar';
import { AlertProvider } from '../contexts/AlertContext';

const sessions = [
  { _id: 's1', name: 'Dia 1A', status: 'finished', counts: { total: 12 }, chips_value: 0 },
  { _id: 's2', name: 'Dia 1B', status: 'running', counts: { total: 5 }, chips_value: 250000 },
  { _id: 's3', name: 'Dia Final', status: 'scheduled', counts: { total: 0 }, chips_value: 0 },
];

let root; let container;
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label) || b.title?.includes(label));
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

async function mount(props = {}) {
  const onSelect = vi.fn(); const onChanged = vi.fn(async () => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <AlertProvider>
        <SessionBar tournamentId="t1" sessions={sessions} selectedId="s2" onSelect={onSelect} onChanged={onChanged} isAdmin={false} tournamentClosed={false} {...props} />
      </AlertProvider>,
    );
  });
  return { onSelect, onChanged };
}

beforeEach(() => { api.apiPost.mockReset(); api.apiPut.mockReset(); api.apiDelete.mockReset(); api.apiPut.mockResolvedValue({}); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('SessionBar', () => {
  it('lista as sessões do torneio com o nº de entradas de cada uma', async () => {
    await mount();
    const t = container.textContent;
    for (const name of ['Dia 1A', 'Dia 1B', 'Dia Final']) expect(t).toContain(name);
    expect(t).toContain('12');
    expect(t).toContain('valor em jogo 250.000');
  });

  it('clicar numa sessão a seleciona', async () => {
    const { onSelect } = await mount();
    await act(async () => { button('Dia Final').click(); });
    expect(onSelect).toHaveBeenCalledWith('s3');
  });

  it('operador encerra a sessão em andamento (PUT status) e a tela é recarregada', async () => {
    const { onChanged } = await mount({ isAdmin: false });
    await act(async () => { button('Encerrar sessão').click(); });
    await flush();
    expect(api.apiPut).toHaveBeenCalledWith('/tournaments/t1/sessions/s2', { status: 'finished' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('operador NÃO cria, renomeia, exclui nem reabre; admin pode', async () => {
    await mount({ isAdmin: false });
    expect(button('Sessão')).toBeFalsy(); // botão "+ Sessão"
    expect(button('Renomear')).toBeFalsy();
    expect(button('Excluir sessão')).toBeFalsy();
    act(() => root.unmount()); container.remove();

    await mount({ isAdmin: true });
    expect(button('Sessão')).toBeTruthy();
    expect(button('Renomear')).toBeTruthy();
    expect(button('Excluir sessão')).toBeTruthy();
  });

  it('sessão encerrada: só o admin vê "Reabrir"; sessão agendada oferece "Iniciar sessão"', async () => {
    await mount({ selectedId: 's1', isAdmin: false });
    expect(button('Reabrir')).toBeFalsy();
    act(() => root.unmount()); container.remove();

    await mount({ selectedId: 's1', isAdmin: true });
    expect(button('Reabrir')).toBeTruthy();
    act(() => root.unmount()); container.remove();

    await mount({ selectedId: 's3' });
    expect(button('Iniciar sessão')).toBeTruthy();
  });

  it('torneio encerrado: não oferece criar nova sessão', async () => {
    await mount({ isAdmin: true, tournamentClosed: true });
    expect([...container.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Sessão')).toBe(false);
  });
});
