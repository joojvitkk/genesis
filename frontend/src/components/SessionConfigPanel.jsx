import { useEffect, useState } from 'react';
import { Save, ListOrdered } from 'lucide-react';
import { apiPut } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import CustomSelect from './CustomSelect';
import { isInheritingSession, SESSION_TYPE_LABELS as TYPES } from '../lib/sessionTypes';

const YES_NO = [{ value: 'true', label: 'Sim' }, { value: 'false', label: 'Não' }];
const MODES = [['next', 'Próximo nível (depois do último jogado)'], ['resume', 'Retomar o nível anterior (com o tempo restante)'], ['manual', 'Primeiro nível da estrutura da sessão']];

/**
 * Configuração POR SESSÃO (admin): tipo da fase, inscrições (buy-in / reentrada / encerramento do registro), estrutura de blinds
 * própria (copiada por valor, faixa de níveis oficiais) e como a fase começa (próximo nível ou retomar). Nada aqui altera
 * as outras sessões nem o cadastro de estruturas.
 */
export default function SessionConfigPanel({ tournamentId, session, templates = [], onChanged }) {
  const { showAlert } = useAlert();
  const inheriting = isInheritingSession(session);
  const [f, setF] = useState({});
  const [busy, setBusy] = useState(false);
  const started = !!session.level_started_at;

  useEffect(() => {
    setF({
      type: session.type,
      allow_buyins: String(session.allow_buyins ?? !inheriting),
      allow_reentries: String(session.allow_reentries ?? !inheriting),
      close_level: session.registration_close_level ?? '',
      close_marker: !!session.registration_close_marker,
      start_mode: session.start_mode || 'next',
      source: '', level_from: '', level_to: '',
    });
  }, [session._id, session.type, session.allow_buyins, session.allow_reentries, session.registration_close_level, session.registration_close_marker, session.start_mode, inheriting]);

  const base = `/tournaments/${tournamentId}/sessions/${session._id}`;
  const run = async (fn, ok) => {
    setBusy(true);
    try { await fn(); showAlert(ok, 'success'); onChanged?.(); } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao salvar a sessão', 'error'); } finally { setBusy(false); }
  };
  const saveConfig = (e) => {
    e.preventDefault();
    run(() => apiPut(base, {
      type: f.type,
      allow_buyins: f.allow_buyins === 'true', allow_reentries: f.allow_reentries === 'true',
      registration_close_level: f.close_level === '' ? null : Number(f.close_level),
      registration_close_marker: f.close_marker,
      start_mode: f.type === 'CONTINUATION' || f.type === 'FINAL' ? f.start_mode : null,
    }), 'Configuração da sessão salva.');
  };
  const applyStructure = () => run(() => apiPut(`${base}/blinds`, {
    ...(f.source && f.source !== 'tournament' ? { template_id: f.source } : {}),
    level_from: f.level_from === '' ? null : Number(f.level_from),
    level_to: f.level_to === '' ? null : Number(f.level_to),
    start_mode: inheriting ? f.start_mode : undefined,
  }), 'Estrutura da sessão aplicada.');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const pick = (k) => (v) => setF({ ...f, [k]: v });
  const own = session.blind_structure || [];
  const levels = own.filter((r) => !r.row_type || r.row_type === 'level');

  return (
    <form onSubmit={saveConfig} data-testid="session-config" className="card space-y-4 p-6">
      <div>
        <h3 className="flex items-center gap-2 text-lg font-bold text-fg"><ListOrdered className="text-brand-fg" size={20} aria-hidden="true" /> Configuração de {session.name}</h3>
        <p className="text-xs text-fg-muted">
          {own.length ? `Estrutura própria${session.blind_source ? ` (${session.blind_source})` : ''}: ${levels.length} níveis a partir do Nível ${(levels[0]?.level ?? 1) + (session.level_offset || 0)}.` : 'Usa a estrutura do torneio.'}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div><label htmlFor="sc-type" className="label">Tipo da fase</label>
          <CustomSelect id="sc-type" value={f.type || ''} onChange={pick('type')} options={TYPES.map(([value, label]) => ({ value, label }))} /></div>
        <div><label htmlFor="sc-buy" className="label">Permitir buy-ins</label>
          <CustomSelect id="sc-buy" value={f.allow_buyins || ''} onChange={pick('allow_buyins')} options={YES_NO} /></div>
        <div><label htmlFor="sc-re" className="label">Permitir reentradas</label>
          <CustomSelect id="sc-re" value={f.allow_reentries || ''} onChange={pick('allow_reentries')} options={YES_NO} /></div>
        <div><label htmlFor="sc-close" className="label">Registro fecha após o nível</label>
          <input id="sc-close" type="number" min="1" className="input" placeholder="Sem limite" value={f.close_level ?? ''} onChange={set('close_level')} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm text-fg-muted"><input type="checkbox" checked={!!f.close_marker} onChange={set('close_marker')} /> Também encerrar ao passar o evento “Fim do Registro” da estrutura</label>
      {inheriting && (
        <div><label htmlFor="sc-mode" className="label">Início da fase</label>
          <CustomSelect id="sc-mode" value={f.start_mode || 'next'} onChange={pick('start_mode')} options={MODES.map(([value, label]) => ({ value, label }))} /></div>
      )}
      <div className="flex justify-end"><button type="submit" disabled={busy} className="btn btn-primary btn-sm"><Save size={14} /> Salvar configuração</button></div>

      <fieldset className="space-y-3 border-t border-line-soft pt-4" disabled={busy || started}>
        <legend className="label">Estrutura de blinds desta sessão</legend>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2"><label htmlFor="sc-src" className="label">Copiar de</label>
            <CustomSelect id="sc-src" value={f.source || ''} onChange={pick('source')} options={[{ value: '', label: 'Estrutura do torneio' }, ...templates.map((x) => ({ value: x._id, label: x.name }))]} /></div>
          <div><label htmlFor="sc-from" className="label">Do nível</label>
            <input id="sc-from" type="number" min="1" className="input" placeholder="1º" value={f.level_from ?? ''} onChange={set('level_from')} /></div>
          <div><label htmlFor="sc-to" className="label">Até o nível</label>
            <input id="sc-to" type="number" min="1" className="input" placeholder="último" value={f.level_to ?? ''} onChange={set('level_to')} /></div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-fg-subtle">{started ? 'O relógio já começou: edite os valores do nível pelo painel de blinds.' : 'A estrutura é copiada: editar aqui não altera o cadastro nem outras sessões. Valores continuam editáveis.'}</p>
          <button type="button" onClick={applyStructure} className="btn btn-secondary btn-sm">Aplicar estrutura</button>
        </div>
      </fieldset>
    </form>
  );
}
