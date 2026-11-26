# Prompt — Gênesis: Material ágil, conferência por Chip Count e painel do torneio simplificado

## Papel e contexto

Você vai evoluir o **Gênesis** (repositório `menythen/genesis`, branch `main`, base no commit `5a7ad96`). É um sistema web de logística de fichas para torneios de pôquer ao vivo: frontend em React 19 + Vite (PWA) e backend em Node.js 22 + Express + Mongoose (MongoDB em replica set) + Socket.IO.

Antes de começar, leia `CLAUDE.md`, `DESIGN_SYSTEM.md` e o `README.md` e siga as regras deles:
- **Nada que envolva dinheiro.** Os valores deste trabalho são sempre o **valor nominal das fichas**, nunca reais.
- Visual com os tokens e classes de `frontend/src/index.css`. Atualize o `DESIGN_SYSTEM.md` junto.
- O livro de movimentos (`Movement`) é a fonte da verdade e é **imutável**: correção é feita por estorno. Toda facilidade nova continua gravando movimentos **por denominação**. A agilidade está na forma de lançar, não em atalhos no livro.
- Toda operação é feita **por sessão** (`session_id`).
- Telas pensadas para o **PWA** (celular, tablet e desktop).

Este trabalho é **paralelo ao prompt "Tracking Sheet digital e operação do Salão"**. Se a idempotência e a fila offline daquele prompt (item 13) já estiverem prontas, use-as em todos os lançamentos novos. Se não estiverem, aplique pelo menos a idempotência (`client_op_id` ou `Idempotency-Key`) nos endpoints criados aqui.

## Referência real: a planilha de controle do Material

Hoje o Material controla cada torneio numa planilha (um evento real usado nos testes). Cada aba é um torneio e contém:
1. **Ações por sessão:** buy-in padrão, buy-in opcional e reentrada, com o total de ações e o total em fichas (ex.: 529 ações × 50.000 = 26.450.000).
2. **Montagem:** a composição de cada ação por denominação (equivale ao `StackModel`).
3. **Esperado por denominação e sessão:** ações × montagem.
4. **Contagem no fim de cada dia** (sacos dos jogadores), por denominação, comparada com o esperado. Ex.: esperado 9.850.000, contado 9.853.000; a diferença é a quebra das trocas do dia.
5. **Trocas** (Chip Race e Color Up) em pares de saída e entrada, várias por dia, com a quebra de cada uma.
6. **Descartes** por denominação e por dia.
7. **Fechamento:** o Dia Final comparado com o total do torneio.

O Gênesis já tem quase todos esses dados, mas **espalhados e com informação demais na tela**. O objetivo é que ele fique **mais rápido de usar e mais claro de ler do que a planilha**.

## O que já existe e deve ser reaproveitado

- `backend/lib/material.js`:
  - `send` já aceita envio **por ação** (`items: [{ action, count }]`) e o converte em fichas pelo modelo de stack;
  - `returnChips` só aceita retorno **por denominação** (`chips`);
  - `summary` calcula por ficha `expected`, `sent`, `returned`, `discarded`, `lost`, `found`, `conversion_in` e `conversion_out`, `on_table` e `at_hall`, `in_play` (Chip Count), `available` e `pending`;
  - `availableStacks` já calcula **quantos stacks completos de cada ação estão disponíveis** no salão.
- `backend/lib/tournamentChips.js` (Chip Count, herança entre fases), `backend/lib/stackCalc.js` (fichas por ação) e `backend/lib/occurrences.js`:
  - `countTournament` compara o contado com `playBalances`, que é o **saldo físico "em jogo"** (enviado − devolvido ± trocas). Esse saldo **inclui a reserva que está no salão e ainda não foi entregue**.
- Telas: `frontend/src/components/MaterialPanel.jsx` (tabela com muitas colunas), `CountPanel.jsx`, `DiscardModal.jsx`, `ConversionRequests.jsx` e `frontend/src/pages/Torneios.jsx` (concentra Material, Salão e Logística).
- `Tournament.seats_per_table` (lugares por mesa).

## Funcionalidades a implementar

### A. Envio e retorno por stacks (prioridade máxima: agilidade)

**Problema real.** No fim do registro, o Material faz a "volta de fichas": recolhe o que sobrou no salão. Hoje ele precisa lançar ficha por ficha ("100 de 100, 40 de 500, 70 de 1.000…"), o que é lento demais para a operação.

