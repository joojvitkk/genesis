import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { apiPost, apiPut, apiDelete } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import { nextLevelRow, levelNumberAt, isLevelRow } from '../lib/blinds';
import NumberInput from './NumberInput';

const EMPTY = { small_blind: '', big_blind: '', ante: '', duration: '' };

/**
 * "+ Nível no fim": acrescenta um nível ao fim da estrutura da SESSÃO sugerindo o próximo da progressão (SB, BB, ante e duração
 * editáveis antes de confirmar). O nível extra (rótulo "Adicional") continua editável e removível enquanto ainda não começou;
 * toda criação, edição e remoção fica registrada com autor e horário (servidor).
 */
export default function ExtraLevel({ tournamentId, session, fallbackRows = [], canManage, onChanged }) {
  const { showAlert } = useAlert();
  const [draft, setDraft] = useState(null);          // { index: null (novo) | n (edição), ...campos }
  const [busy, setBusy] = useState(false);
  if (!session || session.status === 'finished') return null;
  const own = session.blind_structure || [];
  const rows = own.length ? own : fallbackRows;
  const started = !!session.level_started_at;
  const cur = session.current_level || 0;
  const extras = own.map((r, i) => ({ r, i })).filter(({ r, i }) => r.label === 'Adicional' && (!started || i > cur));
  const base = `/tournaments/${tournamentId}/sessions/${session._id}/blinds`;

  const openNew = () => {
    const s = nextLevelRow(rows);
    setDraft({ index: null, small_blind: String(s.small_blind), big_blind: String(s.big_blind), ante: String(s.ante || 0), duration: String(s.duration) });
  };
  const openEdit = ({ r, i }) => setDraft({ index: i, small_blind: String(r.small_blind), big_blind: String(r.big_blind), ante: String(r.ante || 0), duration: String(r.duration) });
  const body = () => ({ small_blind: Number(draft.small_blind), big_blind: Number(draft.big_blind), ante: Number(draft.ante || 0), duration: Number(draft.duration) });
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); showAlert(ok, 'success'); setDraft(null); await onChanged?.(); } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao salvar o nível', 'error'); } finally { setBusy(false); }
  };
  const confirm = (e) => {
    e.preventDefault();
    if (draft.index === null) run(() => apiPost(`${base}/append`, { rows: [body()] }), 'Nível acrescentado ao fim da estrutura.');
    else run(() => apiPut(`${base}/extra/${draft.index}`, body()), 'Nível atualizado.');
  };
  const remove = ({ i }) => run(() => apiDelete(`${base}/extra/${i}`), 'Nível removido.');
  const field = (k, label) => (
    <label className="label">{label}<NumberInput aria-label={label} value={draft[k]} onChange={(v) => setDraft({ ...draft, [k]: v })} className="input w-28 text-center" /></label>
  );

  return (
    <div className="card space-y-3 p-4" data-testid="extra-level">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canManage && !draft && <button type="button" onClick={openNew} className="btn btn-secondary btn-sm"><Plus size={13} /> Nível no fim</button>}
      </div>
      {draft && (
        <form onSubmit={confirm} className="flex flex-wrap items-end gap-3">
          {field('small_blind', 'SB')}{field('big_blind', 'BB')}{field('ante', 'Ante')}{field('duration', 'Min')}
          <button type="submit" disabled={busy} className="btn btn-primary btn-sm"><Check size={13} /> Confirmar</button>
          <button type="button" onClick={() => setDraft(null)} className="btn btn-neutral btn-sm"><X size={13} /> Cancelar</button>
        </form>
      )}
      {extras.length > 0 && (
        <ul className="divide-y divide-line-soft text-sm" data-testid="extra-list">
          {extras.map((x) => (
            <li key={x.i} className="flex items-center justify-between gap-2 py-2">
              <span className="font-bold tabular-nums">Nível {levelNumberAt(rows, x.i) + (session.level_offset || 0)} · {Number(x.r.small_blind).toLocaleString('pt-BR')}/{Number(x.r.big_blind).toLocaleString('pt-BR')}{x.r.ante ? ` · ante ${Number(x.r.ante).toLocaleString('pt-BR')}` : ''} · {x.r.duration} min</span>
              {canManage && isLevelRow(x.r) && (
                <span className="flex gap-1">
                  <button type="button" onClick={() => openEdit(x)} aria-label="Editar nível" className="btn btn-ghost btn-icon"><Pencil size={14} /></button>
                  <button type="button" onClick={() => remove(x)} aria-label="Remover nível" className="btn btn-ghost btn-icon"><Trash2 size={14} /></button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
