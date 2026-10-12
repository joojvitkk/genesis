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
  requested: { label: 'Solicitado', cls: 'badge-warn' },
  in_preparation: { label: 'Em preparo', cls: 'badge-info' },
  ready: { label: 'Pronto', cls: 'badge-ok' },
  completed: { label: 'Concluído', cls: 'badge-neutral' },
  cancelled: { label: 'Cancelado', cls: 'badge-neutral' },
};
const OPEN = ['requested', 'in_preparation', 'ready'];

/**
 * Chamados de Chip Race / Color Up (MEL-02, Simulação 2.1 §9). O SALÃO escolhe a sessão, a denominação a retirar e as
 * mesas REAIS abertas; o MATERIAL clica em "Iniciar preparo" (o chamado já fica selecionado para a troca) e registra a
 * operação, que conclui o chamado. Cada chamado é independente: cancelar um não afeta o próximo.
 */
export default function ConversionRequests({ tournamentId, sessionId, sessions = [], chips = [], role, linkedId, onLink, onLoaded }) {
  const { showAlert, showConfirm } = useAlert();
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ type: 'CHIP_RACE', tables: '', note: '', chipId: '' });
  const canRequest = can(role, 'mesas', 'operate');     // Salão (e admin)
  const canServe = can(role, 'chip_race', 'operate');   // Material (e admin)

  const load = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const rows = await apiGet('/conversion-requests', { tournament_id: tournamentId, status: 'all' });
      setItems(rows);
      onLoaded?.(rows);
    } catch (e) { if (e.status !== 401) console.error(e); }
  }, [tournamentId, onLoaded]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const on = (p) => { if (!p?.tournament_id || String(p.tournament_id) === String(tournamentId)) load(); };
    socket.on('conversionRequestsChanged', on);
    return () => socket.off('conversionRequestsChanged', on);
  }, [tournamentId, load]);

  const request = async () => {
    const tables = Number(form.tables);
    if (sessions.length > 0 && !sessionId) return showAlert('Selecione a sessão.', 'error');
    if (!form.chipId) return showAlert('Selecione a denominação que será retirada.', 'error');
    if (!Number.isInteger(tables) || tables < 1) return showAlert('Informe a quantidade real de mesas abertas.', 'error');
    try {
      await apiPost(`/tournaments/${tournamentId}/conversion-requests`, { type: form.type, tables, chip_id: form.chipId, note: form.note.trim() || undefined, session_id: sessionId || undefined });
      showAlert('Chamado enviado ao Material.', 'success');
      setForm((f) => ({ ...f, tables: '', note: '' }));
      load();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao solicitar', 'error'); }
  };

  const step = async (r, status) => {
    try {
      await apiPut(`/conversion-requests/${r._id}`, { status });
      if (status === 'in_preparation') onLink?.({ ...r, status }); // um clique: já fica selecionado para a troca
      if (status === 'cancelled' && linkedId === r._id) onLink?.(null);
      load();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao atualizar o chamado', 'error'); }
  };
  const cancel = async (r) => {
    if (await showConfirm(`Cancelar o chamado de ${TYPE[r.type]} (${r.session_id?.name || 'torneio'}, ficha ${fmt(r.chip_id?.value)})? Só este chamado será cancelado; uma nova solicitação cria outro.`)) step(r, 'cancelled');
  };

  const open = items.filter((i) => OPEN.includes(i.status));
  const past = items.filter((i) => !OPEN.includes(i.status)).slice(0, 5);
  const inputCls = 'input';

  return (
    <section className="card" aria-label="Chamados de troca">
      <h2 className="card-title flex items-center gap-2"><BellRing size={18} className="text-brand-fg" /> Chamados Salão → Material</h2>
      <p className="card-hint mb-4">O Salão informa a sessão, a denominação a retirar e as mesas reais abertas; a base do cálculo fica registrada no chamado.</p>

      {canRequest && (
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Troca</label>
            <div className="w-40" aria-label="Tipo de troca">
              <CustomSelect options={Object.entries(TYPE).map(([value, label]) => ({ value, label }))} value={form.type} onChange={(v) => setForm((f) => ({ ...f, type: v }))} />
            </div>
          </div>
          <div>
            <label className="label">Ficha a retirar</label>
            <div className="w-40" aria-label="Ficha a retirar">
              <CustomSelect options={chips.map((c) => ({ value: c._id, label: fmt(c.value) }))} value={form.chipId} onChange={(v) => setForm((f) => ({ ...f, chipId: v }))} placeholder="Ficha…" />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="cr-tables">Mesas abertas</label>
            <input id="cr-tables" aria-label="Mesas abertas" type="number" min="1" value={form.tables} onChange={(e) => setForm((f) => ({ ...f, tables: e.target.value }))} className={`${inputCls} w-28`} />
          </div>
          <input aria-label="Observação do chamado" value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Observação (opcional)" className={`${inputCls} min-w-[200px] flex-1`} />
          <button onClick={request} className="btn btn-primary">Solicitar</button>
        </div>
      )}

      {open.length === 0 ? <p className="text-sm italic text-fg-subtle">Nenhum chamado em aberto.</p> : (
        <ul className="space-y-3">
          {open.map((r) => (
            <li key={r._id} className={`rounded-xl border p-4 ${linkedId === r._id ? 'border-brand' : 'border-line'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-fg">{TYPE[r.type]} · ficha {fmt(r.chip_id?.value)} · {fmt(r.tables)} mesa(s)</span>
                <span className={`badge ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                {r.session_id?.name && <span className="text-xs text-fg-subtle">{r.session_id.name}</span>}
                <span className="ml-auto text-xs text-fg-subtle">{new Date(r.createdAt).toLocaleString(locale())} · {r.requested_by}</span>
              </div>
              <p className="mt-1 text-xs text-fg-muted">
                Base ({r.snapshot?.session_name || 'torneio'}): {fmt(r.snapshot?.active_players)} jogando · {fmt(r.snapshot?.in_play_quantity)} fichas de {fmt(r.chip_id?.value)} em jogo
                {r.estimate?.players_per_table ? ` · ~${fmt(r.estimate.players_per_table)} jogadores por mesa` : ''}
                {r.snapshot?.provisional ? ' · provisório (registro aberto)' : ''}
              </p>
              {r.estimate?.per_table?.length > 0 && (
                <p className="text-xs text-fg-subtle">Por mesa: {r.estimate.per_table.map((p) => `${fmt(p.value)} × ${fmt(p.per_table)}`).join(' · ')} (arredondado para cima)</p>
              )}
              {r.note && <p className="text-xs text-fg-muted">“{r.note}”</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {canServe && r.status === 'requested' && <button onClick={() => step(r, 'in_preparation')} className="btn btn-info btn-sm"><Hammer size={14} /> Iniciar preparo</button>}
                {canServe && r.status === 'in_preparation' && <button onClick={() => step(r, 'ready')} className="btn btn-success btn-sm"><PackageCheck size={14} /> Marcar pronto</button>}
                {canServe && r.status !== 'requested' && (
                  <button onClick={() => onLink?.(linkedId === r._id ? null : r)} className="btn btn-secondary btn-sm"><Check size={14} /> {linkedId === r._id ? 'Não usar este chamado na troca' : 'Registrar a troca deste chamado'}</button>
                )}
                {(canRequest || canServe) && <button onClick={() => cancel(r)} className="btn btn-danger btn-sm"><X size={14} /> Cancelar chamado</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <p className="mt-4 text-xs text-fg-subtle">Recentes: {past.map((r) => `${TYPE[r.type]} ${fmt(r.chip_id?.value)} (${STATUS[r.status].label.toLowerCase()})`).join(' · ')}</p>
      )}
    </section>
  );
}
