import React, { useState } from 'react';
import { LogIn, Eye, EyeOff, Sun, Moon } from 'lucide-react';
import { BACKEND_URL } from '../App';

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
      const res = await fetch(`${BACKEND_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Erro no login');
      
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#0A0A0A] p-4 transition-colors duration-300 relative">
      <div className="absolute top-8 right-8">
        <button 
          onClick={onToggleTheme}
          className="p-3 rounded-full bg-white dark:bg-zinc-800 text-gray-600 dark:text-gray-300 shadow-xl border border-gray-200 dark:border-zinc-700 hover:ring-2 hover:ring-genesis-red transition-all"
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>
      <div className="w-full max-w-md bg-white dark:bg-[#141414] rounded-3xl shadow-2xl border border-gray-200 dark:border-zinc-800 p-8 animate-in fade-in zoom-in-95 duration-500">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-black tracking-widest text-genesis-red mb-2">GENESIS</h1>
          <p className="text-gray-500 dark:text-gray-400 font-bold uppercase text-[10px] tracking-[4px]">Acesso Restrito</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-500 rounded-xl text-sm font-semibold border border-red-200 dark:border-red-500/20 text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-2 text-gray-400">E-mail de Acesso</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white placeholder-gray-400 font-bold" 
              placeholder="exemplo@admin.com"
              required 
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-2 text-gray-400">Senha</label>
            <div className="relative">
              <input 
                type={showPassword ? 'text' : 'password'} 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white placeholder-gray-400 font-bold pr-12" 
                placeholder="••••••••"
                required 
              />
              <button 
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-all"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          
          <button 
            type="submit" 
            disabled={loading}
            className="w-full mt-4 py-4 rounded-xl font-black uppercase text-xs tracking-widest bg-genesis-red text-white hover:bg-red-700 active:scale-95 transition-all shadow-lg shadow-red-500/20 flex justify-center items-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Autenticando...' : <><LogIn size={16} /> Entrar no Sistema</>}
          </button>
        </form>
      </div>
    </div>
  );
}
