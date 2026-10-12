import { locale } from '../lib/i18n';
import { Link } from 'react-router-dom';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import SeverityBadge from './SeverityBadge';

const n = (v) => (v ?? 0).toLocaleString(locale());
const Card = ({ title, hint, children, testid, className = '' }) => (
  <section data-testid={testid} className={`card ${className}`}>
    <h2 className="text-lg font-bold text-fg">{title}</h2>
    {hint && <p className="mb-4 mt-1 text-xs text-fg-muted">{hint}</p>}
    {children}
  </section>
);
const Empty = ({ children }) => <p className="py-6 text-center text-sm italic text-fg-subtle">{children}</p>;

/** Faixa de alertas: o que exige atenção agora (vermelhas em aberto, conflitos de alocação, sem justificativa). */
export function AlertStrip({ occurrences }) {
  const items = [];
  const red = occurrences?.open_by_severity?.RED || 0;
  if (red > 0) items.push({ key: 'red', icon: <ShieldAlert size={16} />, to: '/ocorrencias', text: `${red} ocorrência(s) vermelha(s) em aberto` });
  if (occurrences?.pending_justification > 0) items.push({ key: 'just', icon: <AlertTriangle size={16} />, to: '/ocorrencias', text: `${occurrences.pending_justification} ocorrência(s) sem justificativa`, soft: true });
  if (!items.length) return null;
  return (
    <div data-testid="alert-strip" role="region" aria-label="Alertas" className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Link key={i.key} to={i.to} data-alert={i.key} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold tracking-wider ${i.soft ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>{i.icon} {i.text}</Link>
      ))}
    </div>
  );
}

/** Ocorrências abertas por semáforo + recuperadas. */
export function OccurrencePanel({ occurrences }) {
  if (!occurrences) return null;
  return (
    <Card testid="occurrences" title="Ocorrências" hint="Divergências físicas em aberto, por semáforo.">
      <div className="flex flex-wrap items-center gap-3">
        {['RED', 'YELLOW', 'GREEN'].map((lvl) => (
          <span key={lvl} className="flex items-center gap-2"><SeverityBadge level={lvl} /><span data-count={lvl} className="text-xl font-bold tabular-nums">{occurrences.open_by_severity[lvl]}</span></span>
        ))}
      </div>
      <p className="mt-3 text-xs text-fg-muted">
        Faltam {n(occurrences.missing_quantity)} ficha(s) · recuperadas {n(occurrences.recovered.quantity)} em {n(occurrences.recovered.occurrences)} ocorrência(s) ·{' '}
        <Link to="/ocorrencias" className="font-bold text-brand-fg hover:underline">ver ocorrências</Link>
      </p>
    </Card>
  );
}

export const TYPE_LABEL = {
  ASSEMBLY: 'Montagem', WITHDRAWAL: 'Saída', ADJUSTMENT: 'Ajuste', LOSS: 'Perda', FOUND: 'Sobra', RECOVERY: 'Recuperação', REVERSAL: 'Estorno', DISCARD: 'Descarte',
  RETURN: 'Retorno', SEND_BUY_IN: 'Envio', SEND_OPTIONAL: 'Envio', SEND_REENTRY: 'Envio', SEND_ADDITIONAL: 'Envio',
  CHIP_RACE_OUT: 'Chip race', CHIP_RACE_IN: 'Chip race', COLOR_UP_OUT: 'Color up', COLOR_UP_IN: 'Color up',
};

const REQ_LABEL = { requested: 'Solicitado', in_preparation: 'Em preparo', ready: 'Pronto' };
/** Chamados de Chip Race / Color Up em aberto (Salão solicita, Material atende). */
export function RequestsPanel({ requests }) {
  return (
    <Card testid="requests" title="Chip Race / Color Up" hint="Chamados do Salão ao Material em aberto.">
      {!requests?.length ? <Empty>Nenhum chamado em aberto.</Empty> : (
        <ul className="space-y-2 text-sm">
          {requests.map((r) => (
            <li key={r._id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sunken p-3">
              <span className="font-bold">
                {r.type === 'CHIP_RACE' ? 'Chip Race' : 'Color Up'} · {r.tournament_id?.name}{r.session_id?.name ? ` · ${r.session_id.name}` : ''}{r.chip_id?.value ? ` · ficha ${n(r.chip_id.value)}` : ''} · {n(r.tables)} mesa(s)
              </span>
              <span className="badge badge-warn">{REQ_LABEL[r.status] || r.status}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs"><Link to="/chip-race" className="font-bold text-brand-fg hover:underline">abrir Chip Race</Link></p>
    </Card>
  );
}
