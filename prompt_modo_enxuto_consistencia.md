# Prompt — Gênesis: modo enxuto, navegação, tipos de sessão e consistência dos números

## Papel e contexto

Você vai evoluir o **Gênesis**, a cópia local mais recente do projeto (a partir do commit `b276ed3` e das alterações ainda não commitadas na pasta). É um sistema web de logística de fichas para torneios de pôquer ao vivo: frontend em React 19 + Vite (PWA) e backend em Node.js 22 + Express + Mongoose (MongoDB em replica set) + Socket.IO.

Antes de começar, leia `CLAUDE.md`, `DESIGN_SYSTEM.md` e o `README.md` e siga as regras deles:
- **Nada que envolva dinheiro.** Os valores são sempre o **valor nominal das fichas**.
- O livro de movimentos (`Movement`) é **imutável**: correção é feita por estorno ou por um novo lançamento com motivo, nunca por edição.
- Toda operação é feita **por sessão** (`session_id`).
- Visual com os tokens de `frontend/src/index.css`. Atualize o `DESIGN_SYSTEM.md` junto.
- Telas pensadas para o **PWA** (celular, tablet e desktop).

**Quem usa o sistema** é a equipe de Material e de Salão de um evento ao vivo. São profissionais de pôquer: não precisam de explicação na tela, precisam **bater o olho e ver tudo claro**, com poucos toques. O usuário testou o sistema com dados reais e encontrou os problemas abaixo. Cada item diz o que está errado, a causa já encontrada no código (quando houver) e o resultado esperado.

## Regras de negócio que não podem mudar

- **Classificatórias** (Dia 1A, 1B…) aceitam entradas, têm fichas próprias (ações × montagem) e terminam com classificados.
- **Continuação (Dia 2, 3…) e Dia Final** herdam os classificados e as fichas das origens. Por padrão não aceitam entradas, mas a **configuração da sessão pode abrir entradas e reentradas** em torneios especiais (High Rollers), **até um nível de blind definido no template** (marcador "Fim do Registro"). Isso já existe e deve continuar funcionando.
- O **Tracking da sessão** (registro por nível, conferência do floor, previsão com pausas) está funcionando bem. Não mude o comportamento dele, só o acesso e os campos pedidos aqui.
- A **troca** (Chip Race e Color Up) confere a saída contra as fichas **fisicamente no salão**. A regra está certa e deve continuar; só o saldo das fases herdadas está errado (item 28).

---

## A. Visual enxuto

1. **Tirar as legendas e os textos explicativos** embaixo de campos, cards e ações em todas as telas (por exemplo: "Inscrições totais = entradas iniciais + reentradas…", "Quando a condição for atingida…", "O cálculo de fichas necessárias…", "Escolha acima quais fichas saem…"). Fica só o nome do campo. Se algo for realmente indispensável, use um ícone de ajuda discreto (tooltip), nunca um parágrafo.
2. **Configuração da fase compacta** (`SessionConfigPanel.jsx`). Ela continua na tela, porque o Dia 2 e o Dia Final podem aceitar entradas, mas sem textos e com menos espaço.
3. **Regras de duração dos blinds** (`BlindRulesPanel.jsx`): hoje ficam numa coluna estreita, com os campos cortados ("Nome da", "Va", "M") e as opções do menu cortadas. Mova o quadro para **logo abaixo da Estrutura de Blinds, na Logística, ocupando a largura toda**. Cada regra numa linha legível:
   `Quando [jogadores restantes ≤ | nível ≥ | ações ≥] [N] → níveis passam a [Z] min · [só esta sessão ☐] · Adicionar`
   As regras cadastradas aparecem como uma lista curta, com editar e excluir. A lógica atual (por torneio, com exceção por sessão) continua igual.
