import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, ArrowRight, AlertCircle, ChevronDown } from 'lucide-react';
import { apiPost } from '../lib/api';
import { SPRING_SNAP } from '../lib/motion';
import SiteHeader from '../components/brand/SiteHeader';

/**
 * Entrar. Padrão Apple ID: uma coluna centrada, título grande, os dois campos agrupados num só bloco (rótulo à esquerda, valor à direita)
 * e uma única ação. Erro chacoalha o bloco (mola) e aparece em texto; o resto é ajuda sob demanda.
 */
export default function Login({ onLogin, theme, onToggleTheme }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState('');
  const [fails, setFails] = useState(0);
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
      setFails((n) => n + 1);
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e) => setCapsLock(!!e.getModifierState?.('CapsLock'));
  const row = 'flex items-center gap-3 px-4';
  const lab = 'w-16 shrink-0 text-sm font-semibold text-fg-subtle';
  const field = 'h-14 min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle';

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <SiteHeader theme={theme} onToggleTheme={onToggleTheme}
        action={<Link to="/site" className="btn btn-ghost btn-sm">Conhecer o Genesis</Link>} />

      <main className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center px-5 pb-24 pt-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0, transition: SPRING_SNAP }}>
          <h1 className="display !text-[clamp(2rem,5vw,2.75rem)]">Entrar no Genesis</h1>
          <p className="lede mt-3">Use o e-mail e a senha da sua equipe.</p>

          <form onSubmit={handleSubmit} className="mt-8">
            {/* os dois campos num bloco só; o chacoalho a cada erro chama a atenção sem texto extra */}
            <motion.div key={fails} animate={fails ? { x: [0, -10, 9, -6, 4, 0] } : {}} transition={{ duration: 0.4 }}
              className={`overflow-hidden rounded-2xl bg-surface ring-1 transition-shadow focus-within:ring-2 focus-within:ring-brand-fg ${error ? 'ring-danger' : 'ring-line'}`}>
              <div className={row}>
                <label htmlFor="login-email" className={lab}>E-mail</label>
                <input id="login-email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)}
                  className={field} placeholder="voce@equipe.com" required aria-invalid={!!error} />
              </div>
              <div className={`${row} border-t border-line-soft`}>
                <label htmlFor="login-password" className={lab}>Senha</label>
                <input id="login-password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password}
                  onChange={(e) => setPassword(e.target.value)} onKeyUp={onKey} onKeyDown={onKey}
                  className={`${field} ${error ? 'input-error' : ''}`} placeholder="Obrigatória" required aria-invalid={!!error} aria-describedby={capsLock ? 'caps-hint' : undefined} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPassword}
                  className="btn btn-ghost btn-icon -mr-2 shrink-0">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </motion.div>

            {capsLock && <p id="caps-hint" className="mt-3 text-sm font-medium text-warn">Caps Lock está ativado.</p>}
            {error && (
              <p role="alert" className="mt-3 flex items-start gap-2 text-sm font-medium text-danger">
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> <span>{error}</span>
              </p>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary btn-lg mt-6 w-full">
              {loading ? 'Entrando…' : <>Entrar <ArrowRight size={18} aria-hidden="true" /></>}
            </button>
          </form>

          <details className="group mt-8 border-t border-line-soft pt-5">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-fg-muted hover:text-fg">
              Primeiro acesso ou senha perdida?
              <ChevronDown size={16} className="transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
            </summary>
            <p className="mt-3 text-sm text-fg-muted">Peça ao administrador. Você recebe uma senha provisória e cria a sua em seguida.</p>
          </details>
        </motion.div>
      </main>
    </div>
  );
}
