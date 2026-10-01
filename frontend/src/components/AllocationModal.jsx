import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Boxes, AlertCircle } from 'lucide-react';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import CustomSelect from './CustomSelect';
import AllocationMatrix from './AllocationMatrix';

const MODES = [
  { v: 'binder', label: 'Fichário inteiro', hint: 'Reserva todas as fichas do fichário, na quantidade do saldo.' },
  { v: 'denominations', label: 'Por denominação', hint: 'Escolha as denominações (ex.: só ≥ 5.000). Reserva o saldo inteiro delas.' },
  { v: 'quantities', label: 'Quantidade', hint: 'Informe quanto de cada ficha. Não pode passar do livre.' },
];
const fmt = (n) => (n ?? 0).toLocaleString('pt-BR');

/**
 * Aloca fichas de um fichário a um torneio (ou edita uma alocação existente).
 * A regra `quantidade ≤ livre` é do SERVIDOR: aqui o erro (409, com o excesso e quem segura) é exibido, não só avisado.
 */
export default function AllocationModal({ tournament, editing, onClose, onDone }) {
  const { showAlert } = useAlert();
  const [binders, setBinders] = useState([]);
  const [binderId, setBinderId] = useState(editing ? (editing.binder_id?._id || editing.binder_id) : '');
  const [matrix, setMatrix] = useState(null);
  const [mode, setMode] = useState(editing ? 'quantities' : 'binder');
  const [picked, setPicked] = useState({});     // denominações escolhidas: { chipId: true }
  const [range, setRange] = useState({ min: '', max: '' });
  const [qtys, setQtys] = useState({});         // quantidades por ficha
  const [error, setError] = useState(null);     // { message, details }
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!editing) apiGet('/binders').then(setBinders).catch(() => {}); }, [editing]);
  useEffect(() => {
    if (!binderId) return;
    let alive = true;
    apiGet('/allocations/matrix', { binder_id: binderId }).then((m) => {
      if (!alive) return;
      setMatrix(m);
      if (editing) setQtys(Object.fromEntries(editing.chips.map((c) => [c.chip_id?._id || c.chip_id, String(c.quantity)])));
    }).catch((e) => showAlert(e.message || 'Erro ao carregar o fichário', 'error'));
    return () => { alive = false; };
  }, [binderId, editing, showAlert]);

  const binderOptions = useMemo(() => binders.map((b) => ({ value: b._id, label: b.code ? `${b.name} (${b.code})` : b.name })), [binders]);
  const own = editing?._id;

  // quais denominações a faixa de valor seleciona
  const inRange = (row) => {
    const min = range.min === '' ? null : Number(range.min);
    const max = range.max === '' ? null : Number(range.max);
    return row.balance > 0 && (min === null || row.chip.value >= min) && (max === null || row.chip.value <= max);
  };

  const submit = async () => {
    setError(null);
    let body;
    if (mode === 'binder') body = { binder_id: binderId, mode };
    else if (mode === 'denominations') {
      const ids = Object.keys(picked).filter((k) => picked[k]);
      const hasRange = range.min !== '' || range.max !== '';
      if (!ids.length && !hasRange) return setError({ message: 'Escolha ao menos uma denominação ou informe uma faixa de valor.' });
      body = { binder_id: binderId, mode, ...(ids.length ? { chip_ids: ids } : { min_value: range.min === '' ? undefined : Number(range.min), max_value: range.max === '' ? undefined : Number(range.max) }) };
    } else {
      const chips = Object.entries(qtys).filter(([, v]) => Number(v) > 0).map(([chip_id, v]) => ({ chip_id, quantity: Number(v) }));
      if (!chips.length) return setError({ message: 'Informe a quantidade de ao menos uma ficha.' });
      body = editing ? { chips } : { binder_id: binderId, mode, chips };
    }
    setBusy(true);
    try {
      if (editing) await apiPut(`/allocations/${editing._id}`, { chips: body.chips });
      else await apiPost(`/tournaments/${tournament._id}/allocations`, body);
      showAlert(editing ? 'Alocação atualizada!' : 'Fichas alocadas!', 'success');
      onDone();
    } catch (e) {
      if (e.status === 401) return;
      setError({ message: e.message || 'Erro ao alocar', details: e.data?.details });
    } finally { setBusy(false); }
  };

  const control = (row, freeForMe) => {
    if (mode === 'denominations') {
      const checked = !!picked[row.chip._id] || (!Object.values(picked).some(Boolean) && (range.min !== '' || range.max !== '') && inRange(row));
      return (
        <input type="checkbox" disabled={row.balance <= 0} checked={checked} className="h-4 w-4 accent-red-600"
          onChange={(e) => setPicked((p) => ({ ...p, [row.chip._id]: e.target.checked }))} />
      );
    }
    if (mode === 'quantities') {
      return (
        <input type="number" min="0" max={Math.max(0, freeForMe)} step="1" placeholder="0" value={qtys[row.chip._id] ?? ''}
          onChange={(e) => setQtys((q) => ({ ...q, [row.chip._id]: e.target.value }))}
          className={`w-24 rounded-lg border bg-white px-2 py-1 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-genesis-red dark:bg-zinc-900 ${Number(qtys[row.chip._id]) > freeForMe ? 'border-red-400' : 'border-gray-300 dark:border-zinc-700'}`} />
      );
    }
    return <span className="text-xs text-gray-400">{fmt(row.balance)}</span>;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[32px] border border-gray-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#111111]">
        <div className="flex items-center justify-between border-b border-gray-100 p-6 dark:border-zinc-800">
          <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight text-gray-900 dark:text-white">
            <Boxes size={20} className="text-genesis-red" /> {editing ? 'Editar alocação' : 'Alocar fichas'} — {tournament.name}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X /></button>
        </div>

        <div className="space-y-5 overflow-y-auto p-6">
          {!editing && (
            <div>
              <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-gray-400">Fichário</label>
              <CustomSelect options={binderOptions} value={binderId} onChange={(v) => { setBinderId(v); setMatrix(null); setError(null); }} placeholder="Selecione o fichário..." />
            </div>
          )}

          {matrix && (
            <>
              {!editing && (
                <div>
                  <div className="grid grid-cols-3 gap-2">
                    {MODES.map((m) => (
                      <button key={m.v} type="button" onClick={() => { setMode(m.v); setError(null); }}
                        className={`rounded-xl border p-3 text-xs font-bold transition-all ${mode === m.v ? 'border-genesis-red bg-red-50 text-genesis-red dark:bg-red-500/10' : 'border-gray-200 text-gray-500 dark:border-zinc-700'}`}>{m.label}</button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">{MODES.find((m) => m.v === mode).hint}</p>
                </div>
              )}

              {mode === 'denominations' && !editing && (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-bold text-gray-500">Faixa de valor:</span>
                  <input type="number" min="0" placeholder="de" value={range.min} onChange={(e) => setRange({ ...range, min: e.target.value })} className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
                  <input type="number" min="0" placeholder="até" value={range.max} onChange={(e) => setRange({ ...range, max: e.target.value })} className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
                  <span className="text-gray-400">ou marque as denominações abaixo</span>
                </div>
              )}

              <AllocationMatrix matrix={matrix} ownAllocationId={own} renderControl={control}
                controlLabel={mode === 'quantities' ? 'Quantidade' : mode === 'denominations' ? 'Alocar' : 'Será alocado'} />
            </>
          )}

          {error && (
            <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
              <AlertCircle className="mt-0.5 shrink-0" size={18} />
              <div>
                <p className="font-bold">{error.message}</p>
                {error.details?.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                    {error.details.map((d, i) => (
                      <li key={i}>
                        {d.chip ? <b>{d.chip}</b> : null} pedido {fmt(d.requested)} · livre {fmt(d.free)} · <b>excesso {fmt(d.excess)}</b>
                        {d.held_by?.length > 0 && ` — alocadas a: ${d.held_by.map((h) => `${h.tournament} ${fmt(h.quantity)}`).join(', ')}`}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 border-t border-gray-100 p-4 dark:border-zinc-800">
          <button onClick={onClose} className="flex-1 rounded-xl bg-gray-100 py-3 text-xs font-black uppercase text-gray-600 dark:bg-zinc-800 dark:text-gray-300">Cancelar</button>
          <button onClick={submit} disabled={busy || !matrix} className="flex-1 rounded-xl bg-genesis-red py-3 text-xs font-black uppercase text-white hover:bg-red-700 disabled:opacity-40">
            {busy ? 'Alocando…' : editing ? 'Salvar alocação' : 'Alocar'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
