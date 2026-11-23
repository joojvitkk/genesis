import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowUpCircle, RotateCcw, UserMinus, ClipboardCheck, Play, Pause, SkipForward, SkipBack, PackageMinus, Undo2, ListOrdered } from 'lucide-react';
import { apiGet, apiPost, apiPut, newOpId } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { can } from '../config';
import { useAlert } from '../contexts/AlertContext';
import { useTournamentClock, formatClock } from '../hooks/useTournamentClock';
import { useConnection } from '../hooks/useConnection';
import ConnectionStatus from '../components/ConnectionStatus';
import DiscardModal from '../components/DiscardModal';
import { sessionBadge } from '../lib/trackingFormat';

const UNDO_MS = 8000;
const CHOSEN_KEY = 'genesis:salao:chosen';

/**
 * Salão "de um toque": tela operacional POR SESSÃO. Torneio e sessão sempre visíveis e destacados; todo lançamento envia o
 * `session_id`. Botões grandes (≥ 44 px), os principais ao alcance do polegar; cada toque mostra uma confirmação clara;
 * desfazer imediato por alguns segundos e, depois, cancelamento com motivo (nada é apagado). Toque duplo não gera dois lançamentos:
 * enquanto um lançamento está em curso os botões ficam travados e a chave de idempotência é a mesma na repetição.
 */
