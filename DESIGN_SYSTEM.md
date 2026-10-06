# GENESIS — Design System

Fonte única de verdade da identidade visual, de UX e de idioma do Genesis. **Toda alteração de interface deve seguir este documento.**
Implementação: `frontend/src/index.css` (tokens + classes de componente). Stack: React 19 · Tailwind CSS v4 · lucide-react · framer-motion.

> Regra do projeto (CLAUDE.md): **nada de dinheiro na interface** — sem R$, buy-in monetário, premiação ou rake. Fichas têm só **valor nominal**.

---

## 1. Identidade

**Conceito: "sala de controle".** O Genesis é uma ferramenta de operação, usada sob pressão, em salão de torneio, muitas vezes em tablet/celular e em TV. A interface precisa ser **legível, densa e previsível** — nunca decorativa.

| Princípio | O que significa na prática |
|---|---|
| **Estilo** | Minimalismo / Swiss: grade, hierarquia tipográfica clara, superfícies planas com borda fina, muito contraste, quase nenhuma sombra. |
| **Números são o produto** | Quantidades de fichas, jogadores e saldos usam algarismos tabulares (`.num`, `tabular-nums`) e ficam alinhados à direita nas tabelas. |
| **Cor é sinal, não enfeite** | Vermelho da marca só em ação primária, item ativo da navegação e foco. Status usa tokens semânticos (ok/warn/danger/info) **sempre acompanhados de texto**. |
| **Densidade operacional** | Tabelas e cartões compactos (texto 14 px). Alvos de toque ≥ 40 px (44 px no mobile). |
| **Dois temas de primeira classe** | Claro e escuro com os mesmos tokens. O **Telão** (projeção) é sempre escuro. |
| **Honestidade de dados** | Rótulo = significado. "Enviado", "No Salão" e "Em jogo" são coisas diferentes (ver §10) e nunca se reaproveitam. |

Marca: wordmark `GENESIS` em Fira Sans bold, espaçamento de letras `0.18em`, precedido de um **quadrado vermelho de 12 px** (`bg-brand rounded-sm`). É o único elemento decorativo do sistema.

---

## 2. Tokens

Definidos como variáveis CSS semânticas (`:root` = claro, `.dark` = escuro) e expostos ao Tailwind via `@theme inline`. **Use sempre o nome semântico**; nunca hex solto, `gray-*`/`zinc-*` crus, nem `dark:` para cor de superfície/texto/borda (o token já troca de tema).

### 2.1 Superfícies e bordas

| Token (Tailwind) | Claro | Escuro | Uso |
|---|---|---|---|
| `canvas` | `#f5f6f8` | `#0b0d10` | Fundo da página |
| `surface` | `#ffffff` | `#12151a` | Cartões, painéis, modais, sidebar |
| `sunken` | `#f0f2f5` | `#181c22` | Campos, estatísticas internas, área rebaixada, hover de linha |
| `raised` | `#e6e9ee` | `#20252d` | Chip neutro, hover de item neutro |
| `line` | `#d8dde5` | `#2a3039` | Borda padrão (cartão, campo, divisória forte) |
| `line-soft` | `#e7ebf0` | `#1e232a` | Divisória interna (linhas de tabela/lista) |

### 2.2 Texto

| Token | Claro | Escuro | Contraste sobre `surface` | Uso |
|---|---|---|---|---|
| `fg` | `#0f172a` | `#f1f5f9` | 17,9 : 1 / 16,7 : 1 | Texto principal, números |
| `fg-muted` | `#475569` | `#a8b3c4` | 7,6 : 1 / 8,6 : 1 | Texto secundário, descrições |
| `fg-subtle` | `#5b6779` | `#8c98ab` | 5,7 : 1 / 6,3 : 1 | Rótulos, ajuda, metadados (**mínimo permitido** para texto) |

`text-gray-400/500/600/900` do Tailwind estão remapeados para `fg-subtle/fg-muted/fg`, mas **código novo usa os tokens `fg-*`**.

