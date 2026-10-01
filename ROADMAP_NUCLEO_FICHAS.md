# GENESIS — Roadmap de adequação ao núcleo de fichas / fichários / movimentações

> Baseado em `especificacao_genesis.docx` (versão consolidada, set/2026) e `joao_genesis.docx`
> (correção conceitual Ficha × Modelo × Fichário), comparados com o código da branch
> `feat/roadmap-p0-p6`. Data da análise: 2026-09-23.
>
> Este roadmap é **independente** do roadmap P0–P6 (já concluído: relógio, financeiro, mesas,
> segurança, i18n…). As novas fases se chamam **G0–G11** para não colidir. O que já existe e
> não é citado aqui (relógio, blinds, mesas, jogadores, financeiro, chat, PWA) **não muda**.

---

> ### ⚠️ Decisões de produto posteriores (2026-10-04) — valem sobre TODO este roadmap
> 1. **A ficha só tem VALOR NOMINAL — jamais valor monetário.** `Chip.monetary_value`, a "exposição em R$" e o `exposed_value` dos alertas (G9) **foram removidos**. A API recusa (400) qualquer campo de valor monetário na ficha.
> 2. **Não existe cadastro de jogadores.** `Player`, a página Jogadores, `PlayerSelect` e os vínculos jogador↔entrada/eliminação/descarte/KO **foram removidos**. A identidade nas mesas e eliminações é a **ENTRADA** ("Entrada #n", numerada por torneio); eliminar/sentar é por `entry_id`; o **bounty por eliminador** deixou de existir (`bounty_paid` = 0). Reentrada é uma nova entrada (a eliminada permanece eliminada).
> 3. **Não existe ficha KO nem "tipo" de ficha.** `Chip.kind`, `Tournament.ko_chip_id`, a localização `ko_settled`, o movimento `KO_SETTLE`, `/ko/*`, as liquidações de KO, o painel de KO e a confirmação dupla foram **removidos** (o G9 fica só como histórico). Toda ficha é igual: **valor nominal + cor** (única entre as ativas); semáforo só por faixa nominal e quantidade. A cor é escolhida numa **paleta estilo Excel** + "Personalizar cor" (sem digitar hexadecimal; o backend continua guardando `#rrggbb`). Migração `20261003000000-remove-ko-and-chip-kind` (duplicatas de KO viram inativas; `kind`/`ko_chip_id` arquivados em `archive_*`).
> Migração `20261002000000-remove-players-and-chip-money`: nada se perde (arquivos `archive_*`; `players` intocada). Os textos dos steps abaixo que falam de KO, valor monetário ou jogadores estão **superados** por estas decisões.

## 1. Resumo executivo

O Genesis atual é um **estoque convencional por ficha**: cada ficha tem `name`, `value`,
`color` e quantidades globais (`total_quantity` / `reserved_quantity` / `available_quantity`).
A especificação pede exatamente o oposto: **ficha é só um cadastro mestre**, a quantidade vive
em **fichários físicos**, e todo saldo é consequência de **movimentações auditáveis por
fichário / torneio / sessão**.

| O que a spec exige | Situação hoje |
| --- | --- |
| Ficha sem nome de modelo e sem quantidade | ❌ Nova Ficha pede "Nome do Modelo" e "Quantidade Inicial" |
| Ficha → Modelo de Fichário → Fichário físico | ❌ Só existe `ChipCase`, que mistura modelo e unidade física |
| Saldo derivado de movimentações por fichário | ⚠️ Ledger existe, mas por **ficha global** (sem fichário, torneio, sessão, origem/destino) |
| Evento → Torneio → Sessões/Fases | ❌ Só existe Torneio (sem Evento nem Sessão) |
| Alocação parcial por denominação/quantidade | ❌ Aloca o fichário **inteiro**; sem validação de conflito no servidor |
| Stack por tipo de ação (buy-in / opcional / reentrada) | ❌ Um `StackModel` com uma composição só |
| Fichas em jogo calculadas no backend | ❌ Calculado no frontend, e como **valor**, não quantidade |
| Chip Race / Color Up com quebra matemática | ❌ Calculadora 1→1 sem movimentação, sem quebra |
| Descarte de stack | ❌ Não existe |
| Ocorrências, recuperação, semáforo | ❌ Não existe (conferência só "sobrescreve" a quantidade) |
| Fichas KO | ❌ Não existe tipo KO nem valor monetário na ficha |
| Estorno em vez de exclusão | ❌ Chip race, entradas e eliminações são apagados/editados |
| Operador não cria cadastros estruturais | ❌ Papel `material` cria fichas, fichários, torneios e stacks |

**Conclusão:** não é um ajuste de tela. É uma refatoração do núcleo de estoque em **12 steps**,
com uma migração de dados no meio. O ledger e o `softDelete` existentes são reaproveitáveis
como base; o modelo de dados precisa ser reestruturado.

---

## 2. Diagnóstico detalhado (spec × sistema atual)

Severidade: 🔴 viola regra obrigatória da spec §18 · 🟠 funcionalidade pedida ausente ou
errada · 🟡 ajuste/consistência.

### 2.1 Ficha (spec §3.1, §16, João)

| # | Problema | Onde | Sev. |
| --- | --- | --- | --- |
| F1 | Ficha tem `name` e `total/reserved/available_quantity` | `backend/models/ChipModel.js` | 🔴 |
| F2 | `POST /chips` aceita `total_quantity`/`initial_quantity` e grava `saldo_inicial` | `backend/routes/index.js:299-322` | 🔴 |
| F3 | Tela "Nova Ficha" tem "Nome do Modelo" e "Quantidade Inicial" | `frontend/src/pages/Estoque.jsx:19,43,212,230` | 🔴 |
| F4 | Faltam `tipo` (TORNEIO/KO), `valor_monetario`, `ativa` | `ChipModel.js` | 🟠 |
| F5 | Pode haver várias fichas de mesmo valor/cor (nada impede "duas fichas de 100") | sem índice único | 🟠 |
| F6 | Ficha "excluída" via soft-delete, mas spec quer `ativa` (descontinuar sem apagar) | `routes/index.js:337` | 🟡 |

### 2.2 Modelo de Fichário e Fichário físico (spec §3.2–3.3, João)

| # | Problema | Onde | Sev. |
| --- | --- | --- | --- |
| B1 | **Não existe Modelo de Fichário.** `ChipCase` é ao mesmo tempo modelo e unidade física | `backend/models/ChipCase.js` | 🔴 |
| B2 | Composição do fichário (`chips[].quantity`) é **editada livremente** (`PUT /cases/:id`) — sem movimentação | `routes/index.js:373` | 🔴 |
| B3 | `POST /cases` e `PUT /cases/:id` **não validam** quantidade contra a disponível — só há um *warning* no frontend | `routes/index.js:360`, `Ficharios.jsx:134-158` | 🔴 |
| B4 | **Dupla contabilização**: estoque global (ledger por ficha) e `ChipCase.chips[].quantity` são duas fontes de verdade que podem divergir | `inventoryLedger.js`, `ChipCase.js` | 🔴 |
| B5 | Conferência (`/cases/:id/count`) **sobrescreve** `line.quantity` e lança "contagem" na ficha global — não cria ocorrência | `routes/index.js:399-428` | 🔴 |
| B6 | `give_entry` no modal de fichário cria entrada de estoque escondida ao salvar o fichário | `Ficharios.jsx:75-90` | 🟠 |
| B7 | Sem código/identificação própria, sem `model_id`, sem status além de available/allocated/maintenance | `ChipCase.js` | 🟠 |

### 2.3 Motor de movimentações e saldo (spec §6, §15, §18)

| # | Problema | Onde | Sev. |
| --- | --- | --- | --- |
| M1 | Ledger é **por ficha**; não tem fichário, torneio, sessão, origem/destino, estorno (`reverses`) | `models/InventoryLedger.js` | 🔴 |
| M2 | Tipos de movimento cobrem só entrada/saída/quebra/contagem/ajuste/alocação/retorno. Faltam envio por ação, chip race, color up, descarte, transferência, perda, recuperação, KO, estorno | `InventoryLedger.js:11` | 🟠 |
| M3 | `recalcChip` usa `Math.max(0, …)` → **saldo negativo é escondido** em vez de gerar ocorrência | `lib/inventoryLedger.js:23-25` | 🔴 |
| M4 | Entradas de torneio (buy-in/re-entry/add-on) **não geram movimentação** de fichas | `routes/index.js:991` | 🟠 |
| M5 | `total/available` é **cache gravado** na ficha, recalculado a cada lançamento (2 escritas, sujeito a corrida) | `inventoryLedger.js:40-51` | 🟡 |
| M6 | Não há estorno/correção administrativa vinculada ao lançamento original | — | 🔴 |
| M7 | Recursos "apagáveis": `DELETE /chip-races/:id`, `PUT /chip-races/:id`, `DELETE …/entries/:eid`, `DELETE …/eliminations/:eid`, `DELETE /tournaments/:id` (apaga entradas) | `routes/index.js:1039,1394,1418,1303,601` | 🔴 |

### 2.4 Stack, cálculo em jogo (spec §3.4, §7)

| # | Problema | Onde | Sev. |
| --- | --- | --- | --- |
| S1 | `StackModel` tem **uma** composição; spec pede colunas por ação (Buy-in Padrão, Opcional, Reentrada…) | `models/StackModel.js` | 🟠 |
| S2 | O usuário escolhe o stack **a cada entrada**; spec quer informar só a *quantidade de ações* por sessão e o servidor calcular | `Torneios.jsx:164-170` | 🟠 |
| S3 | "Fichas em jogo" = `actual_players × starting_stack` no frontend; `starting_stack` é **valor nominal** (soma valor×qtd), não quantidade por denominação. Ignora re-entry, add-on, descarte | `Torneios.jsx:296-313,633`; `routes/index.js:582-590,738-745` | 🔴 |
| S4 | `consolidated-chips` soma composições por entrada, mas sem descarte/chip race/sessão | `routes/index.js:1061-1085` | 🟠 |
| S5 | `DELETE /stacks/:id` é hard-delete, mesmo se usado por torneios/entradas; `GET /stacks` sem controle | `routes/index.js:969` | 🟡 |

### 2.5 Evento / Torneio / Sessão / Alocação (spec §3.5, §5, §18.8–9)

| # | Problema | Onde | Sev. |
| --- | --- | --- | --- |
| E1 | Não existe **Evento** nem **Sessão/Fase** (Dia 1A, 1B, Final…) | `models/Tournament.js` | 🔴 |
| E2 | Alocação é `Tournament.allocated_cases[]` (fichário **inteiro**); `reserveCases` reserva **todas** as fichas do fichário ao iniciar | `routes/index.js:625-641` | 🔴 |
| E3 | `ChipCase.allocations[].chip_ids` (parcial por tipo de ficha) existe no schema mas **sem quantidade** e sem uso real no backend | `ChipCase.js:15-22` | 🟠 |
| E4 | Sem validação de conflito de alocação por denominação/quantidade (regra §5, §18.2, §18.9) | — | 🔴 |
| E5 | Reserva só ocorre quando o torneio muda para `running`; antes disso nada impede dois torneios "agendados" com o mesmo fichário | `routes/index.js:707-715` | 🟠 |

### 2.6 Chip Race / Color Up / Descarte (spec §8, §9)

| # | Problema | Onde | Sev. |
| --- | --- | --- | --- |
| C1 | Modelo `ChipRace` é 1 ficha → 1 ficha (`from_chip`/`to_chip`); spec pede entradas/saídas **por denominação** (várias) | `models/ChipRace.js` | 🟠 |
| C2 | `to_quantity = total_value / to.value` — pode ser **fracionário**, não há conceito de quebra/arredondamento | `routes/index.js:1350-1355` | 🔴 |
| C3 | Chip race **não movimenta estoque** (não é lançado no ledger) | `routes/index.js:1369-1392` | 🟠 |
| C4 | Registro pode ser editado e excluído | `routes/index.js:1394-1426` | 🔴 |
| C5 | Não separa movimentação física × conversão de valor × quebra matemática × divergência física | — | 🔴 |
| D1 | **Descarte de stack não existe** | — | 🟠 |