export default function SalaoSessao() {
  const { tid, sid } = useParams();
  const { showAlert, showPrompt, showConfirm } = useAlert();
  const role = getStoredUser()?.role;
  const canFloor = can(role, 'mesas', 'operate');
  const canMaterial = can(role, 'torneios', 'operate');
  const conn = useConnection();
  const clock = useTournamentClock(tid, { sessionId: sid });
  const [meta, setMeta] = useState(null);
  const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);       // confirmação do último toque
  const [last, setLast] = useState(null);         // { kind, id, label, at } — o que dá para desfazer
  const [tick, setTick] = useState(() => Date.now());
  const [discarding, setDiscarding] = useState(false);
  const [material, setMaterial] = useState({ rows: [], allocations: [] });
  const [counting, setCounting] = useState('');
  const confirmed = useRef(false);
  const lock = useRef(false);                     // trava SÍNCRONA: vários toques no mesmo instante passam um de cada vez
  const inflight = useRef(null);                  // chave da intenção em curso (a mesma em caso de repetição)

  useEffect(() => {
    let alive = true;
    Promise.all([apiGet(`/tournaments/${tid}`), apiGet(`/tournaments/${tid}/sessions`)]).then(([t, list]) => {
      if (alive) setMeta({ tournament: t, session: (Array.isArray(list) ? list : []).find((x) => x._id === sid) || null });
    }).catch(() => {});
    return () => { alive = false; };
  }, [tid, sid]);

  useEffect(() => { // relógio do "desfazer"
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const closed = meta?.session?.status === 'finished';
  const disabled = busy || conn !== 'online' || !canFloor || closed;

  /** Antes de gravar a partir de uma sessão diferente da escolhida no painel "Salão agora", pede confirmação (uma vez). */
  const guard = async () => {
    if (confirmed.current) return true;
    let chosen = null;
    try { chosen = sessionStorage.getItem(CHOSEN_KEY); } catch { /* sem sessionStorage */ }
    if (chosen && chosen !== sid) {
      const ok = await showConfirm(`Você escolheu outra sessão no painel. Lançar nesta sessão (${meta?.session?.name || sid})?`);
      if (!ok) return false;
    }
    confirmed.current = true;
    try { sessionStorage.setItem(CHOSEN_KEY, sid); } catch { /* ignora */ }
    return true;
  };

  /** Executa UM lançamento: trava o toque duplo e reaproveita a chave se a mesma intenção for repetida. */
  const run = async (intent, fn) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    if (!(await guard())) { lock.current = false; setBusy(false); return; }
    const key = inflight.current?.intent === intent ? inflight.current.key : newOpId();
    inflight.current = { intent, key };
    try {
      await fn(key);
      inflight.current = null;
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao lançar', 'error');
      if (e.status && e.status >= 400 && e.status < 500) inflight.current = null; // recusado: nova tentativa é nova intenção
    } finally { lock.current = false; setBusy(false); }
  };

  const sName = meta?.session?.name || '';
  const addEntry = (type, quantity = 1) => run(`${type}:${quantity}`, async (key) => {
    const r = await apiPost(`/tournaments/${tid}/entries`, { type, quantity, session_id: sid }, { idempotencyKey: key });
    const label = quantity > 1 ? `${quantity} ${type === 'buy-in' ? 'entradas' : 'reentradas'} registradas · ${sName}` : `${type === 'buy-in' ? 'Entrada' : 'Reentrada'} #${r.number} registrada · ${sName}`;
    setToast(label);
    setLast(quantity === 1 ? { kind: 'entry', id: r._id, label, at: Date.now() } : { kind: 'batch', id: null, label, at: Date.now() });
  });
  const eliminate = () => run('elim', async (key) => {
    const r = await apiPost(`/tournaments/${tid}/eliminations`, { session_id: sid }, { idempotencyKey: key });
    const label = `Eliminação registrada (posição ${r.position}) · ${sName}`;
    setToast(label);
    setLast({ kind: 'elimination', id: r.elimination_id, label, at: Date.now() });
  });
  const clockCmd = (action) => run(`clock:${action}`, async (key) => {
    await apiPost(`/tournaments/${tid}/clock`, { action, session_id: sid }, { idempotencyKey: key });
    setToast(`Relógio: ${{ start: 'iniciado', pause: 'pausado', resume: 'retomado', next: 'próximo nível', prev: 'nível anterior' }[action]} · ${sName}`);
  });

  const cancelLast = async (immediate) => {
    if (!last || last.kind === 'batch') return;
    let reason = 'Desfeito logo após o lançamento';
    if (!immediate) {
      reason = await showPrompt('Motivo do cancelamento (obrigatório):', { title: 'Cancelar lançamento', confirmLabel: 'Cancelar lançamento' });
      if (!reason?.trim()) return;
    }
    await run(`cancel:${last.id}`, async (key) => {
      const path = last.kind === 'entry' ? `/tournaments/${tid}/entries/${last.id}/cancel` : `/tournaments/${tid}/eliminations/${last.id}/cancel`;
      await apiPost(path, { reason: reason.trim() }, { idempotencyKey: key });
      setToast(`Lançamento cancelado · ${sName}`);
      setLast(null);
    });
  };

  const openDiscard = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([apiGet(`/tournaments/${tid}/material`, { session_id: sid }), apiGet('/allocations', { tournament_id: tid })]);
      setMaterial({ rows: m.rows, allocations: a });
      setDiscarding(true);
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao abrir o descarte', 'error'); }
  }, [tid, sid, showAlert]);

  const undoLeft = last ? Math.min(UNDO_MS, Math.max(0, UNDO_MS - (tick - last.at))) : 0;
  const big = 'btn btn-lg min-h-[56px] flex-1 disabled:opacity-40';

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-40 md:pb-8" data-testid="salao-sessao">
      <header className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-xs font-bold uppercase text-fg-subtle">{meta?.tournament?.number ? `#${String(meta.tournament.number).padStart(2, '0')} · ` : ''}Torneio</p>
          <h1 className="text-xl font-bold md:text-2xl">{meta?.tournament?.name || '…'}</h1>
          <span className={`badge ${sessionBadge(sid)} mt-1 !text-sm`} data-testid="session-badge">{sName || 'Sessão'}{meta?.session?.type && meta.session.type !== 'QUALIFIER' ? ` · ${meta.session.type}` : ''}</span>
        </div>
        <div className="flex flex-col items-end gap-2">
          <ConnectionStatus />
          <Link to={`/tracking-sessao/${tid}/${sid}`} className="inline-flex items-center gap-1 text-xs font-bold text-brand-fg"><ListOrdered size={13} /> Tracking da sessão</Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Contadores">
        <div className="card p-4"><p className="text-xs font-bold uppercase text-fg-subtle">Inscritos</p><p className="text-3xl font-bold tabular-nums" data-testid="c-entries">{(clock.entries_total ?? 0).toLocaleString('pt-BR')}</p></div>
        <div className="card p-4"><p className="text-xs font-bold uppercase text-fg-subtle">Jogando</p><p className="text-3xl font-bold tabular-nums" data-testid="c-playing">{(clock.actual_players ?? 0).toLocaleString('pt-BR')}</p></div>
        <div className="card p-4"><p className="text-xs font-bold uppercase text-fg-subtle">Nível</p><p className="text-3xl font-bold tabular-nums">{clock.is_break ? 'Break' : clock.level_number ?? '—'}</p></div>
        <div className="card p-4"><p className="text-xs font-bold uppercase text-fg-subtle">Relógio</p><p className="text-3xl font-bold tabular-nums">{formatClock(clock.remainingMs || 0)}</p></div>
      </section>

      {toast && <p role="status" aria-live="polite" className="rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700 dark:bg-emerald-500/10" data-testid="toast">{toast}</p>}
      {last && last.kind !== 'batch' && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="undo-bar">
          {undoLeft > 0
            ? <button type="button" onClick={() => cancelLast(true)} disabled={disabled} className="btn btn-secondary min-h-[44px]"><Undo2 size={14} /> Desfazer ({Math.ceil(undoLeft / 1000)} s)</button>
            : <button type="button" onClick={() => cancelLast(false)} disabled={disabled} className="btn btn-secondary min-h-[44px]"><Undo2 size={14} /> Cancelar com motivo</button>}
          <span className="text-fg-muted">{last.label}</span>
        </div>
      )}
      {closed && <p className="rounded-xl bg-raised p-3 text-sm font-bold text-fg-muted">Sessão encerrada: lançamentos bloqueados.</p>}
      {!canFloor && <p className="rounded-xl bg-raised p-3 text-sm text-fg-muted">Seu perfil só consulta o Salão.</p>}

      <section className="card space-y-3 p-4" aria-label="Conferir jogando">
        <h2 className="text-sm font-bold uppercase tracking-wide text-fg-subtle">Conferir jogando</h2>
        <div className="flex gap-2">
          <input type="number" inputMode="numeric" min="0" step="1" value={counting} onChange={(e) => setCounting(e.target.value)} placeholder="Contagem real" aria-label="Contagem real de jogadores" className="input min-h-[44px] flex-1" />
          <button type="button" disabled={disabled || counting === ''} onClick={() => run(`count:${counting}`, async (key) => {
            const r = await apiPut(`/tournaments/${tid}/active-players`, { active_players: Number(counting), session_id: sid }, { idempotencyKey: key });
            setToast(`Jogando conferido: ${r.active} · ${sName}`);
            setCounting('');
          })} className="btn btn-primary min-h-[44px]"><ClipboardCheck size={16} /> Conferir</button>
        </div>
      </section>

      <section className="card space-y-3 p-4" aria-label="Relógio">
        <h2 className="text-sm font-bold uppercase tracking-wide text-fg-subtle">Relógio</h2>
        <div className="flex flex-wrap gap-2">
          {(clock.clock_status || 'stopped') === 'stopped' && <button type="button" disabled={disabled} onClick={() => clockCmd('start')} className="btn btn-success min-h-[44px]"><Play size={14} /> Iniciar</button>}
          {clock.clock_status === 'running' && <button type="button" disabled={disabled} onClick={() => clockCmd('pause')} className="btn btn-warn min-h-[44px]"><Pause size={14} /> Pausar</button>}
          {clock.clock_status === 'paused' && <button type="button" disabled={disabled} onClick={() => clockCmd('resume')} className="btn btn-success min-h-[44px]"><Play size={14} /> Retomar</button>}
          <button type="button" disabled={disabled} onClick={() => clockCmd('prev')} className="btn btn-secondary min-h-[44px]"><SkipBack size={14} /> Anterior</button>
          <button type="button" disabled={disabled} onClick={() => clockCmd('next')} className="btn btn-secondary min-h-[44px]"><SkipForward size={14} /> Próximo nível</button>
          {canMaterial && !closed && <button type="button" onClick={openDiscard} className="btn btn-secondary min-h-[44px]"><PackageMinus size={14} /> Descartar stack</button>}
        </div>
      </section>

      {/* ações principais: fixas na parte de baixo (alcance do polegar no celular) */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] md:static md:z-auto md:border-0 md:bg-transparent md:p-0" data-testid="primary-actions">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex items-center gap-2">
            <input type="number" inputMode="numeric" min="1" max="500" step="1" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Lote (opcional)" aria-label="Quantidade em lote" className="input min-h-[44px] w-36" />
            <span className="text-xs text-fg-muted">vazio = 1 por toque</span>
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={disabled} onClick={() => addEntry('buy-in', Number(batch) || 1)} className={`${big} btn-success`}><ArrowUpCircle size={18} /> +{Number(batch) || 1} entrada</button>
            <button type="button" disabled={disabled} onClick={() => addEntry('re-entry', Number(batch) || 1)} className={`${big} btn-info`}><RotateCcw size={18} /> +{Number(batch) || 1} reentrada</button>
            <button type="button" disabled={disabled} onClick={eliminate} className={`${big} btn-danger-solid`}><UserMinus size={18} /> −1 eliminação</button>
          </div>
        </div>
      </div>

      {discarding && (
        <DiscardModal tournamentId={tid} sessionId={sid} rows={material.rows} allocations={material.allocations}
          onClose={() => setDiscarding(false)}
          onDone={() => { setDiscarding(false); setToast(`Descarte de stack registrado · ${sName}`); }} />
      )}
    </div>
  );
}
