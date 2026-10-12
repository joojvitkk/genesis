import { locale } from '../lib/i18n';
import { useState } from 'react';
import { Trophy, Briefcase, Activity, BellRing, Clock, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDashboard } from '../lib/useDashboard';
import RunningClocks from '../components/RunningClocks';
import { AlertStrip, OccurrencePanel, RequestsPanel } from '../components/DashboardPanels';

const n = (v) => (v ?? 0).toLocaleString(locale());

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
  // Informação acionável: torneios (um relógio por sessão), fichários livres, fichas EM JOGO por torneio/sessão, chamados e ocorrências.
  const { data, loading } = useDashboard();
  const metrics = data.metrics || { activeTournamentsCount: 0, availableCases: 0 };
  const recentTournaments = data.recentTournaments || [];
  const [showFree, setShowFree] = useState(false);
  const [openBinder, setOpenBinder] = useState(null);
  const free = data.free_binders || [];
  const inPlay = data.tournament_chips || { rows: [], totals: { quantity: 0, value: 0 } };
  const openCalls = (data.requests || []).length;

  if (loading) return (
    <div className="flex justify-center items-center h-[50vh] text-fg-muted animate-pulse">
      <Activity className="animate-spin text-brand-fg mr-3" /> Atualizando métricas do salão...
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="page-title">Dashboard Overview</h1>
        <p className="page-sub">O que está acontecendo agora nos torneios e no Material.</p>
      </motion.div>

      <AlertStrip occurrences={data.occurrences} />

      {/* Indicadores: torneios ativos · fichários livres (clique mostra quais) · chamados de Chip Race em aberto */}
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
        <div data-testid="metric-open-calls" className="card">
          <p className="section-title flex items-center gap-2"><BellRing size={16} aria-hidden="true" /> Chamados em aberto</p>
          <p className="stat-value mt-2">{n(openCalls)}</p>
          <p className="card-hint">Chip Race / Color Up</p>
        </div>
      </div>

      {showFree && (
        <section data-testid="free-binders" className="card p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-bold text-fg">Fichários livres</h2>
            <button type="button" onClick={() => setShowFree(false)} aria-label="Fechar" className="text-fg-subtle hover:text-fg"><X size={18} /></button>
          </div>
          {free.length === 0 ? <p className="py-4 text-sm italic text-fg-subtle">Nenhum fichário livre: todos estão vinculados a torneios.</p> : (
            <ul className="divide-y divide-line-soft">
              {free.map((b) => (
                <li key={b._id} className="py-2 text-sm">
                  <button type="button" onClick={() => setOpenBinder((cur) => (cur === b._id ? null : b._id))} className="flex w-full flex-wrap items-center justify-between gap-2 text-left">
                    <span className="font-bold text-fg">{b.name}{b.code ? <span className="ml-2 rounded bg-raised px-1.5 py-0.5 font-mono text-xs">{b.code}</span> : null}</span>
                    <span className="text-xs text-fg-muted">{n(b.chips_total)} fichas</span>
                  </button>
                  {openBinder === b._id && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {(b.chips || []).map((c) => (
                        <span key={c.chip._id} className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2 py-1 font-bold text-fg">
                          <span className="h-2 w-2 rounded-full border border-line" style={{ backgroundColor: c.chip.color }} /> {n(c.chip.value)} × {n(c.quantity)}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Torneios rodando agora: um relógio por sessão */}
      <RunningClocks clocks={data.running_clocks || []} />

      {/* Fichas EM JOGO por torneio e sessão: o que já entrou nos stacks dos jogadores (não o que foi só enviado ao Salão) */}
      <section data-testid="chips-by-tournament" className="card p-6">
        <h2 className="text-lg font-bold text-fg">Fichas em jogo por torneio</h2>
        <p className="mb-4 mt-1 text-xs text-fg-muted">Somente o que as entradas já entregaram aos jogadores (Chip Count). Fichas enviadas ao Salão e ainda não usadas não entram aqui.</p>
        {inPlay.rows.length === 0 ? <p className="py-4 text-sm italic text-fg-subtle">Nenhum torneio em andamento.</p> : (
          <ul className="space-y-4">
            {inPlay.rows.map((r) => (
              <li key={r.tournament._id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold text-fg">{r.tournament.name}</span>
                  <span className="text-xs text-fg-muted">{n(r.quantity)} fichas · valor nominal de jogo {n(r.value)}</span>
                </div>
                {(r.sessions?.length > 1 ? r.sessions : [{ session: null, chips: r.chips, quantity: r.quantity }]).map((s) => (
                  <div key={s.session?._id || 'all'} className="mt-1">
                    {s.session && <p className="text-xs font-semibold text-fg-muted">{s.session.name} · {n(s.quantity)} fichas</p>}
                    <div className="flex flex-wrap gap-2 text-xs">
                      {s.chips.map((c) => (
                        <span key={c.chip._id} className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2 py-1 font-bold text-fg">
                          <span className="h-2 w-2 rounded-full border border-line" style={{ backgroundColor: c.chip.color }} /> {n(c.chip.value)} × {n(c.quantity)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RequestsPanel requests={data.requests} />
        <OccurrencePanel occurrences={data.occurrences} />
      </div>

      {/* Grade de torneios */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card flex flex-col overflow-hidden">
        <div className="p-6 border-b border-line-soft bg-sunken flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2 text-fg">
            <Trophy className="text-brand-fg" size={22} /> Grade de Torneios
          </h2>
        </div>
        {recentTournaments.length === 0 ? (
          <div className="p-8 text-center text-fg-subtle">Nenhum torneio cadastrado.</div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {recentTournaments.map((t) => (
              <li key={t._id} className="p-6 hover:bg-sunken transition-colors flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-fg text-lg">{t.name}</h3>
                  <div className="flex items-center gap-1.5 mt-1 text-sm text-fg-muted font-medium">
                    <Clock size={14} /> Início: {t.start_time || 'Não definido'}
                  </div>
                </div>
                <div className="shrink-0"><StatusBadge status={t.status} /></div>
              </li>
            ))}
          </ul>
        )}
      </motion.div>
    </div>
  );
}
