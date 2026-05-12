import React, { useState } from 'react';
import { UserPlus, Briefcase, Check } from 'lucide-react';

export default function Admin() {
  const [msg, setMsg] = useState('');

  const showToast = () => {
    setMsg('Ação realizada com sucesso!');
    setTimeout(() => setMsg(''), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto animate-in fade-in duration-500 pb-12">
      <h1 className="text-3xl md:text-4xl font-extrabold mb-2 text-gray-900 dark:text-white">Administração</h1>
      <p className="text-gray-500 dark:text-gray-400 mb-8 text-sm md:text-base">Cadastro de usuários e definição estrutural de fichários.</p>

      {msg && (
        <div className="mb-8 p-5 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-500 border border-green-200 dark:border-green-500/30 rounded-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4 shadow-sm">
          <div className="p-2 bg-green-500 rounded-full text-white"><Check size={20} /></div>
          <span className="font-bold text-lg">{msg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Users Panel */}
        <div className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 md:p-8 shadow-xl">
          <div className="flex items-center gap-4 mb-8">
            <div className="p-4 bg-red-50 dark:bg-genesis-red/10 text-genesis-red rounded-2xl"><UserPlus size={28} /></div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Criar Usuário</h2>
          </div>
          
          <form onSubmit={e => { e.preventDefault(); showToast(); }} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Nome Completo</label>
              <input type="text" placeholder="Ex: João da Silva" className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white placeholder-gray-400" required />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">E-mail ou Username</label>
              <input type="text" placeholder="Ex: joao@salao.com" className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white placeholder-gray-400" required />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Senha</label>
              <input type="password" className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white" required />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Nível de Acesso (Role)</label>
              <select className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white appearance-none">
                <option value="admin">Admin</option>
                <option value="material">Material</option>
                <option value="salao">Salão</option>
              </select>
            </div>
            <button className="w-full mt-4 py-4 rounded-xl font-bold bg-gray-900 dark:bg-white text-white dark:text-black hover:bg-genesis-red dark:hover:bg-genesis-red hover:text-white dark:hover:text-white transition-all shadow-lg active:scale-95">
              Cadastrar Usuário
            </button>
          </form>
        </div>

        {/* Fichários Panel */}
        <div className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl p-6 md:p-8 shadow-xl">
          <div className="flex items-center gap-4 mb-8">
            <div className="p-4 bg-red-50 dark:bg-genesis-red/10 text-genesis-red rounded-2xl"><Briefcase size={28} /></div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Cadastrar Fichário</h2>
          </div>
          
          <form onSubmit={e => { e.preventDefault(); showToast(); }} className="space-y-5">
            <div>
              <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Nome da Maleta</label>
              <input type="text" placeholder="Ex: Maleta B" className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white placeholder-gray-400" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Valor da Ficha</label>
                <input type="number" className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white" required />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Quantidade</label>
                <input type="number" className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white" required />
              </div>
            </div>
            
            <button className="w-full mt-4 py-4 rounded-xl font-bold bg-gray-900 dark:bg-white text-white dark:text-black hover:bg-genesis-red dark:hover:bg-genesis-red hover:text-white dark:hover:text-white transition-all shadow-lg active:scale-95">
              Adicionar Fichário
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
