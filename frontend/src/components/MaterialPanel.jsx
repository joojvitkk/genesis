import { locale } from '../lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { Send, Undo2, Plus, Trash2, AlertCircle, PackageMinus, PackageCheck } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import CustomSelect from './CustomSelect';
import DiscardModal from './DiscardModal';
import KoPanel from './KoPanel';
import { socket } from '../lib/socket';

const fmt = (n) => (n ?? 0).toLocaleString(locale());
const TYPE_LABEL = {
  SEND_BUY_IN: 'Envio · buy-in', SEND_OPTIONAL: 'Envio · opcional', SEND_REENTRY: 'Envio · reentrada', SEND_ADDITIONAL: 'Envio adicional',
  RETURN: 'Retorno', CHIP_RACE_OUT: 'Chip race · saiu', CHIP_RACE_IN: 'Chip race · entrou', COLOR_UP_OUT: 'Color up · saiu', COLOR_UP_IN: 'Color up · entrou',
  DISCARD: 'Descarte de stack', REVERSAL: 'Estorno',
};

/**
 * Material do torneio (G6): o que era esperado × o que foi enviado × o que está em jogo × o que falta.
 * Envio e retorno são movimentos imutáveis; as fichas de um envio por ação vêm do modelo de stack (servidor).
 * Só admin e material registram (o backend também barra).
 */
