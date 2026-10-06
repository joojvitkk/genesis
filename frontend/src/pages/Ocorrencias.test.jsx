// Ocorrências (G8): lista com semáforo, filtros, ciclo de vida por papel, conferência e configuração do semáforo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../lib/api', () => api);
const sock = vi.hoisted(() => { const h = {}; return { handlers: h, socket: { on: (e, f) => { (h[e] ||= new Set()).add(f); }, off: (e, f) => h[e]?.delete(f) } }; });
vi.mock('../lib/socket', () => ({ socket: sock.socket }));
const auth = vi.hoisted(() => ({ role: 'admin' }));
vi.mock('../lib/auth', () => ({ getStoredUser: () => ({ role: auth.role, name: 'Ana' }), getToken: () => 't' }));

import Ocorrencias from './Ocorrencias';
import { AlertProvider } from '../contexts/AlertContext';
import { occurrenceAlertText } from '../lib/occurrenceAlert';

const c100 = { _id: 'c100', value: 100, color: '#000' };
const c5000 = { _id: 'c5000', value: 5000, color: '#0f0' };
const occ = (over = {}) => ({
  _id: 'o1', kind: 'LOSS', scope: 'binder', chip_id: c100, binder_id: { _id: 'b1', name: 'LISA 1' }, tournament_id: null,
  expected: 100, counted: 97, diff: -3, quantity: 3, severity: 'GREEN', status: 'open', recovered_quantity: 0, remaining: 3,
  user_name: 'Ana', createdAt: '2026-10-01T12:00:00Z', history: [{ action: 'opened', user_name: 'Ana', at: '2026-10-01T12:00:00Z', quantity: 3 }], ...over,
});
const binders = [{ _id: 'b1', name: 'LISA 1', chips: [{ chip_id: c100, quantity: 97 }, { chip_id: c5000, quantity: 10 }] }, { _id: 'b2', name: 'LISA 2', chips: [] }];
const summary = { red_open: 1, pending_justification: 2, by_status: {}, open_by_severity: {} };
let list; let root; let container;

const flush = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const buttons = () => [...container.querySelectorAll('button')];
const button = (label) => buttons().find((b) => b.textContent.includes(label));
const option = (label) => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes(label));
const setValue = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
const dialog = () => document.querySelector('[role="dialog"]');

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<AlertProvider><Ocorrencias /></AlertProvider>); });
  await flush(60);
}

beforeEach(() => {
  auth.role = 'admin'; list = [occ()];
  Object.values(api).forEach((f) => f.mockReset());
  api.apiGet.mockImplementation(async (path) => {
    if (path === '/occurrences') return list;
    if (path === '/occurrences/summary') return summary;
    if (path === '/binders') return binders;
    if (path === '/tournaments') return [{ _id: 't1', name: 'Warm Up' }];
    if (path === '/tournaments/t1/material') return { rows: [{ chip: c100, on_table: 200 }] };
    if (path === '/tournaments/t1/sessions') return [];
    if (path === '/settings/severity') return { bands: [{ up_to: 500, level: 'GREEN' }, { up_to: 1000, level: 'YELLOW' }, { up_to: null, level: 'RED' }], escalate: { yellow_at_quantity: null, red_at_quantity: null }, require_justification_from: 'RED' };
    return [];
  });
  api.apiPost.mockResolvedValue({});
});
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ''; });

