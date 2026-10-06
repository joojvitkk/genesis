// MaterialPanel (G6): resumo esperado × em jogo, envio por ação (fichas calculadas no servidor) e retorno.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../lib/api', () => api);
const sock = vi.hoisted(() => { const h = {}; return { handlers: h, socket: { on: (e, f) => { (h[e] ||= new Set()).add(f); }, off: (e, f) => h[e]?.delete(f) } }; });
vi.mock('../lib/socket', () => ({ socket: sock.socket }));

import MaterialPanel from './MaterialPanel';
import { AlertProvider } from '../contexts/AlertContext';

const c100 = { _id: 'c100', value: 100, color: '#000' };
const c500 = { _id: 'c500', value: 500, color: '#f00' };
const summary = {
  rows: [
    { chip: c100, expected: 1000, sent: 600, returned: 100, discarded: 25, conversion_in: 0, conversion_out: 0, on_table: 500, in_play: 1000, available: 0, pending: 500 },
    { chip: c500, expected: 400, sent: 500, returned: 0, conversion_in: 0, conversion_out: 0, on_table: 500, in_play: 400, available: 100, pending: -100 },
  ],
  totals: { expected_value: 300000, on_table_value: 300000, in_play_value: 300000, available_value: 50000, pending_value: 0 }, uncovered: [],
  stacks: [{ action: 're_entry', label: 'Reentrada', stacks: 90, composition: [{ chip: c500, quantity: 2 }] }],
};
const data = {
  '/tournaments/t1/material': summary,
  '/allocations': [{ _id: 'a1', binder_id: { _id: 'b1', name: 'LISA 1' } }],
  '/movements': [{ _id: 'm1', type: 'SEND_BUY_IN', chip_id: c100, quantity: 600, createdAt: '2026-10-01T12:00:00Z', user_name: 'Ana', binder_id: { name: 'LISA 1' } }],
};

let root; let container;
const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const buttons = () => [...container.querySelectorAll('button')];
const button = (label) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const option = (label) => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes(label));
const setValue = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };

async function mount(props = {}) {
  const onChanged = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <AlertProvider>
        <MaterialPanel tournament={{ _id: 't1', name: 'Warm Up' }} sessions={[]} sessionId="" canOperate closed={false}
          stackActions={[{ key: 'buy_in', label: 'Buy-in padrão' }, { key: 're_entry', label: 'Reentrada' }]} onChanged={onChanged} {...props} />
      </AlertProvider>,
    );
  });
  await flush(60);
  return { onChanged };
}

