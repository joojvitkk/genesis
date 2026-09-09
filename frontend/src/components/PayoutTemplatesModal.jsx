import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Save } from 'lucide-react';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import { useModalDismiss } from '../hooks/useModalDismiss';

const emptyBracket = () => ({ min_players: 2, max_players: null, payouts: [{ place: 1, pct: 100 }] });

export default function PayoutTemplatesModal({ open, onClose, onChanged }) {
  const { showAlert } = useAlert();
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null); // { _id?, name, brackets, notes }

  useModalDismiss(open, onClose);

  const load = async () => {
    try { setList(await apiGet('/payout-templates')); } catch { /* */ }
  };
  useEffect(() => { if (open) load(); }, [open]);

  const bracketTotal = (b) => (b.payouts || []).reduce((s, p) => s + (Number(p.pct) || 0), 0);

  const save = async () => {
    if (!form.name?.trim()) return showAlert('Dê um nome ao template.', 'error');
    for (const b of form.brackets) {
      if (Math.abs(bracketTotal(b) - 100) > 0.5) return showAlert('Cada faixa precisa somar 100%.', 'error');
    }
    try {
      if (form._id) await apiPut(`/payout-templates/${form._id}`, form);
      else await apiPost('/payout-templates', form);
      showAlert('Template salvo!', 'success');
      setForm(null);
      await load();
      onChanged?.();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao salvar', 'error');
    }
  };

  const remove = async (id) => {
    try { await apiDelete(`/payout-templates/${id}`); await load(); onChanged?.(); }
    catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro', 'error'); }
  };

  const updBracket = (bi, patch) => setForm((f) => ({
    ...f, brackets: f.brackets.map((b, i) => (i === bi ? { ...b, ...patch } : b)),
  }));
  const updPayout = (bi, pi, patch) => updBracket(bi, {
    payouts: form.brackets[bi].payouts.map((p, i) => (i === pi ? { ...p, ...patch } : p)),
  });

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
          className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-[32px] border border-gray-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#111111]"
        >
          <div className="flex items-center justify-between border-b border-gray-100 p-6 dark:border-zinc-800">
            <h2 className="text-xl font-black uppercase tracking-tight text-gray-900 dark:text-white">Templates de premiação</h2>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X /></button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {!form ? (
              <>
                {list.map((t) => (
                  <div key={t._id} className="flex items-center justify-between rounded-2xl border border-gray-200 p-4 dark:border-zinc-800">
                    <div>
                      <p className="font-black text-gray-900 dark:text-white">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.brackets.length} faixa(s)</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setForm(structuredClone(t))} className="rounded-lg px-3 py-1.5 text-xs font-black uppercase text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10">Editar</button>
                      <button onClick={() => remove(t._id)} className="rounded-lg p-2 text-gray-400 hover:text-red-500"><Trash2 size={15} /></button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setForm({ name: '', brackets: [emptyBracket()], notes: '' })}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 py-4 text-xs font-black uppercase tracking-widest text-gray-400 hover:border-genesis-red hover:text-genesis-red dark:border-zinc-800"
                >
                  <Plus size={15} /> Novo template
                </button>
              </>
            ) : (
              <>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Nome do template"
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-black outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-800 dark:bg-zinc-900"
                />
                {form.brackets.map((b, bi) => (
                  <div key={bi} className="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-zinc-800">
                    <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
                      <span>De</span>
                      <input type="number" min="1" value={b.min_players} onChange={(e) => updBracket(bi, { min_players: Number(e.target.value) })} className="w-16 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-center dark:border-zinc-700 dark:bg-zinc-900" />
                      <span>até</span>
                      <input type="number" min="1" placeholder="∞" value={b.max_players ?? ''} onChange={(e) => updBracket(bi, { max_players: e.target.value === '' ? null : Number(e.target.value) })} className="w-16 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-center dark:border-zinc-700 dark:bg-zinc-900" />
                      <span>jogadores</span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-black ${Math.abs(bracketTotal(b) - 100) < 0.5 ? 'bg-emerald-500/15 text-emerald-500' : 'bg-red-500/15 text-red-500'}`}>{bracketTotal(b)}%</span>
                      {form.brackets.length > 1 && <button onClick={() => setForm((f) => ({ ...f, brackets: f.brackets.filter((_, i) => i !== bi) }))} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>}
                    </div>
                    {b.payouts.map((p, pi) => (
                      <div key={pi} className="flex items-center gap-2 text-sm">
                        <span className="w-10 font-black text-gray-400">{p.place}º</span>
                        <input type="number" min="0" step="0.5" value={p.pct} onChange={(e) => updPayout(bi, pi, { pct: Number(e.target.value) })} className="w-20 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-center font-bold dark:border-zinc-700 dark:bg-zinc-900" />
                        <span className="text-gray-400">%</span>
                        {b.payouts.length > 1 && <button onClick={() => updBracket(bi, { payouts: b.payouts.filter((_, i) => i !== pi) })} className="text-gray-300 hover:text-red-500"><X size={14} /></button>}
                      </div>
                    ))}
                    <button onClick={() => updBracket(bi, { payouts: [...b.payouts, { place: b.payouts.length + 1, pct: 0 }] })} className="text-xs font-black uppercase text-genesis-red">+ colocação</button>
                  </div>
                ))}
                <button onClick={() => setForm((f) => ({ ...f, brackets: [...f.brackets, emptyBracket()] }))} className="text-xs font-black uppercase text-gray-400 hover:text-genesis-red">+ faixa</button>
              </>
            )}
          </div>

          {form && (
            <div className="flex gap-3 border-t border-gray-100 p-4 dark:border-zinc-800">
              <button onClick={() => setForm(null)} className="flex-1 rounded-xl bg-gray-100 py-3 text-xs font-black uppercase text-gray-600 dark:bg-zinc-800 dark:text-gray-300">Voltar</button>
              <button onClick={save} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-genesis-red py-3 text-xs font-black uppercase text-white hover:bg-red-700"><Save size={14} /> Salvar</button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