4. **Níveis extras no fim da estrutura:**
   - Na Logística: uma linha **"+ Nível no fim"** junto da tabela de blinds, no lugar do quadro separado "Nível adicional no fim da estrutura".
   - No Salão: sai o quadro **"Blinds desta fase · Salvar blinds"** e entra um botão **"+ Nível no fim"**, que **sugere** o próximo nível seguindo a progressão da estrutura.
   - **O nível extra é editável:** SB, BB, ante e duração podem ser ajustados antes de confirmar e **depois de criado, enquanto o nível ainda não começou**. Também pode ser removido se ainda não tiver sido jogado. Toda criação, edição e remoção fica registrada com autor e horário. Permissões: as mesmas de hoje para alterar a estrutura da sessão.
5. **Stack do torneio** sai da Logística. A escolha do **modelo de stack** (padrão e "outro modelo por ação") vai para o **formulário de criar e editar o torneio** (o lápis no topo). Não apague a escolha: ela alimenta o envio por stacks, a volta de fichas, o Chip Count e o Livro.
6. **Sai o quadro "Dados herdados"** e o rótulo **"(herdado)"** nos cards (`Torneios.jsx`, `isFinalSession`). Os cards ficam "Entradas totais", "Buy-ins", "Re-entries" e "Fichas em jogo".
7. **PWA:** hoje abre grande demais, cortando a tela. Corrija viewport, escala e layout para celular, tablet e desktop, no app instalado e no navegador.
8. **Separador de milhar** em todos os números exibidos, inclusive nos campos de blinds (hoje "4000 / 8000" no campo e "4.000 / 8.000" no relógio).
9. **Um botão de iniciar só:** fica **"Iniciar sessão"**; sai o "Iniciar" do topo do torneio.
10. **Botões de buy-in e reentrada escondidos** quando a sessão não aceita entradas (configuração da sessão ou registro encerrado). Hoje eles aparecem no Dia Final configurado com "Não". O servidor continua bloqueando também.

## B. Navegação

11. **Torneio como página com endereço próprio**, no lugar da janela atual: por exemplo, `/torneios/:id/:aba?sessao=:sid`.
    - O **Voltar** do navegador e do celular retorna ao torneio, à aba e à sessão de origem.
    - As telas Troca (`ChipRace.jsx`), Tracking (`TrackingSessao.jsx`), Livro e tela de um toque (`SalaoSessao.jsx`) ganham **"← Voltar ao torneio"**, que reabre o ponto de origem.
    - Problema real: hoje, ao ir de uma tela para outra, o usuário precisa reabrir o torneio, a aba e a sessão, e isso gera muitos cliques.
12. **Mesma sessão em todas as abas.** Hoje, ao abrir o Warm Up, a Logística mostrou o Dia 1A enquanto o Salão e o Material mostraram o Dia Final. Ao abrir um torneio, todas as abas devem mostrar **a sessão em andamento**; se não houver, a **próxima agendada**; com o torneio encerrado, a **última**. Trocar a sessão numa aba troca em todas, e a sessão escolhida fica no endereço (item 11). **Confirme este item com o usuário antes de implementar**: ele pediu um exemplo visual e ainda não aprovou.
13. **Menu Gestão e controle → "Tracking Sheet":** uma lista com os Trackings de **todas** as sessões, em andamento e encerradas, com filtro por evento, torneio, data e situação, e o PDF de cada um.
    - **"Estruturas de Blinds"** continua no lugar atual (são coisas diferentes).
    - O endereço `/tracking-sheet` hoje abre as **estruturas**. Mude para `/estruturas-blinds` (com redirecionamento do endereço antigo), para os nomes não se misturarem.
14. **O Tracking não pode sumir depois do encerramento.** Causa: o único link fica em `SalaoSessao.jsx`, que só é aberto pelo "Salão agora", e o `salaoNow` (em `lib/tracking.js`) só lista sessões agendadas, em andamento ou pausadas. Os dados continuam no banco (`SessionLevelLog`) e a rota `/tracking-sessao/:tid/:sid` funciona para sessões encerradas. Acrescente:
    - um botão **"Tracking"** na linha da sessão encerrada, ao lado de "Reabrir" e "Corrigir classificados";
    - uma seção **"Encerradas hoje"** no "Salão agora";
    - a lista do item 13.

