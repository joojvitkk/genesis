import React, { useState, useEffect } from 'react';
import { PackageOpen, Plus, Edit2, Trash2, ArrowRightLeft, CheckCircle2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import CustomSelect from '../components/CustomSelect';

export default function Estoque() {
  const { showAlert, showConfirm } = useAlert();
  const [chips, setChips] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [isChipModalOpen, setIsChipModalOpen] = useState(false);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [editingChip, setEditingChip] = useState(null);
  
  // Forms states
  const [chipForm, setChipForm] = useState({ name: '', value: '', color: '', total_quantity: '' });
  const [moveForm, setMoveForm] = useState({ chip_id: '', type: 'entrada', quantity: '' });

  const fetchChips = async () => {
    try {
      setChips(await apiGet('/chips'));
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar fichas', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChips();
  }, []);

  const handleSaveChip = async (e) => {
    e.preventDefault();
    const payload = {
      name: chipForm.name.trim(),
      value: Number(chipForm.value),
      color: chipForm.color,
    };
    if (!editingChip) payload.total_quantity = Number(chipForm.total_quantity);

    if (!payload.name || !Number.isFinite(payload.value) || payload.value < 0) {
      return showAlert('Preencha nome e um valor válido.', 'error');
    }

    try {
      if (editingChip) await apiPut(`/chips/${editingChip._id}`, payload);
      else await apiPost('/chips', payload);
      setIsChipModalOpen(false);
      showAlert('Ficha salva com sucesso!', 'success');
      await fetchChips();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao salvar ficha', 'error');
    }
  };

  const handleDeleteChip = async (id) => {
    const confirmed = await showConfirm('Tem certeza que deseja excluir esta ficha?');
    if (!confirmed) return;
    try {
      await apiDelete(`/chips/${id}`);
      showAlert('Ficha excluída!', 'success');
      await fetchChips();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao excluir ficha', 'error');
    }
  };

  const handleMoveStock = async (e) => {
    e.preventDefault();
    const qty = parseInt(moveForm.quantity, 10);
    if (!moveForm.chip_id) return showAlert('Selecione uma ficha.', 'error');
    if (!Number.isFinite(qty) || qty <= 0) return showAlert('Informe uma quantidade positiva.', 'error');
    const quantity_change = moveForm.type === 'entrada' ? qty : -qty;

    try {
      await apiPost('/inventory/update', { chip_id: moveForm.chip_id, quantity_change });
      setIsMoveModalOpen(false);
      setMoveForm({ chip_id: '', type: 'entrada', quantity: '' });
      showAlert(`Movimentação de ${moveForm.type} concluída!`, 'success');
      await fetchChips();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao movimentar estoque', 'error');
    }
  };

  const openEditModal = (chip) => {
    setEditingChip(chip);
    setChipForm({ name: chip.name, value: chip.value, color: chip.color || '#000000', total_quantity: chip.total_quantity });
    setIsChipModalOpen(true);
  };

  const openCreateModal = () => {
    setEditingChip(null);
    setChipForm({ name: '', value: '', color: '#ff0000', total_quantity: '' });
    setIsChipModalOpen(true);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold mb-1 text-gray-900 dark:text-white">Estoque de Fichas</h1>
          <p className="text-gray-500 dark:text-gray-400">Gerencie modelos, quantidades e movimentações em tempo real.</p>
        </div>
        
        <div className="flex gap-3 w-full md:w-auto">
          <button onClick={() => setIsMoveModalOpen(true)} className="flex-1 md:flex-none px-6 py-3 rounded-xl font-bold bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 text-gray-900 dark:text-white hover:border-genesis-red dark:hover:border-genesis-red transition-all flex justify-center items-center gap-2 shadow-sm">
            <ArrowRightLeft size={18} />
            Movimentar
          </button>
          <button onClick={openCreateModal} className="flex-1 md:flex-none px-6 py-3 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 transition-all flex justify-center items-center gap-2 shadow-lg shadow-red-500/20">
            <Plus size={18} />
            Nova Ficha
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 animate-pulse">Carregando fichas...</div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#111111] text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50">Ficha (Modelo)</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50">Valor</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50">Cor</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50 text-right">Total</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50 text-right">Disponível</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/50 text-sm md:text-base">
                <AnimatePresence>
                  {chips.map((chip) => (
                    <motion.tr 
                      key={chip._id} 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors group"
                    >
                      <td className="p-5 font-bold text-gray-900 dark:text-white flex items-center gap-3">
                        <PackageOpen size={18} className="text-genesis-red opacity-70"/> 
                        {chip.name}
                      </td>
                      <td className="p-5 font-black text-gray-700 dark:text-gray-300">{chip.value.toLocaleString()}</td>
                      <td className="p-5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full border border-gray-200 dark:border-zinc-700 shadow-sm" style={{ backgroundColor: chip.color || 'transparent' }}></div>
                          <span className="font-mono text-xs uppercase text-gray-500 dark:text-gray-400">{chip.color || 'N/A'}</span>
                        </div>
                      </td>
                      <td className="p-5 text-right font-bold text-gray-900 dark:text-white">{chip.total_quantity.toLocaleString()}</td>
                      <td className="p-5 text-right font-black text-emerald-600 dark:text-emerald-500">{chip.available_quantity.toLocaleString()}</td>
                      <td className="p-5 text-right space-x-2">
                        <button onClick={() => openEditModal(chip)} className="p-2 text-gray-400 hover:text-blue-500 bg-transparent hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"><Edit2 size={18} /></button>
                        <button onClick={() => handleDeleteChip(chip._id)} className="p-2 text-gray-400 hover:text-red-500 bg-transparent hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"><Trash2 size={18} /></button>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
                {chips.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-12 text-center text-gray-400 dark:text-gray-500 text-lg">Nenhum modelo de ficha cadastrado.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* Modal Criar/Editar Ficha */}
      <AnimatePresence>
        {isChipModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsChipModalOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50 dark:bg-[#111111]">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editingChip ? 'Editar Ficha' : 'Nova Ficha'}</h2>
                <button onClick={() => setIsChipModalOpen(false)} className="text-gray-400 hover:text-genesis-red transition-colors"><X size={24} /></button>
              </div>
              <form onSubmit={handleSaveChip} className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Nome do Modelo</label>
                  <input type="text" value={chipForm.name} onChange={e => setChipForm({...chipForm, name: e.target.value})} className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white" required placeholder="Ex: Ficha Verde" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Valor Unitário</label>
                    <input type="number" value={chipForm.value} onChange={e => setChipForm({...chipForm, value: e.target.value})} className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white" required placeholder="Ex: 25" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Cor (Hex)</label>
                    <div className="flex items-center gap-3 w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-3 py-2 focus-within:border-genesis-red focus-within:ring-1 focus-within:ring-genesis-red transition-all">
                      <input type="color" value={chipForm.color || '#ff0000'} onChange={e => setChipForm({...chipForm, color: e.target.value})} className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 p-0" />
                      <span className="text-gray-900 dark:text-white font-mono uppercase text-sm">{chipForm.color || '#ff0000'}</span>
                    </div>
                  </div>
                </div>
                {!editingChip && (
                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Quantidade Inicial</label>
                    <input type="number" value={chipForm.total_quantity} onChange={e => setChipForm({...chipForm, total_quantity: e.target.value})} className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white" required placeholder="Ex: 5000" />
                  </div>
                )}
                <button type="submit" className="w-full py-4 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 active:scale-95 transition-all shadow-lg mt-4">
                  Salvar Ficha
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Movimentar Estoque */}
      <AnimatePresence>
        {isMoveModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
            onClick={() => setIsMoveModalOpen(false)}
          >
            <div className="min-h-full flex items-center justify-center">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg shadow-2xl flex flex-col relative my-8"
              >
                <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50 dark:bg-[#111111] rounded-t-3xl">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><ArrowRightLeft className="text-genesis-red"/> Movimentar Fichas</h2>
                <button onClick={() => setIsMoveModalOpen(false)} className="text-gray-400 hover:text-genesis-red transition-colors"><X size={24} /></button>
              </div>
              <form onSubmit={handleMoveStock} className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Tipo de Movimentação</label>
                  <div className="flex gap-4">
                    <label className={`flex-1 p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-center gap-2 font-bold ${moveForm.type === 'entrada' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500' : 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-gray-400'}`}>
                      <input type="radio" name="type" value="entrada" checked={moveForm.type === 'entrada'} onChange={() => setMoveForm({...moveForm, type: 'entrada'})} className="hidden" />
                      Entrada
                    </label>
                    <label className={`flex-1 p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-center gap-2 font-bold ${moveForm.type === 'saida' ? 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-500' : 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-gray-400'}`}>
                      <input type="radio" name="type" value="saida" checked={moveForm.type === 'saida'} onChange={() => setMoveForm({...moveForm, type: 'saida'})} className="hidden" />
                      Saída
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Ficha (Modelo)</label>
                  <CustomSelect 
                    options={chips.map(c => ({ value: c._id, label: `${c.name} (Valor: ${c.value})` }))}
                    value={moveForm.chip_id}
                    onChange={(val) => setMoveForm({...moveForm, chip_id: val})}
                    placeholder="Selecione a ficha..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Quantidade (Apenas o número)</label>
                  <input type="number" min="1" value={moveForm.quantity} onChange={e => setMoveForm({...moveForm, quantity: e.target.value})} className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white" required placeholder="Ex: 1500" />
                </div>
                
              <div className="p-6 border-t border-gray-100 dark:border-zinc-800/50 bg-gray-50 dark:bg-[#111111] shrink-0 rounded-b-3xl">
                <button type="submit" className={`w-full py-4 rounded-xl font-bold text-white active:scale-95 transition-all shadow-lg ${moveForm.type === 'entrada' ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/30' : 'bg-red-500 hover:bg-red-600 shadow-red-500/30'}`}>
                  Confirmar {moveForm.type === 'entrada' ? 'Entrada' : 'Saída'}
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
