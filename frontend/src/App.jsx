import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import Login from './pages/Login';
import { Menu, Moon, Sun } from 'lucide-react';

import { can, homeRoute, ROUTE_AREA } from './config';
import { socket, connectSocket, disconnectSocket } from './lib/socket';
import { getToken, getStoredUser, saveSession, clearSession, setUnauthorizedHandler } from './lib/auth';
import { apiGet } from './lib/api';
import { useAlert } from './contexts/AlertContext';

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

// Re-exports para compatibilidade com imports antigos
export { BACKEND_URL } from './config';
export { socket } from './lib/socket';

function RequireArea({ role, area, children }) {
  const location = useLocation();
  if (area && !can(role, area)) {
    return <Navigate to={homeRoute(role)} replace state={{ from: location.pathname }} />;
  }
  return children;
}

function App() {
  const { showAlert } = useAlert();
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('genesis_theme') || 'dark'; } catch { return 'dark'; }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [auth, setAuth] = useState(() => {
    const token = getToken();
    const user = getStoredUser();
    return token && user ? { token, user } : null;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { localStorage.setItem('genesis_theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  const handleLogout = useCallback(() => {
    clearSession();
    disconnectSocket();
    setAuth(null);
  }, []);

  // Logout automático quando a API sinaliza 401
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuth(null);
      disconnectSocket();
      showAlert('Sessão expirada. Faça login novamente.', 'error');
    });
  }, [showAlert]);

  // Revalida a sessão salva contra o backend no arranque
  useEffect(() => {
    if (!auth) return;
    connectSocket();
    apiGet('/me')
      .then(user => {
        saveSession(getToken(), user);
        setAuth(a => (a ? { ...a, user } : a));
      })
      .catch(() => { /* 401 já tratado pelo cliente de API */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      // pedido feito de forma não intrusiva; navegador decide
      Notification.requestPermission().catch(() => {});
    }

    const handleUrgent = (data) => {
      showAlert(`URGENTE: ${data.sender_name} diz: ${data.message}`, 'error');
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('GENESIS — MENSAGEM URGENTE', {
          body: `${data.sender_name}: ${data.message}`,
          icon: '/pwa-192x192.png',
        });
      }
    };

    socket.on('urgentNotification', handleUrgent);
    return () => socket.off('urgentNotification', handleUrgent);
  }, [showAlert]);

  const handleLogin = (token, user) => {
    saveSession(token, user);
    setAuth({ token, user });
    connectSocket();
  };

  if (!auth) {
    return <Login onLogin={handleLogin} theme={theme} onToggleTheme={toggleTheme} />;
  }

  const role = auth.user.role;

  return (
    <Router>
      <div className="min-h-screen flex bg-gray-50 dark:bg-[#0A0A0A] text-gray-900 dark:text-gray-100 transition-colors duration-300">
        <header className="md:hidden fixed top-0 left-0 right-0 h-14 bg-white dark:bg-[#111111] border-b border-gray-200 dark:border-zinc-800 flex items-center justify-between px-4 z-50 shadow-sm"
                style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all active:scale-95"
            aria-label="Abrir menu"
          >
            <Menu size={22} />
          </button>
          <span className="font-black text-lg tracking-[0.2em] text-genesis-red">GENESIS</span>
          <button
            onClick={toggleTheme}
            className="p-2 -mr-1 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all active:scale-95"
            aria-label="Alternar tema"
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </header>

        <Sidebar
          isOpen={sidebarOpen}
          onOpen={() => setSidebarOpen(true)}
          onClose={() => setSidebarOpen(false)}
          onLogout={handleLogout}
          user={auth.user}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <div className="flex-1 flex flex-col md:ml-64 min-h-screen overflow-x-hidden">
          <div className="hidden md:flex justify-end p-4 absolute top-0 right-0 z-10 pointer-events-none">
            <button
              onClick={toggleTheme}
              className="pointer-events-auto p-2.5 rounded-full bg-white dark:bg-zinc-800 text-gray-600 dark:text-gray-300 shadow-lg border border-gray-200 dark:border-zinc-700 hover:ring-2 hover:ring-genesis-red transition-all"
              aria-label="Alternar tema"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>

          <main className="flex-1 p-3 md:p-8 overflow-y-auto
                           pt-[calc(3.5rem+0.75rem)] md:pt-8
                           pb-[calc(68px+env(safe-area-inset-bottom,0px)+0.75rem)] md:pb-8">
            <Routes>
              <Route path="/" element={<Navigate to={homeRoute(role)} replace />} />
              {Object.entries({
                '/salao': <Salao />,
                '/torneios': <Torneios />,
                '/chip-race': <ChipRace />,
                '/chat': <Chat />,
                '/estoque': <Estoque />,
                '/ficharios': <Ficharios />,
                '/modelos-stack': <ModelosStack />,
                '/dashboard': <Dashboard />,
                '/relatorios': <Relatorios />,
                '/auditoria': <Auditoria />,
                '/usuarios': <Usuarios />,
              }).map(([path, element]) => (
                <Route
                  key={path}
                  path={path}
                  element={<RequireArea role={role} area={ROUTE_AREA[path]}>{element}</RequireArea>}
                />
              ))}
              <Route path="*" element={<Navigate to={homeRoute(role)} replace />} />
            </Routes>
          </main>
        </div>
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