### 2.3 Marca e status

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `brand` | `#d10a0a` | `#d10a0a` | **Preenchimento** da marca (botão primário). Texto branco sobre ele: 5,6 : 1 |
| `brand-hover` | `#a80707` | `#e51a1a` | Hover do botão primário |
| `brand-fg` | `#b00808` | `#ff7878` | Marca como **texto/ícone/link** sobre `surface` (7,3 : 1 / 7,2 : 1) |
| `brand-soft` | `#fdecec` | `#2a1214` | Fundo suave (item ativo da nav, badge de marca) |
| `ok` / `ok-soft` | `#166534` / `#e6f6ec` | `#5fd68a` / `#0f2418` | Em andamento, concluído, saldo livre, sucesso |
| `warn` / `warn-soft` | `#92400e` / `#fdf3dc` | `#f2b84b` / `#2a2010` | Pausa/intervalo, atenção, provisório, pendente |
| `danger` / `danger-soft` | `#b42318` / `#fdeceb` | `#ff8a80` / `#2b1413` | Erro, destrutivo, divergência |
| `info` / `info-soft` | `#1d4ed8` / `#e8efff` | `#8fb0ff` / `#121c33` | Agendado, informativo |
| `on-ok`, `on-warn` | `#fff` | `#04210f`, `#1f1403` | Texto sobre botão preenchido `ok`/`warn` (garante AA nos dois temas) |
| `scroll-thumb` / `scroll-thumb-hover` | `#c3cad5` / `#8a95a6` | `#333b47` / `#566174` | Barra de rolagem (fina, 10 px, trilho transparente, cantos arredondados) |
| `overlay` | `rgba(15,23,42,.55)` | `rgba(0,0,0,.7)` | Fundo de modal/drawer (`bg-[var(--overlay)]`) |

Contrastes verificados: todo par texto/fundo acima ≥ **4,5 : 1** (WCAG AA). Ao criar combinação nova, calcule antes.

### 2.4 Tipografia

- **Fira Sans** (400/500/600/700) — interface. **Fira Code** (400–700) — dígitos do relógio, códigos, identificadores (`font-mono`).
- Tamanho-base do app: **14 px / 1,5**. Nenhum texto abaixo de **12 px** (`text-xs`). `text-[10px]`, `text-[9px]` etc. estão proibidos.
- Pesos: 400 corpo · 500 itens de navegação/ênfase leve · **600 rótulos, botões, títulos de cartão** · 700 títulos de página e números de destaque. **`font-black`/`font-extrabold` não existem** no sistema.

| Papel | Classe | Especificação |
|---|---|---|
| Título de página | `.page-title` | 24/32 · 700 · tracking −0,01em |
| Subtítulo de página | `.page-sub` | 14 · `fg-muted` |
| Título de cartão | `.card-title` | 16 · 600 |
| Dica de cartão | `.card-hint` | 12 · `fg-subtle` |
| Título de seção (sobre/entre cartões) | `.section-title` | 12 · 600 · MAIÚSCULAS · tracking 0,06em · `fg-subtle` |
| Rótulo de campo | `.label` | 12 · 600 · MAIÚSCULAS · tracking 0,04em |
| Indicador grande | `.stat-value` | 30/36 · 700 · tabular |
| Número tabular | `.num` / `tabular-nums` | `font-variant-numeric: tabular-nums` |

**Caixa alta** só em `.label`, `.section-title`, cabeçalho de tabela e badges curtos. Títulos, botões e nomes ficam em caixa de frase.

### 2.5 Espaço, raio, elevação, movimento

- **Espaçamento:** escala de 4 px do Tailwind. Cartão `p-5` (denso `p-4`), gap entre cartões `gap-4`, página `p-4` mobile / `p-6` desktop, seções separadas por `space-y-6`.
- **Raio:** `rounded-lg` = 8 px (controles, botões, itens de nav) · `rounded-2xl` = 12 px (cartões, modais, painéis) · `rounded-full` (badges, avatar). A escala antiga `rounded-3xl`, `rounded-[32px]`, `[40px]` foi colapsada para 12 px.
- **Elevação:** superfícies são **planas** (borda `line`, sem sombra). Sombra só em camada flutuante: modal, drawer, dropdown (`shadow-2xl` = `--shadow-overlay`). Sombras coloridas (`shadow-red-500/20` etc.) são proibidas.
- **Movimento:** 150–220 ms, `ease-out`; só `opacity`/`transform`/cor. Entrada de modal/drawer ≤ 220 ms; saída mais rápida que a entrada. `prefers-reduced-motion` já zera animações globalmente. Nada de animação decorativa contínua; `animate-pulse` só em indicador de "ao vivo" ou carregando.
- **Rolagem:** barras finas e neutras definidas globalmente em `index.css` (não estilizar por componente). `.scroll-x` esconde a barra só em carrosséis horizontais.
- **Foco:** anel de 2 px `brand-fg` com offset de 2 px (global, `:focus-visible`). **Nunca remover.**
- **Ícones:** apenas `lucide-react`, 16 px (inline/botão), 18 px (navegação), 20–24 px (indicadores). Ícone decorativo leva `aria-hidden="true"`; botão só com ícone leva `aria-label`. **Sem emoji em nenhum lugar da plataforma** (nem ☕, ✓, ⚠ ou ● como ícone): use ícone `lucide-react` (ex.: `Coffee` para intervalo) ou `.dot` para marcador de estado.

