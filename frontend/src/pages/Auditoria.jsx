import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ArrowUpCircle, ArrowDownCircle, 
  Calendar, User, ChevronLeft, ChevronRight, Hash, Info, X, Clock
} from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet } from '../lib/api';
import CustomSelect from '../components/CustomSelect';
import BalanceHistory from '../components/BalanceHistory';

export default function Auditoria() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [selectedLog, setSelectedLog] = useState(null);
  const [tab, setTab] = useState('log'); // 'log' | 'saldo'
  const { showAlert } = useAlert();

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, typeFilter]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const data = await apiGet('/inventory/logs', { page, limit: 50, type: typeFilter, search: searchTerm });
      setLogs(data.logs || []);
      setPagination(data.pagination || { total: 0, pages: 1 });
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar logs', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchLogs();
  };

  const typeOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'entry', label: 'Entradas' },
    { value: 'exit', label: 'Saídas' }
  ];

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <nav className="flex gap-2 border-b border-line" role="tablist">
        {[['log', 'Log de atividades'], ['saldo', 'Histórico de saldo']].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-xs font-bold uppercase tracking-wide ${tab === key ? 'border-brand text-brand-fg' : 'border-transparent text-fg-subtle hover:text-gray-600'}`}>{label}</button>
        ))}
      </nav>
      {tab === 'saldo' ? <BalanceHistory /> : (
      <>
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="page-title">Log de Auditoria</h1>
          <p className="page-sub">Histórico de movimentações do estoque de fichas</p>
        </div>
        
        <form onSubmit={handleSearch} className="flex flex-1 md:max-w-xl items-center gap-3 bg-surface p-2 rounded-2xl border border-line-soft">
          <Search size={20} className="text-fg-subtle ml-2" />
          <input 
            type="text" 
            placeholder="Buscar por ficha ou usuário..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-transparent border-none outline-none text-sm font-bold dark:text-white"
          />
          <div className="h-6 w-[1px] bg-raised"></div>
          <CustomSelect 
            options={typeOptions}
            value={typeFilter}
            onChange={val => { setTypeFilter(val); setPage(1); }}
            placeholder="Tipo"
          />
          <button type="submit" className="hidden">Buscar</button>
        </form>
      </header>

      {/* Main Table Container */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-sunken">
                <th className="px-8 py-4 text-xs font-bold text-fg-subtle uppercase tracking-wide">Data / Hora</th>
                <th className="px-8 py-4 text-xs font-bold text-fg-subtle uppercase tracking-wide">Movimento</th>
                <th className="px-8 py-4 text-xs font-bold text-fg-subtle uppercase tracking-wide">Quantidade / Detalhes</th>
                <th className="px-8 py-4 text-xs font-bold text-fg-subtle uppercase tracking-wide">Usuário</th>
                <th className="px-8 py-4 text-xs font-bold text-fg-subtle uppercase tracking-wide text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-zinc-800/50">
              {loading ? (
                [1,2,3,4,5].map(i => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-8 py-6 h-16 bg-sunken/50 dark:bg-zinc-800/10"></td>
                  </tr>
                ))
              ) : (
                logs.map((log) => {
                  const isEntry = (log.action || '').includes('Entrada');
                  return (
                    <tr key={log._id} className="hover:bg-sunken transition-all group">
                      <td className="px-8 py-5 text-xs font-bold text-fg-subtle">
                        <div className="flex items-center gap-2">
                          <Clock size={12}/> {new Date(log.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-xl ${isEntry ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                            {isEntry ? <ArrowUpCircle size={18}/> : <ArrowDownCircle size={18}/>}
                          </div>
                          <span className="text-sm font-bold text-fg uppercase group-hover:text-genesis-red transition-all">
                            {log.action}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="text-sm font-medium text-fg-muted italic">
                          {(log.details || '').replace('Ficha Alterada | ', '')}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-zinc-700 flex items-center justify-center text-xs font-bold text-fg-muted">
                            {log.user_name?.[0] || 'U'}
                          </div>
                          <span className="text-xs font-bold text-fg">{log.user_name || 'Sistema'}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button 
                          onClick={() => setSelectedLog(log)}
                          className="p-2 bg-raised text-fg-muted rounded-xl hover:bg-brand hover:text-white transition-all"
                        >
                          <Info size={16}/>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          
          {!loading && logs.length === 0 && (
            <div className="py-20 text-center text-fg-subtle font-medium italic">Nenhuma movimentação encontrada.</div>
          )}

          {/* Pagination */}
          <div className="p-8 bg-sunken flex items-center justify-between">
            <p className="text-xs font-bold text-fg-subtle uppercase tracking-wide">Total: {pagination.total} registros</p>
            <div className="flex items-center gap-2">
              <button 
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="p-2 rounded-xl bg-surface border border-line disabled:opacity-30 transition-all hover:bg-sunken"
              >
                <ChevronLeft size={20}/>
              </button>
              <div className="px-6 py-2 bg-surface border border-line rounded-xl text-sm font-bold text-fg">
                {page} / {pagination.pages}
              </div>
              <button 
                disabled={page >= pagination.pages}
                onClick={() => setPage(p => p + 1)}
                className="p-2 rounded-xl bg-surface border border-line disabled:opacity-30 transition-all hover:bg-sunken"
              >
                <ChevronRight size={20}/>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Log Detail Modal */}
      <AnimatePresence>
        {selectedLog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedLog(null)} className="absolute inset-0 bg-[var(--overlay)]" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="card relative w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto">
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-2xl ${(selectedLog.action || '').includes('Entrada') ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                      {(selectedLog.action || '').includes('Entrada') ? <ArrowUpCircle size={24}/> : <ArrowDownCircle size={24}/>}
                    </div>
                    <div>
                      <span className="text-xs font-bold text-fg-subtle uppercase tracking-wide mb-1 block">Movimentação</span>
                      <h2 className="text-xl font-bold text-fg">{selectedLog.action}</h2>
                    </div>
                  </div>
                  <button onClick={() => setSelectedLog(null)} className="p-2 text-fg-subtle hover:text-gray-600 transition-all"><X /></button>
                </div>

                <div className="bg-sunken p-6 rounded-3xl border border-line-soft space-y-6">
                  <div>
                    <p className="text-xs font-bold text-fg-subtle uppercase tracking-wide mb-2 flex items-center gap-2"><Hash size={12}/> Detalhes do Lançamento</p>
                    <p className="text-sm font-bold text-fg leading-relaxed bg-surface p-4 rounded-2xl border border-line-soft italic">
                      "{selectedLog.details}"
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-surface p-4 rounded-2xl border border-line-soft">
                      <p className="text-xs font-bold text-fg-subtle uppercase tracking-wide mb-1 flex items-center gap-1"><User size={10}/> Operador</p>
                      <p className="text-sm font-bold text-fg">{selectedLog.user_name || 'Sistema'}</p>
                    </div>
                    <div className="bg-surface p-4 rounded-2xl border border-line-soft">
                      <p className="text-xs font-bold text-fg-subtle uppercase tracking-wide mb-1 flex items-center gap-1"><Calendar size={10}/> Data</p>
                      <p className="text-sm font-bold text-fg">{new Date(selectedLog.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>

                <button onClick={() => setSelectedLog(null)} className="w-full py-4 bg-gray-900 dark:bg-white dark:text-gray-900 text-white font-bold text-xs rounded-2xl hover:opacity-90 transition-all">Fechar Auditoria</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </>
      )}
    </div>
  );
}