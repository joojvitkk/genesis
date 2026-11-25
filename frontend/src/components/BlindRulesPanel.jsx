import { useCallback, useEffect, useState } from 'react';
import { Timer, Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import CustomSelect from './CustomSelect';
import NumberInput from './NumberInput';

const CONDITIONS = [
  { value: 'players_lte', label: 'jogadores restantes ≤' },
  { value: 'level_gte', label: 'nível ≥' },
  { value: 'actions_gte', label: 'ações ≥' },
];
const EMPTY = { condition: 'players_lte', value: '', minutes: '', mode: 'confirm', sessionOnly: false };

/**
 * Regras de duração dos blinds (por torneio, com exceção por sessão), numa linha só e na largura toda:
 *   Quando [condição] [N] → níveis passam a [Z] min · [só esta sessão] · Adicionar
 * As cadastradas aparecem como lista curta, com editar e excluir. O cadastro é da direção; cada aplicação fica registrada
 * com autor, horário e nível. Os níveis adicionais no fim da estrutura ficam junto da tabela de blinds (ExtraLevel).
 */
export default function BlindRulesPanel({ tournamentId, sessions = [], sessionId }) {
  const { showAlert } = useAlert();
  const [data, setData] = useState({ rules: [], changes: [] });
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // id da regra em edição
  const load = useCallback(() => apiGet(`/tournaments/${tournamentId}/blind-rules`).then(setData).catch(() => {}), [tournamentId]);
  useEffect(() => { load(); }, [load]);

  const label = (c) => CONDITIONS.find((x) => x.value === c)?.label;
  const save = async () => {
    const name = `${label(form.condition)} ${form.value}`;
    const body = { name, condition: form.condition, value: Number(form.value), minutes: Number(form.minutes), mode: form.mode };
    try {
      if (editing) await apiPut(`/tournaments/${tournamentId}/blind-rules/${editing}`, body);
      else await apiPost(`/tournaments/${tournamentId}/blind-rules`, { ...body, session_id: form.sessionOnly ? sessionId : undefined });
      setForm(EMPTY); setEditing(null);
      await load();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao salvar a regra', 'error'); }
  };
  const remove = async (id) => { try { await apiDelete(`/tournaments/${tournamentId}/blind-rules/${id}`); await load(); } catch (e) { if (e.status !== 401) showAlert(e.message, 'error'); } };
  const edit = (r) => { setEditing(r._id); setForm({ condition: r.condition, value: String(r.value), minutes: String(r.minutes), mode: r.mode, sessionOnly: !!r.session_id }); };
  const sessionName = (id) => sessions.find((s) => s._id === id)?.name;
  const active = data.rules.filter((r) => r.active);

  return (
    <div className="card space-y-4 p-4 md:p-6" data-testid="blind-rules">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Timer className="text-brand-fg" size={20} /> Regras de duração dos blinds</h3>

      <div className="flex flex-wrap items-center gap-2" data-testid="rule-form">
        <span className="text-sm font-bold text-fg-muted">Quando</span>
        <div className="w-56"><CustomSelect aria-label="Condição" options={CONDITIONS} value={form.condition} onChange={(v) => setForm({ ...form, condition: v })} /></div>
        <NumberInput className="input w-24 text-center" aria-label="Valor da condição" value={form.value} onChange={(v) => setForm({ ...form, value: v })} />
        <span className="text-sm font-bold text-fg-muted">→ níveis passam a</span>
        <NumberInput className="input w-20 text-center" aria-label="Duração em minutos" value={form.minutes} onChange={(v) => setForm({ ...form, minutes: v })} />
        <span className="text-sm font-bold text-fg-muted">min</span>
        {!editing && sessionId && sessions.length > 1 && (
          <label className="flex items-center gap-2 text-sm font-bold text-fg-muted"><input type="checkbox" checked={form.sessionOnly} onChange={(e) => setForm({ ...form, sessionOnly: e.target.checked })} /> só esta sessão</label>
        )}
        <button type="button" onClick={save} className="btn btn-primary">{editing ? <><Check size={14} /> Salvar</> : <><Plus size={14} /> Adicionar</>}</button>
        {editing && <button type="button" onClick={() => { setEditing(null); setForm(EMPTY); }} className="btn btn-neutral"><X size={14} /> Cancelar</button>}
      </div>

      {active.length > 0 && (
        <ul className="divide-y divide-line-soft">
          {active.map((r) => (
            <li key={r._id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span><b>{r.name}</b> · quando {label(r.condition)} {Number(r.value).toLocaleString('pt-BR')} → {r.minutes} min{r.session_id ? ` · só ${sessionName(r.session_id) || 'a sessão'}` : ''}</span>
              <span className="flex gap-1">
                <button type="button" onClick={() => edit(r)} className="btn btn-ghost btn-icon" aria-label={`Editar ${r.name}`}><Pencil size={14} /></button>
                <button type="button" onClick={() => remove(r._id)} className="btn btn-ghost btn-icon" aria-label={`Remover ${r.name}`}><Trash2 size={14} /></button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {data.changes.length > 0 && (
        <ul className="space-y-1 border-t border-line pt-3 text-xs text-fg-muted">
          {data.changes.map((c) => (
            <li key={c._id}>{new Date(c.at).toLocaleString('pt-BR')} · {sessionName(c.session_id) || 'sessão'} · nível {c.level_number ?? '—'} · {{ rule_applied: `regra "${c.rule_name}" → ${c.minutes} min (${c.rows_affected} nível(is))`, levels_added: `+${c.rows_affected} nível adicional`, level_edited: 'nível adicional editado', level_removed: 'nível adicional removido' }[c.kind]} · {c.auto ? 'automática' : c.user_name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
