// Item 6: cadastro de regras de duração dos blinds e níveis adicionais (direção).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn(), apiDelete: vi.fn() }));
vi.mock('../lib/api', () => api);
import BlindRulesPanel from './BlindRulesPanel';
import { AlertProvider } from '../contexts/AlertContext';

let root; let container;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const type = async (label, value) => { const el = container.querySelector(`[aria-label="${label}"]`); await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); };
const btn = (t) => [...container.querySelectorAll('button')].find((b) => b.textContent.includes(t));

beforeEach(() => {
  api.apiGet.mockResolvedValue({ rules: [{ _id: 'r1', name: 'Reta final', condition: 'players_lte', value: 6, minutes: 45, mode: 'auto', active: true }], changes: [{ _id: 'c1', at: '2026-10-01T20:00:00Z', session_id: 's1', kind: 'rule_applied', rule_name: 'Reta final', minutes: 45, rows_affected: 4, level_number: 22, auto: true }] });
  api.apiPost.mockResolvedValue({});
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
  it('cria uma regra editável e acrescenta um nível adicional na sessão selecionada', async () => {
    await mount();
    await type('Nome da regra', 'Blinds 30'); await type('Valor da condição', '3'); await type('Duração em minutos', '30');
    await act(async () => { btn('Adicionar regra').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/blind-rules', expect.objectContaining({ name: 'Blinds 30', condition: 'players_lte', value: 3, minutes: 30, mode: 'confirm' }));
    await type('Adicional SB', '700'); await type('Adicional BB', '1400'); await type('Adicional Minutos', '20');
    await act(async () => { btn('Acrescentar').click(); });
    await flush();
    expect(api.apiPost).toHaveBeenCalledWith('/tournaments/t1/sessions/s1/blinds/append', { rows: [{ small_blind: 700, big_blind: 1400, ante: 0, duration: 20 }] });
  });
});
