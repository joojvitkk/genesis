# GENESIS — Sistema de Gestão de Torneios e Inventário

O **GENESIS** é uma plataforma para gestão de torneios de poker, controle de estoque de
fichas, fichários (maletas), cálculo de chip race / color up, chat interno em tempo real e
auditoria de operações.

---

## 🚀 Funcionalidades

| Módulo | Descrição |
| --- | --- |
| **Dashboard** | Métricas em tempo real: torneios ativos, fichas em estoque, fichários livres, chip races do dia + feed de auditoria. |
| **Torneios** | Criação, estrutura de blinds, **relógio server-side + tela de projeção**, alocação de fichários, tracking de fichas, entradas (buy-in / re-entry / add-on). |
| **Financeiro do torneio** | Buy-in, rake fixo, bounty, add-on → prize pool calculado. Templates de premiação em % com faixas por nº de inscritos. Eliminações → classificação final com prêmio e bounty por jogador. |
| **Jogadores** | Cadastro (nome, documento, contato) + histórico de participações e colocações. |
| **Estoque** | Modelos de ficha; saldos (total / alocado / disponível) **derivados do livro-razão**. Entradas, saídas, quebra/perda. |
| **Livro-razão de fichas** | Todo movimento de estoque em ordem (`/livro-estoque`) — fonte da verdade dos saldos. |
| **Fichários** | Kits de fichas; alocar a um torneio **reserva** as fichas (voltam ao finalizar). Conferência física por maleta gera lançamento de ajuste. |
| **Modelos de Stack** | Composições reutilizáveis de fichas por jogador. |
| **Chip Race / Color Up** | Calculadora e histórico de trocas de fichas de menor valor. |
| **Chat** | Canais `geral`, `material`, `salao` via WebSocket + alertas urgentes globais. |
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

Pré-requisitos: Node.js 22+ e um MongoDB acessível.

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

Definido em `backend/middlewares/authMiddleware.js` (`accessControl`).

A matriz vive em **dois lugares em sincronia**: `backend/middlewares/authMiddleware.js`
(`accessControl`) e `frontend/src/config.js` (`PERMISSIONS`). Menu, rotas e API usam a
mesma fonte.

| Área | admin | material | salao |
| --- | :-: | :-: | :-: |
| dashboard | ✅ | ✅ | ✅ |
| estoque | ✅ | ✅ | ✅ |
| ficharios | ✅ | ✅ | — |
| torneios | ✅ | ✅ | ✅ |
| chip_race | ✅ | ✅ | ✅ |
| chat | ✅ | ✅ | ✅ |
| relatorios | ✅ | ✅ | — |
| usuarios | ✅ | — | — |
| modelos_stack | ✅ | ✅ | ✅ |

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

### Estoque de fichas — *estoque*
| Método | Rota |
| --- | --- |
| GET | `/chips` |
| POST | `/chips` |
| PUT | `/chips/:id` |
| DELETE | `/chips/:id` |
| POST | `/inventory/update` — `{ chip_id, quantity_change, note? }` (registra no livro-razão) |
| POST | `/inventory/breakage` — `{ chip_id, quantity, note? }` — quebra/perda |
| GET | `/inventory/ledger` — livro-razão paginado (`chip_id`, `type`) |
| POST | `/cases/:id/count` — `{ counts: [{ chip_id, counted }] }` — conferência física |
| GET | `/inventory/logs` — *relatorios* (paginado, `search`, `type`) |

### Fichários — *ficharios*
| Método | Rota |
| --- | --- |
| GET | `/cases` |
| POST | `/cases` |
| PUT | `/cases/:id` |
| DELETE | `/cases/:id` |

