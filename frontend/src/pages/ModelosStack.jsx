import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Plus, Trash2, X, Save, AlertCircle, Coins, ChevronRight, Info, PlusCircle, ChevronDown } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { BACKEND_URL } from '../App';

const CustomSelect = ({ options, value, onChange, placeholder }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef(null);
  const selectedOption = options.find(o => o.value === value);

  React.useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-full" ref={containerRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm cursor-pointer text-gray-900 dark:text-white font-bold"
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={16} className={`transition-transform text-gray-400 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </div>
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
            className="absolute z-50 w-full mt-1 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl max-h-48 overflow-y-auto"
          >
            {options.map(opt => (
              <div 
                key={opt.value} 
                onClick={() => { onChange(opt.value); setIsOpen(false); }}
                className="px-4 py-2 hover:bg-gray-50 dark:hover:bg-zinc-800/50 cursor-pointer text-sm text-gray-900 dark:text-white border-b border-gray-50 dark:border-zinc-800/30 last:border-0 font-bold"
              >
                {opt.label}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function ModelosStack() {
  const { showAlert } = useAlert();
  const [stacks, setStacks] = useState([]);
  const [chipModels, setChipModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStack, setEditingStack] = useState(null);

  const [form, setForm] = useState({
    name: '',
    composition: [],
    notes: ''
  });

  const [tempChip, setTempChip] = useState({ chip_id: '', quantity: 0 });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const token = localStorage.getItem('genesis_token');
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      const [stacksRes, chipsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/stacks`, { headers }),
        fetch(`${BACKEND_URL}/api/chips`, { headers })
      ]);
      if (stacksRes.ok) setStacks(await stacksRes.json());
      if (chipsRes.ok) setChipModels(await chipsRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleEdit = (stack) => {
    setEditingStack(stack);
    setForm({
      name: stack.name,
      composition: stack.composition.map(c => ({ 
        chip_id: c.chip_id?._id || c.chip_id, 
        quantity: c.quantity 
      })),
      notes: stack.notes || ''
    });
    setIsModalOpen(true);
  };

  const handleAddChip = () => {
    if (!tempChip.chip_id || tempChip.quantity <= 0) return;
    
    const existing = form.composition.find(c => (c.chip_id?._id || c.chip_id) === tempChip.chip_id);
    if (existing) {
      setForm({
        ...form,
        composition: form.composition.map(c => 
          (c.chip_id?._id || c.chip_id) === tempChip.chip_id ? { ...c, quantity: c.quantity + tempChip.quantity } : c
        )
      });
    } else {
      setForm({
        ...form,
        composition: [...form.composition, tempChip]
      });
    }
    setTempChip({ chip_id: '', quantity: 0 });
  };

  const handleRemoveChip = (chipId) => {
    setForm({
      ...form,
      composition: form.composition.filter(c => (c.chip_id?._id || c.chip_id) !== chipId)
    });
  };

  const calculateTotal = (composition) => {
    return composition.reduce((acc, c) => {
      const chip = chipModels.find(cm => cm._id === (c.chip_id?._id || c.chip_id));
      return acc + (c.quantity * (chip?.value || 0));
    }, 0);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (form.composition.length === 0) return showAlert('Adicione ao menos uma ficha', 'error');

    const token = localStorage.getItem('genesis_token');
    const url = editingStack ? `${BACKEND_URL}/api/stacks/${editingStack._id}` : `${BACKEND_URL}/api/stacks`;
    const method = editingStack ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ ...form, total_value: calculateTotal(form.composition) })
      });
      if (res.ok) {
        showAlert(editingStack ? 'Modelo atualizado!' : 'Modelo de stack salvo!', 'success');
        setIsModalOpen(false);
        setEditingStack(null);
        setForm({ name: '', composition: [], notes: '' });
        fetchData();
      }
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id) => {
    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/stacks/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showAlert('Modelo removido', 'success');
        fetchData();
      }
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">Modelos de Montagem</h1>
          <p className="text-gray-500 font-medium">Defina os stacks padrão para facilitar as entradas no salão</p>
        </div>
        <button 
          onClick={() => {
            setEditingStack(null);
            setForm({ name: '', composition: [], notes: '' });
            setIsModalOpen(true);
          }}
          className="px-6 py-3 bg-genesis-red text-white font-bold rounded-2xl flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-red-500/20"
        >
          <Plus size={20}/> Novo Modelo
        </button>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-48 bg-gray-100 dark:bg-zinc-800 rounded-3xl"></div>)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {stacks.map(stack => (
            <motion.div 
              key={stack._id}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-[#141414] p-6 rounded-[32px] border border-gray-200 dark:border-zinc-800 shadow-sm hover:border-genesis-red transition-all group relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-all">
                <button onClick={() => handleDelete(stack._id)} className="p-2 bg-red-50 dark:bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all"><Trash2 size={16}/></button>
              </div>
              
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-genesis-red/10 text-genesis-red rounded-2xl"><Layers size={20}/></div>
                <div>
                  <h3 className="text-lg font-black text-gray-900 dark:text-white uppercase truncate">{stack.name}</h3>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total: {stack.total_value.toLocaleString()}</p>
                </div>
              </div>

              <div className="space-y-2 mb-4">
                {stack.composition.slice(0, 3).map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-xs font-bold text-gray-500">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.chip_id?.color }}></div>
                      <span>{c.chip_id?.value}</span>
                    </div>
                    <span>{c.quantity}x</span>
                  </div>
                ))}
                {stack.composition.length > 3 && <p className="text-[10px] text-gray-400 italic font-medium">+ {stack.composition.length - 3} outros tipos</p>}
              </div>

              <div className="pt-4 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {stack.composition.map((c, i) => (
                    <div key={i} className="w-6 h-6 rounded-full border-2 border-white dark:border-[#141414] shadow-sm" style={{ backgroundColor: c.chip_id?.color }}></div>
                  ))}
                </div>
                <button 
                  onClick={() => handleEdit(stack)}
                  className="text-[10px] font-black text-genesis-red uppercase flex items-center gap-1 hover:gap-2 transition-all"
                >
                  Ver Detalhes <ChevronRight size={12}/>
                </button>
              </div>
            </motion.div>
          ))}
          {stacks.length === 0 && (
            <div className="col-span-full py-20 text-center text-gray-400 font-medium italic">Nenhum modelo de stack criado.</div>
          )}
        </div>
      )}

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="relative bg-white dark:bg-[#111111] w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden border border-gray-200 dark:border-zinc-800">
              <form onSubmit={handleSave} className="flex flex-col h-full">
                <div className="p-8 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">
                      {editingStack ? 'Editar Modelo' : 'Novo Modelo de Stack'}
                    </h2>
                    <p className="text-gray-500 text-sm font-medium">Defina a composição exata das fichas</p>
                  </div>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 transition-all"><X /></button>
                </div>

                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block tracking-widest">Nome do Modelo</label>
                      <input 
                        required
                        type="text" 
                        placeholder="Ex: Stack High Roller 50k"
                        value={form.name}
                        onChange={e => setForm({...form, name: e.target.value})}
                        className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-genesis-red outline-none transition-all font-bold"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block tracking-widest">Adicionar Fichas</label>
                      <div className="flex flex-col gap-2 mb-2">
                        <CustomSelect 
                          options={chipModels.map(c => ({ value: c._id, label: `Ficha ${c.value}` }))}
                          value={tempChip.chip_id}
                          onChange={val => setTempChip({...tempChip, chip_id: val})}
                          placeholder="Selecionar Ficha"
                        />
                        <input 
                          type="number" 
                          placeholder="Quantidade"
                          value={tempChip.quantity || ''}
                          onChange={e => setTempChip({...tempChip, quantity: parseInt(e.target.value) || 0})}
                          className="bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-genesis-red outline-none font-bold"
                        />
                      </div>
                      <button 
                        type="button"
                        onClick={handleAddChip}
                        className="w-full py-3 bg-gray-900 dark:bg-white dark:text-gray-900 text-white font-bold rounded-xl text-xs uppercase flex items-center justify-center gap-2 hover:opacity-90 transition-all"
                      >
                        <PlusCircle size={14}/> Adicionar ao Stack
                      </button>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block tracking-widest">Observações</label>
                      <textarea 
                        rows="3"
                        value={form.notes}
                        onChange={e => setForm({...form, notes: e.target.value})}
                        className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl px-5 py-4 text-sm focus:ring-2 focus:ring-genesis-red outline-none resize-none"
                      ></textarea>
                    </div>
                  </div>

                  <div className="flex flex-col h-full bg-gray-50 dark:bg-[#0A0A0A] rounded-[32px] border border-gray-100 dark:border-zinc-900 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-black uppercase text-gray-400">Composição do Stack</h3>
                      <div className="px-2 py-1 bg-genesis-red/10 text-genesis-red text-[10px] font-black rounded-lg uppercase">Visualização</div>
                    </div>

                    <div className="flex-1 space-y-3 overflow-y-auto mb-6 pr-2 custom-scrollbar">
                      {form.composition.map((c, i) => {
                        const chip = chipModels.find(cm => cm._id === (c.chip_id?._id || c.chip_id));
                        return (
                          <div key={i} className="flex items-center justify-between p-3 bg-white dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 shadow-sm group">
                            <div className="flex items-center gap-3">
                              <div className="w-4 h-4 rounded-full" style={{ backgroundColor: chip?.color }}></div>
                              <span className="font-bold text-gray-700 dark:text-gray-300">Ficha {chip?.value}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="font-black text-gray-900 dark:text-white">x{c.quantity}</span>
                              <button type="button" onClick={() => handleRemoveChip(c.chip_id?._id || c.chip_id)} className="text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={14}/></button>
                            </div>
                          </div>
                        );
                      })}
                      {form.composition.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2 opacity-50 py-10">
                          <Coins size={32}/>
                          <p className="text-[10px] font-bold uppercase tracking-widest">Vazio</p>
                        </div>
                      )}
                    </div>

                    <div className="pt-6 border-t border-gray-200 dark:border-zinc-800">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-black text-gray-400 uppercase">Total do Stack</span>
                        <span className="text-2xl font-black text-genesis-red">{calculateTotal(form.composition).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-8 bg-gray-50 dark:bg-zinc-900 flex justify-end gap-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 font-bold text-gray-500 hover:text-gray-700 transition-all">Cancelar</button>
                  <button type="submit" className="px-10 py-3 bg-genesis-red text-white font-bold rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-red-500/20 flex items-center gap-2">
                    <Save size={18}/> Salvar Modelo
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}