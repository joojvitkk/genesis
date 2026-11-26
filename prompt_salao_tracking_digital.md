# Prompt — Gênesis: Tracking Sheet digital e operação do Salão

## Papel e contexto

Você vai evoluir o **Gênesis** (repositório `menythen/genesis`, branch `main`, base no commit `5a7ad96`). É um sistema web de logística de fichas para torneios de pôquer ao vivo: frontend em React 19 + Vite (PWA) e backend em Node.js 22 + Express + Mongoose (MongoDB em replica set) + Socket.IO.

Antes de começar, leia `CLAUDE.md`, `DESIGN_SYSTEM.md` e o `README.md` e siga as regras deles. As principais:
- **O sistema não pode ter nada que envolva dinheiro.** Não crie nem exiba buy-in, rake, bounty, premiação ou valores em R$, nem em telas novas nem em relatórios.
- Toda mudança visual usa os tokens e classes de `frontend/src/index.css` (`bg-surface`, `text-fg-muted`, `border-line`, `.btn`, `.card`, `.input`, `.badge`). Nada de hex solto nem texto menor que 12 px. Atualize o `DESIGN_SYSTEM.md` junto.
- Movimentos de fichas são imutáveis: correção é feita por estorno, nunca por edição ou exclusão. Registros operacionais novos seguem a mesma ideia: corrigir deixa histórico, nunca apaga.
- Toda consulta e operação do Salão é feita **por sessão** (`session_id`). O `tournament_id` só agrega.

## Objetivo

Hoje o Salão imprime todos os dias, para cada sessão de cada torneio, uma **folha de tracking** em papel (num evento recente foram 54 folhas em 29 torneios). Em cada nível, o floor escreve à mão duas colunas: **Inscritos** (acumulado de entradas mais reentradas) e **Jogando**. No fim do dia, anota os classificados, o horário de encerramento e o nível e minuto em que o dia parou.

O objetivo é que o Gênesis **substitua essa folha**: registre sozinho o que hoje é escrito à mão, permita a conferência do floor e gere o fechamento do dia, com o PDF apenas como plano B.

**Importante:** o sistema **não faz inscrições** de jogadores (não há cadastro nominal nem caixa). Ele **contabiliza** inscrições, reentradas e jogadores, como já faz hoje com `TournamentEntry` (entradas numeradas, sem nome) e com os ativos derivados em `backend/lib/headcount.js`. Não crie cadastro de jogador.

## O que já existe e deve ser reaproveitado

- `TournamentSession` (`backend/models/TournamentSession.js`): relógio próprio, `blind_structure` com linhas `level`, `break`, `end_registration` e `end_day`, `level_offset`, `start_mode` (next/resume/manual), `ended_level_number`, `ended_remaining_ms`, `qualified_count` e `qualified_log`, `active_offset`, além dos caches `actual_players`, `entries_initial` e `entries_reentries`.
- Relógio no servidor: executor de 1 s em `backend/server.js`, `autoAdvance`, `levelNumber` e `clockPayload` em `backend/lib/tournamentClock.js`, e `clockView` em `backend/lib/sessions.js`.
- Ativos e ajuste do Salão: `backend/lib/headcount.js` (`refreshPlayers`, `playerCounts`) e `PUT /tournaments/:id/active-players`.
- Entradas em lote (`quantity`) e cancelamento com motivo em `POST /tournaments/:id/entries`.
- `resolveSession` em `backend/lib/sessions.js`: já recusa a operação quando há várias sessões em andamento e nenhuma foi informada.
- Telas: `frontend/src/pages/Salao.jsx`, `Torneios.jsx` (concentra fluxos demais), `Telao.jsx` e `TrackingSheet.jsx` (hoje só cadastra **modelos** de estrutura de blinds, que são copiados para a sessão).
- Fila offline em `frontend/src/lib/offlineQueue.js` e cache do PWA (`genesis-api`) em `frontend/vite.config.js`.
- Testes: backend em `node --test` (`backend/test/*.test.js`, com MongoDB) e frontend em Vitest. A CI fica em `.github/workflows/ci.yml`.

## Funcionalidades a implementar

### 1. Registro automático por nível (histórico da sessão)

