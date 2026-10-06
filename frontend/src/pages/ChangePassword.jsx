import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { apiPost } from '../lib/api';

/**
 * Tela/painel de troca de senha.
 * forced: quando true, é a barreira do primeiro acesso (sem botão de voltar).
 * embedded: dentro da página Minha conta (sem cabeçalho próprio).
 * onDone(newToken): chamado no sucesso.
 */
export default function ChangePassword({ forced = false, embedded = false, onDone, onCancel }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < 6) return setError('A nova senha deve ter ao menos 6 caracteres.');
    if (next !== confirm) return setError('As senhas não coincidem.');
    setLoading(true);
    try {
      const { token } = await apiPost('/me/password', { current_password: cur, new_password: next });
      onDone(token);
    } catch (err) {
      setError(err.message || 'Erro ao trocar a senha.');
    } finally {
      setLoading(false);
    }
  };

  const body = (
    <form onSubmit={submit} className={`card w-full space-y-4 ${embedded ? 'max-w-md' : 'max-w-sm p-8 shadow-2xl'}`}>
      {!embedded && (
        <div>
          <h1 className="text-xl font-bold text-fg">{forced ? 'Defina uma nova senha' : 'Trocar senha'}</h1>
          {forced && <p className="mt-1 text-sm text-fg-muted">Por segurança, escolha uma senha antes de continuar.</p>}
        </div>
      )}

      {error && <div role="alert" className="rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</div>}

      {[
        { id: 'pw-cur', label: 'Senha atual', v: cur, set: setCur, auto: 'current-password' },
        { id: 'pw-new', label: 'Nova senha', v: next, set: setNext, auto: 'new-password' },
        { id: 'pw-confirm', label: 'Confirmar nova senha', v: confirm, set: setConfirm, auto: 'new-password' },
      ].map(({ id, label, v, set, auto }) => (
        <div key={id}>
          <label htmlFor={id} className="label">{label}</label>
          <div className="relative">
            <input id={id} type={show ? 'text' : 'password'} autoComplete={auto} required value={v} onChange={(e) => set(e.target.value)} className="input pr-11" />
            {id === 'pw-cur' && (
              <button type="button" onClick={() => setShow((x) => !x)} aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
                className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-fg-subtle hover:text-fg">
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
          </div>
        </div>
      ))}

      <button type="submit" disabled={loading} className="btn btn-primary w-full">
        {loading ? 'Salvando…' : 'Salvar nova senha'}
      </button>
      {!forced && !embedded && onCancel && (
        <button type="button" onClick={onCancel} className="btn btn-ghost w-full">Cancelar</button>
      )}
    </form>
  );

  if (!forced) return body;
  return <div className="flex min-h-screen items-center justify-center bg-canvas p-4">{body}</div>;
}