---

## 3. Componentes (classes semânticas)

Todas em `index.css`, camada `@layer components`. Combine com utilitários de **layout** (`w-full`, `flex-1`, `mt-4`, `col-span-2`…), nunca para redefinir cor/raio/peso.

### 3.1 Cartão
```jsx
<section className="card">
  <h2 className="card-title">Fichas por denominação</h2>
  <p className="card-hint">Saldo derivado das movimentações.</p>
  …conteúdo…
</section>
```
`.card` = `surface` + borda `line` + 12 px + `p-1.25rem`. Variantes: `.card-flush` (sem padding, para tabelas/listas que vão até a borda), `.panel-sunken` (bloco interno rebaixado). Cartão clicável: `<button className="card text-left hover:border-fg-subtle">`.

### 3.2 Botões — `.btn` + variante (+ tamanho)
| Variante | Quando |
|---|---|
| `.btn-primary` | **Uma** ação principal por contexto (Salvar, Solicitar, Entrar, Novo…) |
| `.btn-secondary` | Ações comuns (Cancelar, Fechar, filtros) |
| `.btn-ghost` | Ação terciária / ícone sem borda |
| `.btn-danger` | Destrutiva (contorno vermelho; **confirmar antes**) |
| `.btn-success` · `.btn-warn` · `.btn-info` · `.btn-neutral` | Estados do torneio: Iniciar/Retomar (`success`), Pausar (`warn`), Finalizar (`neutral`) |

Tamanhos: padrão 40 px · `.btn-sm` 32 px (densidade) · `.btn-lg` 44 px (login, mobile) · `.btn-icon` (quadrado, só ícone + `aria-label`).
Estados obrigatórios: hover (150 ms), `:disabled` (opacidade .45, `cursor-not-allowed`), carregando (texto "Salvando…" + `disabled`). Ação assíncrona nunca fica sem feedback.

### 3.3 Campos
```jsx
<label htmlFor="f-mesas" className="label">Mesas abertas</label>
<input id="f-mesas" className="input" type="number" min="1" />
<p className="field-help">Quantidade real de mesas abertas agora.</p>
<p className="field-error" role="alert">Informe um inteiro ≥ 1.</p>
```
`.input` serve para `input`, `select` e `textarea`; `.input-error` marca inválido. **Rótulo sempre visível** (placeholder não é rótulo). Erro aparece junto ao campo, em texto + borda `danger`. Selects customizados usam `components/CustomSelect.jsx` (mesma aparência do seletor de torneio). O menu é desenhado num **portal fixo no `body`**: nunca é cortado por modal/popup com rolagem, abre para cima quando falta espaço e tem teclado (↑ ↓ Enter Esc Home End). **Não usar `<select>` nativo.**

**Fuso horário:** sempre via `lib/timezones.js` (`timezoneOptions`), rótulo `(UTC−03:00) Brasília, São Paulo e Rio de Janeiro`, ordenado do oeste ao leste.

### 3.4 Badge de status — `.badge` + `.badge-{ok|warn|danger|info|neutral|brand}`
Sempre **texto**; pode ter `<span className="dot" />` antes. Mapeamento fixo:

| Estado | Badge |
|---|---|
| Torneio/sessão **em andamento**, saldo livre, concluído | `badge-ok` |
| **Pausado**, intervalo, solicitado, provisório | `badge-warn` |
| **Agendado**, informativo, em preparo | `badge-info` |
| Encerrado/finalizado, sem estado | `badge-neutral` |
| Divergência, erro, cancelado, perda | `badge-danger` |

Semáforo de ocorrência (vermelho/amarelo/verde) usa `SeverityBadge` (texto + ícone, não só cor).

### 3.5 Modal e drawer
```jsx
<div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="t">
  <div className="modal-backdrop" onClick={fechar} />
  <div className="modal-panel max-w-lg">
    <div className="modal-head"><h2 id="t" className="card-title">Título</h2><button className="btn btn-ghost btn-icon" aria-label="Fechar"><X size={18}/></button></div>
    <div className="p-5">…</div>
    <div className="modal-foot"><button className="btn btn-secondary">Cancelar</button><button className="btn btn-primary">Confirmar</button></div>
  </div>
</div>
```
Fecha com `Esc` e clique no fundo (`hooks/useModalDismiss`). Fundo `bg-[var(--overlay)]` **sem blur**. Rodapé: ação primária à direita.

