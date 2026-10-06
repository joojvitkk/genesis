import { useState } from 'react';
import { LogIn, Eye, EyeOff, Sun, Moon } from 'lucide-react';
import { apiPost } from '../lib/api';

export default function Login({ onLogin, theme, onToggleTheme }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiPost('/login', { email: email.trim(), password });
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message || 'Erro no login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-canvas p-4">
      <button onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'} className="btn btn-secondary btn-icon absolute right-4 top-4">
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <main className="card w-full max-w-sm p-8">
        <div className="mb-8">
          <span className="inline-flex items-center gap-2 text-2xl font-bold tracking-[0.18em] text-fg">
            <span className="inline-block h-4 w-4 rounded-sm bg-brand" aria-hidden="true" />
            GENESIS
          </span>
          <p className="mt-1 text-sm text-fg-muted">Logística de fichas e operação de torneios</p>
        </div>

        {error && <div role="alert" className="mb-5 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="label">E-mail de acesso</label>
            <input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="input" placeholder="exemplo@admin.com" required />
          </div>
          <div>
            <label htmlFor="login-password" className="label">Senha</label>
            <div className="relative">
              <input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="input pr-11" placeholder="••••••••" required />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle hover:text-fg">
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn btn-primary btn-lg w-full">
            {loading ? 'Autenticando…' : <><LogIn size={16} /> Entrar</>}
          </button>
        </form>
      </main>
    </div>
  );
}
