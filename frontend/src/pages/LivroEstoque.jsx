import { locale } from '../lib/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, ChevronLeft, ChevronRight, ArrowUpCircle, ArrowDownCircle, PackageCheck, Boxes, Undo2, AlertTriangle, Coins } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import CustomSelect from '../components/CustomSelect';

// ─── movimentações (fonte da verdade — G2) ───────────────────────────────────
const MOVEMENT_META = {
  ASSEMBLY:   { label: 'Montagem / entrada', cls: 'text-emerald-500 bg-emerald-500/10', icon: ArrowUpCircle },
  WITHDRAWAL: { label: 'Saída', cls: 'text-red-500 bg-red-500/10', icon: ArrowDownCircle },
  ADJUSTMENT: { label: 'Ajuste', cls: 'text-blue-500 bg-blue-500/10', icon: PackageCheck },
  LOSS:       { label: 'Perda / divergência', cls: 'text-amber-500 bg-amber-500/10', icon: AlertTriangle },
  REVERSAL:   { label: 'Estorno', cls: 'text-purple-500 bg-purple-500/10', icon: Undo2 },
  SEND_BUY_IN:     { label: 'Envio · buy-in', cls: 'text-teal-500 bg-teal-500/10', icon: ArrowUpCircle },
  SEND_OPTIONAL:   { label: 'Envio · opcional', cls: 'text-teal-500 bg-teal-500/10', icon: ArrowUpCircle },
  SEND_REENTRY:    { label: 'Envio · reentrada', cls: 'text-teal-500 bg-teal-500/10', icon: ArrowUpCircle },
  SEND_ADDITIONAL: { label: 'Envio adicional', cls: 'text-teal-500 bg-teal-500/10', icon: ArrowUpCircle },
  RETURN:          { label: 'Retorno do torneio', cls: 'text-sky-500 bg-sky-500/10', icon: ArrowDownCircle },
  CHIP_RACE_OUT:   { label: 'Chip race · saiu', cls: 'text-amber-500 bg-amber-500/10', icon: Coins },
  CHIP_RACE_IN:    { label: 'Chip race · entrou', cls: 'text-amber-500 bg-amber-500/10', icon: Coins },
  COLOR_UP_OUT:    { label: 'Color up · saiu', cls: 'text-amber-500 bg-amber-500/10', icon: Coins },
  COLOR_UP_IN:     { label: 'Color up · entrou', cls: 'text-amber-500 bg-amber-500/10', icon: Coins },
  FOUND:           { label: 'Sobra encontrada', cls: 'text-emerald-500 bg-emerald-500/10', icon: ArrowUpCircle },
  RECOVERY:        { label: 'Recuperação', cls: 'text-emerald-500 bg-emerald-500/10', icon: Undo2 },
  DISCARD:         { label: 'Descarte de stack', cls: 'text-rose-500 bg-rose-500/10', icon: ArrowDownCircle },
};
const MOVEMENT_FILTERS = [
  { value: 'all', label: 'Todos os tipos' },
  ...Object.entries(MOVEMENT_META).map(([value, m]) => ({ value, label: m.label })),
];
const PLACE = { external: 'Externo', binder: 'Fichário', lost: 'Divergência', play: 'No Salão' };

// ─── ledger v1 (histórico anterior ao G2 + reservas de torneio) ──────────────

const fmt = (n) => n.toLocaleString(locale());

