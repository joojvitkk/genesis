import React, { useState, useEffect, useRef } from 'react';
import { Briefcase, Plus, Trash2, Edit2, X, AlertCircle, ChevronDown, PackagePlus, Link2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import CustomSelect from '../components/CustomSelect';

export default function Ficharios() {
  const { showAlert, showConfirm } = useAlert();
  const [cases, setCases] = useState([]);
  const [availableChips, setAvailableChips] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState(null);
  // form.chips: [{ chip_id, quantity, give_entry }]
  const [form, setForm] = useState({ name: '', chips: [] });

  // Multi-allocation modal state
  const [isAllocModalOpen, setIsAllocModalOpen] = useState(false);
  const [allocatingCase, setAllocatingCase] = useState(null);

  const fetchInitialData = async () => {
    try {
      const [casesData, chipsData] = await Promise.all([apiGet('/cases'), apiGet('/chips')]);
      setCases(casesData);
      setAvailableChips(chipsData);
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar fichários', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInitialData(); }, []);

  // ── SAVE CASE ────────────────────────────────────────────────
  const handleSaveCase = async (e) => {
    e.preventDefault();
    const cleanChips = form.chips
      .filter(c => c.chip_id && Number(c.quantity) > 0)
      .map(c => ({ chip_id: c.chip_id, quantity: parseInt(c.quantity, 10) }));

    if (!form.name.trim()) return showAlert('Informe o nome do fichário.', 'error');

    try {
      if (editingCase) await apiPut(`/cases/${editingCase._id}`, { name: form.name.trim(), chips: cleanChips });
      else await apiPost('/cases', { name: form.name.trim(), chips: cleanChips });

      // ── Auto entry: give_entry rows ──────────────────────────
      const entryRows = form.chips.filter(c => c.chip_id && Number(c.quantity) > 0 && c.give_entry);
      if (entryRows.length > 0) {
        await Promise.all(entryRows.map(row =>
          apiPost('/inventory/update', { chip_id: row.chip_id, quantity_change: parseInt(row.quantity, 10) })
        ));
        showAlert(`Fichário salvo e entrada de estoque registrada para ${entryRows.length} modelo(s)!`, 'success');
      } else {
        showAlert('Fichário salvo com sucesso!', 'success');
      }

      setIsModalOpen(false);
      await fetchInitialData();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao salvar fichário', 'error');
    }
  };

  const handleDeleteCase = async (id) => {
    const confirmed = await showConfirm('Tem certeza que deseja excluir este fichário?');
    if (!confirmed) return;
    try {
      await apiDelete(`/cases/${id}`);
      showAlert('Fichário excluído', 'success');
      await fetchInitialData();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao excluir fichário', 'error');
    }
  };

  const openCreateModal = () => {
    setEditingCase(null);
    setForm({ name: '', chips: [{ chip_id: '', quantity: '', give_entry: false }] });
    setIsModalOpen(true);
  };

  const openEditModal = (c) => {
    setEditingCase(c);
    const mappedChips = c.chips.map(item => ({
      chip_id: item.chip_id ? item.chip_id._id : '',
      quantity: item.quantity,
      give_entry: false   // never pre-check on edit to avoid duplicate entries
    }));
    setForm({ name: c.name, chips: mappedChips.length ? mappedChips : [{ chip_id: '', quantity: '', give_entry: false }] });
    setIsModalOpen(true);
  };

  const addChipRow = () => setForm({ ...form, chips: [...form.chips, { chip_id: '', quantity: '', give_entry: false }] });

  const updateChipRow = (index, field, value) => {
    const newChips = [...form.chips];
    newChips[index][field] = value;
    setForm({ ...form, chips: newChips });
  };

  const removeChipRow = (index) => setForm({ ...form, chips: form.chips.filter((_, i) => i !== index) });

  // ── Stock warnings ───────────────────────────────────────────
  const getStockWarnings = () => {
    const warnings = [];
    form.chips.forEach(row => {
      if (row.chip_id && row.quantity) {
        const chip = availableChips.find(c => c._id === row.chip_id);
        if (chip) {
          let previouslyAllocated = 0;
          if (editingCase) {
            const oldRow = editingCase.chips.find(c => c.chip_id && c.chip_id._id === row.chip_id);
            if (oldRow) previouslyAllocated = oldRow.quantity;
          }
          // If give_entry is checked we're adding stock, so no warning needed
          if (row.give_entry) return;
          const realAvailable = chip.available_quantity + previouslyAllocated;
          const diff = realAvailable - parseInt(row.quantity);
          if (diff < 0) warnings.push({ name: chip.name, negative: Math.abs(diff) });
        }
      }
    });
    return warnings;
  };

  const warnings = getStockWarnings();

  // ── Allocations label ────────────────────────────────────────
  const getAllocLabel = (c) => {
    const allocs = c.allocations || [];
    if (allocs.length === 0) {
      // fall back to legacy field
      if (c.status === 'allocated') return `Em Uso: ${c.allocated_to_tournament_name}`;
      return null;
    }
    if (allocs.length === 1) return `Em Uso: ${allocs[0].tournament_name}`;
    return `Compartilhado (${allocs.length} torneios)`;
  };

  const getStatusBadge = (c) => {
    const allocs = c.allocations || [];
    if (c.status === 'maintenance') return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-500">Manutenção</span>;
    if (allocs.length >= 2) return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-500">Compartilhado ({allocs.length})</span>;
    if (allocs.length === 1 || c.status === 'allocated') {
      const name = allocs[0]?.tournament_name || c.allocated_to_tournament_name;
      return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 truncate max-w-[150px]" title={name}>Em Uso: {name}</span>;
    }
    return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500">Disponível</span>;
  };

  // animations
  const containerAnim = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
  const cardAnim = { hidden: { opacity: 0, scale: 0.95, y: 20 }, show: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } } };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold mb-1 text-gray-900 dark:text-white">Fichários e Maletas</h1>
          <p className="text-gray-500 dark:text-gray-400">Gerencie a alocação de maletas e o conteúdo de cada kit.</p>
        </div>
        <button onClick={openCreateModal} className="w-full md:w-auto px-6 py-3 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 transition-all flex justify-center items-center gap-2 shadow-lg shadow-red-500/20">
          <Plus size={18} /> Novo Fichário
        </button>
      </motion.div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 animate-pulse">Carregando fichários...</div>
      ) : cases.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-12 text-center border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-3xl text-gray-400">
          Nenhum fichário cadastrado no sistema.
        </motion.div>
      ) : (
        <motion.div variants={containerAnim} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cases.map((c) => {
            const totalChips = c.chips.reduce((acc, curr) => acc + (curr.quantity || 0), 0);
            const totalValue = c.chips.reduce((acc, curr) => acc + ((curr.quantity || 0) * (curr.chip_id ? curr.chip_id.value : 0)), 0);
            const allocs = c.allocations || [];

            return (
              <motion.div key={c._id} variants={cardAnim} className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-lg hover:shadow-xl transition-all overflow-hidden flex flex-col">
                <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-start bg-gray-50 dark:bg-[#111111]">
                  <div className="min-w-0 flex-1 mr-3">
                    <h3 className="font-bold text-xl text-gray-900 dark:text-white flex items-center gap-2 mb-2">
                      <Briefcase className="text-genesis-red shrink-0" size={20} />
                      <span className="truncate">{c.name}</span>
                    </h3>
                    {getStatusBadge(c)}
                    {/* Show all allocations if shared */}
                    {allocs.length >= 2 && (
                      <div className="mt-2 space-y-1">
                        {allocs.map((al, i) => (
                          <p key={i} className="text-xs text-gray-500 flex items-center gap-1">
                            <Link2 size={10} className="text-purple-400" /> {al.tournament_name}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openEditModal(c)} className="p-2 text-gray-400 hover:text-blue-500 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg transition-colors shadow-sm"><Edit2 size={16} /></button>
                    {c.status !== 'allocated' && allocs.length === 0 && (
                      <button onClick={() => handleDeleteCase(c._id)} className="p-2 text-gray-400 hover:text-red-500 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg transition-colors shadow-sm"><Trash2 size={16} /></button>
                    )}
                  </div>
                </div>

                <div className="p-6 flex-1 flex flex-col justify-between">
                  <div>
                    <p className="text-xs uppercase font-bold tracking-widest text-gray-400 mb-4 border-b border-gray-100 dark:border-zinc-800/50 pb-2">Conteúdo do Fichário</p>
                    {c.chips.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">Fichário vazio.</p>
                    ) : (
                      <ul className="space-y-3 mb-6">
                        {c.chips.map((item, idx) => item.chip_id && (
                          <li key={idx} className="flex justify-between items-center text-sm font-medium">
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border border-gray-200 dark:border-zinc-700 shadow-sm" style={{ backgroundColor: item.chip_id.color || 'transparent' }}></div>
                              <span className="text-gray-700 dark:text-gray-300">{item.chip_id.name}</span>
                            </div>
                            <span className="font-bold text-gray-900 dark:text-white">{item.quantity.toLocaleString()} un.</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="pt-4 border-t border-gray-100 dark:border-zinc-800/50 flex justify-between items-center">
                    <div>
                      <p className="text-xs text-gray-500">Total Fichas</p>
                      <p className="font-black text-gray-900 dark:text-white text-lg">{totalChips.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Valor em Jogo (MGS)</p>
                      <p className="font-black text-emerald-600 dark:text-emerald-500 text-lg">{totalValue.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ── Modal Criar/Editar ──────────────────────────────────── */}
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
                {/* Header */}
                <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50 dark:bg-[#111111] shrink-0 rounded-t-3xl">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Briefcase className="text-genesis-red" size={20} />
                    {editingCase ? 'Editar Fichário' : 'Novo Fichário'}
                  </h2>
                  <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-genesis-red transition-colors"><X size={24} /></button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Nome da Maleta/Fichário</label>
                    <input
                      type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                      className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white"
                      required placeholder="Ex: Maleta Poker Stars A"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Conteúdo do Fichário</label>
                      <button type="button" onClick={addChipRow} className="text-sm font-bold text-genesis-red hover:text-red-700 flex items-center gap-1 transition-colors">
                        <Plus size={14} /> Adicionar Modelo
                      </button>
                    </div>

                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_80px_auto_auto] gap-2 px-3 mb-1">
                      <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest">Ficha</p>
                      <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest text-center">Qtd</p>
                      <p className="text-[10px] uppercase font-bold text-gray-400 tracking-widest text-center flex items-center gap-1">
                        <PackagePlus size={10} /> Entrada
                      </p>
                      <p></p>
                    </div>

                    <div className="space-y-3">
                      {form.chips.map((row, index) => (
                        <div key={index} className="grid grid-cols-[1fr_80px_auto_auto] items-center gap-2 bg-gray-50 dark:bg-[#111111] p-3 rounded-xl border border-gray-200 dark:border-zinc-700/50">
                          <CustomSelect
                            options={availableChips.map(c => ({ value: c._id, label: `${c.name} (Disp: ${c.available_quantity})` }))}
                            value={row.chip_id}
                            onChange={(val) => updateChipRow(index, 'chip_id', val)}
                            placeholder="Selecione a ficha..."
                          />
                          <input
                            type="number" min="1" placeholder="Qtd" value={row.quantity}
                            onChange={(e) => updateChipRow(index, 'quantity', e.target.value)}
                            className="w-full bg-white dark:bg-[#141414] border border-gray-300 dark:border-zinc-700 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-genesis-red text-gray-900 dark:text-white text-center"
                          />
                          {/* Give-entry toggle */}
                          <button
                            type="button"
                            onClick={() => updateChipRow(index, 'give_entry', !row.give_entry)}
                            title={row.give_entry ? 'Dar entrada no estoque ao salvar' : 'Não dar entrada no estoque'}
                            className={`p-2 rounded-lg border-2 transition-all ${row.give_entry
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-gray-300 dark:border-zinc-700 text-gray-400 hover:border-emerald-400'}`}
                          >
                            <PackagePlus size={16} />
                          </button>
                          <button type="button" onClick={() => removeChipRow(index)} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))}
                      {form.chips.length === 0 && (
                        <div className="text-center p-4 border border-dashed border-gray-300 dark:border-zinc-700 rounded-xl text-gray-500 text-sm">
                          Nenhuma ficha adicionada.
                        </div>
                      )}
                    </div>

                    {/* Give-entry info */}
                    {form.chips.some(r => r.give_entry) && (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl flex gap-2 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
                        <PackagePlus size={14} className="shrink-0 mt-0.5" />
                        <span>Os modelos marcados com <b>Entrada</b> terão a quantidade adicionada automaticamente ao estoque ao salvar.</span>
                      </motion.div>
                    )}
                  </div>

                  {/* Warnings */}
                  {warnings.length > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl flex gap-3 text-red-700 dark:text-red-400 text-sm font-medium">
                      <AlertCircle className="shrink-0 mt-0.5" size={18} />
                      <div>
                        <p className="font-bold mb-1">Atenção: Estoque insuficiente!</p>
                        <ul className="list-disc pl-4 space-y-1">
                          {warnings.map((w, i) => <li key={i}>Faltam <b>{w.negative.toLocaleString()} un.</b> do modelo {w.name}.</li>)}
                        </ul>
                        <p className="mt-2 text-xs opacity-80">Você ainda pode salvar o fichário, mas o estoque físico não cobre esta configuração.</p>
                      </div>
                    </motion.div>
                  )}

                  {editingCase?.status === 'allocated' && (
                    <div className="p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl flex gap-3 text-amber-700 dark:text-amber-500 text-sm font-medium">
                      <AlertCircle className="shrink-0 mt-0.5" size={18} />
                      <p>Este fichário está atualmente alocado no torneio <b>{editingCase.allocated_to_tournament_name}</b>. Edite as quantidades com cuidado.</p>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 dark:border-zinc-800/50 bg-gray-50 dark:bg-[#111111] shrink-0 rounded-b-3xl">
                  <button onClick={handleSaveCase} className="w-full py-4 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 active:scale-95 transition-all shadow-lg">
                    Salvar Fichário
                  </button>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}