## C. Tipos de sessão

15. **Novo tipo "Dia Único"** (`SESSION_TYPES`, `lib/sessions.js`, `SessionConfigPanel.jsx`).
    - Aceita entradas, tem fichas próprias (ações × montagem), recebe trocas, descartes e eliminações até o campeão, e **nunca herda nem gera classificados**.
    - Torneio criado com **uma sessão só** nasce como **Dia Único**, qualquer que seja o nome. Hoje `createSession` decide o tipo pelo nome (`/final/i`).
    - Se depois for acrescentada outra sessão, o sistema pergunta se o Dia Único vira Classificatória.
    - Problema real: um High Roller de dia único foi marcado como "Dia Final". Como não tinha origem, herdou **nada**: os cards mostraram "(herdado) 0" apesar das entradas, o Material mostrou "Chip Count consolidado · herda" com valores errados e o Chip Race foi bloqueado. Toda decisão hoje é `type !== 'QUALIFIER'` (`lib/material.js` `phase`, `Torneios.jsx` `isFinalSession`, `SessionConfigPanel.jsx`). Revise todos esses pontos para tratar o Dia Único como sessão com fichas próprias.
16. **Regras para escolher o tipo:**
    - "Dia Final" e "Continuação" **só se existir uma sessão antes** no torneio. Sem origem, recuse com uma mensagem clara.
    - Mudar o tipo com inscrições: **permitido entre Classificatória e Dia Único** (nada se perde); **bloqueado para Continuação e Dia Final**, com o motivo na mensagem. Isso deve permitir corrigir o High Roller de teste de "Dia Final" para "Dia Único".
17. **Dia 2 e Dia Final com entradas** (torneios especiais), de forma consistente em todas as telas:
    - fichas em jogo = herdado das origens + stacks das entradas da fase (ações × montagem);
    - saldo físico = o que veio das origens (item 28) + o que o Material enviou para a fase;
    - jogando = classificados herdados + entradas da fase − eliminações da fase;
    - registro de entradas fecha no nível do marcador **"Fim do Registro"** da estrutura da sessão (template), integrado à regra de fechamento atual (`registration_close_level`, "Também encerrar ao passar o evento Fim do Registro");
    - cards do Salão: entradas da própria fase e total acumulado do torneio, sem "(herdado)".
18. **Template do Dia Final na Logística:** na tela do Salão os blinds do Dia Final estão certos, mas na Logística aparece a estrutura do classificatório. A Logística deve mostrar a estrutura **da sessão selecionada** (a que foi copiada para ela), não a do torneio.

## D. Salão e contagem

19. **"−1 eliminação" nas fases herdadas.** Causa (`POST /tournaments/:id/eliminations`, eliminação anônima): o código procura uma **entrada da própria sessão** para marcar como eliminada. No Dia Final não existe nenhuma (as entradas dos classificados pertencem às classificatórias), então ele responde "Não há jogadores ativos nesta sessão para eliminar". Pela Logística funciona porque lá se usa o ajuste de "Jogando", não a eliminação.
    - Nas fases de continuação, "−1 eliminação" registra uma **eliminação da sessão sem exigir entrada própria**: diminui o Jogando, conta nos eliminados, grava a colocação (127º, 126º…) e permite desfazer, como nas classificatórias.
    - Quando restar 1 jogador, é o campeão.
