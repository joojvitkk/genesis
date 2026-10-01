import { Play, Flag, RotateCcw, Plus, Edit2, Trash2 } from 'lucide-react';
import { apiPost, apiPut, apiDelete } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';

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
export default function SessionBar({ tournamentId, sessions, selectedId, onSelect, onChanged, isAdmin, tournamentClosed }) {
  const { showAlert, showConfirm, showPrompt } = useAlert();
  const selected = sessions.find((s) => s._id === selectedId);
  const base = `/tournaments/${tournamentId}/sessions`;

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
              key={s._id} onClick={() => onSelect(s._id)} title={`${st.label} · ${s.counts?.total ?? 0} entrada(s)`}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all ${active ? 'border-genesis-red bg-red-50 text-genesis-red dark:bg-red-500/10' : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-zinc-700'}`}
            >
              <span className={`h-2 w-2 rounded-full ${st.dot}`} />
              {s.name}
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
              <button onClick={rename} title="Renomear" className="rounded-lg p-1.5 text-gray-400 hover:text-blue-500"><Edit2 size={14} /></button>
              <button onClick={remove} title="Excluir sessão" className="rounded-lg p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