- Crie um registro **por sessão e por linha da estrutura** (nível ou break), por exemplo um model `SessionLevelLog` ou um subdocumento da sessão. Justifique a escolha.
- Grave um registro **toda vez que o nível muda**: avanço automático, comando manual do Salão, "retomar" ou "próximo nível" e encerramento da sessão. Campos mínimos:
  - índice da linha e número oficial do nível (com `level_offset`), tipo da linha, SB, BB, ante e duração planejada;
  - horário real de início e de fim e a duração real, descontando pausas;
  - **inscritos acumulados** (entradas mais reentradas válidas da sessão, sem as canceladas) e o detalhe: entradas e reentradas;
  - **jogando** calculado pelo sistema;
  - média de fichas (pelo Chip Count da sessão; `null` quando não há jogadores).
- O registro é imutável. Se um dado do nível for corrigido depois (por exemplo, uma entrada cancelada com atraso), grave um novo valor com motivo e autor, preservando o original.
- Garanta que um mesmo nível não seja registrado duas vezes, mesmo com o executor de 1 s e comandos manuais simultâneos (use índice único ou um upsert atômico).
- O relógio continua rodando no servidor. Uma falha ao gravar o registro não pode travar o relógio, mas precisa ficar no log e ser recuperável.

### 2. Tela "Tracking Sheet da sessão" (a folha digital)

- **Nova tela por sessão. Ela não substitui a tela atual `TrackingSheet.jsx`.** A tela atual continua como está: é o **cadastro de modelos de estrutura de blinds** (o admin cria, Material e Salão consultam, e o modelo é copiado para a sessão). A nova tela é **operacional**: mostra o que aconteceu e o que está acontecendo numa sessão específica, a partir da estrutura que já foi copiada para ela. Para não confundir as duas:
  - renomeie a tela atual no menu para **"Estruturas de blinds"** (a rota pode continuar a mesma);
  - chame a nova de **"Tracking da sessão"** e abra-a a partir da sessão (painel "Salão agora", tela do Salão, Torneios e telão).
- Reproduza o layout da folha impressa:
  - **cabeçalho** com o nome do torneio e todas as sessões dele (data, horário de início, stack inicial, duração dos blinds e registro), **sem nenhum valor em dinheiro**;
  - **grade de níveis** com duração, horário (real nos níveis jogados, previsto nos próximos), nível, SB, BB, ante, Inscritos e Jogando;
  - **rodapé** com classificados, horário de encerramento e o ponto em que o dia parou;
  - as regras gerais do torneio, se houver.
- Os níveis jogados vêm do registro do item 1. O nível atual atualiza em tempo real por Socket.IO, e os próximos aparecem como previsão.
- A tela é **só leitura** e funciona como parte do **PWA**, não apenas no tablet:
  - **responsiva** em celular, tablet e desktop, com o mesmo conteúdo. No celular, a grade de níveis vira uma lista compacta, com o nível atual fixo no topo e o cabeçalho e o resumo recolhíveis. No tablet e no desktop, a grade aparece completa, no formato da folha;
  - abre a partir do **app instalado** (Android, iOS e desktop), com atalho do PWA para "Salão agora";
  - **sem internet**, mostra o último estado sincronizado com a data e hora da última atualização e o indicador de conexão do item 13, sem nunca exibir dados de outro usuário;
  - letras grandes, alto contraste e tema claro e escuro, seguindo o `DESIGN_SYSTEM.md`.
- **Exportar PDF / imprimir** como plano B e arquivo do evento: CSS de impressão em A4 que reproduza a folha atual, inclusive com os campos de anotação em branco para uso em emergência.
- Mesmas permissões das outras telas: Salão e Material consultam; o escopo por torneio (`allowed_tournament_ids`) precisa ser respeitado.

### 3. Conferência do floor por nível

- Em cada nível, o floor pode informar a **contagem real de jogadores**. O sistema grava a contagem, a diferença em relação ao valor calculado, o autor, o horário e um motivo opcional.
- Mostre a diferença na tela do item 2, com destaque visual quando for diferente de zero.
- Integre com o ajuste atual (`active_offset`): a contagem do floor passa a ser a forma rastreável de ajustar os ativos, e cada ajuste fica ligado ao nível em que foi feito. Não apague o histórico de ajustes.
- Só os perfis com permissão de operar o Salão (`mesas: operate`) lançam a conferência. Os demais consultam.

### 4. Fechamento do dia automático

