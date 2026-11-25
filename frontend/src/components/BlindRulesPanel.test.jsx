// Item 6: cadastro de regras de duração dos blinds e níveis adicionais (direção).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../lib/api', () => api);
import BlindRulesPanel from './BlindRulesPanel';
import { AlertProvider } from '../contexts/AlertContext';

let root; let container;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const type = async (label, value) => { const el = container.querySelector(`[aria-label="${label}"]`); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const btn = (t) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(t));

beforeEach(() => {
  api.apiGet.mockResolvedValue({ rules: [{ _id: 'r1', name: 'Reta final', condition: 'players_lte', value: 6, minutes: 45, mode: 'auto', active: true }], changes: [{ _id: 'c1', at: '2026-10-01T20:00:00Z', session_id: 's1', kind: 'rule_applied', rule_name: 'Reta final', minutes: 45, rows_affected: 4, level_number: 22, auto: true }] });
  api.apiPost.mockResolvedValue({}); api.apiPut.mockResolvedValue({}); api.apiDelete.mockResolvedValue({});
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
const mount = async () => { await act(async () => { root.render(<AlertProvider><BlindRulesPanel tournamentId="t1" sessionId="s1" sessions={[{ _id: 's1', name: 'Dia 1A' }, { _id: 's2', name: 'Dia 1B' }]} /></AlertProvider>); }); await flush(); };

describe('BlindRulesPanel', () => {
  it('lista regras e aplicações registradas (autor/nível) — nada fixo no código', async () => {
    await mount();
    const t = container.textContent;
    expect(t).toContain('Reta final'); expect(t).toContain('jogadores restantes ≤ 6 → 45 min'); expect(t).toContain('nível 22');
  });
  it('a regra cabe numa linha: Quando [condição] [N] → níveis passam a [Z] min · só esta sessão · Adicionar', async () => {
    await mount();
    const form = container.querySelector('[data-testid="rule-form"]').textContent;
    expect(form).toContain('Quando'); expect(form).toContain('níveis passam a'); expect(form).toContain('só esta sessão'); expect(form).toContain('Adicionar');
    expect(container.textContent).not.toContain('Nível adicional no fim da estrutura');
    expect(container.textContent).not.toContain('Quando a condição for atingida');
  });
  it('cria uma regra (nome gerado da condição) e permite editar e excluir', async () => {
    await mount();
    await type('Valor da condição', '3'); await type('Duração em minutos', '30');
    await act(async () => { btn('Adicionar').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/blind-rules', expect.objectContaining({ name: 'jogadores restantes ≤ 3', condition: 'players_lte', value: 3, minutes: 30, mode: 'confirm' }));
    await act(async () => { container.querySelector('[aria-label="Editar Reta final"]').click(); });
    expect(container.querySelector('[aria-label="Valor da condição"]').value).toBe('6');
    await type('Duração em minutos', '40');
    await act(async () => { btn('Salvar').click(); });
    await flush();
    expect(api.apiPut).toHaveBeenCalledWith('/tournaments/t1/blind-rules/r1', expect.objectContaining({ minutes: 40, value: 6 }));
    await act(async () => { container.querySelector('[aria-label="Remover Reta final"]').click(); });
    expect(api.apiDelete).toHaveBeenCalledWith('/tournaments/t1/blind-rules/r1');
  });
});
