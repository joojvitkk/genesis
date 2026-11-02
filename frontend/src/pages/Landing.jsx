import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform, useSpring } from 'framer-motion';
import { ArrowRight, ArrowDown, ChevronDown, Check, Pause, Play, Plus } from 'lucide-react';
import Logo from '../components/brand/Logo';
import SiteHeader from '../components/brand/SiteHeader';
import { visibleGroups, NAV_ITEMS } from '../components/Sidebar';
import { useT } from '../lib/i18n.jsx';
import { SPRING_SNAP } from '../lib/motion';

/* ── Conteúdo ─────────────────────────────────────────────────────────────────────────────────────────── */
const NAV = [
  { id: 'problema', label: 'O problema' },
  { id: 'pratica', label: 'Na prática' },
  { id: 'perfis', label: 'Perfis' },
  { id: 'confianca', label: 'Confiança' },
  { id: 'faq', label: 'Perguntas' },
];

// Uma noite de Dia 1A, linha a linha: o que acontece sem sistema × o que o Genesis faz no mesmo momento.
const NIGHT = [
  { t: '20:05', before: 'Dia 1A e Dia 1B rodam em cronômetros diferentes. Os níveis já divergem.', after: 'Cada sessão tem o seu relógio no servidor. Todas as telas mostram o mesmo tempo.' },
  { t: '21:47', before: 'A contagem do fichário não bate. Faltam fichas de 500 e ninguém sabe se saíram ou se perderam.', after: 'A diferença vira uma ocorrência com gravidade, fichário, quantidade e responsável.' },
  { t: '22:30', before: 'Chip Race na calculadora, com a mesa esperando. Alguém refaz a conta.', after: 'O Chip Race é guiado: o sistema calcula, registra e deixa a quebra de fichas à vista.' },
  { t: '23:10', before: 'O pedido de ficha cai entre dois grupos de mensagens e se perde.', after: 'O Salão abre um chamado para o Material, com status. Chamado urgente toca para todos.' },
  { t: '02:40', before: 'No fechamento, ninguém consegue provar o que aconteceu nem quem fez.', after: 'O Livro Razão guarda cada movimento com data, autor e motivo. Erro se corrige por estorno.' },
];

const PROFILES = [
  { role: 'admin', label: 'Administrador Geral', text: 'Configura e enxerga tudo: eventos, estruturas de blinds, usuários, relatórios e auditoria.' },
  { role: 'material', label: 'Material', text: 'Cuida das fichas e dos fichários: montagem, envio e retorno ao salão, conferência e ocorrências.' },
  { role: 'salao', label: 'Salão', text: 'Conduz a mesa: relógio, entradas, jogadores ativos, mesas e chamados para o Material.' },
];

// Garantias reais do sistema (cada uma existe no código); sem adjetivo, sem número inventado.
const TRUST = [
  { t: 'Livro imutável', d: 'Cada movimento de ficha é gravado e nunca é editado nem apagado.' },
  { t: 'Erro se corrige por estorno', d: 'O estorno aparece no histórico, ao lado do lançamento original.' },
  { t: 'Saldo nunca negativo', d: 'O sistema recusa uma saída maior do que o saldo do fichário.' },
  { t: 'Permissão no servidor', d: 'Esconder o botão não basta: a API confere o perfil em cada ação.' },
  { t: 'Auditoria de cada ação', d: 'Quem fez, quando e o quê, com data, usuário e tipo de ação.' },
  { t: 'Abre sem rede', d: 'Com os últimos dados. As ações em fila sincronizam quando a conexão volta.' },
];

