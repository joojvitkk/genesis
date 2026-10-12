import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost } from '../lib/api';
import { useModalDismiss } from '../hooks/useModalDismiss';

/**
 * Escolhe o(s) fichário(s) que o torneio vai usar (Simulação 2.1 §5). Só o fichário: sem reserva por denominação ou
 * quantidade e sem bloquear o fichário — o mesmo pode atender outros torneios. As quantidades reais vêm das movimentações.
 */
export default function AllocationModal({ tournament, linkedIds = [], onClose, onDone }) {
  const { showAlert } = useAlert();
  const [binders, setBinders] = useState([]);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  useModalDismiss(true, onClose);

  const linkedKey = linkedIds.join(',');
  useEffect(() => {
    apiGet('/binders').then((rows) => setBinders(rows.filter((b) => !linkedKey.split(',').includes(b._id) && b.status !== 'maintenance'))).catch(() => {});
  }, [linkedKey]);

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const save = async () => {
    if (!picked.length) return showAlert('Escolha ao menos um fichário.', 'error');
    setBusy(true);
    try {
      await apiPost(`/tournaments/${tournament._id}/allocations`, { binder_ids: picked });
      showAlert('Fichário vinculado ao torneio.', 'success');
      onDone();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao vincular fichário', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Vincular fichário" onClick={onClose}>
      <div className="card max-h-[92vh] w-full max-w-lg space-y-4 overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold">Fichário do torneio · {tournament.name}</h3>
          <button type="button" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        <p className="text-sm text-fg-muted">Escolha qual fichário será usado. Nenhuma quantidade é reservada: o fichário continua livre para outros torneios.</p>
        {binders.length === 0 ? <p className="py-4 text-center text-sm italic text-fg-subtle">Nenhum fichário disponível.</p> : (
          <ul className="divide-y divide-line-soft">
            {binders.map((b) => (
              <li key={b._id}>
                <label className="flex cursor-pointer items-center gap-3 py-3">
                  <input type="checkbox" checked={picked.includes(b._id)} onChange={() => toggle(b._id)} />
                  <span className="flex-1 font-semibold text-fg">{b.name}{b.code ? <span className="ml-2 font-mono text-xs text-fg-muted">{b.code}</span> : null}</span>
                  <span className="text-xs text-fg-muted">{(b.chips || []).reduce((a, c) => a + c.quantity, 0).toLocaleString()} fichas</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancelar</button>
          <button type="button" onClick={save} disabled={busy || !picked.length} className="btn btn-primary">Vincular</button>
        </div>
      </div>
    </div>
  );
}