### 2.7 Ocorrências, semáforo, KO (spec §10–12)

| # | Problema | Onde | Sev. |
| --- | --- | --- | --- |
| O1 | Não existe **Ocorrência** (aberta/justificada/recuperada/encerrada) nem recuperação | — | 🔴 |
| O2 | Não existe semáforo verde/amarelo/vermelho nem limites configuráveis | — | 🟠 |
| K1 | Não existe ficha **KO** (`tipo=KO`, `valor_monetario`), nem exposição monetária, nem severidade máxima | — | 🔴 |
| K2 | `Tournament.bounty_value` é financeiro (parte do buy-in) e **não se liga** a nenhuma ficha KO física | `models/Tournament.js:40` | 🟡 |

### 2.8 Permissões (spec §13, §18.10)

| # | Problema | Onde | Sev. |
| --- | --- | --- | --- |
| P1 | Matriz é por **página**, não por ação: `material` tem `estoque`/`ficharios`/`torneios`/`modelos_stack`, então cria/edita fichas, fichários, torneios e stacks | `authMiddleware.js:5-9`, `routes/index.js:299,360,573,946` | 🔴 |
| P2 | Existe um 3º papel `salao` que a spec não define | `User.js`, `config.js` | 🟡 |
| P3 | Não há restrição "acessar somente torneios/operações permitidas" | — | 🟠 |
| P4 | Backend calcula chip race (ok), mas alocação/stack/em-jogo dependem de validação do frontend (§18.11) | vários | 🔴 |

### 2.9 Dashboard e relatórios (spec §14, §16)

| # | Problema | Onde | Sev. |
| --- | --- | --- | --- |
| R1 | Dashboard soma `total_quantity` global e mostra "fichários livres" por `status` | `routes/index.js:253-285` | 🟠 |
| R2 | Relatórios usam `chip.total_quantity` (valor do estoque, distribuição) | `routes/index.js:1464-1505` | 🟠 |
| R3 | Falta: saldo por fichário×denominação, em jogo por torneio/sessão, descartado, retirado em chip race, divergências abertas, recuperadas, KO em circulação, conflitos | — | 🟠 |

### 2.10 O que já está alinhado (aproveitar, não refazer)

- **Ledger append-only** (`InventoryLedger` + `recordEntry`) — conceito certo, só precisa de dimensões.
- **`softDelete`** (`lib/softDelete.js`) e `ActivityLog` (`services/activityLogger.js`).
- Sessão JWT com revogação, `requirePageAccess`, matriz espelhada em `frontend/src/config.js`.
- Paginação, i18n, offline queue, socket.io (para dashboard em tempo real), chat com alertas urgentes.
- Testes de backend com Mongo real (`backend/test/*`) e CI em `.github/workflows/ci.yml`.

---

## 3. Decisões que precisam ser tomadas antes do Step G1

Estas escolhas mudam o desenho. Recomendação em **negrito**; confirmar com o dono do produto (quem escreveu a spec) antes de codar.

| ID | Decisão | Opções | Recomendação |
| --- | --- | --- | --- |
| **D1** | Formato do ledger novo | (a) adicionar `binder_id` etc. ao ledger atual · (b) **novo `Movement` de partida dobrada com `from` e `to`** (localização: fichário / em jogo / perdido / externo) | **(b)** — saldo = Σentradas − Σsaídas por localização; estorno é o movimento inverso; impossível "criar" ficha do nada; encaixa em chip race, descarte, transferência e perda sem tipos ad-hoc |
| **D2** | Escopo de "Sessão" | (a) **sessão leve**: nome, data/hora, status; entradas, movimentos e mesas ganham `session_id`; relógio/blinds ficam no torneio · (b) sessão com relógio, blinds e mesas próprios | **(a)** agora; (b) vira fase futura se o salão precisar de relógio por flight |
| **D3** | Papel `salao` | manter (somente leitura + chat + mesas) · remover | **Manter**, sem acesso a estoque/cadastros. Spec só define Admin e Material/Operador |
| **D4** | Fichas duplicadas hoje (ex.: "Ficha 100 – Modelo A" e "Ficha 100 – Modelo B") | mesclar por (valor+cor+tipo) automaticamente · lista para o admin decidir | **Relatório pré-migração + mesclagem assistida**; o script não deve mesclar sozinho sem conferência |
| **D5** | Estoque global hoje que não está em nenhum fichário | criar fichário "Legado / sem fichário" · descartar | **Fichário "LEGADO"** temporário; admin redistribui e zera |
| **D6** | Limites do semáforo | constantes no código · coleção `Setting` editável pelo admin | **`Setting`** com defaults da spec §11 (100/500 verde, 1.000 amarelo, ≥5.000 vermelho, KO sempre vermelho) e faixas por quantidade |
| **D7** | Ligação KO × financeiro | independentes · `Tournament.ko_chip_id` ligando torneio à ficha KO | **Ligar**, para calcular exposição monetária por torneio |
| **D8** | Nome das entidades no código | manter `ChipModel` para ficha · renomear para `Chip` | **Renomear para `Chip`** (mantendo a coleção `chipmodels` via 3º parâmetro do `mongoose.model`, sem migração de coleção). "ChipModel" vs "Modelo de Fichário" é justamente a confusão que o João apontou |

---

## 4. Modelo de dados alvo

Hierarquia (João): **Ficha → Modelo de Fichário → Fichário físico**.
"A ficha define *o que é*; o modelo define *quanto de cada ficha compõe um fichário*; o fichário
físico define *onde aquele conjunto está*."

```text
Chip (ficha)                 ── cadastro mestre único por denominação
  └─ BinderModel             ── nome + composição[{chip_id, quantity}]
       └─ Binder (físico)    ── code/nome, model_id, status; saldo vem dos Movements

Event ─ Tournament ─ TournamentSession      ── Evento → Torneio → Sessões/Fases
Tournament.stack_models[]  →  StackModel    ── composição por tipo de ação
Allocation                  ── reserva planejada: binder × torneio × (sessão) × chips[{chip_id, quantity}]
Movement                    ── fonte da verdade: append-only, partida dobrada, com estorno
Occurrence                  ── divergência física (aberta/justificada/recuperada/encerrada)
Conversion                  ── chip race / color up: entradas, saídas, valor, quebra matemática
Setting                     ── limites do semáforo e regras de alerta
```

Campos (nomes em inglês, seguindo o padrão do repositório; UI em português):

```text
Chip            { value, color, kind: 'TOURNAMENT'|'KO', monetary_value?, active }
                  índice único (value, color, kind); `name` some do cadastro (label derivado "Ficha 100")
BinderModel     { name, composition: [{ chip_id, quantity }] }
Binder          { code, model_id?, status, notes }        // sem quantidades gravadas
StackModel      { name, actions: [{ key, label }],
                  composition: [{ chip_id, quantities: { [action_key]: n } }] }
Event           { name, start_date, end_date, status }
Tournament      { event_id, number, name, binder_ids[], stack_model_id(s), ko_chip_id?, …campos atuais }
TournamentSession { tournament_id, name, starts_at, status, action_counts: { [action_key]: n } }
Allocation      { binder_id, tournament_id, session_id?, chips: [{ chip_id, quantity }], status }
Movement        { type, chip_id, quantity(>0), from:{kind,id}, to:{kind,id},
                  binder_id, tournament_id?, session_id?, user_id, user_name, at,
                  reason, reverses?: Movement, batch_id, meta }
Occurrence      { chip_id, binder_id, tournament_id?, session_id?, expected, counted, diff,
                  severity: 'GREEN'|'YELLOW'|'RED', status, justification, user_id,
                  recovered_by_movement_id?, history[] }
Conversion      { tournament_id, session_id, type: 'CHIP_RACE'|'COLOR_UP',
                  outs:[{chip_id,quantity}], ins:[{chip_id,quantity}],
                  value_out, value_in, math_breakage, movement_batch_id, status }
```

**Localizações do `Movement` (`from` / `to`):**

| kind | Significado | Saldo lido como |
| --- | --- | --- |
| `binder` | Fichas no fichário, disponíveis | Saldo disponível do fichário |
| `play` (+ tournament/session) | Em jogo | Quantidade em jogo por torneio/sessão |
| `lost` | Divergência física aberta | Faltando (liga com `Occurrence`) |
| `external` | Entrada/saída do sistema (compra, descarte definitivo, baixa) | — |
| `ko_settled` | KO liquidada/retornada | Liquidado |

Saldo de qualquer localização = `Σ to − Σ from`. Nada é gravado como número: **o dashboard sempre lê saldo derivado** (com índice `{chip_id, binder_id, at}`; se ficar lento, materializar por snapshot — nunca por edição direta).

---

## 5. Roadmap por steps

Convenções: cada step termina com **testes verdes no CI**, **migração idempotente** (`backend/migrations/`) e **atualização do README**. Esforço: **S** ≤ 1 dia · **M** 2–3 dias · **L** ≥ 4 dias.

```text
G0 ─▶ G1 ─▶ G2 ─┬▶ G3 ─▶ G4 ─▶ G5 ─▶ G6 ─▶ G7
                 │                     │
                 └─────────────────────┴▶ G8 ─▶ G9 ─▶ G10 ─▶ G11
```

(G3–G4 e G8 podem andar em paralelo depois do G2, se houver mais de uma pessoa.)

---

### Step G0 — Preparação, decisões e rede de segurança · **S**

Objetivo: não perder dados e travar o desenho antes de tocar no modelo.

- [ ] Fechar **D1–D8** (seção 3) com o autor da spec e registrar as respostas neste arquivo. **← pendente (ver "Registro de decisões" abaixo)**
- [x] `./scripts/backup.sh` do banco atual antes de qualquer migração. Feito em 2026-09-23 (banco de desenvolvimento); restauração validada num banco descartável (192 docs, contagens idênticas). **Repetir no banco de produção antes de rodar as migrações do G1.**
- [x] Script somente-leitura `scripts/audit-legacy-chips.js` (uso e checagens abaixo).
- [x] Congelar `total_quantity`/`available_quantity`/`reserved_quantity` como **legado**: comentário em `models/ChipModel.js` + trava `backend/test/legacy-quantities.test.js` (falha se código novo usar; só "desce" — ao remover usos é preciso reduzir o permitido no teste; é apagado no G11).
- [x] `Setting` (`models/Setting.js` + `lib/settings.js`): chave/valor com validação de chave e defaults; já traz o default do semáforo da spec §11 para o G8. Testes em `backend/test/settings.test.js`.

**Aceite:** ~~relatório de auditoria gerado e revisado~~ (script pronto; **falta rodá-lo no banco real** — o banco local só tem resíduo de testes E2E, todo soft-deleted); **decisões D1–D8 pendentes**; ~~backup restaurável testado~~ ✔.

#### Como usar a auditoria

```bash
# banco local (docker compose)
node scripts/audit-legacy-chips.js
# banco de produção, com relatório em JSON e falhando (exit 1) se houver erros
node scripts/audit-legacy-chips.js --uri "mongodb://host:27017/genesis" --json audit.json --strict
```

Achados (severidade): `DUP_CHIP` ✖ (fichas duplicadas por valor+cor → **D4**), `CASES_EXCEED_STOCK` ✖ (dupla contabilização), `ORPHAN_RESERVATION` ✖ (reserva presa em torneio que não está rodando), `HIDDEN_NEGATIVE` ✖ (ledger negativo escondido pelo `Math.max(0)`), `CASE_DOUBLE_ALLOCATED` ✖, `CASE_DANGLING_CHIP` ✖, `TOURNAMENT_DANGLING_CASE` ✖, `CACHE_DRIFT` ⚠, `CASE_DUP_LINE` ⚠, `CASE_BAD_QTY` ⚠, `CASE_STALE_STATUS` ⚠, `STACK_DANGLING_CHIP` ⚠, `RACE_FRACTIONAL` ⚠ (**C2**), `STOCK_OUTSIDE_CASES` ℹ (estoque sem fichário → fichário LEGADO, **D5**).

