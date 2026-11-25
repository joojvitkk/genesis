import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { socket } from '../lib/socket';
import { formatClock } from '../hooks/useTournamentClock';
import { fmtTime, sessionBadge } from '../lib/trackingFormat';

const CHOSEN_KEY = 'genesis:salao:chosen';

/**
 * "Salão agora": todas as sessões abertas ou em andamento dos torneios do escopo do usuário, ordenadas pelo horário de início.
 * Cada cartão traz torneio (nº e nome completo), sessão, tipo (TURBO/HYPER), relógio, nível, inscritos e jogando, mais uma
 * etiqueta de cor por sessão — dois Warm Ups ou o 1A e o 1B rodando juntos nunca se confundem. Tocar abre a tela de um toque
 * JÁ NA SESSÃO escolhida (o lançamento nunca depende de adivinhação do servidor).
 */
export default function SalaoAgora() {
  const [rows, setRows] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const load = useCallback(() => apiGet('/salao/now').then(setRows).catch(() => {}), []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const again = () => load();
    const events = ['tournamentLevelChanged', 'playersChanged', 'tournamentsChanged', 'tournamentClock'];
    let last = 0;
    const throttled = () => { if (Date.now() - last > 3000) { last = Date.now(); again(); } };
    events.forEach((e) => socket.on(e, throttled));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(load, 15000);
    return () => { events.forEach((e) => socket.off(e, throttled)); clearInterval(tick); clearInterval(poll); };
  }, [load]);

  if (!rows) return null;
  const open = rows.filter((r) => !r.ended);
  const ended = rows.filter((r) => r.ended);
  if (!rows.length) return <p className="text-sm italic text-fg-subtle" data-testid="agora-empty">Nenhuma sessão aberta ou em andamento agora.</p>;

  return (
    <section aria-label="Salão agora" data-testid="salao-agora" className="space-y-3">
      <h2 className="text-xl font-bold text-fg">Salão agora</h2>
      {open.length === 0 && <p className="text-sm italic text-fg-subtle" data-testid="agora-empty">Nenhuma sessão aberta ou em andamento agora.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {open.map((r) => {
          const left = r.clock_status === 'running' ? Math.max(0, r.remaining_ms - (now - r.server_time)) : r.remaining_ms;
          return (
            <Link key={r.session_id} to={`/salao-sessao/${r.tournament_id}/${r.session_id}`}
              onClick={() => { try { sessionStorage.setItem(CHOSEN_KEY, r.session_id); } catch { /* ignora */ } }}
              className="card block space-y-2 p-4 hover:bg-sunken" data-testid="agora-card">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${sessionBadge(r.session_id)}`}>{r.session_name}</span>
                {r.variant && <span className="badge badge-warn">{r.variant}</span>}
                {r.clock_status === 'running' && <span className="badge badge-ok">Rodando</span>}
                {r.clock_status === 'paused' && <span className="badge badge-warn">Pausado</span>}
              </div>
              <p className="text-lg font-bold leading-tight">{r.tournament_number ? `#${String(r.tournament_number).padStart(2, '0')} ` : ''}{r.tournament_name}</p>
              <p className="text-xs text-fg-subtle">Início {fmtTime(r.starts_at, r.timezone)}</p>
              <div className="grid grid-cols-4 gap-2 text-center text-sm">
                <div><p className="text-xs text-fg-subtle">Relógio</p><p className="font-bold tabular-nums">{formatClock(left)}</p></div>
                <div><p className="text-xs text-fg-subtle">Nível</p><p className="font-bold">{r.is_break ? 'Break' : r.level_number ?? '—'}</p></div>
                <div><p className="text-xs text-fg-subtle">Inscritos</p><p className="font-bold tabular-nums">{r.entries_total}</p></div>
                <div><p className="text-xs text-fg-subtle">Jogando</p><p className="font-bold tabular-nums">{r.playing}</p></div>
              </div>
            </Link>
          );
        })}
      </div>
      {ended.length > 0 && (
        <div className="space-y-2" data-testid="agora-encerradas">
          <h3 className="text-sm font-bold uppercase tracking-wide text-fg-subtle">Encerradas hoje</h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {ended.map((r) => (
              <div key={r.session_id} className="card space-y-2 p-4" data-testid="agora-encerrada">
                <div className="flex flex-wrap items-center gap-2"><span className={`badge ${sessionBadge(r.session_id)}`}>{r.session_name}</span><span className="badge">Encerrada</span></div>
                <p className="text-lg font-bold leading-tight">{r.tournament_number ? `#${String(r.tournament_number).padStart(2, '0')} ` : ''}{r.tournament_name}</p>
                <p className="text-sm">Inscritos <b className="tabular-nums">{r.entries_total}</b> · Classificados <b className="tabular-nums">{r.qualified_count ?? r.playing}</b></p>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/tracking-sessao/${r.tournament_id}/${r.session_id}`} className="btn btn-secondary btn-sm">Tracking</Link>
                  <Link to={`/torneios/${r.tournament_id}/salao?sessao=${r.session_id}`} className="btn btn-ghost btn-sm">Torneio</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
