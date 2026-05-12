import React, { useEffect, useState } from 'react';
import { Trophy, Coins, Briefcase, Activity, PlayCircle, CheckCircle2, Clock, PlusCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { BACKEND_URL } from '../App';

function formatTimeAgo(dateString) {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `Há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Há ${days} dias`;
}

function getActivityIcon(category) {
  switch(category) {
    case 'tournament': return <PlayCircle size={18} />;
    case 'inventory': return <PlusCircle size={18} />;
    case 'chip_case': return <Briefcase size={18} />;
    case 'chip_race': return <Activity size={18} />;
    default: return <CheckCircle2 size={18} />;
  }
}

function getActivityColor(category) {
  switch(category) {
    case 'tournament': return 'text-emerald-500';
    case 'inventory': return 'text-genesis-red';
    case 'chip_case': return 'text-blue-500';
    case 'chip_race': return 'text-amber-500';
    default: return 'text-gray-500';
  }
}

const StatusBadge = ({ status }) => {
  switch (status) {
    case 'running':
      return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500">Em Andamento</span>;
    case 'scheduled':
      return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500">Agendado</span>;
    case 'finished':
      return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-400">Finalizado</span>;
    default:
      return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-400">{status}</span>;
  }
};

const containerAnim = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const cardAnim = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
};

export default function Dashboard() {
  const [data, setData] = useState({
    metrics: { activeTournamentsCount: 0, totalChipsInStock: 0, availableCases: 0, chipRacesToday: 0 },
    recentTournaments: [],
    recentActivities: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem('genesis_token');
        const res = await fetch(`${BACKEND_URL}/api/dashboard/stats`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await res.json();
        if (res.ok) setData(result);
      } catch (e) {
        console.error('Error fetching dashboard data:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const { metrics, recentTournaments, recentActivities } = data;

  const SUMMARY_METRICS = [
    { label: 'Torneios Ativos', value: metrics.activeTournamentsCount, icon: <Trophy size={24} />, color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-500/10', border: 'border-emerald-200 dark:border-emerald-500/20' },
    { label: 'Fichas no Estoque', value: metrics.totalChipsInStock.toLocaleString('pt-BR'), icon: <Coins size={24} />, color: 'text-genesis-red', bg: 'bg-red-50 dark:bg-genesis-red/10', border: 'border-red-200 dark:border-genesis-red/20' },
    { label: 'Fichários Livres', value: metrics.availableCases, icon: <Briefcase size={24} />, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10', border: 'border-blue-200 dark:border-blue-500/20' },
    { label: 'Chip Races Hoje', value: metrics.chipRacesToday, icon: <Activity size={24} />, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10', border: 'border-amber-200 dark:border-amber-500/20' }
  ];

  if (loading) return (
    <div className="flex justify-center items-center h-[50vh] text-gray-500 animate-pulse">
      <Activity className="animate-spin text-genesis-red mr-3" /> Atualizando métricas do salão...
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="text-3xl md:text-4xl font-extrabold mb-2 text-gray-900 dark:text-white">Dashboard Overview</h1>
        <p className="text-gray-500 dark:text-gray-400">Visão macro do ecossistema Genesis em tempo real.</p>
      </motion.div>

      {/* Top Metrics Cards */}
      <motion.div variants={containerAnim} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {SUMMARY_METRICS.map((metric, idx) => (
          <motion.div variants={cardAnim} key={idx} className={`bg-white dark:bg-[#141414] p-6 rounded-3xl border ${metric.border} shadow-sm hover:shadow-lg transition-shadow`}>
            <div className="flex items-center justify-between mb-4">
              <div className={`p-3 rounded-2xl ${metric.bg} ${metric.color}`}>
                {metric.icon}
              </div>
            </div>
            <div>
              <p className="text-3xl font-black text-gray-900 dark:text-white mb-1">{metric.value}</p>
              <p className="text-sm font-semibold text-gray-500 dark:text-gray-400">{metric.label}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Split Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Torneios Recentes */}
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2, type: 'spring', stiffness: 200, damping: 20 }} className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-xl overflow-hidden flex flex-col min-h-[400px]">
          <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 bg-gray-50 dark:bg-[#111111] flex items-center justify-between">
            <h2 className="text-xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
              <Trophy className="text-genesis-red" size={22} /> Torneios Recentes
            </h2>
          </div>
          <div className="p-0 flex-1">
            {recentTournaments.length === 0 ? (
              <div className="p-8 text-center text-gray-400">Nenhum torneio cadastrado.</div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-zinc-800/50">
                {recentTournaments.map(t => (
                  <motion.li whileHover={{ x: 5 }} key={t._id} className="p-6 hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white text-lg">{t.name}</h3>
                      <div className="flex items-center gap-1.5 mt-1 text-sm text-gray-500 dark:text-gray-400 font-medium">
                        <Clock size={14} /> Início: {t.start_time || 'Não definido'}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <StatusBadge status={t.status} />
                    </div>
                  </motion.li>
                ))}
              </ul>
            )}
          </div>
        </motion.div>

        {/* Atividades Recentes */}
        <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, type: 'spring', stiffness: 200, damping: 20 }} className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-xl overflow-hidden flex flex-col min-h-[400px]">
          <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 bg-gray-50 dark:bg-[#111111] flex items-center justify-between">
            <h2 className="text-xl font-bold flex items-center gap-2 text-gray-900 dark:text-white">
              <Activity className="text-genesis-red" size={22} /> Feed de Atividades
            </h2>
          </div>
          <div className="p-6 flex-1">
            {recentActivities.length === 0 ? (
              <div className="text-center text-gray-400 mt-8">O log de auditoria está vazio.</div>
            ) : (
              <div className="space-y-6">
                {recentActivities.map((activity, idx) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 + (idx * 0.1) }}
                    key={activity._id} 
                    className="flex gap-4 relative"
                  >
                    {/* Timeline Connector */}
                    {idx !== recentActivities.length - 1 && (
                      <div className="absolute left-[19px] top-[38px] bottom-[-24px] w-0.5 bg-gray-100 dark:bg-zinc-800"></div>
                    )}
                    
                    <div className={`mt-1 shrink-0 p-2.5 rounded-full bg-white dark:bg-[#141414] border-2 border-gray-100 dark:border-zinc-800 ${getActivityColor(activity.category)} relative z-10`}>
                      {getActivityIcon(activity.category)}
                    </div>
                    
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-gray-900 dark:text-white">{activity.action}</h3>
                        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500">{formatTimeAgo(activity.createdAt)}</span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{activity.details}</p>
                      <p className="text-xs text-gray-400 font-mono mt-1">Por: {activity.user_name || 'Sistema'}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>

      </div>
    </div>
  );
}