const FAQ = [
  { q: 'O Genesis trabalha com valores em dinheiro?', a: 'Não. O Genesis cuida da logística. As fichas têm apenas valor nominal e não há financeiro, premiação nem buy-in monetário no sistema.' },
  { q: 'Funciona no celular e na TV do salão?', a: 'Sim. A interface se adapta a computador, tablet e celular, pode ser instalada como aplicativo e tem uma tela de projeção própria para a TV.' },
  { q: 'E se a internet oscilar?', a: 'O aplicativo abre sem rede com os últimos dados e sincroniza as ações que ficaram na fila assim que a conexão volta.' },
  { q: 'Cada pessoa vê tudo?', a: 'Não. Cada perfil enxerga só o que precisa, e as permissões são conferidas no servidor, não apenas escondidas na tela.' },
  { q: 'Serve só para torneio grande?', a: 'Não. Um torneio de uma noite e um evento com vários dias usam o mesmo fluxo: evento, torneio, sessões e a estrutura de blinds.' },
  { q: 'Como consigo acesso?', a: 'O Administrador Geral da sua operação cria o acesso. Você recebe uma senha provisória e define a sua no primeiro login.' },
];

/* ── Peças de interface (reproduzem o produto real; nada aqui é imagem) ──────────────────────────────── */

/**
 * "Um sistema, todas as telas": a TV do salão e o celular de quem opera compartilham o MESMO estado. Toque no celular
 * (pausar, registrar entrada) e a TV muda junto. É só uma demonstração local, marcada como exemplo.
 */