#### Registro de decisões (D1–D8)

Status **PROPOSTA** = é a recomendação da seção 3, adotada como premissa de trabalho **sem confirmação do autor da spec**. Trocar para **CONFIRMADA** (ou registrar a alternativa) antes do G1 ser mergeado.

| ID | Decisão adotada como premissa | Status |
| --- | --- | --- |
| D1 | `Movement` de partida dobrada (`from`/`to`) | PROPOSTA |
| D2 | Sessão leve (relógio/blinds ficam no torneio) | PROPOSTA |
| D3 | Manter papel `salao` sem acesso a estoque/cadastros | PROPOSTA |
| D4 | Mesclagem **assistida** de fichas duplicadas (usa a auditoria) | PROPOSTA |
| D5 | Estoque fora de fichários → fichário "LEGADO" | PROPOSTA |
| D6 | Limites do semáforo em `Setting` (defaults da spec §11; **faixas por quantidade ainda em aberto** — `escalate.*_at_quantity` = `null`) | PROPOSTA |
| D7 | `Tournament.ko_chip_id` ligando torneio à ficha KO | PROPOSTA |
| D8 | Renomear `ChipModel` → `Chip` (mantendo a coleção `chipmodels`) | PROPOSTA |

#### Notas de ambiente encontradas no G0

- `backend/node_modules` estava **vazio e pertencente ao root** (criado por bind-mount do Docker), então `npm ci` falha com `EACCES` fora do container. Para rodar testes localmente: `sudo chown -R "$USER" backend/node_modules && (cd backend && npm ci)`. Na sessão do G0 as dependências foram instaladas em outro diretório e apontadas via `NODE_PATH`.
- Linha de base dos testes do backend antes do G0: **65/65**. Depois do G0: **72/72**.

---

### Step G1 — Ficha × Modelo de Fichário × Fichário físico · **L** — ✅ CONCLUÍDO (2026-09-23)

Spec §20.1 · João (documento inteiro) · corrige **F1–F6, B1, B7**.

**Backend**
- [x] `ChipModel` → `Chip` (`models/Chip.js`, coleção `chipmodels` mantida): `kind` (`TOURNAMENT`/`KO`), `monetary_value` (obrigatório e > 0 para KO), `active`, cor hexadecimal normalizada, `name` **derivado** ("Ficha 100"; as telas antigas seguem funcionando) e `legacy_name` só para rastro. Índice único parcial `(valor, cor, tipo)` entre fichas ativas.
- [x] `POST/PUT /chips`: whitelist `value, color, kind, monetary_value, active`; **`name`, `total_quantity`, `initial_quantity`… → 400**; duplicata → 409; valor/cor/tipo ficam fixos depois que a ficha entra em uso (ledger, modelo, fichário, stack, torneio ou chip race). Desativar exige saldo zero (saldo global legado).
- [x] `DELETE /chips/:id` → **405** (fichas não são excluídas). `GET /chips?active=` e `?kind=`.
- [x] `BinderModel` + `/binder-models` (composição sem repetir, inteiro ≥ 1, só fichas ativas; nome único; excluir bloqueado se em uso; editar **não** altera fichários já criados).
- [x] `ChipCase` → `Binder` (`models/Binder.js`, coleção `chipcases` mantida) com `model_id` e `code`; `/binders` com `/cases` como alias (inclusive `/count`). Criar a partir do modelo pré-preenche a composição. Nome e código únicos. O cliente não define mais alocação/estado de torneio.
- [x] `adminOnly` (`authMiddleware.js`) em criar/editar/excluir ficha, modelo e fichário (**P1 parcial**: `material`/`salao` levam 403; a conferência de fichário continua operacional).
- [x] Lógica de validação em `lib/catalog.js` (rotas finas).

**Frontend**
- [x] `Estoque.jsx` → **Fichas**: só Valor, Cor, Tipo, Valor monetário (KO); sem "Nome do Modelo" e sem "Quantidade Inicial"; desativar/reativar em vez de excluir; botões só para admin. As colunas de saldo global ficam marcadas com `*` (temporárias até o G2).
- [x] Nova página **Modelos de Fichário** (`/modelos-ficharios`): nome + linhas ficha × quantidade, total e valor nominal, contagem de fichários por modelo.
- [x] `Ficharios.jsx` → **Fichários físicos**: escolher modelo (pré-preenche), identificação e código; removido o `give_entry` (entrada de estoque escondida) e o aviso baseado no saldo global; botões de edição só para admin; conferência segue para todos.
- [x] Menu/rotas/permissões/i18n pt-en; seletores de ficha (Chip Race, Stacks, modelos, fichários) só com fichas ativas.

**Migração `20260923000000-chip-binder-model.js`** (testada em `test/migration-g1.test.js` e ensaiada numa cópia do banco)
- [x] Duplicatas ativas **abortam a migração sem escrever nada**; só mesclam com `GENESIS_MERGE_DUPLICATE_CHIPS=1` (D4 assistida). Mescla na ficha mais antiga: reaponta fichários, stacks, torneios, chip races e ledger, soma o saldo e recalcula `balance_after`.
- [x] Normaliza todas as fichas (cor, kind, active, rótulo derivado, `legacy_name`), cria um Modelo de Fichário por fichário existente (nome repetido ganha sufixo) e o índice único. Idempotente; `down` desfaz modelos/vínculos/nomes (a mesclagem só volta pelo backup).

**Testes:** backend **97/97** (era 72; +18 de catálogo, +7 de migração); frontend 14/14 + build ok; lint sem erros. Trava do legado (`legacy-quantities.test.js`) recalibrada (frontend caiu de 13 para 3 usos).

**Aceite (§19):** ✅ *Cadastro de ficha* (100 sem quantidade, reutilizável) · ✅ *Modelo de fichário* (Modelo A = 1.000, B = 500, uma só ficha de 100) · ✅ vários fichários físicos do mesmo modelo · ✅ `POST /chips` com quantidade → 400 · ✅ `material` em `POST /chips` → 403.

**Desvios em relação ao plano original (e por quê)**
- O fichário mantém `chips[].quantity` gravado (composição física **transitória**) porque a alocação atual (`reserveCases`) depende dele; virar saldo derivado é o **G2** (B2–B5 continuam abertos e dependem do motor de movimentações).
- Estoque global por ficha (`/inventory/update`, Movimentar, ledger v1) continua funcionando até o G2 — o cadastro da ficha é que não carrega mais quantidade.
- O `code` do fichário é opcional e único só por checagem na aplicação (sem índice), por haver nomes repetidos no legado.
- As telas novas seguem o padrão das vizinhas (texto em pt-BR direto); só o menu foi para o i18n pt/en. Internacionalizar essas telas segue no backlog de i18n.

**Não verificado:** a UI **não foi testada no navegador** (a extensão do Chrome não estava conectada). Validado por lint, build, testes, servidor de desenvolvimento compilando as páginas e fumaça na API real. Vale um passeio manual por Fichas → Modelos de fichário → Fichários antes do merge.

**Antes de rodar em produção:** backup → `node scripts/audit-legacy-chips.js --uri <prod>` → conferir duplicatas → `npm run migrate` (com `GENESIS_MERGE_DUPLICATE_CHIPS=1` só se a mesclagem estiver aprovada).

---

### Step G2 — Motor de movimentações e saldo derivado · **L** — ✅ CONCLUÍDO (2026-09-24)

Spec §6, §15, §18.1–3 · corrige **M1–M3, M5–M6, B2–B5** e habilita todo o resto.

**Backend**
- [x] `models/Movement.js`: partida dobrada (`from`/`to` com `kind` `external|binder|lost` + `id`), `quantity` inteiro > 0, `reverses`, `batch_id`, `reason`, `user`. **Imutável**: hooks barram `updateOne/updateMany/findOneAndUpdate/replaceOne/deleteOne/deleteMany/findOneAndDelete`, `save()` de documento existente e `doc.deleteOne()`; **não há rota `PUT`/`PATCH`/`DELETE`**. Índice único parcial `reverses` (estorno só 1×, também no banco).
- [x] `lib/movements.js`: `postBatch` (lote tudo-ou-nada, valida o saldo da origem **dentro da transação**), `reverseMovements`, `balanceAt`/`balances`/`chipTotal` (saldo **derivado**), `refreshCaches`/`rebuildCaches`. Tipos: `ASSEMBLY`, `WITHDRAWAL`, `ADJUSTMENT`, `LOSS`, `REVERSAL` com tabela de origem/destino válidos e motivo obrigatório (exceto montagem).
- [x] **Concorrência de verdade:** transação sozinha **não** basta (dois inserts em documentos diferentes passam ambos pela validação — *write skew*; demonstrado por mutação de teste). Por isso todo débito incrementa um `BalanceLock` (ponto de conflito, **não é saldo**) na transação; sem replica set cai num **mutex em memória** (seguro só com 1 processo) e avisa no boot.
- [x] Endpoints: `POST /movements` (lote via `items`; `ASSEMBLY/WITHDRAWAL/ADJUSTMENT` só admin, `LOSS` admin+material), `POST /movements/:id/reverse` (admin; `whole_batch`), `GET /movements` (filtros; `reversed_by` derivado), `GET /balances` (`kind=lost` = divergências), `POST /binders/:id/assemble` (a partir do modelo ou avulsa).
- [x] Conferência (`/binders/:id/count`) **não sobrescreve mais nada**: compara com o saldo derivado; falta → `LOSS` (fichário → divergência), sobra → `ADJUSTMENT`; **justificativa obrigatória** se houver diferença (vira Ocorrência com semáforo no G8).
- [x] `/inventory/update` e `/inventory/breakage` **removidos** (substituídos por `/movements`). Sem `Math.max(0)`: saldo negativo é impossível por validação, e excesso de reserva aparece como disponível negativo em vez de escondido.
- [x] Fichário: nasce vazio, `chips` no corpo → 400, excluir exige fichário vazio; ficha movimentada trava valor/cor/tipo.
- [x] `Binder.chips` e `Chip.total/reserved/available_quantity` continuam existindo **só como caches derivados**, escritos apenas pelo motor (dashboard, relatórios e Torneios seguem funcionando até o G10). `InventoryLedger` v1 aceita **só reservas** (`alocacao`/`retorno`, até o G5); o resto é histórico (`legacy: true`). A reserva de torneio agora lê o **saldo derivado** do fichário.

**Migração `20260924000000-movement-opening-balances.js`** (testada e ensaiada com o `migrate-mongo` real)
- [x] `ASSEMBLY` de abertura por fichário ativo (composição legada) e, para o que o ledger v1 tem e **não está em nenhum fichário**, fichário **LEGADO** (D5). Se os fichários somam mais que o v1, vale o fichário. Marca `meta.migration`, idempotente, com `down`.

**Frontend**
- [x] `LivroEstoque.jsx` sobre `/movements` (origem → destino, fichário, motivo, usuário, "estornado") com **Estornar** (admin, motivo obrigatório, opção de lote); histórico v1 numa aba "Histórico anterior".
- [x] `Ficharios.jsx`: conteúdo **derivado** (nunca digitado); "Montar agora" na criação, botão **Montar** (admin) para lançar a composição do modelo ou fichas avulsas; conferência com justificativa.
- [x] `Estoque.jsx`: "Movimentar" exige o fichário, lança via `/movements` e respeita o papel (admin: entrada/saída/perda; material: só perda; salão: só consulta).

**Infra:** `docker-compose.yml` e `docker-compose.prod.yml` sobem o Mongo como **replica set de 1 nó** (healthcheck inicia o `rs0`; validado num container real); `MONGO_URI` com `?replicaSet=rs0`; CI passou a subir Mongo em replica set; `backend/.env.example` documenta `directConnection=true` para rodar fora do Docker.

