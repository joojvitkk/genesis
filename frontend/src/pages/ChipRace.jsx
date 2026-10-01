import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Coins, Info, Undo2, Layers, AlertCircle } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { can } from '../config';
import CustomSelect from '../components/CustomSelect';

const TYPES = [{ v: 'CHIP_RACE', label: 'Chip Race' }, { v: 'COLOR_UP', label: 'Color Up' }];
const fmt = (n) => (n ?? 0).toLocaleString('pt-BR');
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
const CLOSED = ['finished', 'finalized'];

/**
 * Chip Race / Color Up (spec §8): o operador lança o que SAIU e o que ENTROU de jogo, por denominação.
 * O SERVIDOR calcula os valores e a QUEBRA MATEMÁTICA (diferença legítima da conversão — não é perda física)
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
  const [allocations, setAllocations] = useState([]);
  const [material, setMaterial] = useState(null);
  const [history, setHistory] = useState([]);
  const [type, setType] = useState('CHIP_RACE');
  const [binderId, setBinderId] = useState('');
  const [outs, setOuts] = useState({});
  const [ins, setIns] = useState({});
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);     // { value_out, value_in, math_breakage } — vem do servidor
  const [previewError, setPreviewError] = useState(null);
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

  const loadTournament = useCallback(async (id) => {
    if (!id) return;
    try {
      const [s, a, m, h] = await Promise.all([
        apiGet(`/tournaments/${id}/sessions`), apiGet('/allocations', { tournament_id: id }),
        apiGet(`/tournaments/${id}/material`), apiGet('/conversions', { tournament_id: id }),
      ]);
      setSessions(s); setAllocations(a); setMaterial(m); setHistory(h);
      setSessionId((cur) => (s.find((x) => x._id === cur) ? cur : (s.find((x) => x.status === 'running') || s[0])?._id || ''));
      setBinderId((cur) => (a.find((x) => (x.binder_id?._id || x.binder_id) === cur) ? cur : (a.length === 1 ? (a[0].binder_id?._id || a[0].binder_id) : '')));
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar o torneio', 'error'); }
  }, [showAlert]);
  useEffect(() => { loadTournament(tid); }, [tid, loadTournament]);

  // em jogo por ficha e quanto ainda há reservado (alocação) para colocar
  const onTable = useMemo(() => Object.fromEntries((material?.rows || []).map((r) => [r.chip._id, r.on_table])), [material]);
  const reserved = useMemo(() => {
    const m = {};
    allocations.forEach((a) => a.chips.forEach((l) => { const id = l.chip_id?._id || l.chip_id; m[id] = (m[id] || 0) + (l.remaining || 0); }));
    return m;
  }, [allocations]);

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

  const reset = () => { setOuts({}); setIns({}); setNote(''); setPreview(null); };

  const submit = async () => {
    const o = lines(outs); const i = lines(ins);
    if (!tid) return showAlert('Selecione o torneio.', 'error');
    if (!o.length || !i.length) return showAlert('Lance o que saiu (Retirado) e o que entrou (Colocado).', 'error');
    if (allocations.length > 1 && !binderId) return showAlert('Escolha o fichário que recebe as fichas retiradas.', 'error');
    const summary = preview
      ? `Retirado ${fmt(preview.value_out)} · Colocado ${fmt(preview.value_in)} · quebra matemática ${signed(preview.math_breakage)}.`
      : '';
    if (!(await showConfirm(`Registrar ${TYPES.find((t) => t.v === type).label}? ${summary} As fichas serão movimentadas e o lançamento não pode ser editado (só estornado).`))) return;
    setBusy(true);
    try {
      await apiPost('/conversions', { tournament_id: tid, type, session_id: sessionId || undefined, binder_id: binderId || undefined, outs: o, ins: i, note: note.trim() || undefined });
      showAlert('Conversão registrada!', 'success');
      reset();
      await loadTournament(tid);
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
      await loadTournament(tid);
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao estornar', 'error'); }
  };

  const tournamentOptions = tournaments.map((t) => ({ value: t._id, label: `${t.name}${t.status === 'running' ? ' · em andamento' : ''}` }));
  const numCls = 'w-24 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <header>
        <h1 className="flex items-center gap-2 text-3xl font-black uppercase tracking-tighter text-gray-900 dark:text-white md:text-4xl"><Coins className="text-genesis-red" size={30} /> Chip Race / Color Up</h1>
        <p className="text-gray-500 dark:text-gray-400">Lance o que saiu e o que entrou de jogo, por denominação. Valores e quebra são calculados pelo sistema.</p>
      </header>

      {loading ? (
        <div className="py-20 text-center text-gray-400 animate-pulse">Carregando…</div>
      ) : tournaments.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center text-gray-400 dark:border-zinc-800">Nenhum torneio aberto.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-400">Torneio</label>
              <CustomSelect options={tournamentOptions} value={tid} onChange={(v) => { setTid(v); reset(); }} placeholder="Torneio…" />
            </div>
            {sessions.length > 1 && (
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-400">Sessão</label>
                <CustomSelect options={sessions.map((s) => ({ value: s._id, label: s.name }))} value={sessionId} onChange={setSessionId} />
              </div>
            )}
            {allocations.length > 1 && (
              <div>
                <label className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-400">Fichas retiradas vão para</label>
                <CustomSelect options={allocations.map((a) => ({ value: a.binder_id?._id, label: a.binder_id?.name }))} value={binderId} onChange={setBinderId} placeholder="Fichário…" />
              </div>
            )}
          </div>

          {allocations.length === 0 && (
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
              <AlertCircle className="mt-0.5 shrink-0" size={18} /> Este torneio não tem fichas alocadas: o administrador precisa alocar um fichário antes de haver conversão.
            </div>
          )}

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                {TYPES.map((t) => (
                  <button key={t.v} onClick={() => setType(t.v)} className={`rounded-xl border px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${type === t.v ? 'border-genesis-red bg-red-50 text-genesis-red dark:bg-red-500/10' : 'border-gray-200 text-gray-500 dark:border-zinc-700'}`}>{t.label}</button>
                ))}
              </div>
              {!canOperate && <span className="text-xs font-bold text-gray-400">Somente consulta — o material registra as conversões.</span>}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-gray-400">
                    <th className="py-2 pr-3 text-left font-black">Ficha</th>
                    <th className="px-2 py-2 text-right font-black">Em jogo</th>
                    <th className="px-2 py-2 text-center font-black text-red-500">Retirado</th>
                    <th className="px-2 py-2 text-right font-black">Reservado p/ colocar</th>
                    <th className="px-2 py-2 text-center font-black text-emerald-600">Colocado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/60">
                  {chips.map((c) => {
                    const playing = onTable[c._id] || 0;
                    const res = reserved[c._id] || 0;
                    const o = Number(outs[c._id]) || 0; const n = Number(ins[c._id]) || 0;
                    return (
                      <tr key={c._id}>
                        <td className="py-2 pr-3">
                          <span className="inline-flex items-center gap-2 font-bold text-gray-700 dark:text-gray-300">
                            <span className="h-3 w-3 rounded-full border border-gray-200 dark:border-zinc-700" style={{ backgroundColor: c.color }} /> {fmt(c.value)}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-500">{fmt(playing)}</td>
                        <td className="px-2 py-2 text-center">
                          <input type="number" min="0" step="1" placeholder="0" disabled={!canOperate || playing <= 0} value={outs[c._id] ?? ''} onChange={(e) => setOuts((s) => ({ ...s, [c._id]: e.target.value }))} className={`${numCls} ${o > playing ? 'border-red-400' : ''}`} />
                        </td>
                        <td className="px-2 py-2 text-right font-bold tabular-nums text-gray-500">{fmt(res)}</td>
                        <td className="px-2 py-2 text-center">
                          <input type="number" min="0" step="1" placeholder="0" disabled={!canOperate || res <= 0} value={ins[c._id] ?? ''} onChange={(e) => setIns((s) => ({ ...s, [c._id]: e.target.value }))} className={`${numCls} ${n > res ? 'border-red-400' : ''}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
              {[['Valor retirado', preview?.value_out, 'text-red-500'], ['Valor colocado', preview?.value_in, 'text-emerald-600'], ['Quebra matemática', preview?.math_breakage, 'text-amber-500', true]].map(([label, v, cls, sign]) => (
                <div key={label} className="rounded-2xl bg-gray-50 p-4 dark:bg-[#0f0f0f]">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                  <p className={`text-2xl font-black tabular-nums ${cls}`}>{v === undefined || v === null ? '—' : sign ? signed(v) : fmt(v)}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs text-gray-500">
              <Info size={14} className="mt-0.5 shrink-0" />
              A quebra (colocado − retirado) é uma diferença legítima da conversão e <b className="mx-1">não é perda física</b>: não gera ocorrência. Só a conferência física aponta divergência.
            </p>
            {previewError && <p className="mt-2 text-xs font-bold text-red-500">{previewError}</p>}

            {canOperate && (
              <div className="mt-5 flex flex-col gap-3 md:flex-row">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Observação (opcional) — ex.: nível 6, mesas 1 a 4" className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-800 dark:bg-[#0f0f0f]" />
                <button onClick={submit} disabled={busy || allocations.length === 0} className="rounded-xl bg-genesis-red px-8 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-40">
                  {busy ? 'Registrando…' : `Registrar ${TYPES.find((t) => t.v === type).label}`}
                </button>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
            <div className="border-b border-gray-100 p-5 dark:border-zinc-800"><h2 className="flex items-center gap-2 font-black uppercase tracking-tight text-gray-900 dark:text-white"><Layers size={18} className="text-genesis-red" /> Histórico</h2></div>
            {history.length === 0 ? <p className="p-10 text-center text-sm italic text-gray-400">Nenhuma conversão neste torneio.</p> : (
              <ul className="divide-y divide-gray-100 dark:divide-zinc-800/60">
                {history.map((c) => (
                  <motion.li key={c._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`flex flex-wrap items-center gap-4 p-4 ${c.status === 'reversed' ? 'opacity-55' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-black text-gray-900 dark:text-white">
                        {c.type === 'CHIP_RACE' ? 'Chip Race' : 'Color Up'}
                        {c.legacy && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase text-gray-500 dark:bg-zinc-800">modelo anterior</span>}
                        {c.status === 'reversed' && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-black uppercase text-purple-600 dark:bg-purple-500/10">estornada</span>}
                      </p>
                      <p className="text-xs text-gray-500">
                        Saiu: {c.outs.map((l) => `${fmt(l.chip_id?.value)}×${fmt(l.quantity)}`).join(', ')} → Entrou: {c.ins.map((l) => `${fmt(l.chip_id?.value)}×${fmt(l.quantity)}`).join(', ')}
                      </p>
                      <p className="text-[11px] text-gray-400">{new Date(c.createdAt).toLocaleString('pt-BR')} · {c.user_name}{c.binder_id?.name ? ` · para ${c.binder_id.name}` : ''}{c.note ? ` · ${c.note}` : ''}{c.status === 'reversed' && c.reverse_reason ? ` · estorno: ${c.reverse_reason}` : ''}</p>
                    </div>
                    <div className="text-right text-xs tabular-nums">
                      <p className="text-gray-400">retirado {fmt(c.value_out)} · colocado {fmt(c.value_in)}</p>
                      <p className="font-black text-amber-500">quebra {signed(c.math_breakage)}</p>
                    </div>
                    {isAdmin && c.status === 'active' && !c.legacy && (
                      <button onClick={() => reverse(c)} title="Estornar" className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:text-purple-500 dark:border-zinc-700"><Undo2 size={16} /></button>
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
