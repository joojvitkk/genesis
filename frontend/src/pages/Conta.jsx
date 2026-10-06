import { useState } from 'react';
import { ShieldCheck, UserRound } from 'lucide-react';
import ChangePassword from './ChangePassword';
import { useAlert } from '../contexts/AlertContext';

const ROLE_LABEL = { admin: 'Administrador', salao: 'Salão', material: 'Material' };

/** Minha conta: dados do usuário logado e troca de senha (aberta pelo cartão do usuário no topo do menu). */
export default function Conta({ user, onPasswordChanged }) {
  const { showAlert } = useAlert();
  const [formKey, setFormKey] = useState(0); // remonta o formulário limpo depois de salvar

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="page-title">Minha conta</h1>
        <p className="page-sub">Seus dados de acesso e a segurança da sua conta.</p>
      </header>

      <section className="card" aria-labelledby="conta-dados">
        <h2 id="conta-dados" className="section-title mb-4 flex items-center gap-2"><UserRound size={16} aria-hidden="true" /> Dados</h2>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div><dt className="label">Nome</dt><dd className="font-semibold text-fg">{user?.name}</dd></div>
          <div><dt className="label">E-mail</dt><dd className="break-all font-semibold text-fg">{user?.email}</dd></div>
          <div><dt className="label">Perfil</dt><dd className="font-semibold text-fg">{ROLE_LABEL[user?.role] || user?.role}</dd></div>
        </dl>
      </section>

      <section aria-labelledby="conta-seguranca">
        <h2 id="conta-seguranca" className="section-title mb-3 flex items-center gap-2"><ShieldCheck size={16} aria-hidden="true" /> Trocar senha</h2>
        <ChangePassword
          key={formKey}
          embedded
          onDone={(token) => { onPasswordChanged(token); setFormKey((k) => k + 1); showAlert('Senha alterada.', 'success'); }}
        />
      </section>
    </div>
  );
}