**Testes:** backend **125/125** nos dois modos (replica set com transações **e** standalone com mutex); `test/movements.test.js` (22: saldo negativo, lote atômico, concorrência nos 2 modos, imutabilidade, estorno, permissões, conferência, **propriedade** com sequência aleatória contra um modelo em memória), `test/migration-g2.test.js` (9). Verificado por **mutação**: sem o `BalanceLock`, sem o mutex ou sem a validação de saldo, os testes de concorrência/saldo **falham**. Frontend 14/14, lint sem erros, build ok.

**Aceite:** ✅ saldo negativo → 409 e nada gravado (com 6 requisições paralelas) · ✅ não existe rota/hook para editar/apagar · ✅ erro corrigido por estorno + novo lançamento, original preservado, 2º estorno → 409 · ✅ conservação/propriedade (motor == modelo em memória).

**Mudanças de comportamento a saber**
- O papel `salao` **perdeu** a capacidade de movimentar estoque (antes qualquer papel com a área `estoque` podia). Agora só consulta.
- Entrada/saída de estoque é **só admin**; perda/quebra também o material. O estoque não é mais "global por ficha": todo lançamento é num fichário.
- Alocar um fichário a um torneio ainda reserva **o fichário inteiro** (G5 troca por `Allocation` por denominação).

**Pendências (por design)**
- Ocorrências/semáforo/recuperação: **G8** (hoje a falta vira `LOSS` + saldo em `lost`, visível em `GET /balances?kind=lost`).
- `tournament_id`/`session_id` existem no `Movement` mas ainda não são usados (G4/G6); o evento de socket `balancesChanged` já é emitido, mas nenhuma tela consome ainda (G10).
- `scripts/audit-legacy-chips.js` compara fichários × ledger v1 — **rode-o ANTES da migração G2** (depois, as linhas do fichário são cache).
- **Produção:** o Mongo precisa virar replica set (converter um standalone existente é só reiniciar com `--replSet rs0` e rodar `rs.initiate`; os dados ficam). Sem isso o backend sobe, mas avisa que as movimentações usam mutex.
- **Não verificado:** a UI **não foi testada no navegador** (a extensão do Chrome não estava conectada). Vale um passeio: Fichas → Movimentar; Fichários → Montar/Conferir; Livro-razão → Estornar.

---

### Step G3 — Modelos de Stack por ação + cálculo automático · **M** — ✅ CONCLUÍDO (2026-09-25)

Spec §3.4, §7 · corrige **S1, S2, S3, S4, S5**.

**Backend**
- [x] `StackModel` virou uma **grade ficha × ação**: `actions: [{ key, label }]` (padrão `buy_in`, `optional_buy_in`, `re_entry`; extras configuráveis como `add_on`/`vip`) e `composition: [{ chip_id, quantities: { [ação]: inteiro ≥ 0 } }]`. O valor de cada coluna é **derivado** (`totals`; `total_value` = coluna do buy-in, por compatibilidade) — o `total_value` que o navegador mandava foi eliminado. Formato antigo `{ chip_id, quantity }` ainda é aceito (vira `buy_in`).
- [x] `lib/stackCalc.js` — **lógica pura** (sem I/O): `needs(usos, fichas)` → fichas por denominação (`quantity`, `value`, `by_action`) + `totals` + `uncovered` (ação com jogadores mas sem composição — nunca vira zero silencioso). `needsForModel`, `modelForAction`, validação de ações/grade.
- [x] `lib/tournamentChips.js` — `chipsInPlay` (entradas por ação × modelo da ação), `needsForTournament`/`needsForStackModel` (simulação), `refreshTournamentChips` (recalcula os derivados `starting_stack` e `chips_value_in_play`), `entryAction`, `normalizeStackConfig`.
- [x] `Tournament.stack_models: [{ action, stack_model_id }]` (modelo por ação) com o `stack_model_id` como **padrão/fallback**. `starting_stack` e `stack_composition` **não são mais aceitos do cliente**; `stack_composition` (digitado por jogador) ficou só como campo legado, sem escrita.
- [x] `TournamentEntry.action`: o stack é **derivado da ação** (buy-in→`buy_in`, re-entry→`re_entry`, add-on→`add_on`); só o buy-in aceita variante (`optional_buy_in` ou coluna do modelo). O cliente **não escolhe mais o stack por entrada** (`stack_model_id` no corpo é ignorado — a fila offline antiga não quebra) e entradas antigas com stack próprio continuam **honradas** no cálculo. `quantity` 2–500 registra várias ações de uma vez (sem jogador) — é o "informar só a quantidade de ações".
- [x] Endpoints: `GET /tournaments/:id/chips-in-play`, `POST /tournaments/:id/needs`, `POST /stacks/:id/needs`; `consolidated-chips` mantido (formato antigo) sobre o mesmo motor.
- [x] Relógio/projeção: `total_chips_in_play` agora vem de `chips_value_in_play` (**inclui reentradas e add-ons**; antes era jogadores × stack inicial e o "stack médio" saía sempre igual ao inicial). Evento de socket `tournamentTrackingUpdate` (valor nominal rotulado como fichas) **removido**; entra `chipsInPlayChanged`.
- [x] `DELETE /stacks/:id`: 409 se em uso; senão soft-delete. Criar/editar/excluir só **admin** (spec §13); `GET` e a simulação seguem abertos.

**Migração `20260925000000-stack-actions.js`**: composição antiga → coluna `buy_in` (+ colunas padrão, `total_value` sai); entradas ganham a `action` do tipo (a que já tinha ação e o `stack_model_id` legado ficam); torneios ganham `stack_models: []`. Idempotente, com `down`. Testada e rodada com o `migrate-mongo` real numa cópia do banco.

**Frontend**
- [x] `ModelosStack.jsx` reescrito: grade ficha × ação com colunas configuráveis, valor por coluna (prévia + o oficial do servidor) e **simulador "Quantas fichas preciso?"** (informa as ações; o servidor calcula). Criar/editar/excluir só para admin.
- [x] `Torneios.jsx`: **removidos** o "Tracking Sheet" em que o operador digitava fichas por jogador, o `calculateTracking` e a automação que gravava `stack_composition`. Entram: "Fichas necessárias" (do servidor) × fichários alocados com alerta de falta, escolha do modelo padrão e **modelo por ação**, registro de entrada por **ação** e **quantidade**, botões de variantes de buy-in vindas do modelo, e a lista/cartão de "Fichas em Jogo" vindos do backend.

**Testes:** backend **167/167** nos dois modos (replica set e standalone). `stack-calc.test.js` (12, puro: aceite, mix de ações, linearidade, `uncovered`, ids populados), `stacks.test.js` (23: CRUD/validação/permissão, torneio, entradas por ação, lote, modelo por ação, entradas legadas, relógio, recálculo ao editar, simulação), `migration-g3.test.js` (7). Frontend **19/19** (novo teste de renderização de `ModelosStack` com `happy-dom`), lint sem erros, build ok. Por **mutação**: ignorar a ação da entrada, desligar o recálculo ou tirar o `adminOnly` faz os testes falharem; no frontend, trocar a rota do simulador ou liberar admin para todos também.

**Aceite:** ✅ *Stack automático* — informar 100 buy-ins (lote) → 1.000×100 + 400×500 + 700×1.000 + 800×5.000; total em valor = `ações × valor do stack` (50.000 × 100).

**Mudanças de comportamento a saber**
- `material` e `salao` **não criam/editam modelos de stack** (antes qualquer papel com a área podia). Continuam vendo e simulando.
- O operador **não escolhe mais o stack a cada entrada**: escolhe a **ação**; o stack vem do modelo do torneio. Torneio sem modelo → as ações aparecem em `uncovered` (aviso), em vez de somar nada em silêncio.
- "Fichas em jogo" do relógio passa a incluir reentradas/add-ons. Torneios existentes só são recalculados na próxima entrada/edição (até lá o relógio usa a conta antiga).
- Buy-in "opcional" foi modelado como **variante de buy-in** (mesma parte financeira, coluna de stack diferente) — o financeiro (`entryContribution`) não mudou. Se o opcional precisar de valor/rake próprio, é decisão de domínio a confirmar.

**Pendências (por design)**
- A spec fala em quantidade de ações **por sessão**: hoje a contagem é por torneio (sessões chegam no **G4**, que passa as ações e as entradas para `session_id`).
- Descartes e chip race ainda **não** abatem as fichas em jogo (G6/G7 — a estrutura `by_action`/`totals` já comporta).
- O `stack_composition` legado e `TournamentEntry.stack_model_id` saem no **G11**.
- **Não verificado:** a tela de **Torneios** (a mais alterada) **não foi testada no navegador** — a extensão do Chrome continua desconectada; foi validada por lint/build, pela API e (para `ModelosStack`) por teste de renderização. Vale um passeio: Modelos de Stack → simular 100 buy-ins; Torneios → escolher modelo, registrar entradas por ação/quantidade, conferir "Fichas necessárias".

---

### Step G4 — Evento → Torneio → Sessões/Fases · **M** — ✅ CONCLUÍDO (2026-09-26)

Spec §3.5, §18.8 · corrige **E1** (decisão **D2 = sessão leve**).

**Backend**
- [x] `Event` (nome único, datas coerentes, local) e `TournamentSession` (nome único por torneio, `order`, `starts_at`, status `scheduled → running → finished`, `started_at`/`finished_at`). `Tournament.event_id` e `number` (**único dentro do evento**).
- [x] `TournamentEntry` e `Seat` ganharam `session_id`. **Mesas por sessão**: os índices únicos do `Seat` passaram a ser `(torneio, sessão, mesa, lugar)` e `(torneio, sessão, jogador)` — o mesmo jogador senta na 1A e na 1B; sortear, mover, quebrar e redistribuir atuam só na sessão informada.
- [x] `lib/sessions.js`: **qual sessão recebe a ação** (única → ela; várias → a única em andamento; ambíguo → 400 `session_id`; de outro torneio → 404; **encerrada → 409**), ciclo de status, contadores por sessão. Torneio antigo **sem** sessões continua funcionando (sessão nula).
- [x] Rotas: `/events` (admin escreve; `GET /events/:id` traz torneios e sessões); `/tournaments/:id/sessions` (admin cria/renomeia/exclui; **operador muda o status**; só admin reabre; excluir bloqueado com entradas ou se for a última); `GET …/sessions/:sid/chips-in-play`.
- [x] `POST /tournaments` cria "Dia Único" ou as sessões pedidas (`sessions: [...]`, só admin). **O torneio só fecha com todas as sessões encerradas** (409 com a lista; `finish_sessions: true` encerra as pendentes junto). A eliminação do último jogador (auto-finalização) encerra as sessões; excluir o torneio leva as sessões junto.
- [x] Fichas em jogo por sessão (`chipsInPlay(id, { sessionId })`); o valor do torneio é a **soma das sessões**. Remover entrada libera o lugar só na sessão dela; remover entrada de sessão encerrada é só do admin.
- [x] §18.8: **fichários e modelos de stack continuam do torneio** (a sessão não guarda vínculo próprio; testado).

**Migração `20260926000000-events-sessions.js`**: troca os índices do `Seat`; cada torneio ativo sem sessão ganha **"Dia Único"** (status conforme o torneio) e suas entradas/lugares apontam para ela; torneios sem evento entram em **"Legado"**. Idempotente, com `down`; rodada em cadeia com o `migrate-mongo` real.

**Frontend**
- [x] Nova barra de sessões (`SessionBar`) nas abas **Salão** e **Mesas**: escolher a sessão, contador de entradas e valor em jogo de cada uma, Iniciar/Encerrar (operador), Reabrir/criar/renomear/excluir (admin). Entradas e fichas em jogo passam a ser **da sessão selecionada**; sessão encerrada bloqueia o registro.
- [x] Página **Eventos** (`/eventos`): lista, torneios e sessões de cada evento; CRUD só para admin.
- [x] Criar torneio: escolher **Evento**, **Nº** e (admin) as **sessões** ("Dia 1A, Dia 1B, …"). A tela chamava o torneio de "Evento" ("Nome do Evento", "Criar Evento"); os rótulos foram corrigidos para não colidir com a nova entidade. Finalizar com sessões pendentes oferece encerrá-las junto.

