# Gênesis — Reorganização do menu, Tracking Sheet e continuidade de blinds

> Documento em duas partes: **(A) Instrução** (o que foi pedido, consolidado) e **(B) Plano de execução** (como resolver, com base no código atual).
> Princípio: **MENOS CLIQUES, MAIS AÇÃO, MAIS VISIBILIDADE.** Mudar o mínimo possível; reutilizar o que existe.

---

# PARTE A — INSTRUÇÃO

## A.0 Regras invioláveis
- Nada que envolva dinheiro (CLAUDE.md). Blinds/ante são fichas, não valores monetários.
- Visual segue `DESIGN_SYSTEM.md` + tokens de `frontend/src/index.css`; atualizar o documento junto com a mudança.
- **Não modificar:** cálculos de entradas/reentradas, classificados, Chip Count, stack médio, fichários, fichas KO, movimentações, Chip Race/Color Up, relógios independentes, histórico, Livro Razão, Auditoria, permissões existentes.
- Sem novas dependências, sem refatorações amplas, sem alterar rotas funcionais só para reorganizar o menu.

## A.1 Menu lateral reorganizado (em grupos, com títulos discretos)

| Grupo | Itens (nesta ordem) |
|---|---|
| **Visão geral e planejamento** | Dashboard · Eventos · Torneios · **Tracking Sheet** (novo) |
| **Operação** | Salão · Chip Race / Color Up · Ocorrências · Chat |
| **Estoque e configurações** | Fichas · Fichas KO · Fichários · Stacks |
| **Gestão e controle** | Relatórios · Livro Razão · Auditoria · Usuários |

Requisitos: manter ícones; destacar página ativa; títulos de grupo discretos (sem excesso de cor); espaçamento/tipografia consistentes; responsivo (desktop, tablet, celular); sem animações ou componentes novos desnecessários; grupos vazios não aparecem.

## A.2 Menus por perfil
Mesma estrutura e ordem para todos, exibindo só módulos autorizados: Admin (nível 1) tudo; Material (nível 2) e Salão (nível 3) só o que já podem acessar. **Nenhuma permissão nova.** A validação continua no backend (já existente), não só ocultação na UI.

## A.3 Tracking Sheet (estruturas de blinds)
Cadastrar, editar, consultar e reutilizar estruturas contendo: nome, nº do nível, duração, SB, BB, ante, Breaks e Dinner Breaks (com duração própria, **sem incrementar** o nº do nível). Adicionar/editar/excluir níveis antes do uso. **Sem geração automática por fórmula/porcentagem** — tudo editável.

Integração com torneios:
- Na criação/edição do torneio, escolher uma estrutura cadastrada → **copiar** para o torneio (editar a cópia não altera o template nem outros torneios).
- Preservar o editor de blinds da Logística; reutilizar seus componentes.
- Cada sessão classificatória mantém relógio independente; **níveis não se somam entre classificatórias**.
- Fases posteriores (Dia 2, Dia 3, Dia Final) começam **direto no nível inicial configurado**, com SB/BB/ante e duração configurados, sem avanço manual (ex.: classificatórios 1A–1D rodam níveis 1–16; Dia Final inicia no Nível 17; valores podem repetir ou ser editados pela direção sem alterar a numeração).

## A.4 Correção urgente — botão "Adicionar Nível"
- Novo nível = última numeração + 1; SB/BB/ante pré-preenchidos com os valores do **último nível configurado** (editáveis). Nunca volta aos valores do Nível 1.
- Breaks/Dinner Breaks não incrementam a numeração.
- Editar valores durante a operação sem mudar a numeração oficial; preservar registros de níveis já executados.

## A.5 Critérios de aceite
1. Menu nos quatro grupos. 2. Cada perfil vê só o autorizado. 3. Navegação ok em desktop/tablet/celular. 4. Estrutura pode ser cadastrada e salva. 5. Reutilizável em vários torneios. 6. Alterar a cópia não altera o template. 7. Ao iniciar uma fase posterior, o relógio abre no nível correto com os valores configurados. 8. "Adicionar Nível" nunca reinicia no Nível 1. 9. Funcionalidades anteriores intactas.

---

# PARTE B — PLANO DE EXECUÇÃO

