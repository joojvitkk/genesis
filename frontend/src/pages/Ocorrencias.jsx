import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { apiGet } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { can } from '../config';
import { socket } from '../lib/socket';
import { useAlert } from '../contexts/AlertContext';
import CustomSelect from '../components/CustomSelect';
import OccurrenceList, { STATUS_LABEL } from '../components/OccurrenceList';
import CountPanel from '../components/CountPanel';
import SeverityConfig from '../components/SeverityConfig';
import { SEVERITY } from '../components/SeverityBadge';

const STATUS_FILTER = [{ value: 'active', label: 'Ativas' }, { value: 'all', label: 'Todas' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))];
const SEVERITY_FILTER = [{ value: 'all', label: 'Todas as severidades' }, ...Object.entries(SEVERITY).map(([value, s]) => ({ value, label: s.label }))];
const KIND_FILTER = [{ value: 'all', label: 'Faltas e sobras' }, { value: 'LOSS', label: 'Só faltas' }, { value: 'SURPLUS', label: 'Só sobras' }];

/**
 * Ocorrências (G8, spec §10–11): divergências físicas com semáforo, justificativa, recuperação e histórico.
 * Conferência física abre as ocorrências; o admin configura o semáforo.
 */
export default function Ocorrencias() {
  const { showAlert } = useAlert();
  const user = getStoredUser();
  const isAdmin = can(user?.role, 'estoque', 'manage');
  const canOperate = can(user?.role, 'estoque', 'operate');
  const [tab, setTab] = useState('ocorrencias');
  const [filters, setFilters] = useState({ status: 'active', severity: 'all', kind: 'all' });
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [binders, setBinders] = useState([]);

  const load = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([apiGet('/occurrences', filters), apiGet('/occurrences/summary')]);
      setItems(list); setSummary(sum);
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar as ocorrências', 'error'); }
  }, [filters, showAlert]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiGet('/binders').then(setBinders).catch(() => {}); }, []);

  // tempo real: outra pessoa abriu/atualizou uma ocorrência
  useEffect(() => {
    socket.on('occurrenceOpened', load);
    socket.on('occurrenceUpdated', load);
    return () => { socket.off('occurrenceOpened', load); socket.off('occurrenceUpdated', load); };
  }, [load]);

  const tabs = [['ocorrencias', 'Ocorrências'], ...(canOperate ? [['conferencia', 'Conferência']] : []), ...(isAdmin ? [['semaforo', 'Semáforo']] : [])];
  const setFilter = (k) => (v) => setFilters((f) => ({ ...f, [k]: v }));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="flex items-center gap-3 text-2xl font-black"><ShieldAlert className="text-genesis-red" /> Ocorrências</h1>
        {summary && (
          <div className="ml-auto flex gap-2 text-[11px] font-black uppercase tracking-widest">
            <span data-testid="red-open" className={`rounded-lg px-3 py-1.5 ${summary.red_open > 0 ? 'bg-red-50 text-red-600 dark:bg-red-500/10' : 'bg-gray-100 text-gray-400 dark:bg-zinc-800'}`}>{summary.red_open} vermelha(s) em aberto</span>
            <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-600 dark:bg-amber-500/10">{summary.pending_justification} sem justificativa</span>
          </div>
        )}
      </header>

      <nav className="flex gap-2 border-b border-gray-200 dark:border-zinc-800" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-xs font-black uppercase tracking-widest ${tab === key ? 'border-genesis-red text-genesis-red' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>{label}</button>
        ))}
      </nav>

      {tab === 'ocorrencias' && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <CustomSelect options={STATUS_FILTER} value={filters.status} onChange={setFilter('status')} />
            <CustomSelect options={SEVERITY_FILTER} value={filters.severity} onChange={setFilter('severity')} />
            <CustomSelect options={KIND_FILTER} value={filters.kind} onChange={setFilter('kind')} />
          </div>
          <OccurrenceList items={items} binders={binders} canOperate={canOperate} isAdmin={isAdmin} onChanged={load} />
        </>
      )}
      {tab === 'conferencia' && canOperate && <CountPanel onDone={load} />}
      {tab === 'semaforo' && isAdmin && <SeverityConfig />}
    </motion.div>
  );
}
