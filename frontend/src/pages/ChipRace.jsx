import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calculator, Plus, Trash2, History, ChevronRight, X, Layers, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { BACKEND_URL } from '../App';

export default function ChipRace() {
  const { showAlert } = useAlert();
  const [races, setRaces] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [chipModels, setChipModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRace, setSelectedRace] = useState(null);

  const [form, setForm] = useState({
    tournament_id: '',
    type: 'chip-race',
    active_tables: 1,
    from_chip: '',
    from_quantity: 0,
    to_chip: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const token = localStorage.getItem('genesis_token');
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      const [racesRes, tournamentsRes, chipsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/chip-races`, { headers }),
        fetch(`${BACKEND_URL}/api/tournaments`, { headers }),
        fetch(`${BACKEND_URL}/api/chips`, { headers })
      ]);
      if (racesRes.ok) setRaces(await racesRes.json());
      if (tournamentsRes.ok) setTournaments(await tournamentsRes.json());
      if (chipsRes.ok) setChipModels(await chipsRes.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchChipsInPlay = async (tournamentId, chipId) => {
    if (!tournamentId || !chipId) return;
    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/tournaments/${tournamentId}/consolidated-chips`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const consolidated = await res.json();
        const found = consolidated.find(c => c.value === chipModels.find(cm => cm._id === chipId)?.value);
        if (found) {
          setForm(prev => ({ ...prev, from_quantity: found.quantity }));
        } else {
          setForm(prev => ({ ...prev, from_quantity: 0 }));
        }
      }
    } catch (e) { console.error(e); }
  };

  const handleFromChipChange = (chipId) => {
    const selected = chipModels.find(c => c._id === chipId);
    if (!selected) return;

    // Find the next highest chip
    const nextChip = chipModels
      .filter(c => c.value > selected.value)
      .sort((a, b) => a.value - b.value)[0];

    setForm(prev => ({ 
      ...prev, 
      from_chip: chipId, 
      to_chip: nextChip ? nextChip._id : prev.to_chip 
    }));

    if (form.tournament_id) {
      fetchChipsInPlay(form.tournament_id, chipId);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/chip-races`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(form)
      });
      if (res.ok) {
        showAlert('Cálculo registrado com sucesso!', 'success');
        setIsModalOpen(false);
        fetchData();
        setForm({ tournament_id: '', type: 'chip-race', active_tables: 1, from_chip: '', from_quantity: 0, to_chip: '' });
      } else {
        const err = await res.json();
        showAlert(err.error || 'Erro ao registrar', 'error');
      }
    } catch (e) { console.error(e); }
  };

  const fromChip = chipModels.find(c => c._id === form.from_chip);
  const toChip = chipModels.find(c => c._id === form.to_chip);
  const totalValue = fromChip ? form.from_quantity * fromChip.value : 0;
  const totalToQuantity = toChip && totalValue > 0 ? totalValue / toChip.value : 0;
  const perTableToQuantity = totalToQuantity / (form.active_tables || 1);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">Chip Race / Color Up</h1>
          <p className="text-gray-500 font-medium">Gerencie as trocas de fichas de menor valor</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="px-6 py-3 bg-genesis-red text-white font-bold rounded-2xl flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-red-500/20"
        >
          <Plus size={20}/> Novo Cálculo
        </button>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-48 bg-gray-100 dark:bg-zinc-800 rounded-3xl"></div>)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {races.map(race => (
            <motion.div 
              key={race._id}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => setSelectedRace(race)}
              className="bg-white dark:bg-[#141414] p-6 rounded-3xl border border-gray-200 dark:border-zinc-800 shadow-sm hover:border-genesis-red transition-all cursor-pointer group"
            >
              <div className="flex justify-between items-start mb-4">
                <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${race.type === 'chip-race' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'}`}>
                  {race.type === 'chip-race' ? 'Chip Race' : 'Color Up'}
                </div>
                <span className="text-[10px] text-gray-400 font-bold">{new Date(race.createdAt).toLocaleString()}</span>
              </div>
              <h3 className="text-lg font-black text-gray-900 dark:text-white mb-2 uppercase truncate">{race.tournament_id?.name || 'Evento'}</h3>
              <div className="flex items-center gap-4 text-sm text-gray-500 font-bold mb-4">
                <div className="flex items-center gap-1"><Layers size={14}/> {race.active_tables} mesas</div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800">
                <div className="flex flex-col items-center">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: race.from_chip?.color }}></div>
                  <span className="text-[10px] font-black">{race.from_chip?.value}</span>
                </div>
                <ArrowRight size={16} className="text-gray-300"/>
                <div className="flex flex-col items-center">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: race.to_chip?.color }}></div>
                  <span className="text-[10px] font-black">{race.to_chip?.value}</span>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[10px] font-bold text-gray-400 uppercase">Fichas In</p>
                  <p className="text-sm font-black text-emerald-500">{race.to_quantity.toLocaleString()}</p>
                </div>
              </div>
            </motion.div>
          ))}
          {races.length === 0 && (
            <div className="col-span-full py-20 text-center text-gray-400 font-medium italic">Nenhum cálculo registrado.</div>
          )}
        </div>
      )}

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedRace && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedRace(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-white dark:bg-[#111111] w-full max-w-lg rounded-[40px] shadow-2xl overflow-hidden border border-gray-200 dark:border-zinc-800">
              <div className="p-8 space-y-8">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-genesis-red">Detalhes do Registro</span>
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">{selectedRace.tournament_id?.name}</h2>
                  </div>
                  <button onClick={() => setSelectedRace(null)} className="p-2 text-gray-400 hover:text-gray-600 transition-all"><X /></button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-3xl border border-gray-100 dark:border-zinc-800">
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Fichas Out (Retiradas)</p>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedRace.from_chip?.color }}></div>
                      <span className="font-black text-gray-900 dark:text-white">Ficha {selectedRace.from_chip?.value}</span>
                    </div>
                    <p className="text-lg font-black text-red-500">{selectedRace.from_quantity.toLocaleString()} un.</p>
                    <p className="text-[10px] font-bold text-gray-400">Total: {selectedRace.total_value.toLocaleString()}</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-3xl border border-gray-100 dark:border-zinc-800">
                    <p className="text-[10px] font-black text-gray-400 uppercase mb-2">Fichas In (Entregues)</p>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedRace.to_chip?.color }}></div>
                      <span className="font-black text-gray-900 dark:text-white">Ficha {selectedRace.to_chip?.value}</span>
                    </div>
                    <p className="text-lg font-black text-emerald-500">{selectedRace.to_quantity.toLocaleString()} un.</p>
                    <p className="text-[10px] font-bold text-gray-400">Total: {selectedRace.total_value.toLocaleString()}</p>
                  </div>
                </div>

                <div className="bg-genesis-red/5 p-6 rounded-3xl border border-genesis-red/20">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-black text-genesis-red uppercase text-sm">Resumo por Mesa</h4>
                    <span className="bg-genesis-red text-white text-[10px] px-2 py-0.5 rounded-full font-bold">{selectedRace.active_tables} Mesas</span>
                  </div>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-black text-genesis-red">{(selectedRace.to_quantity / selectedRace.active_tables).toFixed(1)}x</p>
                      <p className="text-[10px] font-bold text-red-700/60 uppercase">Fichas {selectedRace.to_chip?.value} por mesa</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-gray-900 dark:text-white">{(selectedRace.total_value / selectedRace.active_tables).toLocaleString()}</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Valor por mesa</p>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="relative bg-white dark:bg-[#111111] w-full max-w-2xl rounded-[40px] shadow-2xl overflow-hidden border border-gray-200 dark:border-zinc-800">
              <form onSubmit={handleCreate} className="flex flex-col h-full">
                <div className="p-8 border-b border-gray-100 dark:border-zinc-800 flex justify-between items-center">
                  <div>
                    <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">Novo Cálculo</h2>
                    <p className="text-gray-500 text-sm font-medium">Preencha os dados para calcular a troca</p>
                  </div>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 transition-all"><X /></button>
                </div>

                <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Tipo de Operação</label>
                      <div className="flex bg-gray-100 dark:bg-zinc-900 p-1 rounded-xl">
                        <button type="button" onClick={() => setForm({...form, type: 'chip-race'})} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${form.type === 'chip-race' ? 'bg-white dark:bg-zinc-700 text-genesis-red shadow-sm' : 'text-gray-500'}`}>Chip Race</button>
                        <button type="button" onClick={() => setForm({...form, type: 'color-up'})} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${form.type === 'color-up' ? 'bg-white dark:bg-zinc-700 text-genesis-red shadow-sm' : 'text-gray-500'}`}>Color Up</button>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Torneio</label>
                      <select 
                        required 
                        value={form.tournament_id} 
                        onChange={e => {
                          const tid = e.target.value;
                          setForm({...form, tournament_id: tid});
                          if (form.from_chip) fetchChipsInPlay(tid, form.from_chip);
                        }} 
                        className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-genesis-red outline-none appearance-none"
                      >
                        <option value="">Selecione o Torneio</option>
                        {tournaments.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Mesas Ativas</label>
                      <input type="number" required value={form.active_tables} onChange={e => setForm({...form, active_tables: parseInt(e.target.value) || 0})} className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-genesis-red outline-none" />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Ficha Sair</label>
                        <select 
                          required 
                          value={form.from_chip} 
                          onChange={e => handleFromChipChange(e.target.value)} 
                          className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-3 py-3 text-sm focus:ring-2 focus:ring-genesis-red outline-none"
                        >
                          <option value="">De</option>
                          {chipModels.map(c => <option key={c._id} value={c._id}>{c.value}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Ficha Entrar</label>
                        <select required value={form.to_chip} onChange={e => setForm({...form, to_chip: e.target.value})} className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-3 py-3 text-sm focus:ring-2 focus:ring-genesis-red outline-none">
                          <option value="">Para</option>
                          {chipModels.map(c => <option key={c._id} value={c._id}>{c.value}</option>)}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block">Qtd. Fichas Retiradas (Total)</label>
                      <input type="number" required value={form.from_quantity} onChange={e => setForm({...form, from_quantity: parseInt(e.target.value) || 0})} className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-genesis-red outline-none" />
                    </div>

                    <div className="bg-emerald-500/10 p-4 rounded-2xl border border-emerald-500/20">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-[10px] font-black text-emerald-600 uppercase">Resultado do Cálculo</span>
                        <CheckCircle2 size={14} className="text-emerald-500"/>
                      </div>
                      <p className="text-lg font-black text-emerald-600">{totalToQuantity.toLocaleString()} Fichas {toChip?.value || ''}</p>
                      <p className="text-[10px] font-bold text-emerald-600/60 uppercase">({perTableToQuantity.toFixed(1)}x por mesa)</p>
                    </div>
                  </div>
                </div>

                <div className="p-8 bg-gray-50 dark:bg-zinc-900 flex justify-end gap-4">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 font-bold text-gray-500 hover:text-gray-700 transition-all">Cancelar</button>
                  <button type="submit" className="px-10 py-3 bg-genesis-red text-white font-bold rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-red-500/20">Registrar</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
