# GENESIS — Sistema de Gestão de Torneios e Inventário

O **GENESIS** é uma plataforma para gestão de torneios de poker, controle de estoque de
fichas, fichários (maletas), cálculo de chip race / color up, chat interno em tempo real e
auditoria de operações.

---

## 🚀 Funcionalidades

| Módulo | Descrição |
| --- | --- |
| **Dashboard** | Métricas em tempo real: torneios ativos, fichas em estoque, fichários livres, chip races do dia + feed de auditoria. |
| **Torneios** | Criação, estrutura de blinds (níveis, breaks, marcadores), alocação de fichários, tracking de fichas em jogo, registro de entradas (buy-in / re-entry). |
| **Estoque** | Modelos de ficha (nome, valor, cor, quantidade). Movimentações de entrada/saída com log. |
| **Fichários** | Kits de fichas com opção de "entrada automática" (debita o estoque ao criar). |
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
npm start                 # http://localhost:3000

# frontend (em outro terminal)
cd frontend
npm install
npm run dev               # http://localhost:5173
```

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
| POST | `/login` | Autentica por `{ email, password }`, retorna `{ token, user }`. Rate-limited. |
| GET | `/me` | Dados do usuário do token — usado pelo frontend para revalidar a sessão. |

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
| POST | `/inventory/update` — `{ chip_id, quantity_change }` |
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
| POST | `/tournaments/:id/entries` — `{ type, stack_model_id }` |

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
Eventos: `joinChannel` / `leaveChannel` / `sendMessage` / `newMessage`,
`urgentNotification`, `onlineCount` / `getOnlineCount`,
`chipCasesAllocated` / `chipCasesReleased`, `chipRaceUpdated`, `tournamentTrackingUpdate`.

---

## 📁 Estrutura

```
genesis/
├── backend/
│   ├── server.js               # Express + Socket.io + seeder do admin
│   ├── routes/index.js          # todas as rotas REST
│   ├── middlewares/authMiddleware.js
│   ├── services/activityLogger.js
│   ├── models/                  # schemas Mongoose
│   └── scripts/fix_user_indexes.js  # remove índice legado username_1
├── frontend/
│   └── src/
│       ├── App.jsx              # rotas + auth + BACKEND_URL + socket
│       ├── components/Sidebar.jsx
│       ├── contexts/AlertContext.jsx  # toasts + confirm
│       ├── pages/               # uma página por módulo
│       └── utils/csvExport.js
├── docker-compose.yml
└── database-diagram.mmd / .png  # diagrama ER
```

---

## 🧯 Troubleshooting

**"Usuário não encontrado" no login**
Use exatamente `administrador@admin.com.br`. Se o banco for novo, confira no log do backend
a mensagem `Default Admin user created successfully.`.

**Erro de índice duplicado (`username_1`) ao subir**
Banco vindo de uma versão antiga (schema tinha `username`). Rode:
```bash
cd backend && node scripts/fix_user_indexes.js
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

## ⚠️ Ainda em aberto

- **Estoque x fichários**: criar um fichário só debita o estoque quando a linha está marcada
  como "entrada automática"; a alocação em si não reserva fichas. Precisa de um modelo de
  reserva/consumo coerente.
- **`ChipCase`** ainda carrega 3 gerações de campos de alocação
  (`allocated_to_tournament`, `allocations[]`, `Tournament.allocated_cases[]`) — escolher
  uma fonte de verdade e migrar.
- **Timer de blinds** é só visual; não há relógio server-side (`current_level` não avança
  sozinho).
- **Sem testes automatizados** e sem CI.

---

## 📄 Licença

Projeto acadêmico — sem licença definida.