20. **Encerramento do dia** (`PUT` da sessão em `routes/index.js`): hoje grava `qualified_count`, mas não ajusta os ativos da sessão. No Dia 1B do teste ficaram **classificados 62, Jogando 100 e Eliminados 0**. Ao encerrar, e também em "Corrigir classificados":
    - "Jogando" da sessão = classificados, com o ajuste registrado como **ajuste de fechamento** (autor, horário, valor anterior);
    - **eliminados = inscrições totais − classificados** (188 − 62 = 126); os toques em "−1 eliminação" continuam como detalhe;
    - o número no chip da sessão encerrada mostra os classificados.
    - Não crie eliminações falsas para fechar a conta.
21. **Durante o dia: eliminados = inscrições − jogando**, usando a conferência do floor quando existir. O Salão não toca em eliminação a cada jogador; a conferência é a fonte confiável.
22. **Tracking: Chip Count no fechamento do dia.** O resumo do dia (`dayClosing.sessionSummary`) e o Tracking passam a mostrar o **valor nominal em jogo no encerramento**, junto do horário, dos classificados e de onde o dia parou.
23. **Tracking nas fases de continuação:**
    - a coluna **"Inscritos"** mostra o **acumulado do torneio** (529 no teste), em vez de 0;
    - a coluna **"Jogando"** fica preenchida em **todos os níveis** da fase, e o número atual de jogadores aparece em destaque no topo do Tracking.
24. **Remover a gravação de prêmios** quando sobra o campeão (o comentário da rota de eliminações diz "grava os prêmios de cada colocação"). É um resto financeiro, contra a regra do projeto.

## E. Material

25. **Cards do painel** (`MaterialPanel.jsx`):
    - **"No salão"** e **"Disponível"** em **stacks por ação**, listando todas as ações, inclusive as zeradas (por exemplo: "Buy-in padrão: 0 · Reentrada: 3"). Hoje "No salão" soma as peças de montagens diferentes ("490 fichas") e o "Disponível" mostra uma ação só.
    - **"Em jogo"** em **valor nominal em tempo real**, como número principal. A contagem de peças fica só nos detalhes.
26. **Uma tabela por ação, em stacks**, no lugar das duas tabelas atuais ("Material: enviado × em jogo" e "Fichas necessárias"), que repetem os mesmos números com nomes diferentes:

    | Ação | Enviados | Usados | Disponível | Falta |
    |---|---|---|---|---|
    | Buy-in padrão | 10 | 100 | 0 | 90 |
    | Reentrada | 100 | 97 | 3 | 0 |

    Embaixo, o valor nominal em jogo. A visão por denominação fica recolhida em "detalhes".
27. **Envio:**
    - a linha de envio já começa com uma ação escolhida (buy-in padrão);
    - **stacks por mesa editável**, com padrão configurável por torneio (o usuário trabalha com 10; hoje o padrão é `seats_per_table`, 9);
    - depois de enviar, mostre um **resumo claro do que foi gravado** ("Enviado: 100 stacks de buy-in padrão · Dia 1B");
    - mensagens de erro de envio **ficam na tela até o usuário fechar**, porque o envio é tudo ou nada.
28. **Saldo físico das fases herdadas** (Dia 2, Dia Final). Causa (`lib/movements.js`, `sessionPlayBalance`): a troca confere as fichas **enviadas para a própria sessão**. Na fase herdada, as fichas chegaram nos sacos das origens e continuam registradas nelas, então o saldo físico é zero. Por isso o Chip Race do Dia Final foi recusado ("Ficha 1000 tem 0 em jogo nesta sessão") apesar de 2.066 fichas de 1.000 no Chip Count.
    - **Solução recomendada:** ao encerrar uma sessão de origem, registrar no livro uma **transferência** do saldo físico em jogo para a fase seguinte (tipo próprio, auditável, visível no Livro), desfeita automaticamente se a sessão for reaberta. Avalie a alternativa (somar as origens na hora da checagem), justifique a escolha e apresente antes de implementar.
    - Vale para Dia 2, Dia Final e fases com entradas próprias (item 17).

## F. Troca (Chip Race e Color Up)

