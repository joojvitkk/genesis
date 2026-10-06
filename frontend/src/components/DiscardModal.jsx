import { locale } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { X, PackageMinus } from 'lucide-react';
import { apiPost } from '../lib/api';
import CustomSelect from './CustomSelect';

const fmt = (n) => (n ?? 0).toLocaleString(locale());

/**
 * Descarte de stack (G7): um stack é abandonado e as fichas voltam do JOGO para o fichário.
 * O operador só informa quantas fichas de cada denominação; o valor total vem do SERVIDOR (/discards/preview).
 * O descarte não precisa ser a composição original do stack. Lançamento imutável (só estorno).
 */
export default function DiscardModal({ tournamentId, sessionId, rows, allocations, onClose, onDone }) {
  const inPlay = rows.filter((r) => r.on_table > 0);
  const [qty, setQty] = useState({});
  const [binderId, setBinderId] = useState(allocations.length === 1 ? (allocations[0].binder_id?._id || '') : '');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const chips = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([chip_id, v]) => ({ chip_id, quantity: Number(v) }));
  const over = (r) => Number(qty[r.chip._id]) > r.on_table;

  // valor total calculado pelo servidor (nunca no navegador)
  useEffect(() => {
    if (!chips.length) { setPreview(null); return undefined; }
    const timer = setTimeout(() => {
      apiPost(`/tournaments/${tournamentId}/discards/preview`, { chips })
        .then((p) => { setPreview(p); setError(null); })
        .catch((e) => { if (e.status !== 401) { setPreview(null); setError(e.message); } });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(chips), tournamentId]);

  const submit = async () => {
    if (!chips.length) return setError('Informe as fichas descartadas.');
    if (!binderId) return setError('Escolha o fichário que recebe as fichas.');
    setBusy(true); setError(null);
    try {
      await apiPost(`/tournaments/${tournamentId}/discards`, {
        chips, binder_id: binderId, session_id: sessionId || undefined,
        note: note.trim() || undefined,
      });
      await onDone();
    } catch (e) {
      if (e.status !== 401) setError(e.message || 'Erro ao registrar o descarte'); // ex.: 409 acima do que está em jogo
    } finally { setBusy(false); }
  };

  const numCls = 'w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-brand ';
  const inputCls = 'w-full rounded-xl border border-line bg-sunken px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-sunken';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Descartar stack">
      <div className="card max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold"><PackageMinus size={18} className="text-red-500" /> Descartar stack</h3>
            <p className="mt-1 text-xs text-fg-muted">As fichas saem do jogo e voltam ao fichário. Informe o que foi devolvido, por denominação (não precisa ser o stack original).</p>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="p-1 text-fg-subtle hover:text-red-500"><X size={18} /></button>
        </div>

        {inPlay.length === 0 ? <p className="py-4 text-center text-sm italic text-fg-subtle">Não há fichas em jogo.</p> : (
          <div className="flex flex-wrap gap-3">
            {inPlay.map((r) => (
              <label key={r.chip._id} className="flex items-center gap-2 text-xs font-bold text-fg-muted">
                <span className="h-3 w-3 rounded-full border border-line" style={{ backgroundColor: r.chip.color }} /> {fmt(r.chip.value)} <span className="text-fg-subtle">(no Salão {fmt(r.on_table)})</span>
                <input type="number" min="0" step="1" placeholder="0" aria-label={`Descartar ${r.chip.value}`} value={qty[r.chip._id] ?? ''}
                  onChange={(e) => setQty((s) => ({ ...s, [r.chip._id]: e.target.value }))} className={`${numCls} ${over(r) ? 'border-red-400' : ''}`} />
              </label>
            ))}
          </div>
        )}

        {allocations.length > 1 && (
          <CustomSelect options={allocations.map((a) => ({ value: a.binder_id?._id, label: a.binder_id?.name }))} value={binderId} onChange={setBinderId} placeholder="Fichário que recebe…" />
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação (opcional)" className={inputCls} />

        {preview && <p className="text-xs font-bold text-fg-muted">Total: {fmt(preview.total_chips)} ficha(s) · valor {fmt(preview.total_value)}</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-bold text-red-600 dark:bg-red-500/10">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-4 py-2.5 text-xs font-bold text-fg-muted hover:bg-sunken">Cancelar</button>
          <button onClick={submit} disabled={busy || !chips.length} className="rounded-xl bg-red-500 px-6 py-2.5 text-xs font-bold text-white hover:bg-red-600 disabled:opacity-40">{busy ? 'Registrando…' : 'Registrar descarte'}</button>
        </div>
      </div>
    </div>
  );
}