- Ao encerrar uma sessão, gere o **resumo do dia** com:
  - inscritos, entradas, reentradas e classificados (o `qualified_count` informado no encerramento, com o histórico de correções);
  - horário real de início e de encerramento e a duração total (com e sem pausas);
  - nível e tempo restante em que o dia parou (use `ended_level_number` e `ended_remaining_ms`; a mensagem fica no formato "parou no nível 22, faltando 22:26");
  - pico de jogadores e quantidade de níveis jogados.
- Crie também o **resumo do torneio**, que junta todos os dias: entradas, reentradas e classificados de cada classificatória, total de classificados e duração de cada fase. Esse bloco substitui o resumo manual que hoje fica no topo de cada aba da planilha.
- Os dois resumos aparecem na tela do item 2 e entram no PDF.
- Não inclua ITM, premiação nem valores. Se for útil, registre **marcos** apenas como contagem de jogadores e horário, como "mesa final às 21:40 com 9 jogadores".

### 9. Vários torneios e sessões em paralelo

É normal o Salão ter vários torneios rodando ao mesmo tempo, às vezes do mesmo tipo (dois Warm Ups, Main Event e Main Event Light) e às vezes com classificatórias sobrepostas do mesmo torneio (o Dia 1A das 14h e o Dia 1B das 18h rodam juntos por horas).

- Crie um **painel "Salão agora"**: todas as sessões abertas ou em andamento de todos os torneios do escopo do usuário, cada uma com torneio, número, sessão, relógio, nível, inscritos e jogando, ordenadas por horário de início.
- **Todo lançamento do Salão** (entrada, reentrada, eliminação, ajuste ou conferência de ativos, comando do relógio, chamado de troca) é feito **dentro do contexto de uma sessão escolhida explicitamente**, com o nome do torneio e da sessão sempre visíveis e destacados.
- O frontend **sempre envia `session_id`**, sem depender da escolha automática do backend. Quando houver mais de uma sessão aberta e nenhuma escolhida, o lançamento fica bloqueado até a escolha.
- Diferencie visualmente torneios parecidos: número do evento, nome completo e tipo da sessão (TURBO, HYPER), mais uma cor ou etiqueta para cada sessão em andamento.
- Antes de gravar uma ação feita a partir de uma tela de outra sessão (por exemplo, por um link ou um atalho), peça confirmação.

### 10. Tela do Salão "de um toque" (PWA: celular, tablet e desktop)

- Tela operacional por sessão, separada de `Torneios.jsx`, com botões grandes:
  - **+1 entrada**, **+1 reentrada**, com opção de lote (já suportado pelo backend);
  - **−1 eliminação**;
  - **conferir jogando** (item 3);
  - comandos do relógio que o perfil já pode usar.
- **Desfazer imediato** do último lançamento por alguns segundos. Depois disso, o desfazer vira **cancelamento com motivo** (`/cancel`), porque nada é apagado.
- Cada toque mostra uma confirmação clara (por exemplo, "Entrada #134 registrada · Dia 1B") e atualiza os contadores na hora.
- Proteja contra toque duplo, que não pode gerar dois lançamentos. Veja a idempotência no item 13.
- Funciona no **PWA** em celular, tablet e desktop, na vertical e na horizontal, com áreas de toque de pelo menos 44 px. No celular, os botões principais ficam ao alcance do polegar, na parte de baixo da tela.
- Registre aqui também o **descarte de stack** já existente (por exemplo, para quem se classificou em mais de um Dia 1 e segue só com o maior stack). O lançamento continua manual, informando as fichas na hora, porque o sistema não conhece o chip count de cada jogador. **Não** crie descarte automático.

### 11. Horário previsto recalculado com as pausas

- Na tela do item 2, no telão e no painel do item 9, o horário dos próximos níveis e breaks é **recalculado em tempo real** a partir do início real do nível atual, do tempo restante e das pausas.
- Mostre o horário previsto de "Fim do Registro" e de "Fim do Dia" quando essas linhas existirem na estrutura.
- Nos níveis já jogados, mostre sempre o horário real do item 1, nunca o previsto.
- Respeite o fuso do torneio (`timezone`) e as sessões que passam da meia-noite.

### 13. Operação estável sem internet

