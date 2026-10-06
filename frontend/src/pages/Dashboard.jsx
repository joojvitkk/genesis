import { locale } from '../lib/i18n';
import { useState } from 'react';
import { Trophy, Briefcase, Activity, PlayCircle, CheckCircle2, Clock, PlusCircle, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDashboard } from '../lib/useDashboard';
import { getStoredUser } from '../lib/auth';
import RunningClocks from '../components/RunningClocks';
import { AlertStrip, ChipSummary, BinderMatrix, InPlayPanel, FlowsPanel, OccurrencePanel, ConflictsPanel, Timeline, RequestsPanel, ReentriesPanel } from '../components/DashboardPanels';

const n = (v) => (v ?? 0).toLocaleString(locale());

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
    case 'inventory': return 'text-brand-fg';
    case 'chip_case': return 'text-blue-500';
    case 'chip_race': return 'text-amber-500';
    default: return 'text-fg-muted';
  }
}

const StatusBadge = ({ status }) => {
  switch (status) {
    case 'running':
      return <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500">Em Andamento</span>;
    case 'scheduled':
      return <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500">Agendado</span>;
    case 'finished':
      return <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-raised text-fg-muted">Finalizado</span>;
    default:
      return <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-raised text-fg-muted">{status}</span>;
  }
};

