# GENESIS — Sistema de Gestão de Torneios e Inventário

O **GENESIS** é uma plataforma para gestão de torneios de poker, controle de estoque de
fichas, fichários (maletas), cálculo de chip race / color up, chat interno em tempo real e
auditoria de operações.

---

## 🚀 Funcionalidades

| Módulo | Descrição |
| --- | --- |
| **Dashboard** | Métricas em tempo real: torneios ativos, fichas em estoque, fichários livres, chip races do dia + feed de auditoria. |
| **Eventos e Sessões** | **Evento → Torneio → Sessões/fases**: um torneio (ex.: *#02 Warm Up*) tem várias sessões (Dia 1A, 1B, 1C, Dia Final) e continua sendo **um só**. Entradas e mesas são por sessão; fichários e modelos de stack são do torneio. O torneio só fecha com todas as sessões encerradas. |
| **Torneios** | Criação, estrutura de blinds, **relógio server-side + tela de projeção**, alocação de fichários, tracking de fichas, entradas (buy-in / re-entry / add-on). |
| **Financeiro do torneio** | Buy-in, rake fixo, bounty, add-on → prize pool calculado. Templates de premiação em % com faixas por nº de inscritos. Eliminações **por entrada** ("Entrada #n") → classificação final com prêmio. |
| **Estoque** | Saldos **por fichário × ficha, derivados das movimentações** (montagem, saída, perda, ajuste, estorno). O saldo nunca fica negativo. |
| **Livro-razão de fichas** | `Movement`: imutável, com origem → destino, fichário, motivo e usuário (`/livro-estoque`). Erro se corrige por **estorno**, nunca por edição/exclusão. É a fonte da verdade dos saldos. |
| **Alocação de fichas** | **Parcial**, por denominação e quantidade: o mesmo fichário atende 2 torneios (ex.: ≥ 5.000 no A, ≤ 1.000 no B) se a soma alocada de cada ficha não passar do saldo físico. A regra `quantidade ≤ livre` é do servidor (409 com o excesso e quem está segurando). A reserva vale **desde que aloca**, não só quando o torneio inicia. |
| **Fichários** | Kits de fichas; alocação **por torneio** (veja acima). Conferência física compara o contado com o esperado (derivado): falta vira perda, sobra vira `FOUND` e cada diferença abre uma **ocorrência** com semáforo — nada é sobrescrito. |
| **Fichas → Modelos de Fichário → Fichários** | Ficha é cadastro mestre (sem quantidade); o **Modelo de Fichário** define quanto de cada ficha compõe um fichário; o **Fichário físico** é a unidade real, criada a partir de um modelo. Cadastros só do admin. |
| **Modelos de Stack** | Grade **ficha × ação** (buy-in padrão, opcional, reentrada, add-on…): quantas fichas UMA entrada recebe em cada ação. Informe só a **quantidade de ações**; o servidor calcula as fichas por denominação (e o valor). |
| **Material no torneio** | **Envio** (fichário → em jogo, por ação: o stack calcula as fichas; só do que está alocado), **retorno** (em jogo → fichário) e o resumo *esperado × enviado × em jogo × pendente*. Tudo é movimentação imutável. |
| **Chip Race / Color Up** | Lançamento por denominação do que **saiu** e do que **entrou** de jogo; o servidor calcula valor retirado, valor colocado e a **quebra matemática** (legítima — nunca vira perda física). Movimenta as fichas num lote e só se corrige por **estorno**. |
| **Descarte de stack** | Um stack é abandonado: as fichas informadas (não precisam ser a composição original) saem do **jogo** e voltam ao fichário na hora; reduz o esperado em jogo. Valor total calculado no servidor; imutável (só estorno, admin); atualiza o painel em tempo real por socket. |
| **Ocorrências e semáforo** | Divergência física (falta/sobra) vira **ocorrência**: verde/amarelo/vermelho pela faixa do valor nominal (configurável), justificativa, recuperação parcial ou total e histórico completo — nunca é apagada. Ocorrência vermelha dispara alerta urgente para todos. A quebra matemática do Chip Race **não** gera ocorrência. |
| **Dashboard e relatórios** | Respondem "onde estão as fichas / o que acontece agora" **só pelos movimentos** (nenhum cache legado): estoque por denominação, matriz fichário × denominação, em jogo por torneio/sessão, fluxos, ocorrências por semáforo, conflitos de alocação e linha do tempo. O painel atualiza **por bloco** em tempo real (`movementsPosted`, `occurrenceOpened`…). Relatórios e comparativo trazem descartes, perdas, recuperações e a quebra do chip race; CSV de logs e de fichas. |
| **Chat** | Chat por **evento** (o usuário escolhe o evento) com os canais `geral`, `material`, `salao` dentro de cada um, via WebSocket + alertas urgentes globais. |
| **Relatórios / Auditoria** | Gráficos (Recharts) e log paginado de todas as ações do sistema. |
| **Usuários** | CRUD de membros e papéis (somente admin). |
| **PWA** | Instalável em Android/iOS; tema claro/escuro. |

---

## 🛠️ Stack

**Frontend:** React 19 · Vite · Tailwind CSS v4 · Framer Motion · Lucide React · Recharts · socket.io-client · React Router 7

**Backend:** Node.js 22 · Express 4 · Mongoose 9 (MongoDB 6) · Socket.io 4 · JWT (`jsonwebtoken`) · `bcryptjs`

---

## 📦 Como rodar

### Docker (recomendado)

```bash
git clone https://github.com/joojvitkk/genesis.git
cd genesis
docker compose up --build
```

- Frontend: <http://localhost:5173>
- Backend/API: <http://localhost:3000/api>
- MongoDB: `localhost:27017`

### Local (sem Docker)

Pré-requisitos: Node.js 22+ e um MongoDB **replica set** (as movimentações de estoque usam transações;
o `docker-compose.yml` já sobe assim). Contra o Mongo do compose, use `directConnection=true` na
`MONGO_URI` (veja `backend/.env.example`). Em MongoDB *standalone* o backend funciona, mas as
movimentações caem num mutex em memória (seguro só com 1 processo) e ele avisa no boot — **não use em produção**.

```bash
# backend
cd backend
npm install
cp .env.example .env      # ajuste MONGO_URI e JWT_SECRET
npm run migrate           # aplica migrações pendentes
npm start                 # http://localhost:3000

# frontend (em outro terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

### Produção (Docker)

`docker-compose.prod.yml` builda imagens otimizadas: frontend estático servido por
**Nginx** (que faz proxy de `/api` e `/socket.io` para o backend), backend com
`NODE_ENV=production`, `restart: unless-stopped` e healthcheck, MongoDB sem porta exposta.

```bash
cp .env.prod.example .env         # defina JWT_SECRET (obrigatório), CORS_ORIGIN, WEB_PORT
docker compose -f docker-compose.prod.yml up -d --build
# aplica migrações uma vez após o primeiro deploy:
docker compose -f docker-compose.prod.yml exec genesis-backend npm run migrate
```

App em `http://localhost:${WEB_PORT:-8080}`.

### Testes e qualidade

```bash
# backend  (precisa de um MongoDB para o banco de teste)
cd backend && MONGO_URI_TEST=mongodb://127.0.0.1:27017/genesis_test npm test

# frontend
cd frontend && npm run lint && npm test && npm run build
```

`.github/workflows/ci.yml` roda os dois em cada PR (backend com serviço MongoDB).

### Migrações e backup

| Comando | O quê |
| --- | --- |
| `npm run migrate` (em `backend/`) | Aplica migrações pendentes (`migrate-mongo`). |
| `npm run migrate:status` | Lista o estado das migrações. |
| `./scripts/backup.sh [dir]` | `mongodump` comprimido + retenção de 14 dias. Ideal em cron. |
| `./scripts/restore.sh arquivo.archive.gz` | Restaura um backup (`--drop`, pede confirmação). |
| `node scripts/audit-legacy-chips.js [--uri …] [--json f] [--strict]` | Auditoria **somente-leitura** do estoque legado (fichas duplicadas, dupla contabilização, reservas órfãs). Ver `ROADMAP_NUCLEO_FICHAS.md` (G0). |

---

## 🔑 Variáveis de ambiente (backend)

| Variável | Padrão (fallback no código) | Observação |
| --- | --- | --- |
| `MONGO_URI` | `mongodb://localhost:27017/genesis` | String de conexão do MongoDB. |
| `JWT_SECRET` | `secret_genesis_key` | **Defina em produção.** Assina/valida tokens REST **e** o handshake do WebSocket. |
| `PORT` | `3000` | Porta do servidor HTTP/WebSocket. |
| `CORS_ORIGIN` | `*` | Origem permitida para REST e Socket.io. Defina o domínio do frontend em produção. |
| `ADMIN_EMAIL` | `administrador@admin.com.br` | E-mail do admin criado pelo seeder. |
| `ADMIN_PASSWORD` | `admin123` | Senha inicial do admin criado pelo seeder. |
| `NODE_ENV` | — | `production` desliga logs verbosos. |

O `.env` agora é carregado por `dotenv` no topo de `server.js` (antes era ignorado).

O `docker-compose.yml` já injeta `MONGO_URI` e `JWT_SECRET` para os containers.

Frontend: `VITE_BACKEND_URL` (opcional). Se ausente, o app usa
`http://<hostname-atual>:3000` — útil para acesso via IP na rede local.

---

## 🛡️ Credenciais de acesso inicial

- **Email:** `administrador@admin.com.br`
- **Senha:** `admin123`

O usuário admin é criado automaticamente pelo seeder em `backend/server.js` na primeira
conexão com o banco, se ainda não existir. **Troque a senha após o primeiro acesso.**

---

## 👥 Papéis e permissões

Matriz **ÁREA × NÍVEL** (`view` < `operate` < `manage`), definida em **dois lugares em sincronia**:
`backend/middlewares/authMiddleware.js` (`PERMISSIONS`) e `frontend/src/config.js` (`PERMISSIONS`) — o teste
`backend/test/permissions.test.js` **compara os dois**. Menu, rotas, botões e API usam a mesma fonte.

| Área | admin | material | salao |
| --- | :-: | :-: | :-: |
| dashboard | manage | view | view |
| estoque (fichas, movimentos, ocorrências) | manage | **operate** | view |
| ficharios (modelos e fichários) | manage | **operate** | — |
| torneios (estrutura + material: envio, retorno, descarte, conferência) | manage | **operate** | view |
| mesas (entradas, eliminações, mesas, relógio) | manage | operate | **operate** |
| chip_race | manage | **operate** | view |
| modelos_stack | manage | view | view |
| relatorios (inclui histórico de saldo) | manage | view | — |
| chat | manage | operate | operate |
| usuarios | manage | — | — |

- **view** consulta · **operate** lança/confere/justifica/registra · **manage** cadastra, estorna, exclui, configura.
- **Material não cria** ficha, modelo, fichário, stack, evento, torneio, sessão, template nem usuário (403). Perda e conferência são operação;
  montagem, saída, ajuste, estorno e encerramento de ocorrência são administrativos.
- **Salão** (D3): só consulta o estoque e o torneio; opera **mesas** (entradas, eliminações, relógio) e o chat. Alterar a **estrutura** do torneio
  (nome, financeiro, stack, blinds) é `manage`; `status`, `actual_players`, `estimated_players` e `notes` são operacionais.
- **Escopo por torneio:** `User.allowed_tournament_ids` (vazio = todos; admin ignora). Quem tem a lista só enxerga/opera esses torneios
  em `/tournaments/:tid/**`, na listagem, em `POST /conversions` e no histórico de saldo — a mudança vale **imediatamente**.
- Nenhuma rota `DELETE` de movimentação existe; entradas e eliminações **não são apagadas** (cancelam-se com motivo).

---

## 🔌 Endpoints da API

Base: `/api`. Todas as rotas (exceto `POST /login`) exigem header
`Authorization: Bearer <token>`.

### Auth
| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/login` | Autentica por `{ email, password }`, retorna `{ token, user }` (com `must_change_password`). Rate-limited. |
| GET | `/me` | Dados do usuário do token — revalida a sessão. |
| POST | `/me/password` | `{ current_password, new_password }` — troca a senha, revoga as outras sessões, retorna novo token. |
| POST | `/me/logout-all` | Encerra todas as sessões do próprio usuário. |
| POST | `/users/:id/reset-password` | *admin* — gera senha temporária (mostrada 1×), força troca no próximo login. |
| POST | `/users/:id/revoke-sessions` | *admin* — encerra as sessões de um usuário. |

### Usuários — *admin*
| Método | Rota |
| --- | --- |
| GET | `/users` |
| POST | `/users` |
| PUT | `/users/:id` |
| DELETE | `/users/:id` |

### Fichas (cadastro mestre) — *estoque* · escrita: *admin*
A ficha só tem **valor NOMINAL, cor e ativa** — **jamais valor monetário**, **sem tipo** (não existe ficha KO) e sem nome de
modelo e sem quantidade (`name`, `kind` e qualquer campo de quantidade/valor monetário → 400). Valor + cor são
únicos entre as fichas ativas (409) e ficam fixos depois que a ficha é usada. Na tela de fichas a **cor é escolhida numa paleta
no estilo Excel** (cores × tons + cores padrão) ou pelo botão **Personalizar cor** — ninguém digita hexadecimal.

| Método | Rota |
| --- | --- |
| GET | `/chips` — `?active=true\|false` |
| POST | `/chips` — `{ value, color }` *(admin)* — `monetary_value` (ou qualquer campo de valor monetário/quantidade) → 400 |
| PUT | `/chips/:id` — inclui `{ active: false }` para descontinuar *(admin)* |
| DELETE | `/chips/:id` — **405**: fichas não são excluídas, são desativadas |

### Movimentações e saldos — *estoque*
Fonte da verdade do estoque. **Não existe `PUT`/`DELETE`**: erro se corrige por estorno + novo lançamento.
Saldo de uma localização = Σ entradas − Σ saídas (nunca gravado como número). Origem/destino:
`external` (fora do sistema), `binder` (dentro de um fichário) e `lost` (divergência do fichário).

| Método | Rota |
| --- | --- |
| POST | `/movements` — `{ type, binder_id, chip_id, quantity }` ou `{ …, items: [{ chip_id, quantity }] }` (lote, tudo-ou-nada). Tipos: `ASSEMBLY` (entrada/montagem), `WITHDRAWAL` (saída), `ADJUSTMENT` (`direction: in\|out`) — só **admin**; `LOSS` (quebra/perda) — admin e material. `reason` **obrigatório** em todos (a montagem também). Saldo insuficiente → **409** com o saldo real. |
| POST | `/movements/:id/reverse` — `{ reason, whole_batch? }` *(admin)*: grava o movimento inverso (`REVERSAL`) vinculado ao original, que permanece intacto. Estornar duas vezes → 409; estorno não é estornável. |
| GET | `/movements` — filtros `binder_id`, `chip_id`, `type`, `user_id`, `batch_id`, `from`, `to`, `tournament_id`, `session_id`; cada linha traz `reversed_by` quando foi estornada |
| GET | `/balances` — saldos derivados por fichário × ficha (`binder_id`, `chip_id`, `kind=lost` para divergências) + totais |
| GET | `/audit/history` — `?binder_id=`, `?chip_id=` ou `?tournament_id=` (`binder_id` + `chip_id` filtra a ficha): cada movimento com o **efeito no saldo** e o saldo depois (`effects[]`), `reversed_by`, `balances` finais e paginação — reconstruído dos movimentos *(relatorios)* |
| GET | `/inventory/logs` — *relatorios* (paginado, `search`, `type`) |

### Modelos de Fichário — *ficharios* · escrita: *admin*
Composição padrão `[{ chip_id, quantity }]` (fichas já cadastradas, sem repetir, quantidade inteira ≥ 1).
A mesma ficha pode estar em vários modelos com quantidades diferentes. Editar um modelo **não** altera
fichários já criados.

| Método | Rota |
| --- | --- |
| GET | `/binder-models` |
| POST | `/binder-models` — `{ name, composition, notes? }` |
| PUT | `/binder-models/:id` |
| DELETE | `/binder-models/:id` — 409 se houver fichários usando o modelo |

### Fichários físicos — *ficharios* · escrita: *admin*
Unidade real, criada opcionalmente a partir de um modelo (`model_id`). O fichário **nasce vazio** e o
conteúdo é **derivado das movimentações** (`chips` no corpo → 400); o estoque físico entra por montagem.
O conteúdo (`chips`), as `allocations` e a situação (`allocated`/`available`) vêm **derivados na leitura** (movimentos + alocações abertas); nada disso é gravado no fichário.

| Método | Rota |
| --- | --- |
| GET | `/binders` |
| POST | `/binders` — `{ name, code?, model_id? }` |
| PUT | `/binders/:id` |
| DELETE | `/binders/:id` — 409 se ainda houver fichas dentro |
| POST | `/binders/:id/assemble` — `{ from_model: true }` ou `{ items: [{ chip_id, quantity }] }` *(admin)*: lança `ASSEMBLY` |
| POST | `/binders/:id/count` — `{ counts: [{ chip_id, counted }], reason? }` — conferência *(material também)*: compara com o saldo derivado; falta → `LOSS` (fichário → divergência), sobra → `FOUND`; cada diferença abre uma **ocorrência** (`occurrences[]` na resposta); `reason` só é obrigatório a partir do nível configurado do semáforo (padrão: vermelho) |

### Eventos e sessões — *torneios* · criar/editar/excluir: *admin*
Evento → Torneio (`event_id`, `number` único dentro do evento) → Sessões. `POST /tournaments` aceita `sessions: ['Dia 1A', …]`
(só admin; sem isso nasce **"Dia Único"**). Sessão: `scheduled → running → finished`; operadores mudam o status, só o admin
reabre uma encerrada. Excluir sessão: 409 se tiver entradas ou for a última.

| Método | Rota |
| --- | --- |
| GET | `/events` (com nº de torneios) · `/events/:id` (torneios + sessões) |
| POST · PUT · DELETE | `/events[/:id]` — excluir só sem torneios |
| GET | `/tournaments/:id/sessions` — sessões com **contadores de ações** e valor das fichas em jogo de cada uma |
| POST | `/tournaments/:id/sessions` — `{ name, starts_at? }` *(admin)* |
| PUT | `/tournaments/:tid/sessions/:sid` — `{ status }` (operador) · `{ name, starts_at, notes }` (admin) |
| DELETE | `/tournaments/:tid/sessions/:sid` *(admin)* |
| GET | `/tournaments/:tid/sessions/:sid/chips-in-play` — fichas em jogo só daquela sessão (o do torneio é a soma) |

`PUT /tournaments/:id { status: 'finished' }` → **409** com a lista de sessões pendentes; envie `finish_sessions: true` para encerrá-las junto.
Financeiro, eliminações, relógio e blinds seguem no **torneio** (um único prize pool).

### Alocações de fichas — leitura: qualquer autenticado · escrita: *admin*
`livre(fichário, ficha) = saldo físico − Σ alocações abertas (planejadas + ativas) de todos os torneios`. Pedir mais que o livre → **409**
com `details` (`requested`, `balance`, `allocated_elsewhere`, `free`, `excess`, `held_by`); nada é gravado. A checagem roda sob os
mesmos bloqueios das movimentações (alocar e retirar ao mesmo tempo não estoura o saldo). **Retiradas** (`WITHDRAWAL`, `ADJUSTMENT`
saída, estorno) não podem levar o fichário abaixo do alocado; uma **perda** apurada na conferência não é barrada e vira *falta*
(`shortfall`) na alocação. Alocações não são apagadas: liberar = `status: released` (histórico).

| Método | Rota |
| --- | --- |
| POST | `/tournaments/:id/allocations` — `{ binder_id, mode, note? }` com `mode`: `binder` (fichário inteiro) · `denominations` (`chip_ids` **ou** `min_value`/`max_value`) · `quantities` (`chips: [{ chip_id, quantity }]`). Uma alocação aberta por (torneio, fichário). |
| PUT | `/allocations/:id` — `{ chips: [{ chip_id, quantity }] }` substitui a lista (a própria alocação não conta contra si) |
| DELETE | `/allocations/:id` — **libera** (histórico) e devolve a capacidade |
| GET | `/allocations` — `?tournament_id=`, `?binder_id=`, `?status=`, `?open=false\|all` (padrão: só abertas); traz saldo e `shortfall` por ficha |
| GET | `/allocations/matrix?binder_id=` — por ficha: saldo, alocado a cada torneio e **livre** (negativo = falta) — *ficharios* |

Não existe campo de alocação gravado no torneio nem no fichário: o estado vem das alocações abertas (`GET /binders`, `GET /inventory/by-chip`).

### Torneios — *torneios* (GET liberado a qualquer autenticado)
| Método | Rota |
| --- | --- |
| GET | `/tournaments` · `/tournaments/:id` |
| POST | `/tournaments` |
| PUT | `/tournaments/:id` |
| DELETE | `/tournaments/:id` |
| GET | `/tournaments/:id/entries` |
| GET | `/tournaments/:id/chips-in-play` — fichas em jogo **calculadas no servidor**: `counts` por ação, `rows` por denominação (`quantity`, `value`, `by_action`), `totals`, `uncovered` (ações sem composição). `/consolidated-chips` = formato antigo do mesmo cálculo |
| POST | `/tournaments/:id/needs` — `{ counts: { buy_in: 100, re_entry: 10 } }` → necessidade de fichas (simulação; não grava nada) |
| POST | `/tournaments/:id/entries` — `{ type: buy-in\|re-entry\|add-on, action?, quantity?, session_id? }`. Cada entrada recebe um **número** ("Entrada #n"; não há cadastro de jogadores). O **stack é derivado da ação** (buy-in→`buy_in`, re-entry→`re_entry`, add-on→`add_on`; um buy-in pode ser `optional_buy_in` ou outra coluna do modelo). `quantity` 2–500 registra várias ações de uma vez (sem jogador). `stack_model_id` é ignorado |
| POST | `/tournaments/:tid/entries/:eid/cancel` — `{ reason }` *(mesas)*: **cancela** a entrada (fica registrada com quem/quando/por quê e sai dos cálculos). `DELETE` → 405 |
| POST | `/tournaments/:id/clock` — `{ action, seconds? }` — relógio: `start` · `pause` · `resume` · `stop` · `next` · `prev` · `goto` · `adjust` |
| GET | `/tournaments/:id/finance` — resumo financeiro + tabela de premiação + entradas restantes (`entries_in_play`) |
| GET | `/tournaments/:id/results` — classificação final (colocação, entrada, prêmio) |
| POST | `/tournaments/:id/eliminations` — `{ entry_id }` — elimina uma **entrada**; auto-finaliza quando sobra 1 |
| POST | `/tournaments/:tid/eliminations/:eid/cancel` — `{ reason }`: cancela a eliminação (a entrada volta ao jogo). `DELETE` → 405 |
| GET | `/tournaments/:id/seating` — mapa de mesas + sugestão de balanceamento **da sessão** (`?session_id=`) |
| POST | `/tournaments/:id/seating/draw` · `/move` · `/break-table` · `/redraw` — `session_id` no corpo (cada sessão tem as suas mesas) |

**Qual sessão?** Sem `session_id`: torneio com 1 sessão → ela; com várias → a única em andamento; ambíguo → **400** (informe `session_id`). Torneios anteriores ao G4 sem sessões seguem funcionando (sessão nula). Sessão **encerrada** não recebe entradas.
| GET · POST · PUT · DELETE | `/blind-templates[/:id]` — estruturas de blind reutilizáveis |
| GET | `/reports/comparison` — métricas lado a lado dos torneios (*relatorios*) |
| GET | `/chat/urgent` · POST `/chat/:id/ack` — alertas urgentes + confirmação de leitura |
| POST | `/chat/:id/react` `{kind}` (uma reação por usuário; repetir remove) · POST `/chat/read` `{ids}` (marca visualização) · GET `/chat/:id/readers` (só remetente e admin) — reações e visualizações do chat; respostas via `reply_to` no `sendMessage` |

`PUT /tournaments/:id` aceita `blind_version` — se enviado e desatualizado, responde **409**
(trava otimista da estrutura de blinds).

### Premiação — *torneios*
> Não existe cadastro de jogadores: a identidade nas mesas e eliminações é a **entrada** ("Entrada #n").

| Método | Rota |
| --- | --- |
| GET · POST · PUT · DELETE | `/payout-templates[/:id]` — templates de % com faixas por nº de inscritos |

### Modelos de stack — *modelos_stack* · escrita: *admin*
Grade ficha × ação: `actions: [{ key, label }]` (padrão: `buy_in`, `optional_buy_in`, `re_entry`; extras como `add_on`
ou `vip` são configuráveis) e `composition: [{ chip_id, quantities: { [action]: inteiro ≥ 0 } }]`. O valor de cada
coluna é **derivado** (`totals`/`total_value`) — nunca digitado. O formato antigo `{ chip_id, quantity }` vira `buy_in`.

| Método | Rota |
| --- | --- |
| GET | `/stacks` |
| POST · PUT | `/stacks[/:id]` — editar recalcula os torneios que usam o modelo |
| DELETE | `/stacks/:id` — 409 se em uso por torneio/entrada; senão soft-delete |
| POST | `/stacks/:id/needs` — `{ counts: { buy_in: 100 } }` → `{ rows: [{ chip, quantity, value }], totals, uncovered }` |

O torneio guarda o modelo **padrão** (`stack_model_id`) e, opcionalmente, um modelo por ação (`stack_models: [{ action, stack_model_id }]`).
`starting_stack`, `chips_value_in_play` (usado pelo relógio/projeção) e o valor do stack são derivados; `starting_stack` e
`stack_composition` enviados pelo cliente são ignorados.

### Material no torneio — envio, retorno e resumo
`Movement` ganhou a localização **`play`** (em jogo; o id é o torneio) e os tipos `SEND_BUY_IN` · `SEND_OPTIONAL` · `SEND_REENTRY` ·
`SEND_ADDITIONAL` · `RETURN` · `CHIP_RACE_OUT/IN` · `COLOR_UP_OUT/IN`. Quem registra: **admin e material**; o salão consulta.

**A alocação é o teto do envio.** Reservado = alocado − enviado (o enviado é derivado dos movimentos): enviar consome a reserva do
torneio e o "livre" do fichário não muda. Enviar além do reservado (ou de fichário não alocado) → **409** com o que falta; a
edição da alocação não pode ficar abaixo do já enviado.

| Método | Rota |
| --- | --- |
| POST | `/tournaments/:id/sends` — `{ items: [{ action, count }] }` (o stack calcula as fichas por denominação) e/ou `{ chips: [{ chip_id, quantity }] }` (envio adicional); `session_id?`, `binder_id?`, `reason?`. Sai só dos fichários alocados ao torneio. |
| POST | `/tournaments/:id/returns` — `{ binder_id, chips: [{ chip_id, quantity }], session_id?, reason? }`; não passa do que está em jogo; vale também depois de o torneio encerrar |
| GET | `/tournaments/:id/material` — por ficha: `expected` (ações × stack ± conversões − descartes), `sent`, `returned`, `discarded`, `conversion_in/out`, `on_table`, `pending` (= esperado − em jogo); estornos abatem as colunas; `?session_id=` |

### Chip Race / Color Up — *chip_race* (`Conversion`)
O operador informa o que **saiu** (`outs`) e o que **entrou** (`ins`) de jogo, por denominação. O **servidor** calcula
`value_out`, `value_in` e `math_breakage = value_in − value_out`. A quebra matemática é uma diferença legítima da conversão e
**nunca cria perda/ocorrência** (spec §18.4); só a conferência física aponta divergência. As fichas saem/entram por um lote de
movimentos (`CHIP_RACE_*`/`COLOR_UP_*`), o que sai vai para `binder_id` (ou o único fichário alocado) e o que entra sai dos alocados.
Conversão e movimentos são **imutáveis** — `PUT`/`DELETE` → **405**; corrige-se por **estorno do lote**. Conversões alteram as fichas
em jogo (e o valor do relógio pela quebra); as estornadas e as do modelo antigo não contam.

| Método | Rota |
| --- | --- |
| POST | `/conversions/preview` — `{ outs, ins }` → valores e quebra (mesma conta do registro; não grava) |
| POST | `/conversions` — `{ tournament_id, type: CHIP_RACE\|COLOR_UP, outs, ins, binder_id?, session_id?, note? }` *(admin e material)* |
| GET | `/conversions` (`?tournament_id=`, `?status=`) · `/conversions/:id` |
| POST | `/conversions/:id/reverse` — `{ reason }` *(admin)*: estorna o lote; 409 se as fichas já foram movimentadas depois |
| PUT · DELETE | `/conversions/:id` — **405** (imutável) |

### Descarte de stack — *torneios* (G7)
O descarte move fichas do **jogo** para o fichário (`DISCARD`, `play → binder`), por denominação efetivamente devolvida, e **reduz o esperado
em jogo** (`chips-in-play`). Acima do que está em jogo → **409** (nada é gravado). Com um único fichário alocado ele é o destino; com vários
(ou nenhum) informe `binder_id`. Torneio com várias sessões exige `session_id`. Admin e material lançam; o salão só consulta.

| Método | Rota |
| --- | --- |
| POST | `/tournaments/:id/discards` (ou `/tournaments/:id/sessions/:sid/discards`) — `{ chips: [{ chip_id, quantity }], binder_id?, session_id?, note? }` → lote com `total_chips` e `total_value` (calculados no servidor) |
| POST | `/tournaments/:id/discards/preview` — mesma conta do registro, sem gravar |
| GET | `/tournaments/:id/discards` (`?session_id=`) — um item por lote, com total, fichas, fichário, usuário, horário e `reversed` |
| POST | `/tournaments/:id/discards/:batch/reverse` — `{ reason }` *(admin)*: restaura o em jogo; 409 se já estornado ou se as fichas já foram movimentadas |
| PUT · DELETE | `/tournaments/:id/discards/:batch` — **405** (imutável) |

Sockets emitidos: `materialChanged`, `balancesChanged`, `chipsInPlayChanged`, `discardRegistered`.

### Ocorrências, conferência e semáforo — *estoque* (G8)
Toda divergência física é uma **ocorrência** (`open → justified → partially_recovered → recovered`, ou `closed` / `voided`). A fonte da verdade
continua nos movimentos (`LOSS`, `FOUND`, `RECOVERY`); a ocorrência guarda a gestão (semáforo, justificativa, histórico) e **nunca é apagada**.
A severidade é fotografada na abertura (mudar a configuração não reescreve o passado). Perda em jogo vai para a divergência do **torneio**.

| Método | Rota |
| --- | --- |
| POST | `/tournaments/:id/count` — `{ counts: [{ chip_id, counted }], session_id?, reason? }` *(admin e material)*: conferência do **jogo** (contado × fichas em jogo); a resposta traz `value` com a quebra matemática das conversões só como explicação |
| GET | `/occurrences` (`?status=active\|all\|<status>`, `severity`, `kind`, `scope`, `binder_id`, `tournament_id`, `chip_id`) · `/occurrences/:id` · `/occurrences/summary` |
| POST | `/occurrences/:id/justify` — `{ justification }` *(admin e material)* |
| POST | `/occurrences/:id/recover` — `{ quantity, binder_id?, note? }` *(admin e material)*: `RECOVERY` divergência → fichário; perda de fichário volta ao mesmo fichário, perda em jogo exige `binder_id`; 409 acima do que falta |
| POST | `/occurrences/:id/recoveries/reverse` — `{ batch_id, reason }` *(admin)* |
| POST | `/occurrences/:id/close` — `{ justification }` *(admin)*: a perda restante fica registrada como definitiva |
| POST | `/occurrences/:id/reverse` — `{ reason }` *(admin)*: estorna a divergência (contagem errada); exige estornar antes as recuperações |
| PUT · DELETE | `/occurrences/:id` — **405** |
| GET · PUT · DELETE | `/settings/severity` — faixas por valor nominal, escalonamento por quantidade e nível mínimo da justificativa (PUT/DELETE só admin) |

Movimentos de uma ocorrência **não** se estornam pela rota de movimentos (409): corrija pela ocorrência. Perda lançada à mão (`POST /movements` `LOSS`)
também abre ocorrência. Sockets: `occurrenceOpened` (as vermelhas viram alerta urgente) e `occurrenceUpdated`.

**Tempo real (G10):** cada lote de movimentos gravado emite `movementsPosted { batch_id, types, chip_ids, binder_ids, tournament_ids }`; o Dashboard refaz só os blocos afetados (com debounce).

### Dashboard / Relatórios / Chat
| Método | Rota | Acesso |
| --- | --- | --- |
| GET | `/dashboard/stats` (`?blocks=`) — painel derivado dos **movimentos**; blocos: `metrics`, `recent`, `inventory` (por ficha + matriz fichário × denominação), `in_play` (torneio/sessão), `flows` (enviadas, devolvidas, descartadas, chip race/color up com a quebra, perdidas, recuperadas), `occurrences` (abertas por semáforo, recuperadas), `conflicts` (alocações sem saldo), `timeline`, `binders` | autenticado |
| GET | `/inventory/by-chip` — em fichários, reservado, livre, em jogo, em divergência por ficha (Estoque) | *estoque* |
| GET | `/reports/data` — estoque/valor/distribuição/descartes/perdas/recuperações pelo saldo derivado | *relatorios* |
| GET | `/chat/event/:eventId?channel=` | autenticado |

### WebSocket (Socket.io, porta 3000)
Handshake exige `auth.token` (mesmo JWT do REST) — conexões sem token são recusadas.

- **Chat**: `joinEvent` / `leaveEvent` / `sendMessage` (`{ event_id, message, image, is_urgent }`) → `newMessage`,
  `urgentNotification`, `onlineCount` / `getOnlineCount`
- **Relógio de torneio**: `joinTournament` / `leaveTournament` (entra na sala e recebe o
  estado atual) → `tournamentClock` (1×/s enquanto rodando), `tournamentLevelChanged`,
  `tournamentMarker` (fim do registro / do dia), `tournamentEnded`
- **Inventário**: `chipCasesAllocated` / `chipCasesReleased`, `chipRaceUpdated`,
  `tournamentTrackingUpdate`

### Tela de projeção
`GET /torneios/:id/telao` — rota do frontend fora da sidebar, para abrir na TV do salão
(relógio grande, blinds atual/próximo, entradas, stack médio, fichas em jogo).

---

## 📁 Estrutura

```
genesis/
├── backend/
│   ├── app.js                   # Express app (testável, sem listen)
│   ├── server.js                # bootstrap: Mongo + seeder + Socket.io + listen
│   ├── routes/index.js          # todas as rotas REST
│   ├── middlewares/authMiddleware.js
│   ├── lib/                     # logger (pino), paginação, plugin soft-delete
│   ├── services/activityLogger.js
│   ├── models/                  # schemas Mongoose
│   ├── migrations/              # migrate-mongo
│   └── test/                    # node:test + supertest
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # rotas + RequireArea + sessão
│   │   ├── config.js            # BACKEND_URL + PERMISSIONS
│   │   ├── lib/                 # api (fetch central), auth, socket
│   │   ├── components/          # Sidebar, CustomSelect
│   │   ├── contexts/AlertContext.jsx
│   │   ├── hooks/useModalDismiss.js
│   │   └── pages/               # uma página por módulo
│   ├── nginx.conf               # proxy /api + /socket.io (build de produção)
│   └── Dockerfile.prod          # build multi-stage → nginx
├── scripts/                     # backup.sh / restore.sh
├── .github/workflows/ci.yml
├── docker-compose.yml           # desenvolvimento
├── docker-compose.prod.yml      # produção
└── database-diagram.mmd / .png  # diagrama ER
```

### Notas de API

- **Soft-delete**: `DELETE` de torneio, ficha e fichário marca `deleted_at` — o registro
  some das listagens mas fica no banco. Apagar um torneio **preserva** entradas, eliminações e
  movimentos (só a disposição das mesas é limpa).
- **Paginação**: as listagens (`/tournaments`, `/chips`, `/binders`) devolvem
  um array por padrão (teto de 500) com headers `X-Total-Count` / `X-Total-Pages`. Com
  `?page=` / `?limit=` devolvem `{ data, pagination }`.

---

## 🧯 Troubleshooting

**"Usuário não encontrado" no login**
Use exatamente `administrador@admin.com.br`. Se o banco for novo, confira no log do backend
a mensagem `Default Admin user created successfully.`.

**Erro de índice duplicado (`username_1`) ao subir**
Banco vindo de uma versão antiga (schema tinha `username`). Rode as migrações:
```bash
cd backend && npm run migrate
```

**Frontend não fala com o backend via IP da rede**
Defina `VITE_BACKEND_URL=http://<ip-do-servidor>:3000` no ambiente do frontend.

**Notificações do PWA não aparecem**
Precisam de contexto HTTPS — use `ngrok`/`localtunnel` apontando para a porta 5173.

**Sessão expira**
O token JWT dura 12h. Ao expirar, a primeira chamada de API que receber 401 desloga
automaticamente e mostra um aviso — basta logar de novo.

---

## ✅ Correções aplicadas (revisão de set/2026)

**Segurança / backend**
- WebSocket agora exige JWT no handshake; `sender_name` / `sender_role` são derivados do
  token, não mais do cliente.
- Todos os endpoints de escrita usam whitelist de campos (fim do mass assignment) +
  validação básica de tipos.
- `POST /users` duplicado removido; senha mínima de 6 caracteres; não é possível
  excluir/rebaixar o único admin; e-mail normalizado (lowercase).
- `password` com `select: false` no schema — nunca mais vaza em `GET /users`.
- `/login` com rate limit (20 falhas / 10 min por IP+e-mail; acertos não contam) e
  mensagem de erro genérica.
- `inventory/update` bloqueia estoque negativo; busca em relatórios com regex escapada e
  `limit` limitado a 100.
- Novo `GET /me` para revalidação de sessão. Índices adicionados em `ActivityLog`,
  `ChatMessage`, `TournamentEntry`.

**Frontend**
- Cliente de API central (`src/lib/api.js`): injeta o token, faz `encode` de query params
  e **desloga automaticamente no 401**.
- `PERMISSIONS` unificado (`src/config.js`) usado por menu, rotas e guarda de rota
  (`RequireArea`).
- Socket conecta só após login, com token (`src/lib/socket.js`).
- Editor de blinds e composição de stack em `Torneios` com estado local + **debounce**
  (fim de 1 request por tecla).
- `CustomSelect` extraído para componente único; `Esc` fecha modais e o confirm.
- `csvExport` escapa aspas e previne injeção de fórmula; botão de exportar em Relatórios
  agora funciona.
- Páginas órfãs `Admin.jsx` e `LogEstoque.jsx` removidas.

## ✅ Fase P0 do roadmap — concluída

- `backend/app.js` separado do `server.js` (app testável).
- **Testes**: 16 no backend (`node:test` + supertest) cobrindo auth, permissões,
  whitelist, chip race, estoque negativo, soft-delete e paginação; 9 no frontend
  (`vitest`) para o cliente de API e a matriz de permissões.
- **CI** (`.github/workflows/ci.yml`): lint + testes + build nos dois em cada PR.
- **Build de produção**: `docker-compose.prod.yml` (Nginx + backend prod + healthchecks).
- **Soft-delete** em torneio/ficha/fichário + cascata (entradas removidas, chip races
  arquivadas).
- **Paginação** opt-in em todas as listagens, com teto rígido de 500.
- **Migrações** versionadas (`migrate-mongo`); `fix_user_indexes.js` virou a 1ª migração.
- **Log estruturado** (`pino`) substituindo `console.*`.
- **Backup**: `scripts/backup.sh` / `restore.sh`.

## ✅ Fase P1 — Relógio de torneio — concluída

- **Relógio no servidor** como fonte da verdade (`backend/lib/tournamentClock.js`,
  lógica pura + runner de 1 s em `server.js`): persiste `level_started_at` /
  `paused_at` / `clock_adjust_seconds`, sobrevive a restart.
- **Auto-avança** de nível ao esgotar o tempo; pula marcadores (`end_registration`),
  para no `end_day` / fim da estrutura; emite `tournamentLevelChanged` / `tournamentMarker`
  / `tournamentEnded`.
- **Controles** (`POST /tournaments/:id/clock`): start / pause / resume / stop / next /
  prev / goto / adjust ±s — papel `torneios`. `current_level` saiu da whitelist do
  `PUT /tournaments/:id` (só o relógio controla).
- **Frontend**: hook `useTournamentClock` (sincroniza pelo `server_time`), componente
  `TournamentClock` (painel com controles + variante projeção), aba Salão do torneio com
  o relógio + botão "Abrir telão", **bip WebAudio** na virada de nível e nos últimos 60 s.
- **Tela de projeção** `/torneios/:id/telao` — rota fora da sidebar, tela cheia.
- 13 testes de relógio (lógica pura + endpoint); verificado ponta a ponta contra socket real.

## ✅ Fase P2 — Premiação e resultados — concluída

> ⚠️ **Superado:** o cadastro de **jogadores** (`Player`, página `/jogadores`) foi removido — a identidade nas mesas e eliminações é a
> **entrada** ("Entrada #n") — e o **bounty por eliminador** deixou de existir. Migração `20261002000000-remove-players-and-chip-money`
> (dados arquivados em `archive_*`). O texto abaixo é só o histórico da fase.

- **`Player`** (coleção nova): cadastro completo + histórico. Página `/jogadores`,
  autocomplete `PlayerSelect` na inscrição (cadastra na hora).
- **`PayoutTemplate`**: distribuição de % com **faixas por nº de inscritos**; validação
  de soma 100%; editor visual (`PayoutTemplatesModal`).
- **`Tournament`** += `buy_in` / `rake` / `bounty_value` / `addon_value` / `addon_chips` /
  `payout_template_id`. `lib/tournamentFinance.js` (puro): contribuição por entrada
  (rake fixo, bounty separado, add-on sem rake), agregação e tabela de premiação
  (resto de arredondamento no 1º).
- **`Elimination`** (coleção nova): posição automática, bounty ao eliminador; quando
  sobra 1 jogador o torneio vira `finalized` e grava o prêmio de cada colocação.
- **Aba "Financeiro"** no torneio: configuração, resumo ao vivo (prize pool, bounty,
  rake, jogadores restantes), premiação calculada, painel de eliminações e resultado.
- +11 testes (finance puro + fluxo completo de eliminação); verificado ponta a ponta.

## ✅ Fase P3 — Livro-razão de inventário — concluída

> ⚠️ **Removido no G11** (`ROADMAP_NUCLEO_FICHAS.md`): o estoque físico é o `Movement` (por fichário, imutável, com estorno).
> O `InventoryLedger` v1, os caches de quantidade da ficha e do fichário e a rota `/cases` saíram do sistema; os dados antigos
> ficam nas coleções `archive_*` (migração `20261001000000-legacy-cleanup`). O texto abaixo é só o histórico da fase.

- **`InventoryLedger`** (coleção nova, append-only): `entrada` / `saida` / `quebra` /
  `contagem` / `ajuste` / `saldo_inicial` / `alocacao` / `retorno`. `quantity` com sinal.
- **`ChipModel.total_quantity` / `reserved_quantity` / `available_quantity` são cache
  derivado** — `lib/inventoryLedger.recalcChip` recalcula a partir do ledger após cada
  lançamento; não se edita mais direto.
- Alocar um fichário a um torneio em andamento gera `alocacao` (reserva); finalizar/excluir
  gera `retorno` **do valor exato reservado** (imune a mudanças no conteúdo da maleta).
- (histórico P3; substituído no G2) Conferência física por maleta (`POST /cases/:id/count`): ajustava o conteúdo e lançava a
  diferença como `contagem`.
- Migração `20260911` semeia o ledger a partir do estado atual (preserva os números).
- Frontend: página `/livro-estoque`, coluna "Alocado" no estoque, ação Quebra/Perda,
  botão "Conferir" nos fichários.
- +9 testes; verificado ponta a ponta.

## ✅ Fase P4 — Mesas, seating e templates de blind — concluída

- **`Seat`** (coleção nova, um doc por lugar ocupado). `Tournament += seats_per_table` (9).
- **Sorteio digital**: buy-in / re-entry sorteiam mesa + lugar automaticamente
  (equilibrando ao sentar); eliminação libera o lugar; abre nova mesa quando as
  existentes lotam.
- `lib/seating.js` (puro): `pickSeatForNewPlayer`, `suggestBalance` (diferença de 2+ →
  move o próximo da mesa maior pra menor), `breakableTables` (quebra a menor quando cabe
  em uma mesa a menos), `redraw`.
- Endpoints `/seating/draw|move|break-table|redraw`. Quebra de mesa realoca nos lugares
  livres exatos das outras.
- **`BlindStructureTemplate`**: salvar a estrutura atual como template e aplicar em outro
  torneio (`BlindTemplatesModal`).
- Frontend: aba **"Mesas"** no torneio (grade de mesas, banner de balanceamento com
  "aplicar", quebrar mesa, redistribuir), campo "lugares por mesa" no cadastro.
- +10 testes; verificado ponta a ponta.

## ✅ Fase P5 — Segurança, observabilidade e PWA offline — concluída

- **Revogação de sessão**: token carrega `sv` (session_version); trocar senha, "encerrar
  todas as sessões" ou reset pelo admin incrementam `session_version` e invalidam os
  tokens antigos (cache de 30 s + limpeza imediata no bump).
- **Senha temporária**: admin gera senha aleatória (mostrada 1×); usuário criado por admin
  ou com senha resetada é obrigado a trocar no próximo login (tela de barreira).
- **`helmet`** (HSTS, noSniff, frameguard) + **rate limit geral** da API (300 req/min/IP,
  configurável) + limite de 10 mensagens/10 s por conexão de socket.
- **Auditoria com diff**: `ActivityLog.changes` grava `{ field, from, to }` (usuários).
- **Log estruturado** já vinha do P0 (`pino`); logs de request enxutos.
- Nginx: headers de segurança + HSTS.
- **PWA offline**: service worker com `NetworkFirst` na API GET (app abre offline);
  **fila offline** para registro de entradas e eliminações (`lib/offlineQueue`), que
  sincroniza no evento `online`.
- +4 testes; verificado ponta a ponta.

## ✅ Fase P6 — Incrementais — concluída

- **Valuation de estoque** (Σ valor × quantidade) no dashboard e nos relatórios.
- **Chat**: não lidas por canal, **anexo de imagem** (redimensionado no cliente para
  ~260 KB), **painel de alertas urgentes com confirmação de leitura** (quem confirmou).
- **Relatórios**: comparativo entre torneios (`GET /reports/comparison`), export
  **PDF via `window.print()`** + `@media print`, **predefinições de filtro** salvas.
- **Fuso horário**: `Tournament.timezone` + `starts_at` derivado (`date`+`start_time`@tz,
  respeita horário de verão, sem dependência); exibição no fuso correto.
- **Concorrência**: trava otimista de `blind_structure` (`blind_version` → 409 no
  conflito, recarrega).
- **Acessibilidade**: `:focus-visible` consistente, `prefers-reduced-motion`, `aria-modal`.
- **i18n**: scaffold pt/en (`lib/i18n`, `useT()`, seletor de idioma) — navegação e conta
  traduzidas; extração das demais telas é incremental.
- +8 testes; verificado ponta a ponta.

> **Roadmap P0–P6 completo.** Backlog residual (i18n das telas restantes, export PDF
> nativo com layout dedicado, anexos maiores via storage próprio) fica sob demanda.

Ver o [roadmap completo](https://claude.ai/code/artifact/c98c1207-a6ec-4634-8267-1c81b25c5ac5).

---

## 📄 Licença

Projeto acadêmico — sem licença definida.
