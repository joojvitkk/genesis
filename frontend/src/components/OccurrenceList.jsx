import { locale } from '../lib/i18n';
import { useState } from 'react';
import { X } from 'lucide-react';
import { apiPost } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import CustomSelect from './CustomSelect';
import SeverityBadge from './SeverityBadge';

const fmt = (n) => (n ?? 0).toLocaleString(locale());
export const STATUS_LABEL = {
  open: 'Aberta', justified: 'Justificada', partially_recovered: 'Parcialmente recuperada', recovered: 'Recuperada', closed: 'Encerrada', voided: 'Estornada',
};
const ACTION_LABEL = { opened: 'Aberta', justified: 'Justificada', recovered: 'Recuperação', recovery_reversed: 'Recuperação estornada', closed: 'Encerrada', voided: 'Estornada' };
const ACTIVE = (o) => !['closed', 'voided'].includes(o.status);

/** Recuperar fichas de uma ocorrência (perda de fichário volta ao mesmo fichário; perda em jogo pede o fichário que recebe). */
function RecoverModal({ occurrence: o, binders, onClose, onDone }) {
  const [quantity, setQuantity] = useState(String(o.remaining));
  const [binderId, setBinderId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (o.scope === 'tournament' && !binderId) return setError('Escolha o fichário que recebe as fichas.');
    setBusy(true); setError(null);
    try {
      await apiPost(`/occurrences/${o._id}/recover`, { quantity: Number(quantity), binder_id: o.scope === 'tournament' ? binderId : undefined, note: note.trim() || undefined });
      await onDone();
    } catch (e) { if (e.status !== 401) setError(e.message || 'Erro ao recuperar'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Recuperar fichas">
      <div className="card max-h-[92vh] w-full max-w-md overflow-y-auto space-y-4 p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold">Recuperar fichas</h3>
            <p className="mt-1 text-xs text-fg-muted">{fmt(o.chip_id?.value)} · faltam {fmt(o.remaining)} de {fmt(o.quantity)}</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-1 text-fg-subtle hover:text-red-500"><X size={18} /></button>
        </div>
        <input type="number" min="1" max={o.remaining} step="1" aria-label="Quantidade recuperada" value={quantity} onChange={(e) => setQuantity(e.target.value)}
          className="input w-full" />
        {o.scope === 'tournament' && <CustomSelect options={binders.map((b) => ({ value: b._id, label: b.name }))} value={binderId} onChange={setBinderId} placeholder="Fichário que recebe…" />}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação (opcional) — ex.: achada sob a mesa"
          className="input w-full" />
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-bold text-red-600 dark:bg-red-500/10">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-xs font-bold text-fg-muted hover:bg-sunken">Cancelar</button>
          <button onClick={submit} disabled={busy} className="btn btn-success disabled:opacity-40">{busy ? 'Registrando…' : 'Registrar recuperação'}</button>
        </div>
      </div>
    </div>
  );
}

/** Lista de ocorrências com semáforo e as ações do ciclo de vida (justificar, recuperar, encerrar, estornar). */
export default function OccurrenceList({ items, binders, canOperate, isAdmin, onChanged }) {
  const { showAlert, showPrompt } = useAlert();
  const [recovering, setRecovering] = useState(null);

  const act = async (fn, okMsg) => {
    try { await fn(); if (okMsg) showAlert(okMsg, 'success'); await onChanged(); } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro', 'error'); }
  };
  const justify = async (o) => {
    const justification = await showPrompt('Justificativa da ocorrência:', { title: 'Justificar', confirmLabel: 'Justificar', defaultValue: o.justification || '' });
    if (justification) await act(() => apiPost(`/occurrences/${o._id}/justify`, { justification }), 'Ocorrência justificada.');
  };
  const close = async (o) => {
    const justification = await showPrompt('Justificativa do encerramento (a perda restante fica registrada como definitiva):', { title: 'Encerrar ocorrência', confirmLabel: 'Encerrar', defaultValue: o.justification || '' });
    if (justification) await act(() => apiPost(`/occurrences/${o._id}/close`, { justification }), 'Ocorrência encerrada.');
  };
  const voidIt = async (o) => {
    const reason = await showPrompt('Motivo do estorno (contagem lançada errada):', { title: 'Estornar ocorrência', confirmLabel: 'Estornar' });
    if (reason) await act(() => apiPost(`/occurrences/${o._id}/reverse`, { reason }), 'Ocorrência estornada.');
  };
  const undoRecovery = async (o, batch_id) => {
    const reason = await showPrompt('Motivo do estorno da recuperação:', { title: 'Estornar recuperação', confirmLabel: 'Estornar' });
    if (reason) await act(() => apiPost(`/occurrences/${o._id}/recoveries/reverse`, { batch_id, reason }), 'Recuperação estornada.');
  };

  if (!items.length) return <p className="py-10 text-center text-sm italic text-fg-subtle">Nenhuma ocorrência.</p>;
  const btn = 'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors';

  return (
    <>
      <ul className="space-y-3">
        {items.map((o) => {
          const undone = new Set(o.history.filter((h) => h.action === 'recovery_reversed').map((h) => String(h.batch_id)));
          return (
            <li key={o._id} data-occurrence={o._id} className={`rounded-2xl border border-line bg-surface p-4  ${ACTIVE(o) ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <SeverityBadge level={o.severity} />
                <span className="text-sm font-bold">
                  <span className="mr-1.5 inline-block h-3 w-3 rounded-full border border-line align-middle" style={{ backgroundColor: o.chip_id?.color }} />
                  {fmt(o.chip_id?.value)} × {fmt(o.quantity)} {o.kind === 'LOSS' ? 'faltando' : 'a mais'}
                </span>
                <span className="text-xs text-fg-muted">{o.scope === 'binder' ? `Fichário ${o.binder_id?.name || ''}` : `Jogo · ${o.tournament_id?.name || ''}`}</span>
                <span className="ml-auto rounded-md bg-raised px-2 py-1 text-xs font-bold text-fg-muted dark:bg-zinc-800">{STATUS_LABEL[o.status]}</span>
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                {o.expected != null && <>esperado {fmt(o.expected)} · contado {fmt(o.counted)} · </>}
                {o.recovered_quantity > 0 && <>recuperadas {fmt(o.recovered_quantity)} · </>}
                {o.remaining > 0 && <>faltam {fmt(o.remaining)} · </>}
                {o.user_name} · {new Date(o.createdAt).toLocaleString(locale())}
              </p>
              {o.justification && <p className="mt-1 text-xs italic text-fg-muted">“{o.justification}”</p>}
              {o.status === 'open' && o.severity !== 'GREEN' && <p className="mt-1 text-xs font-bold text-amber-600">Aguardando justificativa.</p>}

              <div className="mt-3 flex flex-wrap gap-2">
                {canOperate && ACTIVE(o) && <button onClick={() => justify(o)} className={`${btn} bg-raised text-fg hover:bg-gray-200 dark:bg-zinc-800 `}>Justificar</button>}
                {canOperate && ACTIVE(o) && o.kind === 'LOSS' && o.remaining > 0 && <button onClick={() => setRecovering(o)} className={`${btn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-500/10`}>Recuperar</button>}
                {isAdmin && ACTIVE(o) && o.status !== 'recovered' && <button onClick={() => close(o)} className={`${btn} bg-raised text-fg hover:bg-gray-200 dark:bg-zinc-800 `}>Encerrar</button>}
                {isAdmin && o.status !== 'voided' && <button onClick={() => voidIt(o)} className={`${btn} text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-500/10`}>Estornar ocorrência</button>}
              </div>

              <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-bold uppercase tracking-wide text-fg-subtle">Histórico ({o.history.length})</summary>
                <ol className="mt-2 space-y-1">
                  {o.history.map((h, i) => (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-fg-muted">
                      <span className="font-bold text-fg">{ACTION_LABEL[h.action] || h.action}{h.quantity ? ` · ${fmt(h.quantity)}` : ''}</span>
                      <span>{h.user_name} · {new Date(h.at).toLocaleString(locale())}</span>
                      {h.note && <span className="italic">“{h.note}”</span>}
                      {isAdmin && h.action === 'recovered' && ACTIVE(o) && !undone.has(String(h.batch_id)) && (
                        <button onClick={() => undoRecovery(o, h.batch_id)} className="font-bold text-purple-500 hover:underline">Estornar recuperação</button>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          );
        })}
      </ul>
      {recovering && <RecoverModal occurrence={recovering} binders={binders} onClose={() => setRecovering(null)} onDone={async () => { setRecovering(null); showAlert('Recuperação registrada!', 'success'); await onChanged(); }} />}
    </>
  );
}
