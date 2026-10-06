import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Trophy, Plus, Clock,
  ChevronRight, Trash2, Edit2,
  Play, Pause, CheckCircle2, Users, Copy,
  Settings, Layout, X, Layers, Monitor, ArrowUpCircle, ArrowDownCircle, History, Package, Coffee, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import CustomSelect from '../components/CustomSelect';
import { timezoneOptions } from '../lib/timezones';
import TournamentClock from '../components/TournamentClock';
import SessionBar from '../components/SessionBar';
import AllocationModal from '../components/AllocationModal';
import MaterialPanel from '../components/MaterialPanel';
import { can } from '../config';
import { getStoredUser } from '../lib/auth';
import BlindTemplatesModal from '../components/BlindTemplatesModal';
import { enqueue } from '../lib/offlineQueue';
import { tournamentWhen } from '../lib/format';

const StatusBadge = ({ status }) => {
  const styles = {
    scheduled: 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-500',
    running: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500',
    paused: 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500',
    finished: 'bg-raised text-fg-muted'
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

export default function Torneios() {
  const { showAlert, showConfirm, showPrompt } = useAlert();
  const [searchParams] = useSearchParams();
  const [tournaments, setTournaments] = useState([]);
  const [allocations, setAllocations] = useState([]);   // alocações ABERTAS de fichas deste torneio (por denominação/quantidade)
  const [allocModal, setAllocModal] = useState(null);     // null | { editing? }
  const [stackModels, setStackModels] = useState([]);
  const [entries, setEntries] = useState([]);
  const [counts, setCounts] = useState(null);             // inscrições × ativos do torneio (servidor)
  const [activeInput, setActiveInput] = useState('');
  const [chipsInPlay, setChipsInPlay] = useState(null); // fichas em jogo do TORNEIO: calculado no servidor
  const role = getStoredUser()?.role;
  const isAdmin = role === 'admin';
  // permissões por AÇÃO (matriz área × nível): estrutura do torneio é 'manage'; o material opera
  const canManage = can(role, 'torneios', 'manage');
  const canOperateMaterial = can(role, 'torneios', 'operate');
  const canOperateFloor = can(role, 'mesas', 'operate');
  const [events, setEvents] = useState([]);
  const [sessions, setSessions] = useState([]);           // sessões/fases (Dia 1A, 1B…) do torneio aberto
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionInPlay, setSessionInPlay] = useState(null); // fichas em jogo da sessão selecionada
  const sessionRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [selectedTournament, setSelectedTournament] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);             // torneio AGENDADO em edição (o mesmo modal de criação, pré-preenchido)
  const [duplicateOf, setDuplicateOf] = useState(null);       // torneio de origem enquanto o modal de criação é uma duplicação
  const [copyExtra, setCopyExtra] = useState({});             // blinds/stack copiados (não aparecem no formulário)
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'logistica');
  const [blindTplOpen, setBlindTplOpen] = useState(false);

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
    seats_per_table: 9,
    timezone: 'America/Sao_Paulo',
    stack_model_id: '',
    event_id: '',
    number: '',
    sessions_text: '',
    notes: ''
  });

  const fetchTournaments = useCallback(async () => {
    try {
      setTournaments(await apiGet('/tournaments'));
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar torneios', 'error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchTournamentDetails = async (id) => {
    try {
      const data = await apiGet(`/tournaments/${id}`);
      setSelectedTournament(data);
      fetchFloorData(id);
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao abrir torneio', 'error');
    }
  };

  // Dados do salão: sessões, entradas e fichas em jogo. A sessão selecionada filtra entradas e fichas da sessão;
  // `chipsInPlay` continua sendo do torneio inteiro (fichários e stack são do torneio).
  const fetchFloorData = async (id, sessionOverride) => {
    try {
      const [sessionsData, stacksData, inPlayData, allocData] = await Promise.all([
        apiGet(`/tournaments/${id}/sessions`),
        apiGet('/stacks'),
        apiGet(`/tournaments/${id}/chips-in-play`),
        apiGet('/allocations', { tournament_id: id }),
      ]);
      setAllocations(allocData);
      setSessions(sessionsData);
      setStackModels(stacksData);
      setChipsInPlay(inPlayData);

      // sessão ativa: a escolhida, senão a em andamento, senão a primeira
      const wanted = sessionOverride ?? sessionRef.current;
      const current = sessionsData.find((x) => x._id === wanted)
        || sessionsData.find((x) => x.status === 'running') || sessionsData[0] || null;
      sessionRef.current = current?._id || null;
      setSelectedSessionId(sessionRef.current);

      const [entriesData, sessionData] = await Promise.all([
        apiGet(`/tournaments/${id}/entries`, { session_id: current?._id }),
        current ? apiGet(`/tournaments/${id}/sessions/${current._id}/chips-in-play`) : Promise.resolve(null),
      ]);
      setEntries(entriesData);
      setSessionInPlay(sessionData);
      fetchTournamentCounts(id);
    } catch (e) {
      if (e.status !== 401) console.error(e);
    }
  };

  const fetchTournamentCounts = async (id) => {
    try {
      const c = await apiGet(`/tournaments/${id}/headcount`);
      setCounts(c);
      setActiveInput(String(c.active));
    } catch (e) {
      if (e.status !== 401) console.error(e);
    }
  };

  const handleSetActive = async () => {
    try {
      const c = await apiPut(`/tournaments/${selectedTournament._id}/active-players`, { active_players: Number(activeInput) });
      setCounts(c);
      setActiveInput(String(c.active));
      setSelectedTournament((prev) => ({ ...prev, actual_players: c.active }));
      showAlert('Ativos atualizados.', 'success');
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao atualizar jogadores ativos', 'error');
    }
  };

  const selectSession = (sid) => {
    sessionRef.current = sid;
    setSelectedSessionId(sid);
    if (selectedTournament) fetchFloorData(selectedTournament._id, sid);
  };

  const fetchAllocations = async (id) => {
    try { setAllocations(await apiGet('/allocations', { tournament_id: id })); }
    catch (e) { if (e.status !== 401) console.error(e); }
  };

  const fetchStackModels = async () => {
    try {
      setStackModels(await apiGet('/stacks'));
    } catch (e) {
      if (e.status !== 401) console.error(e);
    }
  };

  useEffect(() => {
    fetchTournaments();
    fetchStackModels();
    apiGet('/events').then(setEvents).catch(() => {});
  }, [fetchTournaments]);

  // Timer para persistência com debounce (edição de blinds / composição de stack)
  const saveTimer = React.useRef(null);
  const debouncedSave = useCallback((id, updates) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      // trava otimista: envia a versão de blinds que está na tela
      const body = updates.blind_structure !== undefined
        ? { ...updates, blind_version: selectedTournament?.blind_version ?? 0 }
        : updates;
      apiPut(`/tournaments/${id}`, body)
        .then((r) => {
          if (r?.tournament?.blind_version !== undefined) {
            setSelectedTournament((prev) => (prev ? { ...prev, blind_version: r.tournament.blind_version } : prev));
          }
          fetchTournaments();
        })
        .catch(err => {
          if (err.status === 409) {
            showAlert('A estrutura foi alterada em outro dispositivo. Recarregando…', 'error');
            fetchTournamentDetails(id);
          } else if (err.status !== 401) {
            showAlert(err.message || 'Erro ao salvar', 'error');
          }
        });
    }, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTournament?.blind_version]);

  // O stack NÃO é escolhido por entrada: vem da AÇÃO (buy_in, optional_buy_in, re_entry, add_on…) e do
  // modelo mapeado no torneio. `quantity` > 1 registra várias ações de uma vez. Não há cadastro de jogadores:
  // cada entrada é numerada ("Entrada #n") e é ela que ocupa a mesa.
  const handleRegisterEntry = async (type, action) => {
    const quantity = Math.max(1, parseInt(form.entry_quantity, 10) || 1);
    const path = `/tournaments/${selectedTournament._id}/entries`;
    const body = {
      type,
      action: action || undefined,
      session_id: selectedSessionId || undefined,
      quantity: quantity > 1 ? quantity : undefined,
    };
    try {
      await apiPost(path, body);
      showAlert(quantity > 1 ? `${quantity} entradas registradas!` : 'Entrada registrada!', 'success');
      setForm(f => ({ ...f, entry_quantity: 1 }));
      fetchFloorData(selectedTournament._id);
      fetchTournaments();
      fetchTournamentCounts(selectedTournament._id);
    } catch (e) {
      if (e.status === 0) {
        enqueue(path, body);
        setForm(f => ({ ...f, entry_quantity: 1 }));
        showAlert('Sem conexão — entrada salva offline. Sincroniza quando a rede voltar.', 'info');
      } else if (e.status !== 401) {
        showAlert(e.message || 'Erro ao registrar entrada', 'error');
      }
    }
  };

  // Duplicar: abre o modal de criação pré-preenchido com a configuração do torneio aberto.
  const openDuplicate = () => {
    const t = selectedTournament;
    const stripId = (rows) => (rows || []).map(({ _id, ...row }) => row);
    setForm({
      name: `${t.name} (cópia)`,
      date: t.starts_at
        ? new Date(t.starts_at).toLocaleDateString('en-CA', { timeZone: t.timezone || 'America/Sao_Paulo' })
        : String(t.date || '').slice(0, 10),
      start_time: t.start_time || '20:00',
      seats_per_table: t.seats_per_table ?? 9,
      timezone: t.timezone || 'America/Sao_Paulo',
      stack_model_id: t.stack_model_id || '',
      event_id: t.event_id || '',
      number: '',
      sessions_text: sessions.map((x) => x.name).join(', '),
      notes: t.notes || '',
    });
    setCopyExtra({ stack_models: stripId(t.stack_models), blind_structure: stripId(t.blind_structure) });
    setDuplicateOf(t);
    setIsCreateModalOpen(true);
  };

  // Editar: só torneios AGENDADOS (depois de iniciado, nome/data/horário/fuso ficam fixos — o servidor também barra).
  const openEdit = () => {
    const t = selectedTournament;
    setForm({
      name: t.name,
      date: t.starts_at
        ? new Date(t.starts_at).toLocaleDateString('en-CA', { timeZone: t.timezone || 'America/Sao_Paulo' })
        : String(t.date || '').slice(0, 10),
      start_time: t.start_time || '20:00',
      seats_per_table: t.seats_per_table ?? 9,
      timezone: t.timezone || 'America/Sao_Paulo',
      stack_model_id: t.stack_model_id || '',
      event_id: t.event_id || '',
      number: t.number ?? '',
      sessions_text: '',
      notes: t.notes || '',
    });
    setEditing(t);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => { setIsCreateModalOpen(false); setDuplicateOf(null); setEditing(null); setCopyExtra({}); };

  const handleCreateTournament = async (e) => {
    e.preventDefault();
    if (editing) {
      const { sessions_text, ...rest } = form; // sessões não mudam por aqui
      void sessions_text;
      const ok = await handleUpdateTournament(editing._id, {
        name: rest.name.trim(), date: rest.date, start_time: rest.start_time, timezone: rest.timezone,
        seats_per_table: Number(rest.seats_per_table), stack_model_id: rest.stack_model_id || null,
        event_id: rest.event_id || null, number: rest.number ? Number(rest.number) : null, notes: rest.notes,
      });
      if (ok) { showAlert('Torneio atualizado!', 'success'); closeCreateModal(); }
      return;
    }
    try {
      // sessões/fases: uma por linha ou separadas por vírgula (só o admin as define; sem isso nasce "Dia Único")
      const { sessions_text, ...rest } = form;
      const names = isAdmin ? sessions_text.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) : [];
      await apiPost('/tournaments', {
        ...rest, ...copyExtra, event_id: rest.event_id || undefined, number: rest.number ? Number(rest.number) : undefined,
        sessions: names.length ? names : undefined,
      });
      showAlert(duplicateOf ? 'Torneio duplicado!' : 'Torneio criado!', 'success');
      closeCreateModal();
      fetchTournaments();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao criar torneio', 'error');
    }
  };

  const handleUpdateTournament = async (id, updates, opts = {}) => {
    try {
      await apiPut(`/tournaments/${id}`, opts.finishSessions ? { ...updates, finish_sessions: true } : updates);
      if (selectedTournament && selectedTournament._id === id) fetchTournamentDetails(id);
      fetchTournaments();
      return true;
    } catch (e) {
      // o torneio só fecha com as sessões encerradas: oferece encerrá-las junto
      if (e.status === 409 && Array.isArray(e.data?.details) && ['finished', 'finalized'].includes(updates.status) && !opts.finishSessions && !isAdmin) {
        const names = e.data.details.map((x) => x.name).join(', ');
        showAlert(`Há sessões pendentes (${names}). Encerre cada sessão; encerrar todas de uma vez é exclusivo do administrador.`, 'error');
        return false;
      }
      if (e.status === 409 && Array.isArray(e.data?.details) && ['finished', 'finalized'].includes(updates.status) && !opts.finishSessions) {
        const names = e.data.details.map((x) => x.name).join(', ');
        if (await showConfirm(`Há sessões pendentes (${names}). Encerrá-las e finalizar o torneio?`)) {
          return handleUpdateTournament(id, updates, { finishSessions: true });
        }
        return false;
      }
      if (e.status !== 401) showAlert(e.message || 'Erro ao atualizar torneio', 'error');
      return false;
    }
  };

  // Atualiza o estado local imediatamente e persiste com debounce (evita 1 request por tecla)
  const handleUpdateBlind = (index, field, value) => {
    if (!selectedTournament) return;
    const newBlinds = [...(selectedTournament.blind_structure || [])];
    if (!newBlinds[index]) {
      newBlinds[index] = { row_type: 'level', level: index + 1, small_blind: 0, big_blind: 0, ante: 0, duration: 20 };
    }
    newBlinds[index] = { ...newBlinds[index], [field]: parseInt(value, 10) || 0 };
    setSelectedTournament(prev => ({ ...prev, blind_structure: newBlinds }));
    debouncedSave(selectedTournament._id, { blind_structure: newBlinds });
  };

  const removeBlindLevel = (index) => {
    if (!selectedTournament) return;
    const newBlinds = selectedTournament.blind_structure.filter((_, i) => i !== index);
    handleUpdateTournament(selectedTournament._id, { blind_structure: newBlinds });
  };

  const addBlindLevel = () => {
    const current = selectedTournament.blind_structure || [];
    const levels = current.filter(r => !r.row_type || r.row_type === 'level');
    const lastLevel = levels.length > 0 ? levels[levels.length - 1] : { small_blind: 50, big_blind: 100, ante: 0, duration: 20 };
    const nextLevel = {
      row_type: 'level',
      level: levels.length + 1,
      small_blind: lastLevel.small_blind * 2,
      big_blind: lastLevel.big_blind * 2,
      ante: lastLevel.ante * 2,
      duration: lastLevel.duration
    };
    handleUpdateTournament(selectedTournament._id, { blind_structure: [...current, nextLevel] });
  };

  const addBreakRow = (durationMins) => {
    const current = selectedTournament.blind_structure || [];
    handleUpdateTournament(selectedTournament._id, {
      blind_structure: [...current, { row_type: 'break', duration: durationMins, label: `Break ${durationMins} min` }]
    });
  };

  const addSpecialRow = (row_type) => {
    const current = selectedTournament.blind_structure || [];
    const labels = { end_registration: 'Fim do Registro', end_day: 'Fim do Dia Classificatório' };
    handleUpdateTournament(selectedTournament._id, {
      blind_structure: [...current, { row_type, label: labels[row_type] }]
    });
  };

  const handleDeleteTournament = async (id) => {
    const confirmed = await showConfirm('Excluir este torneio? Fichários alocados serão liberados.');
    if (!confirmed) return;
    try {
      await apiDelete(`/tournaments/${id}`);
      showAlert('Torneio removido', 'success');
      fetchTournaments();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao remover torneio', 'error');
    }
  };

  // ── Stack por ação (o cálculo é do servidor; aqui só escolhemos os modelos) ──────────────
  const FIXED_ACTIONS = ['re_entry', 'add_on'];
  const modelById = (id) => stackModels.find((m) => m._id === id);
  const tournamentModels = () => {
    if (!selectedTournament) return [];
    const ids = [selectedTournament.stack_model_id, ...(selectedTournament.stack_models || []).map((m) => m.stack_model_id)];
    return [...new Set(ids.filter(Boolean))].map(modelById).filter(Boolean);
  };
  // colunas conhecidas pelos modelos do torneio (rótulos vêm do modelo)
  const stackActions = () => {
    const map = new Map([['buy_in', 'Buy-in padrão'], ['re_entry', 'Reentrada']]);
    tournamentModels().forEach((m) => m.actions.forEach((a) => map.set(a.key, a.label)));
    if (selectedTournament?.addon_value > 0) map.set('add_on', map.get('add_on') || 'Add-on');
    return [...map].map(([key, label]) => ({ key, label }));
  };
  const buyInVariants = () => stackActions().filter((a) => a.key !== 'buy_in' && !FIXED_ACTIONS.includes(a.key));

  const handleMapStack = async (action, modelId) => {
    const others = (selectedTournament.stack_models || []).filter((m) => m.action !== action);
    const next = modelId ? [...others, { action, stack_model_id: modelId }] : others;
    if (await handleUpdateTournament(selectedTournament._id, { stack_models: next })) fetchFloorData(selectedTournament._id);
  };
  const handleDefaultStack = async (modelId) => {
    if (await handleUpdateTournament(selectedTournament._id, { stack_model_id: modelId || null })) fetchFloorData(selectedTournament._id);
  };

  // fichas ALOCADAS a este torneio (por denominação e quantidade) — só para comparar com a necessidade
  const inCases = {};
  let casesValue = 0;
  allocations.forEach((a) => a.chips.forEach((l) => {
    const id = l.chip_id?._id || l.chip_id;
    inCases[id] = (inCases[id] || 0) + l.quantity;
    casesValue += l.quantity * (l.chip_id?.value || 0);
  }));

  const releaseAllocation = async (alloc) => {
    const name = alloc.binder_id?.name || 'fichário';
    if (!(await showConfirm(`Liberar a alocação de "${name}"? As fichas voltam a ficar livres para outros torneios.`))) return;
    try {
      await apiDelete(`/allocations/${alloc._id}`);
      showAlert('Alocação liberada', 'success');
      fetchAllocations(selectedTournament._id);
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao liberar alocação', 'error'); }
  };

  const eventName = (id) => events.find((ev) => ev._id === id)?.name;
  const sessionClosed = sessions.find((x) => x._id === selectedSessionId)?.status === 'finished';
  // entradas: bloqueadas com o torneio encerrado OU a sessão encerrada
  // o Material só consulta as entradas: quem lança é o Salão (ou o admin)
  const entriesLocked = ['finished', 'finalized'].includes(selectedTournament?.status) || sessionClosed || !canOperateFloor;

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="page-title">Torneios</h1>
          <p className="page-sub">Gerenciamento central de eventos e logística de fichas.</p>
        </div>
        {canManage && (
          <button onClick={() => { setDuplicateOf(null); setCopyExtra({}); setIsCreateModalOpen(true); }} className="px-6 py-3 rounded-xl font-bold bg-brand text-white hover:bg-brand-hover transition-all flex items-center gap-2">
            <Plus size={18} /> Novo Torneio
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-fg-subtle animate-pulse">Carregando eventos...</div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <AnimatePresence>
            {tournaments.map((t) => (
              <motion.div
                key={t._id}
                layoutId={t._id}
                onClick={() => {
                  fetchTournamentDetails(t._id);
                }}
                className="card p-5 hover:border-brand transition-all cursor-pointer group flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-xl ${t.status === 'running' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500' : 'bg-raised text-fg-subtle'}`}>
                    <Trophy size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-fg">
                      {t.number ? <span className="text-brand-fg mr-1">#{String(t.number).padStart(2, '0')}</span> : null}{t.name}
                    </h3>
                    {eventName(t.event_id) && <p className="text-xs font-bold uppercase tracking-wide text-fg-subtle">{eventName(t.event_id)}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-muted">
                      <span className="flex items-center gap-1"><Clock size={14} /> {tournamentWhen(t)}</span>
                      <span className="flex items-center gap-1"><Users size={14} /> {t.actual_players || 0} jogando · {(t.entries_initial || 0) + (t.entries_reentries || 0)} inscrições</span>
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
          {tournaments.length === 0 && <div className="text-center py-10 text-fg-muted italic">Nenhum torneio agendado.</div>}
        </div>
      )}

      {allocModal && selectedTournament && (
        <AllocationModal
          tournament={selectedTournament}
          editing={allocModal.editing}
          onClose={() => setAllocModal(null)}
          onDone={() => { setAllocModal(null); fetchAllocations(selectedTournament._id); fetchTournaments(); }}
        />
      )}

      {/* Detail Modal Overlay */}
      <AnimatePresence>
        {selectedTournament && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setSelectedTournament(null)}
          >
            <motion.div
              initial={{ y: '100%', opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              className="bg-sunken dark:bg-canvas w-full max-w-6xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
              style={{ maxHeight: '92dvh' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="p-4 md:p-6 bg-surface border-b border-line sticky top-0 z-10">
                {/* Row 1: Title + close */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <button onClick={() => setSelectedTournament(null)} className="md:hidden p-1.5 rounded-lg text-fg-muted hover:bg-sunken shrink-0"><X size={18} /></button>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg md:text-2xl font-bold text-fg leading-tight">{selectedTournament.name}</h2>
                        <StatusBadge status={selectedTournament.status} />
                      </div>
                      <p className="text-xs text-fg-muted font-medium mt-0.5">{tournamentWhen(selectedTournament)}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedTournament(null)} className="hidden md:flex p-2 rounded-xl text-fg-subtle hover:text-gray-600 transition-all shrink-0"><X size={22} /></button>
                </div>

                {/* Row 2: Tabs + Action buttons */}
                <div className="flex items-center justify-between gap-3">
                  {/* Tab switcher — visible on all sizes */}
                  <div className="flex bg-raised p-1 rounded-xl flex-1 md:flex-none">
                    <button
                      onClick={() => setActiveTab('logistica')}
                      className={`flex-1 md:flex-none px-3 md:px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === 'logistica' ? 'bg-surface dark:bg-zinc-700 text-brand-fg ' : 'text-fg-muted'}`}
                    >
                      <Layout size={13} /> Logística
                    </button>
                    <button
                      onClick={() => setActiveTab('salao')}
                      className={`flex-1 md:flex-none px-3 md:px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === 'salao' ? 'bg-surface dark:bg-zinc-700 text-brand-fg ' : 'text-fg-muted'}`}
                    >
                      <Monitor size={13} /> Salão
                    </button>
                    <button
                      onClick={() => setActiveTab('material')}
                      className={`flex-1 md:flex-none px-3 md:px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${activeTab === 'material' ? 'bg-surface dark:bg-zinc-700 text-brand-fg ' : 'text-fg-muted'}`}
                    >
                      <Package size={13} /> Material
                    </button>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    {canOperateFloor && selectedTournament.status === 'scheduled' && (
                      <button onClick={() => handleUpdateTournament(selectedTournament._id, { status: 'running' })} className="btn btn-success md:px-5 flex items-center"><Play size={14} /> <span className="hidden sm:inline">Iniciar</span></button>
                    )}
                    {canOperateFloor && selectedTournament.status === 'running' && (
                      <button onClick={() => handleUpdateTournament(selectedTournament._id, { status: 'paused' })} className="btn btn-warn md:px-5 flex items-center"><Pause size={14} /> <span className="hidden sm:inline">Pausar</span></button>
                    )}
                    {canOperateFloor && selectedTournament.status === 'paused' && (
                      <button onClick={() => handleUpdateTournament(selectedTournament._id, { status: 'running' })} className="btn btn-success md:px-5 flex items-center"><Play size={14} /> <span className="hidden sm:inline">Retomar</span></button>
                    )}
                    {canOperateFloor && ['running', 'paused'].includes(selectedTournament.status) && (
                      <button onClick={() => handleUpdateTournament(selectedTournament._id, { status: 'finished' })} className="btn btn-neutral md:px-5 flex items-center"><CheckCircle2 size={14} /> <span className="hidden sm:inline">Finalizar</span></button>
                    )}
                    {canManage && selectedTournament.status === 'scheduled' && <button onClick={openEdit} title="Editar torneio" aria-label="Editar torneio" className="btn btn-ghost btn-icon"><Pencil size={16} /></button>}
                    {canManage && <button onClick={openDuplicate} title="Duplicar torneio" className="p-2 rounded-xl text-fg-muted hover:bg-sunken transition-all"><Copy size={16} /></button>}
                    {canManage && <button onClick={() => handleDeleteTournament(selectedTournament._id).then(() => setSelectedTournament(null))} title="Excluir torneio" className="p-2 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"><Trash2 size={16} /></button>}
                  </div>
                </div>
              </div>

              {/* Scrollable content */}
              <div className="overflow-y-auto flex-1">

              {['salao', 'material'].includes(activeTab) && (
                <div className="px-4 md:px-8 pt-6">
                  <SessionBar
                    tournamentId={selectedTournament._id}
                    timezone={selectedTournament.timezone}
                    defaultDate={selectedTournament.starts_at ? new Date(selectedTournament.starts_at).toLocaleDateString('en-CA', { timeZone: selectedTournament.timezone || 'America/Sao_Paulo' }) : ''}
                    sessions={sessions}
                    selectedId={selectedSessionId}
                    onSelect={selectSession}
                    onChanged={() => fetchFloorData(selectedTournament._id)}
                    isAdmin={isAdmin}
                    canOperate={canOperateFloor}
                    tournamentClosed={['finished', 'finalized'].includes(selectedTournament.status)}
                  />
                </div>
              )}

              {activeTab === 'logistica' ? (
                <div className="p-4 md:p-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* (Existing Logistics View Content) */}
                  <div className="lg:col-span-2 space-y-8">
                    {/* Inscrições × jogadores ativos (BUG-04/05): números distintos, cada um com a sua regra */}
                    <div className="card p-6">
                      <h3 className="text-lg font-bold flex items-center gap-2 mb-6"><Users className="text-brand-fg" /> Inscrições e jogadores</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 text-center">
                        {[
                          ['Entradas iniciais', counts?.entries_initial],
                          ['Reentradas', counts?.entries_reentries],
                          ['Inscrições totais', counts?.entries_total],
                          ['Eliminados', counts?.eliminated],
                        ].map(([label, v]) => (
                          <div key={label} className="rounded-2xl bg-sunken dark:bg-sunken border border-line p-3">
                            <p className="text-xs font-bold uppercase tracking-wide text-fg-subtle">{label}</p>
                            <p className="text-2xl font-bold text-fg">{v ?? '—'}</p>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-fg-subtle mb-4">Inscrições totais = entradas iniciais + reentradas (acumulado, não muda ao eliminar). Jogando = quem ainda está na mesa.</p>
                      <div className="flex items-center gap-4 bg-sunken dark:bg-sunken p-4 rounded-2xl border border-line">
                        <div className="flex-1">
                          <p className="text-xs font-bold uppercase tracking-wide text-fg-subtle">Jogando (jogadores ativos)</p>
                          <input
                            aria-label="Ativos"
                            disabled={!canOperateFloor || selectedTournament.status === 'finished'}
                            type="number" min="0"
                            value={activeInput}
                            onChange={(e) => setActiveInput(e.target.value)}
                            className="w-full bg-transparent text-3xl font-bold text-fg focus:outline-none disabled:opacity-50"
                          />
                        </div>
                        {canOperateFloor && (
                          <button
                            onClick={handleSetActive}
                            disabled={selectedTournament.status === 'finished' || activeInput === '' || Number(activeInput) === counts?.active}
                            className="btn btn-primary disabled:opacity-30"
                          >
                            Atualizar jogando
                          </button>
                        )}
                      </div>
                      {!canOperateFloor && <p className="mt-2 text-xs text-fg-subtle">Quem informa os jogadores ativos é o Salão (ou o administrador); o Material só consulta.</p>}
                    </div>

                    {/* Blinds Section */}
                    <div className={`bg-surface rounded-3xl p-6 border border-line  overflow-hidden ${canManage ? '' : 'pointer-events-none opacity-70'}`} aria-disabled={!canManage}>
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold flex items-center gap-2"><History className="text-blue-500" /> Estrutura de Blinds</h3>
                        {canManage && (
                          <button onClick={() => setBlindTplOpen(true)} className="text-xs font-bold uppercase tracking-wide text-fg-subtle hover:text-brand-fg">
                            Templates
                          </button>
                        )}
                      </div>
                      {/* Add-row buttons (estrutura: só quem administra) */}
                      <div className={`flex flex-wrap gap-2 mb-3 ${canManage ? '' : 'hidden'}`}>
                        <button onClick={addBlindLevel} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-raised hover:bg-brand hover:text-white transition-all flex items-center gap-1">
                          <Plus size={12} /> Nível
                        </button>
                        {[15, 45, 60, 90].map(d => (
                          <button key={d} onClick={() => addBreakRow(d)} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500 hover:text-white transition-all">
                            Break {d}min
                          </button>
                        ))}
                        <button onClick={() => addSpecialRow('end_registration')} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500 hover:text-white transition-all">
                          Fim Registro
                        </button>
                        <button onClick={() => addSpecialRow('end_day')} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500 hover:text-white transition-all">
                          Fim do Dia
                        </button>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="text-fg-subtle font-bold border-b border-line-soft">
                              <th className="py-3 pr-4">Nível</th>
                              <th className="py-3 px-2">SB</th>
                              <th className="py-3 px-2">BB</th>
                              <th className="py-3 px-2">Ante</th>
                              <th className="py-3 px-2">Min</th>
                              <th className="py-3 pl-4 text-right">Ação</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(selectedTournament.blind_structure || []).map((lvl, idx) => {
                              const isBreak = lvl.row_type === 'break';
                              const isSpecial = lvl.row_type === 'end_registration' || lvl.row_type === 'end_day';
                              if (isSpecial) return (
                                <tr key={idx} className="border-b border-line-soft group">
                                  <td colSpan={5} className="py-2 pr-4">
                                    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${
                                      lvl.row_type === 'end_registration' ? 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400'
                                    }`}>
                                      <span className="dot" aria-hidden="true" /> {lvl.label}
                                    </span>
                                  </td>
                                  <td className="py-2 pl-4 text-right">
                                    <button onClick={() => removeBlindLevel(idx)} className="p-2 text-fg-subtle hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16} /></button>
                                  </td>
                                </tr>
                              );
                              if (isBreak) return (
                                <tr key={idx} className="border-b border-line-soft group bg-amber-50/30 dark:bg-amber-500/5">
                                  <td className="py-2 pr-4">
                                    <span className="badge badge-warn"><Coffee size={14} aria-hidden="true" /> Intervalo</span>
                                  </td>
                                  <td colSpan={3} className="py-2 px-2 text-fg-subtle text-xs">—</td>
                                  <td className="py-2 px-2">
                                    <select
                                      value={lvl.duration}
                                      onChange={(e) => handleUpdateBlind(idx, 'duration', e.target.value)}
                                      className="bg-transparent text-amber-600 dark:text-amber-400 font-bold text-xs outline-none cursor-pointer"
                                    >
                                      {[10, 15, 20, 30, 45, 60, 90].map(d => <option key={d} value={d}>{d} min</option>)}
                                    </select>
                                  </td>
                                  <td className="py-2 pl-4 text-right">
                                    <button onClick={() => removeBlindLevel(idx)} className="p-2 text-fg-subtle hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16} /></button>
                                  </td>
                                </tr>
                              );
                              // Normal level row
                              const levelNum = (selectedTournament.blind_structure || []).slice(0, idx + 1).filter(r => !r.row_type || r.row_type === 'level').length;
                              return (
                                <tr key={idx} className="border-b border-line-soft hover:bg-sunken/50 dark:hover:bg-zinc-800/30 transition-colors group">
                                  <td className="py-2 pr-4 font-bold text-fg-subtle">{levelNum}</td>
                                  <td className="py-2 px-2"><input type="number" value={lvl.small_blind} onChange={(e) => handleUpdateBlind(idx, 'small_blind', e.target.value)} className="w-20 bg-transparent font-bold focus:text-genesis-red outline-none" /></td>
                                  <td className="py-2 px-2"><input type="number" value={lvl.big_blind} onChange={(e) => handleUpdateBlind(idx, 'big_blind', e.target.value)} className="w-20 bg-transparent font-bold focus:text-genesis-red outline-none" /></td>
                                  <td className="py-2 px-2 text-fg-muted"><input type="number" value={lvl.ante} onChange={(e) => handleUpdateBlind(idx, 'ante', e.target.value)} className="w-16 bg-transparent focus:text-genesis-red outline-none" /></td>
                                  <td className="py-2 px-2 text-fg-muted"><input type="number" value={lvl.duration} onChange={(e) => handleUpdateBlind(idx, 'duration', e.target.value)} className="w-12 bg-transparent focus:text-genesis-red outline-none" /></td>
                                  <td className="py-2 pl-4 text-right"><button onClick={() => removeBlindLevel(idx)} className="p-2 text-fg-subtle hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={16} /></button></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-8">
                    {/* Fichas necessárias (calculadas no servidor) × fichários alocados */}
                    <div className="card p-6">
                      <h3 className="text-lg font-bold mb-2 flex items-center gap-2"><Settings className="text-emerald-500" size={20} /> Fichas necessárias</h3>
                      <p className="text-xs text-fg-muted mb-5">Ações registradas × modelo de stack de cada ação. Calculado automaticamente.</p>

                      {!chipsInPlay || chipsInPlay.rows.length === 0 ? (
                        <p className="text-sm text-fg-subtle italic mb-4">
                          Ainda não há fichas calculadas. Escolha o modelo de stack e registre as entradas na aba Salão.
                        </p>
                      ) : (
                        <div className="space-y-4">
                          <div className="grid grid-cols-3 text-xs uppercase font-bold text-fg-subtle px-1">
                            <div>Ficha</div>
                            <div className="text-center">Necessário</div>
                            <div className="text-right">Nos fichários</div>
                          </div>
                          {chipsInPlay.rows.map((row) => {
                            const needed = row.quantity;
                            const available = inCases[row.chip._id] || 0;
                            const isShort = available < needed;
                            return (
                              <div key={row.chip._id} className="space-y-1.5">
                                <div className="grid grid-cols-3 items-center gap-2">
                                  <div className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: row.chip.color }}></div>
                                    <span className="text-sm font-bold text-fg">{row.chip.value?.toLocaleString()}</span>
                                  </div>
                                  <div className={`text-center text-xs font-bold ${isShort ? 'text-red-500' : 'text-emerald-500'}`}>{needed.toLocaleString()}</div>
                                  <div className="text-right text-xs font-bold text-fg-muted">{available.toLocaleString()}</div>
                                </div>
                                <div className="w-full h-1 bg-raised rounded-full overflow-hidden">
                                  <div className={`h-full transition-all duration-500 ${isShort ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, (available / (needed || 1)) * 100)}%` }}></div>
                                </div>
                              </div>
                            );
                          })}
                          <div className="pt-4 border-t border-line-soft space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-fg-muted">Valor em jogo</span>
                              <span className="font-bold">{chipsInPlay.totals.value.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-fg-muted">Valor nos fichários alocados</span>
                              <span className="font-bold text-emerald-600">{casesValue.toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                      )}
                      {chipsInPlay?.uncovered?.length > 0 && (
                        <p className="mt-4 text-xs text-amber-600">
                          Sem fichas definidas para: {chipsInPlay.uncovered.map((u) => `${u.label} (${u.count})`).join(', ')}. Escolha um modelo com essa coluna.
                        </p>
                      )}

                      <div className="mt-6 pt-5 border-t border-line-soft space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-fg-subtle">Modelo de stack</h4>
                        <CustomSelect
                          disabled={selectedTournament.status === 'finished' || !canManage}
                          options={[{ value: '', label: 'Nenhum' }, ...stackModels.map((m) => ({ value: m._id, label: m.name }))]}
                          value={selectedTournament.stack_model_id || ''}
                          onChange={handleDefaultStack}
                          placeholder="Modelo padrão"
                        />
                        {stackActions().length > 0 && (
                          <details className="text-xs">
                            <summary className="cursor-pointer font-bold text-fg-muted">Usar outro modelo em uma ação específica</summary>
                            <div className="mt-3 space-y-3">
                              {stackActions().map((a) => (
                                <div key={a.key} className="grid grid-cols-[110px_1fr] items-center gap-2">
                                  <span className="font-bold text-fg-muted truncate" title={a.label}>{a.label}</span>
                                  <CustomSelect
                                    disabled={selectedTournament.status === 'finished'}
                                    options={[{ value: '', label: '(modelo padrão)' }, ...stackModels.map((m) => ({ value: m._id, label: m.name }))]}
                                    value={(selectedTournament.stack_models || []).find((m) => m.action === a.key)?.stack_model_id || ''}
                                    onChange={(v) => handleMapStack(a.key, v)}
                                  />
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>

                    {/* Alocação de fichas (por denominação e quantidade) */}
                    <div className="card p-6 overflow-visible">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold flex items-center gap-2"><Package className="text-amber-500" size={20} /> Fichas Alocadas</h3>
                        {isAdmin && !['finished', 'finalized'].includes(selectedTournament.status) && (
                          <button onClick={() => setAllocModal({})} className="text-xs font-bold uppercase tracking-wide text-brand-fg hover:text-red-700 flex items-center gap-1"><Plus size={14} /> Alocar</button>
                        )}
                      </div>
                      <div className="space-y-3">
                        {allocations.length === 0 && (
                          <p className="text-sm text-fg-subtle italic">
                            Nenhuma ficha alocada.{isAdmin ? '' : ' O administrador define as alocações.'}
                          </p>
                        )}
                        {allocations.map((a) => (
                          <div key={a._id} className="p-3 bg-sunken dark:bg-sunken rounded-xl border border-line space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-bold text-fg truncate">{a.binder_id?.name}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${a.status === 'active' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10' : 'bg-amber-100 text-amber-600 dark:bg-amber-500/10'}`}>{a.status === 'active' ? 'ativa' : 'planejada'}</span>
                                {isAdmin && (
                                  <>
                                    <button onClick={() => setAllocModal({ editing: a })} title="Editar" className="p-1 text-fg-subtle hover:text-blue-500 rounded-lg"><Edit2 size={14} /></button>
                                    <button onClick={() => releaseAllocation(a)} title="Liberar" className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"><X size={16} /></button>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {a.chips.map((l) => (
                                <span key={l.chip_id?._id} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-bold ${l.shortfall > 0 ? 'bg-red-100 text-red-600 dark:bg-red-500/10' : 'bg-raised text-fg-muted dark:bg-zinc-800 '}`}
                                  title={l.shortfall > 0 ? `Faltam ${l.shortfall}: o saldo do fichário é ${l.balance}` : undefined}>
                                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.chip_id?.color }}></span>
                                  {l.chip_id?.value?.toLocaleString()} × {l.quantity.toLocaleString()}
                                </span>
                              ))}
                            </div>
                            {a.has_shortfall && <p className="text-xs text-red-500 font-bold">Falta de fichas: o saldo físico ficou abaixo do alocado (perda apurada?).</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )
              : activeTab === 'material' ? (
                <MaterialPanel
                  tournament={selectedTournament}
                  sessions={sessions}
                  sessionId={selectedSessionId}
                  canOperate={canOperateMaterial}
                  isAdmin={isAdmin}
                  stackActions={stackActions()}
                  closed={['finished', 'finalized'].includes(selectedTournament.status)}
                  refreshKey={allocations.length}
                  onChanged={() => { fetchAllocations(selectedTournament._id); fetchFloorData(selectedTournament._id); }}
                />
              ) : (
                <div className="p-4 md:p-8 space-y-8">
                  {(selectedTournament.status === 'finished' || selectedTournament.status === 'finalized') && (
                    <div className="bg-raised/50 p-4 rounded-2xl flex items-center justify-center gap-3 border border-dashed border-line">
                      <CheckCircle2 className="text-fg-subtle" size={20} />
                      <span className="text-sm font-bold text-fg-subtle uppercase tracking-wide">
                        {selectedTournament.status === 'finalized' ? 'Torneio Finalizado' : 'Torneio Finalizado - Auditoria Apenas'}
                      </span>
                    </div>
                  )}

                  {/* Relógio do torneio */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold uppercase tracking-wide text-fg-subtle">Relógio</h3>
                      <Link
                        to={`/torneios/${selectedTournament._id}/telao`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-raised px-3 py-1.5 text-xs font-bold text-fg-muted hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                      >
                        <Monitor size={13} /> Abrir telão
                      </Link>
                    </div>
                    {(selectedTournament.blind_structure || []).length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-line p-4 text-center text-sm text-fg-subtle">
                        Monte a estrutura de blinds na aba <b>Logística</b> para usar o relógio.
                      </p>
                    ) : (
                      <TournamentClock
                        tournamentId={selectedTournament._id}
                        variant="panel"
                        canControl={selectedTournament.status !== 'finished' && canOperateFloor}
                      />
                    )}
                  </div>

                  {/* Visão do Salão View */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="card p-6">
                      <p className="text-xs font-bold text-fg-subtle uppercase mb-1">Entradas Totais</p>
                      <h4 className="text-3xl font-bold text-fg">{entries.length}</h4>
                    </div>
                    <div className="card p-6">
                      <p className="text-xs font-bold text-fg-subtle uppercase mb-1">Buy-ins</p>
                      <h4 className="text-3xl font-bold text-emerald-500">{entries.filter(e => e.type === 'buy-in').length}</h4>
                    </div>
                    <div className="card p-6">
                      <p className="text-xs font-bold text-fg-subtle uppercase mb-1">Re-entries</p>
                      <h4 className="text-3xl font-bold text-blue-500">{entries.filter(e => e.type === 're-entry').length}</h4>
                    </div>
                    <div className="card p-6">
                      <p className="text-xs font-bold text-fg-subtle uppercase mb-1">Fichas em Jogo{sessions.length > 1 ? ' (sessão)' : ''}</p>
                      <h4 className="text-3xl font-bold text-amber-500">{(sessionInPlay?.totals.value ?? 0).toLocaleString()}</h4>
                      {sessions.length > 1 && <p className="text-xs text-fg-subtle mt-1">torneio: {(chipsInPlay?.totals.value ?? 0).toLocaleString()}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Entry Registration Form */}
                    <div className="lg:col-span-1 space-y-6">
                      <div className="card p-6">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><ArrowUpCircle className="text-emerald-500" /> Registrar Entrada</h3>
                        <div className="space-y-4">
                          <div>
                            <label className="text-xs font-bold text-fg-subtle uppercase mb-2 block">Quantidade de ações</label>
                            <input
                              type="number" min="1" max="500" value={form.entry_quantity ?? 1}
                              onChange={(e) => setForm({ ...form, entry_quantity: e.target.value })}
                              className="input w-full"
                            />
                            <p className="mt-1 text-xs text-fg-subtle">Mais de 1 registra várias de uma vez; cada uma é numerada ("Entrada #n"). O stack vem do modelo da ação.</p>
                          </div>
                          <div className="grid grid-cols-2 gap-3 pt-2">
                            <button
                              onClick={() => handleRegisterEntry('buy-in', 'buy_in')}
                              disabled={entriesLocked}
                              className="py-3 bg-emerald-500 text-white font-bold rounded-xl hover:bg-emerald-600 transition-all flex flex-col items-center justify-center gap-1 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
                            >
                              <Plus size={18} /> Buy-in
                            </button>
                            <button
                              onClick={() => handleRegisterEntry('re-entry', 're_entry')}
                              disabled={entriesLocked}
                              className="py-3 bg-blue-500 text-white font-bold rounded-xl hover:bg-blue-600 transition-all flex flex-col items-center justify-center gap-1 disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
                            >
                              <Plus size={18} /> Re-entry
                            </button>
                            {buyInVariants().map((a) => (
                              <button
                                key={a.key}
                                onClick={() => handleRegisterEntry('buy-in', a.key)}
                                disabled={entriesLocked}
                                className="col-span-2 py-2.5 bg-emerald-600/90 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all flex items-center justify-center gap-2 disabled:opacity-30"
                              >
                                <Plus size={16} /> Buy-in — {a.label}
                              </button>
                            ))}
                            {selectedTournament.addon_value > 0 && (
                              <button
                                onClick={() => handleRegisterEntry('add-on', 'add_on')}
                                disabled={entriesLocked}
                                className="col-span-2 py-2.5 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition-all flex items-center justify-center gap-2 disabled:opacity-30"
                              >
                                <Plus size={16} /> Add-on
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Chips in Play (Consolidated) */}
                      <div className="card p-6">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Layers className="text-amber-500" /> Fichas em Jogo</h3>
                        <div className="space-y-3">
                          {(sessionInPlay?.rows || []).map(row => (
                            <div key={row.chip._id} className="flex items-center justify-between p-3 bg-sunken dark:bg-sunken rounded-xl border border-line">
                              <div className="flex items-center gap-3">
                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: row.chip.color }}></div>
                                <span className="font-bold text-fg">Ficha {row.chip.value?.toLocaleString()}</span>
                              </div>
                              <span className="font-bold text-fg">{row.quantity.toLocaleString()}</span>
                            </div>
                          ))}
                          {(!sessionInPlay || sessionInPlay.rows.length === 0) && <p className="text-xs text-fg-subtle italic">Nenhuma ficha em jogo nesta sessão.</p>}
                          {sessionInPlay?.uncovered?.length > 0 && (
                            <p className="text-xs text-amber-600">Sem fichas para: {sessionInPlay.uncovered.map((u) => `${u.label} (${u.count})`).join(', ')}.</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* History */}
                    <div className="lg:col-span-2">
                      <div className="card p-6 h-full flex flex-col">
                        <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><History className="text-fg-subtle" /> Histórico de Entradas</h3>
                        <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                          {entries.map(entry => (
                            <div key={entry._id} className="flex items-center justify-between p-4 bg-sunken dark:bg-sunken rounded-2xl border border-line hover:border-gray-300 dark:hover:border-zinc-700 transition-all group">
                              <div className="flex items-center gap-4">
                                <div className={`p-2 rounded-xl ${entry.type === 'buy-in' ? 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-500' : entry.type === 'add-on' ? 'bg-amber-100 dark:bg-amber-500/10 text-amber-500' : 'bg-blue-100 dark:bg-blue-500/10 text-blue-500'}`}>
                                  {entry.type === 'buy-in' ? <ArrowUpCircle size={20} /> : entry.type === 'add-on' ? <Plus size={20} /> : <ArrowDownCircle size={20} />}
                                </div>
                                <div>
                                  <p className="font-bold text-fg uppercase tracking-tight text-sm">
                                    {entry.number != null ? `Entrada #${entry.number} · ` : ''}{entry.type === 'buy-in' ? 'Buy-in' : entry.type === 'add-on' ? 'Add-on' : 'Re-entrada'}
                                  </p>
                                  <p className="text-xs text-fg-muted font-medium">
                                    {entry.type}{entry.action && entry.action !== { 'buy-in': 'buy_in', 're-entry': 're_entry', 'add-on': 'add_on' }[entry.type] ? ` (${(chipsInPlay?.actions.find((x) => x.key === entry.action)?.label) || entry.action})` : ''} · {new Date(entry.timestamp).toLocaleTimeString()}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 text-right">
                                {['finished', 'finalized'].includes(selectedTournament.status) ? null : (
                                  <button
                                    onClick={async () => {
                                      // entradas não são apagadas: cancelam-se com motivo (fica no histórico)
                                      const reason = await showPrompt('Motivo do cancelamento desta entrada (obrigatório):', { title: 'Cancelar entrada', confirmLabel: 'Cancelar entrada' });
                                      if (!reason?.trim()) return;
                                      try {
                                        await apiPost(`/tournaments/${selectedTournament._id}/entries/${entry._id}/cancel`, { reason: reason.trim() });
                                        fetchFloorData(selectedTournament._id);
                                        fetchTournaments();
                                      } catch (err) { if (err.status !== 401) showAlert(err.message || 'Erro', 'error'); }
                                    }}
                                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                                    title="Cancelar entrada"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                )}
                                <p className="text-sm font-bold text-fg">#{entries.length - entries.indexOf(entry)}</p>
                              </div>
                            </div>
                          ))}
                          {entries.length === 0 && (
                            <div className="text-center py-20 text-fg-subtle italic">Nenhuma entrada registrada ainda.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              </div>{/* end scrollable */}

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {selectedTournament && (
        <BlindTemplatesModal
          open={blindTplOpen}
          onClose={() => setBlindTplOpen(false)}
          currentRows={selectedTournament.blind_structure || []}
          onApply={(rows) => handleUpdateTournament(selectedTournament._id, { blind_structure: rows })}
        />
      )}

      {/* Create Modal */}
      <AnimatePresence>
        {isCreateModalOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4"
            onClick={closeCreateModal}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-surface w-full max-w-lg rounded-3xl shadow-2xl max-h-[92dvh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 border-b border-line-soft bg-sunken flex justify-between items-center">
                <h2 className="text-xl font-bold">{editing ? 'Editar Torneio' : duplicateOf ? 'Duplicar Torneio' : 'Novo Torneio'}</h2>
                <button onClick={closeCreateModal}><X /></button>
              </div>
              <form onSubmit={handleCreateTournament} className="p-6 space-y-4">
                <div className="grid grid-cols-[1fr_90px] gap-4">
                  <div>
                    <label className="block text-sm font-bold mb-1">Evento</label>
                    <CustomSelect
                      placeholder="Sem evento"
                      options={[{ value: '', label: 'Sem evento' }, ...events.map((ev) => ({ value: ev._id, label: ev.name }))]}
                      value={form.event_id}
                      onChange={(val) => setForm({ ...form, event_id: val })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold mb-1">Nº</label>
                    <input type="number" min="1" value={form.number} onChange={e => setForm({ ...form, number: e.target.value })} className="input w-full" placeholder="#02" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">Nome do Torneio</label>
                  <input required type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="input w-full" placeholder="Ex: Main Event 50K" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold mb-1">Data</label>
                    <input required type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="input w-full" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold mb-1">Horário</label>
                    <input required type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} className="input w-full" />
                  </div>
                </div>
                <div>
                  <label htmlFor="t-seats" className="label">Lugares por mesa</label>
                  <input id="t-seats" required type="number" min="2" max="10" value={form.seats_per_table} onChange={e => setForm({ ...form, seats_per_table: e.target.value })} className="input" />
                </div>
                {isAdmin && !editing && (
                  <div>
                    <label className="block text-sm font-bold mb-1">Sessões / fases <span className="font-normal text-fg-subtle">(opcional)</span></label>
                    <input type="text" value={form.sessions_text} onChange={e => setForm({ ...form, sessions_text: e.target.value })} className="input w-full" placeholder="Ex: Dia 1A, Dia 1B, Dia 1C, Dia Final" />
                    <p className="mt-1 text-xs text-fg-subtle">Separe por vírgula. Todas fazem parte do mesmo torneio. Sem isso, nasce "Dia Único".</p>
                  </div>
                )}
                <div>
                  <label className="label">Fuso horário</label>
                  <CustomSelect aria-label="Fuso horário" options={timezoneOptions(form.timezone)} value={form.timezone} onChange={(val) => setForm({ ...form, timezone: val })} />
                  <p className="field-help">O horário de início vale neste fuso; o relógio e as sessões usam o mesmo.</p>
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1">Modelo de Stack</label>
                  <CustomSelect
                    placeholder="Selecione um modelo de stack"
                    options={stackModels.map(s => ({ label: `${s.name} — ${s.total_value.toLocaleString()} fichas`, value: s._id }))}
                    value={form.stack_model_id}
                    onChange={val => setForm({ ...form, stack_model_id: val })}
                  />
                </div>
                <button type="submit" className="w-full py-4 bg-brand text-white font-bold rounded-xl hover:bg-brand-hover transition-all">{editing ? 'Salvar alterações' : 'Criar Torneio'}</button>
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