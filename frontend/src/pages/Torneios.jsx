import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Trophy, Plus, Search, Calendar, Clock, MapPin, 
  ChevronRight, Filter, MoreVertical, Edit2, Trash2, 
  Play, Pause, CheckCircle2, UserPlus, Users, Coins, 
  Settings, Info, Layout, X, Save, AlertCircle, Briefcase, PlusCircle, Layers, Monitor, ArrowUpCircle, ArrowDownCircle, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '../contexts/AlertContext';
import { socket, BACKEND_URL } from '../App';

// ... (BACKEND_URL and StatusBadge components stay the same) ...

const StatusBadge = ({ status }) => {
  const styles = {
    scheduled: 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-500',
    running: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500',
    paused: 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500',
    finished: 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-400'
  };
  const labels = {
    scheduled: 'Agendado',
    running: 'Em Andamento',
    paused: 'Pausado',
    finished: 'Finalizado'
  };
  return (
    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

const CustomSelect = ({ options, value, onChange, placeholder }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = React.useRef(null);
  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
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
        className="w-full flex justify-between items-center bg-white dark:bg-[#0F0F0F] border border-gray-200 dark:border-zinc-800 rounded-xl px-4 py-2 text-sm cursor-pointer text-gray-900 dark:text-white"
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={16} className={`transition-transform text-gray-400 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </div>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}
            className="absolute z-50 w-full mt-1 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl max-h-48 overflow-y-auto"
          >
            {options.map(opt => (
              <div
                key={opt.value}
                onClick={() => { onChange(opt.value); setIsOpen(false); }}
                className="px-4 py-2 hover:bg-gray-50 dark:hover:bg-zinc-800/50 cursor-pointer text-sm text-gray-900 dark:text-white border-b border-gray-50 dark:border-zinc-800/30 last:border-0"
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

export default function Torneios() {
  const { showAlert, showConfirm } = useAlert();
  const [searchParams] = useSearchParams();
  const [tournaments, setTournaments] = useState([]);
  const [availableCases, setAvailableCases] = useState([]);
  const [chipModels, setChipModels] = useState([]);
  const [stackModels, setStackModels] = useState([]);
  const [entries, setEntries] = useState([]);
  const [consolidatedChips, setConsolidatedChips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'logistica');

  useEffect(() => {
    const tournamentId = searchParams.get('id');
    if (tournamentId) {
      fetchTournamentDetails(tournamentId);
      setActiveTab(searchParams.get('tab') || 'salao');
    }
  }, [searchParams]);

  const [form, setForm] = useState({
    name: '',
    date: new Date().toISOString().split('T')[0],
    start_time: '20:00',
    estimated_players: 50,
    starting_stack: 15000,
    notes: ''
  });

  const fetchTournaments = useCallback(async () => {
    try {
      const token = localStorage.getItem('genesis_token');
      const res = await fetch(`${BACKEND_URL}/api/tournaments`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-store' }
      });
      if (res.ok) setTournaments(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const fetchTournamentDetails = async (id) => {
    try {
      const token = localStorage.getItem('genesis_token');
      const res = await fetch(`${BACKEND_URL}/api/tournaments/${id}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-store' }
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedTournament(data);
        fetchFloorData(id);
      }
    } catch (e) { console.error(e); }
  };

  const fetchFloorData = async (id) => {
    const token = localStorage.getItem('genesis_token');
    const headers = { 'Authorization': `Bearer ${token}` };
    try {
      const [entriesRes, consolidatedRes, stacksRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/tournaments/${id}/entries`, { headers }),
        fetch(`${BACKEND_URL}/api/tournaments/${id}/consolidated-chips`, { headers }),
        fetch(`${BACKEND_URL}/api/stacks`, { headers })
      ]);
      if (entriesRes.ok) setEntries(await entriesRes.json());
      if (consolidatedRes.ok) setConsolidatedChips(await consolidatedRes.json());
      if (stacksRes.ok) setStackModels(await stacksRes.json());
    } catch (e) { console.error(e); }
  };

  const fetchCasesAndChips = async () => {
    try {
      const token = localStorage.getItem('genesis_token');
      const headers = { 'Authorization': `Bearer ${token}` };
      const [casesRes, chipsRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/cases`, { headers }),
        fetch(`${BACKEND_URL}/api/chips`, { headers })
      ]);
      if (casesRes.ok) setAvailableCases((await casesRes.json()).filter(c => c.status === 'available' || (selectedTournament && c.allocated_to_tournament === selectedTournament._id)));
      if (chipsRes.ok) setChipModels(await chipsRes.json());
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    fetchTournaments();
    fetchCasesAndChips();
  }, [fetchTournaments]);

  const handleRegisterEntry = async (type, stack_model_id) => {
    if (!stack_model_id) return showAlert('Selecione um modelo de stack', 'error');
    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/tournaments/${selectedTournament._id}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ type, stack_model_id })
      });
      if (res.ok) {
        showAlert('Entrada registrada!', 'success');
        fetchFloorData(selectedTournament._id);
        fetchTournaments();
        // Update local actual_players too for instant feedback
        if (type === 'buy-in') {
          setSelectedTournament(prev => ({ ...prev, actual_players: prev.actual_players + 1 }));
        }
      }
    } catch (e) { console.error(e); }
  };

  const handleCreateTournament = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/tournaments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(form)
      });
      if (res.ok) {
        showAlert('Torneio criado!', 'success');
        setIsCreateModalOpen(false);
        fetchTournaments();
      } else {
        showAlert('Erro ao criar torneio', 'error');
      }
    } catch (e) { console.error(e); }
  };

  const handleUpdateTournament = async (id, updates) => {
    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/tournaments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(updates)
      });
      if (res.ok) {
        if (selectedTournament && selectedTournament._id === id) {
          fetchTournamentDetails(id);
        }
        fetchTournaments();
        return true;
      }
    } catch (e) { console.error(e); }
    return false;
  };

  const handleUpdateBlind = (index, field, value) => {
    if (!selectedTournament) return;
    const newBlinds = [...(selectedTournament.blind_structure || [])];
    if (!newBlinds[index]) {
      newBlinds[index] = { level: index + 1, small_blind: 0, big_blind: 0, ante: 0, duration: 20 };
    }
    newBlinds[index][field] = parseInt(value) || 0;
    handleUpdateTournament(selectedTournament._id, { blind_structure: newBlinds });
  };

  const removeBlindLevel = (index) => {
    if (!selectedTournament) return;
    const newBlinds = selectedTournament.blind_structure.filter((_, i) => i !== index);
    handleUpdateTournament(selectedTournament._id, { blind_structure: newBlinds });
  };

  const addBlindLevel = () => {
    const current = selectedTournament.blind_structure || [];
    const lastLevel = current.length > 0 ? current[current.length - 1] : { level: 0, small_blind: 50, big_blind: 100, ante: 0, duration: 20 };
    const nextLevel = {
      level: current.length + 1,
      small_blind: lastLevel.small_blind * 2,
      big_blind: lastLevel.big_blind * 2,
      ante: lastLevel.ante * 2,
      duration: lastLevel.duration
    };
    handleUpdateTournament(selectedTournament._id, { blind_structure: [...current, nextLevel] });
  };

  const handleDeleteTournament = async (id) => {
    const confirmed = await showConfirm('Excluir este torneio? Fichários alocados serão liberados.');
    if (!confirmed) return;
    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/tournaments/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showAlert('Torneio removido', 'success');
        fetchTournaments();
      }
    } catch (e) { console.error(e); }
  };

  const handleUpdatePerPlayer = (chipId, value) => {
    if (!selectedTournament) return;
    const currentComp = [...(selectedTournament.stack_composition || [])];
    const index = currentComp.findIndex(c => c.chip_id === chipId);
    const newVal = parseInt(value) || 0;

    if (index > -1) {
      currentComp[index].per_player = newVal;
    } else {
      currentComp.push({ chip_id: chipId, per_player: newVal });
    }
    handleUpdateTournament(selectedTournament._id, { stack_composition: currentComp });
  };

  // Tracking Calculations
  const calculateTracking = (tournament) => {
    if (!tournament) return [];

    const allocatedChips = {};
    tournament.allocated_cases?.forEach(c => {
      c.chips?.forEach(chipItem => {
        if (!chipItem.chip_id) return;
        const chipId = chipItem.chip_id._id;
        allocatedChips[chipId] = (allocatedChips[chipId] || 0) + chipItem.quantity;
      });
    });

    const composition = {};
    tournament.stack_composition?.forEach(c => {
      composition[c.chip_id] = c.per_player;
    });

    return chipModels.map(chip => {
      const inCases = allocatedChips[chip._id] || 0;
      return {
        ...chip,
        in_cases: inCases,
        per_player: composition[chip._id] || 0
      };
    });
  };

  const trackingData = calculateTracking(selectedTournament);

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold mb-1 text-gray-900 dark:text-white">Torneios</h1>
          <p className="text-gray-500 dark:text-gray-400">Gerenciamento central de eventos e logística de fichas.</p>
        </div>
        <button onClick={() => setIsCreateModalOpen(true)} className="px-6 py-3 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 transition-all flex items-center gap-2 shadow-lg shadow-red-500/20">
          <Plus size={18} /> Novo Torneio
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 animate-pulse">Carregando eventos...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <AnimatePresence>
            {tournaments.map((t) => (
              <motion.div
                key={t._id}
                layoutId={t._id}
                onClick={() => {
                  fetchTournamentDetails(t._id);
                  fetchCasesAndChips();
                }}
                className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-2xl p-5 hover:border-genesis-red transition-all cursor-pointer group shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl ${t.status === 'running' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500' : 'bg-gray-100 dark:bg-zinc-800 text-gray-400'}`}>
                    <Trophy size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900 dark:text-white">{t.name}</h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1"><Clock size={14} /> {new Date(t.date).toLocaleDateString('pt-BR')} às {t.start_time}</span>
                      <span className="flex items-center gap-1"><Users size={14} /> {t.actual_players || 0} / {t.estimated_players} jog.</span>
                      <span className="flex items-center gap-1"><Layers size={14} /> Stack: {t.starting_stack.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 self-end md:self-center">
                  <StatusBadge status={t.status} />
                  <ChevronRight className="text-gray-300 group-hover:text-genesis-red group-hover:translate-x-1 transition-all" size={20} />
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {tournaments.length === 0 && <div className="text-center py-10 text-gray-500 italic">Nenhum torneio agendado.</div>}
        </div>
      )}

      {/* Detail Modal Overlay */}
      <AnimatePresence>
        {selectedTournament && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-0 md:p-4 overflow-y-auto"
            onClick={() => setSelectedTournament(null)}
          >
            <motion.div
              initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }}
              className="bg-gray-50 dark:bg-[#0A0A0A] w-full max-w-6xl min-h-screen md:min-h-0 md:rounded-3xl shadow-2xl flex flex-col overflow-hidden my-auto"
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-6 bg-white dark:bg-[#111111] border-b border-gray-200 dark:border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-10">
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-4">
                    <button onClick={() => setSelectedTournament(null)} className="md:hidden p-2 text-gray-500"><X /></button>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">{selectedTournament.name}</h2>
                        <StatusBadge status={selectedTournament.status} />
                      </div>
                      <p className="text-sm text-gray-500 font-medium">{new Date(selectedTournament.date).toLocaleDateString()} às {selectedTournament.start_time}</p>
                    </div>
                  </div>

                  {/* Tab Switcher */}
                  <div className="hidden md:flex bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl">
                    <button
                      onClick={() => setActiveTab('logistica')}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'logistica' ? 'bg-white dark:bg-zinc-700 text-genesis-red shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <Layout size={14} /> Logística
                    </button>
                    <button
                      onClick={() => setActiveTab('salao')}
                      className={`px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'salao' ? 'bg-white dark:bg-zinc-700 text-genesis-red shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      <Monitor size={14} /> Visão do Salão
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {selectedTournament.status === 'scheduled' && (
                    <button onClick={() => handleUpdateTournament(selectedTournament._id, { status: 'running' })} className="px-6 py-2 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"><Play size={18} /> Iniciar</button>
                  )}
                  {selectedTournament.status === 'running' && (
                    <button onClick={() => handleUpdateTournament(selectedTournament._id, { status: 'paused' })} className="px-6 py-2 rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-600 transition-all flex items-center gap-2 shadow-lg shadow-amber-500/20"><Pause size={18} /> Pausar</button>
                  )}
                  {selectedTournament.status === 'paused' && (
                    <button onClick={() => handleUpdateTournament(selectedTournament._id, { status: 'running' })} className="px-6 py-2 rounded-xl bg-emerald-500 text-white font-bold hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"><Play size={18} /> Retomar</button>
                  )}
                  {['running', 'paused'].includes(selectedTournament.status) && (
                    <button onClick={() => handleUpdateTournament(selectedTournament._id, { status: 'finished' })} className="px-6 py-2 rounded-xl bg-gray-600 text-white font-bold hover:bg-gray-700 transition-all flex items-center gap-2 shadow-lg shadow-gray-500/10"><CheckCircle2 size={18} /> Finalizar</button>
                  )}
                  <button onClick={() => handleDeleteTournament(selectedTournament._id).then(() => setSelectedTournament(null))} className="p-3 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"><Trash2 size={20} /></button>
                  <button onClick={() => setSelectedTournament(null)} className="hidden md:flex p-3 rounded-xl text-gray-400 hover:text-gray-600 transition-all"><X size={24} /></button>
                </div>
              </div>

              {activeTab === 'logistica' ? (
                <div className="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* (Existing Logistics View Content) */}
                  <div className="lg:col-span-2 space-y-8">
                    {/* Entries Section */}
                    <div className="bg-white dark:bg-[#141414] rounded-3xl p-6 border border-gray-200 dark:border-zinc-800 shadow-sm">
                      <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-bold flex items-center gap-2"><Users className="text-genesis-red" /> Inscrições (Players)</h3>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-400 font-bold uppercase tracking-tight">Total:</span>
                          <div className="text-2xl font-black text-genesis-red">{selectedTournament.actual_players}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 bg-gray-50 dark:bg-[#0F0F0F] p-4 rounded-2xl border border-gray-200 dark:border-zinc-800">
                        <button 
                          disabled={selectedTournament.status === 'finished'}
                          onClick={() => handleUpdateTournament(selectedTournament._id, { actual_players: Math.max(0, selectedTournament.actual_players - 1) })} 
                          className="p-4 bg-white dark:bg-zinc-800 rounded-xl shadow-sm hover:scale-105 active:scale-95 transition-all text-gray-600 dark:text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Minus />
                        </button>
                        <input
                          disabled={selectedTournament.status === 'finished'}
                          type="number"
                          value={selectedTournament.actual_players}
                          onChange={(e) => handleUpdateTournament(selectedTournament._id, { actual_players: parseInt(e.target.value) || 0 })}
                          className="flex-1 bg-transparent text-center text-3xl font-black text-gray-900 dark:text-white focus:outline-none disabled:opacity-50"
                        />
                        <button 
                          disabled={selectedTournament.status === 'finished'}
                          onClick={() => handleUpdateTournament(selectedTournament._id, { actual_players: selectedTournament.actual_players + 1 })} 
                          className="p-4 bg-genesis-red rounded-xl shadow-lg shadow-red-500/20 hover:scale-105 active:scale-95 transition-all text-white disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
                        >
                          <PlusIcon />
                        </button>
                      </div>
                    </div>

                    {/* Blinds Section */}
                    <div className="bg-white dark:bg-[#141414] rounded-3xl p-6 border border-gray-200 dark:border-zinc-800 shadow-sm overflow-hidden">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold flex items-center gap-2"><History className="text-blue-500" /> Estrutura de Blinds</h3>
                        <button 
                          disabled={selectedTournament.status === 'finished'}
                          onClick={addBlindLevel} 
                          className="px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold hover:bg-blue-100 transition-all flex items-center gap-1 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Plus size={14} /> Adicionar Nível
                        </button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="text-gray-400 font-bold border-b border-gray-100 dark:border-zinc-800">
                              <th className="py-3 pr-4">Nível</th>
                              <th className="py-3 px-2">SB</th>
                              <th className="py-3 px-2">BB</th>
                              <th className="py-3 px-2">Ante</th>
                              <th className="py-3 px-2">Min</th>
                              <th className="py-3 pl-4 text-right">Ação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selectedTournament.blind_structure || []).map((lvl, idx) => (
                              <tr key={idx} className="border-b border-gray-50 dark:border-zinc-900/50 hover:bg-gray-50/50 dark:hover:bg-zinc-800/30 transition-colors group">
                                <td className="py-2 pr-4 font-bold text-gray-400">{idx + 1}</td>
                                <td className="py-2 px-2">
                                  <input type="number" value={lvl.small_blind} onChange={(e) => handleUpdateBlind(idx, 'small_blind', e.target.value)} className="w-20 bg-transparent font-bold focus:text-genesis-red outline-none" />
                                </td>
                                <td className="py-2 px-2">
                                  <input type="number" value={lvl.big_blind} onChange={(e) => handleUpdateBlind(idx, 'big_blind', e.target.value)} className="w-20 bg-transparent font-bold focus:text-genesis-red outline-none" />
                                </td>
                                <td className="py-2 px-2 text-gray-500">
                                  <input type="number" value={lvl.ante} onChange={(e) => handleUpdateBlind(idx, 'ante', e.target.value)} className="w-16 bg-transparent focus:text-genesis-red outline-none" />
                                </td>
                                <td className="py-2 px-2 text-gray-500">
                                  <input type="number" value={lvl.duration} onChange={(e) => handleUpdateBlind(idx, 'duration', e.target.value)} className="w-12 bg-transparent focus:text-genesis-red outline-none" />
                                </td>
                                <td className="py-2 pl-4 text-right">
                                  <button onClick={() => removeBlindLevel(idx)} className="p-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16} /></button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-8">
                    {/* Tracking Sheet */}
                    <div className="bg-white dark:bg-[#141414] rounded-3xl p-6 border border-gray-200 dark:border-zinc-800 shadow-sm">
                      <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><Settings className="text-emerald-500" size={20} /> Tracking Sheet</h3>
                      <div className="space-y-5">
                        <div className="grid grid-cols-4 text-[10px] uppercase font-bold text-gray-400 mb-2 px-1">
                          <div className="col-span-1">Ficha</div>
                          <div className="text-center">P/ Jog.</div>
                          <div className="text-center">Total</div>
                          <div className="text-right">Disp.</div>
                        </div>
                        {trackingData.map(chip => {
                          const needed = (chip.per_player || 0) * selectedTournament.actual_players;
                          const available = chip.in_cases;
                          const isShort = available < needed;

                          return (
                            <div key={chip._id} className="space-y-1.5">
                              <div className="grid grid-cols-4 items-center gap-2">
                                <div className="flex items-center gap-2 col-span-1">
                                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: chip.color }}></div>
                                  <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{chip.value}</span>
                                </div>
                                <input
                                  type="number"
                                  value={chip.per_player || 0}
                                  onChange={(e) => handleUpdatePerPlayer(chip._id, e.target.value)}
                                  className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded px-1 py-0.5 text-center text-xs font-bold focus:ring-1 focus:ring-genesis-red outline-none transition-all"
                                />
                                <div className={`text-center text-xs font-black ${isShort ? 'text-red-500' : 'text-emerald-500'}`}>{needed.toLocaleString()}</div>
                                <div className="text-right text-xs font-bold text-gray-500">{available.toLocaleString()}</div>
                              </div>
                              <div className="w-full h-1 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-500 ${isShort ? 'bg-red-500' : 'bg-emerald-500'}`}
                                  style={{ width: `${Math.min(100, (available / (needed || 1)) * 100)}%` }}
                                ></div>
                              </div>
                            </div>
                          );
                        })}
                        <div className="pt-4 border-t border-gray-100 dark:border-zinc-800 space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Stack Necessário</span>
                            <span className="font-bold">{(selectedTournament.actual_players * selectedTournament.starting_stack).toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Stack nos Fichários</span>
                            <span className="font-bold text-emerald-600">
                              {selectedTournament.allocated_cases?.reduce((acc, c) => acc + c.chips.reduce((acc2, chip) => acc2 + (chip.quantity * (chip.chip_id?.value || 0)), 0), 0).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Case Allocation */}
                    <div className="bg-white dark:bg-[#141414] rounded-3xl p-6 border border-gray-200 dark:border-zinc-800 shadow-sm overflow-visible">
                      <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Package className="text-amber-500" size={20} /> Fichários Alocados</h3>
                      <div className="space-y-3">
                        {selectedTournament.allocated_cases?.map(c => (
                          <div key={c._id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#0F0F0F] rounded-xl border border-gray-200 dark:border-zinc-800">
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-300 truncate">{c.name}</span>
                            <button
                              disabled={selectedTournament.status === 'finished'}
                              onClick={() => {
                                const newCases = selectedTournament.allocated_cases.filter(item => item._id !== c._id).map(item => item._id);
                                handleUpdateTournament(selectedTournament._id, { allocated_cases: newCases });
                              }}
                              className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                        <div className="pt-2">
                          <CustomSelect
                            disabled={selectedTournament.status === 'finished'}
                            options={availableCases.map(c => ({ value: c._id, label: c.name }))}
                            onChange={(val) => {
                              const current = selectedTournament.allocated_cases.map(c => c._id);
                              if (current.includes(val)) return;
                              
                              // Automação: Adicionar fichas do fichário ao Stack Composition (TS)
                              const selectedCase = availableCases.find(c => c._id === val);
                              const currentComp = [...(selectedTournament.stack_composition || [])];
                              
                              if (selectedCase && selectedCase.chips) {
                                selectedCase.chips.forEach(chipItem => {
                                  if (!chipItem.chip_id) return;
                                  const chipId = chipItem.chip_id._id || chipItem.chip_id;
                                  const exists = currentComp.find(cc => cc.chip_id === chipId);
                                  if (!exists) {
                                    currentComp.push({ chip_id: chipId, per_player: 0 });
                                  }
                                });
                              }

                              handleUpdateTournament(selectedTournament._id, { 
                                allocated_cases: [...current, val],
                                stack_composition: currentComp
                              });
                            }}
                            placeholder={selectedTournament.status === 'finished' ? 'Finalizado' : '+ Alocar Fichário'}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 md:p-8 space-y-8">
                  {selectedTournament.status === 'finished' && (
                    <div className="bg-gray-100 dark:bg-zinc-800/50 p-4 rounded-2xl flex items-center justify-center gap-3 border border-dashed border-gray-200 dark:border-zinc-700">
                      <CheckCircle2 className="text-gray-400" size={20} />
                      <span className="text-sm font-black text-gray-400 uppercase tracking-widest">Torneio Finalizado - Auditoria Apenas</span>
                    </div>
                  )}
                  {/* Visão do Salão View */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                      <p className="text-xs font-bold text-gray-400 uppercase mb-1">Entradas Totais</p>
                      <h4 className="text-3xl font-black text-gray-900 dark:text-white">{entries.length}</h4>
                    </div>
                    <div className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                      <p className="text-xs font-bold text-gray-400 uppercase mb-1">Buy-ins</p>
                      <h4 className="text-3xl font-black text-emerald-500">{entries.filter(e => e.type === 'buy-in').length}</h4>
                    </div>
                    <div className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                      <p className="text-xs font-bold text-gray-400 uppercase mb-1">Re-entries</p>
                      <h4 className="text-3xl font-black text-blue-500">{entries.filter(e => e.type === 're-entry').length}</h4>
                    </div>
                    <div className="bg-white dark:bg-[#141414] p-6 rounded-2xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                      <p className="text-xs font-bold text-gray-400 uppercase mb-1">Fichas em Jogo</p>
                      <h4 className="text-3xl font-black text-amber-500">{(entries.length * selectedTournament.starting_stack).toLocaleString()}</h4>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Entry Registration Form */}
                    <div className="lg:col-span-1 space-y-6">
                      <div className="bg-white dark:bg-[#141414] p-6 rounded-3xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><ArrowUpCircle className="text-emerald-500" /> Registrar Entrada</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="text-xs font-bold text-gray-400 uppercase mb-2 block">Modelo de Stack</label>
                            <CustomSelect
                              options={stackModels.map(s => ({ value: s._id, label: `${s.name} (${s.total_value.toLocaleString()})` }))}
                              placeholder="Selecione o Stack"
                              onChange={(val) => setForm({ ...form, selected_stack_id: val })}
                              value={form.selected_stack_id}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3 pt-2">
                            <button
                              onClick={() => handleRegisterEntry('buy-in', form.selected_stack_id)}
                              disabled={selectedTournament.status === 'finished'}
                              className="py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all flex flex-col items-center justify-center gap-1 shadow-lg shadow-emerald-500/20 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
                            >
                              <PlusIcon size={18} /> Buy-in
                            </button>
                            <button
                              onClick={() => handleRegisterEntry('re-entry', form.selected_stack_id)}
                              disabled={selectedTournament.status === 'finished'}
                              className="py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-all flex flex-col items-center justify-center gap-1 shadow-lg shadow-blue-500/20 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
                            >
                              <PlusIcon size={18} /> Re-entry
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Chips in Play (Consolidated) */}
                      <div className="bg-white dark:bg-[#141414] p-6 rounded-3xl border border-gray-200 dark:border-zinc-800 shadow-sm">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Layers className="text-amber-500" /> Fichas em Jogo</h3>
                        <div className="space-y-3">
                          {consolidatedChips.map(chip => (
                            <div key={chip.value} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-[#0F0F0F] rounded-xl border border-gray-200 dark:border-zinc-800">
                              <div className="flex items-center gap-3">
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: chip.color }}></div>
                                <span className="font-bold text-gray-700 dark:text-gray-300">Ficha {chip.value}</span>
                              </div>
                              <span className="font-black text-gray-900 dark:text-white">{chip.quantity.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* History */}
                    <div className="lg:col-span-2">
                      <div className="bg-white dark:bg-[#141414] p-6 rounded-3xl border border-gray-200 dark:border-zinc-800 shadow-sm h-full flex flex-col">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><History className="text-gray-400" /> Histórico de Entradas</h3>
                        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                          {entries.map(entry => (
                            <div key={entry._id} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-[#0F0F0F] rounded-2xl border border-gray-200 dark:border-zinc-800 hover:border-gray-300 dark:hover:border-zinc-700 transition-all group">
                              <div className="flex items-center gap-4">
                                <div className={`p-2 rounded-xl ${entry.type === 'buy-in' ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-500' : 'bg-blue-100 dark:bg-blue-500/10 text-blue-500'}`}>
                                  {entry.type === 'buy-in' ? <ArrowUpCircle size={20} /> : <ArrowDownCircle size={20} />}
                                </div>
                                <div>
                                  <p className="font-bold text-gray-900 dark:text-white uppercase tracking-tight text-sm">
                                    {entry.type === 'buy-in' ? 'Entrada (Buy-in)' : 'Re-entrada'}
                                  </p>
                                  <p className="text-xs text-gray-500 font-medium">
                                    Stack: {entry.stack_model_id?.name || 'Manual'} | {new Date(entry.timestamp).toLocaleTimeString()}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-black text-gray-900 dark:text-white">#{entries.length - entries.indexOf(entry)}</p>
                              </div>
                            </div>
                          ))}
                          {entries.length === 0 && (
                            <div className="text-center py-20 text-gray-400 italic">Nenhuma entrada registrada ainda.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Modal */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setIsCreateModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-[#141414] w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 border-b border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-[#111111] flex justify-between items-center">
                <h2 className="text-xl font-bold">Novo Torneio</h2>
                <button onClick={() => setIsCreateModalOpen(false)}><X /></button>
              </div>
              <form onSubmit={handleCreateTournament} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-bold mb-1">Nome do Evento</label>
                  <input required type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red" placeholder="Ex: Main Event 50K" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold mb-1">Data</label>
                    <input required type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold mb-1">Horário</label>
                    <input required type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold mb-1">Jog. Estimados</label>
                    <input required type="number" value={form.estimated_players} onChange={e => setForm({ ...form, estimated_players: e.target.value })} className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold mb-1">Stack Inicial</label>
                    <input required type="number" value={form.starting_stack} onChange={e => setForm({ ...form, starting_stack: e.target.value })} className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none" />
                  </div>
                </div>
                <button type="submit" className="w-full py-4 bg-genesis-red text-white font-bold rounded-xl shadow-lg shadow-red-500/20 hover:bg-red-700 transition-all">Criar Evento</button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ActivityCircle({ className, size }) {
  return <Clock className={className} size={size} />;
}