describe('lista de ocorrências', () => {
  it('mostra semáforo (com texto), ficha, quantidade, fichário, situação e o resumo', async () => {
    list = [occ(), occ({ _id: 'o2', severity: 'RED', chip_id: c5000, status: 'partially_recovered', recovered_quantity: 1, remaining: 2, justification: 'caiu no chão' })];
    await mount();
    const t = container.textContent;
    expect(container.querySelector('[data-severity="GREEN"]').textContent).toContain('Verde');
    expect(container.querySelector('[data-severity="RED"]').textContent).toContain('Vermelho');
    expect(t).toContain('100 × 3 faltando');
    expect(t).toContain('5.000 × 3 faltando');
    expect(t).toContain('Fichário LISA 1');
    expect(t).toContain('Parcialmente recuperada');
    expect(t).toContain('recuperadas 1');
    expect(t).toContain('caiu no chão');
    expect(container.querySelector('[data-testid="red-open"]').textContent).toContain('1 vermelha');
    expect(t).toContain('2 sem justificativa');
  });

  it('padrão: só as ativas; filtros de status/severidade/tipo vão para o servidor', async () => {
    await mount();
    expect(api.apiGet).toHaveBeenCalledWith('/occurrences', { status: 'active', severity: 'all', kind: 'all' });
    await act(async () => { button('Ativas').click(); });
    await act(async () => { option('Recuperada').click(); });
    await flush();
    expect(api.apiGet).toHaveBeenCalledWith('/occurrences', { status: 'recovered', severity: 'all', kind: 'all' });
    await act(async () => { button('Todas as severidades').click(); });
    await act(async () => { option('Vermelho').click(); });
    await flush();
    expect(api.apiGet).toHaveBeenCalledWith('/occurrences', { status: 'recovered', severity: 'RED', kind: 'all' });
  });

  it('vazio: avisa', async () => {
    list = [];
    await mount();
    expect(container.textContent).toContain('Nenhuma ocorrência');
  });

  it('tempo real: ocorrência aberta/atualizada recarrega a lista; desmontar remove as assinaturas', async () => {
    await mount();
    const n = () => api.apiGet.mock.calls.filter(([p]) => p === '/occurrences').length;
    const before = n();
    await act(async () => { sock.handlers.occurrenceOpened.forEach((f) => f({ severity: 'RED' })); });
    await flush();
    await act(async () => { sock.handlers.occurrenceUpdated.forEach((f) => f({})); });
    await flush();
    expect(n()).toBe(before + 2);
    act(() => root.unmount()); container.remove();
    expect(sock.handlers.occurrenceOpened.size).toBe(0);
    expect(sock.handlers.occurrenceUpdated.size).toBe(0);
    await mount();
  });
});

