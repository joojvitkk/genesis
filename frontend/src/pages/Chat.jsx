import { locale } from '../lib/i18n';
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Users, AlertTriangle, Clock, MessageSquare, Bell, Shield, CalendarDays, Package, MonitorPlay, ImagePlus, X, Check, Reply, SmilePlus, Eye, ThumbsUp, Heart, Smile, Sparkles, HandHelping, CircleCheck } from 'lucide-react';
import { socket } from '../lib/socket';
import { apiGet, apiPost } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { useAlert } from '../contexts/AlertContext';
import { fileToCompressedDataURL } from '../lib/image';
import Avatar from '../components/Avatar';

const CHANNELS = [
  { id: 'general', label: 'Geral', icon: <MessageSquare size={14}/> },
  { id: 'material', label: 'Material', icon: <Package size={14}/> },
  { id: 'salao', label: 'Salão', icon: <MonitorPlay size={14}/> },
];
const REACTIONS = [
  { id: 'like', label: 'Curtir', icon: ThumbsUp },
  { id: 'love', label: 'Amei', icon: Heart },
  { id: 'funny', label: 'Engraçado', icon: Smile },
  { id: 'surprise', label: 'Uau', icon: Sparkles },
  { id: 'thanks', label: 'Obrigado', icon: HandHelping },
  { id: 'done', label: 'Feito', icon: CircleCheck },
];
const keyOf = (eventId, channel) => `${eventId}:${channel}`;

