import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { apiPut } from '../lib/api';
import { useTournamentClock } from '../hooks/useTournamentClock';
import { useAlert } from '../contexts/AlertContext';

/**
 * Blinds da fase seguinte (Dia Final, Simulação 3.0 §4): a fase continua a numeração das classificatórias e começa com
 * SB/BB/ante do último nível anterior. Aqui o operador edita esses valores livremente — o NÚMERO do nível nunca muda.
 */
export default function PhaseBlindsEditor({ tournamentId, sessionId }) {
  const { showAlert } = useAlert();
  const clock = useTournamentClock(tournamentId, { sessionId });
  const lvl = clock.level;
  const isLevel = lvl && (!lvl.row_type || lvl.row_type === 'level');
  const [f, setF] = useState({ small_blind: '', big_blind: '', ante: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isLevel) setF({ small_blind: String(lvl.small_blind ?? ''), big_blind: String(lvl.big_blind ?? ''), ante: String(lvl.ante ?? 0) });
  }, [isLevel, lvl?.small_blind, lvl?.big_blind, lvl?.ante, clock.current_level]); // eslint-disable-line react-hooks/exhaustive-deps

  const url = `/tournaments/${tournamentId}/sessions/${sessionId}/level`;
  const run = async (body, ok) => {
    setBusy(true);
    try { await apiPut(url, body); showAlert(ok, 'success'); } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao salvar os blinds', 'error'); } finally { setBusy(false); }
  };
  const save = (e) => {
    e.preventDefault();
    run({ small_blind: Number(f.small_blind), big_blind: Number(f.big_blind), ante: Number(f.ante || 0) }, `Blinds do Nível ${clock.level_number} atualizados.`);
  };
  const cls = 'input w-28 text-center';

  return (
    <form onSubmit={save} data-testid="phase-blinds" className="card flex flex-wrap items-end gap-3 p-4">
      <div className="mr-auto">
        <p className="flex items-center gap-2 text-sm font-bold text-fg"><Pencil size={14} /> Blinds desta fase{isLevel ? ` · Nível ${clock.level_number}` : ''}</p>
        <p className="text-xs text-fg-muted">Começam com os valores do último nível anterior. Editar não altera o número do nível.</p>
      </div>
      {isLevel && (
        <>
          <label className="label">SB<input aria-label="SB" type="number" min="1" value={f.small_blind} onChange={(e) => setF({ ...f, small_blind: e.target.value })} className={cls} /></label>
          <label className="label">BB<input aria-label="BB" type="number" min="1" value={f.big_blind} onChange={(e) => setF({ ...f, big_blind: e.target.value })} className={cls} /></label>
          <label className="label">Ante<input aria-label="Ante" type="number" min="0" value={f.ante} onChange={(e) => setF({ ...f, ante: e.target.value })} className={cls} /></label>
          <button type="submit" disabled={busy} className="btn btn-primary btn-sm">Salvar blinds</button>
        </>
      )}
      <button type="button" disabled={busy} onClick={() => run({ append: true }, 'Nível acrescentado ao fim da estrutura.')} className="btn btn-secondary btn-sm"><Plus size={13} /> Nível</button>
    </form>
  );
}
