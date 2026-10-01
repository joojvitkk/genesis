import { useCallback, useEffect, useState } from 'react';
import { Send, Undo2, Plus, Trash2, AlertCircle, PackageMinus } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import CustomSelect from './CustomSelect';
import DiscardModal from './DiscardModal';
import { socket } from '../lib/socket';

const fmt = (n) => (n ?? 0).toLocaleString('pt-BR');
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
export default function MaterialPanel({ tournament, sessions, sessionId, canOperate, isAdmin, stackActions, closed, refreshKey, onChanged }) {
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

  // tempo real: outro operador enviou/devolveu/descartou → recarrega o material na hora
  useEffect(() => {
    const onEvent = (p) => { if (!p?.tournament_id || String(p.tournament_id) === String(tid)) load(); };
    socket.on('materialChanged', onEvent);
    socket.on('discardRegistered', onEvent);
    return () => { socket.off('materialChanged', onEvent); socket.off('discardRegistered', onEvent); };
  }, [tid, load]);

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
    if (!ret.binder_id) return showAlert('Escolha o fichário que recebe as fichas.', 'error');
    if (!list.length) return showAlert('Informe as fichas devolvidas.', 'error');
    setBusy(true); setError(null);
    try {
      await apiPost(`/tournaments/${tid}/returns`, { binder_id: ret.binder_id, chips: list, reason: ret.reason.trim() || undefined, session_id: sessionId || undefined });
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

  const numCls = 'w-24 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-700 dark:bg-zinc-900';
  const actionOptions = stackActions.map((a) => ({ value: a.key, label: a.label }));
  const t = summary?.totals;

  return (
    <div className="space-y-8 p-4 md:p-8">
      {/* esperado × em jogo */}
      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
        <h3 className="mb-1 text-lg font-bold">Material em jogo</h3>
        <p className="mb-4 text-xs text-gray-500">Esperado = ações × stack (± conversões). Em jogo = enviado − devolvido ± conversões. Pendente = esperado − em jogo (positivo: falta enviar). Só informa; divergência formal é a conferência física.</p>
        {!summary || summary.rows.length === 0 ? <p className="py-6 text-center text-sm italic text-gray-400">Nada esperado nem enviado ainda.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr className="text-[10px] uppercase tracking-widest text-gray-400">
                {['Ficha', 'Esperado', 'Enviado', 'Devolvido', 'Descartado', 'Em jogo', 'Pendente'].map((h, i) => <th key={h} className={`py-2 font-black ${i === 0 ? 'pr-3 text-left' : 'px-2 text-right'}`}>{h}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60">
                {summary.rows.map((r) => (
                  <tr key={r.chip._id}>
                    <td className="py-2 pr-3 font-bold text-gray-700 dark:text-gray-300"><span className="mr-2 inline-block h-3 w-3 rounded-full border border-gray-200 align-middle dark:border-zinc-700" style={{ backgroundColor: r.chip.color }} />{fmt(r.chip.value)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-500">{fmt(r.expected)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-500">{fmt(r.sent)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-500">{fmt(r.returned)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-500">{fmt(r.discarded)}</td>
                    <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-800 dark:text-gray-200">{fmt(r.on_table)}</td>
                    <td className={`px-2 py-2 text-right font-black tabular-nums ${r.pending > 0 ? 'text-amber-500' : r.pending < 0 ? 'text-blue-500' : 'text-gray-300'}`}>{r.pending > 0 ? '+' : ''}{fmt(r.pending)}</td>
                  </tr>
                ))}
              </tbody>
              {t && <tfoot><tr className="border-t-2 border-gray-200 text-xs font-black dark:border-zinc-700">
                <td className="py-2 pr-3 uppercase tracking-widest text-gray-400">Valor</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(t.expected_value)}</td><td /><td /><td />
                <td className="px-2 py-2 text-right tabular-nums">{fmt(t.on_table_value)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-amber-500">{fmt(t.pending_value)}</td>
              </tr></tfoot>}
            </table>
          </div>
        )}
        {summary?.uncovered?.length > 0 && <p className="mt-3 text-xs text-amber-600">Sem fichas definidas para: {summary.uncovered.map((u) => u.label || u.action).join(', ')}. Escolha um modelo de stack com essa coluna.</p>}
      </section>

      {allocations.length === 0 && (
        <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
          <AlertCircle className="mt-0.5 shrink-0" size={18} /> O torneio não tem fichas alocadas. Só é possível enviar fichas dos fichários alocados (aba Logística → Fichas Alocadas).
        </div>
      )}

      {canOperate && !closed && (
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
          <h3 className="mb-1 flex items-center gap-2 text-lg font-bold"><Send size={18} className="text-emerald-500" /> Enviar fichas ao torneio</h3>
          <p className="mb-4 text-xs text-gray-500">{sessions.length > 1 ? 'Vai para a sessão selecionada. ' : ''}Por ação: informe só a quantidade; as fichas por denominação são calculadas pelo modelo de stack.</p>

          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px_auto] items-center gap-2">
                <CustomSelect options={actionOptions} value={r.action} onChange={(v) => setRows((x) => x.map((y, j) => (j === i ? { ...y, action: v } : y)))} placeholder="Ação (buy-in, reentrada…)" />
                <input type="number" min="1" step="1" placeholder="Qtd" value={r.count} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, count: e.target.value } : y)))} className={numCls} />
                <button onClick={() => setRows((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : [{ action: '', count: '' }]))} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={15} /></button>
              </div>
            ))}
            <button onClick={() => setRows((x) => [...x, { action: '', count: '' }])} className="flex items-center gap-1 text-xs font-bold text-genesis-red"><Plus size={13} /> Outra ação</button>
          </div>

          {plan && plan.rows.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {plan.rows.map((r) => (
                <span key={r.chip._id} className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: r.chip.color }} /> {fmt(r.chip.value)} × {fmt(r.quantity)}
                </span>
              ))}
              <span className="self-center text-xs text-gray-500">= valor {fmt(plan.totals.value)}</span>
            </div>
          )}

          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-widest text-gray-400">Envio adicional (fichas avulsas)</summary>
            <div className="mt-3 space-y-2">
              <button onClick={fillPending} className="text-xs font-bold text-genesis-red">Preencher com o pendente</button>
              <div className="flex flex-wrap gap-3">
                {(summary?.rows || []).map((r) => (
                  <label key={r.chip._id} className="flex items-center gap-2 text-xs font-bold text-gray-500">
                    <span className="h-3 w-3 rounded-full border border-gray-200" style={{ backgroundColor: r.chip.color }} /> {fmt(r.chip.value)}
                    <input type="number" min="0" step="1" placeholder="0" value={extra[r.chip._id] ?? ''} onChange={(e) => setExtra((x) => ({ ...x, [r.chip._id]: e.target.value }))} className={numCls} />
                  </label>
                ))}
              </div>
            </div>
          </details>

          {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs font-bold text-red-600 dark:bg-red-500/10">{error}</p>}
          <button onClick={sendNow} disabled={busy || allocations.length === 0} className="mt-4 rounded-xl bg-emerald-500 px-6 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-600 disabled:opacity-40">{busy ? 'Enviando…' : 'Enviar'}</button>
        </section>
      )}

      {canOperate && (
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
          <h3 className="mb-1 flex items-center gap-2 text-lg font-bold"><Undo2 size={18} className="text-blue-500" /> Retornar fichas ao fichário</h3>
          <p className="mb-4 text-xs text-gray-500">Registre a quantidade fisicamente devolvida, por denominação. Volta a ficar reservada ao torneio.</p>
          <div className="mb-3 max-w-sm">
            <CustomSelect options={allocations.map((a) => ({ value: a.binder_id?._id, label: a.binder_id?.name }))} value={ret.binder_id} onChange={(v) => setRet((r) => ({ ...r, binder_id: v }))} placeholder="Fichário que recebe…" />
          </div>
          <div className="flex flex-wrap gap-3">
            {(summary?.rows || []).filter((r) => r.on_table > 0).map((r) => (
              <label key={r.chip._id} className="flex items-center gap-2 text-xs font-bold text-gray-500">
                <span className="h-3 w-3 rounded-full border border-gray-200" style={{ backgroundColor: r.chip.color }} /> {fmt(r.chip.value)} <span className="text-gray-400">(em jogo {fmt(r.on_table)})</span>
                <input type="number" min="0" step="1" placeholder="0" value={ret.chips[r.chip._id] ?? ''} onChange={(e) => setRet((s) => ({ ...s, chips: { ...s.chips, [r.chip._id]: e.target.value } }))} className={`${numCls} ${Number(ret.chips[r.chip._id]) > r.on_table ? 'border-red-400' : ''}`} />
              </label>
            ))}
            {(summary?.rows || []).every((r) => r.on_table <= 0) && <p className="text-xs italic text-gray-400">Não há fichas em jogo.</p>}
          </div>
          <input value={ret.reason} onChange={(e) => setRet((r) => ({ ...r, reason: e.target.value }))} placeholder="Observação (opcional) — ex.: contagem do fim do dia" className="mt-3 w-full max-w-lg rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-800 dark:bg-[#0f0f0f]" />
          <div><button onClick={returnNow} disabled={busy} className="mt-4 rounded-xl bg-blue-500 px-6 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-600 disabled:opacity-40">{busy ? 'Registrando…' : 'Registrar retorno'}</button></div>
        </section>
      )}

      {canOperate && !closed && (
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
          <h3 className="mb-1 flex items-center gap-2 text-lg font-bold"><PackageMinus size={18} className="text-red-500" /> Descarte de stack</h3>
          <p className="mb-4 text-xs text-gray-500">O stack foi abandonado: as fichas saem do jogo e voltam ao fichário na hora. Reduz o esperado em jogo.</p>
          <button onClick={() => setDiscarding(true)} disabled={allocations.length === 0} className="rounded-xl bg-red-500 px-6 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-red-600 disabled:opacity-40">Descartar stack</button>
        </section>
      )}

      {discards.length > 0 && (
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
          <h3 className="mb-3 text-lg font-bold">Descartes do torneio</h3>
          <ul className="divide-y divide-gray-100 dark:divide-zinc-800/60">
            {discards.map((d) => (
              <li key={d.batch_id} className={`flex flex-wrap items-center justify-between gap-2 py-2 text-xs ${d.reversed ? 'opacity-50' : ''}`}>
                <span className="font-bold text-gray-700 dark:text-gray-300">
                  {d.chips.map((c) => `${fmt(c.chip.value)} × ${fmt(c.quantity)}`).join(' + ')} = valor {fmt(d.total_value)}{d.reversed ? ' (estornado)' : ''}
                  {d.note ? <span className="ml-2 font-normal italic text-gray-400">{d.note}</span> : null}
                </span>
                <span className="flex items-center gap-3 text-gray-400">
                  {new Date(d.at).toLocaleString('pt-BR')} · {d.user_name}{d.binder?.name ? ` · ${d.binder.name}` : ''}
                  {isAdmin && !d.reversed && <button onClick={() => reverseDiscard(d)} className="font-bold text-purple-500 hover:underline">Estornar</button>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
        <h3 className="mb-3 text-lg font-bold">Movimentações do torneio</h3>
        {moves.length === 0 ? <p className="py-4 text-center text-sm italic text-gray-400">Nenhuma movimentação de material.</p> : (
          <ul className="divide-y divide-gray-100 dark:divide-zinc-800/60">
            {moves.map((m) => (
              <li key={m._id} className={`flex items-center justify-between gap-3 py-2 text-xs ${m.reversed_by ? 'opacity-50' : ''}`}>
                <span className="font-bold text-gray-700 dark:text-gray-300">{TYPE_LABEL[m.type] || m.type} · {fmt(m.chip_id?.value)} × {fmt(m.quantity)}{m.reversed_by ? ' (estornado)' : ''}</span>
                <span className="text-gray-400">{new Date(m.createdAt).toLocaleString('pt-BR')} · {m.user_name}{m.binder_id?.name ? ` · ${m.binder_id.name}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {discarding && (
        <DiscardModal tournamentId={tid} sessionId={sessionId} rows={summary?.rows || []} allocations={allocations}
          onClose={() => setDiscarding(false)}
          onDone={async () => { setDiscarding(false); showAlert('Descarte registrado!', 'success'); await load(); onChanged?.(); }} />
      )}
    </div>
  );
}