29. **Uma tabela só** (`ChipRace.jsx`): **Ficha | Em jogo | Saída | Entrada**.
    - Só as denominações usadas no torneio (some com 100.000, 250.000 e 500.000 se não estiverem em jogo nem nos modelos).
    - Sem as "pílulas" de "fichas a retirar / a inserir" (a tabela já faz essa seleção).
    - Sem a coluna "saldo físico do fichário" com setas, que vai para os detalhes.
    - Sem textos explicativos.
    - Embaixo: **valor que saiu · valor que entrou · quebra**, e o botão Registrar.
30. **Sai o bloco "Ficha(s) a retirar · ~por mesa"** (o cálculo atual divide a quantidade de cada ficha pelas mesas, o que não é o método usado). Entra o **método real**:
    - o operador escolhe a **ficha que entra** (por exemplo, 5.000 ou 25.000), e o sistema usa as **mesas abertas** do chamado ou um campo de mesas;
    - **valor por mesa** = valor em jogo da ficha que sai ÷ mesas, **arredondado para cima até um múltiplo da ficha que entra**;
    - **quantidade a inserir** = mesas × (valor por mesa ÷ ficha que entra), já preenchida na coluna Entrada;
    - a Saída continua sendo lançada pelo operador: todas as fichas da denominação que sai **mais o complemento em fichas maiores** (1.000, 5.000…), para chegar ao valor de cada mesa.

    Exemplo real que precisa bater:
    - Chip Race de 100: 1.000 × 100 = 100.000 ÷ 36 mesas = 2.778 → **5.000 por mesa** → entram **36 × 5.000** (180.000);
    - Color Up de 500: 372 × 500 = 186.000 ÷ 24 mesas = 7.750 → **25.000 por mesa** → entram **24 × 25.000** (600.000).

## G. Livro do torneio

31. **Uma aba por sessão, como linha do tempo** (`TournamentBook.jsx`, `lib/book.js`). Hoje os dados estão fragmentados em vários blocos (Esperado, Trocas · saiu, Trocas · entrou, Descartes, Em jogo, Contado, Diferença), com colunas de todos os dias, e isso não serve para a operação ao vivo. Em cada aba, linhas = denominações e colunas na ordem dos acontecimentos:
    - **Em jogo** (ações × montagem), ou **Herdado** nas fases de continuação;
    - um par **Saiu / Entrou** para cada troca (Chip Race e Color Up), **quantos forem necessários**: o dia único pode ter muitas trocas;
    - **Descarte**, quando houver;
    - **Saldo em jogo** em quantidade e em valor nominal;
    - **Contado no fim do dia** e **Diferença**, quando houver contagem;
    - rodapé com o valor de cada coluna e a **quebra de cada troca**;
    - resumo no topo: ações (buy-in e reentrada), quanto entrou em jogo, quebra acumulada, saldo e contagem (✓ quando bate).
32. **Correções de cálculo no Livro** (o CSV atual está errado):
    - O **"Esperado"** é reconstruído "desfazendo as trocas" a partir do saldo e erra nas fichas que saíram totalmente (no teste: 9.550.000 no 1A, quando o certo é 9.850.000). O valor de entrada passa a ser **ações × montagem** (9.850.000 / 9.400.000 / 3.100.000 / 4.100.000). Procure outros lugares que usem esse cálculo errado e corrija.
    - A coluna **Total soma o Dia Final (herdado) com as origens** e duplica tudo (Em jogo total 52.902.600, quando o certo é 26.451.300). O total do torneio **nunca** soma o herdado com as origens.
    - O Dia Final não tem "Esperado": começa em "Herdado".
    - Padronize zeros e células vazias.
    - CSV e PDF saem **por aba**, no formato da linha do tempo, e um resumo do torneio traz a conta de fechamento: ações × montagem + quebra acumulada − descartes ± trocas da fase final = saldo final.

---

## H. Testes obrigatórios (cenários reais do usuário)

