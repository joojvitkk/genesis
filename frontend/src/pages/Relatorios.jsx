import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import { 
  Trophy, Coins, Activity, Filter, Download, Calendar, 
  ChevronDown, Search, ArrowUpRight, ArrowDownRight, Clock, X, ChevronLeft, ChevronRight, Info
} from 'lucide-react';
import { BACKEND_URL } from '../App';

export default function Relatorios() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedLog, setSelectedLog] = useState(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const categories = [
    { id: 'all', label: 'Todos' },
    { id: 'inventory', label: 'Estoque' },
    { id: 'tournament', label: 'Torneios' },
    { id: 'chip_race', label: 'Chip Race' },
    { id: 'chip_case', label: 'Fichários' },
    { id: 'system', label: 'Sistema' },
  ];

  useEffect(() => {
    fetchData();
  }, [categoryFilter, page, dateRange]);

  const fetchData = async () => {
    const token = localStorage.getItem('genesis_token');
    let url = `${BACKEND_URL}/api/reports/data?category=${categoryFilter}&page=${page}&limit=50`;
    if (dateRange.start) url += `&startDate=${dateRange.start}`;
    if (dateRange.end) url += `&endDate=${dateRange.end}`;

    try {
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setData(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (loading || !data) {
    return (
      <div className="p-10 flex flex-col gap-8 animate-pulse">
        <div className="h-20 bg-gray-100 dark:bg-zinc-800 rounded-3xl w-1/3"></div>
        <div className="grid grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-gray-100 dark:bg-zinc-800 rounded-3xl"></div>)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">Relatórios</h1>
          <p className="text-gray-500 font-medium">Análise e auditoria completa das operações</p>
        </div>
        <div className="flex gap-2 relative">
          <button 
            onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
            className="px-4 py-2 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-gray-50 transition-all shadow-sm"
          >
            <Calendar size={16}/> {dateRange.start || dateRange.end ? 'Período Ativo' : 'Selecionar Período'}
          </button>
          
          <AnimatePresence>
            {isDatePickerOpen && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="absolute top-full right-0 mt-2 p-6 bg-white dark:bg-zinc-900 rounded-[32px] border border-gray-200 dark:border-zinc-800 shadow-2xl z-50 w-72"
              >
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">Início</label>
                    <input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="w-full bg-gray-50 dark:bg-zinc-800 border-none rounded-xl p-3 text-sm font-bold outline-none ring-1 ring-gray-200 dark:ring-zinc-700 focus:ring-genesis-red transition-all" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">Fim</label>
                    <input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="w-full bg-gray-50 dark:bg-zinc-800 border-none rounded-xl p-3 text-sm font-bold outline-none ring-1 ring-gray-200 dark:ring-zinc-700 focus:ring-genesis-red transition-all" />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => { setDateRange({start: '', end: ''}); setIsDatePickerOpen(false); }} className="flex-1 py-2 text-[10px] font-black uppercase text-gray-400 hover:text-gray-600 transition-all">Limpar</button>
                    <button onClick={() => setIsDatePickerOpen(false)} className="flex-1 py-2 bg-genesis-red text-white text-[10px] font-black uppercase rounded-lg">Filtrar</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button className="px-4 py-2 bg-genesis-red text-white rounded-xl text-sm font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-lg shadow-red-500/20">
            <Download size={16}/> PDF
          </button>
        </div>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Torneios" value={data.stats.totalTournaments} subValue={`${data.stats.finishedTournaments} finalizados`} icon={<Trophy size={20}/>} color="bg-blue-500" />
        <StatCard title="Chip Races" value={data.stats.totalChipRaces} subValue="Confirmados" icon={<Activity size={20}/>} color="bg-amber-500" />
        <StatCard title="Total de Fichas" value={data.stats.totalChips.toLocaleString()} subValue="No sistema" icon={<Coins size={20}/>} color="bg-emerald-500" />
        <StatCard title="Logs Totais" value={data.pagination.total} subValue="Registros" icon={<Clock size={20}/>} color="bg-purple-500" />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-[#111111] p-8 rounded-[40px] border border-gray-100 dark:border-zinc-800 shadow-sm">
          <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight mb-8">Chip Races por Torneio</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.charts.racesByTournament}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#8882" />
                <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false} />
                <YAxis fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111', border: 'none', borderRadius: '12px', fontSize: '12px', color: '#fff' }}
                  itemStyle={{ color: '#fff' }}
                />
                <Bar dataKey="count" fill="#E21D1D" radius={[6, 6, 0, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-[#111111] p-8 rounded-[40px] border border-gray-100 dark:border-zinc-800 shadow-sm">
          <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight mb-8">Distribuição de Fichas</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data.charts.chipDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {data.charts.chipDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color || '#888'} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Activity Log Section */}
      <div className="bg-white dark:bg-[#111111] rounded-[40px] border border-gray-100 dark:border-zinc-800 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-gray-50 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase tracking-tight">Log de Atividades</h3>
          <div className="flex bg-gray-100 dark:bg-zinc-900 p-1 rounded-2xl overflow-x-auto">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => { setCategoryFilter(cat.id); setPage(1); }}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${categoryFilter === cat.id ? 'bg-white dark:bg-zinc-800 text-genesis-red shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 dark:bg-zinc-900/50">
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Data / Hora</th>
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Ação</th>
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Categoria</th>
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Usuário</th>
                <th className="px-8 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-zinc-800/50">
              {data.logs.map((log) => (
                <tr key={log._id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-all group">
                  <td className="px-8 py-5 text-xs font-bold text-gray-400">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-sm font-black text-gray-900 dark:text-white uppercase group-hover:text-genesis-red transition-all">{log.action}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter ${getCategoryColor(log.category)}`}>
                      {log.category}
                    </span>
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
              ))}
            </tbody>
          </table>
          
          {/* Pagination Controls */}
          <div className="p-8 bg-gray-50 dark:bg-zinc-900/50 flex items-center justify-between">
            <p className="text-xs font-bold text-gray-400 uppercase">Total: {data.pagination.total} registros</p>
            <div className="flex items-center gap-2">
              <button 
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 disabled:opacity-30 transition-all"
              >
                <ChevronLeft size={20}/>
              </button>
              <span className="px-4 text-sm font-black text-gray-900 dark:text-white">Página {page} de {data.pagination.pages}</span>
              <button 
                disabled={page >= data.pagination.pages}
                onClick={() => setPage(p => p + 1)}
                className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 disabled:opacity-30 transition-all"
              >
                <ChevronRight size={20}/>
              </button>
            </div>
          </div>
          
          {data.logs.length === 0 && (
            <div className="py-20 text-center text-gray-400 font-medium italic">Nenhum registro encontrado.</div>
          )}
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
                  <div>
                    <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter mb-2 inline-block ${getCategoryColor(selectedLog.category)}`}>
                      {selectedLog.category}
                    </span>
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">{selectedLog.action}</h2>
                  </div>
                  <button onClick={() => setSelectedLog(null)} className="p-2 text-gray-400 hover:text-gray-600 transition-all"><X /></button>
                </div>

                <div className="bg-gray-50 dark:bg-zinc-900 p-6 rounded-3xl border border-gray-100 dark:border-zinc-800 space-y-4">
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Detalhes da Operação</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white leading-relaxed">{selectedLog.details}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-zinc-800">
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Usuário</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{selectedLog.user_name || 'Sistema'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Horário</p>
                      <p className="text-sm font-bold text-gray-900 dark:text-white">{new Date(selectedLog.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                <button onClick={() => setSelectedLog(null)} className="w-full py-4 bg-gray-900 dark:bg-white dark:text-gray-900 text-white font-black uppercase text-xs rounded-2xl hover:opacity-90 transition-all">Fechar Detalhes</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StatCard({ title, value, subValue, icon, color }) {
  return (
    <div className="bg-white dark:bg-[#111111] p-6 rounded-[32px] border border-gray-100 dark:border-zinc-800 shadow-sm relative overflow-hidden group hover:border-genesis-red transition-all">
      <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-5 group-hover:opacity-10 transition-all ${color}`}></div>
      <div className="flex flex-col h-full justify-between">
        <div className="flex items-center justify-between mb-4">
          <div className={`p-3 rounded-2xl text-white ${color}`}>{icon}</div>
          <ArrowUpRight size={16} className="text-gray-300 group-hover:text-genesis-red transition-all" />
        </div>
        <div>
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{title}</h4>
          <p className="text-2xl font-black text-gray-900 dark:text-white">{value}</p>
          <p className="text-xs font-bold text-gray-500 mt-1">{subValue}</p>
        </div>
      </div>
    </div>
  );
}

function getCategoryColor(cat) {
  const colors = {
    inventory: 'bg-emerald-500/10 text-emerald-500',
    tournament: 'bg-blue-500/10 text-blue-500',
    chip_race: 'bg-amber-500/10 text-amber-500',
    chip_case: 'bg-purple-500/10 text-purple-500',
    system: 'bg-gray-500/10 text-gray-500'
  };
  return colors[cat] || 'bg-gray-100 text-gray-400';
}