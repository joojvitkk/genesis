import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  MonitorPlay, Users, Coins, Clock, ChevronRight, 
  Search, Play, Pause, CheckCircle2, Calendar, Archive
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import { tournamentWhen } from '../lib/format';

export default function Salao() {
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();
  const { showAlert } = useAlert();

  useEffect(() => {
    fetchTournaments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchTournaments = async () => {
    try {
      setTournaments(await apiGet('/tournaments'));
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar torneios', 'error');
    } finally {
      setLoading(false);
    }
  };

  const filtered = tournaments.filter(t =>
    (t.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeTournaments = filtered.filter(t => t.status !== 'finished');
  const finishedTournaments = filtered.filter(t => t.status === 'finished');

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="page-title">Visão de Salão</h1>
          <p className="page-sub">Gerenciamento de entradas e controle de mesa em tempo real</p>
        </div>
        
        <div className="flex flex-1 md:max-w-md items-center gap-3 bg-surface p-2 rounded-2xl border border-line-soft">
          <Search size={20} className="text-fg-subtle ml-2" />
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
          {[1,2,3].map(i => <div key={i} className="h-64 bg-raised rounded-2xl"></div>)}
        </div>
      ) : (
        <>
          {/* Active Section */}
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-500/10 text-emerald-500 rounded-lg"><MonitorPlay size={20}/></div>
              <h2 className="text-xl font-bold text-fg">Torneios Ativos</h2>
              <div className="h-[1px] flex-1 bg-raised ml-2"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {activeTournaments.map((t) => (
                <TournamentCard key={t._id} tournament={t} onOpen={() => navigate(`/torneios?id=${t._id}&tab=salao`)} />
              ))}
              {activeTournaments.length === 0 && (
                <div className="col-span-full py-12 text-center text-fg-subtle font-medium italic border-2 border-dashed border-line-soft rounded-2xl">Nenhum torneio ativo no momento.</div>
              )}
            </div>
          </section>

          {/* Finished Section */}
          {finishedTournaments.length > 0 && (
            <section className="space-y-6 opacity-60 hover:opacity-100 transition-opacity">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-500/10 text-fg-muted rounded-lg"><Archive size={20}/></div>
                <h2 className="text-xl font-bold text-fg-muted">Torneios Finalizados</h2>
                <div className="h-[1px] flex-1 bg-raised ml-2"></div>
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
      className="card hover:border-brand transition-all group flex flex-col h-full overflow-hidden"
    >
      <div className="p-8 flex-1 space-y-6">
        <div className="flex items-center justify-between">
          <StatusBadge status={tournament.status} />
          <div className="flex items-center gap-1 text-xs font-bold text-fg-subtle uppercase tracking-wide">
            <Clock size={12}/> {tournament.start_time}
          </div>
        </div>

        <div>
          <h3 className="text-2xl font-bold text-fg leading-none mb-2 group-hover:text-genesis-red transition-all">
            {tournament.name}
          </h3>
          <div className="flex items-center gap-2 text-xs font-bold text-fg-subtle">
            <Calendar size={14}/> {tournamentWhen(tournament)}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-sunken p-4 rounded-3xl border border-line-soft">
            <p className="text-xs font-bold text-fg-subtle uppercase mb-1">Jogando</p>
            <div className="flex items-center gap-2">
              <Users size={16} className="text-brand-fg" />
              <span className="text-lg font-bold text-fg">{tournament.actual_players || 0}</span>
            </div>
          </div>
          <div className="bg-sunken p-4 rounded-3xl border border-line-soft">
            <p className="text-xs font-bold text-fg-subtle uppercase mb-1">Stack Inicial</p>
            <div className="flex items-center gap-2">
              <Coins size={16} className="text-amber-500" />
              <span className="text-lg font-bold text-fg">{tournament.starting_stack?.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="px-8 pb-8">
        <button 
          onClick={onOpen}
          className="w-full py-4 bg-gray-900 dark:bg-white dark:text-gray-900 text-white font-bold text-xs rounded-2xl hover:bg-brand dark:hover:bg-brand dark:hover:text-white transition-all flex items-center justify-center gap-2 group-hover:scale-[1.02]"
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
    finished: { label: 'Finalizado', color: 'bg-gray-500/10 text-fg-muted', icon: <CheckCircle2 size={12}/> }
  };
  const config = configs[status] || configs.scheduled;
  return (
    <div className={`px-3 py-1 rounded-full flex items-center gap-2 text-xs font-bold uppercase tracking-wide ${config.color}`}>
      {config.icon} {config.label}
    </div>
  );
}