### Torneios — *torneios* (GET liberado a qualquer autenticado)
| Método | Rota |
| --- | --- |
| GET | `/tournaments` · `/tournaments/:id` |
| POST | `/tournaments` |
| PUT | `/tournaments/:id` |
| DELETE | `/tournaments/:id` |
| GET | `/tournaments/:id/entries` · `/tournaments/:id/consolidated-chips` |
| POST | `/tournaments/:id/entries` — `{ type: buy-in\|re-entry\|add-on, player_id?, stack_model_id? }` |
| DELETE | `/tournaments/:tid/entries/:eid` |
| POST | `/tournaments/:id/clock` — `{ action, seconds? }` — relógio: `start` · `pause` · `resume` · `stop` · `next` · `prev` · `goto` · `adjust` |
| GET | `/tournaments/:id/finance` — resumo financeiro + tabela de premiação + jogadores restantes |
| GET | `/tournaments/:id/results` — classificação final (colocação, prêmio, bounty) |
| POST | `/tournaments/:id/eliminations` — `{ player_id, eliminated_by? }` — auto-finaliza quando sobra 1 |
| DELETE | `/tournaments/:tid/eliminations/:eid` — desfaz |
| GET | `/tournaments/:id/seating` — mapa de mesas + sugestão de balanceamento |
| POST | `/tournaments/:id/seating/draw` · `/move` · `/break-table` · `/redraw` |
| GET · POST · PUT · DELETE | `/blind-templates[/:id]` — estruturas de blind reutilizáveis |

### Jogadores &amp; Premiação — *torneios*
| Método | Rota |
| --- | --- |
| GET | `/players?search=` · `/players/:id` (com histórico) |
| POST · PUT · DELETE | `/players[/:id]` |
| GET · POST · PUT · DELETE | `/payout-templates[/:id]` — templates de % com faixas por nº de inscritos |

### Modelos de stack — *modelos_stack*
| Método | Rota |
| --- | --- |
| GET | `/stacks` |
| POST · PUT · DELETE | `/stacks[/:id]` |

### Chip Race — *chip_race*
| Método | Rota |
| --- | --- |
| GET | `/chip-races` |
| POST · PUT · DELETE | `/chip-races[/:id]` |

### Dashboard / Relatórios / Chat
| Método | Rota | Acesso |
| --- | --- | --- |
| GET | `/dashboard/stats` | autenticado |
| GET | `/reports/data` | *relatorios* |
| GET | `/chat/:channel` | autenticado |

### WebSocket (Socket.io, porta 3000)
Handshake exige `auth.token` (mesmo JWT do REST) — conexões sem token são recusadas.

- **Chat**: `joinChannel` / `leaveChannel` / `sendMessage` → `newMessage`,
  `urgentNotification`, `onlineCount` / `getOnlineCount`
- **Relógio de torneio**: `joinTournament` / `leaveTournament` (entra na sala e recebe o
  estado atual) → `tournamentClock` (1×/s enquanto rodando), `tournamentLevelChanged`,
  `tournamentMarker` (fim do registro / do dia), `tournamentEnded`
- **Inventário**: `chipCasesAllocated` / `chipCasesReleased`, `chipRaceUpdated`,
  `tournamentTrackingUpdate`

### Tela de projeção
`GET /torneios/:id/telao` — rota do frontend fora da sidebar, para abrir na TV do salão
(relógio grande, blinds atual/próximo, jogadores, stack médio, fichas em jogo).

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
  some das listagens mas fica no banco. Apagar um torneio remove suas entradas e arquiva
  (`status: cancelled`) seus chip races.
- **Paginação**: as listagens (`/tournaments`, `/chips`, `/cases`, `/chip-races`) devolvem
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

## ✅ Fase P2 — Jogadores, premiação e resultados — concluída

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

- **`InventoryLedger`** (coleção nova, append-only): `entrada` / `saida` / `quebra` /
  `contagem` / `ajuste` / `saldo_inicial` / `alocacao` / `retorno`. `quantity` com sinal.
- **`ChipModel.total_quantity` / `reserved_quantity` / `available_quantity` são cache
  derivado** — `lib/inventoryLedger.recalcChip` recalcula a partir do ledger após cada
  lançamento; não se edita mais direto.
- Alocar um fichário a um torneio em andamento gera `alocacao` (reserva); finalizar/excluir
  gera `retorno` **do valor exato reservado** (imune a mudanças no conteúdo da maleta).
- Conferência física por maleta (`POST /cases/:id/count`): ajusta o conteúdo e lança a
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

## ⚠️ Ainda em aberto (roadmap P6)

- **P6 — incrementais** (chat: não lidas/anexos; relatórios ricos + export PDF; a11y;
  i18n; timezone unificado; trava de edição concorrente de blinds)

Ver o [roadmap completo](https://claude.ai/code/artifact/c98c1207-a6ec-4634-8267-1c81b25c5ac5).

---

## 📄 Licença

Projeto acadêmico — sem licença definida.