## B.0 Diagnóstico (estado atual do código)
- **Menu:** `frontend/src/components/Sidebar.jsx` — lista plana `NAV_ITEMS` (l.12-28), filtro `can(role, area)` (config.js), drawer mobile + barra inferior (`BOTTOM_PRIORITY`). Rótulos em `locales/pt.js` e `en.js`.
- **Permissões:** matriz `PERMISSIONS` duplicada em `frontend/src/config.js` e `backend/middlewares/authMiddleware.js` (teste `permissions.test.js` compara as duas).
- **Templates de blinds já existem:** modelo `BlindStructureTemplate` (`rows[]`, mesmo shape do torneio), rotas `GET/POST/PUT/DELETE /blind-templates` (`torneios` view/manage) e `BlindTemplatesModal` em `Torneios.jsx`. **A Tracking Sheet é basicamente uma página dedicada sobre esse modelo** — sem modelo novo.
- **Editor da Logística:** `Torneios.jsx` (`addBlindLevel`, `addBreakRow`, `handleUpdateBlind`, save com debounce 600 ms + `blind_version`). Fase: `PhaseBlindsEditor.jsx` + `PUT /tournaments/:tid/sessions/:sid/level`.
- **Nível inicial de fase:** `prepareFinalLevels` em `backend/lib/sessions.js:85-100` calcula `level_offset` a partir das classificatórias encerradas e reescreve a estrutura da fase a cada mudança de status enquanto `blinds_edited` for falso.
- **Causas prováveis do bug de "Adicionar Nível" (hipóteses a confirmar com teste antes de corrigir):**
  1. `addBlindLevel` **dobra** SB/BB/ante e usa o padrão 50/100 se a estrutura local estiver vazia/desatualizada (deve copiar o último, sem dobrar).
  2. `prepareFinalLevels` zera/reconstrói a estrutura da fase (`level_offset=0`, `[]`) quando não há classificatória encerrada, descartando níveis adicionados.
  3. Corrida entre `debouncedSave` (closure com `blind_version` antigo) e o PUT imediato → 409 → recarrega estado antigo.
  4. Logística edita `Tournament.blind_structure`, mas a fase usa `TournamentSession.blind_structure` (prioritária no clock) — o admin edita um e o relógio lê o outro.
  5. `current_level` é índice de linha e não é reajustado quando a estrutura muda.

## B.1 Fase 1 — Menu em grupos (frontend apenas)
1. Em `Sidebar.jsx`, trocar `NAV_ITEMS` por `NAV_GROUPS = [{ key, items: [...] }]` na ordem de A.1, mantendo `to/icon/area`.
   - Novos itens de rótulo: **Fichas** (hoje `estoque`), **Livro Razão** (`livro-estoque`), **Stacks** (`modelos-stack`), **Chip Race / Color Up**. Ajustar só os textos i18n, não as rotas.
2. Renderizar grupo = título (`text-xs`/12 px, `text-fg-muted`, uppercase discreto) + itens existentes; divisória `border-line` entre grupos; filtrar itens por `can()` e **omitir grupos sem itens**.
3. Item ativo: usar o estilo ativo atual (verificar contraste com tokens, sem hex).
4. Mesmo array alimenta desktop e drawer mobile. Barra inferior: manter `BOTTOM_PRIORITY` (4 itens + "Menu"); drawer rola verticalmente em telas baixas.
5. i18n: chaves `nav.group.*` e `nav.tracking` em `pt.js` e `en.js`.
6. Atualizar `DESIGN_SYSTEM.md` (padrão de título de grupo do menu).
7. Teste: novo `Sidebar.test.jsx` (vitest) — admin vê 4 grupos; material/salão não veem grupos vazios nem itens sem permissão.

## B.2 Fase 2 — Página Tracking Sheet
**Permissão (decisão):** reutilizar a área `torneios` — `GET /blind-templates` já é `view` e escrita `manage` (só admin). Resultado: admin edita; material/salão (que já têm `torneios` view/operate) apenas consultam — sem criar área nem conceder acesso novo. Se a direção quiser ocultar do Salão/Material, é decisão explícita em `PERMISSIONS` nos dois lados + `permissions.test.js`.

Passos:
1. Rota `/tracking-sheet`: entrada em `ROUTE_AREA` (`torneios`), `<Route>` com `RequireArea` em `App.jsx`, item no grupo 1 do menu.
2. Página `frontend/src/pages/TrackingSheet.jsx`: lista de estruturas (nome, nº de níveis, duração total) + criar/duplicar/excluir; abre o editor.
3. **Extrair o editor de linhas** de `Torneios.jsx` (tabela de níveis, `addBreakRow`, remover, edição inline, numeração calculada que ignora breaks) para um componente `BlindRowsEditor` e usá-lo em **dois** lugares: Logística (comportamento idêntico) e Tracking Sheet. Extração mecânica, sem mudar lógica; a numeração/contagem fica numa função pura testada.
4. Breaks/Dinner Break: `row_type:'break'` com duração própria (presets 15/45/60/90 já existentes; rótulo "Dinner Break" via `label`). Não incrementam nível.
5. Salvamento explícito (botão Salvar) na página de template — evita a corrida do debounce; `POST/PUT /blind-templates`. Sem fórmulas/geradores.
6. Backend: nenhum modelo novo. Verificar que o schema aceita `name` único opcional e validar linhas (nº de níveis ≥ 1, duração > 0, SB ≤ BB opcional como aviso, não bloqueio).