**Bug anterior ao G4 corrigido no caminho:** a visão de mesas (`seatingView`) devolvia `player_id` como o **texto do documento populado** e não trazia `player_name` (`buildTables` faz `String(player_id)`). Sem isso o mapa de mesas não mostrava nomes e mover jogador enviaria um id inválido. Corrigido (sem `populate`) com teste de regressão.

**Testes:** backend **198/198** nos dois modos (replica set e standalone): `sessions.test.js` (23, incluindo o cenário de aceite, resolução de sessão, permissões, fechamento, mesas por sessão, financeiro agregado, §18.8) e `migration-g4.test.js` (8). Por **mutação**: gravar entrada sem sessão, tirar a regra de fechamento, tirar o escopo das mesas, ignorar a sessão nas fichas em jogo ou tirar o `adminOnly` fazem os testes falharem. Frontend **25/25** (novo teste de renderização do `SessionBar`, também verificado por mutação), lint sem erros, build ok.

**Aceite:** ✅ *Warm Up* com Dia 1A, 1B, 1C Turbo e Dia Final continuando o **mesmo** torneio (1 documento, 4 sessões); entradas da 1A não aparecem na 1B (nem por filtro, nem nos contadores, nem nas mesas).

**Mudanças de comportamento a saber**
- **A ação precisa de uma sessão quando o torneio tem várias**: sem `session_id` e sem uma única sessão em andamento, o registro é recusado (400) em vez de "chutar". Torneios com uma sessão não mudam.
- Todo torneio criado passa a ter ao menos uma sessão; **finalizar exige sessões encerradas** (a tela oferece encerrá-las junto).
- `material` e `salao` não criam eventos nem sessões (só mudam o status); criar torneio com `sessions` é só do admin.
- Corrigido o `player_id`/`player_name` da visão de mesas (ver acima).

**Limitações (por design, D2-a)**
- **Relógio, blinds, financeiro (um único prize pool) e eliminações/classificação seguem no torneio.** Se o salão precisar de relógio/blinds por flight, ou de eliminações e "dia 2" por sessão, é a D2-b (fase futura).
- `Movement` já tem `session_id`, mas nenhum movimento o usa ainda: o envio de fichas ao torneio/sessão é o **G6**.
- **Não verificado:** a tela de **Torneios** (barra de sessões, criação com evento/sessões, finalizar com pendências) e a de **Eventos** **não foram testadas no navegador** — a extensão do Chrome continua desconectada. Só o `SessionBar` tem teste de renderização.

---

### Step G5 — Alocação parcial e validação de conflito · **M** — ✅ CONCLUÍDO (2026-09-27)

Spec §5, §18.2 e §18.9 · João (última frase) · corrige **E2–E5, B3**.

**Backend**
- [x] `Allocation` (fichário × torneio × `chips[{ chip_id, quantity }]`, status `planned|active|released`, `mode` informativo, `open`). **Uma alocação aberta por (torneio, fichário)** — inclusive no banco (índice único parcial). Liberar não apaga: vira `released` (histórico).
- [x] `lib/allocation.js` — a regra **no servidor**: `livre = saldo físico − Σ alocações abertas (de todos os torneios)`; `quantidade ≤ livre` senão **409 com o excesso e quem está segurando** (`requested`, `balance`, `allocated_elsewhere`, `free`, `excess`, `held_by`). Três modos: **fichário inteiro** (saldo de cada ficha), **por denominação** (`chip_ids` ou faixa `min_value`/`max_value`, ex.: ≥ 5.000 no A e ≤ 1.000 no B) e **quantidade específica**. Editar (a própria alocação não conta contra si), liberar, matriz por fichário (saldo / alocado a quem / **livre**, negativo = falta).
- [x] **Concorrência:** a checagem roda sob os **mesmos bloqueios do motor de movimentações** (`binder:<id>:<ficha>`). Alocar e retirar ao mesmo tempo, ou 6 torneios pedindo o mesmo saldo, se serializam — testado nos dois modos (transação e mutex).
- [x] **Retirada respeita a reserva:** `WITHDRAWAL`, `ADJUSTMENT` (saída) e estorno não levam o fichário abaixo do alocado (409 dizendo quanto está alocado, a quem e quanto pode sair). **`LOSS` (perda apurada na conferência) não é barrada** — é fato físico — e aparece como **falta** (`shortfall`) na alocação/matriz.
- [x] **E5 corrigido:** a reserva vale **desde a criação** (`planned` com o torneio agendado); iniciar o torneio ativa; encerrar/finalizar/excluir (e a auto-finalização por eliminação) **liberam**. Torneios que já rodam nascem `active`.
- [x] `Tournament.allocated_cases` virou **campo derivado** (só leitura; enviá-lo em POST/PUT → 400 com instrução, para PWAs em cache). Também derivados, mantidos pelo motor: `Binder.status/allocations/allocated_to_tournament*` e o reservado/disponível da ficha (**Σ alocações abertas**). `reserveCases`/`releaseCases` e o `recordEntry`/`recordMany` do ledger v1 **foram removidos** — o ledger v1 é só histórico.
- [x] Rotas: `POST /tournaments/:id/allocations`, `PUT/DELETE /allocations/:id`, `GET /allocations`, `GET /allocations/matrix`. **Só o admin** define/edita/libera (spec §13.1); qualquer autenticado consulta; a matriz exige a área "fichários". Socket: `allocationConflict` (no 409) e `allocationsChanged`.

**Migração `20260927000000-allocations.js`**: cada torneio **aberto** com `allocated_cases` vira uma `Allocation` (modo "binder", saldo atual), os em andamento primeiro. Onde o modelo antigo permitia o mesmo fichário em 2 torneios, a quantidade de cada ficha é **limitada ao que ainda está livre** e o restante é descartado com aviso no log — nada é inventado, e a soma alocada nunca passa do saldo. Encerrados/excluídos guardam o `allocated_cases` antigo como histórico. Todo o ledger v1 vira `legacy`. Reconstrói os derivados. Idempotente, com `down`; rodada em cadeia com o `migrate-mongo`. (O teste da migração achou e corrigiu um defeito: a reconstrução mexia em torneios excluídos.)

**Frontend**
- [x] **Torneios → "Fichas Alocadas"**: lista as alocações (fichário, ativa/planejada, fichas × quantidade, alerta de falta), **Alocar/Editar/Liberar** só para admin. **Modal de alocação** com os 3 modos e a **matriz ficha × torneio** (saldo, alocado a quem, livre); o campo de quantidade limita ao livre e o **erro 409 do servidor é exibido** com o excesso e quem está segurando (não só um aviso). "Fichas necessárias" agora compara com o **alocado** (antes comparava com o conteúdo do fichário inteiro).
- [x] **Fichários**: botão **Disponibilidade** (matriz por fichário) para quem vê fichários; os selos "Em Uso/Compartilhado" continuam funcionando sobre os campos derivados.

**Testes:** backend **230/230** nos dois modos (replica set e standalone): `allocation.test.js` (22: os 3 cenários de aceite, modos e validações, uma por (torneio, fichário), editar/liberar, ciclo de vida, retirada×reserva, falta, **concorrência ×2 modos**, permissões, filtros, reserva agregada) e `migration-g5.test.js` (10, inclui a invariante "alocado ≤ físico"). Por **mutação**, tirar a checagem `≤ livre`, os bloqueios, a guarda da retirada, o `adminOnly`, o fechamento da alocação ou a reserva-na-criação faz os testes falharem. Frontend **31/31** (novo teste de renderização do `AllocationModal`, também verificado por mutação), lint sem erros, build ok.

**Aceite:** ✅ *Alocação parcial* — fichas altas do fichário no torneio A e baixas no B, sem conflito · ✅ uma ficha além do livre → **409** (excesso 1, com quem segura) e nada gravado · ✅ dois torneios **agendados** disputando o mesmo saldo → o segundo é recusado.

**Mudanças de comportamento a saber**
- **Só o admin aloca.** Antes qualquer papel com a área "torneios" (inclusive o salão) escolhia fichários na tela do torneio. O operador continua vendo as alocações e a disponibilidade.
- A alocação **reserva na hora**, então o "disponível" da ficha cai assim que se aloca (antes só ao iniciar). Isso pode surpreender quem olhava o saldo de um torneio ainda agendado.
- Não dá mais para sair com fichas alocadas (retirada/ajuste/estorno de montagem): é preciso reduzir/liberar a alocação antes.
- Alocar exige que o fichário tenha saldo (montado); fichário em manutenção não aloca.

**Pendências (por design)**
- **Envio ao torneio** (`SEND_*`, que move as fichas do fichário para "em jogo") é o **G6**; a alocação é o **teto** que o envio vai respeitar. `session_id` na alocação não foi criado: o vínculo operacional é do torneio (§18.8).
- `Binder.allocations`/`allocated_to_tournament*` e `Tournament.allocated_cases` saem no **G11**.
- O evento `allocationConflict` já é emitido, mas **nenhuma tela o consome ainda** (dashboard, **G10**).
- **Não verificado:** as telas de **Torneios** (bloco "Fichas Alocadas") e **Fichários** (Disponibilidade) **não foram testadas no navegador** (a extensão do Chrome continua desconectada); só `AllocationModal` tem teste de renderização.

---

### Step G6 — Envio/retorno de fichas e Chip Race / Color Up · **L** — ✅ CONCLUÍDO (2026-09-28)

Spec §6 (envios/retornos), §8, §18.4 · corrige **M4, C1–C5**.

**Backend**
- [x] **Motor:** nova localização `play` (em jogo; id = torneio, sessão em `session_id`) e os tipos `SEND_BUY_IN`, `SEND_OPTIONAL`, `SEND_REENTRY`, `SEND_ADDITIONAL`, `RETURN`, `CHIP_RACE_OUT/IN`, `COLOR_UP_OUT/IN` (regras de origem/destino por tipo; débito do jogo validado; sem saldo negativo).
- [x] **A alocação (G5) virou o TETO do envio.** Reservado = alocado − enviado, com o **enviado DERIVADO dos movimentos** (Σ fichário→jogo − Σ jogo→fichário) — nada é gravado. Enviar consome a reserva do torneio e o "livre" do fichário não muda; os testes do G5 seguem verdes. Validado **dentro dos mesmos bloqueios** do saldo (envio × retirada × alocação concorrentes se serializam, nos dois modos). Editar a alocação não pode ficar abaixo do já enviado.
- [x] **Envio** (`POST /tournaments/:id/sends`): por **ação** (`items: [{ action, count }]` — o stack calcula as fichas por denominação; tipo do movimento pela ação) ou **avulso** (`chips`, "envio adicional"). Sai **só dos fichários alocados ao torneio**, esgotando cada alocação em ordem; falta → 409 com o que falta; lote tudo-ou-nada; sessão resolvida como nas entradas (encerrada → 409).
- [x] **Retorno** (`POST /tournaments/:id/returns`): jogo → fichário por denominação (contagem física); não passa do que está em jogo; permitido depois do fim do torneio; a reserva volta ao torneio.
- [x] **`Conversion`** (substitui a calculadora `ChipRace`): `outs[]`/`ins[]` por denominação; o **servidor calcula** `value_out`, `value_in` e **`math_breakage = value_in − value_out`** (lógica pura em `lib/conversion.js`). Lote OUT (jogo → fichário) + IN (fichário → jogo, dos alocados) **atômico**; o registro só existe junto com o lote. `POST /conversions/preview` usa a **mesma conta**. **A quebra matemática nunca gera perda/ocorrência** (§18.4) — testado: nenhum `LOSS`, nada em divergência.
- [x] **Imutável:** `PUT/DELETE /conversions/:id` → **405**; a calculadora antiga (`POST/PUT/DELETE /chip-races`) → **405**; correção só por **estorno do lote** (`POST /conversions/:id/reverse`, admin, motivo obrigatório; 409 se as fichas já foram movimentadas depois; estorno tudo-ou-nada). O estorno de movimentos passou a preservar torneio/sessão.
- [x] **Fichas em jogo** (`chipsInPlay`) agora aplicam as conversões ativas (entra o colocado, sai o retirado; estornadas e `legacy` não contam) e o valor do relógio/projeção acompanha a **quebra** (recalculado ao registrar/estornar).
- [x] `GET /tournaments/:id/material`: por ficha **esperado × enviado × devolvido × conversões × em jogo × pendente** (só informa; divergência formal é a conferência, G8).
- [x] Dashboard/relatórios contam as conversões ativas.

