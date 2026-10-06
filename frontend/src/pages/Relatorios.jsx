import { locale } from '../lib/i18n';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend 
} from 'recharts';
import {
  Trophy, Coins, Activity, Download, Calendar, ArrowUpRight, Clock, X, ChevronLeft, ChevronRight, Info, Printer, GitCompare, Bookmark, Trash2
} from 'lucide-react';
import { apiGet } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import { exportToCSV } from '../utils/csvExport';
import { tournamentDate } from '../lib/format';

const PRESETS_KEY = 'genesis_report_presets';
const readPresets = () => { try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch { return []; } };
const writePresets = (p) => { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(p)); } catch { /* */ } };
const brl = (n) => (n || 0).toLocaleString(locale(), { style: 'currency', currency: 'BRL' });

export default function Relatorios() {
  const { showAlert, showPrompt } = useAlert();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedLog, setSelectedLog] = useState(null);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [comparison, setComparison] = useState(null);
  const [showComparison, setShowComparison] = useState(false);
  const [presets, setPresets] = useState(readPresets());

  const applyPreset = (p) => { setCategoryFilter(p.category); setDateRange(p.dateRange); setPage(1); };
  const savePreset = async () => {
    const name = await showPrompt('Como quer chamar esta predefinição de filtro?', {
      title: 'Salvar predefinição', placeholder: 'Ex: Estoque — último mês',
    });
    if (!name) return;
    const next = [...presets.filter((p) => p.name !== name), { name, category: categoryFilter, dateRange }];
    setPresets(next); writePresets(next);
    showAlert('Predefinição salva.', 'success');
  };
  const deletePreset = (name) => { const next = presets.filter((p) => p.name !== name); setPresets(next); writePresets(next); };

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
    try {
      setData(await apiGet('/reports/data', {
        category: categoryFilter,
        page,
        limit: 50,
        startDate: dateRange.start,
        endDate: dateRange.end,
      }));
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar relatório', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadComparison = async () => {
    setShowComparison((v) => !v);
    if (!comparison) {
      try { setComparison(await apiGet('/reports/comparison')); }
      catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar comparativo', 'error'); }
    }
  };

  const handleExport = () => {
    const rows = (data?.logs || []).map(l => ({
      data: new Date(l.createdAt).toLocaleString(locale()),
      categoria: l.category,
      acao: l.action,
      detalhes: l.details,
      usuario: l.user_name || 'Sistema',
    }));
    if (rows.length === 0) return showAlert('Nada para exportar.', 'info');
    exportToCSV(rows, `genesis-relatorio-${new Date().toISOString().slice(0, 10)}`);
  };

  // CSV do estoque: distribuição das fichas pelo saldo derivado (em fichários, em jogo, divergência)
  const handleExportChips = () => {
    const rows = (data?.charts?.chipDistribution || []).map((c) => ({
      ficha: c.name, em_ficharios: c.in_binders, em_jogo: c.in_play, em_divergencia: c.lost, existentes: c.value,
    }));
    if (rows.length === 0) return showAlert('Nada para exportar.', 'info');
    exportToCSV(rows, `genesis-fichas-${new Date().toISOString().slice(0, 10)}`);
  };

  if (loading || !data) {
    return (
      <div className="p-10 flex flex-col gap-8 animate-pulse">
        <div className="h-20 bg-raised rounded-3xl w-1/3"></div>
        <div className="grid grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-raised rounded-3xl"></div>)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Relatórios</h1>
          <p className="page-sub">Análise e auditoria completa das operações</p>
        </div>
        <div className="flex gap-2 relative">
          <button 
            onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
            className="px-4 py-2 bg-surface border border-line rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-sunken transition-all"
          >
            <Calendar size={16}/> {dateRange.start || dateRange.end ? 'Período Ativo' : 'Selecionar Período'}
          </button>
          
          <AnimatePresence>
            {isDatePickerOpen && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                className="absolute top-full right-0 mt-2 p-6 bg-surface rounded-2xl border border-line shadow-2xl z-50 w-72"
              >
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-fg-subtle uppercase mb-1 block">Início</label>
                    <input type="date" value={dateRange.start} onChange={e => setDateRange({...dateRange, start: e.target.value})} className="input w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-fg-subtle uppercase mb-1 block">Fim</label>
                    <input type="date" value={dateRange.end} onChange={e => setDateRange({...dateRange, end: e.target.value})} className="input w-full" />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => { setDateRange({start: '', end: ''}); setIsDatePickerOpen(false); }} className="flex-1 py-2 text-xs font-bold uppercase text-fg-subtle hover:text-gray-600 transition-all">Limpar</button>
                    <button onClick={() => setIsDatePickerOpen(false)} className="flex-1 py-2 bg-brand text-white text-xs font-bold rounded-lg">Filtrar</button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button onClick={loadComparison} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all  border ${showComparison ? 'bg-brand text-white border-brand' : 'bg-surface border-line hover:bg-sunken'}`}>
            <GitCompare size={16}/> Comparar
          </button>
          <button onClick={() => window.print()} className="px-4 py-2 bg-surface border border-line rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-sunken transition-all">
            <Printer size={16}/> PDF
          </button>
          <button onClick={handleExport} className="btn btn-primary flex items-center">
            <Download size={16}/> CSV logs
          </button>
          <button onClick={handleExportChips} className="px-4 py-2 bg-surface border border-line rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-sunken transition-all">
            <Download size={16}/> CSV fichas
          </button>
        </div>
      </header>

      {/* Predefinições de filtro */}
      <div className="flex flex-wrap items-center gap-2 no-print">
        <Bookmark size={14} className="text-fg-subtle" />
        {presets.length === 0 && <span className="text-xs text-fg-subtle">Nenhuma predefinição salva</span>}
        {presets.map((p) => (
          <span key={p.name} className="group inline-flex items-center gap-1 rounded-full bg-raised px-3 py-1 text-xs font-bold text-fg-muted dark:bg-zinc-800">
            <button onClick={() => applyPreset(p)}>{p.name}</button>
            <button onClick={() => deletePreset(p.name)} className="opacity-0 group-hover:opacity-100 text-fg-subtle hover:text-red-500"><Trash2 size={11} /></button>
          </span>
        ))}
        <button onClick={savePreset} className="text-xs font-bold uppercase tracking-wide text-brand-fg hover:underline">+ salvar atual</button>
      </div>

      {/* Comparativo entre torneios */}
      {showComparison && (
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[960px]">
            <thead className="bg-sunken text-xs font-bold uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-4 py-3">Torneio</th><th className="px-4 py-3">Data</th>
                <th className="px-4 py-3 text-right">Entradas</th><th className="px-4 py-3 text-right">Prize pool</th>
                <th className="px-4 py-3 text-right">Bounty</th><th className="px-4 py-3 text-right">Rake</th>
                <th className="px-4 py-3 text-right">Fichas enviadas</th><th className="px-4 py-3 text-right">Descartado</th>
                <th className="px-4 py-3 text-right">Perdido</th><th className="px-4 py-3 text-right">Quebra chip race</th>
                <th className="px-4 py-3">Campeão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {!comparison && <tr><td colSpan={11} className="p-8 text-center text-fg-subtle">Carregando…</td></tr>}
              {comparison?.map((c) => (
                <tr key={c._id} className="hover:bg-sunken">
                  <td className="px-4 py-3 font-bold text-fg">{c.name}</td>
                  <td className="px-4 py-3 text-fg-muted">{tournamentDate(c)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.total_entries}{c.addons ? ` (+${c.addons} add)` : ''}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-600 dark:text-emerald-400">{brl(c.prize_pool)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-600">{brl(c.bounty_pool)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-brand-fg">{brl(c.rake_collected)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{(c.material?.sent_value || 0).toLocaleString(locale())}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{(c.material?.discarded_value || 0).toLocaleString(locale())}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${c.material?.lost_value > 0 ? 'font-bold text-red-600' : ''}`}>{(c.material?.lost_value || 0).toLocaleString(locale())}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{(c.material?.math_breakage || 0).toLocaleString(locale())}</td>
                  <td className="px-4 py-3 text-fg">{c.winner || '—'}</td>
                </tr>
              ))}
              {comparison?.length === 0 && <tr><td colSpan={11} className="p-8 text-center text-fg-subtle">Nenhum torneio com dados.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
        <StatCard title="Torneios" value={data.stats.totalTournaments} subValue={`${data.stats.finishedTournaments} finalizados`} icon={<Trophy size={20}/>} color="bg-blue-500" />
        <StatCard title="Chip Races" value={data.stats.totalChipRaces} subValue="Confirmados" icon={<Activity size={20}/>} color="bg-amber-500" />
        <StatCard title="Total de Fichas" value={data.stats.totalChips.toLocaleString()} subValue={`${(data.stats.chipsInBinders || 0).toLocaleString()} em fichários · ${(data.stats.chipsInPlay || 0).toLocaleString()} no Salão`} icon={<Coins size={20}/>} color="bg-emerald-500" />
        <StatCard title="Valor em Fichas" value={(data.stats.stockValue || 0).toLocaleString(locale())} subValue="Σ valor × saldo derivado" icon={<Coins size={20}/>} color="bg-violet-500" />
        <StatCard title="Logs Totais" value={data.pagination.total} subValue="Registros" icon={<Clock size={20}/>} color="bg-purple-500" />
      </div>

      {/* Fichas: descartes, perdas e recuperações (derivados das movimentações) */}
      <div data-testid="chip-flow-stats" className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
        <StatCard title="Descartadas" value={(data.stats.discardedChips || 0).toLocaleString()} subValue={`valor ${(data.stats.discardedValue || 0).toLocaleString(locale())}`} icon={<Coins size={20}/>} color="bg-rose-500" />
        <StatCard title="Perdidas" value={(data.stats.lostChips || 0).toLocaleString()} subValue={`valor ${(data.stats.lostValue || 0).toLocaleString(locale())}`} icon={<Activity size={20}/>} color="bg-red-500" />
        <StatCard title="Recuperadas" value={(data.stats.recoveredChips || 0).toLocaleString()} subValue={`valor ${(data.stats.recoveredValue || 0).toLocaleString(locale())}`} icon={<Activity size={20}/>} color="bg-emerald-600" />
        <StatCard title="Ocorrências abertas" value={data.stats.openOccurrences || 0} subValue={`${data.stats.redOccurrences || 0} vermelha(s)`} icon={<Info size={20}/>} color="bg-amber-600" />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="card p-8">
          <h3 className="text-lg font-bold text-fg mb-8">Chip Races por Torneio</h3>
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

        <div className="card p-8">
          <h3 className="text-lg font-bold text-fg mb-8">Distribuição de Fichas</h3>
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
      <div className="card overflow-hidden">
        <div className="p-8 border-b border-line-soft flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-fg">Log de Atividades</h3>
          <div className="flex bg-raised p-1 rounded-2xl overflow-x-auto">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => { setCategoryFilter(cat.id); setPage(1); }}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${categoryFilter === cat.id ? 'bg-surface text-brand-fg ' : 'text-fg-muted hover:text-gray-700'}`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-sunken">
                <th className="px-8 py-4 text-xs font-bold text-fg-subtle uppercase tracking-wide">Data / Hora</th>
                <th className="px-8 py-4 text-xs font-bold text-fg-subtle uppercase tracking-wide">Ação</th>
                <th className="px-8 py-4 text-xs font-bold text-fg-subtle uppercase tracking-wide">Categoria</th>
                <th className="px-8 py-4 text-xs font-bold text-fg-subtle uppercase tracking-wide">Usuário</th>
                <th className="px-8 py-4 text-xs font-bold text-fg-subtle uppercase tracking-wide text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-zinc-800/50">
              {data.logs.map((log) => (
                <tr key={log._id} className="hover:bg-sunken transition-all group">
                  <td className="px-8 py-5 text-xs font-bold text-fg-subtle">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-sm font-bold text-fg uppercase group-hover:text-genesis-red transition-all">{log.action}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className={`px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-tighter ${getCategoryColor(log.category)}`}>
                      {log.category}
                    </span>
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
              ))}
            </tbody>
          </table>
          
          {/* Pagination Controls */}
          <div className="p-8 bg-sunken flex items-center justify-between">
            <p className="text-xs font-bold text-fg-subtle uppercase">Total: {data.pagination.total} registros</p>
            <div className="flex items-center gap-2">
              <button 
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="p-2 rounded-xl bg-surface border border-line disabled:opacity-30 transition-all"
              >
                <ChevronLeft size={20}/>
              </button>
              <span className="px-4 text-sm font-bold text-fg">Página {page} de {data.pagination.pages}</span>
              <button 
                disabled={page >= data.pagination.pages}
                onClick={() => setPage(p => p + 1)}
                className="p-2 rounded-xl bg-surface border border-line disabled:opacity-30 transition-all"
              >
                <ChevronRight size={20}/>
              </button>
            </div>
          </div>
          
          {data.logs.length === 0 && (
            <div className="py-20 text-center text-fg-subtle font-medium italic">Nenhum registro encontrado.</div>
          )}
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
                  <div>
                    <span className={`px-2 py-1 rounded-lg text-xs font-bold uppercase tracking-tighter mb-2 inline-block ${getCategoryColor(selectedLog.category)}`}>
                      {selectedLog.category}
                    </span>
                    <h2 className="text-2xl font-bold text-fg">{selectedLog.action}</h2>
                  </div>
                  <button onClick={() => setSelectedLog(null)} className="p-2 text-fg-subtle hover:text-gray-600 transition-all"><X /></button>
                </div>

                <div className="bg-sunken p-6 rounded-3xl border border-line-soft space-y-4">
                  <div>
                    <p className="text-xs font-bold text-fg-subtle uppercase tracking-wide mb-1">Detalhes da Operação</p>
                    <p className="text-sm font-medium text-fg leading-relaxed">{selectedLog.details}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-line">
                    <div>
                      <p className="text-xs font-bold text-fg-subtle uppercase tracking-wide mb-1">Usuário</p>
                      <p className="text-sm font-bold text-fg">{selectedLog.user_name || 'Sistema'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-fg-subtle uppercase tracking-wide mb-1">Horário</p>
                      <p className="text-sm font-bold text-fg">{new Date(selectedLog.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                <button onClick={() => setSelectedLog(null)} className="w-full py-4 bg-gray-900 dark:bg-white dark:text-gray-900 text-white font-bold text-xs rounded-2xl hover:opacity-90 transition-all">Fechar Detalhes</button>
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
    <div className="card p-6 relative group hover:border-brand transition-all overflow-hidden">
      <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-5 group-hover:opacity-10 transition-all ${color}`}></div>
      <div className="flex flex-col h-full justify-between">
        <div className="flex items-center justify-between mb-4">
          <div className={`p-3 rounded-2xl text-white ${color}`}>{icon}</div>
          <ArrowUpRight size={16} className="text-gray-300 group-hover:text-genesis-red transition-all" />
        </div>
        <div>
          <h4 className="text-xs font-bold text-fg-subtle uppercase tracking-wide mb-1">{title}</h4>
          <p className="text-2xl font-bold text-fg">{value}</p>
          <p className="text-xs font-bold text-fg-muted mt-1">{subValue}</p>
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
    system: 'bg-gray-500/10 text-fg-muted'
  };
  return colors[cat] || 'bg-raised text-fg-subtle';
}