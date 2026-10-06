import { useState } from 'react';
import { useRef } from 'react';
import { Camera, Check, Languages, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import Avatar from '../components/Avatar';
import { apiDelete, apiPut } from '../lib/api';
import { fileToAvatarDataURL } from '../lib/image';
import ChangePassword from './ChangePassword';
import { useAlert } from '../contexts/AlertContext';
import { useT } from '../lib/i18n.jsx';

const LANGUAGES = [{ code: 'pt', label: 'Português' }, { code: 'en', label: 'English' }];

const ROLE_LABEL = { admin: 'Administrador', salao: 'Salão', material: 'Material' };

/** Minha conta: dados do usuário logado e troca de senha (aberta pelo cartão do usuário no topo do menu). */
export default function Conta({ user, onPasswordChanged, onAvatarChanged }) {
  const { showAlert } = useAlert();
  const { lang, setLang } = useT();
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo
    if (!file) return;
    setBusy(true);
    try {
      const image = await fileToAvatarDataURL(file);
      const res = await apiPut('/me/avatar', { image });
      onAvatarChanged(res.avatar);
      showAlert('Foto atualizada.', 'success');
    } catch (err) {
      if (err.status !== 401) showAlert(err.message || 'Não foi possível atualizar a foto.', 'error');
    } finally { setBusy(false); }
  };

  const removePhoto = async () => {
    setBusy(true);
    try {
      await apiDelete('/me/avatar');
      onAvatarChanged(null);
      showAlert('Foto removida.', 'success');
    } catch (err) {
      if (err.status !== 401) showAlert(err.message || 'Não foi possível remover a foto.', 'error');
    } finally { setBusy(false); }
  }; // remonta o formulário limpo depois de salvar

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="page-title">Minha conta</h1>
        <p className="page-sub">Seus dados, o idioma da interface e a segurança da sua conta.</p>
      </header>

      <section className="card" aria-labelledby="conta-dados">
        <h2 id="conta-dados" className="section-title mb-4 flex items-center gap-2"><UserRound size={16} aria-hidden="true" /> Dados</h2>
        <div className="mb-5 flex flex-wrap items-center gap-4">
          <Avatar user={user} size="xl" />
          <div>
            <p className="label !mb-1">Foto de perfil</p>
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={pickPhoto} className="sr-only" aria-label="Escolher foto de perfil" tabIndex={-1} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn btn-secondary btn-sm">
                <Camera size={16} aria-hidden="true" /> {busy ? 'Enviando…' : user?.avatar ? 'Trocar foto' : 'Adicionar foto'}
              </button>
              {user?.avatar && (
                <button type="button" onClick={removePhoto} disabled={busy} className="btn btn-ghost btn-sm"><Trash2 size={16} aria-hidden="true" /> Remover</button>
              )}
            </div>
            <p className="card-hint">JPEG, PNG ou WebP. A foto é recortada em quadrado e reduzida automaticamente.</p>
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div><dt className="label">Nome</dt><dd className="font-semibold text-fg">{user?.name}</dd></div>
          <div><dt className="label">E-mail</dt><dd className="break-all font-semibold text-fg">{user?.email}</dd></div>
          <div><dt className="label">Perfil</dt><dd className="font-semibold text-fg">{ROLE_LABEL[user?.role] || user?.role}</dd></div>
        </dl>
      </section>

      <section className="card" aria-labelledby="conta-idioma">
        <h2 id="conta-idioma" className="section-title mb-1 flex items-center gap-2"><Languages size={16} aria-hidden="true" /> Idioma</h2>
        <p className="card-hint mb-3">Idioma da interface. Vale para toda a plataforma neste navegador.</p>
        <div role="group" aria-label="Idioma da interface" className="flex flex-wrap gap-2">
          {LANGUAGES.map((l) => (
            <button key={l.code} type="button" onClick={() => setLang(l.code)} aria-pressed={lang === l.code}
              className={`btn ${lang === l.code ? 'btn-primary' : 'btn-secondary'}`}>
              {lang === l.code && <Check size={16} aria-hidden="true" />}{l.label}
            </button>
          ))}
        </div>
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