export default function LivroEstoque() {
  const { showAlert, showPrompt, showConfirm } = useAlert();
  const isAdmin = getStoredUser()?.role === 'admin';
  const [rows, setRows] = useState([]);
  const [chips, setChips] = useState([]);
  const [binders, setBinders] = useState([]);
  const [type, setType] = useState('all');
  const [chipId, setChipId] = useState('');
  const [binderId, setBinderId] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => { apiGet('/chips').then(setChips).catch(() => {}); }, []);
  // /binders exige a área "ficharios" (o salão não tem) — falha silenciosa
  useEffect(() => { apiGet('/binders').then(setBinders).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    apiGet('/movements', { type, chip_id: chipId, binder_id: binderId, page, limit: 50 })
      .then((d) => { setRows(d.data); setPagination(d.pagination); })
      .catch((e) => { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar o livro-razão', 'error'); })
      .finally(() => setLoading(false));
  }, [type, chipId, binderId, page, reload, showAlert]);

  const batchSize = useMemo(() => {
    const map = {};
    rows.forEach((r) => { if (r.batch_id && r.type !== 'REVERSAL') map[r.batch_id] = (map[r.batch_id] || 0) + 1; });
    return map;
  }, [rows]);

  // Estorno: não apaga nada — grava o movimento inverso, vinculado ao original.
  const reverse = useCallback(async (r, wholeBatch) => {
    const what = wholeBatch ? `todo o lote (${batchSize[r.batch_id]} lançamentos)` : 'este lançamento';
    const reason = await showPrompt(`Estornar ${what}? Informe o motivo (obrigatório). O original é mantido no histórico.`);
    if (!reason) return;
    if (!(await showConfirm(`Confirmar o estorno de ${what}?`))) return;
    try {
      await apiPost(`/movements/${r._id}/reverse`, { reason, whole_batch: !!wholeBatch });
      showAlert('Estorno registrado.', 'success');
      setReload((n) => n + 1);
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao estornar', 'error');
    }
  }, [batchSize, showAlert, showConfirm, showPrompt]);


  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <BookOpen className="text-brand-fg" size={22} /> Livro-razão de fichas
          </h1>
          <p className="page-sub">
            Toda movimentação, em ordem. Os saldos são calculados a partir daqui — nada é editado nem apagado; erros se corrigem por estorno.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="w-44"><CustomSelect options={MOVEMENT_FILTERS} value={type} onChange={(v) => { setType(v); setPage(1); }} /></div>
          <div className="w-44">
            <CustomSelect
              options={[{ value: '', label: 'Todos os fichários' }, ...binders.map((b) => ({ value: b._id, label: b.name }))]}
              value={binderId} onChange={(v) => { setBinderId(v); setPage(1); }} placeholder="Fichário"
            />
          </div>
          <div className="w-52">
            <CustomSelect
              options={[{ value: '', label: 'Todas as fichas' }, ...chips.map((c) => ({ value: c._id, label: `${c.name} · ${c.color || 's/ cor'}` }))]}
              value={chipId} onChange={(v) => { setChipId(v); setPage(1); }} placeholder="Filtrar ficha"
            />
          </div>
        </div>
      </header>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-fg-subtle">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="p-16 text-center text-fg-subtle">Nenhum lançamento.</div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {rows.map((r) => {
              const m = MOVEMENT_META[r.type] || { label: r.type, cls: 'text-fg-muted bg-gray-500/10', icon: Boxes };
              const Icon = m.icon;
              const delta = r.to.kind === 'binder' ? r.quantity : r.from.kind === 'binder' ? -r.quantity : r.to.kind === 'play' ? r.quantity : -r.quantity;
              const reversed = !!r.reversed_by;
              return (
                <motion.li key={r._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`flex items-center gap-4 p-4 ${reversed ? 'opacity-60' : ''}`}>
                  <div className={`rounded-xl p-2 ${m.cls}`}><Icon size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-fg">
                      <span className={reversed ? 'line-through' : ''}>{m.label} · {r.chip_id?.name || 'Ficha'}</span>
                      {reversed && <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-bold text-fg-muted dark:bg-zinc-800">estornado</span>}
                    </p>
                    <p className="text-xs text-fg-muted">
                      {PLACE[r.from.kind]}{r.from.kind === 'play' ? ` ${r.tournament_id?.name || ''}` : r.from.kind === 'binder' ? ` ${r.binder_id?.name || ''}` : ''} → {PLACE[r.to.kind]}{r.to.kind === 'play' ? ` ${r.tournament_id?.name || ''}` : r.to.kind !== 'external' ? ` ${r.binder_id?.name || ''}` : ''}
                    </p>
                    <p className="truncate text-xs text-fg-subtle" title={r.reason}>
                      {r.reason || '—'} · {new Date(r.createdAt).toLocaleString(locale())} · {r.user_name}
                    </p>
                    {reversed && (
                      <p className="text-xs text-purple-500">Estornado por {r.reversed_by.user_name}: {r.reversed_by.reason}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-right">
                    <p className={`font-bold tabular-nums ${delta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {delta >= 0 ? '+' : '−'}{fmt(Math.abs(delta))}
                    </p>
                    {isAdmin && r.type !== 'REVERSAL' && !reversed && (
                      <div className="flex flex-col gap-1">
                        <button onClick={() => reverse(r, false)} title="Estornar este lançamento" className="rounded-lg border border-line p-2 text-fg-subtle hover:text-purple-500"><Undo2 size={16} /></button>
                        {batchSize[r.batch_id] > 1 && (
                          <button onClick={() => reverse(r, true)} title="Estornar o lote inteiro" className="rounded-lg border border-line px-1 py-0.5 text-xs font-bold uppercase text-fg-subtle hover:text-purple-500">lote</button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between bg-sunken p-4">
          <span className="text-xs font-bold uppercase tracking-wide text-fg-subtle">{pagination.total} lançamentos</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-line bg-surface p-2 disabled:opacity-30 dark:bg-zinc-800"><ChevronLeft size={18} /></button>
            <span className="rounded-lg border border-line bg-surface px-4 py-1.5 text-sm font-bold dark:bg-zinc-800">{page} / {pagination.pages}</span>
            <button disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-line bg-surface p-2 disabled:opacity-30 dark:bg-zinc-800"><ChevronRight size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