**Como o Material pensa:** foram enviados 100 stacks para 10 mesas. Um stack é retirado de cada mesa e fica na ilha do material para remanejamento. Houve 90 entradas de buy-in padrão, então **voltam 10 stacks**.

Implemente:
1. **Retorno por stacks:** o operador informa "N stacks de [ação]" (buy-in padrão, reentrada, opcional…) e o sistema converte em fichas pelo modelo de stack da ação, como o `send` já faz com `items`. O corpo aceita `items: [{ action, count }]`, e o formato atual por `chips` continua funcionando.
2. **Envio por mesas:** "N mesas × M stacks por mesa", com o padrão de M igual a `seats_per_table`, editável. Por dentro vira `items` por ação.
3. **Assistente de "volta de fichas"** (fim do registro ou fim da sessão). Em uma tela, ele mostra:
   - stacks enviados, por ação;
   - stacks usados (entradas e reentradas válidas da sessão, por ação);
   - **sugestão de retorno = enviados − usados**, por ação, usando `availableStacks` como limite físico;
   - um campo opcional "manter N stacks na ilha" (para alternates ou remanejamento), que reduz a sugestão.

   O operador confirma com **um toque**. Se precisar, ajusta a quantidade de stacks ou adiciona **fichas avulsas** por denominação, para sobras que não fecham um stack.
4. Escolha do fichário de destino: padrão no fichário vinculado ao torneio, com troca rápida quando houver mais de um.
5. Os movimentos continuam por denominação (tipo `RETURN`), guardando em `meta` a ação e a quantidade de stacks, para a tela mostrar "10 stacks de buy-in padrão" em vez de uma lista de fichas.
6. Validação no servidor: não devolver mais do que está fisicamente no salão. Se não houver fichas para N stacks completos, explique qual denominação falta.
7. Testes: retorno por stacks equivale ao retorno por fichas; a sugestão está correta com entradas, reentradas e cancelamentos; idempotência funciona.

### B. Painel do torneio simplificado (prioridade alta: "item 3")

**Problema real.** Na visão do usuário, os painéis de Material, Salão e Logística no Gênesis ficaram **confusos e com informação exagerada**. O `MaterialPanel` mostra muitas colunas técnicas (esperado, enviado, devolvido, descartado, perdido, encontrado, trocas, no salão, em jogo, disponível, pendente, saldo do fichário). A planilha é mais fácil de ler.

Implemente:
1. **Primeiro, um inventário:** liste o que cada painel atual de `Torneios.jsx` mostra (Material, Salão, Logística) e proponha um **antes e depois** antes de mudar. Espere a aprovação.
2. **Visão principal por perfil, curta e acionável:**
   - **Material:** fichas no salão, Chip Count, disponível para remanejar (em **stacks** por ação, não em fichas soltas), pendências (ocorrências e chamados) e botões grandes para Enviar, Volta de fichas, Troca, Descarte e Conferir;
   - **Salão:** inscritos, jogando, nível, relógio e chamados, sem tabela de denominações;
   - **Admin:** as duas visões mais acesso aos detalhes.
3. **"Livro do torneio"**: uma visão consolidada, só de leitura, no formato da planilha. Linhas = denominações; colunas = sessões (Dia 1A, 1B…, Dia 2, Final). Para cada sessão, mostra:
   - ações (padrão, opcional, reentrada) e total;
   - esperado (ações × montagem);
   - trocas (saída e entrada, com a quebra de cada uma);
   - descartes;
   - **contado no fim do dia** (item C) e a diferença.

   Os totais aparecem em quantidade e em valor nominal. Exporte em PDF (A4 deitado) e CSV.
4. **Detalhes sob demanda:** as colunas técnicas atuais continuam disponíveis num "ver detalhes" recolhido, nunca na visão principal.
5. Mesma linguagem nas telas: "no salão", "em jogo (Chip Count)", "disponível", com uma explicação curta (tooltip) para cada termo.
6. Responsivo no PWA. No celular, o livro do torneio vira uma visão por sessão, com troca rápida entre sessões.

### C. Contagem de fim de dia comparada com o Chip Count (prioridade alta)

**Problema real.** A conferência atual compara o contado com o **saldo físico "em jogo"**, que inclui a reserva ainda não entregue. Se o Material enviou mais do que foi usado, a contagem dos sacos aparece como "falta" e abre uma **ocorrência falsa**.

