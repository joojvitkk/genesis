import { locale } from '../lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { Send, Undo2, ClipboardCheck, Lock } from 'lucide-react';
import { apiGet, apiPost } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import { socket } from '../lib/socket';

const fmt = (n) => (n ?? 0).toLocaleString(locale());
const LOG_LABEL = { SEND: 'Envio', RETURN: 'Retorno', CONFERENCE: 'Conferência', CLOSE: 'Fechamento' };

/**
 * Fichas KO do torneio (Simulação 3.0 §5) — estoque FÍSICO, sem financeiro. Uma ficha por ação válida (buy-ins + reentradas);
 * as fichas passam entre jogadores sem baixa a cada eliminação e não entram no Chip Count. No fechamento compara distribuídas ×
 * devolvidas: a diferença fica PENDENTE com justificativa (não é perda) e devoluções posteriores valem até o fechamento da etapa.
 */
export default function KoPanel({ tournamentId, canOperate, refreshKey }) {
  const { showAlert, showConfirm } = useAlert();
  const [ko, setKo] = useState(null);
  const [qty, setQty] = useState({ send: '', return: '' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setKo(await apiGet(`/tournaments/${tournamentId}/ko`)); } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar as fichas KO', 'error'); }
  }, [tournamentId, showAlert]);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    const on = (p) => { if (!p?.tournament_id || String(p.tournament_id) === String(tournamentId)) load(); };
    socket.on('koChanged', on);
    return () => socket.off('koChanged', on);
  }, [tournamentId, load]);

  const act = async (path, body, ok) => {
    setBusy(true);
    try { setKo(await apiPost(`/tournaments/${tournamentId}/ko/${path}`, body)); showAlert(ok, 'success'); return true; } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro', 'error'); return false; } finally { setBusy(false); }
  };

  if (!ko?.is_ko) return null;
  const open = !ko.closed && canOperate;
  const stock = ko.ko_chip?.stock;

  return (
    <section data-testid="ko-panel" className="card p-6">
      <h3 className="mb-1 flex items-center gap-2 text-lg font-bold">
        <span className="h-3 w-3 rounded-full border border-line" style={{ backgroundColor: ko.ko_chip?.color }} /> Fichas KO · {ko.ko_chip?.name}
        {ko.closed && <span className="badge badge-neutral"><Lock size={12} /> Etapa fechada</span>}
      </h3>
      <p className="mb-4 text-xs text-fg-muted">
        Estoque físico, sem pagamentos. Uma ficha por ação válida (buy-ins + reentradas); as fichas passam entre jogadores sem baixa a cada eliminação e não entram no Chip Count.
        Estoque da ficha: {fmt(stock?.available)} disponíveis de {fmt(stock?.quantity)}.
      </p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[['Distribuídas (ações válidas)', ko.distributed], ['Enviadas ao torneio', ko.sent], ['Devolvidas', ko.returned], ['Pendentes', ko.pending]].map(([label, v]) => (
          <div key={label} className="rounded-xl bg-sunken p-3">
            <p className="text-xs font-semibold uppercase text-fg-subtle">{label}</p>
            <p className={`text-2xl font-bold tabular-nums ${label === 'Pendentes' && v > 0 ? 'text-warn' : 'text-fg'}`}>{fmt(v)}</p>
          </div>
        ))}
      </div>
      {ko.surplus > 0 && <p className="mt-2 text-xs text-warn">Devolvidas a mais que as distribuídas: {fmt(ko.surplus)}.</p>}

      {open && (
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="ko-send">Enviar ao torneio</label>
            <div className="flex gap-2">
              <input id="ko-send" type="number" min="1" step="1" value={qty.send} onChange={(e) => setQty({ ...qty, send: e.target.value })} placeholder={`Sugestão: ${fmt(Math.max(0, ko.distributed - ko.sent))}`} className="input w-full" />
              <button disabled={busy || !Number(qty.send)} onClick={async () => { if (await act('send', { quantity: Number(qty.send) }, 'Fichas KO enviadas.')) setQty((q) => ({ ...q, send: '' })); }} className="btn btn-success"><Send size={14} /> Enviar</button>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="ko-return">Devolução ao estoque</label>
            <div className="flex gap-2">
              <input id="ko-return" type="number" min="1" step="1" value={qty.return} onChange={(e) => setQty({ ...qty, return: e.target.value })} placeholder={`Pendentes: ${fmt(ko.pending)}`} className="input w-full" />
              <button disabled={busy || !Number(qty.return)} onClick={async () => { if (await act('return', { quantity: Number(qty.return) }, 'Devolução registrada.')) setQty((q) => ({ ...q, return: '' })); }} className="btn btn-info"><Undo2 size={14} /> Devolver</button>
            </div>
          </div>
          <div className="md:col-span-2">
            <label className="label" htmlFor="ko-reason">Conferência{ko.pending > 0 ? ` — ${fmt(ko.pending)} pendente(s): informe o motivo` : ''}</label>
            <div className="flex flex-col gap-2 md:flex-row">
              <input id="ko-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Justificativa da diferença (ex.: 1 ficha com jogador eliminado)" className="input flex-1" />
              <button disabled={busy || (ko.pending > 0 && !reason.trim())} onClick={async () => { if (await act('conference', { reason: reason.trim() }, 'Conferência registrada.')) setReason(''); }} className="btn btn-secondary"><ClipboardCheck size={14} /> Registrar conferência</button>
              <button disabled={busy} onClick={async () => { if (await showConfirm('Fechar a etapa das fichas KO? Depois disso não há mais devoluções.')) act('close', {}, 'Etapa KO fechada.'); }} className="btn btn-neutral"><Lock size={14} /> Fechar etapa</button>
            </div>
          </div>
        </div>
      )}

      {ko.log?.length > 0 && (
        <ul className="mt-5 divide-y divide-line-soft text-xs">
          {ko.log.map((m) => (
            <li key={m._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-bold text-fg">
                {LOG_LABEL[m.type] || m.type}
                {m.quantity ? ` · ${fmt(m.quantity)}` : ''}
                {m.type === 'CONFERENCE' || m.type === 'CLOSE' ? ` · distribuídas ${fmt(m.distributed)} × devolvidas ${fmt(m.returned)} · pendentes ${fmt(m.pending)}` : ''}
                {m.note ? <span className="ml-2 font-normal italic text-fg-subtle">{m.note}</span> : null}
              </span>
              <span className="text-fg-subtle">{new Date(m.createdAt).toLocaleString(locale())} · {m.user_name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
