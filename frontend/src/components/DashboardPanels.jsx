import { Link } from 'react-router-dom';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import SeverityBadge from './SeverityBadge';

const n = (v) => (v ?? 0).toLocaleString('pt-BR');
const Card = ({ title, hint, children, testid, className = '' }) => (
  <section data-testid={testid} className={`rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#141414] ${className}`}>
    <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
    {hint && <p className="mb-4 mt-1 text-xs text-gray-500">{hint}</p>}
    {children}
  </section>
);
const Dot = ({ color }) => <span className="mr-2 inline-block h-3 w-3 rounded-full border border-gray-200 align-middle dark:border-zinc-700" style={{ backgroundColor: color }} />;
const Th = ({ children, left }) => <th className={`py-2 font-black ${left ? 'text-left' : 'px-2 text-right'}`}>{children}</th>;
const Empty = ({ children }) => <p className="py-6 text-center text-sm italic text-gray-400">{children}</p>;

/** Faixa de alertas: o que exige atenção agora (vermelhas em aberto, conflitos de alocação, sem justificativa). */
export function AlertStrip({ occurrences, conflicts }) {
  const items = [];
  const red = occurrences?.open_by_severity?.RED || 0;
  if (red > 0) items.push({ key: 'red', icon: <ShieldAlert size={16} />, to: '/ocorrencias', text: `${red} ocorrência(s) vermelha(s) em aberto` });
  if (conflicts?.length) items.push({ key: 'conf', icon: <AlertTriangle size={16} />, to: '/torneios', text: `${conflicts.length} alocação(ões) sem saldo suficiente` });
  if (occurrences?.pending_justification > 0) items.push({ key: 'just', icon: <AlertTriangle size={16} />, to: '/ocorrencias', text: `${occurrences.pending_justification} ocorrência(s) sem justificativa`, soft: true });
  if (!items.length) return null;
  return (
    <div data-testid="alert-strip" role="region" aria-label="Alertas" className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Link key={i.key} to={i.to} data-alert={i.key} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider ${i.soft ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>{i.icon} {i.text}</Link>
      ))}
    </div>
  );
}

