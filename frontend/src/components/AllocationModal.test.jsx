// AllocationModal (G5): modos de alocação e exibição do erro de conflito vindo do servidor.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }));
vi.mock('../lib/api', () => api);

import AllocationModal from './AllocationModal';
import { AlertProvider } from '../contexts/AlertContext';

const chip = (id, value) => ({ _id: id, name: `Ficha ${value}`, value, color: '#000' });
const matrix = {
  binder: { _id: 'b1', name: 'LISA 1' },
  chips: [
    { chip: chip('c100', 100), balance: 3000, allocated: [], allocated_total: 0, free: 3000 },
    { chip: chip('c5000', 5000), balance: 1000, allocated: [
      { allocation_id: 'aX', tournament_name: 'Torneio A', status: 'active', quantity: 600 },
      { allocation_id: 'own', tournament_name: 'Torneio B', status: 'planned', quantity: 100 }, // a que estamos editando
    ], allocated_total: 700, free: 300 },
  ],
};
const tournament = { _id: 't1', name: 'Torneio B', status: 'scheduled' };

let root; let container;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const option = (label) => [...container.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes(label));
// linhas da matriz em ordem de valor: [0] = ficha 100, [1] = ficha 5.000
const qtyInput = (i) => container.querySelectorAll('input[type="number"]')[i];
const setValue = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };

async function mount(props = {}) {
  const onDone = vi.fn(); const onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<AlertProvider><AllocationModal tournament={tournament} onClose={onClose} onDone={onDone} {...props} /></AlertProvider>);
  });
  await flush();
  return { onDone, onClose };
}

beforeEach(() => {
  api.apiGet.mockReset(); api.apiPost.mockReset(); api.apiPut.mockReset();
  api.apiGet.mockImplementation(async (path) => (path === '/binders' ? [{ _id: 'b1', name: 'LISA 1' }] : matrix));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

// edição já abre o fichário (sem precisar escolher no select)
const editing = { _id: 'own', binder_id: { _id: 'b1' }, chips: [{ chip_id: chip('c5000', 5000), quantity: 100 }] };

describe('AllocationModal', () => {
  it('mostra a matriz: saldo, quem segura cada ficha e o livre', async () => {
    await mount({ editing });
    const t = container.textContent;
    expect(t).toContain('3.000');
    expect(t).toContain('Torneio A: 600');
    expect(t).toContain('Torneio B: 100');
    expect(t).toContain('300'); // livre segundo o servidor (1000 − 600 − 100)
  });

  it('modo "quantidade": envia só as fichas com quantidade > 0 no PUT da edição', async () => {
    api.apiPut.mockResolvedValue({});
    const { onDone } = await mount({ editing });
    await act(async () => { setValue(qtyInput(1), '250'); });
    await act(async () => { button('Salvar alocação').click(); });
    await flush();
    expect(api.apiPut).toHaveBeenCalledWith('/allocations/own', { chips: [{ chip_id: 'c5000', quantity: 250 }] });
    expect(onDone).toHaveBeenCalled();
  });

  it('o limite do campo de quantidade é o LIVRE (a própria alocação não conta contra si)', async () => {
    await mount({ editing: { ...editing, chips: [{ chip_id: chip('c5000', 5000), quantity: 100 }] } });
    // o servidor diz livre 300, mas para EDITAR a própria alocação (100) não conta contra si: 1000 − 600 = 400
    expect(qtyInput(1).max).toBe('400');
    expect(qtyInput(0).max).toBe('3000');
  });

  it('erro 409 do servidor é EXIBIDO com o excesso e quem está segurando (não só um aviso)', async () => {
    api.apiPut.mockRejectedValue(Object.assign(new Error('Alocação acima do saldo livre em "LISA 1"'), {
      status: 409,
      data: { details: [{ chip: 'Ficha 5000', requested: 401, free: 400, excess: 1, held_by: [{ tournament: 'Torneio A', quantity: 600 }] }] },
    }));
    const { onDone } = await mount({ editing });
    await act(async () => { setValue(qtyInput(1), '401'); });
    await act(async () => { button('Salvar alocação').click(); });
    await flush();
    const t = container.textContent;
    expect(t).toContain('Alocação acima do saldo livre');
    expect(t).toContain('excesso 1');
    expect(t).toContain('Torneio A 600');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('nova alocação: escolhe o fichário, modo "por denominação" com faixa de valor vai ao servidor', async () => {
    api.apiPost.mockResolvedValue({});
    const { onDone } = await mount(); // sem `editing`: carrega /binders
    expect(api.apiGet).toHaveBeenCalledWith('/binders');
    // escolhe o fichário no select
    await act(async () => { button('Selecione o fichário').click(); });
    await act(async () => { option('LISA 1').click(); });
    await flush();
    await act(async () => { button('Por denominação').click(); });
    const [min] = container.querySelectorAll('input[placeholder="de"]');
    await act(async () => { setValue(min, '5000'); });
    await act(async () => { button('Alocar').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/allocations', { binder_id: 'b1', mode: 'denominations', min_value: 5000, max_value: undefined });
    expect(onDone).toHaveBeenCalled();
  });

  it('sem nenhuma quantidade/denominação não chama o servidor', async () => {
    await mount({ editing });
    await act(async () => { setValue(qtyInput(1), ''); }); // zera a única quantidade preenchida
    await act(async () => { button('Salvar alocação').click(); });
    expect(api.apiPut).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Informe a quantidade');
  });
});
