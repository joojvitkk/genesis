import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiGet, apiPut, apiDelete } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import CustomSelect from './CustomSelect';
import { SEVERITY } from './SeverityBadge';

const LEVELS = Object.entries(SEVERITY).map(([value, s]) => ({ value, label: s.label }));

/** Configuração do semáforo (admin): faixas por valor nominal, escalonamento por quantidade e exigência de justificativa. */
export default function SeverityConfig() {
  const { showAlert, showConfirm } = useAlert();
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => apiGet('/settings/severity').then(setCfg).catch((e) => { if (e.status !== 401) setError(e.message); }), []);
  useEffect(() => { load(); }, [load]);
  if (!cfg) return <p className="p-6 text-sm text-gray-400">{error || 'Carregando…'}</p>;

  const setBand = (i, patch) => setCfg((c) => ({ ...c, bands: c.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const addBand = () => setCfg((c) => ({ ...c, bands: [...c.bands.slice(0, -1), { up_to: '', level: 'YELLOW' }, c.bands.at(-1)] }));
  const removeBand = (i) => setCfg((c) => ({ ...c, bands: c.bands.filter((_, j) => j !== i) }));
  const setEsc = (k, v) => setCfg((c) => ({ ...c, escalate: { ...c.escalate, [k]: v } }));

  const save = async () => {
    setBusy(true); setError(null);
    try {
      setCfg(await apiPut('/settings/severity', cfg));
      showAlert('Semáforo salvo. Vale para as próximas ocorrências.', 'success');
    } catch (e) { if (e.status !== 401) setError(e.message || 'Erro ao salvar'); } finally { setBusy(false); }
  };
  const restore = async () => {
    if (!(await showConfirm('Voltar o semáforo ao padrão?'))) return;
    try { setCfg(await apiDelete('/settings/severity')); showAlert('Semáforo restaurado.', 'success'); } catch (e) { if (e.status !== 401) setError(e.message); }
  };

  const numCls = 'w-28 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center text-sm font-bold outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-700 dark:bg-zinc-900';
  const last = cfg.bands.length - 1;

  return (
    <section className="space-y-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
      <div>
        <h3 className="text-lg font-bold">Semáforo de criticidade</h3>
        <p className="mt-1 text-xs text-gray-500">Faixas pelo valor nominal da ficha. A mudança vale só para as próximas ocorrências.</p>
      </div>

      <div className="space-y-2">
        {cfg.bands.map((b, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-28 text-xs font-bold text-gray-500">{i === last ? 'Acima disso' : 'Valor até'}</span>
            {i !== last && <input type="number" min="1" aria-label={`Teto da faixa ${i + 1}`} value={b.up_to ?? ''} onChange={(e) => setBand(i, { up_to: e.target.value })} className={numCls} />}
            <div className="w-40"><CustomSelect options={LEVELS} value={b.level} onChange={(v) => setBand(i, { level: v })} /></div>
            {i !== last && cfg.bands.length > 1 && <button onClick={() => removeBand(i)} aria-label="Remover faixa" className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={15} /></button>}
          </div>
        ))}
        <button onClick={addBand} className="flex items-center gap-1 text-xs font-bold text-genesis-red"><Plus size={13} /> Faixa</button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {[['yellow_at_quantity', 'Sobe para amarelo a partir de (qtd.)'], ['red_at_quantity', 'Sobe para vermelho a partir de (qtd.)']].map(([k, label]) => (
          <label key={k} className="flex items-center justify-between gap-3 text-xs font-bold text-gray-500">{label}
            <input type="number" min="1" aria-label={label} placeholder="sem limite" value={cfg.escalate?.[k] ?? ''} onChange={(e) => setEsc(k, e.target.value)} className={numCls} />
          </label>
        ))}
      </div>

      <div className="flex max-w-sm items-center gap-3 text-xs font-bold text-gray-500">
        <span>Justificativa obrigatória a partir de</span>
        <div className="w-40"><CustomSelect options={LEVELS} value={cfg.require_justification_from} onChange={(v) => setCfg((c) => ({ ...c, require_justification_from: v }))} /></div>
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-bold text-red-600 dark:bg-red-500/10">{error}</p>}
      <div className="flex gap-3">
        <button onClick={save} disabled={busy} className="rounded-xl bg-genesis-red px-6 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-40">Salvar</button>
        <button onClick={restore} className="rounded-xl px-4 py-3 text-xs font-bold text-gray-500 hover:bg-gray-100 dark:hover:bg-zinc-800">Restaurar padrão</button>
      </div>
    </section>
  );
}
