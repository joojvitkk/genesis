import { locale } from '../lib/i18n';
import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Send, Users, AlertTriangle, Clock, MessageSquare, Bell, Shield, Package, MonitorPlay, ImagePlus, X, Check } from 'lucide-react';
import { socket } from '../lib/socket';
import { apiGet, apiPost } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { useAlert } from '../contexts/AlertContext';
import { fileToCompressedDataURL } from '../lib/image';
import Avatar from '../components/Avatar';

const CHANNELS = [
  { id: 'general', label: 'Geral', icon: <MessageSquare size={16}/>, color: 'bg-blue-500' },
  { id: 'material', label: 'Material', icon: <Package size={16}/>, color: 'bg-amber-500' },
  { id: 'salao', label: 'Salão', icon: <MonitorPlay size={16}/>, color: 'bg-emerald-500' },
];

export default function Chat() {
  const [activeChannel, setActiveChannelRaw] = useState('general');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [user, setUser] = useState(null);
  const [unread, setUnread] = useState({});
  const [pendingImage, setPendingImage] = useState(null);
  const [urgentAlerts, setUrgentAlerts] = useState([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const activeRef = useRef(activeChannel);
  const scrollRef = useRef(null);
  const { showAlert } = useAlert();

  const [onlineCount, setOnlineCount] = useState(0);
  const [avatars, setAvatars] = useState({});           // { email: foto } — vem à parte das mensagens
  const seenSenders = useRef(new Set());                 // e-mails cujas fotos já foram buscadas
  const loadAvatars = () => apiGet('/chat/avatars').then(setAvatars).catch(() => {});
  const avatarOf = (email, name) => ({ name, avatar: email && email === user?.email ? user.avatar : avatars[email] });

  const setActiveChannel = (id) => {
    activeRef.current = id;
    setActiveChannelRaw(id);
    setUnread((u) => ({ ...u, [id]: false }));
  };

  useEffect(() => {
    setUser(getStoredUser());

    socket.on('onlineCount', (count) => setOnlineCount(count));
    socket.emit('getOnlineCount');
    // assina todos os canais para saber de mensagens não lidas
    CHANNELS.forEach((c) => socket.emit('joinChannel', c.id));

    loadAvatars();
    const onNew = (msg) => {
      // remetente novo na sessão: busca as fotos de novo (alguém pode ter acabado de trocar a sua)
      if (msg.sender_email && !seenSenders.current.has(msg.sender_email)) { seenSenders.current.add(msg.sender_email); loadAvatars(); }
      if (msg.channel === activeRef.current) {
        setMessages((prev) => [...prev, msg]);
      } else {
        setUnread((u) => ({ ...u, [msg.channel]: true }));
      }
      if (msg.is_urgent) setUrgentAlerts((list) => [msg, ...list].slice(0, 30));
    };
    const onAck = ({ message_id, user_name }) => {
      setUrgentAlerts((list) => list.map((m) => (
        m._id === message_id && !m.acks?.some((a) => a.user_name === user_name)
          ? { ...m, acks: [...(m.acks || []), { user_name }] } : m
      )));
    };
    socket.on('newMessage', onNew);
    socket.on('urgentAck', onAck);
    apiGet('/chat/urgent').then(setUrgentAlerts).catch(() => {});

    return () => {
      socket.off('onlineCount');
      socket.off('newMessage', onNew);
      socket.off('urgentAck', onAck);
      CHANNELS.forEach((c) => socket.emit('leaveChannel', c.id));
    };
  }, []);

  useEffect(() => {
    if (!activeChannel) return;
    apiGet(`/chat/${activeChannel}`)
      .then(setMessages)
      .catch((e) => { if (e.status !== 401) console.error(e); });
  }, [activeChannel]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if ((!newMessage.trim() && !pendingImage) || !user) return;

    socket.emit('sendMessage', {
      message: newMessage,
      image: pendingImage || undefined,
      channel: activeChannel,
      is_urgent: isUrgent,
    });
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

  const ackUrgent = async (id) => {
    try {
      const updated = await apiPost(`/chat/${id}/ack`, {});
      setUrgentAlerts((list) => list.map((m) => (m._id === id ? updated : m)));
    } catch { /* ignore */ }
  };

  return (
    <div className="h-[calc(100vh-120px)] md:h-[calc(100vh-80px)] flex bg-surface dark:bg-canvas rounded-3xl overflow-hidden border border-line shadow-2xl">
      {/* Channels Sidebar */}
      <div className="w-20 md:w-64 bg-sunken dark:bg-sunken border-r border-line flex flex-col">
        <div className="p-6 border-b border-line hidden md:block">
          <h2 className="text-xl font-bold text-fg">Canais</h2>
        </div>
        <div className="flex-1 p-3 md:p-4 space-y-2">
          {CHANNELS.map(ch => (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch.id)}
              className={`relative w-full flex items-center justify-center md:justify-start gap-3 p-3 md:px-4 md:py-3 rounded-2xl transition-all ${activeChannel === ch.id ? 'bg-brand text-white  ' : 'text-fg-muted hover:bg-gray-200 dark:hover:bg-zinc-800/50 hover:text-gray-900 dark:hover:text-gray-100'}`}
            >
              {ch.icon}
              <span className="hidden md:block font-bold text-sm uppercase tracking-tight">{ch.label}</span>
              {unread[ch.id] && activeChannel !== ch.id && (
                <span className="absolute right-2 top-2 md:static md:ml-auto h-2.5 w-2.5 rounded-full bg-brand animate-pulse" aria-label="mensagens não lidas" />
              )}
            </button>
          ))}
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
            <div className={`p-2 rounded-xl ${CHANNELS.find(c => c.id === activeChannel)?.color} text-white`}>
              {CHANNELS.find(c => c.id === activeChannel)?.icon}
            </div>
            <div>
              <h3 className="font-bold uppercase tracking-tight text-fg">#{CHANNELS.find(c => c.id === activeChannel)?.label}</h3>
              <p className="text-xs text-fg-muted font-medium">Comunicação oficial do setor</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowAlerts((v) => !v)} className={`relative p-2 rounded-xl transition-all ${showAlerts ? 'bg-brand text-white' : 'text-fg-subtle hover:text-gray-600'}`} title="Alertas urgentes">
              <Bell size={20}/>
              {urgentAlerts.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-xs font-bold text-white">{urgentAlerts.length}</span>
              )}
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
              const mine = a.acks?.some((x) => x.user_name === user?.name);
              return (
                <div key={a._id} className="mb-2 rounded-xl border border-red-200 bg-surface p-3 text-sm dark:border-red-500/20">
                  <p className="font-bold text-fg">{a.message || '(imagem)'}</p>
                  <p className="flex items-center gap-1.5 text-xs text-fg-subtle"><Avatar user={avatarOf(a.sender_email, a.sender_name)} size="xs" />{a.sender_name} · #{a.channel} · {new Date(a.createdAt).toLocaleString(locale())}</p>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-xs text-fg-muted">{(a.acks || []).length} confirmação(ões){a.acks?.length ? `: ${a.acks.map((x) => x.user_name).join(', ')}` : ''}</span>
                    {!mine && (
                      <button onClick={() => ackUrgent(a._id)} className="inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-xs font-bold text-white hover:bg-brand-hover">
                        <Check size={12}/> Confirmar leitura
                      </button>
                    )}
                    {mine && <span className="inline-flex items-center gap-1 text-xs font-bold uppercase text-emerald-500"><Check size={12}/> Você confirmou</span>}
                  </div>
                </div>
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
                key={msg._id || idx}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className={`flex items-center gap-2 mb-1 px-2 ${isMe ? 'flex-row-reverse' : ''}`}>
                  <Avatar user={avatarOf(msg.sender_email, msg.sender_name)} size="sm" />
                  <span className="text-sm font-semibold text-fg-muted">{msg.sender_name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-bold ${msg.sender_role === 'admin' ? 'bg-red-500/10 text-red-500' : msg.sender_role === 'material' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                    {msg.sender_role}
                  </span>
                </div>
                <div className={`max-w-[85%] md:max-w-[70%] p-4 rounded-3xl  relative ${msg.is_urgent ? 'bg-red-500 text-white  ' : isMe ? 'bg-brand text-white' : 'bg-surface text-gray-900 dark:text-gray-100 border border-line-soft'}`}>
                  {msg.is_urgent && <AlertTriangle size={14} className="absolute -top-2 -right-2 bg-surface text-red-500 rounded-full p-0.5"/>}
                  {msg.image && (
                    <a href={msg.image} target="_blank" rel="noopener" className="block mb-1.5">
                      <img src={msg.image} alt="anexo" className="max-h-60 rounded-lg" />
                    </a>
                  )}
                  {msg.message && <p className="text-sm font-medium leading-relaxed">{msg.message}</p>}
                  <div className={`text-xs mt-2 opacity-50 font-bold flex items-center gap-1 ${isMe ? 'justify-end' : ''}`}>
                    <Clock size={8}/> {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
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
                placeholder={`Mensagem para #${CHANNELS.find(c => c.id === activeChannel)?.label}...`}
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
    </div>
  );
}