export default function MaterialPanel({ onNavigate, tournament, sessions, sessionId, canOperate, isAdmin, stackActions, closed, refreshKey, onChanged }) {
  const { showAlert, showConfirm, showPrompt } = useAlert();
  const [summary, setSummary] = useState(null);
  const [allocations, setAllocations] = useState([]);
  const [moves, setMoves] = useState([]);
  const [discards, setDiscards] = useState([]);
  const [discarding, setDiscarding] = useState(false);
  const [rows, setRows] = useState([{ action: '', count: '' }]);   // envio por ação
  const [plan, setPlan] = useState(null);                            // fichas calculadas pelo servidor
  const [extra, setExtra] = useState({});                            // envio adicional: { chipId: qtd }
  const [ret, setRet] = useState({ binder_id: '', chips: {}, reason: '' });
  const [tables, setTables] = useState({ count: '', per: String(tournament.seats_per_table || 9), action: 'buy_in' }); // envio por mesas
  const [active, setActive] = useState(null);                       // formulário aberto: 'send' | 'return'
  const [pending, setPending] = useState({ occurrences: 0, requests: 0 });
  const [sug, setSug] = useState(null);                              // sugestão da volta de fichas (por ação, em stacks)
  const [keep, setKeep] = useState({});                              // stacks que ficam na ilha: { ação: N }
  const [stackRet, setStackRet] = useState({});                      // stacks a devolver, ajustados pelo operador: { ação: N }
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const tid = tournament._id;

  const load = useCallback(async () => {
    try {
      const [s, a, m, d] = await Promise.all([
        apiGet(`/tournaments/${tid}/material`, { session_id: sessionId }),
        apiGet('/allocations', { tournament_id: tid }),
        apiGet('/movements', { tournament_id: tid, limit: 30 }),
        apiGet(`/tournaments/${tid}/discards`, { session_id: sessionId }),
      ]);
      setSummary(s); setAllocations(a); setMoves(m); setDiscards(Array.isArray(d) ? d : []);
      setRet((r) => ({ ...r, binder_id: r.binder_id || (a.length === 1 ? (a[0].binder_id?._id || '') : '') }));
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar o material', 'error'); }
  }, [tid, sessionId, showAlert]);
  useEffect(() => { load(); }, [load, refreshKey]);

  // pendências: ocorrências abertas e chamados de troca (quem não enxerga uma das listas só não a conta)
  useEffect(() => {
    let alive = true;
    Promise.all([
      apiGet('/occurrences', { tournament_id: tid, status: 'active', page: 1, limit: 1 }).then((r) => r?.pagination?.total ?? (Array.isArray(r) ? r.length : 0)).catch(() => 0),
      apiGet('/conversion-requests', { tournament_id: tid, status: 'open' }).then((r) => (Array.isArray(r) ? r.length : 0)).catch(() => 0),
    ]).then(([occurrences, requests]) => { if (alive) setPending({ occurrences, requests }); });
    return () => { alive = false; };
  }, [tid, refreshKey, summary]);

  // tempo real: outro operador enviou/devolveu/descartou → recarrega o material na hora
  useEffect(() => {
    const onEvent = (p) => { if (!p?.tournament_id || String(p.tournament_id) === String(tid)) load(); };
    socket.on('materialChanged', onEvent);
    socket.on('discardRegistered', onEvent);
    return () => { socket.off('materialChanged', onEvent); socket.off('discardRegistered', onEvent); };
  }, [tid, load]);

  // sugestão = enviados − usados − manter na ilha, por ação (servidor); o operador só confirma ou ajusta
  useEffect(() => {
    if (!canOperate) return undefined;
    let alive = true;
    const keepQs = Object.fromEntries(Object.entries(keep).filter(([, v]) => Number(v) > 0).map(([a, v]) => [`keep[${a}]`, v]));
    apiGet(`/tournaments/${tid}/return-suggestion`, { session_id: sessionId, ...keepQs })
      .then((r) => { if (alive) { setSug(r); setStackRet(Object.fromEntries(r.rows.map((x) => [x.action, String(x.suggested)]))); } })
      .catch(() => { if (alive) setSug(null); });
    return () => { alive = false; };
  }, [tid, sessionId, canOperate, refreshKey, keep, summary?.rows?.length]);

  const addTables = () => {
    const n = Number(tables.count); const m = Number(tables.per);
    if (!tables.action || !(n >= 1) || !(m >= 1)) return showAlert('Informe a ação, as mesas e os stacks por mesa.', 'error');
    setRows((x) => [...x.filter((r) => r.action && r.count), { action: tables.action, count: String(n * m) }]);
    setTables((t) => ({ ...t, count: '' }));
  };

  const items = rows.filter((r) => r.action && Number(r.count) > 0).map((r) => ({ action: r.action, count: Number(r.count) }));
  const chips = Object.entries(extra).filter(([, v]) => Number(v) > 0).map(([chip_id, v]) => ({ chip_id, quantity: Number(v) }));

  // fichas de cada ação: calculadas pelo SERVIDOR (o operador só informa a quantidade de ações)
  useEffect(() => {
    if (!items.length) { setPlan(null); return undefined; }
    const counts = {}; items.forEach((i) => { counts[i.action] = (counts[i.action] || 0) + i.count; });
    const timer = setTimeout(() => {
      apiPost(`/tournaments/${tid}/needs`, { counts }).then((p) => { setPlan(p); setError(null); }).catch((e) => { if (e.status !== 401) { setPlan(null); setError(e.message); } });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(items), tid]);

  const fillPending = () => {
    const next = {};
    (summary?.rows || []).filter((r) => r.pending > 0).forEach((r) => { next[r.chip._id] = String(r.pending); });
    setExtra(next);
  };

  const sendNow = async () => {
    if (!items.length && !chips.length) return showAlert('Informe as ações a enviar ou as fichas avulsas.', 'error');
    if (!(await showConfirm('Enviar as fichas ao torneio? Elas saem dos fichários alocados e o lançamento não pode ser editado (só estornado).'))) return;
    setBusy(true); setError(null);
    try {
      await apiPost(`/tournaments/${tid}/sends`, { items: items.length ? items : undefined, chips: chips.length ? chips : undefined, session_id: sessionId || undefined });
      showAlert('Fichas enviadas!', 'success');
      setRows([{ action: '', count: '' }]); setExtra({}); setPlan(null);
      await load(); onChanged?.();
    } catch (e) {
      if (e.status !== 401) setError(e.message || 'Erro ao enviar');
    } finally { setBusy(false); }
  };

  const returnNow = async () => {
    const list = Object.entries(ret.chips).filter(([, v]) => Number(v) > 0).map(([chip_id, v]) => ({ chip_id, quantity: Number(v) }));
    const stacksList = Object.entries(stackRet).filter(([, v]) => Number(v) > 0).map(([action, v]) => ({ action, count: Number(v) }));
    if (!ret.binder_id) return showAlert('Escolha o fichário que recebe as fichas.', 'error');
    if (!list.length && !stacksList.length) return showAlert('Informe os stacks ou as fichas devolvidas.', 'error');
    setBusy(true); setError(null);
    try {
      await apiPost(`/tournaments/${tid}/returns`, { binder_id: ret.binder_id, items: stacksList.length ? stacksList : undefined, chips: list.length ? list : undefined, reason: ret.reason.trim() || undefined, session_id: sessionId || undefined });
      showAlert('Retorno registrado!', 'success');
      setRet((r) => ({ ...r, chips: {}, reason: '' }));
      await load(); onChanged?.();
    } catch (e) {
      if (e.status !== 401) setError(e.message || 'Erro ao registrar o retorno');
    } finally { setBusy(false); }
  };

  const reverseDiscard = async (d) => {
    const reason = await showPrompt('Motivo do estorno do descarte (obrigatório):', { title: 'Estornar descarte', confirmLabel: 'Estornar' });
    if (!reason?.trim()) return;
    try {
      await apiPost(`/tournaments/${tid}/discards/${d.batch_id}/reverse`, { reason: reason.trim() });
      showAlert('Descarte estornado.', 'success');
      await load(); onChanged?.();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao estornar', 'error'); }
  };

  const numCls = 'w-24 rounded-lg border border-line bg-surface px-2 py-1.5 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-brand ';
  const actionOptions = stackActions.map((a) => ({ value: a.key, label: a.label }));
  const t = summary?.totals;
  // Dia 2 / Dia Final (Simulação 3.0 §2): só a posição ATUAL das fichas em jogo — não é uma nova distribuição inicial
  const isFinalPhase = summary?.phase === 'final';
  const needRows = (summary?.rows || []).filter((r) => r.in_play > 0 || r.pending > 0);

  return (
    <div className="space-y-8 p-4 md:p-8">
      {isFinalPhase && (
        <section className="card p-6" data-testid="final-material">
          <h3 className="mb-1 text-lg font-bold">Fichas em jogo · Chip Count consolidado</h3>
          <p className="mb-4 text-xs text-fg-muted">
            Posição atual herdada das sessões anteriores, já com Chip Race, Color Up e descartes. Esta fase não recebe nova distribuição inicial.
          </p>
          {summary.rows.filter((r) => r.in_play > 0).length === 0 ? <p className="py-6 text-center text-sm italic text-fg-subtle">Nenhuma ficha em jogo herdada. Encerre as sessões classificatórias.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-sm">
                <thead><tr className="text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="py-2 pr-3 text-left font-bold">Ficha</th><th className="px-2 py-2 text-right font-bold">Quantidade em jogo</th><th className="px-2 py-2 text-right font-bold">Valor nominal</th>
                </tr></thead>
                <tbody className="divide-y divide-line-soft">
                  {summary.rows.filter((r) => r.in_play > 0).map((r) => (
                    <tr key={r.chip._id}>
                      <td className="py-2 pr-3 font-bold text-fg"><span className="mr-2 inline-block h-3 w-3 rounded-full border border-line align-middle" style={{ backgroundColor: r.chip.color }} />{fmt(r.chip.value)}</td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums text-fg">{fmt(r.in_play)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{fmt(r.in_play * (r.chip.value || 0))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-line text-xs font-bold">
                  <td className="py-2 pr-3 uppercase tracking-wide text-fg-subtle">Chip Count</td>
                  <td className="px-2 py-2 text-right tabular-nums" data-testid="final-chip-count-qty">{fmt(summary.chip_count?.quantity)}</td>
                  <td className="px-2 py-2 text-right tabular-nums" data-testid="final-chip-count">{fmt(summary.chip_count?.value)}</td>
                </tr></tfoot>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Visão principal: curta e acionável. O detalhe técnico fica recolhido em "Ver detalhes". */}
      {!isFinalPhase && summary && (
        <section className="card p-6" data-testid="material-overview">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div title="Fichas fisicamente no salão: enviado − devolvido ± trocas."><p className="text-xs font-bold uppercase text-fg-subtle">No salão</p><p className="text-3xl font-bold tabular-nums">{fmt(summary.rows.reduce((s, r) => s + r.on_table, 0))}</p><p className="text-xs text-fg-muted">fichas</p></div>
            <div title="O que as entradas já entregaram aos jogadores (ações × montagem ± trocas − descartes)."><p className="text-xs font-bold uppercase text-fg-subtle">Em jogo (Chip Count)</p><p className="text-3xl font-bold tabular-nums">{fmt(summary.chip_count?.quantity)}</p><p className="text-xs text-fg-muted">fichas</p></div>
            <div title="No salão e ainda não entregue aos jogadores, em stacks completos por ação (remanejamento)."><p className="text-xs font-bold uppercase text-fg-subtle">Disponível</p>
              {(summary.stacks || []).length === 0 ? <p className="text-sm text-fg-subtle">—</p> : (summary.stacks || []).map((s) => <p key={s.action} className="text-sm"><b className="text-2xl tabular-nums">{fmt(s.stacks)}</b> <span className="text-fg-muted">stacks · {s.label}</span></p>)}
            </div>
            <div title="Ocorrências abertas do torneio e chamados de troca em aberto."><p className="text-xs font-bold uppercase text-fg-subtle">Pendências</p><p className="text-3xl font-bold tabular-nums">{pending.occurrences + pending.requests}</p><p className="text-xs text-fg-muted">{pending.occurrences} ocorrência(s) · {pending.requests} chamado(s)</p></div>
          </div>
          {canOperate && (
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="material-actions">
              {!closed && <button type="button" onClick={() => setActive(active === 'send' ? null : 'send')} className="btn btn-success btn-lg"><Send size={16} /> Enviar</button>}
              <button type="button" onClick={() => setActive(active === 'return' ? null : 'return')} className="btn btn-info btn-lg"><Undo2 size={16} /> Volta de fichas</button>
              <a href="/chip-race" onClick={(e) => { if (onNavigate) { e.preventDefault(); onNavigate('/chip-race'); } }} className="btn btn-secondary btn-lg">Troca</a>
              {!closed && <button type="button" onClick={() => setDiscarding(true)} disabled={allocations.length === 0} className="btn btn-secondary btn-lg"><PackageMinus size={16} /> Descarte</button>}
              <a href="/ocorrencias" onClick={(e) => { if (onNavigate) { e.preventDefault(); onNavigate('/ocorrencias'); } }} className="btn btn-secondary btn-lg"><PackageCheck size={16} /> Conferir</a>
            </div>
          )}
        </section>
      )}

      <details className="card p-6" data-testid="material-details">
        <summary className="cursor-pointer text-sm font-bold">Ver detalhes · enviado × em jogo e fichas necessárias</summary>
        <div className="mt-6 space-y-8">

      {/* esperado × em jogo */}
      {!isFinalPhase && (
      <section className="card p-6">
        <h3 className="mb-1 text-lg font-bold">Material: enviado × em jogo</h3>
        <p className="mb-4 text-xs text-fg-muted">
          <b>Enviado</b> = movimentação física ao Salão (acumulado). <b>No Salão</b> = enviado − devolvido ± conversões. <b>Em jogo</b> = o que as entradas já entregaram aos jogadores (ações × stack ± conversões = Chip Count).
          {' '}<b>Disponível no Salão</b> = no Salão − em jogo (ainda não usado). <b>Falta enviar</b> = em jogo − no Salão, quando positivo. Só informa; divergência formal é a conferência física.
        </p>
        {!summary || summary.rows.length === 0 ? <p className="py-6 text-center text-sm italic text-fg-subtle">Nada enviado nem em jogo ainda.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="text-xs uppercase tracking-wide text-fg-subtle">
                {['Ficha', 'Enviado (acum.)', 'Devolvido', 'Descartado', 'No Salão', 'Em jogo', 'Disponível no Salão', 'Falta enviar'].map((h, i) => <th key={h} className={`py-2 font-bold ${i === 0 ? 'pr-3 text-left' : 'px-2 text-right'}`}>{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-line-soft">
                {summary.rows.map((r) => (
                  <tr key={r.chip._id}>
                    <td className="py-2 pr-3 font-bold text-fg"><span className="mr-2 inline-block h-3 w-3 rounded-full border border-line align-middle" style={{ backgroundColor: r.chip.color }} />{fmt(r.chip.value)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{fmt(r.sent)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{fmt(r.returned)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{fmt(r.discarded)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-fg dark:text-gray-200">{fmt(r.on_table)}</td>
                    <td className="px-2 py-2 text-right font-bold tabular-nums text-fg dark:text-gray-200">{fmt(r.in_play)}</td>
                    <td className="px-2 py-2 text-right font-bold tabular-nums text-emerald-600">{fmt(r.available)}</td>
                    <td className={`px-2 py-2 text-right font-bold tabular-nums ${r.pending > 0 ? 'text-amber-500' : 'text-gray-300'}`}>{fmt(Math.max(0, r.pending))}</td>
                  </tr>
                ))}
              </tbody>
              {t && <tfoot><tr className="border-t-2 border-line text-xs font-bold">
                <td className="py-2 pr-3 uppercase tracking-wide text-fg-subtle">Valor nominal</td>
                <td /><td /><td />
                <td className="px-2 py-2 text-right tabular-nums">{fmt(t.on_table_value)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(t.in_play_value)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-emerald-600">{fmt(t.available_value)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-amber-500">{fmt(Math.max(0, t.pending_value))}</td>
              </tr></tfoot>}
            </table>
          </div>
        )}
        {summary?.stacks?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {summary.stacks.map((st) => (
              <span key={st.action} className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                {fmt(st.stacks)} stacks disponíveis de {st.label} ({st.composition.map((c) => `${fmt(c.quantity)} × ${fmt(c.chip.value)}`).join(' + ')} por stack)
              </span>
            ))}
          </div>
        )}
        {summary?.uncovered?.length > 0 && <p className="mt-3 text-xs text-amber-600">Sem fichas definidas para: {summary.uncovered.map((u) => u.label || u.action).join(', ')}. Escolha um modelo de stack com essa coluna.</p>}
      </section>
      )}

      {/* Fichas necessárias × saldo físico REAL dos fichários (Simulação 3.0 §6): previsão, nunca baixa de estoque */}
      {!isFinalPhase && (
        <section className="card p-6" data-testid="needed-chips">
          <h3 className="mb-1 text-lg font-bold">Fichas necessárias</h3>
          <p className="mb-4 text-xs text-fg-muted">
            Demanda prevista (ações registradas × modelo de stack) comparada ao saldo físico REAL dos fichários vinculados. É só uma previsão: não dá baixa no estoque — apenas os envios e retornos registrados movimentam as fichas.
          </p>
          {needRows.length === 0 ? <p className="py-4 text-center text-sm italic text-fg-subtle">Ainda não há fichas calculadas. Escolha o modelo de stack e registre as entradas na aba Salão.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="text-xs uppercase tracking-wide text-fg-subtle">
                  {['Ficha', 'Previsto em jogo', 'Já no Salão', 'A enviar', 'Saldo físico dos fichários', 'Situação'].map((h, i) => <th key={h} className={`py-2 font-bold ${i === 0 ? 'pr-3 text-left' : 'px-2 text-right'}`}>{h}</th>)}
                </tr></thead>
                <tbody className="divide-y divide-line-soft">
                  {needRows.map((r) => {
                    const toSend = Math.max(0, r.pending);
                    const short = toSend - r.binder_balance;
                    return (
                      <tr key={r.chip._id}>
                        <td className="py-2 pr-3 font-bold text-fg"><span className="mr-2 inline-block h-3 w-3 rounded-full border border-line align-middle" style={{ backgroundColor: r.chip.color }} />{fmt(r.chip.value)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{fmt(r.in_play)}</td>
                        <td className="px-2 py-2 text-right tabular-nums text-fg-muted">{fmt(r.on_table)}</td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums text-fg">{fmt(toSend)}</td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums text-fg">{fmt(r.binder_balance)}</td>
                        <td className="px-2 py-2 text-right"><span className={`badge ${short > 0 ? 'badge-danger' : 'badge-ok'}`}>{short > 0 ? `faltam ${fmt(short)}` : 'saldo cobre'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
        </div>
      </details>


      {allocations.length === 0 && !isFinalPhase && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
          <AlertCircle className="mt-0.5 shrink-0" size={18} /> O torneio não tem fichas alocadas. Só é possível enviar fichas dos fichários alocados (aba Logística → Fichas Alocadas).
        </div>
      )}

      <div className={active === 'send' ? '' : 'hidden'}>
      {canOperate && !closed && !isFinalPhase && (
        <section className="card p-6">
          <h3 className="mb-1 flex items-center gap-2 text-lg font-bold"><Send size={18} className="text-emerald-500" /> Enviar fichas ao torneio</h3>
          <p className="mb-4 text-xs text-fg-muted">{sessions.length > 1 ? 'Vai para a sessão selecionada. ' : ''}Por ação: informe só a quantidade; as fichas por denominação são calculadas pelo modelo de stack.</p>

          <div className="mb-4 flex flex-wrap items-end gap-2" data-testid="send-tables">
            <div className="w-48"><CustomSelect options={actionOptions} value={tables.action} onChange={(v) => setTables((t) => ({ ...t, action: v }))} placeholder="Ação" /></div>
            <label className="text-xs font-bold text-fg-muted">Mesas<input type="number" min="1" step="1" value={tables.count} onChange={(e) => setTables((t) => ({ ...t, count: e.target.value }))} className={`${numCls} ml-2`} /></label>
            <label className="text-xs font-bold text-fg-muted">Stacks por mesa<input type="number" min="1" step="1" value={tables.per} onChange={(e) => setTables((t) => ({ ...t, per: e.target.value }))} className={`${numCls} ml-2`} /></label>
            <button type="button" onClick={addTables} className="btn btn-secondary">Adicionar por mesas</button>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px_auto] items-center gap-2">
                <CustomSelect options={actionOptions} value={r.action} onChange={(v) => setRows((x) => x.map((y, j) => (j === i ? { ...y, action: v } : y)))} placeholder="Ação (buy-in, reentrada…)" />
                <input type="number" min="1" step="1" placeholder="Qtd" value={r.count} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, count: e.target.value } : y)))} className={numCls} />
                <button onClick={() => setRows((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : [{ action: '', count: '' }]))} className="p-2 text-fg-subtle hover:text-red-500"><Trash2 size={15} /></button>
              </div>
            ))}
            <button onClick={() => setRows((x) => [...x, { action: '', count: '' }])} className="flex items-center gap-1 text-xs font-bold text-brand-fg"><Plus size={13} /> Outra ação</button>
          </div>

          {plan && plan.rows.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {plan.rows.map((r) => (
                <span key={r.chip._id} className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.chip.color }} /> {fmt(r.chip.value)} × {fmt(r.quantity)}
                </span>
              ))}
              <span className="self-center text-xs text-fg-muted">= valor {fmt(plan.totals.value)}</span>
            </div>
          )}

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-fg-subtle">Envio adicional (fichas avulsas)</summary>
            <div className="mt-3 space-y-2">
              <button onClick={fillPending} className="text-xs font-bold text-brand-fg">Preencher com o pendente</button>
              <div className="flex flex-wrap gap-3">
                {(summary?.rows || []).map((r) => (
                  <label key={r.chip._id} className="flex items-center gap-2 text-xs font-bold text-fg-muted">
                    <span className="h-3 w-3 rounded-full border border-line" style={{ backgroundColor: r.chip.color }} /> {fmt(r.chip.value)}
                    <input type="number" min="0" step="1" placeholder="0" value={extra[r.chip._id] ?? ''} onChange={(e) => setExtra((x) => ({ ...x, [r.chip._id]: e.target.value }))} className={numCls} />
                  </label>
                ))}
              </div>
            </div>
          </details>

          {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs font-bold text-red-600 dark:bg-red-500/10">{error}</p>}
          <button onClick={sendNow} disabled={busy || allocations.length === 0} className="btn btn-success mt-4 disabled:opacity-40">{busy ? 'Enviando…' : 'Enviar'}</button>
        </section>
      )}
      </div>

      {tournament.is_ko && <KoPanel tournamentId={tid} canOperate={canOperate} refreshKey={refreshKey} />}

      <div className={active === 'return' ? '' : 'hidden'}>
      {canOperate && (
        <section className="card p-6">
          <h3 className="mb-1 flex items-center gap-2 text-lg font-bold"><Undo2 size={18} className="text-blue-500" /> Retornar fichas ao fichário</h3>
          <p className="mb-4 text-xs text-fg-muted">Volta de fichas: o sistema sugere enviados − usados, em stacks. Confirme com um toque ou ajuste; sobras que não fecham um stack entram como fichas avulsas.</p>
          <div className="mb-3 max-w-sm">
            <CustomSelect options={allocations.map((a) => ({ value: a.binder_id?._id, label: a.binder_id?.name }))} value={ret.binder_id} onChange={(v) => setRet((r) => ({ ...r, binder_id: v }))} placeholder="Fichário que recebe…" />
          </div>
          {sug?.rows?.length > 0 && (
            <div className="mb-4 overflow-x-auto" data-testid="return-stacks">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="text-xs text-fg-subtle">
                  <tr><th className="py-1 pr-2">Ação</th><th className="px-2 text-right">Enviados</th><th className="px-2 text-right">Usados</th><th className="px-2 text-right">Já devolvidos</th><th className="px-2 text-right">Manter na ilha</th><th className="px-2 text-right">Devolver (stacks)</th></tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {sug.rows.map((r) => (
                    <tr key={r.action}>
                      <td className="py-2 pr-2 font-bold">{r.label}</td>
                      <td className="px-2 text-right tabular-nums">{fmt(r.sent)}</td>
                      <td className="px-2 text-right tabular-nums">{fmt(r.used)}</td>
                      <td className="px-2 text-right tabular-nums">{fmt(r.returned)}</td>
                      <td className="px-2 text-right"><input type="number" min="0" step="1" aria-label={`Manter na ilha — ${r.label}`} value={keep[r.action] ?? ''} placeholder="0" onChange={(e) => setKeep((k) => ({ ...k, [r.action]: e.target.value }))} className={numCls} /></td>
                      <td className="px-2 text-right"><input type="number" min="0" max={r.available} step="1" aria-label={`Devolver stacks — ${r.label}`} value={stackRet[r.action] ?? ''} onChange={(e) => setStackRet((k) => ({ ...k, [r.action]: e.target.value }))} className={`${numCls} ${Number(stackRet[r.action]) > r.available ? 'border-red-400' : ''}`} /> <span className="text-xs text-fg-subtle">(cabem {fmt(r.available)})</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mb-2 text-xs font-bold text-fg-subtle">Fichas avulsas (sobras que não fecham um stack)</p>
          <div className="flex flex-wrap gap-3">
            {(summary?.rows || []).filter((r) => r.on_table > 0).map((r) => (
              <label key={r.chip._id} className="flex items-center gap-2 text-xs font-bold text-fg-muted">
                <span className="h-3 w-3 rounded-full border border-line" style={{ backgroundColor: r.chip.color }} /> {fmt(r.chip.value)} <span className="text-fg-subtle">(no Salão {fmt(r.on_table)})</span>
                <input type="number" min="0" step="1" placeholder="0" value={ret.chips[r.chip._id] ?? ''} onChange={(e) => setRet((s) => ({ ...s, chips: { ...s.chips, [r.chip._id]: e.target.value } }))} className={`${numCls} ${Number(ret.chips[r.chip._id]) > r.on_table ? 'border-red-400' : ''}`} />
              </label>
            ))}
            {(summary?.rows || []).every((r) => r.on_table <= 0) && <p className="text-xs italic text-fg-subtle">Não há fichas no Salão.</p>}
          </div>
          <input value={ret.reason} onChange={(e) => setRet((r) => ({ ...r, reason: e.target.value }))} placeholder="Observação (opcional) — ex.: contagem do fim do dia" className="input mt-3 w-full max-w-lg" />
          <div><button onClick={returnNow} disabled={busy} className="btn btn-info mt-4 disabled:opacity-40">{busy ? 'Registrando…' : 'Registrar retorno'}</button></div>
        </section>
      )}
      </div>

      <div className="hidden">
      {canOperate && !closed && (
        <section className="card p-6">
          <h3 className="mb-1 flex items-center gap-2 text-lg font-bold"><PackageMinus size={18} className="text-red-500" /> Descarte de stack</h3>
          <p className="mb-4 text-xs text-fg-muted">O stack foi abandonado: as fichas saem do jogo e voltam ao fichário na hora. Reduz o esperado em jogo.</p>
          <button onClick={() => setDiscarding(true)} disabled={allocations.length === 0} className="btn btn-danger-solid">Descartar stack</button>
        </section>
      )}
      </div>

      <details className="card p-6">
        <summary className="cursor-pointer text-sm font-bold">Ver detalhes · descartes e movimentações</summary>
        <div className="mt-6 space-y-8">
      {discards.length > 0 && (
        <section className="card p-6">
          <h3 className="mb-3 text-lg font-bold">Descartes do torneio</h3>
          <ul className="divide-y divide-line-soft">
            {discards.map((d) => (
              <li key={d.batch_id} className={`flex flex-wrap items-center justify-between gap-2 py-2 text-xs ${d.reversed ? 'opacity-50' : ''}`}>
                <span className="font-bold text-fg">
                  {d.chips.map((c) => `${fmt(c.chip.value)} × ${fmt(c.quantity)}`).join(' + ')} = valor {fmt(d.total_value)}{d.reversed ? ' (estornado)' : ''}
                  {d.note ? <span className="ml-2 font-normal italic text-fg-subtle">{d.note}</span> : null}
                </span>
                <span className="flex items-center gap-3 text-fg-subtle">
                  {new Date(d.at).toLocaleString(locale())} · {d.user_name}{d.binder?.name ? ` · ${d.binder.name}` : ''}
                  {isAdmin && !d.reversed && <button onClick={() => reverseDiscard(d)} className="font-bold text-purple-500 hover:underline">Estornar</button>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-6">
        <h3 className="mb-3 text-lg font-bold">Movimentações do torneio</h3>
        {moves.length === 0 ? <p className="py-4 text-center text-sm italic text-fg-subtle">Nenhuma movimentação de material.</p> : (
          <ul className="divide-y divide-line-soft">
            {moves.map((m) => (
              <li key={m._id} className={`flex items-center justify-between gap-3 py-2 text-xs ${m.reversed_by ? 'opacity-50' : ''}`}>
                <span className="font-bold text-fg">{TYPE_LABEL[m.type] || m.type} · {fmt(m.chip_id?.value)} × {fmt(m.quantity)}{m.reversed_by ? ' (estornado)' : ''}</span>
                <span className="text-fg-subtle">{new Date(m.createdAt).toLocaleString(locale())} · {m.user_name}{m.binder_id?.name ? ` · ${m.binder_id.name}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
        </div>
      </details>

      {discarding && (
        <DiscardModal tournamentId={tid} sessionId={sessionId} rows={summary?.rows || []} allocations={allocations}
          onClose={() => setDiscarding(false)}
          onDone={async () => { setDiscarding(false); showAlert('Descarte registrado!', 'success'); await load(); onChanged?.(); }} />
      )}
    </div>
  );
}