export default function Dashboard() {
  // Tudo vem dos MOVIMENTOS (GET /dashboard/stats); o painel refaz só o bloco afetado por cada evento em tempo real.
  const { data, loading } = useDashboard();
  const metrics = data.metrics || { activeTournamentsCount: 0, totalChipsInStock: 0, stockValue: 0, availableCases: 0, chipsInPlay: 0, chipRacesToday: 0 };
  const recentTournaments = data.recentTournaments || [];
  const recentActivities = data.recentActivities || [];

  // Salão e Material: painel enxuto (sem denominações, linha do tempo, feed nem detalhamento de fichários).
  const lean = getStoredUser()?.role !== 'admin';
  const [showFree, setShowFree] = useState(false);
  const free = data.free_binders || [];
  const inPlay = data.tournament_chips || { rows: [], totals: { quantity: 0, value: 0 } };

  if (loading) return (
    <div className="flex justify-center items-center h-[50vh] text-fg-muted animate-pulse">
      <Activity className="animate-spin text-brand-fg mr-3" /> Atualizando métricas do salão...
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="page-title">Dashboard Overview</h1>
        <p className="page-sub">Onde estão as fichas e o que acontece agora — calculado das movimentações, em tempo real.</p>
      </motion.div>

      <AlertStrip occurrences={data.occurrences} conflicts={data.conflicts} />

      {/* Indicadores: torneios ativos · fichários livres (clique mostra quais) · fichas em jogo */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div data-testid="metric-tournaments" className="card">
          <p className="section-title flex items-center gap-2"><Trophy size={16} aria-hidden="true" /> Torneios ativos</p>
          <p className="stat-value mt-2">{n(metrics.activeTournamentsCount)}</p>
        </div>
        <button type="button" data-testid="metric-free-binders" onClick={() => setShowFree((v) => !v)} aria-expanded={showFree}
          className="card text-left transition-colors hover:border-fg-subtle">
          <p className="section-title flex items-center gap-2"><Briefcase size={16} aria-hidden="true" /> Fichários livres</p>
          <p className="stat-value mt-2">{n(metrics.availableCases)}</p>
          <p className="card-hint">Clique para ver quais</p>
        </button>
        <div data-testid="metric-chips-in-play" className="card">
          <p className="section-title flex items-center gap-2"><PlayCircle size={16} aria-hidden="true" /> Fichas em jogo</p>
          <p className="stat-value mt-2">{n(inPlay.totals.quantity)}</p>
          <p className="card-hint">Valor nominal {n(inPlay.totals.value)}</p>
        </div>
      </div>

      {showFree && (
        <section data-testid="free-binders" className="card p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-fg">Fichários livres</h2>
            <button type="button" onClick={() => setShowFree(false)} aria-label="Fechar" className="text-fg-subtle hover:text-gray-600"><X size={18} /></button>
          </div>
          {free.length === 0 ? <p className="py-4 text-sm italic text-fg-subtle">Nenhum fichário livre: todos estão alocados a torneios.</p> : (
            <ul className="divide-y divide-line-soft">
              {free.map((b) => (
                <li key={b._id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-bold text-fg dark:text-gray-200">{b.name}{b.stamp ? ` · ${b.stamp}` : ''}{b.code ? <span className="ml-2 rounded bg-raised px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-800">{b.code}</span> : null}</span>
                  <span className="text-xs text-fg-muted">{n(b.chips)} fichas</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Torneios rodando agora, com relógio ao vivo */}
      <RunningClocks tournaments={inPlay.rows.map((r) => r.tournament)} />

      {/* Fichas EM JOGO por torneio (Chip Count) */}
      <section data-testid="chips-by-tournament" className="card p-6">
        <h2 className="text-lg font-bold text-fg">Fichas em jogo por torneio</h2>
        <p className="mb-4 mt-1 text-xs text-fg-muted">O que as entradas já entregaram aos jogadores (Chip Count) em cada torneio em andamento.</p>
        {inPlay.rows.length === 0 ? <p className="py-4 text-sm italic text-fg-subtle">Nenhum torneio em andamento.</p> : (
          <ul className="space-y-4">
            {inPlay.rows.map((r) => (
              <li key={r.tournament._id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold text-fg">{r.tournament.name}</span>
                  <span className="text-xs text-fg-muted">{n(r.quantity)} fichas · valor {n(r.value)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs">
                  {r.chips.map((c) => (
                    <span key={c.chip._id} className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2 py-1 font-bold text-fg">
                      <span className="h-2 w-2 rounded-full border border-line" style={{ backgroundColor: c.chip.color }} /> {n(c.chip.value)} × {n(c.quantity)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!lean && (
        <>
          <h2 className="text-xs font-bold uppercase tracking-wide text-fg-subtle">Onde estão as fichas?</h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ChipSummary inventory={data.inventory} />
            <InPlayPanel inPlay={data.in_play} />
          </div>
          <BinderMatrix matrix={data.inventory?.matrix} />
        </>
      )}

      <h2 className="text-xs font-bold uppercase tracking-wide text-fg-subtle">O que acontece agora?</h2>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {!lean && <FlowsPanel flows={data.flows} />}
        <div className="space-y-6">
          <OccurrencePanel occurrences={data.occurrences} />
          <ConflictsPanel conflicts={data.conflicts} />
        </div>
        <div className="space-y-6">
          <RequestsPanel requests={data.requests} />
          <ReentriesPanel reentries={data.reentries} />
        </div>
      </div>
      {!lean && <Timeline items={data.timeline} />}

      {/* Split Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Torneios Recentes */}
        <motion.div initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2, type: 'spring', stiffness: 200, damping: 20 }} className="card flex flex-col min-h-[400px] overflow-hidden">
          <div className="p-6 border-b border-line-soft bg-sunken flex items-center justify-between">
            <h2 className="text-xl font-bold flex items-center gap-2 text-fg">
              <Trophy className="text-brand-fg" size={22} /> Grade de Torneios
            </h2>
          </div>
          <div className="p-0 flex-1">
            {recentTournaments.length === 0 ? (
              <div className="p-8 text-center text-fg-subtle">Nenhum torneio cadastrado.</div>
            ) : (
              <ul className="divide-y divide-line-soft">
                {recentTournaments.map(t => (
                  <motion.li whileHover={{ x: 5 }} key={t._id} className="p-6 hover:bg-sunken transition-colors flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-bold text-fg text-lg">{t.name}</h3>
                      <div className="flex items-center gap-1.5 mt-1 text-sm text-fg-muted font-medium">
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

        {/* Atividades Recentes (auditoria administrativa: só o admin) */}
        {!lean && <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3, type: 'spring', stiffness: 200, damping: 20 }} className="card flex flex-col min-h-[400px] overflow-hidden">
          <div className="p-6 border-b border-line-soft bg-sunken flex items-center justify-between">
            <h2 className="text-xl font-bold flex items-center gap-2 text-fg">
              <Activity className="text-brand-fg" size={22} /> Feed de Atividades
            </h2>
          </div>
          <div className="p-6 flex-1">
            {recentActivities.length === 0 ? (
              <div className="text-center text-fg-subtle mt-8">O log de auditoria está vazio.</div>
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
                      <div className="absolute left-[19px] top-[38px] bottom-[-24px] w-0.5 bg-raised"></div>
                    )}
                    
                    <div className={`mt-1 shrink-0 p-2.5 rounded-full bg-surface border-2 border-line-soft ${getActivityColor(activity.category)} relative z-10`}>
                      {getActivityIcon(activity.category)}
                    </div>
                    
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold text-fg">{activity.action}</h3>
                        <span className="text-xs font-semibold text-fg-subtle">{formatTimeAgo(activity.createdAt)}</span>
                      </div>
                      <p className="text-sm text-fg-muted leading-relaxed">{activity.details}</p>
                      <p className="text-xs text-fg-subtle font-mono mt-1">Por: {activity.user_name || 'Sistema'}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>}

      </div>
    </div>
  );
}