**Migração `20260928000000-conversions.js`**: cada `ChipRace` vira uma `Conversion` **`legacy`** (sem movimentos, nunca altera saldo; cancelada → `reversed`; fracionários preservados); a coleção antiga não é tocada; `GET /chip-races` segue legível. Idempotente (índice por `legacy_id`), com `down`. As 6 migrações rodam em cadeia no `migrate-mongo`.

**Frontend**
- [x] **Chip Race / Color Up** reescrita: torneio/sessão, tipo, **grade por denominação** (Em jogo · Retirado · Reservado p/ colocar · Colocado; campos só habilitam onde há fichas), **valor retirado, valor colocado e quebra vindos do servidor** (prévia com debounce), aviso de que a quebra **não é perda física**, confirmação antes de registrar, histórico com "modelo anterior"/"estornada" e **Estornar** só para admin. O salão só consulta.
- [x] **Torneios → aba Material** (`MaterialPanel`): tabela esperado × enviado × devolvido × em jogo × pendente; **Enviar por ação** (as fichas calculadas aparecem vindas do servidor) + envio adicional ("preencher com o pendente"); **Retornar** ao fichário; histórico de movimentos do torneio; erros 409 exibidos. O **Livro-razão** ganhou os tipos novos e a localização "Em jogo".

**Testes:** backend **279/279** nos dois modos: `material.test.js` (38: envio por ação/avulso/multi-fichário, consumo da reserva, teto, tudo-ou-nada, sessão, retorno, **Chip Race ±500 sem perda**, Color Up, **imutabilidade 405**, **estorno restaura saldos**, bloqueio do estorno, validações, prévia = registro, efeito nas fichas em jogo, permissões, conservação, **concorrência ×2 modos**), `conversion.test.js` (6, puro), `migration-g6.test.js` (6). Por **mutação**, tirar o teto da alocação, o "enviado" derivado, a aplicação das conversões, o estorno do lote, a permissão, a validação do saldo em jogo ou o recálculo do valor faz os testes falharem (a mutação sobre o recálculo **pegou uma lacuna real**: a conversão não atualizava o valor do relógio). Frontend **46/46** (renderização de `ChipRace` e `MaterialPanel`, também por mutação), lint sem erros, build ok.

**Aceite:** ✅ *Chip Race válido* — entradas/saídas com quebra de **+500** (e −500) registradas e **nenhuma** perda física criada · ✅ tentar editar/excluir → **405** · ✅ estorno do lote restaura os saldos.

**Decisões e mudanças de comportamento a saber**
- **Envio é uma operação explícita do Material**, não automática ao registrar a entrada. O roadmap dizia "ao registrar ações"; fazer o envio disparar sozinho bloquearia o salão por falta de fichas alocadas. Em vez disso o painel mostra o **pendente** (esperado − em jogo) e o Material envia. Se preferirem envio automático na entrada, é uma mudança pequena sobre `material.send`.
- **Chip Race / Color Up passam a exigir fichas alocadas** ao torneio e mudam saldos: `POST /conversions` é **admin/material** (antes o salão também lançava cálculos) e a calculadora antiga foi **desativada** (405).
- O `total_quantity` da ficha (cache, "em fichários") **cai ao enviar** — as fichas passam a "em jogo". Painéis que somam o estoque por ele mostram só o que está nos fichários até o G10.
- Um retorno vai para o fichário informado e volta a ser **reservado ao torneio** (as fichas devolvidas ficam disponíveis para novo envio até a alocação ser liberada). Ao **liberar** a alocação, o que está em jogo continua em jogo até ser devolvido; encerrar o torneio **não** exige devolver (a diferença fica visível no resumo).

**Pendências (por design)**
- **Descarte** (`DISCARD`, devolução física por stack parcial) é o **G7**; ele reduz o "esperado" e reaproveita `RETURN`/`play`.
- Ocorrências e semáforo (perda física, recuperação) são o **G8**; o resumo já expõe o "pendente" que a conferência vai formalizar.
- Sessão nas conversões/movimentos é gravada, mas as telas de material ainda filtram por sessão só no resumo; o painel por sessão detalhado fica para o **G10**.
- **Não verificado:** as telas **Chip Race** e **Material** (e o livro-razão com os tipos novos) **não foram testadas no navegador** (extensão do Chrome continua desconectada); foram validadas por lint, build, API e testes de renderização.

---

### Step G7 — Descarte de stack · **S** — ✅ CONCLUÍDO (2026-09-29)

Spec §9, §18.5 · corrige **D1**.

**Backend**
- [x] **Motor:** novo tipo `DISCARD` (`play → binder`; mesma regra de `RETURN`), com a guarda de saldo em jogo do `postBatch`.
- [x] `POST /tournaments/:id/discards` (e alias `/sessions/:sid/discards`): lote `DISCARD` por denominação **efetivamente devolvida** (não precisa ser a composição do stack), valor total no servidor, usuário e data/hora automáticos, sessão resolvida como nas entradas (várias sem indicar → 400; encerrada → 409; torneio encerrado → 409). Jogador opcional (cadastro ou nome livre) e anotação.
- [x] **Destino:** o único fichário alocado é o padrão; vários (ou nenhum) exigem `binder_id` (400). O saldo do fichário sobe na hora e a reserva do torneio também.
- [x] **Reduz o "em jogo":** `chipsInPlay` subtrai os descartes líquidos (Σ `DISCARD` − estornos); o valor do relógio/projeção acompanha. Reentrada depois do descarte soma stack novo por cima do que ficou.
- [x] Acima do em jogo → **409** com o saldo real; lote tudo-ou-nada. Concorrência serializada pelos mesmos bloqueios (dois modos).
- [x] `POST /discards/preview` (mesma conta), `GET /discards` (um item por lote), `POST /discards/:batch/reverse` (admin, motivo; 409 se já estornado ou fichas já movidas), `PUT/DELETE` → **405**.
- [x] Permissões: admin e material lançam; o salão só consulta. Sockets: `materialChanged`, `balancesChanged`, `chipsInPlayChanged`, `discardRegistered`.
- [x] **Correção no G6:** `GET /material` agora **abate estornos** de envio/retorno nas colunas (antes o estornado ainda contava em enviado/devolvido) e ganhou a coluna `discarded`.

Sem migração (nenhuma mudança de schema além do enum do movimento).

**Frontend**
- [x] `DiscardModal`: grade só das denominações em jogo, escolha do fichário se houver mais de um, jogador/nome livre/observação, **total vindo da prévia do servidor**, erro 409 exibido sem fechar. Aba **Material**: botão "Descartar stack", coluna **Descartado**, lista de descartes com **Estornar** (só admin, pede motivo) e **atualização em tempo real** por socket. **Livro-razão** ganhou o tipo "Descarte de stack".

**Testes:** backend **302/302** nos dois modos (`discard.test.js`, 23: aceite 3×100 + 1×500, composição diferente, sockets, 409 sem gravar, tudo-ou-nada, validações, fichário/jogador/sessão, efeito no esperado e na reentrada, estorno e bloqueio, imutabilidade, listagem, prévia, permissões, resumo abatendo estornos, regra do motor, **concorrência ×2 modos**, conservação). Por **mutação**: descarte sem abater o em jogo, estorno sem abater, regra do motor frouxa e resumo sem netting de estornos fazem os testes falharem. Frontend **58/58** (12 novos no `MaterialPanel`; mutações em socket, gating de admin, validação do fichário e total calculado no navegador são pegas), lint sem erros, build ok.

**Aceite:** ✅ *Descarte* — 3×100 + 1×500 devolvidos: saldo do fichário sobe, "em jogo"/esperado caem e o evento de socket é emitido.

**Decisões e pendências**
- O descarte **não** é enviado automaticamente ao fichário "de origem" do stack: o operador escolhe o destino quando há mais de um alocado (a origem física de uma ficha em jogo não é rastreada por fichário).
- Estornar um descarte é bloqueado se as fichas já voltaram a ser usadas (fichário sem saldo).
- **Não verificado:** a UI (modal, lista, socket ao vivo) **não foi testada no navegador** — validada por lint, build, API e testes de renderização.

---

### Step G8 — Ocorrências, perdas, recuperação e semáforo · **L** — ✅ CONCLUÍDO (2026-09-30)

Spec §10, §11, §18.1/6/7 · corrige **O1, O2, B5**.

**Backend**
- [x] **Motor:** tipos novos `FOUND` (sobra: externo → fichário|jogo) e `RECOVERY` (divergência → fichário); `LOSS` agora também vale **do jogo** para a divergência do **torneio** (`lost.id` = torneio). Nada sobrescreve quantidade.
- [x] **`Occurrence`** (`kind LOSS|SURPLUS`, `scope binder|tournament`, esperado/contado/diff, `severity` fotografada, `status open → justified → partially_recovered → recovered | closed | voided`, `history[]`). O **recuperado é derivado dos movimentos** (`RECOVERY` sem estorno), não gravado à mão; nunca é apagada (hook no modelo).
- [x] **Conferência do fichário** (`POST /binders/:id/count`, evoluída) e **do jogo** (`POST /tournaments/:id/count`, nova; por sessão opcional): contado × saldo derivado; cada diferença → movimento + ocorrência num lote tudo-ou-nada. **Chip Race não gera ocorrência:** a conferência é por quantidade e as conversões já movimentaram as fichas; a quebra só aparece como explicação em valor.
- [x] **`lib/severity.js`** (pura): KO → **vermelho sempre**; faixas por valor nominal; escalonamento por quantidade; justificativa obrigatória a partir do nível configurado (padrão vermelho). `/settings/severity` (GET qualquer usuário; PUT/DELETE admin, com validação).
- [x] **Recuperação** parcial/total com trilha em `history`; teto = o que falta **daquela ocorrência** (mesmo havendo saldo de outra ocorrência do mesmo fichário), serializado por bloqueio nos dois modos. Estorno de recuperação e estorno da ocorrência (admin, motivo; exige estornar antes as recuperações); **encerrar** (admin, com justificativa) deixa a perda restante como definitiva.
- [x] Perda lançada à mão (Estoque) também vira ocorrência (motivo obrigatório = justificativa). `POST /movements/:id/reverse` recusa (409) movimentos de ocorrência: corrige-se pela ocorrência.
- [x] `GET /tournaments/:id/material` ganhou `lost`/`found`. Sockets: `occurrenceOpened`, `occurrenceUpdated`.

**Migração `20260929000000-occurrences.js`:** cada `LOSS` antigo (sem ocorrência e não estornado) vira ocorrência `legacy` (semáforo padrão; motivo = justificativa), vinculada por `legacy_movement_id`, sem tocar nos movimentos. Idempotente, com `down`. As 7 migrações rodam em cadeia 2× + `down`.

