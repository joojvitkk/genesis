import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  History, Search, Filter, ArrowUpCircle, ArrowDownCircle, 
  Calendar, User, ChevronLeft, ChevronRight, Hash, Info, X, Clock, ChevronDown
} from 'lucide-react';
import { BACKEND_URL } from '../App';

const CustomSelect = ({ options, value, onChange, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = React.useRef(null);
  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative min-w-[140px]" ref={containerRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center bg-transparent border-none px-4 py-2 text-xs cursor-pointer text-gray-500 font-black uppercase tracking-tighter"
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={14} className={`transition-transform text-gray-400 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </div>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
            className="absolute z-50 right-0 mt-2 w-48 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl max-h-48 overflow-y-auto"
          >
            {options.map(opt => (
              <div 
                key={opt.value} 
                onClick={() => { onChange(opt.value); setIsOpen(false); }}
                className="px-4 py-2 hover:bg-gray-50 dark:hover:bg-zinc-800/50 cursor-pointer text-[10px] font-black uppercase text-gray-500 dark:text-white border-b border-gray-50 dark:border-zinc-800/30 last:border-0"
              >
                {opt.label}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function Auditoria() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  const [selectedLog, setSelectedLog] = useState(null);

  useEffect(() => {
    fetchLogs();
  }, [page, typeFilter]);

  const fetchLogs = async () => {
    setLoading(true);
    const token = localStorage.getItem('genesis_token');
    let url = `${BACKEND_URL}/api/inventory/logs?page=${page}&limit=50&type=${typeFilter}`;
    if (searchTerm) url += `&search=${searchTerm}`;

    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs);
        setPagination(data.pagination);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
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
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">Log de Auditoria</h1>
          <p className="text-gray-500 font-medium italic">Histórico de movimentações do estoque de fichas</p>
        </div>
        
        <form onSubmit={handleSearch} className="flex flex-1 md:max-w-xl items-center gap-3 bg-white dark:bg-zinc-900 p-2 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm">
          <Search size={20} className="text-gray-400 ml-2" />
          <input 
            type="text" 
            placeholder="Buscar por ficha ou usuário..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-transparent border-none outline-none text-sm font-bold dark:text-white"
          />
          <div className="h-6 w-[1px] bg-gray-100 dark:bg-zinc-800"></div>
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
      <div className="bg-white dark:bg-[#111111] rounded-[40px] border border-gray-100 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-900/50">
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Data / Hora</th>
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Movimento</th>
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Quantidade / Detalhes</th>
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Usuário</th>
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-zinc-800/50">
              {loading ? (
                [1,2,3,4,5].map(i => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={5} className="px-8 py-6 h-16 bg-gray-50/50 dark:bg-zinc-800/10"></td>
                  </tr>
                ))
              ) : (
                logs.map((log) => {
                  const isEntry = log.action.includes('Entrada');
                  return (
                    <tr key={log._id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-all group">
                      <td className="px-8 py-5 text-xs font-bold text-gray-400">
                        <div className="flex items-center gap-2">
                          <Clock size={12}/> {new Date(log.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-xl ${isEntry ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                            {isEntry ? <ArrowUpCircle size={18}/> : <ArrowDownCircle size={18}/>}
                          </div>
                          <span className="text-sm font-black text-gray-900 dark:text-white uppercase group-hover:text-genesis-red transition-all">
                            {log.action}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="text-sm font-medium text-gray-600 dark:text-gray-400 italic">
                          {log.details.replace('Ficha Alterada | ', '')}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-zinc-700 flex items-center justify-center text-[10px] font-black text-gray-500">
                            {log.user_name?.[0] || 'U'}
                          </div>
                          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{log.user_name || 'Sistema'}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button 
                          onClick={() => setSelectedLog(log)}
                          className="p-2 bg-gray-100 dark:bg-zinc-800 text-gray-500 rounded-xl hover:bg-genesis-red hover:text-white transition-all shadow-sm"
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
            <div className="py-20 text-center text-gray-400 font-medium italic">Nenhuma movimentação encontrada.</div>
          )}

          {/* Pagination */}
          <div className="p-8 bg-gray-50 dark:bg-zinc-900/50 flex items-center justify-between">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Total: {pagination.total} registros</p>
            <div className="flex items-center gap-2">
              <button 
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 disabled:opacity-30 transition-all hover:bg-gray-50"
              >
                <ChevronLeft size={20}/>
              </button>
              <div className="px-6 py-2 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm font-black text-gray-900 dark:text-white shadow-sm">
                {page} / {pagination.pages}
              </div>
              <button 
                disabled={page >= pagination.pages}
                onClick={() => setPage(p => p + 1)}
                className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 disabled:opacity-30 transition-all hover:bg-gray-50"
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedLog(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-white dark:bg-[#111111] w-full max-w-lg rounded-[40px] shadow-2xl overflow-hidden border border-gray-200 dark:border-zinc-800">
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-2xl ${selectedLog.action.includes('Entrada') ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                      {selectedLog.action.includes('Entrada') ? <ArrowUpCircle size={24}/> : <ArrowDownCircle size={24}/>}
                    </div>
                    <div>
                      <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 block">Movimentação</span>
                      <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">{selectedLog.action}</h2>
                    </div>
                  </div>
                  <button onClick={() => setSelectedLog(null)} className="p-2 text-gray-400 hover:text-gray-600 transition-all"><X /></button>
                </div>

                <div className="bg-gray-50 dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-zinc-800 space-y-6">
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2"><Hash size={12}/> Detalhes do Lançamento</p>
                    <p className="text-sm font-bold text-gray-900 dark:text-white leading-relaxed bg-white dark:bg-zinc-800 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-zinc-700 italic">
                      "{selectedLog.details}"
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-zinc-800 p-4 rounded-2xl border border-gray-100 dark:border-zinc-700">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1"><User size={10}/> Operador</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{selectedLog.user_name || 'Sistema'}</p>
                    </div>
                    <div className="bg-white dark:bg-zinc-800 p-4 rounded-2xl border border-gray-100 dark:border-zinc-700">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 flex items-center gap-1"><Calendar size={10}/> Data</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{new Date(selectedLog.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>

                <button onClick={() => setSelectedLog(null)} className="w-full py-4 bg-gray-900 dark:bg-white dark:text-gray-900 text-white font-black uppercase text-xs rounded-2xl hover:opacity-90 transition-all shadow-lg">Fechar Auditoria</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}