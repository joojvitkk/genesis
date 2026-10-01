import { useCallback, useEffect, useState } from 'react';
import { Users, Shuffle, Scissors, ArrowRightLeft, Dices, Check } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';

// `sessionId`: cada sessão (Dia 1A, 1B…) tem as suas mesas.
export default function SeatingMap({ tournamentId, sessionId, canEdit }) {
  const { showAlert, showConfirm } = useAlert();
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setView(await apiGet(`/tournaments/${tournamentId}/seating`, { session_id: sessionId })); }
    catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar mesas', 'error'); }
  }, [tournamentId, sessionId, showAlert]);

  useEffect(() => { refresh(); }, [refresh]);

  const act = async (path, body, confirmMsg) => {
    if (confirmMsg && !(await showConfirm(confirmMsg))) return;
    setBusy(true);
    try { setView(await apiPost(`/tournaments/${tournamentId}/seating/${path}`, { ...body, session_id: sessionId })); }
    catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro', 'error'); }
    finally { setBusy(false); }
  };

  if (!view) return <div className="p-10 text-center text-gray-400">Carregando mesas…</div>;

  const b = view.balancing;
  // não há cadastro de jogadores: cada lugar é ocupado por uma ENTRADA ("Entrada #12")
  const entryLabel = (id) => {
    for (const t of view.tables) {
      const s = t.seats.find((x) => String(x.entry_id) === String(id));
      if (s) return s.label;
    }
    return '—';
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-black uppercase tracking-widest text-gray-400">
          {view.total_seated} entradas · {view.tables.filter((t) => t.count > 0).length} mesa(s) · {view.seats_per_table}-max
        </p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => act('draw', {})} className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-xs font-black uppercase text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-200 dark:hover:bg-zinc-700">
              <Shuffle size={13} /> Sentar pendentes
            </button>
            <button disabled={busy} onClick={() => act('redraw', {}, 'Redistribuir todas as entradas ativas aleatoriamente?')} className="flex items-center gap-1.5 rounded-xl bg-gray-100 px-3 py-2 text-xs font-black uppercase text-gray-700 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-200 dark:hover:bg-zinc-700">
              <Dices size={13} /> Redistribuir
            </button>
          </div>
        )}
      </div>

      {/* Sugestão de balanceamento */}
      {b && canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
            <ArrowRightLeft size={14} className="mr-1.5 inline" />
            Mesas desbalanceadas — mover <b>{entryLabel(b.entry_id)}</b> da mesa {b.from_table} para a mesa {b.to_table}, lugar {b.to_seat}.
          </p>
          <button
            disabled={busy}
            onClick={() => act('move', { entry_id: b.entry_id, to_table: b.to_table, to_seat: b.to_seat })}
            className="flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black uppercase text-white hover:bg-amber-600"
          >
            <Check size={13} /> Aplicar
          </button>
        </div>
      )}

      {/* Mesas quebráveis */}
      {canEdit && view.breakable.map((bt) => (
        <div key={bt.table_number} className="flex items-center justify-between gap-3 rounded-2xl border border-blue-300 bg-blue-50 p-3 text-sm font-bold text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">
          <span><Scissors size={13} className="mr-1.5 inline" /> A mesa {bt.table_number} ({bt.count} entradas) cabe nas outras.</span>
          <button disabled={busy} onClick={() => act('break-table', { table_number: bt.table_number }, `Quebrar a mesa ${bt.table_number}?`)} className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-black uppercase text-white hover:bg-blue-600">Quebrar</button>
        </div>
      ))}

      {/* Grade de mesas */}
      {view.tables.filter((t) => t.count > 0).length === 0 ? (
        <p className="rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center text-gray-400 dark:border-zinc-800">
          Ninguém sentado. As inscrições sorteiam o lugar automaticamente.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {view.tables.filter((t) => t.count > 0).map((t) => (
            <div key={t.number} className="rounded-3xl border border-gray-200 bg-white p-5 dark:border-zinc-800 dark:bg-[#111111]">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-lg font-black uppercase tracking-tight text-gray-900 dark:text-white">Mesa {t.number}</h4>
                <span className="flex items-center gap-1 text-xs font-black text-gray-400"><Users size={12} /> {t.count}/{view.seats_per_table}</span>
              </div>
              <ul className="grid grid-cols-3 gap-1.5 text-xs sm:grid-cols-3">
                {t.seats.map((s) => (
                  <li
                    key={s.seat}
                    className={`truncate rounded-lg px-2 py-1.5 font-bold ${s.label ? 'bg-gray-100 text-gray-800 dark:bg-zinc-800 dark:text-gray-100' : 'bg-gray-50 text-gray-300 dark:bg-zinc-900/50 dark:text-zinc-600'}`}
                    title={s.label || `lugar ${s.seat} livre`}
                  >
                    <span className="text-gray-400">{s.seat}.</span> {s.label || '—'}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
