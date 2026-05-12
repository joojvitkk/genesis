import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Hash, Users, AlertTriangle, Clock, MessageSquare, ChevronRight, Bell, Shield, Package, MonitorPlay } from 'lucide-react';
import { socket, BACKEND_URL } from '../App';

const CHANNELS = [
  { id: 'general', label: 'Geral', icon: <MessageSquare size={16}/>, color: 'bg-blue-500' },
  { id: 'material', label: 'Material', icon: <Package size={16}/>, color: 'bg-amber-500' },
  { id: 'salao', label: 'Salão', icon: <MonitorPlay size={16}/>, color: 'bg-emerald-500' },
];

export default function Chat() {
  const [activeChannel, setActiveChannel] = useState('general');
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [user, setUser] = useState(null);
  const scrollRef = useRef(null);

  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    const savedUser = localStorage.getItem('genesis_user');
    if (savedUser) setUser(JSON.parse(savedUser));

    socket.on('onlineCount', (count) => setOnlineCount(count));
    socket.emit('getOnlineCount');
    return () => socket.off('onlineCount');
  }, []);

  useEffect(() => {
    if (!activeChannel) return;

    // Fetch history
    const fetchHistory = async () => {
      const token = localStorage.getItem('genesis_token');
      try {
        const res = await fetch(`${BACKEND_URL}/api/chat/${activeChannel}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) setMessages(await res.json());
      } catch (e) { console.error(e); }
    };

    fetchHistory();
    socket.emit('joinChannel', activeChannel);

    return () => {
      socket.emit('leaveChannel', activeChannel);
    };
  }, [activeChannel]);

  useEffect(() => {
    const handleNewMessage = (msg) => {
      if (msg.channel === activeChannel) {
        setMessages(prev => [...prev, msg]);
      }
    };

    socket.on('newMessage', handleNewMessage);
    return () => socket.off('newMessage', handleNewMessage);
  }, [activeChannel]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;

    const data = {
      message: newMessage,
      sender_name: user.name,
      sender_role: user.role,
      channel: activeChannel,
      is_urgent: isUrgent
    };

    socket.emit('sendMessage', data);
    setNewMessage('');
    setIsUrgent(false);
  };

  return (
    <div className="h-[calc(100vh-120px)] md:h-[calc(100vh-80px)] flex bg-white dark:bg-[#0A0A0A] rounded-3xl overflow-hidden border border-gray-200 dark:border-zinc-800 shadow-2xl">
      {/* Channels Sidebar */}
      <div className="w-20 md:w-64 bg-gray-50 dark:bg-[#0F0F0F] border-r border-gray-200 dark:border-zinc-800 flex flex-col">
        <div className="p-6 border-b border-gray-200 dark:border-zinc-800 hidden md:block">
          <h2 className="text-xl font-black uppercase tracking-tighter text-gray-900 dark:text-white">Canais</h2>
        </div>
        <div className="flex-1 p-3 md:p-4 space-y-2">
          {CHANNELS.map(ch => (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch.id)}
              className={`w-full flex items-center justify-center md:justify-start gap-3 p-3 md:px-4 md:py-3 rounded-2xl transition-all ${activeChannel === ch.id ? 'bg-genesis-red text-white shadow-lg shadow-red-500/20' : 'text-gray-500 hover:bg-gray-200 dark:hover:bg-zinc-800/50 hover:text-gray-900 dark:hover:text-gray-100'}`}
            >
              {ch.icon}
              <span className="hidden md:block font-bold text-sm uppercase tracking-tight">{ch.label}</span>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-gray-200 dark:border-zinc-800 hidden md:block">
          <div className="bg-gray-100 dark:bg-zinc-800/50 p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-xs font-bold text-gray-400 uppercase mb-2">
              <Users size={12}/> Online agora
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-zinc-800 flex items-center justify-center text-genesis-red">
                  <Users size={20}/>
                </div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white dark:border-[#0F0F0F] rounded-full animate-pulse"></div>
              </div>
              <div>
                <p className="text-xl font-black text-gray-900 dark:text-white leading-none">{onlineCount}</p>
                <p className="text-[10px] font-bold text-gray-500 uppercase">Membros</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="p-4 md:px-8 md:py-6 bg-white dark:bg-[#111111] border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${CHANNELS.find(c => c.id === activeChannel)?.color} text-white`}>
              {CHANNELS.find(c => c.id === activeChannel)?.icon}
            </div>
            <div>
              <h3 className="font-black uppercase tracking-tight text-gray-900 dark:text-white">#{CHANNELS.find(c => c.id === activeChannel)?.label}</h3>
              <p className="text-xs text-gray-500 font-medium">Comunicação oficial do setor</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-4">
            <button className="p-2 text-gray-400 hover:text-gray-600"><Bell size={20}/></button>
            <button className="p-2 text-gray-400 hover:text-gray-600"><Shield size={20}/></button>
          </div>
        </div>

        {/* Messages */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 custom-scrollbar bg-gray-50 dark:bg-[#0A0A0A]"
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
                  <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{msg.sender_name}</span>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded font-black uppercase ${msg.sender_role === 'admin' ? 'bg-red-500/10 text-red-500' : msg.sender_role === 'material' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                    {msg.sender_role}
                  </span>
                </div>
                <div className={`max-w-[85%] md:max-w-[70%] p-4 rounded-3xl shadow-sm relative ${msg.is_urgent ? 'bg-red-500 text-white shadow-lg shadow-red-500/20' : isMe ? 'bg-genesis-red text-white' : 'bg-white dark:bg-[#141414] text-gray-900 dark:text-gray-100 border border-gray-100 dark:border-zinc-800'}`}>
                  {msg.is_urgent && <AlertTriangle size={14} className="absolute -top-2 -right-2 bg-white text-red-500 rounded-full p-0.5 shadow-md"/>}
                  <p className="text-sm font-medium leading-relaxed">{msg.message}</p>
                  <div className={`text-[9px] mt-2 opacity-50 font-bold flex items-center gap-1 ${isMe ? 'justify-end' : ''}`}>
                    <Clock size={8}/> {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </motion.div>
            );
          })}
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
              <MessageSquare size={48} className="opacity-10"/>
              <p className="font-medium italic">Nenhuma mensagem neste canal ainda.</p>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-8 bg-white dark:bg-[#111111] border-t border-gray-200 dark:border-zinc-800">
          <form onSubmit={handleSendMessage} className="space-y-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setIsUrgent(!isUrgent)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-tight transition-all border ${isUrgent ? 'bg-red-500 border-red-500 text-white shadow-lg shadow-red-500/20' : 'bg-gray-100 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700 text-gray-400 hover:text-red-500'}`}
              >
                <AlertTriangle size={14}/> Urgente
              </button>
            </div>
            <div className="flex items-center gap-3 bg-gray-50 dark:bg-[#0F0F0F] p-2 pr-2 md:p-3 md:pr-3 rounded-3xl border border-gray-200 dark:border-zinc-800 focus-within:border-genesis-red transition-all">
              <input
                type="text"
                placeholder={`Mensagem para #${CHANNELS.find(c => c.id === activeChannel)?.label}...`}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                className="flex-1 bg-transparent px-4 text-sm font-medium focus:outline-none dark:text-white"
              />
              <button
                type="submit"
                className="p-3 md:px-6 md:py-3 bg-genesis-red text-white rounded-2xl flex items-center gap-2 hover:scale-105 active:scale-95 transition-all shadow-lg shadow-red-500/20"
              >
                <span className="hidden md:block font-black uppercase text-xs">Enviar</span>
                <Send size={18}/>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}