Hoje existem problemas conhecidos que precisam ser corrigidos antes de o Salão depender do tablet:
- **Idempotência:** cada lançamento do Salão leva um identificador único gerado no cliente, como um cabeçalho `Idempotency-Key` ou um campo `client_op_id`. O backend guarda esse identificador (com índice único) e, ao receber um reenvio, devolve o mesmo resultado sem repetir a operação. Aplique isso a entradas, eliminações, ajustes e conferências de ativos e a comandos do relógio.
- **Fila offline** (`offlineQueue.js`):
  - reenvia com o mesmo identificador;
  - não descarta itens em erros temporários (rede, 5xx);
  - mostra ao operador os itens recusados (4xx), com o motivo, em vez de apagá-los sem avisar;
  - fica separada **por usuário** e é limpa ou bloqueada no logout, para não ser reenviada com o token de outra pessoa.
- **Cache do PWA** (`genesis-api`): não pode servir dados de um usuário para outro. Separe o cache por usuário ou limpe no logout, e não guarde respostas autenticadas sensíveis.
- **Reconexão do Socket.IO:** ao reconectar, o cliente volta automaticamente às salas do torneio, da sessão e do chat e pede o estado atual (relógio, contadores e registro por nível).
- **Indicador de conexão** sempre visível na tela do Salão: online, offline com N lançamentos pendentes, ou sincronizando.

### 6 (opcional, só depois dos itens acima). Regras de duração dos blinds editáveis

As regras mudam de torneio para torneio e dependem do número de jogadores ou de ações (por exemplo, "blinds passam a 45 minutos quando restarem 6 jogadores e a 30 minutos quando restarem 3"; "blinds adicionais a critério da direção").
- Cadastro **editável por torneio**, com possibilidade de exceção por sessão, de regras do tipo "quando [jogadores ≤ N | nível ≥ X | ações ≥ Y], a duração dos níveis passa a Z minutos". Nada fica fixo no código.
- Quando a condição é atingida, o sistema avisa o Salão e aplica a regra conforme a configuração (automática ou com confirmação). Toda aplicação fica registrada com autor, horário e nível.
- Permita **acrescentar níveis no fim da estrutura** durante a sessão (blinds adicionais), com permissão definida e registro de quem acrescentou.

## Fora deste escopo

- Cadastro de jogadores, inscrição nominal e caixa.
- Qualquer valor em dinheiro (buy-in, rake, bounty, Mystery KO, premiação, os 3% da equipe).
- Descarte automático de stacks de quem se classificou em mais de um Dia 1. Fica como funcionalidade futura, porque depende do chip count individual.
- Validação automática das estruturas de blinds e registro por horário (itens 7 e 8 do levantamento), salvo se ajudar diretamente nos itens acima.

## Requisitos transversais

- **Backend autoritativo:** permissões (`requirePageAccess`), escopo por torneio e regras de sessão são validados no servidor, e não apenas na interface. Inclua os novos eventos de Socket.IO nessa proteção.
- **Atomicidade:** operações que gravam mais de um documento usam transação quando houver replica set, seguindo o padrão de `backend/lib/movements.js`.
- **Migração** com `migrate-mongo` para os novos campos, coleções e índices, segura para dados existentes. Sessões antigas sem registro por nível aparecem com "sem histórico".
- **Testes:**
  - backend: registro por nível sem duplicidade (inclusive com o executor e comandos simultâneos), conferência, fechamento, idempotência e isolamento entre sessões paralelas (um lançamento no 1A nunca altera o 1B);
  - frontend: tela de um toque, desfazer, escolha obrigatória de sessão e fila offline.
  - Rode `npm test` no backend e `npm run lint`, `npm test` e `npm run build` no frontend, e deixe tudo passando.
- **i18n:** textos novos em português e inglês (`frontend/src/locales`).
- **Documentação:** atualize o `README.md` (funcionalidades) e o `DESIGN_SYSTEM.md` (novos componentes e o layout de impressão).

## Forma de trabalho

1. Antes de escrever código, apresente um **plano curto**: modelo de dados, rotas, eventos de socket, telas e ordem de entrega. Aponte qualquer conflito com o código atual.
2. Entregue em etapas, cada uma funcionando e testada, nesta ordem: **13 → 1 → 3 → 4 → 9 → 10 → 2 → 11 → (6)**. A idempotência e a fila vêm primeiro porque tudo depende delas, e o registro por nível alimenta as telas.
3. Faça commits pequenos, com mensagens claras em português.
4. Ao final de cada etapa, informe o que mudou, como testar manualmente no PWA instalado (celular, tablet e desktop, online e offline) e o que ficou pendente.
5. Se uma regra de negócio estiver ambígua, pergunte em vez de supor, principalmente sobre o que conta como "inscritos" e "jogando" em sessões de continuidade.
