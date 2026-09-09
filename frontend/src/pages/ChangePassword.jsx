import { useState } from 'react';
import { KeyRound, Eye, EyeOff } from 'lucide-react';
import { apiPost } from '../lib/api';

/**
 * Tela/painel de troca de senha.
 * forced: quando true, é a barreira do primeiro acesso (sem botão de voltar).
 * onDone(newToken): chamado no sucesso.
 */
export default function ChangePassword({ forced = false, onDone, onCancel }) {
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
    <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-3xl border border-gray-200 bg-white p-8 shadow-2xl dark:border-zinc-800 dark:bg-[#141414]">
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-genesis-red/10 text-genesis-red"><KeyRound size={22} /></div>
        <h1 className="text-xl font-black uppercase tracking-tight text-gray-900 dark:text-white">
          {forced ? 'Defina uma nova senha' : 'Trocar senha'}
        </h1>
        {forced && <p className="mt-1 text-sm text-gray-500">Por segurança, escolha uma senha antes de continuar.</p>}
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-sm font-semibold text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">{error}</div>}

      {[
        { label: 'Senha atual', v: cur, set: setCur },
        { label: 'Nova senha', v: next, set: setNext },
        { label: 'Confirmar nova senha', v: confirm, set: setConfirm },
      ].map(({ label, v, set }) => (
        <div key={label}>
          <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</label>
          <div className="relative">
            <input
              type={show ? 'text' : 'password'} required value={v}
              onChange={(e) => set(e.target.value)}
              className="w-full rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 pr-11 text-sm font-bold outline-none focus:ring-1 focus:ring-genesis-red dark:border-zinc-700 dark:bg-[#111111] dark:text-white"
            />
            {label === 'Senha atual' && (
              <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            )}
          </div>
        </div>
      ))}

      <button type="submit" disabled={loading} className="w-full rounded-xl bg-genesis-red py-3.5 text-xs font-black uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-50">
        {loading ? 'Salvando…' : 'Salvar nova senha'}
      </button>
      {!forced && onCancel && (
        <button type="button" onClick={onCancel} className="w-full text-xs font-black uppercase tracking-widest text-gray-400 hover:text-gray-600">Cancelar</button>
      )}
    </form>
  );

  if (!forced) return body;
  return <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-[#0A0A0A]">{body}</div>;
}
