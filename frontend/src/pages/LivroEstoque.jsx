import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, ChevronLeft, ChevronRight, ArrowUpCircle, ArrowDownCircle, PackageCheck, Boxes } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet } from '../lib/api';
import CustomSelect from '../components/CustomSelect';

const TYPE_META = {
  entrada:       { label: 'Entrada', cls: 'text-emerald-500 bg-emerald-500/10', icon: ArrowUpCircle },
  saldo_inicial: { label: 'Saldo inicial', cls: 'text-gray-500 bg-gray-500/10', icon: Boxes },
  saida:         { label: 'Saída', cls: 'text-red-500 bg-red-500/10', icon: ArrowDownCircle },
  quebra:        { label: 'Quebra/Perda', cls: 'text-amber-500 bg-amber-500/10', icon: ArrowDownCircle },
  contagem:      { label: 'Conferência', cls: 'text-blue-500 bg-blue-500/10', icon: PackageCheck },
  ajuste:        { label: 'Ajuste', cls: 'text-blue-500 bg-blue-500/10', icon: PackageCheck },
  alocacao:      { label: 'Alocação', cls: 'text-purple-500 bg-purple-500/10', icon: ArrowDownCircle },
  retorno:       { label: 'Retorno', cls: 'text-purple-500 bg-purple-500/10', icon: ArrowUpCircle },
};

const FILTERS = [
  { value: 'all', label: 'Todos os tipos' },
  { value: 'entrada', label: 'Entradas' },
  { value: 'saida', label: 'Saídas' },
  { value: 'quebra', label: 'Quebras/Perdas' },
  { value: 'contagem', label: 'Conferências' },
  { value: 'alocacao', label: 'Alocações' },
  { value: 'retorno', label: 'Retornos' },
];

export default function LivroEstoque() {
  const { showAlert } = useAlert();
  const [rows, setRows] = useState([]);
  const [chips, setChips] = useState([]);
  const [type, setType] = useState('all');
  const [chipId, setChipId] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { apiGet('/chips').then(setChips).catch(() => {}); }, []);

  useEffect(() => {
    setLoading(true);
    apiGet('/inventory/ledger', { type, chip_id: chipId, page, limit: 50 })
      .then((d) => { setRows(d.data); setPagination(d.pagination); })
      .catch((e) => { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar o livro-razão', 'error'); })
      .finally(() => setLoading(false));
  }, [type, chipId, page, showAlert]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-black uppercase tracking-tighter text-gray-900 dark:text-white md:text-4xl">
            <BookOpen className="text-genesis-red" size={30} /> Livro-razão de fichas
          </h1>
          <p className="text-gray-500 dark:text-gray-400">Todo movimento de estoque, em ordem. É a fonte da verdade dos saldos.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="w-44"><CustomSelect options={FILTERS} value={type} onChange={(v) => { setType(v); setPage(1); }} /></div>
          <div className="w-52">
            <CustomSelect
              options={[{ value: '', label: 'Todas as fichas' }, ...chips.map((c) => ({ value: c._id, label: `${c.name} (${c.value})` }))]}
              value={chipId}
              onChange={(v) => { setChipId(v); setPage(1); }}
              placeholder="Filtrar ficha"
            />
          </div>
        </div>
      </header>

      <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-[#111111]">
        {loading ? (
          <div className="p-16 text-center text-gray-400">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="p-16 text-center text-gray-400">Nenhum lançamento.</div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-zinc-800/60">
            {rows.map((r) => {
              const m = TYPE_META[r.type] || { label: r.type, cls: 'text-gray-500 bg-gray-500/10', icon: Boxes };
              const Icon = m.icon;
              return (
                <motion.li key={r._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-4 p-4">
                  <div className={`rounded-xl p-2 ${m.cls}`}><Icon size={18} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-gray-900 dark:text-white">
                      {m.label} · {r.chip_id?.name || 'Ficha'} <span className="text-xs font-bold text-gray-400">({r.chip_id?.value})</span>
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {r.note || r.ref?.label || '—'} · {new Date(r.createdAt).toLocaleString('pt-BR')} · {r.user_name}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`font-black tabular-nums ${r.quantity >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {r.quantity >= 0 ? '+' : ''}{r.quantity.toLocaleString('pt-BR')}
                    </p>
                    {r.balance_after != null && <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">saldo {r.balance_after.toLocaleString('pt-BR')}</p>}
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between bg-gray-50 p-4 dark:bg-zinc-900/50">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400">{pagination.total} lançamentos</span>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-gray-200 bg-white p-2 disabled:opacity-30 dark:border-zinc-700 dark:bg-zinc-800"><ChevronLeft size={18} /></button>
            <span className="rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-sm font-black dark:border-zinc-700 dark:bg-zinc-800">{page} / {pagination.pages}</span>
            <button disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-gray-200 bg-white p-2 disabled:opacity-30 dark:border-zinc-700 dark:bg-zinc-800"><ChevronRight size={18} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}
