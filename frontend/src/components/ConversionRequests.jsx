import { locale } from '../lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { BellRing, Check, X, Hammer, PackageCheck } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { socket } from '../lib/socket';
import { can } from '../config';
import CustomSelect from './CustomSelect';

const fmt = (n) => (n ?? 0).toLocaleString(locale());
const TYPE = { CHIP_RACE: 'Chip Race', COLOR_UP: 'Color Up' };
const STATUS = {
  requested: { label: 'Solicitado', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/10' },
  in_preparation: { label: 'Em preparo', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-500/10' },
  ready: { label: 'Fichas prontas', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10' },
  completed: { label: 'Concluído', cls: 'bg-raised text-fg-muted dark:bg-zinc-800' },
  cancelled: { label: 'Cancelado', cls: 'bg-red-100 text-red-600 dark:bg-red-500/10' },
};

/**
 * Chamados de Chip Race / Color Up (MEL-02). O SALÃO solicita informando as mesas REAIS abertas; o sistema congela a base do
 * cálculo (ativos e inscrições, provisória enquanto o registro está aberto) e a distribuição por mesa; o MATERIAL recebe,
 * prepara e atende registrando a conversão. A estimativa nunca substitui o que foi realmente retirado e entregue.
 */
export default function ConversionRequests({ tournamentId, sessionId, role, linkedId, onLink }) {
  const { showAlert } = useAlert();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ type: 'CHIP_RACE', tables: '', note: '' });
  const canRequest = can(role, 'mesas', 'operate');     // Salão (e admin)
  const canServe = can(role, 'chip_race', 'operate');   // Material (e admin)

  const load = useCallback(async () => {
    if (!tournamentId) return;
    try { setItems(await apiGet('/conversion-requests', { tournament_id: tournamentId, status: 'all' })); }
    catch (e) { if (e.status !== 401) console.error(e); }
  }, [tournamentId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const on = (p) => { if (!p?.tournament_id || String(p.tournament_id) === String(tournamentId)) load(); };
    socket.on('conversionRequestsChanged', on);
    return () => socket.off('conversionRequestsChanged', on);
  }, [tournamentId, load]);

  const request = async () => {
    const tables = Number(form.tables);
    if (!Number.isInteger(tables) || tables < 1) return showAlert('Informe a quantidade real de mesas abertas.', 'error');
    try {
      await apiPost(`/tournaments/${tournamentId}/conversion-requests`, { type: form.type, tables, note: form.note.trim() || undefined, session_id: sessionId || undefined });
      showAlert('Chamado enviado ao Material.', 'success');
      setForm((f) => ({ ...f, tables: '', note: '' }));
      load();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao solicitar', 'error'); }
  };

  const step = async (id, status) => {
    try { await apiPut(`/conversion-requests/${id}`, { status }); load(); }
    catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao atualizar o chamado', 'error'); }
  };

  const open = items.filter((i) => ['requested', 'in_preparation', 'ready'].includes(i.status));
  const past = items.filter((i) => !open.includes(i)).slice(0, 5);
  const inputCls = 'rounded-xl border border-line bg-sunken px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand dark:bg-sunken';

  return (
    <section className="card p-6" aria-label="Chamados de troca">
      <h2 className="mb-1 flex items-center gap-2 font-bold uppercase tracking-tight text-fg"><BellRing size={18} className="text-brand-fg" /> Chamados Salão → Material</h2>
      <p className="mb-4 text-xs text-fg-muted">O Salão solicita informando as mesas reais abertas; a base do cálculo (ativos e inscrições) fica registrada no chamado. A troca pode ocorrer antes do fechamento das entradas — fechar depois não reescreve uma troca já executada.</p>

      {canRequest && (
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-fg-subtle">Troca</label>
            <div className="w-44" aria-label="Tipo de troca">
              <CustomSelect options={Object.entries(TYPE).map(([value, label]) => ({ value, label }))} value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-fg-subtle">Mesas abertas</label>
            <input aria-label="Mesas abertas" type="number" min="1" value={form.tables} onChange={(e) => setForm((f) => ({ ...f, tables: e.target.value }))} className={`${inputCls} w-28`} />
          </div>
          <input aria-label="Observação do chamado" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Observação (opcional)" className={`${inputCls} min-w-[200px] flex-1`} />
          <button onClick={request} className="btn btn-primary">Solicitar</button>
        </div>
      )}

      {open.length === 0 ? <p className="text-sm italic text-fg-subtle">Nenhum chamado em aberto.</p> : (
        <ul className="space-y-3">
          {open.map((r) => (
            <li key={r._id} className={`rounded-2xl border p-4 ${linkedId === r._id ? 'border-brand bg-red-50/40 dark:bg-red-500/5' : 'border-line'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-bold text-fg">{TYPE[r.type]} · {fmt(r.tables)} mesa(s)</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                {r.session_id?.name && <span className="text-xs text-fg-subtle">{r.session_id.name}</span>}
                <span className="ml-auto text-xs text-fg-subtle">{new Date(r.createdAt).toLocaleString(locale())} · {r.requested_by}</span>
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                Base: {fmt(r.snapshot?.active_players)} jogando · {fmt(r.snapshot?.entries_total)} inscrições ({fmt(r.snapshot?.entries_initial)} iniciais + {fmt(r.snapshot?.entries_reentries)} reentradas)
                {r.snapshot?.provisional ? ' · provisório (registro aberto)' : ''}
                {r.estimate?.players_per_table ? ` · ~${fmt(r.estimate.players_per_table)} por mesa (arredondado para cima)` : ''}
              </p>
              {r.estimate?.per_table?.length > 0 && (
                <p className="text-xs text-fg-subtle">Por mesa, em jogo: {r.estimate.per_table.map((p) => `${fmt(p.value)} × ${fmt(p.per_table)}`).join(' · ')}</p>
              )}
              {r.note && <p className="text-xs text-fg-muted">“{r.note}”</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {canServe && r.status === 'requested' && <button onClick={() => step(r._id, 'in_preparation')} className="btn btn-info items-center"><Hammer size={12} /> Iniciar preparo</button>}
                {canServe && r.status === 'in_preparation' && <button onClick={() => step(r._id, 'ready')} className="btn btn-success items-center"><PackageCheck size={12} /> Fichas prontas</button>}
                {canServe && <button onClick={() => onLink?.(linkedId === r._id ? null : r)} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-bold uppercase text-fg-muted"><Check size={12} /> {linkedId === r._id ? 'Desvincular' : 'Atender com a conversão abaixo'}</button>}
                {(canRequest || canServe) && <button onClick={() => step(r._id, 'cancelled')} className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10"><X size={12} /> Cancelar</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <p className="mt-4 text-xs text-fg-subtle">Recentes: {past.map((r) => `${TYPE[r.type]} (${STATUS[r.status].label.toLowerCase()})`).join(' · ')}</p>
      )}
    </section>
  );
}