export default function Chat() {
  const [events, setEvents] = useState([]);
  const [activeEvent, setActiveEventRaw] = useState(null);   // _id do evento escolhido
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [user, setUser] = useState(null);
  const [unread, setUnread] = useState({});
  const [pendingImage, setPendingImage] = useState(null);
  const [replyTo, setReplyTo] = useState(null);       // mensagem sendo respondida
  const [pickerFor, setPickerFor] = useState(null);     // _id da mensagem com o seletor de reações aberto
  const [readersFor, setReadersFor] = useState(null);   // { id, list } — quem visualizou (remetente/admin)
  const [reactorsFor, setReactorsFor] = useState(null);   // _id da mensagem com a lista "quem reagiu" aberta
  const markedRead = useRef(new Set());
  const [zoomImage, setZoomImage] = useState(null);   // imagem aberta em tela cheia
  const [urgentAlerts, setUrgentAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const eventsRef = useRef([]);
  const [activeChannel, setActiveChannelRaw] = useState('general');
  const activeRef = useRef({ event: activeEvent, channel: 'general' });
  const eventName = (id) => events.find((e) => e._id === id)?.name || 'Evento';
  const currentEvent = events.find((e) => e._id === activeEvent);
  const scrollRef = useRef(null);
  const { showAlert } = useAlert();

  const [onlineCount, setOnlineCount] = useState(0);
  const [avatars, setAvatars] = useState({});           // { email: foto } — vem à parte das mensagens
  const seenSenders = useRef(new Set());                 // e-mails cujas fotos já foram buscadas
  const loadAvatars = () => apiGet('/chat/avatars').then(setAvatars).catch(() => {});
  const avatarOf = (email, name) => ({ name, avatar: email && email === user?.email ? user.avatar : avatars[email] });

  const select = (event, channel) => {
    activeRef.current = { event, channel };
    setActiveEventRaw(event);
    setActiveChannelRaw(channel);
    setUnread((u) => ({ ...u, [keyOf(event, channel)]: false }));
  };
  const setActiveEvent = (id) => select(id, activeRef.current.channel);
  const setActiveChannel = (ch) => select(activeRef.current.event, ch);
  const eventUnread = (id) => CHANNELS.some((c) => unread[keyOf(id, c.id)]);

  useEffect(() => {
    setUser(getStoredUser());

    socket.on('onlineCount', (count) => setOnlineCount(count));
    socket.emit('getOnlineCount');
    // o usuário escolhe o evento da conversa; os demais ficam assinados só para avisar de não lidas
    apiGet('/events').then((list) => {
      setEvents(list);
      eventsRef.current = list.map((ev) => ev._id);
      list.forEach((ev) => socket.emit('joinEvent', ev._id));
      if (list.length && !activeRef.current.event) setActiveEvent(list[0]._id);
    }).catch(() => {});

    loadAvatars();
    const onNew = (msg) => {
      // remetente novo na sessão: busca as fotos de novo (alguém pode ter acabado de trocar a sua)
      if (msg.sender_email && !seenSenders.current.has(msg.sender_email)) { seenSenders.current.add(msg.sender_email); loadAvatars(); }
      if (msg.event_id === activeRef.current.event && msg.channel === activeRef.current.channel) {
        setMessages((prev) => [...prev, msg]);
      } else {
        setUnread((u) => ({ ...u, [keyOf(msg.event_id, msg.channel)]: true }));
      }
      if (msg.is_urgent) setUrgentAlerts((list) => [msg, ...list].slice(0, 30));
    };
    const onAck = ({ message_id, user_name }) => {
      setUrgentAlerts((list) => list.map((m) => (
        m._id === message_id && !m.acks?.some((a) => a.user_name === user_name)
          ? { ...m, acks: [...(m.acks || []), { user_name }] } : m
      )));
    };
    const onReactions = ({ message_id, reactions }) => setMessages((prev) => prev.map((m) => (m._id === message_id ? { ...m, reactions } : m)));
    const onRead = ({ message_id }) => setMessages((prev) => prev.map((m) => (
      m._id === message_id && m.read_count !== undefined ? { ...m, read_count: m.read_count + 1 } : m
    )));
    socket.on('messageReactions', onReactions);
    socket.on('messageRead', onRead);
    socket.on('newMessage', onNew);
    socket.on('urgentAck', onAck);
    apiGet('/chat/urgent').then(setUrgentAlerts).catch(() => {});

    return () => {
      socket.off('onlineCount');
      socket.off('newMessage', onNew);
      socket.off('messageReactions', onReactions);
      socket.off('messageRead', onRead);
      socket.off('urgentAck', onAck);
      eventsRef.current.forEach((id) => socket.emit('leaveEvent', id));
    };
  }, []);

  useEffect(() => {
    if (!activeEvent) { setMessages([]); return; }
    setReplyTo(null); setPickerFor(null); setReadersFor(null); setReactorsFor(null);
    apiGet(`/chat/event/${activeEvent}?channel=${activeChannel}`)
      .then(setMessages)
      .catch((e) => { if (e.status !== 401) console.error(e); });
  }, [activeEvent, activeChannel]);

  useEffect(() => {
    if (!zoomImage) return;
    const onKey = (e) => { if (e.key === 'Escape') setZoomImage(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomImage]);

  // registra a visualização das mensagens alheias que chegaram à tela
  useEffect(() => {
    if (!user || document.visibilityState !== 'visible') return;
    const ids = messages.filter((m) => m._id && m.sender_email !== user.email && !markedRead.current.has(m._id)).map((m) => m._id);
    if (!ids.length) return;
    ids.forEach((id) => markedRead.current.add(id));
    apiPost('/chat/read', { ids }).catch(() => ids.forEach((id) => markedRead.current.delete(id)));
  }, [messages, user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if ((!newMessage.trim() && !pendingImage) || !user || !activeEvent) return;

    socket.emit('sendMessage', {
      message: newMessage,
      image: pendingImage || undefined,
      event_id: activeEvent,
      channel: activeChannel,
      is_urgent: isUrgent,
      reply_to: replyTo?._id,
    });
    setReplyTo(null);
    setNewMessage('');
    setPendingImage(null);
    setIsUrgent(false);
  };

  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPendingImage(await fileToCompressedDataURL(file));
    } catch (err) {
      showAlert(err.message || 'Não foi possível anexar a imagem.', 'error');
    }
  };

  const react = async (id, kind) => {
    setPickerFor(null);
    try { await apiPost(`/chat/${id}/react`, { kind }); } catch { showAlert('Não foi possível reagir.', 'error'); }
  };
  const toggleReaders = async (id) => {
    if (readersFor?.id === id) { setReadersFor(null); return; }
    setReadersFor({ id, list: null });
    try { setReadersFor({ id, list: await apiGet(`/chat/${id}/readers`) }); } catch { setReadersFor(null); }
  };
  const jumpTo = (id) => document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const iAcked = (a) => a.acks?.some((x) => x.user_name === user?.name);
  const pendingAlerts = urgentAlerts.filter((a) => !iAcked(a)).length;

  // otimista: a tela já mostra "confirmado"; se o servidor recusar, volta ao estado anterior
  const ackUrgent = async (id) => {
    setUrgentAlerts((list) => list.map((m) => (
      m._id === id && !iAcked(m) ? { ...m, acks: [...(m.acks || []), { user_name: user?.name }] } : m
    )));
    try {
      const updated = await apiPost(`/chat/${id}/ack`, {});
      setUrgentAlerts((list) => list.map((m) => (m._id === id ? updated : m)));
    } catch {
      setUrgentAlerts((list) => list.map((m) => (
        m._id === id ? { ...m, acks: (m.acks || []).filter((x) => x.user_name !== user?.name) } : m
      )));
      showAlert('Não foi possível confirmar a leitura. Tente de novo.', 'error');
    }
  };

  return (
    <div className="h-[calc(100vh-120px)] md:h-[calc(100vh-80px)] flex bg-surface dark:bg-canvas rounded-3xl overflow-hidden border border-line shadow-2xl">
      {/* Channels Sidebar */}
      <div className="w-20 md:w-64 bg-sunken dark:bg-sunken border-r border-line flex flex-col">
        <div className="p-6 border-b border-line hidden md:block">
          <h2 className="text-xl font-bold text-fg">Eventos</h2>
        </div>
        <div className="flex-1 p-3 md:p-4 space-y-2">
          {events.map(ev => (
            <button
              key={ev._id}
              onClick={() => setActiveEvent(ev._id)}
              title={ev.name}
              className={`relative w-full flex items-center justify-center md:justify-start gap-3 p-3 md:px-4 md:py-3 rounded-2xl transition-all ${activeEvent === ev._id ? 'bg-brand text-white' : 'text-fg-muted hover:bg-raised hover:text-fg'}`}
            >
              <CalendarDays size={16}/>
              <span className="hidden md:block font-bold text-sm truncate">{ev.name}</span>
              {eventUnread(ev._id) && activeEvent !== ev._id && (
                <span className="absolute right-2 top-2 md:static md:ml-auto h-2.5 w-2.5 rounded-full bg-brand animate-pulse" aria-label="mensagens não lidas" />
              )}
            </button>
          ))}
          {events.length === 0 && <p className="hidden md:block px-2 text-sm text-fg-subtle">Nenhum evento cadastrado.</p>}
        </div>
        <div className="p-4 border-t border-line hidden md:block">
          <div className="bg-raised/50 p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-xs font-bold text-fg-subtle uppercase mb-2">
              <Users size={12}/> Online agora
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-zinc-800 flex items-center justify-center text-brand-fg">
                  <Users size={20}/>
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white dark:border-[#0F0F0F] rounded-full animate-pulse"></div>
              </div>
              <div>
                <p className="text-xl font-bold text-fg leading-none">{onlineCount}</p>
                <p className="text-xs font-bold text-fg-muted uppercase">Membros</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-4 md:px-8 md:py-6 bg-surface border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-brand text-white"><CalendarDays size={16}/></div>
            <div>
              <h3 className="font-bold tracking-tight text-fg">{currentEvent?.name || 'Escolha um evento'}</h3>
              <div className="mt-1 flex gap-1">
                {CHANNELS.map((c) => (
                  <button key={c.id} onClick={() => setActiveChannel(c.id)}
                    className={`relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${activeChannel === c.id ? 'bg-brand text-white' : 'bg-raised text-fg-muted hover:text-fg'}`}>
                    {c.icon}{c.label}
                    {unread[keyOf(activeEvent, c.id)] && activeChannel !== c.id && <span className="h-2 w-2 rounded-full bg-brand animate-pulse" aria-label="mensagens não lidas" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAlerts((v) => !v)} className={`relative p-2 rounded-xl transition-all ${showAlerts ? 'bg-brand text-white' : 'text-fg-subtle hover:text-gray-600'}`} title="Alertas urgentes">
              <Bell size={20}/>
              <AnimatePresence>
                {pendingAlerts > 0 && (
                  <motion.span key="badge" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                    className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-xs font-bold text-white">{pendingAlerts}</motion.span>
                )}
              </AnimatePresence>
            </button>
            <button className="hidden md:block p-2 text-fg-subtle hover:text-gray-600"><Shield size={20}/></button>
          </div>
        </div>

        {/* Painel de alertas urgentes */}
        {showAlerts && (
          <div className="border-b border-line bg-red-50 p-4 dark:bg-red-500/5 max-h-64 overflow-y-auto">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-fg">Alertas urgentes</p>
            {urgentAlerts.length === 0 && <p className="text-sm text-fg-subtle">Nenhum alerta.</p>}
            {urgentAlerts.map((a) => {
              const mine = iAcked(a);
              return (
                <motion.div key={a._id} layout
                  animate={{ borderColor: mine ? 'rgb(16 185 129 / 0.5)' : 'rgb(254 202 202)' }} transition={{ duration: 0.3 }}
                  className="mb-2 rounded-xl border bg-surface p-3 text-sm">
                  <p className="font-bold text-fg">{a.message || '(imagem)'}</p>
                  <p className="flex items-center gap-1.5 text-xs text-fg-subtle"><Avatar user={avatarOf(a.sender_email, a.sender_name)} size="xs" />{a.sender_name} · {eventName(a.event_id)} · #{a.channel} · {new Date(a.createdAt).toLocaleString(locale())}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-fg-muted">{(a.acks || []).length} confirmação(ões){a.acks?.length ? `: ${a.acks.map((x) => x.user_name).join(', ')}` : ''}</span>
                    <AnimatePresence mode="wait" initial={false}>
                      {!mine ? (
                        <motion.button key="ack" onClick={() => ackUrgent(a._id)} whileTap={{ scale: 0.92 }}
                          exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.12 }}
                          className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-xs font-bold text-white hover:bg-brand-hover">
                          <Check size={12}/> Confirmar leitura
                        </motion.button>
                      ) : (
                        <motion.span key="done" initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                          className="inline-flex items-center gap-1 text-xs font-bold uppercase text-emerald-500">
                          <motion.span initial={{ rotate: -90, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.1 }} className="inline-flex"><Check size={14}/></motion.span>
                          Você confirmou
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Messages */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 custom-scrollbar bg-sunken dark:bg-canvas"
        >
          {messages.map((msg, idx) => {
            const isMe = msg.sender_name === user?.name;
            return (
              <motion.div
                key={msg._id || idx} id={`msg-${msg._id}`}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className={`group flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className={`flex items-center gap-2 mb-1 px-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <Avatar user={avatarOf(msg.sender_email, msg.sender_name)} size="sm" />
                  <span className="text-sm font-semibold text-fg-muted">{msg.sender_name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${msg.sender_role === 'admin' ? 'bg-red-500/10 text-red-500' : msg.sender_role === 'material' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                    {msg.sender_role}
                  </span>
                </div>
                <div className={`max-w-[85%] md:max-w-[70%] p-4 rounded-3xl  relative ${msg.is_urgent ? 'bg-red-500 text-white  ' : isMe ? 'bg-brand text-white' : 'bg-surface text-gray-900 dark:text-gray-100 border border-line-soft'}`}>
                  {msg.reply_preview && (
                    <button type="button" onClick={() => jumpTo(msg.reply_to)}
                      className={`mb-2 block w-full rounded-xl border-l-4 px-3 py-1.5 text-left text-xs ${msg.is_urgent || isMe ? 'border-white/70 bg-black/15' : 'border-brand bg-sunken'}`}>
                      <span className="block font-bold">{msg.reply_preview.sender_name}</span>
                      <span className="block truncate opacity-80">{msg.reply_preview.message || (msg.reply_preview.has_image ? '(imagem)' : '')}</span>
                    </button>
                  )}
                  {msg.is_urgent && <AlertTriangle size={14} className="absolute -top-2 -right-2 bg-surface text-red-500 rounded-full p-0.5"/>}
                  {msg.image && (
                    <button type="button" onClick={() => setZoomImage(msg.image)} className="block mb-1.5 cursor-zoom-in" aria-label="Abrir imagem em tela cheia">
                      <img src={msg.image} alt="anexo" className="max-h-60 rounded-lg" />
                    </button>
                  )}
                  {msg.message && <p className="text-sm font-medium leading-relaxed">{msg.message}</p>}
                  <div className={`text-xs mt-2 opacity-50 font-bold flex items-center gap-1 ${isMe ? 'justify-end' : ''}`}>
                    <Clock size={8}/> {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                {/* reações */}
                {msg.reactions?.length > 0 && (
                  <div className={`mt-1 flex flex-wrap gap-1 px-2 ${isMe ? 'justify-end' : ''}`}>
                    {REACTIONS.filter((e) => msg.reactions.some((r) => r.kind === e.id)).map((e) => {
                      const who = msg.reactions.filter((r) => r.kind === e.id);
                      const mine = who.some((r) => r.user_email === user?.email);
                      return (
                        <motion.button key={e.id} type="button" layout initial={{ scale: 0.6 }} animate={{ scale: 1 }} whileTap={{ scale: 0.9 }}
                          onClick={() => react(msg._id, e.id)} title={`${e.label}: ${who.map((r) => r.user_name).join(', ')}`}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${mine ? 'border-brand bg-brand/10 text-brand-fg' : 'border-line bg-surface text-fg-muted'}`}>
                          <e.icon size={12}/>{who.length}
                        </motion.button>
                      );
                    })}
                    <button type="button" onClick={() => setReactorsFor(reactorsFor === msg._id ? null : msg._id)}
                      className={`inline-flex items-center rounded-full border border-line px-2 py-0.5 text-xs font-bold hover:text-fg ${reactorsFor === msg._id ? 'bg-raised text-fg' : 'bg-surface text-fg-subtle'}`}
                      title="Quem reagiu" aria-label="Quem reagiu" aria-expanded={reactorsFor === msg._id}>
                      <Users size={12}/>
                    </button>
                  </div>
                )}
                {reactorsFor === msg._id && msg.reactions?.length > 0 && (
                  <div className="mt-1 max-w-[85%] space-y-1 rounded-xl border border-line bg-surface p-2 text-xs text-fg-muted md:max-w-[70%]">
                    <p className="font-bold uppercase text-fg-subtle">Quem reagiu</p>
                    {msg.reactions.map((r) => {
                      const def = REACTIONS.find((x) => x.id === r.kind);
                      return def && (
                        <p key={r.user_email} className="flex items-center gap-1.5">
                          <Avatar user={avatarOf(r.user_email, r.user_name)} size="xs" />
                          <span className="font-semibold text-fg">{r.user_name}</span>
                          <span className="inline-flex items-center gap-1 text-brand-fg"><def.icon size={12}/>{def.label}</span>
                        </p>
                      );
                    })}
                  </div>
                )}

                {/* ações: responder, reagir, quem viu */}
                <div className={`relative mt-1 flex items-center gap-1 px-2 text-fg-subtle md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-within:opacity-100 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <button type="button" onClick={() => setReplyTo(msg)} className="rounded-lg p-1.5 hover:bg-raised hover:text-fg" title="Responder" aria-label="Responder"><Reply size={14}/></button>
                  <button type="button" onClick={() => setPickerFor(pickerFor === msg._id ? null : msg._id)} className="rounded-lg p-1.5 hover:bg-raised hover:text-fg" title="Reagir" aria-label="Reagir"><SmilePlus size={14}/></button>
                  {msg.read_count !== undefined && (
                    <button type="button" onClick={() => toggleReaders(msg._id)} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-bold hover:bg-raised hover:text-fg" title="Quem visualizou">
                      <Eye size={14}/> {msg.read_count}
                    </button>
                  )}
                  <AnimatePresence>
                    {pickerFor === msg._id && (
                      <motion.div initial={{ opacity: 0, scale: 0.9, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
                        className={`absolute bottom-full z-10 mb-1 flex gap-1 rounded-2xl border border-line bg-surface p-1.5 ${isMe ? 'right-2' : 'left-2'}`}>
                        {REACTIONS.map((e) => (
                          <button key={e.id} type="button" onClick={() => react(msg._id, e.id)} title={e.label} aria-label={e.label}
                            className={`rounded-lg p-1.5 transition-transform hover:scale-125 hover:bg-raised ${msg.reactions?.some((r) => r.kind === e.id && r.user_email === user?.email) ? 'text-brand-fg' : 'text-fg-muted'}`}><e.icon size={18}/></button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                {readersFor?.id === msg._id && (
                  <div className="mt-1 max-w-[85%] rounded-xl border border-line bg-surface p-2 text-xs text-fg-muted md:max-w-[70%]">
                    <p className="mb-1 font-bold uppercase text-fg-subtle">Visualizada por</p>
                    {readersFor.list === null && <p>Carregando…</p>}
                    {readersFor.list?.length === 0 && <p>Ninguém ainda.</p>}
                    {readersFor.list?.map((r) => (
                      <p key={r.user_email} className="flex items-center gap-1.5"><Avatar user={avatarOf(r.user_email, r.user_name)} size="xs" />{r.user_name} · {new Date(r.at).toLocaleString(locale())}</p>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })}
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-fg-subtle space-y-4">
              <MessageSquare size={48} className="opacity-10"/>
              <p className="font-medium italic">Nenhuma mensagem neste canal ainda.</p>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-8 bg-surface border-t border-line">
          <form onSubmit={handleSendMessage} className="space-y-4">
            <AnimatePresence>
              {replyTo && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="flex items-center justify-between gap-3 rounded-xl border-l-4 border-brand bg-sunken px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-bold text-fg">Respondendo a {replyTo.sender_name}</p>
                      <p className="truncate text-fg-muted">{replyTo.message || '(imagem)'}</p>
                    </div>
                    <button type="button" onClick={() => setReplyTo(null)} className="rounded-lg p-1 text-fg-subtle hover:text-fg" aria-label="Cancelar resposta"><X size={14}/></button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsUrgent(!isUrgent)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold tracking-tight transition-all border ${isUrgent ? 'bg-red-500 border-red-500 text-white  ' : 'bg-raised border-line text-fg-subtle hover:text-red-500'}`}
              >
                <AlertTriangle size={14}/> Urgente
              </button>
              <label className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold tracking-tight border bg-raised border-line text-fg-subtle hover:text-brand-fg cursor-pointer">
                <ImagePlus size={14}/> Imagem
                <input type="file" accept="image/*" onChange={pickImage} className="hidden" />
              </label>
              {pendingImage && (
                <div className="relative">
                  <img src={pendingImage} alt="prévia" className="h-10 w-10 rounded-lg object-cover" />
                  <button type="button" onClick={() => setPendingImage(null)} className="absolute -right-1.5 -top-1.5 rounded-full bg-gray-900 p-0.5 text-white"><X size={11}/></button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 bg-sunken dark:bg-sunken p-2 pr-2 md:p-3 md:pr-3 rounded-3xl border border-line focus-within:border-genesis-red transition-all">
              <input
                type="text"
                placeholder={currentEvent ? `Mensagem para ${currentEvent.name} · #${CHANNELS.find((c) => c.id === activeChannel).label}...` : 'Escolha um evento...'}
                disabled={!activeEvent}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="flex-1 bg-transparent px-4 text-sm font-medium focus:outline-none dark:text-white"
              />
              <button
                type="submit"
                className="p-3 md:px-6 md:py-3 bg-brand text-white rounded-2xl flex items-center gap-2 hover:scale-105 active:scale-95 transition-all"
              >
                <span className="hidden md:block font-bold uppercase text-xs">Enviar</span>
                <Send size={18}/>
              </button>
            </div>
          </form>
        </div>
      </div>

      <AnimatePresence>
        {zoomImage && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
            onClick={() => setZoomImage(null)}
            role="dialog" aria-modal="true" aria-label="Imagem em tela cheia"
            className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
          >
            <button type="button" onClick={() => setZoomImage(null)} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" aria-label="Fechar">
              <X size={24}/>
            </button>
            <motion.img
              initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }}
              src={zoomImage} alt="anexo" onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full cursor-default rounded-lg object-contain"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}