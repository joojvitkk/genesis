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
import Eventos from './pages/Eventos';
import TrackingSheet from './pages/TrackingSheet';
import ChipRace from './pages/ChipRace';
import Chat from './pages/Chat';
import ModelosStack from './pages/ModelosStack';
import Relatorios from './pages/Relatorios';
import Salao from './pages/Salao';
import Auditoria from './pages/Auditoria';
import Usuarios from './pages/Usuarios';
import Ocorrencias from './pages/Ocorrencias';
import LivroEstoque from './pages/LivroEstoque';
import FichasKO from './pages/FichasKO';
import Telao from './pages/Telao';
import Landing from './pages/Landing';
import ChangePassword from './pages/ChangePassword';
import Conta from './pages/Conta';
import { flushOfflineQueue } from './lib/offlineQueue';
import { occurrenceAlertText } from './lib/occurrenceAlert';

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

  // a mudança é aplicada de forma síncrona dentro da View Transition: a onda parte do botão clicado (lib/themeTransition.js)
  const toggleTheme = (e) => {
    const next = theme === 'dark' ? 'light' : 'dark';
    animateThemeChange(e?.currentTarget ?? null, () => {
      document.documentElement.classList.toggle('dark', next === 'dark');
      flushSync(() => setTheme(next));
    });
  };

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

    // Ocorrência VERMELHA (ex.: ficha de alto valor perdida): alerta urgente para todos (spec §11)
    const handleOccurrence = (o) => {
      const text = occurrenceAlertText(o);
      if (!text) return;
      showAlert(`OCORRÊNCIA VERMELHA: ${text}`, 'error');
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('GENESIS — OCORRÊNCIA VERMELHA', { body: text, icon: '/pwa-192x192.png' });
      }
    };

    socket.on('urgentNotification', handleUrgent);
    socket.on('occurrenceOpened', handleOccurrence);
    return () => { socket.off('urgentNotification', handleUrgent); socket.off('occurrenceOpened', handleOccurrence); };
  }, [showAlert]);

  const handleLogin = (token, user) => {
    saveSession(token, user);
    setAuth({ token, user });
    connectSocket();
  };

  const handlePasswordChanged = (token) => {
    const user = { ...auth.user, must_change_password: false };
    saveSession(token, user);
    setAuth({ token, user });
  };

  // foto de perfil: atualiza o usuário da sessão (menu e Minha conta mudam na hora)
  const handleAvatarChanged = (avatar) => {
    const user = { ...auth.user, avatar };
    saveSession(auth.token, user);
    setAuth({ token: auth.token, user });
  };

  // Sem sessão: a página pública /site é a principal; /login e qualquer outro endereço pedem o acesso (e voltam ao endereço pedido depois).
  if (!auth) {
    return (
      <Router>
        <Routes>
          <Route path="/" element={<Navigate to="/site" replace />} />
          <Route path="/site" element={<Landing theme={theme} onToggleTheme={toggleTheme} />} />
          <Route path="*" element={<Login onLogin={handleLogin} theme={theme} onToggleTheme={toggleTheme} />} />
        </Routes>
      </Router>
    );
  }

  if (auth.user.must_change_password) {
    return <ChangePassword forced onDone={handlePasswordChanged} />;
  }

  const role = auth.user.role;

  return (
    <Router>
      <Routes>
        {/* Tela de projeção — sem sidebar/chrome, ainda exige sessão */}
        <Route path="/torneios/:id/telao" element={<Telao />} />
        {/* A página pública continua acessível logado, com o atalho para o painel */}
        <Route path="/site" element={<Landing theme={theme} onToggleTheme={toggleTheme} ctaTo={homeRoute(role)} ctaLabel="Abrir o painel" />} />
        <Route path="*" element={<Shell role={role} auth={auth} theme={theme} toggleTheme={toggleTheme}
          sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} handleLogout={handleLogout}
          onPasswordChanged={handlePasswordChanged} onAvatarChanged={handleAvatarChanged} />} />
      </Routes>
    </Router>
  );
}

function Shell({ role, auth, theme, toggleTheme, sidebarOpen, setSidebarOpen, handleLogout, onPasswordChanged, onAvatarChanged }) {
  const { showAlert } = useAlert();

  useEffect(() => {
    flushOfflineQueue();
    const onOnline = () => flushOfflineQueue().then((n) => { if (n) showAlert(`${n} ação(ões) offline sincronizada(s).`, 'success'); });
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [showAlert]);

  return (
      <div className="min-h-screen flex bg-canvas text-fg">
        <header className="material md:hidden fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b px-3"
                style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <button onClick={() => setSidebarOpen(true)} className="btn btn-ghost btn-icon" aria-label="Abrir menu"><Menu size={22} /></button>
          <Logo height={26} className="text-fg" />
          <button onClick={toggleTheme} className="btn btn-ghost btn-icon" aria-label="Alternar tema">{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>
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

        <div className="flex-1 flex flex-col md:ml-[16.5rem] min-h-screen overflow-x-hidden">
          <main className="flex-1 p-4 md:p-6 overflow-y-auto pt-[calc(3.5rem+1rem)] md:pt-6
                           pb-[calc(84px+env(safe-area-inset-bottom,0px)+1rem)] md:pb-6">
            <Routes>
              <Route path="/" element={<Navigate to={homeRoute(role)} replace />} />
              <Route path="/conta" element={<Conta user={auth.user} onPasswordChanged={onPasswordChanged} onAvatarChanged={onAvatarChanged} />} />
              {Object.entries({
                '/salao': <Salao />,
                '/eventos': <Eventos />,
                '/torneios': <Torneios />,
                '/tracking-sheet': <TrackingSheet />,
                '/chip-race': <ChipRace />,
                '/chat': <Chat />,
                '/estoque': <Estoque />,
                '/livro-estoque': <LivroEstoque />,
                '/fichas-ko': <FichasKO />,
                '/ocorrencias': <Ocorrencias />,
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
  );
}

import { AlertProvider } from './contexts/AlertContext';
import { useT } from './lib/i18n.jsx';
import { flushSync } from 'react-dom';
import { animateThemeChange } from './lib/themeTransition';
import Logo from './components/brand/Logo';

export default function AppWrapper() {
  const { lang } = useT();
  return (
    <AlertProvider>
      {/* trocar o idioma remonta a árvore: todo texto passa por tr() com o idioma novo */}
      <App key={lang} />
    </AlertProvider>
  );
}