Implemente a **conferência de fim de dia em duas partes**, por sessão e por denominação:
1. **Sacos/stacks dos jogadores**, comparados com o **Chip Count esperado** (`in_play`: ações × montagem ± trocas − descartes). É exatamente a conta da planilha.
2. **Sobra no salão** (reserva não usada, ilha), comparada com o **disponível** (`available`). Essa parte pode ser lançada **em stacks**, reaproveitando o item A.

Regras:
- A soma das duas partes deve bater com o saldo físico "em jogo". Só a diferença física real vira ocorrência, sempre informando **em qual das partes** ela está.
- A **quebra das trocas** continua sendo explicação em valor, nunca perda. Mostre "diferença = quebra das trocas do dia + diferença física".
- Não mude o comportamento atual sem migração: mantenha a conferência atual disponível ou migre explicando a diferença na interface.
- Testes: envio a mais sem uso não gera ocorrência nos sacos; uma falta real nos sacos gera ocorrência na parte certa; a quebra não vira ocorrência.

### D. Contagem do fim do dia como base da fase seguinte

**Decisão de negócio: confirme com o usuário antes de implementar.** Na prática atual (planilha), o Dia 2 começa com **o que foi contado** nos sacos no fim do dia anterior. No Gênesis, a fase seguinte herda a composição **calculada** (`tournamentChips`).

Proposta a confirmar:
- Quando houver contagem de fim de dia **confirmada** (item C) em todas as sessões de origem, a fase seguinte herda a **composição contada**.
- Sem contagem, continua herdando a composição calculada, com um aviso na tela.
- A diferença entre calculado e contado fica registrada e visível no livro do torneio (item B.3).
- Corrigir uma contagem depois do início da fase seguinte segue a regra que o usuário definir (bloquear ou propagar com registro). Pergunte.

### E. Equação de fechamento do torneio

Ao encerrar o torneio, gere o **fechamento** em valor nominal e por denominação:

**total entregue (ações × montagem) = contagem final + quebra acumulada das trocas − descartes ± ocorrências (faltas e sobras) ± retornos e envios pendentes**

- Mostre se a conta **fecha** ou **não fecha**, e onde está a diferença (sessão e denominação).
- Inclua o resumo por sessão (ações, esperado, contado, quebra, descartes) e a situação dos fichários vinculados (tudo voltou?).
- Coloque o fechamento no livro do torneio (B.3) e no PDF. Ele substitui a célula de conferência que hoje, na planilha, fica com um valor negativo enquanto o Dia Final não é preenchido.

## Fora deste escopo

- Descarte automático (depende do chip count de cada jogador; é funcionalidade futura). O descarte continua manual, lançado na hora.
- Modelo de descarte padrão, mesas por área do salão (Gávea, Foyer…) e qualquer valor em dinheiro.

## Requisitos transversais

- **Backend autoritativo:** permissões (`requirePageAccess`), escopo por torneio e regras de sessão validados no servidor.
- **Atomicidade:** cada lançamento grava um lote único de movimentos em transação (`postBatch`).
- **Migração** com `migrate-mongo` para os campos e coleções novos (por exemplo, a contagem de fim de dia), segura para dados existentes.
- **Testes:** backend em `node --test` e frontend em Vitest, cobrindo os cenários citados em cada item. Rode `npm test` no backend e `npm run lint`, `npm test` e `npm run build` no frontend, e deixe tudo passando.
- **i18n** em português e inglês, e atualização do `README.md` e do `DESIGN_SYSTEM.md`.

## Forma de trabalho

1. **Etapa 0:** apresente o inventário dos painéis e a proposta de antes e depois (B.1), e faça a pergunta de negócio do item D. Espere as respostas.
2. Depois, entregue nesta ordem, cada etapa funcionando e testada: **A → C → B → D → E**. O item A é o ganho de agilidade mais imediato; o C corrige as ocorrências falsas; o B organiza tudo numa visão clara.
3. Commits pequenos, com mensagens em português.
4. Ao final de cada etapa: o que mudou, como testar no PWA (celular, tablet e desktop), quantos toques a operação leva antes e depois, e o que ficou pendente.
5. Se uma regra estiver ambígua, pergunte em vez de supor.
