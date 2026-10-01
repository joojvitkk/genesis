import { useEffect, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import CustomSelect from './CustomSelect';
import SeverityBadge from './SeverityBadge';

const fmt = (n) => (n ?? 0).toLocaleString('pt-BR');
const SCOPES = [{ value: 'binder', label: 'Fichário' }, { value: 'tournament', label: 'Jogo (torneio)' }];

/**
 * Conferência física (G8): o operador conta e informa; o SERVIDOR compara com o saldo derivado dos movimentos,
 * lança falta (LOSS) / sobra (FOUND) e abre a ocorrência com o semáforo. Nunca sobrescreve quantidade.
 * Só entram na conferência as fichas cuja contagem foi preenchida.
 */
export default function CountPanel({ onDone }) {
  const [scope, setScope] = useState('binder');
  const [binders, setBinders] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [targetId, setTargetId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [rows, setRows] = useState([]);        // [{ chip, expected }]
  const [counted, setCounted] = useState({});
  const [reason, setReason] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGet('/binders').then(setBinders).catch(() => {});
    apiGet('/tournaments').then((t) => setTournaments(Array.isArray(t) ? t : t?.data || [])).catch(() => {});
  }, []);

  // o que o sistema espera encontrar
  useEffect(() => {
    setCounted({}); setResult(null); setError(null);
    if (!targetId) { setRows([]); return; }
    if (scope === 'binder') {
      const b = binders.find((x) => x._id === targetId);
      setRows((b?.chips || []).filter((c) => c.chip_id).map((c) => ({ chip: c.chip_id, expected: c.quantity })));
    } else {
      apiGet(`/tournaments/${targetId}/material`, { session_id: sessionId })
        .then((m) => setRows(m.rows.filter((r) => r.on_table > 0).map((r) => ({ chip: r.chip, expected: r.on_table }))))
        .catch(() => setRows([]));
    }
  }, [scope, targetId, sessionId, binders]);

  useEffect(() => {
    setSessionId('');
    if (scope !== 'tournament' || !targetId) { setSessions([]); return; }
    apiGet(`/tournaments/${targetId}/sessions`).then((s) => setSessions(Array.isArray(s) ? s : [])).catch(() => setSessions([]));
  }, [scope, targetId]);

  const pickScope = (v) => { setScope(v); setTargetId(''); setSessionId(''); };
  const counts = Object.entries(counted).filter(([, v]) => v !== '' && v !== undefined).map(([chip_id, v]) => ({ chip_id, counted: Number(v) }));

  const submit = async () => {
    if (!targetId) return setError(scope === 'binder' ? 'Escolha o fichário.' : 'Escolha o torneio.');
    if (!counts.length) return setError('Informe a contagem de ao menos uma ficha.');
    setBusy(true); setError(null); setResult(null);
    try {
      const url = scope === 'binder' ? `/binders/${targetId}/count` : `/tournaments/${targetId}/count`;
      const res = await apiPost(url, { counts, reason: reason.trim() || undefined, session_id: scope === 'tournament' ? sessionId || undefined : undefined });
      setResult(res);
      if (res.diffs.length) onDone?.();
    } catch (e) {
      if (e.status !== 401) setError(e.message || 'Erro ao registrar a conferência');
    } finally { setBusy(false); }
  };

  const numCls = 'w-24 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-700 dark:bg-zinc-900';
  const targets = scope === 'binder' ? binders.map((b) => ({ value: b._id, label: b.name })) : tournaments.map((t) => ({ value: t._id, label: t.name }));

  return (
    <section className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-bold"><PackageCheck size={18} className="text-genesis-red" /> Conferência física</h3>
        <p className="mt-1 text-xs text-gray-500">Conte e informe. O sistema compara com o saldo e abre uma ocorrência para cada diferença — nada é sobrescrito. A quebra matemática do Chip Race não é perda: a conferência é por quantidade.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <CustomSelect options={SCOPES} value={scope} onChange={pickScope} />
        <CustomSelect options={targets} value={targetId} onChange={setTargetId} placeholder={scope === 'binder' ? 'Fichário…' : 'Torneio…'} />
        {scope === 'tournament' && sessions.length > 1 && (
          <CustomSelect options={[{ value: '', label: 'Todas as sessões' }, ...sessions.map((s) => ({ value: s._id, label: s.name }))]} value={sessionId} onChange={setSessionId} placeholder="Sessão…" />
        )}
      </div>

      {targetId && rows.length === 0 && <p className="text-sm italic text-gray-400">Nada esperado {scope === 'binder' ? 'neste fichário' : 'em jogo'}.</p>}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {rows.map((r) => (
            <label key={r.chip._id} className="flex items-center gap-2 text-xs font-bold text-gray-500">
              <span className="h-3 w-3 rounded-full border border-gray-200" style={{ backgroundColor: r.chip.color }} /> {fmt(r.chip.value)}
              <span className="text-gray-400">(esperado {fmt(r.expected)})</span>
              <input type="number" min="0" step="1" placeholder="contado" aria-label={`Contado ${r.chip.value}`} value={counted[r.chip._id] ?? ''}
                onChange={(e) => setCounted((s) => ({ ...s, [r.chip._id]: e.target.value }))} className={numCls} />
            </label>
          ))}
        </div>
      )}

      <div>
        <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-gray-400">Justificativa (obrigatória para diferenças de severidade alta)</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: contagem do fim do turno"
          className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-800 dark:bg-[#0f0f0f]" />
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-bold text-red-600 dark:bg-red-500/10">{error}</p>}
      <button onClick={submit} disabled={busy} className="rounded-xl bg-genesis-red px-6 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-40">{busy ? 'Registrando…' : 'Registrar conferência'}</button>

      {result && (
        <div data-testid="count-result" className="space-y-2 rounded-2xl border border-gray-200 p-4 text-sm dark:border-zinc-800">
          {result.diffs.length === 0 ? <p className="font-bold text-emerald-600">Conferência OK — sem diferenças.</p> : (
            <>
              <p className="font-bold">{result.diffs.length} diferença(s) registrada(s):</p>
              <ul className="space-y-1">
                {result.diffs.map((d) => {
                  const row = rows.find((r) => r.chip._id === d.chip_id);
                  return (
                    <li key={d.occurrence_id} className="flex flex-wrap items-center gap-2 text-xs">
                      <SeverityBadge level={d.severity} />
                      <span className="font-bold">{fmt(row?.chip.value)}</span>
                      <span className="text-gray-500">esperado {fmt(d.expected)} · contado {fmt(d.counted)} · {d.diff < 0 ? 'faltam' : 'sobram'} {fmt(Math.abs(d.diff))}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {result.value && (
            <p className="text-xs text-gray-500">
              Valor esperado {fmt(result.value.expected)} · contado {fmt(result.value.counted)}
              {result.value.math_breakage !== 0 && <> · quebra matemática das conversões {fmt(result.value.math_breakage)} <span className="text-gray-400">(não é perda física)</span></>}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