### 3.6 Tabela densa — `.table-dense`
Cabeçalho 12 px maiúsculo `fg-subtle`; células 14 px tabulares; linha com hover `sunken`; coluna numérica com `.num-col` (alinhada à direita). Em telas estreitas a tabela fica dentro de `overflow-x-auto` (nunca rolagem horizontal da página).

### 3.7 Relógio de torneio no Dashboard — `components/RunningClocks.jsx`
Seção "Torneios em andamento": um cartão por torneio rodando, com relógio ao vivo (socket) em Fira Code, nível de **jogo** + blinds e quantos estão jogando. **Em intervalo/dinner break** o cartão muda de cor (`border-warn bg-warn-soft ring-1 ring-warn`), mostra o selo `Intervalo` com ícone `Coffee` e "Volta no Nível N · blinds". Pausado: fundo `sunken` + selo "Pausado". Último minuto do nível: dígitos em `brand-fg`.

### 3.8 Avatar (foto do usuário) — `components/Avatar.jsx`
`<Avatar user={user} size="xs|sm|md|lg|xl" />`: imagem redonda com borda `line`; **sem foto, a inicial do nome** sobre `sunken`. É decorativo (`alt=""`): o nome sempre aparece ao lado. Tamanhos: `xs` 20 (listas compactas) · `sm` 32 (mensagens do chat) · `md` 36 (menu) · `lg` 48 (cartão de usuário) · `xl` 96 (Minha conta). Cada usuário troca a **própria** foto em *Minha conta → Dados → Foto de perfil* (`PUT/DELETE /me/avatar`): o navegador recorta o centro em quadrado de 256 px, converte para JPEG e comprime (`lib/image.js › fileToAvatarDataURL`); o servidor só aceita JPEG/PNG/WebP (SVG é recusado) e até ~150 mil caracteres. No **Chat** a foto vem de `GET /chat/avatars` (mapa `{e-mail: foto}`, uma vez por sessão e de novo quando aparece um remetente novo), nunca embutida em cada mensagem. Novas telas que mostram uma pessoa devem usar `Avatar` ao lado do nome.

### 3.9 Navegação
- **Desktop:** sidebar fixa de 240 px (`w-60`), `bg-surface`, borda à direita. Item `.nav-item`; ativo `.nav-item-active` (fundo `brand-soft`, texto `brand-fg`, barra de 3 px à esquerda).
- **Mobile:** barra superior de 56 px (menu · marca · tema), **barra inferior de 5 itens no máximo** (60 px + safe-area) e drawer para o restante.
- Ordem do menu (por perfil via `config.js › PERMISSIONS`): Dashboard, Salão, Eventos, Torneios, Chip Race, Fichas, Livro-razão, Ocorrências, Fichários, Chat, Stacks, Relatórios, Auditoria, Usuários.

---

## 4. Layout de página

```
<div className="max-w-7xl mx-auto space-y-6">
  <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div><h1 className="page-title">Título</h1><p className="page-sub">Subtítulo de uma linha.</p></div>
    <div className="flex gap-2">…ação primária (btn-primary) e secundárias…</div>
  </header>
  …cartões / grades (gap-4)…
</div>
```
- Um `h1` por página, mesmo estilo em todas. Ícone no título só quando agrega (`flex items-center gap-2`, ícone 22 px `text-brand-fg`).
- Indicadores: grade `grid grid-cols-1 md:grid-cols-3 gap-4` de `.card` com `.section-title` (+ ícone 16 px), `.stat-value` e `.card-hint`.
- Breakpoints: mobile-first; testar 375, 768, 1024, 1440 px. Sem rolagem horizontal da página. Sidebar a partir de `md`.

---

## 5. Padrões de interação

