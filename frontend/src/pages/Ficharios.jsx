import React, { useState, useEffect, useRef } from 'react';
import { Briefcase, Plus, Trash2, Edit2, X, AlertCircle, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '../contexts/AlertContext';
import { BACKEND_URL } from '../App';

// ... CustomSelect definition ... //

const CustomSelect = ({ options, value, onChange, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  
  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-full flex-1" ref={containerRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center bg-white dark:bg-[#141414] border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm cursor-pointer text-gray-900 dark:text-white"
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={16} className={`transition-transform text-gray-400 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </div>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 w-full mt-1 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg shadow-xl max-h-48 overflow-y-auto"
          >
            {options.map(opt => (
              <div 
                key={opt.value} 
                onClick={() => { onChange(opt.value); setIsOpen(false); }}
                className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-zinc-800/50 cursor-pointer text-sm text-gray-900 dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-zinc-800/30 last:border-0"
              >
                {opt.label}
              </div>
            ))}
            {options.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">Nenhuma opção disponível</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function Ficharios() {
  const { showAlert, showConfirm } = useAlert();
  const [cases, setCases] = useState([]);
  const [availableChips, setAvailableChips] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState(null);
  
  const [form, setForm] = useState({ name: '', chips: [] });

  const fetchInitialData = async () => {
    try {
      const token = localStorage.getItem('genesis_token');
      const headers = { 'Authorization': `Bearer ${token}` };
      
      const [casesRes, chipsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/cases`, { headers, cache: 'no-store' }),
        fetch(`${BACKEND_URL}/api/chips`, { headers, cache: 'no-store' })
      ]);

      if (casesRes.ok && chipsRes.ok) {
        setCases(await casesRes.json());
        setAvailableChips(await chipsRes.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  const handleSaveCase = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('genesis_token');
    const method = editingCase ? 'PUT' : 'POST';
    const url = editingCase ? `${BACKEND_URL}/api/cases/${editingCase._id}` : `${BACKEND_URL}/api/cases`;
    
    const cleanChips = form.chips.filter(c => c.chip_id && c.quantity > 0).map(c => ({
      chip_id: c.chip_id,
      quantity: parseInt(c.quantity)
    }));

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name: form.name, chips: cleanChips })
      });
      if (res.ok) {
        setIsModalOpen(false);
        showAlert('Fichário salvo com sucesso!', 'success');
        await fetchInitialData();
      } else {
        showAlert('Erro ao salvar fichário', 'error');
      }
    } catch (e) {
      console.error(e);
      showAlert('Erro de conexão ao salvar', 'error');
    }
  };

  const handleDeleteCase = async (id) => {
    const confirmed = await showConfirm('Tem certeza que deseja excluir este fichário?');
    if (!confirmed) return;
    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/cases/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) await fetchInitialData();
    } catch (e) {
      console.error(e);
    }
  };

  const openCreateModal = () => {
    setEditingCase(null);
    setForm({ name: '', chips: [{ chip_id: '', quantity: '' }] });
    setIsModalOpen(true);
  };

  const openEditModal = (c) => {
    setEditingCase(c);
    const mappedChips = c.chips.map(item => ({
      chip_id: item.chip_id ? item.chip_id._id : '',
      quantity: item.quantity
    }));
    setForm({ name: c.name, chips: mappedChips.length ? mappedChips : [{ chip_id: '', quantity: '' }] });
    setIsModalOpen(true);
  };

  const addChipRow = () => {
    setForm({ ...form, chips: [...form.chips, { chip_id: '', quantity: '' }] });
  };

  const updateChipRow = (index, field, value) => {
    const newChips = [...form.chips];
    newChips[index][field] = value;
    setForm({ ...form, chips: newChips });
  };

  const removeChipRow = (index) => {
    const newChips = form.chips.filter((_, i) => i !== index);
    setForm({ ...form, chips: newChips });
  };

  const getStockWarnings = () => {
    const warnings = [];
    form.chips.forEach(row => {
      if (row.chip_id && row.quantity) {
        const chip = availableChips.find(c => c._id === row.chip_id);
        if (chip) {
          // Calculate previously allocated quantity in this case if editing
          let previouslyAllocated = 0;
          if (editingCase) {
            const oldRow = editingCase.chips.find(c => c.chip_id && c.chip_id._id === row.chip_id);
            if (oldRow) previouslyAllocated = oldRow.quantity;
          }
          
          // Available physically = database available + what we already took for this specific case (if editing)
          const realAvailable = chip.available_quantity + previouslyAllocated;
          const diff = realAvailable - parseInt(row.quantity);
          
          if (diff < 0) {
            warnings.push({
              name: chip.name,
              negative: Math.abs(diff)
            });
          }
        }
      }
    });
    return warnings;
  };

  const warnings = getStockWarnings();

  const containerAnim = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.1 } }
  };

  const cardAnim = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    show: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
  };

  const getStatusBadge = (status, tournamentName) => {
    switch (status) {
      case 'available': return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500">Disponível</span>;
      case 'allocated': return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 truncate max-w-[150px]" title={tournamentName}>Em Uso: {tournamentName}</span>;
      case 'maintenance': return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-500">Manutenção</span>;
      default: return null;
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold mb-1 text-gray-900 dark:text-white">Fichários e Maletas</h1>
          <p className="text-gray-500 dark:text-gray-400">Gerencie a alocação de maletas e o conteúdo de cada kit.</p>
        </div>
        
        <button onClick={openCreateModal} className="w-full md:w-auto px-6 py-3 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 transition-all flex justify-center items-center gap-2 shadow-lg shadow-red-500/20">
          <Plus size={18} />
          Novo Fichário
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

            return (
              <motion.div key={c._id} variants={cardAnim} className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-lg hover:shadow-xl transition-all overflow-hidden flex flex-col">
                <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-start bg-gray-50 dark:bg-[#111111]">
                  <div>
                    <h3 className="font-bold text-xl text-gray-900 dark:text-white flex items-center gap-2 mb-2">
                      <Briefcase className="text-genesis-red" size={20} />
                      {c.name}
                    </h3>
                    {getStatusBadge(c.status, c.allocated_to_tournament_name)}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => openEditModal(c)} className="p-2 text-gray-400 hover:text-blue-500 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg transition-colors shadow-sm"><Edit2 size={16} /></button>
                    {c.status !== 'allocated' && (
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

      {/* Modal Criar/Editar Fichário */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
            onClick={() => setIsModalOpen(false)}
          >
            <div className="min-h-full flex items-center justify-center">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl w-full max-w-xl shadow-2xl flex flex-col relative my-8"
              >
                <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50 dark:bg-[#111111] shrink-0 rounded-t-3xl">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><Briefcase className="text-genesis-red" size={20}/> {editingCase ? 'Editar Fichário' : 'Novo Fichário'}</h2>
                <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-genesis-red transition-colors"><X size={24} /></button>
              </div>
              
              <div className="p-6 overflow-y-auto flex-1 space-y-6">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Nome da Maleta/Fichário</label>
                  <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white" required placeholder="Ex: Maleta Poker Stars A" />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300">Conteúdo do Fichário</label>
                    <button type="button" onClick={addChipRow} className="text-sm font-bold text-genesis-red hover:text-red-700 flex items-center gap-1 transition-colors">
                      <Plus size={14} /> Adicionar Modelo
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {form.chips.map((row, index) => (
                      <div key={index} className="flex items-center gap-3 bg-gray-50 dark:bg-[#111111] p-3 rounded-xl border border-gray-200 dark:border-zinc-700/50">
                        <CustomSelect 
                          options={availableChips.map(c => ({ value: c._id, label: `${c.name} (Disp: ${c.available_quantity})` }))}
                          value={row.chip_id}
                          onChange={(val) => updateChipRow(index, 'chip_id', val)}
                          placeholder="Selecione a ficha..."
                        />
                        <input 
                          type="number" 
                          min="1"
                          placeholder="Qtd" 
                          value={row.quantity} 
                          onChange={(e) => updateChipRow(index, 'quantity', e.target.value)}
                          className="w-24 bg-white dark:bg-[#141414] border border-gray-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-genesis-red text-gray-900 dark:text-white text-center"
                        />
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
                </div>
                
                {warnings.length > 0 && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl flex gap-3 text-red-700 dark:text-red-400 text-sm font-medium">
                    <AlertCircle className="shrink-0 mt-0.5" size={18} />
                    <div>
                      <p className="font-bold mb-1">Atenção: Estoque insuficiente!</p>
                      <ul className="list-disc pl-4 space-y-1">
                        {warnings.map((w, i) => (
                          <li key={i}>Faltam <b>{w.negative.toLocaleString()} un.</b> do modelo {w.name}.</li>
                        ))}
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