**Frontend**
- [x] Nova página **Ocorrências** (`/ocorrencias`): lista com **badge de semáforo (cor + texto)**, filtros de status/severidade/tipo, resumo (vermelhas em aberto, sem justificativa), histórico expansível, **Justificar / Recuperar / Encerrar / Estornar** por papel (material: justificar e recuperar; admin: tudo; salão: só consulta) e atualização em tempo real.
- [x] Aba **Conferência** (fichário ou jogo/sessão): esperado ao lado do campo de contagem, só as fichas preenchidas vão ao servidor, resultado com semáforo e a explicação da quebra matemática. Aba **Semáforo** (admin): faixas, escalonamento e nível da justificativa, salvar/restaurar.
- [x] Ocorrência **vermelha** → alerta urgente global (toast + notificação do navegador) via `occurrenceOpened`. Livro-razão com `FOUND`/`RECOVERY`. A conferência em **Fichários** deixou de exigir justificativa no cliente (quem decide é o servidor).

**Testes:** backend **341/341** nos dois modos (`occurrence.test.js` 36, `migration-g8.test.js` 3): aceite (−3×100 → verde; +1 recuperado → parcial com histórico; quebra de +500 não gera ocorrência), KO vermelha com alerta, configuração, conferência do jogo, recuperação (teto, concorrência ×2 modos), estornos e bloqueios, imutabilidade, listagem/resumo, permissões, sockets, regras do motor e **conservação**. Por **mutação** (12 no backend, 8 efetivas no frontend), KO sem vermelho, justificativa nunca exigida, recuperação sem teto, estorno liberado pela rota de movimentos, encerrar recuperada, void com recuperação ativa, recuperado ignorando estornos, destino/regra da perda, quebra sumindo, perda manual sem motivo, estorno visível a todos, sem socket, semáforo para todos etc. fazem os testes falharem (uma mutação no frontend sobreviveu e reforcei o teste). Frontend **76/76**, lint sem erros, build ok.

**Aceite:** ✅ *Perda física* −3×100 → ocorrência verde · ✅ *Recuperação* +1 → saldo sobe, ocorrência `partially_recovered`/`recovered` com histórico completo · ✅ conferência com quebra de Chip Race **não** gera ocorrência.

**Decisões e mudanças de comportamento a saber**
- **A justificativa deixou de ser obrigatória para toda diferença**: só a partir do nível configurado (padrão **vermelho**, como diz a spec). Verde/amarelo abrem como *aberta* e podem ser justificadas depois. Se preferirem o rigor anterior, é só configurar "obrigatória a partir de: verde".
- **Sobra na conferência** agora é `FOUND` (antes `ADJUSTMENT`), para valer também no jogo e abrir ocorrência.
- **Escalonamento por quantidade** vem **desligado** (a spec deixa os limites em aberto — D6); as faixas padrão são 100/500 verde, 1.000 amarelo, ≥5.000 vermelho.
- A recuperação de uma perda **em jogo** volta para um **fichário escolhido**, não para o jogo (spec: `RECOVERY` divergência → fichário).
- **Encerrar** não movimenta fichas: a perda continua em divergência como registro permanente.
- A conferência compara o esperado lido no início do pedido; se o saldo mudar no meio do caminho, a perda gravada pode ficar defasada (a guarda de saldo impede negativo).

**Pendências (por design)**
- Dashboard/relatórios com o semáforo e as divergências abertas: **G10** (o `GET /occurrences/summary` já existe).
- KO: exposição monetária e liquidação são o **G9** (aqui a KO só é vermelha).
- **Não verificado:** a UI (Ocorrências, Conferência, Semáforo e o alerta global) **não foi testada no navegador** — validada por lint, build, API e testes de renderização.

---

### Step G9 — Tratamento especial de fichas KO · **M** — ✅ CONCLUÍDO (2026-10-01)

Spec §12, §18.7 · corrige **K1, K2** (decisão **D7**).

**Backend**
- [x] **Ficha KO** (já validada no G1: `kind = 'KO'` exige `monetary_value > 0`; coberto por teste dedicado) e **`Tournament.ko_chip_id`** (opcional; só ficha KO **ativa**, exceto a já ligada; PUT `null` desliga) — D7.
- [x] **Nova localização `ko_settled`** e tipo **`KO_SETTLE`** (`play → ko_settled` do MESMO torneio, só ficha KO, motivo obrigatório, guarda de saldo em jogo e concorrência serializada como as demais).
- [x] **Rastreabilidade reforçada no motor:** todo movimento de KO (qualquer tipo) recebe `meta.ko = true` e `meta.monetary_value`; **sem motivo → 400**, exceto os fluxos operacionais automáticos (envio, retorno, conversão, descarte), que recebem o motivo de sistema "Ficha KO — <tipo>". O estorno de KO já era só de admin, com motivo (coberto por teste) e também carrega a marca.
- [x] **`lib/koExposure.js`** + `GET /ko/exposure` (global ou `?tournament_id=`): **4 saldos** derivados dos movimentos — disponível (fichários), em circulação (jogo), liquidada, em divergência (fichário + torneio) — e **exposição = em circulação × valor monetário** (+ valor em divergência e ocorrências vermelhas abertas).
- [x] **Liquidação** `POST /tournaments/:id/ko-settlements` (admin e material; ficha padrão = `ko_chip_id`; ligação opcional a uma `Elimination` do torneio, cujo eliminador e `bounty_awarded` entram no motivo/`meta`). A KO liquidada **sai do esperado em jogo** (junto com o descarte), então não vira "falta enviar"; o resumo de material ganhou a coluna `settled`.
- [x] Divergência de KO **sempre vermelha** (garantida no G8; agora com teste de integração mesmo com o semáforo todo verde) e o alerta `occurrenceOpened` traz **`exposed_value`** (quantidade × valor).

Sem migração (campos opcionais novos). O helper de teste `makeBinder` passou a dar motivo à montagem (regra nova para KO).

**Frontend**
- [x] **Confirmação dupla** (`lib/koConfirm.js`, com o valor em R$) em: Estoque (entrada/saída/perda de KO, agora com motivo obrigatório), **envio**, **retorno**, **descarte** e **liquidação**.
- [x] **Torneios → Material:** seção **Liquidação de KO** (só aparece com KO em jogo) e lista de **KO liquidadas** com **Estornar** só para admin (motivo). Torneios: campo **Ficha KO** na criação e no painel do torneio.
- [x] **Dashboard:** painel **Fichas KO** com os 4 saldos, exposição em R$ e divergências vermelhas de KO em aberto, com atualização em tempo real (socket + polling). Alerta urgente e lista de Ocorrências mostram os **R$ expostos**. Livro-razão com `KO_SETTLE` e a localização "KO liquidada".

**Testes:** backend **360/360** nos dois modos (`ko.test.js`, 19: rastreabilidade, liquidação com/sem eliminação, validações, permissões, esperado em jogo, concorrência ×2 modos, regra do motor, exposição global/por torneio, aceite do alerta vermelho com valor, KO vermelha com semáforo todo verde, recuperação, conservação). **11 mutações no backend**, todas pegas (KO sem motivo, sem marca, liquidar ficha comum, exposição sobre o saldo errado, liquidada fora do esperado, liquidada de outro torneio, ligar ficha comum, alerta sem valor, resumo sem coluna, valor em divergência, disponível zerado). Frontend **95/95**; **13 mutações** (confirmação única/ausente em liquidar, retorno, envio e descarte; estorno e liquidação sem permissão; exposição errada; sem socket; alerta sem R$) — 2 sobreviveram (descarte e envio de KO sem teste) e ganharam testes. Lint sem erros, build ok.

**Aceite:** ✅ *KO* — faltar 1 ficha KO gera alerta **vermelho com o valor monetário exposto** · ✅ o Dashboard mostra os 4 saldos + exposição.

**Decisões e limites**
- **A liquidação não é automática** ao registrar a eliminação: o operador liquida no painel do Material (o vínculo com a `Elimination` existe na API, mas a tela ainda **não** oferece escolher a eliminação). `Tournament.bounty_value` continua sendo só financeiro.
- A "confirmação dupla" é uma regra de **interface**; o servidor garante motivo, marca `meta.ko`, saldo e permissão de estorno.
- A KO **enviada por ação de stack** funciona como qualquer ficha (com motivo de sistema); não há tela específica de "entregar KO ao jogador" além do envio.
- **Não verificado:** a UI (liquidação, painel do Dashboard, confirmações, e o campo de KO em **Estoque**, que não tem teste de renderização) **não foi testada no navegador**.

---

### Step G10 — Dashboard e relatórios sobre a nova fonte de verdade · **M** — ✅ CONCLUÍDO (2026-10-02)

Spec §14, §16 (última linha), §21 · corrige **R1–R3**.

**Backend**
- [x] **`lib/dashboard.js`**: tudo derivado dos movimentos (Σ to − Σ from), **zero** leitura dos caches legados. Blocos independentes: `inventory` (por ficha: em fichários, reservado, livre, em jogo, divergência, KO liquidada + matriz fichário × denominação), `in_play` (por torneio e sessão), `flows` (enviadas, devolvidas, descartadas, chip race/color up com quebra, KO liquidada, perdidas, sobras, recuperadas — **estornos abatidos**), `occurrences` (abertas por semáforo, recuperadas, faltando), `ko`, `conflicts` (alocações abertas sem saldo), `timeline`, `binders`.
- [x] **`GET /dashboard/stats?blocks=`** (default: todos; bloco desconhecido → 400) mantendo o formato `metrics/recentTournaments/recentActivities`, agora pelo movimento; "fichários livres" = sem alocação aberta (não mais um `status` digitado). **`GET /inventory/by-chip`** alimenta o Estoque.
- [x] **Relatórios reescritos:** `/reports/data` (total = em fichários + em jogo, valor, distribuição por ficha e por localização, descartes, perdas, recuperações, ocorrências) e `/reports/comparison` (material por torneio: enviado, devolvido, descartado, perdido líquido de recuperação, KO liquidada, quebra do chip race).
- [x] **Tempo real:** `movements.setNotifier` emite, a cada lote gravado, `movementsPosted { batch_id, types, chip_ids, binder_ids, tournament_ids }` (ligado ao socket no `server.js`); falha do ouvinte nunca atrapalha o lançamento e lote recusado não notifica.
- [x] **Trava do legado:** `routes/index.js` e `Estoque.jsx` saíram do ratchet (0 usos dos caches `total/reserved/available_quantity`). Restam só o modelo, o motor (único escritor) e o livro-razão v1 — o G11 apaga.

**Frontend**
- [x] **Dashboard** reescrito com as duas perguntas-guia: faixa de **alertas** (vermelhas, KO em divergência, conflitos de alocação, sem justificativa); cards (fichários, **em jogo**, valor, livres…); *Onde estão as fichas?* — fichas por denominação, em jogo por torneio/sessão, **matriz fichário × denominação**, KO; *O que acontece agora?* — fluxos (com a quebra do chip race marcada como "não é perda"), ocorrências por semáforo, conflitos e **linha do tempo**. Hook `useDashboard`: carga completa + polling + **atualização por bloco** por evento (com debounce que junta eventos).
- [x] **Estoque**: colunas Em fichários / Reservado / Livre / Em jogo vindas do saldo derivado (sem `*` de "temporário"). **Relatórios**: cards de descartes/perdas/recuperações/ocorrências, colunas de material no comparativo e **CSV de fichas** (além do CSV de logs; o PDF segue por impressão).

**Testes:** backend **372/372** nos dois modos (`dashboard.test.js`, 12): aceite (a **matriz e os totais batem com `GET /balances`**; uma chamada responde existentes/onde/torneio-sessão/devolvidas/descartadas/chip race/divergência/recuperadas), **corromper os caches legados não muda nada**, `?blocks=`, métricas, ocorrências/conflitos, linha do tempo, `by-chip`, relatórios e comparativo, estornos abatendo os fluxos, notificação. **13 mutações no backend** pegas (existentes com divergência, fluxos sem netting, fichário alocado "livre", conflitos sem filtro, sem reservado, abertas contando encerradas, `?blocks` ignorado, relatório só em fichários, perdas do comparativo, notificação sem fichários, ouvinte que derruba o lançamento, quebra estornada, sessões coladas — 3 sobreviveram e ganharam casos). Frontend **108/108**, **12 mutações efetivas** pegas (uma sobreviveu — coluna "perdido" do comparativo — e o teste foi reforçado). Lint sem erros, build ok.