function DeviceStage() {
  const START = 18 * 60 + 42;
  const [left, setLeft] = useState(START);
  const [running, setRunning] = useState(true);
  const [players, setPlayers] = useState(142);
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setLeft((s) => (s <= 1 ? START : s - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);
  const clock = `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;

  return (
    <div className="dark relative mx-auto max-w-5xl" data-testid="device-stage">
      {/* TV */}
      <div className="overflow-hidden rounded-3xl border border-line bg-canvas text-fg shadow-[var(--shadow-overlay)]" data-testid="demo-clock">
        <div className="flex items-center justify-between px-6 pt-5 md:px-10 md:pt-8">
          <Logo height={24} className="text-fg" />
          <span className={`badge ${running ? 'badge-ok' : 'badge-warn'}`}><span className="dot" aria-hidden="true" /> {running ? 'Em andamento' : 'Pausado'}</span>
        </div>
        <div className="px-6 pb-2 pt-6 text-center md:pt-10">
          <p className="font-mono text-[clamp(3.25rem,12vw,9rem)] font-semibold leading-none tracking-tight tabular-nums" aria-live="off">{clock}</p>
          <p className="mt-3 text-sm font-semibold text-fg-muted">Nível 7 · Dia 1A · Warm Up</p>
        </div>
        <div className="mt-6 grid grid-cols-3 border-t border-line-soft md:mt-10 [&>*+*]:border-l [&>*]:border-line-soft">
          {[['Blinds', '400 / 800'], ['Próximo', '500 / 1.000'], ['Jogando', String(players)]].map(([k, v]) => (
            <div key={k} className="px-4 py-4 md:px-10 md:py-6"><p className="label !mb-1">{k}</p><p className="num text-lg font-bold md:text-2xl" data-testid={k === 'Jogando' ? 'tv-players' : undefined}>{v}</p></div>
          ))}
        </div>
        <p className="px-6 py-3 text-xs text-fg-subtle md:px-10">TV do salão · exemplo ilustrativo</p>
      </div>

      {/* Celular (Salão): mexe aqui e a TV acompanha */}
      <div className="relative mx-auto mt-6 w-64 rounded-[2.25rem] border-[7px] border-raised bg-canvas p-4 text-fg shadow-[var(--shadow-overlay)] md:absolute md:-bottom-10 md:-right-4 md:mt-0 md:w-60 lg:-right-10"
        role="group" aria-label="Celular do Salão (demonstração interativa)" data-testid="demo-phone">
        <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-raised" aria-hidden="true" />
        <p className="eyebrow">Salão · Dia 1A</p>
        <p className="mt-1 text-sm text-fg-muted">Jogando agora</p>
        <p className="num text-4xl font-bold" data-testid="phone-players">{players}</p>
        <div className="mt-4 grid gap-2">
          <button type="button" onClick={() => setPlayers((n) => n + 1)} className="btn btn-primary btn-sm"><Plus size={14} aria-hidden="true" /> Registrar entrada</button>
          <button type="button" onClick={() => setRunning((r) => !r)} className="btn btn-secondary btn-sm" aria-pressed={!running}>
            {running ? <><Pause size={14} aria-hidden="true" /> Pausar relógio</> : <><Play size={14} aria-hidden="true" /> Retomar relógio</>}
          </button>
        </div>
        <p className="mt-3 text-xs text-fg-subtle">Toque e veja a TV mudar junto.</p>
      </div>
    </div>
  );
}

/** Tracking Sheet: níveis 15 e 16, fim do dia, break e o nível 17 onde o Dia Final começa. */
function BlindsFragment() {
  const rows = [
    { n: '15', sb: '1.500', bb: '3.000', min: '20' },
    { n: '16', sb: '1.600', bb: '3.200', min: '20' },
    { kind: 'end', label: 'Fim do dia classificatório' },
    { kind: 'break', label: 'Break · 15 min' },
    { n: '17', sb: '1.600', bb: '3.200', min: '30', hl: true },
  ];
  return (
    <div className="card !p-0 overflow-hidden" role="img" aria-label="Estrutura de blinds: níveis 15 e 16, fim do dia, break de 15 minutos e o nível 17 onde o Dia Final começa">
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
        <p className="subhead !text-base">Warm Up 2026</p><span className="eyebrow">Tracking Sheet</span>
      </div>
      <table className="w-full text-sm" aria-hidden="true">
        <thead><tr className="text-left text-fg-subtle"><th className="px-5 py-2 font-semibold">Nível</th><th className="py-2 font-semibold">SB</th><th className="py-2 font-semibold">BB</th><th className="px-5 py-2 text-right font-semibold">Min</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (r.kind ? (
            <tr key={i} className="border-t border-line-soft bg-sunken"><td colSpan={4} className="px-5 py-2 text-fg-muted">{r.label}</td></tr>
          ) : (
            <tr key={i} className={`border-t border-line-soft ${r.hl ? 'bg-brand-soft' : ''}`}>
              <td className={`px-5 py-3 font-semibold ${r.hl ? 'text-brand-fg' : ''}`}>{r.n}{r.hl && <span className="badge badge-brand ml-3">Dia Final começa aqui</span>}</td>
              <td className="num py-3">{r.sb}</td><td className="num py-3">{r.bb}</td><td className="num px-5 py-3 text-right">{r.min}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}

/** Chip Race: o que sai e o que entra, com as fichas à vista. */
const CHIPS = { 500: '#d10a0a', 1000: '#1d4ed8', 2000: '#166534' };
function Chip({ v }) { return <span className="inline-block h-4 w-4 rounded-full border border-line" style={{ background: CHIPS[v] }} aria-hidden="true" />; }
function ChipRaceFragment() {
  return (
    <div className="card" role="img" aria-label="Chip Race: retirar quatro fichas de 500, inserir uma ficha de 2.000. Totais iguais.">
      <p className="eyebrow">Chip Race · Dia 1A</p>
      <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center" aria-hidden="true">
        <div className="panel-sunken p-4"><p className="label !mb-2">Retirar</p><p className="flex items-center gap-2 text-lg font-bold"><Chip v={500} /> 4 × 500</p><p className="num mt-1 text-sm text-fg-muted">Total 2.000</p></div>
        <ArrowRight size={20} className="mx-auto rotate-90 text-fg-subtle sm:rotate-0" />
        <div className="panel-sunken p-4"><p className="label !mb-2">Inserir</p><p className="flex items-center gap-2 text-lg font-bold"><Chip v={2000} /> 1 × 2.000</p><p className="num mt-1 text-sm text-fg-muted">Total 2.000</p></div>
      </div>
      <p className="mt-5 flex items-center gap-2 text-sm font-medium text-ok"><Check size={16} aria-hidden="true" /> Totais conferem. Pronto para registrar.</p>
    </div>
  );
}

/** Livro Razão + Ocorrência: cada movimento com autor e hora; divergência vira chamado. */
function LedgerFragment() {
  const rows = [
    { h: '14:02', what: 'Montagem · LISA 1', who: 'Material', q: '+2.000 × 100' },
    { h: '19:40', what: 'Envio ao Salão · Warm Up / Dia 1A', who: 'Material', q: '−800 × 500' },
    { h: '21:47', what: 'Conferência · diferença no fichário', who: 'Material', q: '−12 × 500', badge: ['badge-danger', 'Ocorrência vermelha'] },
  ];
  return (
    <div className="card !p-0 overflow-hidden" role="img" aria-label="Livro Razão com montagem, envio ao Salão e uma ocorrência vermelha aberta na conferência">
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-3"><p className="subhead !text-base">Livro Razão</p><span className="eyebrow">Imutável</span></div>
      <ul className="hairline-list" aria-hidden="true">
        {rows.map((r) => (
          <li key={r.h} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
            <span className="font-mono text-fg-subtle">{r.h}</span>
            <span className="min-w-0 flex-1 font-medium">{r.what}</span>
            {r.badge && <span className={`badge ${r.badge[0]}`}>{r.badge[1]}</span>}
            <span className="num font-semibold">{r.q}</span><span className="text-fg-muted">{r.who}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Menu real de cada perfil (vem da mesma fonte do aplicativo: NAV_GROUPS + permissões). */
function RoleMenu({ role }) {
  const { t } = useT();
  const groups = visibleGroups(role);
  return (
    <div className="card" data-testid="role-menu" aria-live="polite">
      {groups.map((g) => (
        <div key={g.key} className="border-t border-line-soft py-3 first:border-t-0 first:pt-0 last:pb-0">
          <p className="nav-group-title !px-0">{t(g.key)}</p>
          <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium">
            {g.items.map((i) => <li key={i.to}>{t(i.key)}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Chapter({ title, children, fragment, flip = false }) {
  return (
    <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-12%' }} transition={SPRING_SNAP}
      className="grid items-center gap-10 md:grid-cols-2 md:gap-16">
      <div className={flip ? 'md:order-2' : ''}>
        <h3 className="headline">{title}</h3>
        <p className="lede mt-5">{children}</p>
      </div>
      <div className={flip ? 'md:order-1' : ''}>{fragment}</div>
    </motion.div>
  );
}

function Faq({ item }) {
  return (
    <details className="group py-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-lg font-semibold">
        {item.q}
        <ChevronDown size={20} className="shrink-0 text-fg-subtle transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
      </summary>
      <p className="lede pb-6 pr-10">{item.a}</p>
    </details>
  );
}

/**
 * /site — página pública e primeira tela de quem não está logado. Narrativa: a noite sem sistema × a mesma noite no Genesis,
 * depois o produto por dentro (peças reais da interface) e os perfis. Padrão Apple: tipografia grande, ar, movimento por mola.
 */
export default function Landing({ theme, onToggleTheme, ctaTo = '/login', ctaLabel = 'Entrar' }) {
  const [active, setActive] = useState('');
  const [role, setRole] = useState('admin');
  const heroRef = useRef(null);

  // o Telão "cresce" ao rolar (Apple: o produto ganha presença) — mola suave, só transform
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const scale = useSpring(useTransform(scrollYProgress, [0, 1], [1, 0.94]), { stiffness: 120, damping: 24, mass: 0.4 });

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: '-40% 0px -50% 0px', threshold: [0, 0.2, 0.6] });
    NAV.forEach((n) => { const el = document.getElementById(n.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);

  const go = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const profile = PROFILES.find((p) => p.role === role);

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <SiteHeader theme={theme} onToggleTheme={onToggleTheme} nav={NAV} active={active} onNav={go}
        action={<Link to={ctaTo} className="btn btn-primary btn-sm">{ctaLabel}</Link>} />

      <main>
        {/* ── Abertura ────────────────────────────────────────── */}
        <section ref={heroRef} className="mx-auto max-w-6xl px-5 pb-8 pt-16 md:pt-24" aria-labelledby="hero-title">
          <p className="eyebrow">Para equipes de salão e de material</p>
          <h1 id="hero-title" className="display mt-4 max-w-4xl">Com a mesa cheia, ninguém pode errar a conta.</h1>
          <p className="lede mt-6 max-w-2xl">
            O Genesis é o sistema que o salão e o material usam para tocar o torneio: relógio de blinds, fichas, Chip Race e chamados no mesmo lugar, em tempo real.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link to={ctaTo} className="btn btn-primary btn-lg">{ctaLabel === 'Entrar' ? 'Entrar no Genesis' : ctaLabel} <ArrowRight size={18} aria-hidden="true" /></Link>
            <a href="#problema" onClick={go('problema')} className="inline-flex items-center gap-1.5 text-base font-semibold text-fg-muted hover:text-fg">Ver uma noite de torneio <ArrowDown size={16} aria-hidden="true" /></a>
          </div>
          <motion.div style={{ scale, transformOrigin: 'top center' }} className="mt-14 pb-4 md:mt-20 md:pb-14"><DeviceStage /></motion.div>
        </section>

        {/* ── Fatos do produto (todos verificáveis; nada de número de cliente) ─ */}
        <section aria-label="O Genesis em fatos" className="border-y border-line-soft bg-surface">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-y-6 px-5 py-8 md:grid-cols-4 md:[&>*+*]:border-l md:[&>*]:border-line-soft md:[&>*]:px-8 md:[&>*:first-child]:pl-0">
            {[[String(NAV_ITEMS.length), 'módulos de operação'], [String(PROFILES.length), 'perfis com menus próprios'], ['1', 'relógio por sessão'], ['0', 'valores em dinheiro']].map(([n, l]) => (
              <div key={l}><dd className="num text-4xl font-bold md:text-5xl">{n}</dd><dt className="mt-1 text-sm text-fg-muted">{l}</dt></div>
            ))}
          </dl>
        </section>

        {/* ── O problema × a mesma noite no Genesis ───────────── */}
        <section id="problema" className="scroll-mt-20 py-24 md:py-36" aria-labelledby="noite-title">
          <div className="mx-auto max-w-6xl px-5">
            <div className="max-w-3xl">
              <p className="eyebrow">Uma noite de Dia 1A</p>
              <h2 id="noite-title" className="headline mt-3">A mesma noite, com e sem sistema.</h2>
              <p className="lede mt-5">Todo erro de torneio acontece em horário de pico. Veja cinco momentos, lado a lado.</p>
            </div>
            <div className="mt-14 hidden grid-cols-[5rem_1fr_1fr] gap-x-10 border-b border-line pb-3 text-sm font-semibold text-fg-subtle md:grid" aria-hidden="true">
              <span /><span>Sem sistema</span><span className="text-fg">Com o Genesis</span>
            </div>
            <ol className="hairline-list">
              {NIGHT.map((r) => (
                <motion.li key={r.t} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-10%' }} transition={SPRING_SNAP}
                  className="grid gap-x-10 gap-y-3 py-7 md:grid-cols-[5rem_1fr_1fr]">
                  <time className="font-mono text-base font-semibold text-fg-subtle">{r.t}</time>
                  <p className="text-fg-muted"><span className="mb-1 block text-xs font-semibold text-fg-subtle md:hidden">Sem sistema</span>{r.before}</p>
                  <p className="font-medium"><span className="mb-1 block text-xs font-semibold text-brand-fg md:hidden">Com o Genesis</span>{r.after}</p>
                </motion.li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── O produto por dentro ────────────────────────────── */}
        <section id="pratica" className="scroll-mt-20 bg-surface py-24 md:py-36" aria-labelledby="pratica-title">
          <div className="mx-auto max-w-6xl space-y-28 px-5 md:space-y-40">
            <div className="max-w-3xl">
              <p className="eyebrow">Na prática</p>
              <h2 id="pratica-title" className="headline mt-3">Feito para o que acontece na mesa.</h2>
            </div>
            <Chapter title="O Dia Final já abre no nível certo." fragment={<BlindsFragment />}>
              Cada sessão classificatória tem o seu relógio. As estruturas de blinds ficam salvas na Tracking Sheet, são copiadas para cada torneio e o Dia Final começa direto no nível seguinte, com os valores que a direção definiu.
            </Chapter>
            <Chapter flip title="Chip Race sem calculadora." fragment={<ChipRaceFragment />}>
              Informe o que sai e o que entra. O Genesis confere os totais, mostra a quebra de fichas e registra tudo na sessão certa, sem refazer conta com a mesa esperando.
            </Chapter>
            <Chapter title="Cada ficha deixa rastro." fragment={<LedgerFragment />}>
              Saldos de fichário vêm das movimentações e nunca ficam negativos. Divergência vira ocorrência com gravidade e responsável, e erro se corrige por estorno, nunca apagando o histórico.
            </Chapter>
          </div>
        </section>

        {/* ── Perfis ──────────────────────────────────────────── */}
        <section id="perfis" className="scroll-mt-20 py-24 md:py-36" aria-labelledby="perfis-title">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 md:grid-cols-[1fr_1.1fr] md:gap-20">
            <div>
              <p className="eyebrow">Perfis</p>
              <h2 id="perfis-title" className="headline mt-3">Cada pessoa vê só o que precisa.</h2>
              <p className="lede mt-5">{profile.text} As permissões são conferidas no servidor.</p>
              <div className="mt-8 inline-flex rounded-full bg-sunken p-1" role="group" aria-label="Escolher o perfil">
                {PROFILES.map((p) => (
                  <button key={p.role} type="button" aria-pressed={role === p.role} onClick={() => setRole(p.role)}
                    className={`btn btn-sm ${role === p.role ? 'btn-primary' : 'btn-ghost'}`}>{p.label}</button>
                ))}
              </div>
            </div>
            <RoleMenu role={role} />
          </div>
        </section>

        {/* ── Confiança ───────────────────────────────────────── */}
        <section id="confianca" className="scroll-mt-20 bg-surface py-24 md:py-36" aria-labelledby="conf-title">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 md:grid-cols-[1fr_1.4fr] md:gap-20">
            <div className="md:sticky md:top-28 md:self-start">
              <p className="eyebrow">Confiança por construção</p>
              <h2 id="conf-title" className="headline mt-3">Feito para não perder uma ficha.</h2>
              <p className="lede mt-5">Seis garantias que o sistema cumpre sozinho, sem depender de memória nem de boa vontade.</p>
            </div>
            <dl className="hairline-list">
              {TRUST.map((x) => (
                <div key={x.t} className="grid gap-1 py-5 md:grid-cols-[13rem_1fr] md:gap-8"><dt className="font-semibold">{x.t}</dt><dd className="text-fg-muted">{x.d}</dd></div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Perguntas ───────────────────────────────────────── */}
        <section id="faq" className="scroll-mt-20 py-24 md:py-36" aria-labelledby="faq-title">
          <div className="mx-auto max-w-3xl px-5">
            <h2 id="faq-title" className="headline">Perguntas frequentes</h2>
            <div className="hairline-list mt-10">{FAQ.map((f) => <Faq key={f.q} item={f} />)}</div>
          </div>
        </section>

        {/* ── Fechamento ──────────────────────────────────────── */}
        <section className="mx-auto max-w-6xl px-5 py-24 md:py-36" aria-labelledby="fim-title">
          <h2 id="fim-title" className="display max-w-3xl">Entre e abra o dashboard.</h2>
          <p className="lede mt-5 max-w-xl">Use o acesso da sua equipe. Se ainda não tem, peça ao administrador.</p>
          <Link to={ctaTo} className="btn btn-primary btn-lg mt-8">{ctaLabel === 'Entrar' ? 'Entrar no Genesis' : ctaLabel} <ArrowRight size={18} aria-hidden="true" /></Link>
        </section>
      </main>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-fg-muted">
          <Logo height={24} className="text-fg" />
          <p>Precisão em cada segundo.</p>
        </div>
      </footer>
    </div>
  );
}
