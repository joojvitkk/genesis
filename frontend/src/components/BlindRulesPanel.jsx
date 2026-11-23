import { useCallback, useEffect, useState } from 'react';
import { Timer, Plus, Trash2 } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import CustomSelect from './CustomSelect';

const CONDITIONS = [
  { value: 'players_lte', label: 'jogadores restantes ≤' },
  { value: 'level_gte', label: 'nível ≥' },
  { value: 'actions_gte', label: 'ações (entradas) ≥' },
];
const MODES = [{ value: 'confirm', label: 'Pedir confirmação' }, { value: 'auto', label: 'Aplicar automaticamente' }];

/**
 * Regras de duração dos blinds (editáveis por torneio, com exceção por sessão) e níveis adicionais no fim da estrutura.
 * Cadastro e níveis adicionais: direção. Cada aplicação fica registrada com autor, horário e nível.
 */
export default function BlindRulesPanel({ tournamentId, sessions = [], sessionId }) {
  const { showAlert } = useAlert();
  const [data, setData] = useState({ rules: [], changes: [] });
  const [form, setForm] = useState({ name: '', condition: 'players_lte', value: '', minutes: '', mode: 'confirm', scope: 'tournament' });
  const [extra, setExtra] = useState({ small_blind: '', big_blind: '', ante: '', duration: '' });
  const load = useCallback(() => apiGet(`/tournaments/${tournamentId}/blind-rules`).then(setData).catch(() => {}), [tournamentId]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    try {
      await apiPost(`/tournaments/${tournamentId}/blind-rules`, {
        name: form.name, condition: form.condition, value: Number(form.value), minutes: Number(form.minutes), mode: form.mode,
        session_id: form.scope === 'session' ? sessionId : undefined,
      });
      setForm((f) => ({ ...f, name: '', value: '', minutes: '' }));
      await load();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao salvar a regra', 'error'); }
  };
  const remove = async (id) => { try { await apiDelete(`/tournaments/${tournamentId}/blind-rules/${id}`); await load(); } catch (e) { if (e.status !== 401) showAlert(e.message, 'error'); } };
  const append = async () => {
    if (!sessionId) return showAlert('Escolha a sessão que recebe os níveis adicionais.', 'error');
    try {
      await apiPost(`/tournaments/${tournamentId}/sessions/${sessionId}/blinds/append`, { rows: [{ small_blind: Number(extra.small_blind), big_blind: Number(extra.big_blind), ante: Number(extra.ante) || 0, duration: Number(extra.duration) }] });
      setExtra({ small_blind: '', big_blind: '', ante: '', duration: '' });
      showAlert('Nível adicional acrescentado ao fim da estrutura.', 'success');
      await load();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao acrescentar o nível', 'error'); }
  };
  const cond = (c) => CONDITIONS.find((x) => x.value === c)?.label;
  const sessionName = (id) => sessions.find((s) => s._id === id)?.name;

  return (
    <div className="card space-y-4 p-6" data-testid="blind-rules">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Timer className="text-brand-fg" size={20} /> Regras de duração dos blinds</h3>
      <p className="text-xs text-fg-muted">Quando a condição for atingida, a duração dos níveis seguintes passa ao valor da regra. Vale uma vez por sessão; a regra da sessão substitui a do torneio de mesmo nome.</p>

      {data.rules.filter((r) => r.active).length === 0 ? <p className="text-sm italic text-fg-subtle">Nenhuma regra cadastrada.</p> : (
        <ul className="divide-y divide-line-soft">
          {data.rules.filter((r) => r.active).map((r) => (
            <li key={r._id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span><b>{r.name}</b> · quando {cond(r.condition)} {r.value} → {r.minutes} min · {r.mode === 'auto' ? 'automática' : 'com confirmação'}{r.session_id ? ` · só ${sessionName(r.session_id) || 'a sessão'}` : ''}</span>
              <button type="button" onClick={() => remove(r._id)} className="btn btn-ghost btn-icon" aria-label={`Remover ${r.name}`}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 md:grid-cols-6">
        <input className="input md:col-span-2" placeholder="Nome da regra" aria-label="Nome da regra" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <CustomSelect options={CONDITIONS} value={form.condition} onChange={(v) => setForm({ ...form, condition: v })} />
        <input className="input" type="number" min="0" placeholder="Valor" aria-label="Valor da condição" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        <input className="input" type="number" min="1" placeholder="Minutos" aria-label="Duração em minutos" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
        <CustomSelect options={MODES} value={form.mode} onChange={(v) => setForm({ ...form, mode: v })} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {sessionId && sessions.length > 1 && (
          <label className="flex items-center gap-2 text-xs font-bold text-fg-muted"><input type="checkbox" checked={form.scope === 'session'} onChange={(e) => setForm({ ...form, scope: e.target.checked ? 'session' : 'tournament' })} /> Só para a sessão selecionada (exceção)</label>
        )}
        <button type="button" onClick={create} className="btn btn-primary"><Plus size={14} /> Adicionar regra</button>
      </div>

      <div className="border-t border-line pt-4">
        <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-fg-subtle">Nível adicional no fim da estrutura (sessão selecionada)</h4>
        <div className="grid gap-2 md:grid-cols-5">
          {[['small_blind', 'SB'], ['big_blind', 'BB'], ['ante', 'Ante'], ['duration', 'Minutos']].map(([k, label]) => (
            <input key={k} className="input" type="number" min="0" placeholder={label} aria-label={`Adicional ${label}`} value={extra[k]} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} />
          ))}
          <button type="button" onClick={append} className="btn btn-secondary">Acrescentar</button>
        </div>
      </div>

      {data.changes.length > 0 && (
        <div className="border-t border-line pt-4">
          <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-fg-subtle">Aplicações registradas</h4>
          <ul className="space-y-1 text-xs text-fg-muted">
            {data.changes.map((c) => (
              <li key={c._id}>{new Date(c.at).toLocaleString('pt-BR')} · {sessionName(c.session_id) || 'sessão'} · nível {c.level_number ?? '—'} · {c.kind === 'rule_applied' ? `regra "${c.rule_name}" → ${c.minutes} min (${c.rows_affected} nível(is))` : `+${c.rows_affected} nível(is) adicional(is)`} · {c.auto ? 'automática' : c.user_name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