**Montagem do Warm Up (stack 50.000):** buy-in padrão = 10 × 100 + 4 × 500 + 7 × 1.000 + 8 × 5.000; reentrada = 2 × 25.000.

1. **Warm Up (Dia 1A, 1B, 1C, 1D e Dia Final):**
   - ações: 1A = 100 buy-ins + 97 reentradas; 1B = 120 + 68; 1C = 50 + 12; 1D = 60 + 22 (total 529 × 50.000 = 26.450.000);
   - trocas do 1A:
     - Chip Race 100: saem 1.000 × 100, 28 × 500, 56 × 1.000 e 2 × 5.000; entram 36 × 5.000 (quebra 0);
     - Color Up 500: saem 372 × 500, 21 × 1.000, 23 × 5.000 e 11 × 25.000; entram 24 × 25.000 (quebra +3.000);
   - saldo do 1A = 0 / 0 / 623 / 811 / 207 = **9.853.000**;
   - em jogo das classificatórias = 9.853.000 + 9.397.100 + 3.101.000 + 4.100.200 = **26.451.300** (quebra acumulada 1.300);
   - classificados 1A = 57, 1B = 62, 1C = 16; o Dia Final herda a soma das classificatórias encerradas;
   - **Chip Race no Dia Final precisa passar:** saem 2.066 × 1.000, 267 × 5.000 e 44 × 25.000; entram 180 × 25.000 (quebra −1.000);
   - encerramento do 1B: Jogando = 62, Eliminados = 126;
   - o CSV do Livro tem que bater com esses números, sem duplicar o Dia Final no total;
   - o Tracking de cada sessão encerrada abre pelo menu e pela linha da sessão.
2. **High Roller de dia único:** criado com uma sessão → tipo Dia Único; entradas e reentradas contam nos cards; o Chip Race funciona; eliminações vão até o campeão; nada aparece como "herdado".
3. **High Roller com entradas no Dia 2 / Final:** entradas e reentradas permitidas **até o nível do marcador "Fim do Registro" do template da sessão**; depois disso o registro fecha sozinho e os botões somem; fichas, saldo físico, jogando e Livro somam herdado + entradas da fase corretamente; o Chip Race funciona.
4. **"Jogando" sincronizado:** alterar o Jogando (conferência, eliminação ou entrada) atualiza, **sem recarregar a página**, o relógio, o stack médio, o telão, o Tracking, a tela de um toque, a Logística e o chip da sessão, todos com o mesmo número.

Rode `npm test` no backend e `npm run lint`, `npm test` e `npm run build` no frontend, e deixe tudo passando. Crie testes automatizados para os itens 15, 16, 19, 20, 28, 30 e 32, usando os números acima.

## Fora deste escopo

- Descarte automático (depende do chip count de cada jogador; é funcionalidade futura).
- Recalcular o tempo do relógio quando o servidor cai com ele rodando.
- Publicação no domínio (senhas, HTTPS, backup).
- Qualquer valor em dinheiro.

## Forma de trabalho

1. **Não altere nada antes de apresentar um plano curto:** a ordem das etapas, os arquivos afetados, as migrações e a sua escolha justificada para o item 28. Confirme o item 12 com o usuário. Espere a aprovação.
2. Ordem sugerida, cada etapa funcionando e testada:
   1. **C** (tipos de sessão);
   2. **28** (saldo físico herdado) e **19–21** (eliminação e encerramento);
   3. **E e F** (Material e Troca);
   4. **G** (Livro);
   5. **B** (navegação e Tracking);
   6. **A** (visual enxuto e PWA).
3. Migração com `migrate-mongo` para tipos, campos e índices novos, segura para os dados existentes (inclusive os torneios de teste).
4. Commits pequenos, com mensagens em português.
5. Ao final de cada etapa: o que mudou, como testar no PWA (celular, tablet e desktop) com os cenários da seção H, e o que ficou pendente.
6. Se uma regra estiver ambígua, pergunte em vez de supor.
