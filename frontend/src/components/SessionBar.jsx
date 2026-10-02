import { useState } from 'react';
import { Play, Flag, RotateCcw, Plus, Edit2, Trash2, Clock, X } from 'lucide-react';
import { apiPost, apiPut, apiDelete } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';

const DEFAULT_TZ = 'America/Sao_Paulo';
const inputCls = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800';

/** Data (YYYY-MM-DD) e hora (HH:mm) de um instante, no fuso do torneio. */
function wallParts(iso, tz) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return { date: '', time: '' };
  const zone = tz || DEFAULT_TZ;
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: zone }),
    time: d.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit' }),
  };
}

/** "01/10 · 20:00" (fuso do torneio) ou '' quando a sessão não tem horário. */
export function sessionWhen(session, tz) {
  if (!session?.starts_at) return '';
  const d = new Date(session.starts_at);
  if (Number.isNaN(d.getTime())) return '';
  const zone = tz || DEFAULT_TZ;
  return `${d.toLocaleDateString('pt-BR', { timeZone: zone, day: '2-digit', month: '2-digit' })} · ${d.toLocaleTimeString('pt-BR', { timeZone: zone, hour: '2-digit', minute: '2-digit' })}`;
}

const STATUS = {
  scheduled: { label: 'Agendada', dot: 'bg-amber-400' },
  running: { label: 'Em andamento', dot: 'bg-emerald-500' },
  finished: { label: 'Encerrada', dot: 'bg-gray-400' },
};

/**
 * Sessões/fases do torneio (Dia 1A, 1B, Dia Final…). Escolhe a sessão ativa e muda o status.
 * Só o admin cria/renomeia/exclui; operadores iniciam e encerram (o backend também valida).
 * A sessão separa as ações (entradas) e as mesas — fichários e stack são do torneio inteiro.
 */
export default function SessionBar({ tournamentId, sessions, selectedId, onSelect, onChanged, isAdmin, tournamentClosed, timezone, defaultDate }) {
  const { showAlert, showConfirm, showPrompt } = useAlert();
  const selected = sessions.find((s) => s._id === selectedId);
  const base = `/tournaments/${tournamentId}/sessions`;
  const [timeForm, setTimeForm] = useState(null); // { date, time } enquanto o modal de horário está aberto

  const run = async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) showAlert(okMsg, 'success');
      await onChanged();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro na sessão', 'error');
    }
  };

  const setStatus = (status) => run(() => apiPut(`${base}/${selected._id}`, { status }));
  const addSession = async () => {
    const name = await showPrompt('Nome da nova sessão (ex.: Dia 1B, Dia Final):', { title: 'Nova sessão', confirmLabel: 'Criar' });
    if (name) await run(() => apiPost(base, { name }), 'Sessão criada.');
  };
  const rename = async () => {
    const name = await showPrompt('Novo nome da sessão:', { title: 'Renomear sessão', defaultValue: selected.name });
    if (name && name !== selected.name) await run(() => apiPut(`${base}/${selected._id}`, { name }), 'Sessão renomeada.');
  };
  const openTime = () => {
    const w = wallParts(selected.starts_at, timezone);
    setTimeForm({ date: w.date || defaultDate || '', time: w.time });
  };
  const saveTime = async (e) => {
    e.preventDefault();
    const body = timeForm.time ? { date: timeForm.date || undefined, start_time: timeForm.time } : { starts_at: null };
    setTimeForm(null);
    await run(() => apiPut(`${base}/${selected._id}`, body), 'Horário da sessão salvo.');
  };
  const remove = async () => {
    if (await showConfirm(`Excluir a sessão "${selected.name}"?`)) await run(() => apiDelete(`${base}/${selected._id}`), 'Sessão excluída.');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {sessions.map((s) => {
          const st = STATUS[s.status] || STATUS.scheduled;
          const active = s._id === selectedId;
          return (
            <button
              key={s._id} onClick={() => onSelect(s._id)} title={`${st.label} · ${s.counts?.total ?? 0} entrada(s)${s.starts_at ? ` · início ${sessionWhen(s, timezone)}` : ''}`}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all ${active ? 'border-genesis-red bg-red-50 text-genesis-red dark:bg-red-500/10' : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-zinc-700'}`}
            >
              <span className={`h-2 w-2 rounded-full ${st.dot}`} />
              {s.name}
              {s.starts_at && <span className="font-medium text-gray-400">{sessionWhen(s, timezone).split(' · ')[1]}</span>}
              <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-gray-500 dark:bg-zinc-800">{s.counts?.total ?? 0}</span>
            </button>
          );
        })}
        {isAdmin && !tournamentClosed && (
          <button onClick={addSession} className="flex items-center gap-1 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs font-bold text-gray-400 hover:border-genesis-red hover:text-genesis-red dark:border-zinc-700">
            <Plus size={13} /> Sessão
          </button>
        )}
      </div>

      {selected && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-gray-500">
            {selected.name} · {(STATUS[selected.status] || STATUS.scheduled).label}
            {selected.starts_at && <span className="ml-2 text-gray-400">início {sessionWhen(selected, timezone)}</span>}
            {selected.chips_value > 0 && <span className="ml-2 text-gray-400">valor em jogo {selected.chips_value.toLocaleString('pt-BR')}</span>}
          </span>
          {selected.status === 'scheduled' && (
            <button onClick={() => setStatus('running')} className="flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 font-bold text-white hover:bg-emerald-600"><Play size={12} /> Iniciar sessão</button>
          )}
          {selected.status === 'running' && (
            <button onClick={() => setStatus('finished')} className="flex items-center gap-1 rounded-lg bg-gray-600 px-3 py-1.5 font-bold text-white hover:bg-gray-700"><Flag size={12} /> Encerrar sessão</button>
          )}
          {selected.status === 'finished' && isAdmin && (
            <button onClick={() => setStatus('running')} className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 font-bold text-gray-600 hover:border-genesis-red dark:border-zinc-600 dark:text-gray-300"><RotateCcw size={12} /> Reabrir</button>
          )}
          {isAdmin && (
            <>
              <button onClick={openTime} title="Horário de início" className="rounded-lg p-1.5 text-gray-400 hover:text-emerald-500"><Clock size={14} /></button>
              <button onClick={rename} title="Renomear" className="rounded-lg p-1.5 text-gray-400 hover:text-blue-500"><Edit2 size={14} /></button>
              <button onClick={remove} title="Excluir sessão" className="rounded-lg p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
            </>
          )}
        </div>
      )}

      {timeForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setTimeForm(null)}>
          <form onSubmit={saveTime} onClick={(e) => e.stopPropagation()} className="max-h-[92vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-3xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-[#141414]">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Início · {selected?.name}</h3>
              <button type="button" onClick={() => setTimeForm(null)} aria-label="Fechar"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-bold">Data
                <input type="date" value={timeForm.date} onChange={(e) => setTimeForm({ ...timeForm, date: e.target.value })} className={`${inputCls} mt-1`} />
              </label>
              <label className="text-sm font-bold">Horário
                <input type="time" value={timeForm.time} onChange={(e) => setTimeForm({ ...timeForm, time: e.target.value })} className={`${inputCls} mt-1`} />
              </label>
            </div>
            <p className="text-xs text-gray-400">Horário no fuso do torneio. Deixe o horário vazio para remover.</p>
            <button type="submit" className="w-full rounded-xl bg-genesis-red py-3 font-bold text-white hover:bg-red-700">Salvar</button>
          </form>
        </div>
      )}
    </div>
  );
}