- **Confirmar o irreversível** (excluir, estornar, encerrar, finalizar) com `showConfirm`; operações que alteram histórico exigem **motivo** (`showPrompt`). Registros nunca são apagados: cancelam-se/estornam-se com motivo.
- **Feedback imediato:** toda ação mostra resultado em `showAlert` (success/error/info) e o botão fica `disabled` + texto de progresso enquanto roda.
- **Estado vazio** sempre explica o que fazer ("Nenhum chamado em aberto.", itálico `fg-subtle`). **Carregando:** texto + `animate-pulse`.
- **Divulgação progressiva:** detalhe sob clique (ex.: "Fichários livres · clique para ver quais"), com `aria-expanded`.
- **Permissão:** botão que o perfil não pode usar **não aparece** (a API também barra). Se o dado é consultável mas não editável, o campo fica `disabled` com uma nota explicando quem opera.
- **Tempo real:** valores vêm do servidor/socket; a UI não recalcula regra de negócio.
- **Erros:** mensagem do servidor em português, perto da ação; nunca só no topo.

---

## 6. Telão (projeção)

Rota `/torneios/:id/telao`. Raiz com classe `dark` (tema escuro forçado), sem sidebar. Relógio em **Fira Code** gigante (`text-[22vw] md:text-[16rem]`), contraste máximo. **Intervalo / dinner break:** cartão com `border-warn bg-warn-soft`, faixa `bg-warn` com "Intervalo" ou "Dinner break · volta no Nível N (blinds)". Nível exibido = nº do nível de **jogo** da estrutura (intervalos e marcadores não contam). Mostrar a **sessão** no ar (Dia 1A + 1B). No último minuto de cada nível os dígitos ficam em `brand-fg`.

---

## 7. Acessibilidade (checklist obrigatório)

- [ ] Contraste de texto ≥ 4,5 : 1 nos dois temas; texto grande/ícones ≥ 3 : 1.
- [ ] Foco visível em tudo que é interativo; ordem de tab = ordem visual.
- [ ] Todo campo com `label` associado (`htmlFor`/`id`); erros com `role="alert"`.
- [ ] Botão só-ícone com `aria-label`; ícone decorativo `aria-hidden`.
- [ ] Estado nunca só por cor (badge = cor + texto; semáforo = cor + ícone + texto).
- [ ] Alvo de toque ≥ 40 px (44 px no mobile); espaço ≥ 8 px entre alvos.
- [ ] Modal: `role="dialog" aria-modal="true"`, `Esc` fecha, foco volta ao gatilho.
- [ ] `aria-current="page"` no item ativo da barra inferior; `aria-expanded` em disclosure; `aria-pressed` em alternadores (idioma).
- [ ] Respeitar `prefers-reduced-motion` (já global).

---

## 8. O que NÃO fazer

| Não | Faça |
|---|---|
| `text-[10px]`, `font-black`, `tracking-widest`, MAIÚSCULAS em títulos/botões | `text-xs` mínimo, `font-semibold`/`bold`, caixa de frase |
| `bg-[#141414]`, `dark:bg-zinc-800`, `text-gray-400 dark:text-gray-500` | `bg-surface`, `bg-sunken`, `text-fg-subtle` |
| `rounded-3xl`, `rounded-[40px]` | `rounded-2xl` (cartão/modal) ou `rounded-lg` (controle) |
| Sombra em cartão, sombra colorida, `backdrop-blur` em modal | Borda `line`; sombra só no overlay |
| Botão vermelho para tudo | `btn-primary` só na ação principal; resto `secondary`/`ghost` |
| Emoji ou símbolo-emoji (☕ ✓ ⚠ ●) em qualquer texto/ícone, ícone sem rótulo | `lucide-react` + `aria-label`; `.dot` para marcador |
| Valor em R$, "buy-in" monetário, premiação | Só valor **nominal** de ficha |
| Hex novo, cor nova fora dos tokens | Acrescente token em `index.css` (claro **e** escuro) e documente aqui |

---

## 9. Como evoluir o sistema

1. **Reaproveite** classe/token existente. Só crie novo quando houver 3+ usos.
2. Novo token de cor: definir em `:root` e `.dark`, expor em `@theme inline`, **verificar contraste ≥ 4,5 : 1**, registrar na §2.
3. Novo componente: classe em `@layer components` de `index.css` (nome `.kebab-case`), exemplo na §3, estados hover/focus/disabled.
4. Teste visual nos **dois temas** e em 375 px antes de concluir; rode `npm run lint`, `npm test` e `npm run build`.
5. Atualize este documento **no mesmo commit** da mudança de interface.

---

## 10. Vocabulário da interface (consistência de rótulos)