## B.3 Fase 3 — Uso em torneios (cópia, não referência)
1. Na criação/edição do torneio, seletor "Estrutura de blinds" (reaproveitar `BlindTemplatesModal`, que já lista templates). Ao escolher, **copiar `rows` por valor** (`structuredClone`) para `Tournament.blind_structure` — não guardar referência.
2. Guardar apenas metadado opcional `blind_template_origin` (id + nome, informativo) se útil; nunca ler o template depois da cópia.
3. Teste backend: aplicar template a dois torneios, editar um → template e o outro permanecem iguais.

## B.4 Fase 4 — Continuidade de blinds entre fases (correção urgente)
Primeiro **reproduzir com teste** (estender `simulacao-3-0.test.js`): 4 classificatórias 1A–1D níveis 1–16 + Dia Final.
1. **Nível inicial por fase:** garantir que, ao iniciar Dia 2/3/Final, `current_level` aponte para a linha do nível `offset+1` (não 0 da lista antiga) e o payload do clock mostre `level_number = offset+1` com SB/BB/ante/duração configurados. Ajustar `prepareFinalLevels`/`clockView` para que a estrutura da fase = linhas do torneio **a partir do nível inicial configurado** (valores do template, não cópia do último nível jogado), preservando edição manual (`blinds_edited`).
2. **Faixa por sessão:** classificatórias usam níveis 1…N (N = último classificatório configurado); níveis nunca somados entre classificatórias (já é por sessão; cobrir com teste).
3. **Nunca recair no Nível 1:** em `prepareFinalLevels`, se não houver classificatória encerrada, **não** zerar a estrutura já editada nem `level_offset` configurado; só reconstruir enquanto a fase não foi iniciada nem editada.
4. **Adicionar Nível:** (a) Logística e `PhaseBlindsEditor`: novo nível = último `level` + 1 e SB/BB/ante/duração **iguais ao último nível** (remover o `×2`); sem níveis → padrão atual; (b) usar sempre a estrutura mais recente do servidor (não o closure); (c) cancelar/flush do `debouncedSave` pendente antes do PUT, e enviar `blind_version` atual.
5. **Edição de valores em operação:** editar SB/BB/ante não renumera; níveis já executados (índice < `current_level`) ficam somente leitura/preservados.
6. **Configurar nível inicial da fase:** campo "Nível inicial" no cadastro da fase (usa `level_offset` existente, editável pelo admin), com pré-visualização do SB/BB/ante desse nível. Sem avanço manual.
7. Testes: Dia Final abre no Nível 17 com valores corretos; adicionar nível em fase vazia/preenchida mantém continuidade; relógios 1A–1D independentes; `clock.test.js`/`sessions.test.js` seguem verdes.

## B.5 Fase 5 — Permissões e regressão
- Nenhuma rota ou permissão nova de backend além do já existente (`/blind-templates`). Conferir `permissions.test.js` e `security.test.js`; acrescentar teste: material/salão recebem 403 em `POST/PUT/DELETE /blind-templates`.
- Rodar: `cd backend && npm test`; `cd frontend && npm test && npm run build`.
- Revisão visual manual em 3 larguras (≥1280, ~768, ~375): menu, drawer, Tracking Sheet, Logística. Checar sem hex solto, sem `font-black`, sem texto < 12 px.
- Smoke manual: criar template → aplicar em 2 torneios → iniciar classificatórias → encerrar → iniciar Dia Final → conferir Nível 17 → adicionar nível → conferir Nível 18 com valores do 17.

## B.6 Ordem e entrega
| Ordem | Entrega | Risco |
|---|---|---|
| 1 | Menu agrupado (B.1) | Baixo, só frontend |
| 2 | Correção "Adicionar Nível" + continuidade (B.4) — **urgente** | Médio, toca `sessions.js`; coberto por testes |
| 3 | Extração do editor + página Tracking Sheet (B.2) | Médio, regressão na Logística |
| 4 | Seleção/cópia no torneio (B.3) | Baixo |
| 5 | Regressão e docs (B.5) | — |

Sugestão: um commit por fase, branch `feat/menu-tracking-sheet`. Como a correção B.4 é urgente, pode ser entregue antes do menu.

## B.7 Pontos a confirmar com a direção
1. Material e Salão devem **ver** a Tracking Sheet (somente leitura) ou ela fica só para o Admin? (Padrão proposto: leitura, pois já têm `torneios` view.)
2. "Estruturas de Blinds" (adendo) e "Tracking Sheet" são tratadas como **a mesma aba**, com o nome "Tracking Sheet".
3. Nível inicial do Dia Final: usar os valores da linha do nível 17 da estrutura do torneio (proposto) ou continuar copiando o último nível jogado das classificatórias?