describe('ciclo de vida por papel', () => {
  it('material: justifica e recupera; NÃO encerra nem estorna', async () => {
    auth.role = 'material';
    await mount();
    expect(button('Justificar')).toBeTruthy();
    expect(button('Recuperar')).toBeTruthy();
    expect(button('Encerrar')).toBeFalsy();
    expect(button('Estornar ocorrência')).toBeFalsy();
    expect(button('Semáforo')).toBeFalsy();
  });

  it('salão só consulta: nenhuma ação, sem abas de conferência/semáforo', async () => {
    auth.role = 'salao';
    await mount();
    for (const l of ['Justificar', 'Recuperar', 'Encerrar', 'Estornar ocorrência', 'Conferência', 'Semáforo']) expect(button(l), l).toBeFalsy();
    expect(container.textContent).toContain('100 × 3 faltando');
  });

  it('justificar pede o texto e envia ao servidor', async () => {
    await mount();
    await act(async () => { button('Justificar').click(); });
    await flush();
    await act(async () => { setValue(dialog().querySelector('input'), 'caiu no chão'); });
    await act(async () => { [...dialog().querySelectorAll('button')].find((b) => b.textContent === 'Justificar').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/occurrences/o1/justify', { justification: 'caiu no chão' });
  });

  it('recuperar (perda de fichário): quantidade sugerida = o que falta; não pede fichário; erro 409 aparece', async () => {
    await mount();
    await act(async () => { button('Recuperar').click(); });
    const input = dialog().querySelector('input[aria-label="Quantidade recuperada"]');
    expect(input.value).toBe('3');
    expect(dialog().querySelector('[role="option"], button[aria-haspopup]')).toBeFalsy();
    api.apiPost.mockRejectedValueOnce(Object.assign(new Error('Só 2 ficha(s) ainda podem ser recuperadas'), { status: 409 }));
    await act(async () => { setValue(input, '5'); });
    await act(async () => { button('Registrar recuperação').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/occurrences/o1/recover', { quantity: 5, binder_id: undefined, note: undefined });
    expect(dialog().querySelector('[role="alert"]').textContent).toContain('Só 2 ficha');

    await act(async () => { setValue(input, '2'); });
    await act(async () => { button('Registrar recuperação').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenLastCalledWith('/occurrences/o1/recover', { quantity: 2, binder_id: undefined, note: undefined });
    expect(dialog()).toBeFalsy();
  });

  it('recuperar (perda em jogo): exige escolher o fichário que recebe', async () => {
    list = [occ({ scope: 'tournament', binder_id: null, tournament_id: { _id: 't1', name: 'Warm Up' } })];
    await mount();
    expect(container.textContent).toContain('Jogo · Warm Up');
    await act(async () => { button('Recuperar').click(); });
    await act(async () => { button('Registrar recuperação').click(); });
    expect(dialog().querySelector('[role="alert"]').textContent).toContain('Escolha o fichário');
    expect(api.apiPost).not.toHaveBeenCalled();
    await act(async () => { dialog().querySelector('button[aria-haspopup], button').click(); });
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('LISA 2'));
    await act(async () => { opt?.click(); });
    await act(async () => { button('Registrar recuperação').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/occurrences/o1/recover', { quantity: 3, binder_id: 'b2', note: undefined });
  });

  it('admin encerra e estorna com texto obrigatório; estorna uma recuperação pelo histórico', async () => {
    list = [occ({ status: 'partially_recovered', recovered_quantity: 1, remaining: 2, history: [
      { action: 'opened', user_name: 'Ana', at: '2026-10-01T12:00:00Z', quantity: 3 },
      { action: 'recovered', user_name: 'Ana', at: '2026-10-01T13:00:00Z', quantity: 1, batch_id: 'bt1' }] })];
    await mount();
    const answer = async (opener, confirmLabel, text) => {
      await act(async () => { opener().click(); });
      await flush();
      await act(async () => { setValue(dialog().querySelector('input'), text); });
      await act(async () => { [...dialog().querySelectorAll('button')].find((b) => b.textContent === confirmLabel).click(); });
      await flush();
    };
    await answer(() => button('Encerrar'), 'Encerrar', 'perda definitiva');
    expect(api.apiPost).toHaveBeenCalledWith('/occurrences/o1/close', { justification: 'perda definitiva' });
    await answer(() => button('Estornar ocorrência'), 'Estornar', 'contei errado');
    expect(api.apiPost).toHaveBeenCalledWith('/occurrences/o1/reverse', { reason: 'contei errado' });
    await answer(() => button('Estornar recuperação'), 'Estornar', 'outra ficha');
    expect(api.apiPost).toHaveBeenCalledWith('/occurrences/o1/recoveries/reverse', { batch_id: 'bt1', reason: 'outra ficha' });
  });

  it('ocorrência encerrada/estornada aparece esmaecida e sem ações; recuperação já estornada não oferece estorno', async () => {
    list = [occ({ status: 'closed' }), occ({ _id: 'o3', status: 'voided' })];
    await mount();
    expect(button('Justificar')).toBeFalsy();
    expect(button('Recuperar')).toBeFalsy();
    expect(button('Encerrar')).toBeFalsy();
    expect(container.textContent).toContain('Encerrada');
    expect(container.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(button('Estornar ocorrência')).toBeTruthy(); // o encerrado ainda pode ser estornado pelo admin
    act(() => root.unmount()); container.remove();

    list = [occ({ status: 'justified', history: [
      { action: 'recovered', batch_id: 'bt1', user_name: 'A', at: '2026-10-01T13:00:00Z', quantity: 1 },
      { action: 'recovery_reversed', batch_id: 'bt1', user_name: 'A', at: '2026-10-01T14:00:00Z', quantity: 1 }] })];
    await mount();
    expect(button('Estornar recuperação')).toBeFalsy();
  });

  it('aviso "aguardando justificativa" só para não-verdes abertas', async () => {
    list = [occ({ severity: 'YELLOW' }), occ({ _id: 'o2', severity: 'GREEN' })];
    await mount();
    expect(container.textContent.match(/Aguardando justificativa/g)).toHaveLength(1);
  });
});

describe('conferência', () => {
  it('por fichário: só envia as fichas contadas; mostra o semáforo do resultado', async () => {
    api.apiPost.mockResolvedValue({ diffs: [{ chip_id: 'c100', expected: 97, counted: 95, diff: -2, severity: 'GREEN', occurrence_id: 'o9', kind: 'LOSS' }], occurrences: [] });
    await mount();
    await act(async () => { button('Conferência').click(); });
    await act(async () => { button('Fichário…').click(); });
    await act(async () => { option('LISA 1').click(); });
    expect(container.querySelector('input[aria-label="Contado 100"]')).toBeTruthy();
    await act(async () => { setValue(container.querySelector('input[aria-label="Contado 100"]'), '95'); });
    await act(async () => { setValue(container.querySelector('input[aria-label="Contado 5000"]'), '7'); });
    await act(async () => { setValue(container.querySelector('input[aria-label="Contado 5000"]'), ''); }); // digitou e apagou: não conta
    await act(async () => { button('Registrar conferência').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/binders/b1/count', { counts: [{ chip_id: 'c100', counted: 95 }], reason: undefined, session_id: undefined });
    const res = container.querySelector('[data-testid="count-result"]');
    expect(res.textContent).toContain('1 diferença(s)');
    expect(res.textContent).toContain('faltam 2');
    expect(res.querySelector('[data-severity="GREEN"]')).toBeTruthy();
  });

  it('exige alvo e ao menos uma contagem; o erro de justificativa do servidor é exibido', async () => {
    await mount();
    await act(async () => { button('Conferência').click(); });
    await act(async () => { button('Registrar conferência').click(); });
    expect(container.querySelector('[role="alert"]').textContent).toContain('Escolha o fichário');
    await act(async () => { button('Fichário…').click(); });
    await act(async () => { option('LISA 1').click(); });
    await act(async () => { button('Registrar conferência').click(); });
    expect(container.querySelector('[role="alert"]').textContent).toContain('ao menos uma ficha');
    expect(api.apiPost).not.toHaveBeenCalled();

    api.apiPost.mockRejectedValueOnce(Object.assign(new Error('Há diferença de severidade RED: a justificativa é obrigatória.'), { status: 400 }));
    await act(async () => { setValue(container.querySelector('input[aria-label="Contado 5000"]'), '9'); });
    await act(async () => { button('Registrar conferência').click(); });
    await flush();
    expect(container.querySelector('[role="alert"]').textContent).toContain('justificativa é obrigatória');
    expect(container.querySelector('[data-testid="count-result"]')).toBeFalsy();
  });

  it('jogo (torneio): esperado = em jogo; resultado explica a quebra matemática como NÃO-perda', async () => {
    api.apiPost.mockResolvedValue({ diffs: [], occurrences: [], value: { expected: 20000, counted: 20000, diff: 0, math_breakage: 500 } });
    await mount();
    await act(async () => { button('Conferência').click(); });
    await act(async () => { button('Fichário').click(); });
    await act(async () => { option('Jogo (torneio)').click(); });
    await act(async () => { button('Torneio…').click(); });
    await act(async () => { option('Warm Up').click(); });
    await flush();
    expect(container.textContent).toContain('esperado 200');
    await act(async () => { setValue(container.querySelector('input[aria-label="Contado 100"]'), '200'); });
    await act(async () => { button('Registrar conferência').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/count', { counts: [{ chip_id: 'c100', counted: 200 }], reason: undefined, session_id: undefined });
    const res = container.querySelector('[data-testid="count-result"]').textContent;
    expect(res).toContain('sem diferenças');
    expect(res).toContain('quebra matemática das conversões 500');
    expect(res).toContain('não é perda física');
  });
});

describe('semáforo (admin)', () => {
  const goto = async () => { await mount(); await act(async () => { button('Semáforo').click(); }); await flush(); };

  it('mostra a configuração, salva no servidor e restaura o padrão', async () => {
    api.apiPut.mockImplementation(async (_p, body) => body);
    await goto();
    expect(container.querySelector('input[aria-label="Teto da faixa 1"]').value).toBe('500');
    await act(async () => { setValue(container.querySelector('input[aria-label="Teto da faixa 1"]'), '200'); });
    await act(async () => { setValue(container.querySelector('input[aria-label="Sobe para vermelho a partir de (qtd.)"]'), '50'); });
    await act(async () => { button('Salvar').click(); });
    await flush();
    const sent = api.apiPut.mock.calls[0];
    expect(sent[0]).toBe('/settings/severity');
    expect(sent[1].bands[0]).toEqual({ up_to: '200', level: 'GREEN' });
    expect(sent[1].escalate.red_at_quantity).toBe('50');
    expect(sent[1].require_justification_from).toBe('RED');

    api.apiDelete.mockResolvedValue({ bands: [{ up_to: 500, level: 'GREEN' }, { up_to: null, level: 'RED' }], escalate: {}, require_justification_from: 'RED' });
    await act(async () => { button('Restaurar padrão').click(); });
    await flush();
    await act(async () => { button('Confirmar').click(); });
    await flush();
    expect(api.apiDelete).toHaveBeenCalledWith('/settings/severity');
  });

  it('erro de validação do servidor é exibido; faixa pode ser adicionada e removida', async () => {
    api.apiPut.mockRejectedValue(Object.assign(new Error('Faixa 1: os tetos devem ser crescentes.'), { status: 400 }));
    await goto();
    expect(container.querySelectorAll('input[aria-label^="Teto da faixa"]')).toHaveLength(2);
    await act(async () => { button('Faixa').click(); });
    expect(container.querySelectorAll('input[aria-label^="Teto da faixa"]')).toHaveLength(3);
    await act(async () => { container.querySelector('button[aria-label="Remover faixa"]').click(); });
    expect(container.querySelectorAll('input[aria-label^="Teto da faixa"]')).toHaveLength(2);
    await act(async () => { button('Salvar').click(); });
    await flush();
    expect(container.querySelector('[role="alert"]').textContent).toContain('crescentes');
  });
});

describe('alerta urgente de ocorrência vermelha', () => {
  it('só as VERMELHAS geram texto; identifica falta/sobra, quantidade, ficha e local', () => {
    expect(occurrenceAlertText({ severity: 'GREEN', kind: 'LOSS', quantity: 3 })).toBeNull();
    expect(occurrenceAlertText({ severity: 'YELLOW', kind: 'LOSS', quantity: 3 })).toBeNull();
    expect(occurrenceAlertText(undefined)).toBeNull();
    expect(occurrenceAlertText({ severity: 'RED', kind: 'LOSS', quantity: 1, chip: { name: 'Ficha KO 1' }, binder_name: 'LISA 1' })).toBe('Falta de 1 × Ficha KO 1 (fichário LISA 1)');
    expect(occurrenceAlertText({ severity: 'RED', kind: 'SURPLUS', quantity: 2, chip: { name: 'Ficha 5000' }, tournament_name: 'Warm Up' })).toBe('Sobra de 2 × Ficha 5000 (torneio Warm Up)');
  });

  it('o alerta descreve a falta, sem valor monetário', () => {
    const t = occurrenceAlertText({ severity: 'RED', kind: 'LOSS', quantity: 1, chip: { name: 'Ficha 5000' }, binder_name: 'LISA 1', exposed_value: 50 });
    expect(t).toBe('Falta de 1 × Ficha 5000 (fichário LISA 1)');
    expect(t).not.toMatch(/R\$|expostos/);
  });

});
