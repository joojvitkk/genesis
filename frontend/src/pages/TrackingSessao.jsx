import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Printer, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react';
import { apiGet } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { socket, trackRoom, connectSocket } from '../lib/socket';
import ConnectionStatus from '../components/ConnectionStatus';
import { fmtTime, fmtDateTime, fmtDuration, sessionBadge, cacheKey } from '../lib/trackingFormat';

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));

/**
 * Tracking da sessão: a folha digital (somente leitura). Substitui a folha de papel: cabeçalho com as sessões do torneio (sem
 * valores em dinheiro nem stack inicial), grade de níveis (horário REAL nos jogados, PREVISTO nos próximos), rodapé e resumos.
 * Sem internet mostra o último estado sincronizado, com a data e a hora da atualização, só do usuário logado.
 */
export default function TrackingSessao() {
  const { tid, sid } = useParams();
  const userId = getStoredUser()?.id || getStoredUser()?._id;
  const [sheet, setSheet] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);
  const [stale, setStale] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet(`/tournaments/${tid}/sessions/${sid}/tracking`);
      setSheet(data); setSyncedAt(new Date()); setStale(false);
      try { localStorage.setItem(cacheKey(userId, sid), JSON.stringify({ at: Date.now(), data })); } catch { /* sem armazenamento: segue */ }
    } catch (e) {
      if (e.status === 401) return;
      try {
        const cached = JSON.parse(localStorage.getItem(cacheKey(userId, sid)) || 'null');
        if (cached) { setSheet(cached.data); setSyncedAt(new Date(cached.at)); setStale(true); }
      } catch { /* cache ilegível */ }
    }
  }, [tid, sid, userId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    connectSocket();
    const untrack = trackRoom('joinTournament', 'leaveTournament', tid);
    const again = () => { clearTimeout(timer.current); timer.current = setTimeout(load, 300); };
    const events = ['tournamentLevelChanged', 'sessionLevelLog', 'playersChanged', 'tournamentsChanged'];
    events.forEach((e) => socket.on(e, again));
    socket.on('connect', again);
    const tick = setInterval(load, 30000); // a previsão se refaz sobre o "agora" (pausas, ajustes)
    return () => { untrack(); events.forEach((e) => socket.off(e, again)); socket.off('connect', again); clearInterval(tick); clearTimeout(timer.current); };
  }, [tid, load]);

  if (!sheet) return <p className="p-8 text-sm text-fg-subtle">Carregando a folha…</p>;
  const tz = sheet.tournament.timezone;
  const cur = sheet.rows.find((r) => r.kind === 'current');
  const day = sheet.day;

  const rowCls = (r) => (r.kind === 'current' ? 'bg-brand-soft font-bold' : r.kind === 'actual' ? '' : 'text-fg-muted');
  const diffOf = (r) => (r.floor_counts?.length ? r.floor_counts[r.floor_counts.length - 1] : null);
  const label = (r) => (r.row_type === 'level' ? r.level_number : r.row_type === 'break' ? 'Break' : r.row_type === 'end_registration' ? 'Fim do registro' : 'Fim do dia');

  const Header = (
    <section className="card p-4" aria-label="Sessões do torneio">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-fg-subtle">Sessões do torneio</h3>
      <div className="overflow-x-auto">
        <table className="table-dense w-full text-sm">
          <thead><tr><th className="text-left">Sessão</th><th className="text-left">Data e início</th><th className="text-right">Blinds</th><th className="text-right">Registro até</th></tr></thead>
          <tbody>
            {sheet.sessions.map((s) => (
              <tr key={s._id} className={s._id === sheet.session._id ? 'font-bold' : ''}>
                <td>{s.name}</td><td>{fmtDateTime(s.starts_at, tz)}</td>
                <td className="text-right">{s.level_minutes ? `${s.level_minutes} min` : '—'}</td>
                <td className="text-right">{s.registration_until_level ? `nível ${s.registration_until_level}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.tournament.rules && <p className="mt-3 whitespace-pre-line text-xs text-fg-muted"><b>Regras gerais:</b> {sheet.tournament.rules}</p>}
    </section>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-8" data-testid="tracking-sessao">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/salao" className="inline-flex items-center gap-1 text-xs font-bold text-brand-fg"><ArrowLeft size={12} /> Salão</Link>
          <h1 className="page-title">{sheet.tournament.number ? `#${String(sheet.tournament.number).padStart(2, '0')} ` : ''}{sheet.tournament.name}</h1>
          <p className="page-sub"><span className={`badge ${sessionBadge(sheet.session._id)}`}>{sheet.session.name}</span> · Tracking da sessão</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionStatus />
          <button type="button" onClick={() => window.print()} className="btn btn-secondary"><Printer size={14} /> PDF / imprimir</button>
        </div>
      </div>

      {stale && <p role="status" className="no-print rounded-lg bg-amber-50 p-3 text-xs font-bold text-amber-700 dark:bg-amber-500/10" data-testid="stale">Sem conexão: mostrando o último estado sincronizado em {fmtDateTime(syncedAt)}.</p>}
      {!stale && syncedAt && <p className="no-print text-xs text-fg-subtle">Atualizado em {fmtDateTime(syncedAt)}</p>}

      <div className="print-only hidden"><h2 className="text-xl font-bold">{sheet.tournament.name} · {sheet.session.name}</h2></div>

      {/* celular: cabeçalho recolhível, nível atual fixo no topo */}
      <div className="md:hidden no-print">
        <button type="button" onClick={() => setHeaderOpen((o) => !o)} className="btn btn-secondary w-full">{headerOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Sessões e regras</button>
        {headerOpen && <div className="mt-2">{Header}</div>}
        {cur && (
          <div className="sticky top-14 z-10 mt-3 rounded-2xl bg-brand-soft p-3" data-testid="current-pinned">
            <p className="text-xs font-bold uppercase text-fg-subtle">Nível atual</p>
            <p className="text-2xl font-bold">{label(cur)} · {fmt(cur.small_blind)}/{fmt(cur.big_blind)}{cur.ante ? ` · ante ${fmt(cur.ante)}` : ''}</p>
            <p className="text-sm">até {fmtTime(cur.end, tz)} · inscritos {fmt(cur.entries_total)} · jogando {fmt(cur.playing)}</p>
          </div>
        )}
      </div>
      <div className="hidden md:block print:block">{Header}</div>

      {/* tablet/desktop e impressão: a grade completa, no formato da folha */}
      <div className="card hidden overflow-x-auto p-4 md:block print:block">
        <table className="table-dense w-full text-sm" data-testid="grid">
          <thead><tr><th>Duração</th><th>Horário</th><th>Nível</th><th className="text-right">SB</th><th className="text-right">BB</th><th className="text-right">Ante</th><th className="text-right">Inscritos</th><th className="text-right">Jogando</th><th className="text-right">Conferência</th><th className="print-only hidden">Anotações</th></tr></thead>
          <tbody>
            {sheet.rows.map((r) => {
              const fc = diffOf(r);
              return (
                <tr key={r.index} className={rowCls(r)} data-kind={r.kind}>
                  <td>{r.duration_min ? `${r.duration_min} min` : ''}</td>
                  <td title={r.kind === 'forecast' ? 'Horário previsto' : 'Horário real'}>{fmtTime(r.start, tz)}{r.kind === 'forecast' ? '*' : ''}</td>
                  <td>{label(r)}</td>
                  <td className="text-right tabular-nums">{r.row_type === 'level' ? fmt(r.small_blind) : ''}</td>
                  <td className="text-right tabular-nums">{r.row_type === 'level' ? fmt(r.big_blind) : ''}</td>
                  <td className="text-right tabular-nums">{r.row_type === 'level' && r.ante ? fmt(r.ante) : ''}</td>
                  <td className="text-right tabular-nums">{r.kind === 'actual' || r.kind === 'current' ? fmt(r.entries_total) : ''}</td>
                  <td className="text-right tabular-nums">{r.kind === 'actual' || r.kind === 'current' ? fmt(r.playing) : ''}</td>
                  <td className={`text-right tabular-nums ${fc && fc.diff !== 0 ? 'font-bold text-red-600' : ''}`} title={fc ? `${fc.user_name}${fc.reason ? ` · ${fc.reason}` : ''}` : ''}>{fc ? `${fmt(fc.counted)} (${fc.diff > 0 ? '+' : ''}${fc.diff})` : ''}</td>
                  <td className="print-only hidden w-40 border-b border-line" />
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-fg-subtle">* horário previsto, recalculado com o tempo restante e as pausas.</p>
      </div>

      {/* celular: lista compacta */}
      <ul className="no-print divide-y divide-line-soft md:hidden" data-testid="list">
        {sheet.rows.map((r) => (
          <li key={r.index} className={`flex items-center justify-between gap-2 py-2 text-sm ${rowCls(r)}`}>
            <span><b>{label(r)}</b>{r.row_type === 'level' ? ` · ${fmt(r.small_blind)}/${fmt(r.big_blind)}` : ''}</span>
            <span className="tabular-nums">{fmtTime(r.start, tz)}{r.kind === 'forecast' ? '*' : ''}{r.entries_total != null ? ` · ${fmt(r.entries_total)}/${fmt(r.playing)}` : ''}</span>
          </li>
        ))}
      </ul>

      {(sheet.forecast.registration_ends_at || sheet.forecast.day_ends_at) && (
        <p className="text-sm"><b>Previsto:</b>{sheet.forecast.registration_ends_at ? ` fim do registro ${fmtTime(sheet.forecast.registration_ends_at, tz)}` : ''}{sheet.forecast.day_ends_at ? ` · fim do dia ${fmtTime(sheet.forecast.day_ends_at, tz)}` : ''}</p>
      )}

      <section className="card space-y-2 p-4" data-testid="footer">
        <h3 className="text-sm font-bold uppercase tracking-wide text-fg-subtle">Fechamento do dia</h3>
        <dl className="grid gap-2 text-sm sm:grid-cols-2 md:grid-cols-3">
          <div><dt className="text-xs text-fg-subtle">Inscritos</dt><dd className="font-bold">{fmt(day.entries_total)} ({fmt(day.entries_initial)} entradas + {fmt(day.entries_reentries)} reentradas)</dd></div>
          <div><dt className="text-xs text-fg-subtle">Classificados</dt><dd className="font-bold">{fmt(day.qualified_count)}{day.qualified_log.length ? ` · ${day.qualified_log.length} correção(ões)` : ''}</dd></div>
          <div><dt className="text-xs text-fg-subtle">Início / encerramento</dt><dd className="font-bold">{fmtTime(day.started_at, tz)} / {fmtTime(day.ended_at, tz)}</dd></div>
          <div><dt className="text-xs text-fg-subtle">Duração (com / sem pausas)</dt><dd className="font-bold">{fmtDuration(day.duration_ms)} / {fmtDuration(day.duration_net_ms)}</dd></div>
          <div><dt className="text-xs text-fg-subtle">Pico de jogadores · níveis jogados</dt><dd className="font-bold">{fmt(day.peak_players)} · {fmt(day.levels_played)}</dd></div>
          <div><dt className="text-xs text-fg-subtle">Onde parou</dt><dd className="font-bold">{day.stopped || '—'}</dd></div>
        </dl>
        {!sheet.has_history && <p className="text-xs italic text-fg-subtle">Sem histórico: esta sessão não tem registro por nível.</p>}
        <div className="print-only hidden grid-cols-3 gap-4 pt-4 text-xs"><span>Classificados: __________</span><span>Encerramento: __________</span><span>Parou no nível: ______ faltando: ______</span></div>
      </section>

      {sheet.tournament_summary && (
        <section className="card p-4" data-testid="tournament-summary">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-fg-subtle">Resumo do torneio</h3>
          <table className="table-dense w-full text-sm">
            <thead><tr><th className="text-left">Dia</th><th className="text-right">Entradas</th><th className="text-right">Reentradas</th><th className="text-right">Classificados</th><th className="text-right">Duração</th></tr></thead>
            <tbody>
              {sheet.tournament_summary.days.map((d) => (
                <tr key={d.session_id}><td>{d.name}</td><td className="text-right">{fmt(d.entries_initial)}</td><td className="text-right">{fmt(d.entries_reentries)}</td><td className="text-right">{fmt(d.qualified_count)}</td><td className="text-right">{fmtDuration(d.duration_net_ms)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr className="font-bold"><td>Total</td><td className="text-right">{fmt(sheet.tournament_summary.totals.entries_initial)}</td><td className="text-right">{fmt(sheet.tournament_summary.totals.entries_reentries)}</td><td className="text-right">{fmt(sheet.tournament_summary.totals.qualified)}</td><td /></tr></tfoot>
          </table>
        </section>
      )}
    </div>
  );
}
