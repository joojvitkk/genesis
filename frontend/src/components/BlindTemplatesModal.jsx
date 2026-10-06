import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Trash2, Save, Check } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import { useModalDismiss } from '../hooks/useModalDismiss';

/**
 * Gerencia templates de estrutura de blinds.
 * currentRows: a estrutura atual do torneio (para "salvar como template")
 * onApply(rows): aplica um template na estrutura do torneio
 */
export default function BlindTemplatesModal({ open, onClose, currentRows = [], onApply }) {
  const { showAlert, showConfirm } = useAlert();
  const [list, setList] = useState([]);
  const [newName, setNewName] = useState('');

  useModalDismiss(open, onClose);

  const load = async () => { try { setList(await apiGet('/blind-templates')); } catch { /* */ } };
  useEffect(() => { if (open) load(); }, [open]);

  const saveCurrent = async () => {
    if (!newName.trim()) return showAlert('Dê um nome ao template.', 'error');
    if (!currentRows.length) return showAlert('A estrutura atual está vazia.', 'error');
    try {
      await apiPost('/blind-templates', { name: newName.trim(), rows: currentRows });
      showAlert('Template salvo!', 'success');
      setNewName('');
      load();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao salvar', 'error');
    }
  };

  const remove = async (id) => {
    if (!(await showConfirm('Remover este template?'))) return;
    try { await apiDelete(`/blind-templates/${id}`); load(); }
    catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro', 'error'); }
  };

  const apply = async (tpl) => {
    if (currentRows.length && !(await showConfirm('Isto substitui a estrutura de blinds atual. Continuar?'))) return;
    onApply(tpl.rows);
    showAlert(`Template "${tpl.name}" aplicado.`, 'success');
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} onClick={onClose} className="absolute inset-0 bg-[var(--overlay)]" />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="card relative w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line-soft p-6">
          <h2 className="text-xl font-bold text-fg">Templates de blinds</h2>
          <button type="button" onClick={onClose} className="text-fg-subtle hover:text-gray-600"><X /></button>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto p-6">
          {list.length === 0 && <p className="text-sm text-fg-subtle">Nenhum template ainda.</p>}
          {list.map((t) => (
            <div key={t._id} className="flex items-center justify-between rounded-2xl border border-line p-4">
              <div>
                <p className="font-bold text-fg">{t.name}</p>
                <p className="text-xs text-fg-subtle">{t.rows.length} linha(s) · {t.rows.filter((r) => !r.row_type || r.row_type === 'level').length} níveis</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => apply(t)} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"><Check size={14} /> Aplicar</button>
                <button onClick={() => remove(t._id)} className="rounded-lg p-2 text-fg-subtle hover:text-red-500"><Trash2 size={15} /></button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 border-t border-line-soft p-4">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Salvar estrutura atual como…"
            className="input flex-1"
          />
          <button onClick={saveCurrent} className="btn btn-primary flex items-center"><Save size={14} /> Salvar</button>
        </div>
      </motion.div>
    </div>
  );
}
