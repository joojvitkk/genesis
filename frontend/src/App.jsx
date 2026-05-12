import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import { Menu, Moon, Sun } from 'lucide-react';
import { io } from 'socket.io-client';

// Pages
import Dashboard from './pages/Dashboard';
import Estoque from './pages/Estoque';
import Ficharios from './pages/Ficharios';
import Torneios from './pages/Torneios';
import ChipRace from './pages/ChipRace';
import Chat from './pages/Chat';
import ModelosStack from './pages/ModelosStack';
import Relatorios from './pages/Relatorios';
import Salao from './pages/Salao';
import Auditoria from './pages/Auditoria';
import Usuarios from './pages/Usuarios';

import { useAlert } from './contexts/AlertContext';

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || `http://${window.location.hostname}:3000`;
export const socket = io(BACKEND_URL);

function App() {
  const { showAlert } = useAlert();
  const [theme, setTheme] = useState(() => localStorage.getItem('genesis_theme') || 'dark');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [auth, setAuth] = useState(() => {
    const savedToken = localStorage.getItem('genesis_token');
    const savedUser = localStorage.getItem('genesis_user');
    return savedToken && savedUser ? { token: savedToken, user: JSON.parse(savedUser) } : null;
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('genesis_theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  useEffect(() => {
    // Request Push Notification Permission
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }

    const handleUrgent = (data) => {
      showAlert(`URGENTE: ${data.sender_name} diz: ${data.message}`, 'error');
      
      // Native Push
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("GENESIS - MENSAGEM URGENTE", {
          body: `${data.sender_name}: ${data.message}`,
          icon: '/favicon.svg'
        });
      }
    };

    socket.on('urgentNotification', handleUrgent);
    return () => socket.off('urgentNotification', handleUrgent);
  }, []);

  const handleLogin = (token, user) => {
    localStorage.setItem('genesis_token', token);
    localStorage.setItem('genesis_user', JSON.stringify(user));
    setAuth({ token, user });
  };

  const handleLogout = () => {
    localStorage.removeItem('genesis_token');
    localStorage.removeItem('genesis_user');
    setAuth(null);
  };

  if (!auth) {
    return <Login onLogin={handleLogin} theme={theme} onToggleTheme={toggleTheme} />;
  }

  const role = auth.user.role;

  return (
    <Router>
      <div className="min-h-screen flex bg-gray-50 dark:bg-[#0A0A0A] text-gray-900 dark:text-gray-100 transition-colors duration-300">
        
        {/* Mobile Header */}
        <div className="md:hidden fixed top-0 left-0 w-full h-16 bg-white dark:bg-[#111111] border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between px-4 z-50 shadow-sm">
          <button onClick={toggleSidebar} className="p-2 -ml-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800"><Menu size={24} /></button>
          <span className="font-black text-xl tracking-widest text-genesis-red">GENESIS</span>
          <button onClick={toggleTheme} className="p-2 -mr-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>

        {/* Sidebar */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={handleLogout} user={auth.user} theme={theme} onToggleTheme={toggleTheme} />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col md:ml-64 pt-16 md:pt-0 min-h-screen relative overflow-x-hidden">
          
          <div className="hidden md:flex justify-end p-6 absolute top-0 right-0 w-full z-10 pointer-events-none">
            <button onClick={toggleTheme} className="pointer-events-auto p-3 rounded-full bg-white dark:bg-zinc-800 text-gray-600 dark:text-gray-300 shadow-xl border border-gray-200 dark:border-zinc-700 hover:ring-2 hover:ring-genesis-red transition-all">
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          </div>
          
          <main className="flex-1 p-4 md:p-10 overflow-y-auto">
            <Routes>
              <Route path="/" element={<Navigate to={role === 'admin' ? '/dashboard' : '/salao'} replace />} />
              
              {/* Rotas Públicas (Admin, Material, Salão) */}
              {['admin', 'salao', 'material'].includes(role) && <Route path="/salao" element={<Salao />} />}
              {['admin', 'salao', 'material'].includes(role) && <Route path="/chip-race" element={<ChipRace />} />}
              {['admin', 'salao', 'material'].includes(role) && <Route path="/chat" element={<Chat />} />}
              
              {/* Rotas de Material + Admin */}
              {['admin', 'material'].includes(role) && <Route path="/estoque" element={<Estoque />} />}
              {['admin', 'material'].includes(role) && <Route path="/ficharios" element={<Ficharios />} />}
              
              {/* Rotas de Salão + Admin */}
              {['admin', 'salao'].includes(role) && <Route path="/torneios" element={<Torneios />} />}
              {['admin', 'salao'].includes(role) && <Route path="/modelos-stack" element={<ModelosStack />} />}

              {/* Rotas Apenas Admin */}
              {role === 'admin' && <Route path="/dashboard" element={<Dashboard />} />}
              {role === 'admin' && <Route path="/relatorios" element={<Relatorios />} />}
              {role === 'admin' && <Route path="/auditoria" element={<Auditoria />} />}
              {role === 'admin' && <Route path="/usuarios" element={<Usuarios />} />}

              <Route path="*" element={<Navigate to={role === 'admin' ? '/dashboard' : '/salao'} replace />} />
            </Routes>
          </main>
        </div>

        {/* Backdrop for mobile */}
        {sidebarOpen && (
          <div className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-30" onClick={() => setSidebarOpen(false)} />
        )}
      </div>
    </Router>
  );
}

import { AlertProvider } from './contexts/AlertContext';

export default function AppWrapper() {
  return (
    <AlertProvider>
      <App />
    </AlertProvider>
  );
}