beforeEach(() => {
  api.apiGet.mockReset(); api.apiPost.mockReset();
  api.apiGet.mockImplementation(async (path) => data[path] ?? []);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('MaterialPanel', () => {
  it('separa enviado (acumulado) × no Salão × em jogo × disponível × falta enviar, com os stacks disponíveis', async () => {
    await mount();
    const t = container.textContent;
    for (const h of ['Enviado (acum.)', 'Devolvido', 'No Salão', 'Em jogo', 'Disponível no Salão', 'Falta enviar']) expect(t).toContain(h);
    expect(t).toContain('90 stacks disponíveis de Reentrada');
    expect(t).toContain('Envio · buy-in');
    expect(t).toContain('Ana');
  });

  it('envio por AÇÃO: as fichas exibidas vêm do servidor e o envio manda só a ação e a quantidade', async () => {
    api.apiPost.mockImplementation(async (path) => (path === '/tournaments/t1/needs'
      ? { rows: [{ chip: c100, quantity: 1000 }, { chip: c500, quantity: 400 }], totals: { quantity: 1400, value: 300000 }, counts: { buy_in: 100 } }
      : { movements: [] }));
    const { onChanged } = await mount();
    await act(async () => { button('Ação (buy-in').click(); });
    await act(async () => { option('Buy-in padrão').click(); });
    await act(async () => { setValue(container.querySelector('input[placeholder="Qtd"]'), '100'); });
    await flush(400);

    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/needs', { counts: { buy_in: 100 } });
    expect(container.textContent).toContain('100 × 1.000');  // ficha 100 × 1.000 (cálculo do servidor)
    expect(container.textContent).toContain('valor 300.000');

    await act(async () => { button('Enviar').click(); });
    await flush();
    await act(async () => { button('Confirmar').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/sends', { items: [{ action: 'buy_in', count: 100 }], chips: undefined, session_id: undefined });
    expect(onChanged).toHaveBeenCalled();
  });

  it('erro 409 do servidor no envio é exibido (fichas insuficientes nos fichários alocados)', async () => {
    api.apiPost.mockImplementation(async (path) => {
      if (path === '/tournaments/t1/needs') return { rows: [], totals: { quantity: 0, value: 0 }, counts: {} };
      throw Object.assign(new Error('Fichas insuficientes nos fichários alocados ao torneio: Ficha 100 (faltam 5 de 1000).'), { status: 409 });
    });
    await mount();
    await act(async () => { button('Ação (buy-in').click(); });
    await act(async () => { option('Reentrada').click(); });
    await act(async () => { setValue(container.querySelector('input[placeholder="Qtd"]'), '3'); });
    await flush(400);
    await act(async () => { button('Enviar').click(); });
    await flush();
    await act(async () => { button('Confirmar').click(); });
    await flush();
    expect(container.textContent).toContain('faltam 5 de 1000');
  });

  it('sem ação nem ficha não chama o servidor', async () => {
    await mount();
    await act(async () => { button('Enviar').click(); });
    await flush();
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it('retorno: só as fichas em jogo, para o fichário escolhido, e envia a contagem física', async () => {
    api.apiPost.mockResolvedValue({ movements: [] });
    await mount();
    // o fichário único alocado já vem escolhido
    const inputs = [...container.querySelectorAll('input[type="number"]')].filter((i) => i.placeholder === '0');
    const retInput = inputs[inputs.length - 2]; // linhas do retorno: 100 e 500 (ambas têm fichas em jogo)
    await act(async () => { setValue(retInput, '50'); });
    await act(async () => { button('Registrar retorno').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/returns', { binder_id: 'b1', chips: [{ chip_id: 'c100', quantity: 50 }], reason: undefined, session_id: undefined });
  });

  it('quem só consulta não vê formulários; torneio encerrado esconde o envio mas mantém o retorno', async () => {
    await mount({ canOperate: false });
    expect(button('Enviar')).toBeFalsy();
    expect(button('Registrar retorno')).toBeFalsy();
    act(() => root.unmount()); container.remove();

    await mount({ closed: true });
    expect(button('Enviar')).toBeFalsy();
    expect(button('Registrar retorno')).toBeTruthy();
  });

  it('sem fichas alocadas: avisa e desabilita o envio', async () => {
    api.apiGet.mockImplementation(async (path) => (path === '/allocations' ? [] : data[path] ?? []));
    await mount();
    expect(container.textContent).toContain('não tem fichas alocadas');
    expect(button('Enviar').disabled).toBe(true);
  });

  // ─── G7 — descarte de stack ────────────────────────────────────────────────
  describe('descarte de stack', () => {
    const discardRow = { batch_id: 'd1', at: '2026-10-01T15:00:00Z', user_name: 'Ana', binder: { name: 'LISA 1' }, note: 'stack curto',
      chips: [{ chip: c100, quantity: 3 }, { chip: c500, quantity: 1 }], total_chips: 4, total_value: 800, reversed: false };
    const withDiscards = (list) => api.apiGet.mockImplementation(async (path) => (path === '/tournaments/t1/discards' ? list : data[path] ?? []));
    const inputFor = (v) => container.querySelector(`input[aria-label="Descartar ${v}"]`);
    const previewOk = async (path, body) => (path.endsWith('/discards/preview')
      ? { total_chips: body.chips.reduce((s, c) => s + c.quantity, 0), total_value: 800, chips: [] }
      : { batch_id: 'd9' });

    it('mostra a coluna "Descartado" no resumo', async () => {
      await mount();
      expect(container.textContent).toContain('Descartado');
      expect(container.textContent).toContain('25');
    });

    it('registra 3×100 + 1×500: o valor total vem da prévia do SERVIDOR e o envio leva só fichas/fichário/sessão', async () => {
      api.apiPost.mockImplementation(previewOk);
      const { onChanged } = await mount({ sessionId: 's1' });
      await act(async () => { button('Descartar stack').click(); });
      await act(async () => { setValue(inputFor(100), '3'); setValue(inputFor(500), '1'); });
      await flush(400);

      expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/discards/preview', { chips: [{ chip_id: 'c100', quantity: 3 }, { chip_id: 'c500', quantity: 1 }] });
      expect(container.textContent).toContain('valor 800'); // o número exibido é o do servidor, não recalculado (3×100+1×500 seria 800 também: a prévia é mockada com o mesmo valor)

      expect(container.querySelector('input[placeholder="ou nome livre (opcional)"]')).toBeFalsy(); // sem campo de jogador
      await act(async () => { setValue(container.querySelector('input[placeholder="Observação (opcional)"]'), 'stack curto'); });
      await act(async () => { button('Registrar descarte').click(); });
      await flush();
      expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/discards', {
        chips: [{ chip_id: 'c100', quantity: 3 }, { chip_id: 'c500', quantity: 1 }], binder_id: 'b1', session_id: 's1',
        note: 'stack curto',
      });
      expect(onChanged).toHaveBeenCalled();
      expect(container.querySelector('[role="dialog"]')).toBeFalsy(); // fecha após registrar
    });

    it('o valor exibido é o que o servidor devolve (mudar a resposta muda o texto)', async () => {
      api.apiPost.mockImplementation(async (path, body) => (path.endsWith('/preview') ? { total_chips: 4, total_value: 12345, chips: [] } : { batch_id: 'd9', body }));
      await mount();
      await act(async () => { button('Descartar stack').click(); });
      await act(async () => { setValue(inputFor(100), '3'); });
      await flush(400);
      expect(container.textContent).toContain('valor 12.345');
    });

    it('409 do servidor (acima do em jogo) é exibido e o modal continua aberto', async () => {
      api.apiPost.mockImplementation(async (path, body) => {
        if (path.endsWith('/preview')) return { total_chips: 999, total_value: 1, chips: [] };
        throw Object.assign(new Error('Fichas insuficientes em jogo no torneio "Warm Up" tem 500.'), { status: 409 });
      });
      const { onChanged } = await mount();
      await act(async () => { button('Descartar stack').click(); });
      await act(async () => { setValue(inputFor(100), '999'); });
      await flush(400);
      await act(async () => { button('Registrar descarte').click(); });
      await flush();
      expect(container.querySelector('[role="alert"]').textContent).toContain('tem 500');
      expect(container.querySelector('[role="dialog"]')).toBeTruthy();
      expect(onChanged).not.toHaveBeenCalled();
    });

    it('sem fichas informadas não chama o servidor; só lista denominações que estão em jogo', async () => {
      await mount();
      await act(async () => { button('Descartar stack').click(); });
      expect(button('Registrar descarte').disabled).toBe(true);
      expect(inputFor(100)).toBeTruthy();
      expect(inputFor(1000)).toBeFalsy();
      expect(api.apiPost).not.toHaveBeenCalled();
    });

    it('com vários fichários alocados exige escolher o destino', async () => {
      api.apiGet.mockImplementation(async (path) => (path === '/allocations'
        ? [{ _id: 'a1', binder_id: { _id: 'b1', name: 'LISA 1' } }, { _id: 'a2', binder_id: { _id: 'b2', name: 'LISA 2' } }] : data[path] ?? []));
      api.apiPost.mockImplementation(previewOk);
      await mount();
      await act(async () => { button('Descartar stack').click(); });
      await act(async () => { setValue(inputFor(100), '3'); });
      await flush(400);
      await act(async () => { button('Registrar descarte').click(); });
      await flush();
      expect(container.querySelector('[role="alert"]').textContent).toContain('Escolha o fichário');
      expect(api.apiPost).not.toHaveBeenCalledWith('/tournaments/t1/discards', expect.anything());
    });

    it('lista os descartes e só o ADMIN vê "Estornar"; o estorno pede motivo e chama o servidor', async () => {
      withDiscards([discardRow]);
      api.apiPost.mockResolvedValue({});
      await mount({ isAdmin: false });
      expect(container.textContent).toContain('100 × 3 + 500 × 1');
      expect(container.textContent).toContain('valor 800');
      expect(container.textContent).toContain('stack curto');
      expect(button('Estornar')).toBeFalsy();
      act(() => root.unmount()); container.remove();

      await mount({ isAdmin: true });
      await act(async () => { button('Estornar').click(); });
      await flush();
      const dialog = document.querySelector('[role="dialog"]');
      await act(async () => { setValue(dialog.querySelector('input'), 'lancei no jogador errado'); });
      await act(async () => { [...dialog.querySelectorAll('button')].find((b) => b.textContent === 'Estornar').click(); });
      await flush();
      expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/discards/d1/reverse', { reason: 'lancei no jogador errado' });
    });

    it('descarte estornado aparece marcado e sem botão de estorno', async () => {
      withDiscards([{ ...discardRow, reversed: true }]);
      await mount({ isAdmin: true });
      expect(container.textContent).toContain('(estornado)');
      expect(button('Estornar')).toBeFalsy();
    });

    it('quem só consulta ou torneio encerrado não vê o botão de descartar', async () => {
      await mount({ canOperate: false });
      expect(button('Descartar stack')).toBeFalsy();
      act(() => root.unmount()); container.remove();
      await mount({ closed: true });
      expect(button('Descartar stack')).toBeFalsy();
    });

    it('sem fichas alocadas o descarte fica desabilitado', async () => {
      api.apiGet.mockImplementation(async (path) => (path === '/allocations' ? [] : data[path] ?? []));
      await mount();
      expect(button('Descartar stack').disabled).toBe(true);
    });

    it('tempo real: evento de socket do mesmo torneio recarrega; de outro torneio não', async () => {
      await mount();
      const calls = () => api.apiGet.mock.calls.filter(([p]) => p === '/tournaments/t1/material').length;
      const n = calls();
      await act(async () => { sock.handlers.discardRegistered.forEach((f) => f({ tournament_id: 'outro' })); });
      await flush();
      expect(calls()).toBe(n);
      await act(async () => { sock.handlers.discardRegistered.forEach((f) => f({ tournament_id: 't1', total_chips: 4, total_value: 800 })); });
      await flush();
      expect(calls()).toBe(n + 1);
      await act(async () => { sock.handlers.materialChanged.forEach((f) => f({ tournament_id: 't1' })); });
      await flush();
      expect(calls()).toBe(n + 2);
    });

    it('ao desmontar, as assinaturas de socket são removidas', async () => {
      await mount();
      expect(sock.handlers.discardRegistered.size).toBeGreaterThan(0);
      act(() => root.unmount()); container.remove();
      expect(sock.handlers.discardRegistered.size).toBe(0);
      expect(sock.handlers.materialChanged.size).toBe(0);
      await mount(); // afterEach desmonta
    });
  });
});