**Aceite:** ✅ o dashboard responde quantas fichas existem, onde estão, em qual torneio/sessão, quais retornaram, foram descartadas, sofreram chip race, estão em divergência ou foram recuperadas — e **os números batem com `GET /balances`**.

**Decisões e limites**
- **"Existem" = em fichários + em jogo**; a divergência (perdida e ainda não recuperada) e a KO liquidada aparecem à parte.
- **Em trânsito** (roadmap: "se houver") não existe no modelo atual, então não há bloco.
- O `Ficharios.jsx` já não lia `total_quantity` (o item do roadmap era só de `Estoque` e `Relatorios`); `Binder.chips` e os caches da ficha continuam sendo gravados pelo motor até o **G11**.
- A ligação `movementsPosted` → socket é uma linha no `server.js` e **não** é exercida pelos testes (testei o ouvinte do motor e a reação do painel a cada evento); o painel também recarrega por polling a cada 30 s.
- **Não verificado:** o Dashboard, Estoque e Relatórios **não foram vistos no navegador** — validados por lint, build, API e testes de renderização (com os gráficos do `recharts` substituídos por stubs).

---

### Step G11 — Permissões por ação, auditoria total e limpeza · **M** — ✅ CONCLUÍDO (2026-10-03)

Spec §13, §15, §18.10–11 · fecha **P1–P4, M7** e remove o legado.

**Permissões por AÇÃO (P1, P2, P4)**
- [x] Matriz **área × nível** (`view` < `operate` < `manage`) em `authMiddleware.js` **e** `frontend/src/config.js`, com **teste que compara os dois** (`permissions.test.js`). Nova área `mesas` (entradas, eliminações, mesas, relógio, jogadores) para o salão operar sem ter o resto (D3).
- [x] **Material opera, não administra:** criar ficha/modelo/fichário/stack/evento/torneio/sessão/template/usuário → **403**. Perda e conferência são operação; montagem, saída, ajuste, estorno e encerramento de ocorrência são `manage`. Editar a **estrutura** do torneio (nome, financeiro, stack, blinds, ficha KO) é `manage`; `status`, `actual_players`, `estimated_players` e `notes` são operacionais. Excluir jogador é `manage`. Os guardas `materialOnly` viraram `requirePageAccess(área, nível)`.
- [x] **UI sem os botões:** Torneios (novo, excluir, estrutura de blinds, stack, KO, financeiro), Estoque, Chip Race, Ocorrências e Jogadores passam a usar `can(role, área, nível)`.

**Escopo por torneio (P3)**
- [x] `User.allowed_tournament_ids` (vazio = todos; admin ignora) + `requireTournamentAccess` em `/tournaments/:tid/**`, listagem de torneios, `POST /conversions` e histórico de saldo. O escopo vale **imediatamente** (o cache de autenticação é limpo ao editar). Tela de Usuários com seleção dos torneios permitidos.

**Nada é apagado (M7)**
- [x] Entradas e eliminações passam a **cancelamento com motivo** (`status: cancelled`, `cancelled_at/by`, `cancel_reason`): `POST …/entries/:eid/cancel` e `…/eliminations/:eid/cancel`; `DELETE` → 405. Plugin `lib/cancellable.js`: consultas ignoram as canceladas por padrão (`withCancelled` as inclui) e o schema **bloqueia** `deleteOne/deleteMany/findOneAndDelete`. Reentrada cancela a eliminação (não a apaga). `DELETE /tournaments/:id` **preserva** entradas, eliminações e movimentos. UI pede o motivo.
- [x] **Motivo obrigatório** também na montagem e na recuperação (o estorno já exigia); UI do Estoque e da montagem pede o motivo. Nenhuma rota `DELETE` de movimentação existe (teste).

**Auditoria (spec §15)**
- [x] `GET /audit/history` (`binder_id`, `chip_id` ou `tournament_id`; fichário + ficha filtra): cada movimento com o **efeito no saldo e o saldo depois**, `reversed_by`, saldos finais e paginação — reconstruído dos movimentos e conferido contra o saldo derivado. Auditoria ganhou a aba **Histórico de saldo**.

**Limpeza do legado**
- [x] Removidos do código: `total/reserved/available_quantity` (e `initial_quantity`) da ficha, `legacy_name`, conteúdo/alocações/`allocated_to_tournament*` **gravados** no fichário (agora derivados na leitura por `lib/binderView.js`), `Tournament.allocated_cases` e `stack_composition`, os caches (`refreshCaches`/`rebuildCaches`/`refreshAllocationCaches`), o alias `/cases`, `/chip-races`, `/inventory/ledger`, os modelos `InventoryLedger` e `ChipRace` e `lib/inventoryLedger.js`; o modo "Histórico anterior (v1)" do Livro-razão. O teste `no-legacy.test.js` **impede a volta** (e confirma `total_quantity` = 0 no código de aplicação — aceite).
- [x] **Migração `20261001000000-legacy-cleanup`**: NADA se perde — ledger v1 e chip races são copiados para `archive_inventoryledgers`/`archive_chipraces`; os campos legados de ficha, fichário e torneio vão para `archive_*_legacy` e só então são removidos dos documentos (`down` restaura). As coleções originais **não são apagadas**.
- [x] `README.md` (matriz de papéis, endpoints, remoções) e `database-diagram.mmd/png` (reescritos para o modelo atual).

**Testes:** backend **396/396** nos dois modos (`permissions` +8, `scope` 8, `cancel` 8, `history` 7, `migration-g11` 4, `no-legacy` 2; os testes do legado foram reescritos ou removidos: `inventory-ledger`, `legacy-quantities`). A cadeia das **8 migrações** roda 2× + downs. **15 mutações no backend** pegas (nível ignorado, estrutura do torneio liberada, escopo ignorado/sem limpar cache, canceladas contando, apagar liberado, excluir torneio apagando entradas, sinal/saldo do histórico, situação do fichário, montagem sem motivo, escopo em conversão e na listagem). Frontend **118/118** (config, Estoque por papel, Usuários com escopo, histórico de saldo…), **7 mutações** pegas; lint sem erros, build ok.

**Aceite:** ✅ *Permissão* — material tenta criar ficha/torneio → **403** (backend e UI sem o botão); nenhuma rota `DELETE` de movimento; `grep total_quantity` no código de aplicação = **0**.

**Decisões, desvios e limites**
- **`Tournament.stack_model_id` foi MANTIDO**: o roadmap o listava como legado, mas desde o G3 ele é o **modelo de stack padrão** (as ações usam `stack_models[]` por cima) — removê-lo seria um redesenho, não limpeza. Só o `stack_composition` (stack digitado à mão) saiu.
- **Salão ainda registra entradas/eliminações e opera o relógio** (área `mesas`): a spec só diz "somente leitura + chat + mesas"; interpretei "mesas" como a operação do salão. Se a intenção for o salão só ver, é trocar `mesas` para `view` na matriz.
- **Escopo por torneio** cobre `/tournaments/:tid/**`, a listagem, `POST /conversions` e `/audit/history`; **não** filtra agregados globais (dashboard, `/ocorrencias`, `/movements`), que continuam mostrando tudo a quem tem a área.
- As coleções antigas **não foram apagadas** (só arquivadas): o admin pode descartá-las depois de conferir os `archive_*`.
- O bloqueio visual de **blinds** na tela do torneio é por CSS (`pointer-events`) + botões ocultos; a barreira real é o `403` do servidor.
- **Não verificado:** a UI (Torneios sem os botões para o material, Usuários, histórico de saldo) **não foi testada no navegador**; a tela de **Torneios** não tem teste de renderização por papel (coberta pelos testes de API).

---

## 6. Mapa: cenário de aceite da spec (§19) → step

| Cenário | Step |
| --- | --- |
| Cadastro de ficha | G1 |
| Modelo de fichário | G1 |
| Sessões do torneio | G4 |
| Alocação parcial | G5 |
| Stack automático | G3 |
| Chip Race válido | G6 |
| Perda física | G8 |
| Recuperação | G8 |
| Descarte | G7 |
| KO | G9 |
| Permissão | G1 (parcial) → G11 (completo) |
| Auditoria | G2 (estorno) → G11 |

## 7. Mapa: regras obrigatórias (§18) → onde são garantidas

| # | Regra | Step | Como |
| --- | --- | --- | --- |
| 1 | Sem saldo negativo sem ocorrência | G2, G8 | `postMovement` recusa (409); só `LOSS` gera negativo controlado via Occurrence |
| 2 | Sem alocar acima do físico | G5 | `lib/allocation.js` no servidor |
| 3 | Sem excluir movimentação concluída | G2, G11 | Schema imutável, sem rotas de escrita, estorno |
| 4 | Quebra matemática ≠ perda | G6 | `Conversion.math_breakage` sem `Occurrence` |
| 5 | Descarte devolve ao saldo | G7 | `DISCARD play→binder` |
| 6 | Recuperação preserva histórico | G8 | `history[]` + `RECOVERY` |
| 7 | KO sempre vermelho | G8, G9 | `classify()` |
| 8 | Sessões compartilham vínculo do torneio | G4 | Vínculo em `Tournament`, sessão só referencia |
| 9 | Mesmo fichário em 2 torneios sem conflito | G5 | Validação por denominação/quantidade |
| 10 | Operador não cria cadastros | G1 (início), G11 (final) | Guard `adminOnly` → matriz por ação |
| 11 | Cálculo crítico no servidor | G3, G5, G6 | `stackCalc`, `allocation`, `Conversion` calculam e validam no backend |

## 8. Riscos e cuidados

1. **Migração de dados (G1/G2) é o ponto mais perigoso.** Fichas duplicadas e estoque fora de fichário precisam de decisão humana (D4/D5). Sempre rodar a auditoria do G0 e o backup antes; migrações idempotentes e reversíveis onde der.
2. **Transações no Mongo** exigem *replica set*. Se o `docker-compose` usa Mongo standalone, habilitar single-node replica set (dev e prod) antes do G2 — senão a validação de saldo volta a ter janela de corrida.
3. **Compatibilidade durante a transição:** manter campos/rotas legados *lidos* até o G11, mas proibir **novo** uso (lint/teste que falha se código novo ler `total_quantity`).
4. **Performance do saldo derivado:** agregar milhares de movimentos por leitura pode pesar no dashboard. Índices `{chip_id, binder_id, at}` e `{tournament_id, session_id, at}` no G2; se necessário, *snapshots* periódicos (nunca um contador editável).
5. **Testes:** os testes atuais (`inventory*.test.js`, `softdelete.test.js`) dependem de `total_quantity`; devem ser reescritos junto com cada step — não deixar CI vermelho entre steps.
6. **Escopo do relógio por sessão** (D2-b) pode surgir depois; o desenho `session_id` opcional já deixa a porta aberta.
7. **Frontend grande:** `Torneios.jsx` tem ~975 linhas e concentra alocação, stack, entradas e tracking — aproveitar G3/G4/G5 para quebrá-lo em componentes (aba Sessões, aba Material, aba Alocação).

## 9. Ordem sugerida de entrega (releases)

| Release | Steps | Valor entregue |
| --- | --- | --- |
| **R1 — Modelagem correta** | G0 + G1 | Corrige o problema apontado pelo João; operador deixa de criar cadastros |
| **R2 — Saldo confiável** | G2 + G5 | Estoque por fichário, imutável, sem alocação acima do físico |
| **R3 — Operação do evento** | G3 + G4 + G6 + G7 | Stack automático, sessões, chip race com quebra e descarte |
| **R4 — Controle e alerta** | G8 + G9 | Ocorrências, recuperação, semáforo e KO |
| **R5 — Visão e fechamento** | G10 + G11 | Dashboard/relatórios na nova fonte, permissões por ação, remoção do legado |

Cada release é publicável isoladamente; **R1 deve ser feito antes de qualquer outra coisa**, pois todo o resto depende de "ficha sem quantidade".