| Termo | Significado (não reutilizar para outra coisa) |
|---|---|
| **Inscrições** | Entradas iniciais + reentradas (acumulado; não muda ao eliminar) |
| **Jogando** | Jogadores ativos agora (informado pelo Salão; eliminar reduz) |
| **Enviado** | Movimentação física ao Salão (acumulado) |
| **No Salão** | Enviado − devolvido ± conversões (saldo físico no Salão) |
| **Em jogo** | O que as entradas já entregaram aos jogadores (= Chip Count) |
| **Disponível no Salão** | No Salão − em jogo (ainda não usado) |
| **Falta enviar** | Em jogo − No Salão, quando positivo |
| **Reservado** | Separado para torneios dentro do fichário (alocação) |
| **Livre** | Saldo − reservado |
| **Fichário** | Unidade física única (nome, código, estampa); **não existe "modelo de fichário"** |
| **Chamado** | Pedido do Salão ao Material (Chip Race/Color Up): solicitado → em preparo → fichas prontas → concluído / cancelado |

Perfis: **Admin** (tudo; auditoria; encerrar sessões) · **Salão** (entradas, ativos, relógio, sessões, solicita trocas) · **Material** (fichas, envio/retorno, atende chamados; só consulta o Salão).

---

## 11. Idiomas (pt-BR · en)

- O código-fonte escreve a interface **em português**. Todo texto renderizado (filhos de elemento, `title`, `placeholder`, `aria-label`, `alt`, `label`) passa por `tr()` através do **jsx-runtime próprio** (`frontend/src/lib/i18n-runtime`, ligado em `vite.config.js` via `jsxImportSource`). Em inglês, `tr()` consulta o dicionário `frontend/src/locales/en-ui.js`; em português é identidade.
- **Texto novo na interface = linha nova em `en-ui.js`** (`'Texto em português': 'English text'`). Texto com valor embutido usa `{}` como curinga, na mesma ordem: `'Total de {} fichas': 'Total of {} chips'`. Mensagens de `showAlert/showConfirm/showPrompt` também são traduzidas (passam como filhos do toast/modal).
- Vocabulário: **Salão = Floor**, **Material = Materials**, **Fichário = Binder**, **Ficha = Chip**, **Torneio = Tournament**, **Em jogo = In play**, **Estorno = Reversal**.
- Dados vindos do servidor (nomes de torneio, fichário, evento, motivos digitados) **não** são traduzidos; só os rótulos fixos e as ações do log (já no dicionário). Nomes de sessão no padrão `Dia 1A` viram `Day 1A`.
- Números e datas usam `locale()` (`'pt-BR'` ou `'en-US'`), **nunca** a string `'pt-BR'` fixa.
- Trocar o idioma remonta a árvore (`<App key={lang}>`): nenhum componente precisa de hook para traduzir. O idioma fica em `localStorage.genesis_lang` e em `<html lang>`.
- Teste: `lib/i18n-runtime/translate.test.js` garante que cada tradução preserva os curingas `{}`.

---

## 12. Conta do usuário

"Trocar senha" **não fica no menu lateral**. O cartão do usuário (topo da sidebar) abre `/conta` ("Minha conta"): dados do usuário e formulário de troca de senha (`pages/Conta.jsx` + `pages/ChangePassword.jsx` com `embedded`). A rota `/conta` vale para todos os perfis e concentra as **preferências do usuário**: dados, **idioma da interface** (Português / English, `aria-pressed`) e trocar senha. O idioma **não** fica no menu lateral; no rodapé da sidebar só ficam o botão de sair (e, no celular, o alternador de tema).

---

## 13. Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `frontend/src/index.css` | Tokens, tema, base e **todas as classes de componente** |
| `frontend/src/components/Sidebar.jsx` | Navegação (desktop, drawer, barra inferior), marca |
| `frontend/src/App.jsx` | Shell (header mobile, `main`, rotas) |
| `frontend/src/pages/Login.jsx` | Entrada (usa `.card`, `.input`, `.btn-primary`) |
| `frontend/src/components/TournamentClock.jsx` · `pages/Telao.jsx` | Relógio e projeção |
| `frontend/src/components/CustomSelect.jsx` | Select padronizado (menu em portal) |
| `frontend/src/lib/i18n-runtime/` · `frontend/src/locales/en-ui.js` | Tradução de toda a interface (runtime + dicionário pt→en) |
| `frontend/src/pages/Conta.jsx` | Minha conta (dados, foto, idioma, trocar senha) |
| `frontend/src/components/Avatar.jsx` | Foto/inicial do usuário |
| `frontend/src/lib/timezones.js` | Lista e formatação dos fusos horários |
| `frontend/src/components/RunningClocks.jsx` | Relógios dos torneios em andamento (Dashboard) |
| `frontend/src/config.js` | Rotas ↔ áreas de permissão |
