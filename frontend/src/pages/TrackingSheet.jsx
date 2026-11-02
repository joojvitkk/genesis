import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListOrdered, Plus, Save, Copy, Trash2, Coffee, Utensils } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { can } from '../config';
import BlindRowsTable from '../components/BlindRowsTable';
import { nextLevelRow, breakRow, cloneRows, validateRows, totalMinutes, isLevelRow } from '../lib/blinds';

const EMPTY = { _id: null, name: '', rows: [], notes: '' };

/**
 * Tracking Sheet: cadastro de estruturas de blinds reutilizáveis (templates). Valores 100% manuais — sem fórmulas.
 * Admin edita; Material e Salão apenas consultam. Ao usar em um torneio a estrutura é COPIADA (ver Torneios.jsx).
 */
export default function TrackingSheet() {
  const { showAlert, showConfirm } = useAlert();
  const canManage = can(getStoredUser()?.role, 'torneios', 'manage');
  const [list, setList] = useState([]);
  const [draft, setDraft] = useState(null);       // estrutura aberta no editor
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setList(await apiGet('/blind-templates')); }
    catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar estruturas', 'error'); }
  }, [showAlert]);
  useEffect(() => { load(); }, [load]);

  const open = async (tpl) => {
    if (dirty && !(await showConfirm('Descartar as alterações não salvas?'))) return;
    setDraft({ _id: tpl._id, name: tpl.name, notes: tpl.notes || '', rows: cloneRows(tpl.rows) });
    setDirty(false);
  };
  const change = (patch) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  const addRow = (row) => change({ rows: [...draft.rows, row] });

  const onCell = (idx, field, value) => change({ rows: draft.rows.map((r, i) => (i === idx ? { ...r, [field]: value === '' ? '' : Number(value) } : r)) });
  const onRemove = (idx) => change({ rows: draft.rows.filter((_, i) => i !== idx) });

  const save = async () => {
    const name = draft.name.trim();
    if (!name) return showAlert('Dê um nome à estrutura.', 'error');
    const problem = validateRows(draft.rows);
    if (problem) return showAlert(problem, 'error');
    setBusy(true);
    try {
      const body = { name, notes: draft.notes, rows: draft.rows };
      const saved = draft._id ? await apiPut(`/blind-templates/${draft._id}`, body) : await apiPost('/blind-templates', body);
      setDraft({ _id: saved._id, name: saved.name, notes: saved.notes || '', rows: cloneRows(saved.rows) });
      setDirty(false);
      showAlert('Estrutura salva!', 'success');
      load();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao salvar', 'error'); } finally { setBusy(false); }
  };

  const duplicate = () => { setDraft({ ...draft, _id: null, name: `${draft.name} (cópia)` }); setDirty(true); };

  const remove = async () => {
    if (!draft?._id || !(await showConfirm(`Excluir a estrutura "${draft.name}"? Torneios que já a usam não são afetados.`))) return;
    try { await apiDelete(`/blind-templates/${draft._id}`); setDraft(null); setDirty(false); load(); showAlert('Estrutura excluída.', 'success'); }
    catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao excluir', 'error'); }
  };

  const levels = useMemo(() => (draft ? draft.rows.filter(isLevelRow).length : 0), [draft]);
  const hours = (min) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-fg"><ListOrdered className="text-brand-fg" size={24} aria-hidden="true" /> Tracking Sheet</h1>
          <p className="text-sm text-fg-muted">Estruturas de blinds definidas pela direção. Ao escolher uma no torneio, ela é copiada — o cadastro original não muda.</p>
        </div>
        {canManage && <button type="button" className="btn btn-primary" onClick={() => { setDraft({ ...EMPTY }); setDirty(true); }}><Plus size={16} /> Nova estrutura</button>}
      </header>

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <section aria-label="Estruturas cadastradas" className="space-y-2">
          {list.length === 0 && <p className="card text-sm text-fg-subtle">Nenhuma estrutura cadastrada.</p>}
          {list.map((t) => (
            <button key={t._id} type="button" onClick={() => open(t)} aria-current={draft?._id === t._id ? 'true' : undefined}
              className={`card block w-full text-left transition-colors hover:bg-sunken ${draft?._id === t._id ? 'border-brand' : ''}`}>
              <p className="font-semibold text-fg">{t.name}</p>
              <p className="text-xs text-fg-subtle">{t.rows.filter(isLevelRow).length} níveis · {hours(totalMinutes(t.rows))}</p>
            </button>
          ))}
        </section>

        <section aria-label="Editor da estrutura" className="card space-y-4">
          {!draft ? <p className="text-sm text-fg-subtle">Selecione uma estrutura {canManage ? 'ou crie uma nova' : 'para consultar'}.</p> : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-48 flex-1">
                  <label htmlFor="ts-name" className="label">Nome da estrutura</label>
                  <input id="ts-name" className="input" value={draft.name} disabled={!canManage} onChange={(e) => change({ name: e.target.value })} placeholder="Ex.: Warm Up 2026" />
                </div>
                <p className="pb-2 text-sm text-fg-muted">{levels} níveis · {hours(totalMinutes(draft.rows))}</p>
              </div>

              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow(nextLevelRow(draft.rows))}><Plus size={14} /> Nível</button>
                  {[15, 45].map((d) => <button key={d} type="button" className="btn btn-secondary btn-sm" onClick={() => addRow(breakRow(d))}><Coffee size={14} /> Break {d} min</button>)}
                  {[60, 90].map((d) => <button key={d} type="button" className="btn btn-secondary btn-sm" onClick={() => addRow(breakRow(d, true))}><Utensils size={14} /> Dinner Break {d} min</button>)}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow({ row_type: 'end_registration', label: 'Fim do Registro' })}>Fim do Registro</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => addRow({ row_type: 'end_day', label: 'Fim do Dia' })}>Fim do Dia</button>
                </div>
              )}

              <BlindRowsTable rows={draft.rows} onCell={onCell} onRemove={onRemove} readOnly={!canManage} />

              {canManage && (
                <div className="flex flex-wrap justify-end gap-2 border-t border-line-soft pt-4">
                  {draft._id && <button type="button" className="btn btn-danger" onClick={remove}><Trash2 size={16} /> Excluir</button>}
                  {draft._id && <button type="button" className="btn btn-secondary" onClick={duplicate}><Copy size={16} /> Duplicar</button>}
                  <button type="button" className="btn btn-primary" disabled={busy || !dirty} onClick={save}><Save size={16} /> Salvar</button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
