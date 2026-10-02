import { useState, useEffect, useMemo } from 'react';
import { Boxes, Plus, Trash2, Edit2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import CustomSelect from '../components/CustomSelect';

const EMPTY_FORM = { name: '', notes: '', rows: [{ chip_id: '', quantity: '' }] };
const chipId = (l) => l.chip_id?._id || l.chip_id;

// Modelo de Fichário = nome + composição (quais fichas JÁ CADASTRADAS e quantas de cada).
// A mesma ficha é reutilizada em vários modelos, cada um com sua quantidade.
export default function ModelosFicharios() {
  const { showAlert, showConfirm } = useAlert();
  const isAdmin = getStoredUser()?.role === 'admin';
  const [models, setModels] = useState([]);
  const [chips, setChips] = useState([]);
  const [binders, setBinders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const fetchData = async () => {
    try {
      const [m, c, b] = await Promise.all([apiGet('/binder-models'), apiGet('/chips'), apiGet('/binders')]);
      setModels(m);
      setChips(c);
      setBinders(b);
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar modelos de fichário', 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchData(); }, []);

  const chipById = useMemo(() => new Map(chips.map((c) => [c._id, c])), [chips]);
  const bindersByModel = useMemo(() => {
    const map = {};
    binders.forEach((b) => { const id = b.model_id?._id || b.model_id; if (id) map[id] = (map[id] || 0) + 1; });
    return map;
  }, [binders]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setIsModalOpen(true); };
  const openEdit = (m) => {
    setEditing(m);
    setForm({
      name: m.name, notes: m.notes || '',
      rows: m.composition.map((l) => ({ chip_id: chipId(l), quantity: l.quantity })),
    });
    setIsModalOpen(true);
  };

  const updateRow = (i, field, value) => setForm((f) => ({ ...f, rows: f.rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)) }));
  const addRow = () => setForm((f) => ({ ...f, rows: [...f.rows, { chip_id: '', quantity: '' }] }));
  const removeRow = (i) => setForm((f) => ({ ...f, rows: f.rows.filter((_, idx) => idx !== i) }));

  // fichas ativas, ou inativas que já estavam neste modelo
  const optionsFor = (rowIndex) => {
    const taken = new Set(form.rows.filter((_, i) => i !== rowIndex).map((r) => r.chip_id));
    const original = new Set((editing?.composition || []).map(chipId));
    return chips
      .filter((c) => (c.active !== false || original.has(c._id)) && !taken.has(c._id))
      .map((c) => ({ value: c._id, label: `${c.name} · ${c.color || 's/ cor'}${c.active === false ? ' (inativa)' : ''}` }));
  };

  const totals = (rows) => rows.reduce((acc, r) => {
    const q = Number(r.quantity) || 0;
    const chip = chipById.get(r.chip_id);
    return { count: acc.count + q, value: acc.value + q * (chip?.value || 0) };
  }, { count: 0, value: 0 });

  const handleSave = async (e) => {
    e.preventDefault();
    const rows = form.rows.filter((r) => r.chip_id || r.quantity);
    if (!form.name.trim()) return showAlert('Informe o nome do modelo.', 'error');
    if (rows.length === 0) return showAlert('Adicione ao menos uma ficha ao modelo.', 'error');
    if (rows.some((r) => !r.chip_id || !(Number(r.quantity) >= 1) || !Number.isInteger(Number(r.quantity)))) {
      return showAlert('Cada linha precisa de uma ficha e de uma quantidade inteira maior que zero.', 'error');
    }
    const payload = {
      name: form.name.trim(), notes: form.notes,
      composition: rows.map((r) => ({ chip_id: r.chip_id, quantity: Number(r.quantity) })),
    };
    try {
      if (editing) await apiPut(`/binder-models/${editing._id}`, payload);
      else await apiPost('/binder-models', payload);
      showAlert(editing ? 'Modelo atualizado!' : 'Modelo de fichário criado!', 'success');
      setIsModalOpen(false);
      await fetchData();
    } catch (err) {
      if (err.status !== 401) showAlert(err.message || 'Erro ao salvar modelo', 'error');
    }
  };

  const handleDelete = async (m) => {
    if (!(await showConfirm(`Excluir o modelo "${m.name}"?`))) return;
    try {
      await apiDelete(`/binder-models/${m._id}`);
      showAlert('Modelo excluído', 'success');
      await fetchData();
    } catch (err) {
      if (err.status !== 401) showAlert(err.message || 'Erro ao excluir modelo', 'error');
    }
  };

  const activeChips = chips.filter((c) => c.active !== false);
  const formTotals = totals(form.rows);
  const inputCls = 'w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white';

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold mb-1 text-gray-900 dark:text-white">Modelos de Fichário</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Definem <b>quanto de cada ficha</b> compõe um fichário. O modelo é o próprio fichário: ao cadastrá-lo ele já nasce montado com essa composição.
          </p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="w-full md:w-auto px-6 py-3 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 transition-all flex justify-center items-center gap-2 shadow-lg shadow-red-500/20">
            <Plus size={18} /> Novo Modelo
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 animate-pulse">Carregando modelos...</div>
      ) : models.length === 0 ? (
        <div className="p-12 text-center border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-3xl text-gray-400">
          Nenhum modelo de fichário cadastrado.{isAdmin && activeChips.length === 0 ? ' Cadastre as fichas primeiro em Fichas.' : ''}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {models.map((m) => {
            const total = totals(m.composition.map((l) => ({ chip_id: chipId(l), quantity: l.quantity })));
            const value = m.composition.reduce((a, l) => a + l.quantity * (l.chip_id?.value || 0), 0);
            const used = bindersByModel[m._id] || 0;
            return (
              <motion.div key={m._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-lg overflow-hidden flex flex-col">
                <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-start bg-gray-50 dark:bg-[#111111]">
                  <div className="min-w-0 mr-3">
                    <h3 className="font-bold text-xl text-gray-900 dark:text-white flex items-center gap-2 mb-1">
                      <Boxes className="text-genesis-red shrink-0" size={20} />
                      <span className="truncate">{m.name}</span>
                    </h3>
                    <p className="text-xs text-gray-500">{used > 0 ? 'Fichário montado' : 'Ainda sem fichário montado'}</p>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => openEdit(m)} title="Editar" className="p-2 text-gray-400 hover:text-blue-500 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg transition-colors shadow-sm"><Edit2 size={16} /></button>
                      <button onClick={() => handleDelete(m)} title="Excluir" className="p-2 text-gray-400 hover:text-red-500 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg transition-colors shadow-sm"><Trash2 size={16} /></button>
                    </div>
                  )}
                </div>
                <div className="p-6 flex-1 flex flex-col justify-between">
                  <ul className="space-y-3 mb-6">
                    {m.composition.map((l) => (
                      <li key={chipId(l)} className="flex justify-between items-center text-sm font-medium">
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 rounded-full border border-gray-200 dark:border-zinc-700 shadow-sm" style={{ backgroundColor: l.chip_id?.color || 'transparent' }} />
                          <span className="text-gray-700 dark:text-gray-300">{l.chip_id?.name || 'Ficha removida'}</span>
                        </div>
                        <span className="font-bold text-gray-900 dark:text-white">{l.quantity.toLocaleString()} un.</span>
                      </li>
                    ))}
                  </ul>
                  <div className="pt-4 border-t border-gray-100 dark:border-zinc-800/50 flex justify-between items-center">
                    <div>
                      <p className="text-xs text-gray-500">Total de fichas</p>
                      <p className="font-black text-gray-900 dark:text-white text-lg">{total.count.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Valor nominal</p>
                      <p className="font-black text-emerald-600 dark:text-emerald-500 text-lg">{value.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
            onClick={() => setIsModalOpen(false)}
          >
            <div className="min-h-full flex items-center justify-center">
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }} transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl w-full max-w-xl shadow-2xl flex flex-col relative my-8"
              >
                <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50 dark:bg-[#111111] rounded-t-3xl">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Boxes className="text-genesis-red" size={20} />
                    {editing ? 'Editar Modelo' : 'Novo Modelo de Fichário'}
                  </h2>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-genesis-red transition-colors"><X size={24} /></button>
                </div>

                <form onSubmit={handleSave}>
                  <div className="p-6 space-y-6">
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Nome do modelo</label>
                      <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} required placeholder="Ex: LISA" />
                    </div>

                    <div>
                      <div className="flex justify-between items-center mb-3">
                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Composição</label>
                        <button type="button" onClick={addRow} className="text-sm font-bold text-genesis-red hover:text-red-700 flex items-center gap-1 transition-colors">
                          <Plus size={14} /> Adicionar ficha
                        </button>
                      </div>
                      {activeChips.length === 0 && (
                        <p className="mb-3 text-sm text-amber-600">Nenhuma ficha ativa cadastrada. Cadastre as fichas em Fichas.</p>
                      )}
                      <div className="space-y-3">
                        {form.rows.map((row, i) => (
                          <div key={i} className="grid grid-cols-[1fr_110px_auto] items-center gap-2 bg-gray-50 dark:bg-[#111111] p-3 rounded-xl border border-gray-200 dark:border-zinc-700/50">
                            <CustomSelect options={optionsFor(i)} value={row.chip_id} onChange={(v) => updateRow(i, 'chip_id', v)} placeholder="Selecione a ficha..." />
                            <input
                              type="number" min="1" step="1" placeholder="Qtd" value={row.quantity}
                              onChange={(e) => updateRow(i, 'quantity', e.target.value)}
                              className="w-full bg-white dark:bg-[#141414] border border-gray-300 dark:border-zinc-700 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-genesis-red text-gray-900 dark:text-white text-center"
                            />
                            <button type="button" onClick={() => removeRow(i)} className="p-2 text-gray-400 hover:text-red-500 transition-colors"><Trash2 size={16} /></button>
                          </div>
                        ))}
                      </div>
                      <p className="mt-3 text-xs text-gray-500">
                        Total: <b>{formTotals.count.toLocaleString()}</b> fichas · valor nominal <b>{formTotals.value.toLocaleString()}</b>
                      </p>
                      {editing && (bindersByModel[editing._id] || 0) > 0 && (
                        <p className="mt-2 text-xs text-amber-600">Alterar o modelo não altera os {bindersByModel[editing._id]} fichário(s) já criados a partir dele.</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Observações (opcional)</label>
                      <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
                    </div>
                  </div>
                  <div className="p-6 border-t border-gray-100 dark:border-zinc-800/50 bg-gray-50 dark:bg-[#111111] rounded-b-3xl">
                    <button type="submit" className="w-full py-4 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 active:scale-95 transition-all shadow-lg">
                      Salvar Modelo
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