/** Onde estão as fichas — por denominação: fichários, reservado, livre, em jogo, divergência. */
export function ChipSummary({ inventory }) {
  const rows = inventory?.rows || [];
  const t = inventory?.totals;
  return (
    <Card testid="chip-summary" title="Fichas por denominação" hint="Saldo derivado das movimentações. Reservado = separado para torneios ainda dentro do fichário.">
      {!rows.length ? <Empty>Nenhuma ficha em estoque.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-[10px] uppercase tracking-widest text-gray-400"><Th left>Ficha</Th><Th>Em fichários</Th><Th>Reservado</Th><Th>Livre</Th><Th>Em jogo</Th><Th>Divergência</Th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60">
              {rows.map((r) => (
                <tr key={r.chip._id}>
                  <td className="py-2 font-bold text-gray-700 dark:text-gray-300"><Dot color={r.chip.color} />{r.chip.name || n(r.chip.value)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{n(r.in_binders)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-amber-600">{n(r.reserved)}</td>
                  <td className="px-2 py-2 text-right font-bold tabular-nums text-emerald-600">{n(r.free)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{n(r.in_play)}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${r.lost > 0 ? 'font-black text-red-600' : ''}`}>{n(r.lost)}</td>
                </tr>
              ))}
            </tbody>
            {t && <tfoot><tr className="border-t-2 border-gray-200 text-xs font-black dark:border-zinc-700">
              <td className="py-2 uppercase tracking-widest text-gray-400">Total</td>
              <td className="px-2 py-2 text-right tabular-nums">{n(t.in_binders)}</td><td className="px-2 py-2 text-right tabular-nums">{n(t.reserved)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{n(t.free)}</td><td className="px-2 py-2 text-right tabular-nums">{n(t.in_play)}</td><td className="px-2 py-2 text-right tabular-nums">{n(t.lost)}</td>
            </tr></tfoot>}
          </table>
        </div>
      )}
    </Card>
  );
}

/** Matriz fichário × denominação (igual ao GET /balances). */
export function BinderMatrix({ matrix }) {
  const chips = matrix?.chips || [];
  const rows = matrix?.rows || [];
  return (
    <Card testid="binder-matrix" title="Fichário × denominação" hint="Quantas fichas há em cada fichário, por valor.">
      {!rows.length ? <Empty>Nenhum fichário com fichas.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 200 + chips.length * 80 }}>
            <thead><tr className="text-[10px] uppercase tracking-widest text-gray-400">
              <Th left>Fichário</Th>{chips.map((c) => <Th key={c._id}><Dot color={c.color} />{n(c.value)}</Th>)}<Th>Total</Th><Th>Valor</Th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60">
              {rows.map((r) => (
                <tr key={r.binder._id}>
                  <td className="py-2 font-bold text-gray-700 dark:text-gray-300">{r.binder.name}</td>
                  {chips.map((c) => <td key={c._id} className={`px-2 py-2 text-right tabular-nums ${r.cells[c._id] ? '' : 'text-gray-300'}`}>{r.cells[c._id] ? n(r.cells[c._id]) : '—'}</td>)}
                  <td className="px-2 py-2 text-right font-bold tabular-nums">{n(r.total)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-500">{n(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Em qual torneio / sessão estão as fichas em jogo. */
export function InPlayPanel({ inPlay }) {
  const rows = inPlay?.rows || [];
  return (
    <Card testid="in-play" title="Em jogo" hint="Fichas em mesa por torneio e sessão.">
      {!rows.length ? <Empty>Nenhuma ficha em jogo.</Empty> : (
        <ul className="space-y-4">
          {rows.map((r) => (
            <li key={r.tournament._id} data-tournament={r.tournament._id}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-bold text-gray-900 dark:text-white">{r.tournament.name}</span>
                <span className="text-xs text-gray-500">{n(r.quantity)} fichas · valor {n(r.value)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                {r.chips.map((c) => <span key={c.chip._id} className="rounded-lg bg-gray-100 px-2 py-1 font-bold text-gray-600 dark:bg-zinc-800 dark:text-gray-300"><Dot color={c.chip.color} />{n(c.chip.value)} × {n(c.quantity)}</span>)}
              </div>
              {r.sessions.filter((s) => s.session).length > 0 && (
                <p className="mt-1 text-[11px] text-gray-400">{r.sessions.filter((s) => s.session).map((s) => `${s.session.name}: ${n(s.quantity)}`).join(' · ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** O que aconteceu: enviadas, devolvidas, descartadas, chip race (com a quebra), perdidas e recuperadas. */
export function FlowsPanel({ flows }) {
  if (!flows) return null;
  const cells = [
    ['Enviadas', flows.sent, 'text-teal-600'], ['Devolvidas', flows.returned, 'text-sky-600'], ['Descartadas', flows.discarded, 'text-rose-600'],
    ['Perdidas', flows.lost, 'text-red-600'], ['Recuperadas', flows.recovered, 'text-emerald-600'],
  ];
  const races = [['Chip race', flows.chip_race], ['Color up', flows.color_up]];
  return (
    <Card testid="flows" title="O que aconteceu" hint="Movimentações líquidas (estornos já descontados), em fichas e em valor.">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cells.map(([label, c, cls]) => (
          <div key={label} data-flow={label} className="rounded-2xl border border-gray-100 p-3 dark:border-zinc-800">
            <p className={`text-2xl font-black tabular-nums ${cls}`}>{n(c.quantity)}</p>
            <p className="text-xs font-bold text-gray-500">{label}</p>
            <p className="text-[11px] text-gray-400">valor {n(c.value)}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-2 text-xs md:grid-cols-2">
        {races.map(([label, r]) => (
          <p key={label} data-flow={label} className="rounded-xl bg-amber-50 p-3 font-bold text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
            {label}: {r.count} lançamento(s) · saíram {n(r.out.quantity)} · entraram {n(r.in.quantity)} · quebra matemática {n(r.math_breakage)} <span className="font-normal">(não é perda)</span>
          </p>
        ))}
      </div>
    </Card>
  );
}

/** Ocorrências abertas por semáforo + recuperadas. */
export function OccurrencePanel({ occurrences }) {
  if (!occurrences) return null;
  return (
    <Card testid="occurrences" title="Ocorrências" hint="Divergências físicas em aberto, por semáforo.">
      <div className="flex flex-wrap items-center gap-3">
        {['RED', 'YELLOW', 'GREEN'].map((lvl) => (
          <span key={lvl} className="flex items-center gap-2"><SeverityBadge level={lvl} /><span data-count={lvl} className="text-xl font-black tabular-nums">{occurrences.open_by_severity[lvl]}</span></span>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Faltam {n(occurrences.missing_quantity)} ficha(s) · recuperadas {n(occurrences.recovered.quantity)} em {n(occurrences.recovered.occurrences)} ocorrência(s) ·{' '}
        <Link to="/ocorrencias" className="font-bold text-genesis-red hover:underline">ver ocorrências</Link>
      </p>
    </Card>
  );
}

export function ConflictsPanel({ conflicts }) {
  if (!conflicts?.length) return null;
  return (
    <Card testid="conflicts" title="Conflitos de alocação" hint="Fichas alocadas a um torneio que já não existem no fichário (perda depois de alocar).">
      <ul className="space-y-2 text-sm">
        {conflicts.map((c) => (
          <li key={c.allocation_id} className="rounded-xl bg-red-50 p-3 dark:bg-red-500/10">
            <span className="font-bold">{c.binder?.name}</span> → {c.tournament?.name}: {c.chips.map((x) => `faltam ${n(x.shortfall)} de ${n(x.chip?.value)}`).join(', ')}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export const TYPE_LABEL = {
  ASSEMBLY: 'Montagem', WITHDRAWAL: 'Saída', ADJUSTMENT: 'Ajuste', LOSS: 'Perda', FOUND: 'Sobra', RECOVERY: 'Recuperação', REVERSAL: 'Estorno', DISCARD: 'Descarte',
  RETURN: 'Retorno', SEND_BUY_IN: 'Envio', SEND_OPTIONAL: 'Envio', SEND_REENTRY: 'Envio', SEND_ADDITIONAL: 'Envio',
  CHIP_RACE_OUT: 'Chip race', CHIP_RACE_IN: 'Chip race', COLOR_UP_OUT: 'Color up', COLOR_UP_IN: 'Color up',
};
export function Timeline({ items }) {
  return (
    <Card testid="timeline" title="Linha do tempo" hint="Últimas movimentações de fichas.">
      {!items?.length ? <Empty>Nenhuma movimentação.</Empty> : (
        <ul className="divide-y divide-gray-100 dark:divide-zinc-800/60">
          {items.map((m) => (
            <li key={m._id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
              <span className="font-bold text-gray-700 dark:text-gray-300">{TYPE_LABEL[m.type] || m.type} · {n(m.chip_id?.value)} × {n(m.quantity)}{m.tournament_id?.name ? ` · ${m.tournament_id.name}` : ''}{m.binder_id?.name ? ` · ${m.binder_id.name}` : ''}</span>
              <span className="text-gray-400">{new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · {m.user_name}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
