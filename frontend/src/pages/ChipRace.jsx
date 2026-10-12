import { locale } from '../lib/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Coins, Info, Undo2, Layers, AlertCircle } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { can } from '../config';
import CustomSelect from '../components/CustomSelect';
import ConversionRequests from '../components/ConversionRequests';

const TYPES = [{ v: 'CHIP_RACE', label: 'Chip Race' }, { v: 'COLOR_UP', label: 'Color Up' }];
const fmt = (n) => (n ?? 0).toLocaleString(locale());
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
const CLOSED = ['finished', 'finalized'];

/**
 * Chip Race / Color Up (spec §8): o operador lança o que SAIU e o que ENTROU de jogo, por denominação.
 * Tudo é POR SESSÃO (Simulação 2.1 §9). O SERVIDOR calcula os valores e a QUEBRA MATEMÁTICA (diferença legítima da conversão — não é perda física)
 * e movimenta as fichas (em jogo ↔ fichário) num lote imutável. Erros se corrigem por estorno (admin).
 */
export default function ChipRace() {
  const { showAlert, showConfirm, showPrompt } = useAlert();
  const role = getStoredUser()?.role;
  const canOperate = can(role, 'chip_race', 'operate'); // o salão só consulta (o backend também barra)
  const isAdmin = can(role, 'chip_race', 'manage');

  const [tournaments, setTournaments] = useState([]);
  const [chips, setChips] = useState([]);
  const [tid, setTid] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [material, setMaterial] = useState(null);
  const [history, setHistory] = useState([]);
  const [type, setType] = useState('CHIP_RACE');
  const [binderId, setBinderId] = useState('');
  const [outs, setOuts] = useState({});
  const [ins, setIns] = useState({});
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);     // { value_out, value_in, math_breakage } — vem do servidor
  const [previewError, setPreviewError] = useState(null);
  const [linked, setLinked] = useState(null);     // chamado do Salão que esta conversão vai atender
  const [chipId, setChipId] = useState('');        // denominação a retirar de jogo
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([apiGet('/tournaments'), apiGet('/chips', { active: true })])
      .then(([t, c]) => {
        const open = t.filter((x) => !CLOSED.includes(x.status));
        setTournaments(open);
        setChips(c);
        setTid((cur) => cur || (open.find((x) => x.status === 'running') || open[0])?._id || '');
      })
      .catch((e) => { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar dados', 'error'); })
      .finally(() => setLoading(false));
  }, [showAlert]);

  const loadSessions = useCallback(async (id) => {
    if (!id) return;
    try {
      const sess = await apiGet(`/tournaments/${id}/sessions`);
      setSessions(sess);
      setSessionId((cur) => (sess.find((x) => x._id === cur) ? cur : (sess.length === 1 ? sess[0]._id : '')));
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar as sessões', 'error'); }
  }, [showAlert]);
  useEffect(() => { loadSessions(tid); }, [tid, loadSessions]);

  // tudo abaixo é da SESSÃO escolhida: em jogo, saldo do fichário e histórico nunca misturam sessões
  const loadTournament = useCallback(async (id, sid) => {
    if (!id) return;
    try {
      const [m, h] = await Promise.all([
        apiGet(`/tournaments/${id}/material`, sid ? { session_id: sid } : undefined),
        apiGet('/conversions', { tournament_id: id }),
      ]);
      setMaterial(m); setHistory(h);
      setBinderId((cur) => (m.binders.find((x) => x.binder._id === cur) ? cur : (m.binders.length === 1 ? m.binders[0].binder._id : '')));
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar o torneio', 'error'); }
  }, [showAlert]);
  useEffect(() => { loadTournament(tid, sessionId); }, [tid, sessionId, loadTournament]);

  // quantidade EM JOGO por ficha (já nos stacks dos jogadores da sessão) e saldo FÍSICO do fichário de onde saem as fichas a colocar
  // com várias sessões, nada é calculado até a sessão ser escolhida (o cálculo nunca mistura sessões)
  const needsSession = sessions.length > 1 && !sessionId;
  const inPlayBy = useMemo(() => needsSession ? {} : Object.fromEntries((material?.rows || []).map((r) => [r.chip._id, r.in_play])), [material, needsSession]);
  const onHallBy = useMemo(() => needsSession ? {} : Object.fromEntries((material?.rows || []).map((r) => [r.chip._id, r.on_table])), [material, needsSession]);
  const binders = useMemo(() => material?.binders || [], [material]);
  const chosen = binders.find((b) => b.binder._id === binderId);
  const binderBal = useMemo(() => {
    if (chosen) return chosen.balances;
    const sum = {};
    binders.forEach((b) => Object.entries(b.balances).forEach(([k, v]) => { sum[k] = (sum[k] || 0) + v; }));
    return sum;
  }, [binders, chosen]);
  const session = sessions.find((x) => x._id === sessionId);
  const selectedChip = chips.find((c) => c._id === chipId);

  const lines = (map) => Object.entries(map).filter(([, v]) => Number(v) > 0).map(([chip_id, v]) => ({ chip_id, quantity: Number(v) }));

  // valores e quebra: SEMPRE do servidor (mesma conta do registro), com debounce
  useEffect(() => {
    const o = lines(outs); const i = lines(ins);
    if (!o.length || !i.length) { setPreview(null); setPreviewError(null); return undefined; }
    const timer = setTimeout(() => {
      apiPost('/conversions/preview', { outs: o, ins: i })
        .then((r) => { setPreview(r); setPreviewError(null); })
        .catch((e) => { if (e.status !== 401) { setPreview(null); setPreviewError(e.message); } });
    }, 300);
    return () => clearTimeout(timer);
  }, [outs, ins]);

  const reset = () => { setOuts({}); setIns({}); setNote(''); setPreview(null); setLinked(null); setChipId(''); };

  // um chamado que deixou de estar em aberto (cancelado/concluído) nunca pode continuar selecionado
  const syncLinked = useCallback((rows) => {
    setLinked((cur) => (cur && !rows.some((r) => r._id === cur._id && ['requested', 'in_preparation', 'ready'].includes(r.status)) ? null : cur));
  }, []);
  const onLink = (r) => {
    setLinked(r);
    if (r) { setType(r.type); setChipId(r.chip_id?._id || r.chip_id || ''); const sid = r.session_id?._id || r.session_id; if (sid) setSessionId(sid); }
  };

  const submit = async () => {
    const o = lines(outs); const i = lines(ins);
    if (!tid) return showAlert('Selecione o torneio.', 'error');
    if (!o.length || !i.length) return showAlert('Lance o que saiu (Retirado) e o que entrou (Colocado).', 'error');
    if (sessions.length > 0 && !sessionId) return showAlert('Selecione a sessão.', 'error');
    if (binders.length > 1 && !binderId) return showAlert('Escolha o fichário que recebe as fichas retiradas.', 'error');
    const summary = preview
      ? `Retirado ${fmt(preview.value_out)} · Colocado ${fmt(preview.value_in)} · quebra matemática ${signed(preview.math_breakage)}.`
      : '';
    if (!(await showConfirm(`Registrar ${TYPES.find((t) => t.v === type).label}? ${summary} As fichas serão movimentadas e o lançamento não pode ser editado (só estornado).`))) return;
    setBusy(true);
    try {
      await apiPost('/conversions', { tournament_id: tid, type, session_id: sessionId || undefined, binder_id: binderId || undefined, outs: o, ins: i, note: note.trim() || undefined, request_id: linked?._id });
      showAlert('Conversão registrada!', 'success');
      reset();
      await loadTournament(tid, sessionId);
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao registrar a conversão', 'error');
    } finally { setBusy(false); }
  };

  const reverse = async (c) => {
    const reason = await showPrompt('Estornar esta conversão? Informe o motivo (obrigatório). O lançamento original é mantido no histórico.');
    if (!reason) return;
    try {
      await apiPost(`/conversions/${c._id}/reverse`, { reason });
      showAlert('Conversão estornada.', 'success');
      await loadTournament(tid, sessionId);
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao estornar', 'error'); }
  };

  const tournamentOptions = tournaments.map((t) => ({ value: t._id, label: `${t.name}${t.status === 'running' ? ' · em andamento' : ''}` }));
  const numCls = 'w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-brand ';

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <header>
        <h1 className="page-title flex items-center gap-2"><Coins className="text-brand-fg" size={22} /> Chip Race / Color Up</h1>
        <p className="page-sub">Lance o que saiu e o que entrou de jogo, por denominação. Valores e quebra são calculados pelo sistema.</p>
      </header>

      {loading ? (
        <div className="py-20 text-center text-fg-subtle animate-pulse">Carregando…</div>
      ) : tournaments.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-line p-12 text-center text-fg-subtle">Nenhum torneio aberto.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="label">Torneio</label>
              <CustomSelect options={tournamentOptions} value={tid} onChange={(v) => { setTid(v); setSessionId(''); reset(); }} placeholder="Torneio…" />
            </div>
            {sessions.length > 0 && (
              <div>
                <label className="label">Sessão</label>
                <CustomSelect options={sessions.map((x) => ({ value: x._id, label: x.name }))} value={sessionId} onChange={(v) => { setSessionId(v); setOuts({}); setIns({}); setPreview(null); setLinked(null); }} placeholder="Sessão…" />
              </div>
            )}
            {binders.length > 1 && (
              <div>
                <label className="label">Fichas retiradas vão para</label>
                <CustomSelect options={binders.map((b) => ({ value: b.binder._id, label: b.binder.name }))} value={binderId} onChange={setBinderId} placeholder="Fichário…" />
              </div>
            )}
          </div>

          {needsSession && <p className="text-sm text-fg-muted">Selecione a sessão: o Chip Race / Color Up é calculado por sessão.</p>}

          <ConversionRequests
            tournamentId={tid} sessionId={sessionId} sessions={sessions} chips={chips} role={role}
            linkedId={linked?._id} onLink={onLink} onLoaded={syncLinked}
          />

          {binders.length === 0 && (
            <div className="flex gap-3 rounded-xl border border-warn bg-warn-soft p-4 text-sm text-fg">
              <AlertCircle className="mt-0.5 shrink-0" size={18} /> Este torneio não tem fichário: o administrador precisa vincular um fichário ao torneio antes de haver conversão.
            </div>
          )}

          <div className="card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                {TYPES.map((t) => (
                  <button key={t.v} onClick={() => setType(t.v)} className={`rounded-xl border px-4 py-2 text-xs font-bold transition-all ${type === t.v ? 'border-brand bg-red-50 text-brand-fg dark:bg-red-500/10' : 'border-line text-fg-muted'}`}>{t.label}</button>
                ))}
              </div>
              {!canOperate && <span className="text-xs font-bold text-fg-subtle">Somente consulta — o Salão solicita pelo chamado acima e o Material registra a conversão.</span>}
              {linked && <span className="text-xs font-bold text-brand-fg">Atendendo chamado: {TYPES.find((t) => t.v === linked.type).label} · ficha {fmt(linked.chip_id?.value)} · {linked.tables} mesa(s)</span>}
            </div>

            {session && (
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="session-base">
                <div className="rounded-xl bg-sunken p-3"><p className="text-xs font-semibold uppercase text-fg-subtle">Sessão</p><p className="font-semibold text-fg">{session.name}</p></div>
                <div className="rounded-xl bg-sunken p-3"><p className="text-xs font-semibold uppercase text-fg-subtle">Jogando (ativos)</p><p className="font-semibold tabular-nums text-fg">{fmt(session.players?.active)}</p></div>
                <div className="rounded-xl bg-sunken p-3"><p className="text-xs font-semibold uppercase text-fg-subtle">Mesas abertas</p><p className="font-semibold tabular-nums text-fg">{linked ? fmt(linked.tables) : '—'}</p></div>
                <div className="rounded-xl bg-sunken p-3">
                  <p className="text-xs font-semibold uppercase text-fg-subtle">Ficha a retirar{selectedChip ? ` (${fmt(selectedChip.value)})` : ''}</p>
                  <p className="font-semibold tabular-nums text-fg">{selectedChip ? `${fmt(inPlayBy[chipId] || 0)} em jogo${linked ? ` · ~${fmt(Math.ceil((inPlayBy[chipId] || 0) / linked.tables))} por mesa` : ''}` : '—'}</p>
                </div>
              </div>
            )}

            <p className="mb-3 text-xs text-fg-muted">A mesma denominação pode estar em Retirado e em Colocado (ex.: retirar 500 e devolver parte aos jogadores). O valor é calculado sobre tudo que foi lançado; no fichário só movimenta a diferença líquida.</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-fg-subtle">
                    <th className="py-2 pr-3 text-left font-bold">Ficha</th>
                    <th className="px-2 py-2 text-right font-bold" title="Fichas já nos stacks dos jogadores desta sessão (Chip Count)">Quantidade em jogo</th>
                    <th className="px-2 py-2 text-center font-bold text-red-500">Retirado</th>
                    <th className="px-2 py-2 text-right font-bold" title="Saldo físico atual do fichário — de onde saem as fichas a colocar">Saldo físico do fichário</th>
                    <th className="px-2 py-2 text-center font-bold text-emerald-600">Colocado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {chips.map((c) => {
                    const playing = Math.max(inPlayBy[c._id] || 0, onHallBy[c._id] || 0);
                    const res = binderBal[c._id] || 0;
                    const o = Number(outs[c._id]) || 0; const n = Number(ins[c._id]) || 0;
                    return (
                      <tr key={c._id} className={c._id === chipId ? 'bg-sunken' : ''}>
                        <td className="py-2 pr-3">
                          <span className="inline-flex items-center gap-2 font-bold text-fg">
                            <span className="h-3 w-3 rounded-full border border-line" style={{ backgroundColor: c.color }} /> {fmt(c.value)}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums text-fg-muted">{fmt(inPlayBy[c._id] || 0)}</td>
                        <td className="px-2 py-2 text-center">
                          <input type="number" min="0" step="1" placeholder="0" disabled={!canOperate || playing <= 0} value={outs[c._id] ?? ''} onChange={(e) => setOuts((s) => ({ ...s, [c._id]: e.target.value }))} className={`${numCls} ${o > playing ? 'border-red-400' : ''}`} />
                        </td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums text-fg-muted">{fmt(res)}</td>
                        <td className="px-2 py-2 text-center">
                          <input type="number" min="0" step="1" placeholder="0" disabled={!canOperate || (res + o) <= 0} value={ins[c._id] ?? ''} onChange={(e) => setIns((s) => ({ ...s, [c._id]: e.target.value }))} className={`${numCls} ${n > res + o ? 'border-red-400' : ''}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
              {[['Valor retirado', preview?.value_out, 'text-fg'], ['Valor colocado', preview?.value_in, 'text-fg'], ['Quebra matemática (diferença de conversão)', preview?.math_breakage, 'text-warn', true]].map(([label, v, cls, sign]) => (
                <div key={label} className="rounded-xl bg-sunken p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-fg-subtle">{label}</p>
                  <p className={`text-2xl font-bold tabular-nums ${cls}`}>{v === undefined || v === null ? '—' : sign ? signed(v) : fmt(v)}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs text-fg-muted">
              <Info size={14} className="mt-0.5 shrink-0" />
              A quebra (colocado − retirado) é uma diferença legítima da conversão e <b className="mx-1">não é perda física</b>: não gera ocorrência. Só a conferência física aponta divergência.
            </p>
            {previewError && <p className="mt-2 text-xs font-bold text-red-500">{previewError}</p>}

            {canOperate && (
              <div className="mt-5 flex flex-col gap-3 md:flex-row">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação (opcional) — ex.: nível 6, mesas 1 a 4" className="input flex-1" />
                <button onClick={submit} disabled={busy || binders.length === 0} className="btn btn-primary disabled:opacity-40">
                  {busy ? 'Registrando…' : `Registrar ${TYPES.find((t) => t.v === type).label}`}
                </button>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-line-soft p-5"><h2 className="flex items-center gap-2 font-bold uppercase tracking-tight text-fg"><Layers size={18} className="text-brand-fg" /> Histórico</h2></div>
            {history.length === 0 ? <p className="p-10 text-center text-sm italic text-fg-subtle">Nenhuma conversão neste torneio.</p> : (
              <ul className="divide-y divide-line-soft">
                {history.map((c) => (
                  <motion.li key={c._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`flex flex-wrap items-center gap-4 p-4 ${c.status === 'reversed' ? 'opacity-55' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-fg">
                        {c.type === 'CHIP_RACE' ? 'Chip Race' : 'Color Up'}
                        {c.legacy && <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-bold text-fg-muted dark:bg-zinc-800">modelo anterior</span>}
                        {c.status === 'reversed' && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-600 dark:bg-purple-500/10">estornada</span>}
                      </p>
                      <p className="text-xs text-fg-muted">
                        Saiu: {c.outs.map((l) => `${fmt(l.chip_id?.value)}×${fmt(l.quantity)}`).join(', ')} → Entrou: {c.ins.map((l) => `${fmt(l.chip_id?.value)}×${fmt(l.quantity)}`).join(', ')}
                      </p>
                      <p className="text-xs text-fg-subtle">{new Date(c.createdAt).toLocaleString(locale())} · {c.user_name}{c.binder_id?.name ? ` · para ${c.binder_id.name}` : ''}{c.note ? ` · ${c.note}` : ''}{c.status === 'reversed' && c.reverse_reason ? ` · estorno: ${c.reverse_reason}` : ''}</p>
                    </div>
                    <div className="text-right text-xs tabular-nums">
                      <p className="text-fg-subtle">retirado {fmt(c.value_out)} · colocado {fmt(c.value_in)}</p>
                      <p className="font-bold text-amber-500">quebra {signed(c.math_breakage)}</p>
                    </div>
                    {isAdmin && c.status === 'active' && !c.legacy && (
                      <button onClick={() => reverse(c)} title="Estornar" className="rounded-lg border border-line p-2 text-fg-subtle hover:text-purple-500"><Undo2 size={16} /></button>
                    )}
                  </motion.li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
