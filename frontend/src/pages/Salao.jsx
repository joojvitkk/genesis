import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  MonitorPlay, Trophy, Users, Coins, Clock, ChevronRight, 
  Search, Filter, LayoutGrid, List, Play, Pause, CheckCircle2, Calendar, Archive
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BACKEND_URL } from '../App';

export default function Salao() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    fetchTournaments();
  }, []);

  const fetchTournaments = async () => {
    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/tournaments`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setTournaments(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const filtered = tournaments.filter(t => 
    t.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeTournaments = filtered.filter(t => t.status !== 'finished');
  const finishedTournaments = filtered.filter(t => t.status === 'finished');

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">Visão de Salão</h1>
          <p className="text-gray-500 font-medium italic">Gerenciamento de entradas e controle de mesa em tempo real</p>
        </div>
        
        <div className="flex flex-1 md:max-w-md items-center gap-3 bg-white dark:bg-zinc-900 p-2 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm">
          <Search size={20} className="text-gray-400 ml-2" />
          <input 
            type="text" 
            placeholder="Buscar por nome do evento..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-transparent border-none outline-none text-sm font-bold dark:text-white"
          />
        </div>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-64 bg-gray-100 dark:bg-zinc-800 rounded-[40px]"></div>)}
        </div>
      ) : (
        <>
          {/* Active Section */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg"><MonitorPlay size={20}/></div>
              <h2 className="text-xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Torneios Ativos</h2>
              <div className="h-[1px] flex-1 bg-gray-100 dark:bg-zinc-800 ml-2"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {activeTournaments.map((t) => (
                <TournamentCard key={t._id} tournament={t} onOpen={() => navigate(`/torneios?id=${t._id}&tab=salao`)} />
              ))}
              {activeTournaments.length === 0 && (
                <div className="col-span-full py-12 text-center text-gray-400 font-medium italic border-2 border-dashed border-gray-100 dark:border-zinc-800 rounded-[40px]">Nenhum torneio ativo no momento.</div>
              )}
            </div>
          </section>

          {/* Finished Section */}
          {finishedTournaments.length > 0 && (
            <section className="space-y-6 opacity-60 hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-500/10 text-gray-500 rounded-lg"><Archive size={20}/></div>
                <h2 className="text-xl font-black text-gray-500 uppercase tracking-tight">Torneios Finalizados</h2>
                <div className="h-[1px] flex-1 bg-gray-100 dark:bg-zinc-800 ml-2"></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {finishedTournaments.map((t) => (
                  <TournamentCard key={t._id} tournament={t} onOpen={() => navigate(`/torneios?id=${t._id}&tab=salao`)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function TournamentCard({ tournament, onOpen }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-[#111111] rounded-[40px] border border-gray-100 dark:border-zinc-800 shadow-sm hover:border-genesis-red transition-all group overflow-hidden flex flex-col h-full"
    >
      <div className="p-8 flex-1 space-y-6">
        <div className="flex items-center justify-between">
          <StatusBadge status={tournament.status} />
          <div className="flex items-center gap-1 text-[10px] font-black text-gray-400 uppercase tracking-widest">
            <Clock size={12}/> {tournament.start_time}
          </div>
        </div>

        <div>
          <h3 className="text-2xl font-black text-gray-900 dark:text-white uppercase leading-none mb-2 group-hover:text-genesis-red transition-all">
            {tournament.name}
          </h3>
          <div className="flex items-center gap-2 text-xs font-bold text-gray-400">
            <Calendar size={14}/> {new Date(tournament.date).toLocaleDateString()}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 dark:bg-zinc-900/50 p-4 rounded-3xl border border-gray-100 dark:border-zinc-800">
            <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Jogadores</p>
            <div className="flex items-center gap-2">
              <Users size={16} className="text-genesis-red" />
              <span className="text-lg font-black text-gray-900 dark:text-white">{tournament.actual_players || 0}</span>
            </div>
          </div>
          <div className="bg-gray-50 dark:bg-zinc-900/50 p-4 rounded-3xl border border-gray-100 dark:border-zinc-800">
            <p className="text-[10px] font-black text-gray-400 uppercase mb-1">Stack Inicial</p>
            <div className="flex items-center gap-2">
              <Coins size={16} className="text-amber-500" />
              <span className="text-lg font-black text-gray-900 dark:text-white">{tournament.starting_stack?.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 pb-8">
        <button 
          onClick={onOpen}
          className="w-full py-4 bg-gray-900 dark:bg-white dark:text-gray-900 text-white font-black uppercase text-xs rounded-[20px] hover:bg-genesis-red dark:hover:bg-genesis-red dark:hover:text-white transition-all shadow-lg flex items-center justify-center gap-2 group-hover:scale-[1.02]"
        >
          Abrir Visão do Salão <ChevronRight size={16}/>
        </button>
      </div>
    </motion.div>
  );
}

function StatusBadge({ status }) {
  const configs = {
    scheduled: { label: 'Agendado', color: 'bg-blue-500/10 text-blue-500', icon: <Calendar size={12}/> },
    running: { label: 'Em Andamento', color: 'bg-emerald-500/10 text-emerald-500', icon: <Play size={12}/> },
    paused: { label: 'Pausado', color: 'bg-amber-500/10 text-amber-500', icon: <Pause size={12}/> },
    finished: { label: 'Finalizado', color: 'bg-gray-500/10 text-gray-500', icon: <CheckCircle2 size={12}/> }
  };
  const config = configs[status] || configs.scheduled;
  return (
    <div className={`px-3 py-1 rounded-full flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${config.color}`}>
      {config.icon} {config.label}
    </div>
  );
}
