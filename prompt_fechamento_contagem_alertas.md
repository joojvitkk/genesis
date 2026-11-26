# Prompt — Gênesis: troca completa, fim do torneio com conferência, contagem de jogadores, Tracking das continuações e chat urgente

## Papel e contexto

Você vai evoluir o **Gênesis**, a cópia local mais recente do projeto (a partir do commit `c0f2b06` e das alterações ainda não commitadas na pasta). É um sistema web de logística de fichas para torneios de pôquer ao vivo: frontend em React 19 + Vite (PWA) e backend em Node.js 22 + Express + Mongoose (MongoDB em replica set) + Socket.IO.

Antes de começar, leia `CLAUDE.md`, `DESIGN_SYSTEM.md` e o `README.md` e siga as regras deles:
- **Nada que envolva dinheiro.** Os valores são sempre o **valor nominal das fichas**.
- O livro de movimentos (`Movement`) é **imutável**: correção é feita por estorno ou por um novo lançamento com motivo.
- Toda operação é feita **por sessão** (`session_id`).
- **Modo enxuto:** sem textos explicativos na tela. Quem usa é profissional de pôquer e precisa bater o olho e entender.
- Telas pensadas para o **PWA** (celular, tablet e desktop).

O usuário testou o sistema operando Salão e Material de verdade, em vários aparelhos. Cada item diz o problema, a causa encontrada no código (quando houver) e o resultado esperado. **O que já funciona não deve mudar**: Tracking (relógio, previsão, conferência), Livro por sessão, Chip Race nas fases herdadas, tabela por ação no Material e navegação por endereço.

---

## A. Troca (Chip Race e Color Up) — `frontend/src/pages/ChipRace.jsx`, `backend/lib/material.js`

1. **Levado, Entrada e Voltou.** Na prática, o Material leva fichas a mais para a troca, e nem tudo é inserido. Exemplo real: levaram **100 fichas de 100.000**, **61 entraram** no jogo e **39 voltaram** ao fichário. Hoje a tabela só tem Saída e Entrada, e não há onde lançar as 39: a Saída fica bloqueada para fichas com 0 em jogo, e a "Volta de fichas" recusa porque, para o livro, elas nunca entraram no salão.
   - Na linha de cada ficha que entra, um campo **"Levado"** ao lado da **"Entrada"**. **"Voltou" = levado − entrada** é calculado e exibido.
   - No livro de movimentos, **só a Entrada (61) entra em jogo**. As 39 foram e voltaram, e o saldo do fichário não muda por elas.
   - Mesmo assim, **levado, entrada e voltou ficam gravados na troca** (por exemplo, em `Conversion` ou em `meta`) e aparecem no **histórico da troca** ("levou 100 · inseriu 61 · voltou 39"). Isso é usado como métrica do trabalho de cada operador.
   - Validação: levado ≥ entrada; levado ≤ saldo do fichário.
   - O mesmo vale para a Saída, se o operador quiser registrar o que foi recolhido da mesa e o que voltou para a mesa. Avalie se é necessário e proponha antes de implementar.
2. **Campos sempre abertos.** O cálculo pelas mesas (`setIns` com `r.quantity_in`) **só sugere**: ele preenche apenas campos vazios e **nunca sobrescreve** um número que o operador digitou, inclusive quando a ficha, a quantidade de mesas ou a sessão mudam.

## B. Visual

3. **Legendas que sobraram** no quadro "Fichas em jogo · Chip Count consolidado" (`MaterialPanel.jsx`):
   - sai o texto "Posição atual herdada das sessões anteriores, já com Chip Race, Color Up e descartes. Esta fase não recebe nova distribuição inicial.";
   - o aviso amarelo "Sem contagem de fim de dia em Dia 1A…: esta fase herda a composição calculada." vira uma **etiqueta curta**, "sem contagem de fim de dia", com os dias num tooltip.
   - Faça uma varredura final por outros textos explicativos que restaram.

## C. Fim do torneio: recolhimento, conferência e aprovação

Hoje, no Dia Final, o painel do Material **esconde** Enviar, Volta de fichas e Descarte (`!isFinalPhase` em `MaterialPanel.jsx`), e a única saída de fichas possível é uma troca, que exige uma entrada para justificar. Além disso, **"Finalizar" libera os fichários na hora** (`allocationLib.releaseForTournament`), e as fichas ainda em jogo ficam presas no livro, sem fichário de destino. No teste, o torneio ficou **finalizado**, mas o **Dia Final continuou "Em andamento"**, com o botão "Encerrar sessão" visível. E **não existe "Reabrir torneio"**: o único caminho que desfaz uma finalização é cancelar a eliminação do campeão.

4. **Recolhimento final** na última sessão (Dia Final ou Dia Único):
   - uma ação **"Recolhimento final"** no Material, já preenchida com o **Chip Count por denominação** (no teste: 3 × 100, 118 × 25.000, 160 × 100.000 e 15 × 500.000 = 26.450.300);
   - o operador ajusta cada linha para o que foi **contado** e escolhe o fichário de destino (o vinculado, como padrão);
   - o sistema devolve tudo ao fichário (play → binder) num lote único;
   - **diferenças entre o contado e o Chip Count viram ocorrência**, com a denominação, a quantidade e o valor nominal;
   - depois do recolhimento, o saldo "em jogo" do torneio fica **zero**, a menos das diferenças registradas.
5. **Finalizar vira uma conferência final com aprovação**, e não só uma liberação. O botão "Finalizar" abre um checklist:
   1. todas as sessões encerradas;
   2. recolhimento final feito, com saldo em jogo zero ou diferenças registradas como ocorrência;
   3. **conferência das fichas pelo Material:** o responsável do Material confirma a contagem;
   4. **aprovação do Material e/ou do Admin** (o "alvará"): registrada com usuário, data e hora, e visível na auditoria e no fechamento do torneio.

   Só depois da aprovação os fichários são liberados e o torneio fica finalizado. **Finalizar sempre encerra as sessões junto**: nunca pode sobrar uma sessão "em andamento" num torneio finalizado. Defina e confirme com o usuário quem pode conferir e quem pode aprovar (sugestão: o Material confere, e o Material ou o Admin aprova).
6. **"Reabrir torneio"**, só para o admin, com **motivo obrigatório** e registro na auditoria:
   - vincula de novo os fichários que estavam vinculados;
   - reabre a última sessão;
   - desfaz a aprovação (que precisa ser feita de novo ao finalizar);
   - mantém o recolhimento como histórico. Se for preciso desfazê-lo, use um estorno explícito, nunca uma remoção.

   O torneio de teste do usuário (Warm Up), hoje travado em "Torneio finalizado – auditoria apenas", precisa poder ser reaberto por esse caminho.
7. **A finalização automática do campeão** (no Dia Único, quando sobra 1 jogador, na rota `POST /tournaments/:id/eliminations`) hoje também finaliza o torneio, encerra as sessões e **libera os fichários na hora**. Ela passa a só **marcar o campeão e encerrar a sessão**. O recolhimento, a conferência e a aprovação (itens 4 e 5) continuam obrigatórios antes de finalizar. O código remanescente de "prêmios por colocação" deve ser removido, se ainda existir.

## D. Acesso dos usuários aos torneios

Problema real: usuários de Salão e de Material entraram pelo tablet e pelo celular e **não viram nenhum torneio**. Ao editar o usuário, aparece "Torneio não encontrado na lista de acesso". Causa: `allowed_tournament_ids` ainda guarda **torneios apagados** em testes anteriores (eles são excluídos de forma lógica, com `softDelete`). A tela de edição mostra só os torneios atuais, mas **envia também os identificadores antigos escondidos**, e `normalizeScope` (`routes/index.js`) recusa. A listagem filtra pelos identificadores antigos e fica vazia.

8. Ao **apagar um torneio**, ele sai automaticamente da lista de acesso de todos os usuários. Inclua uma migração que limpe as listas atuais.
9. O servidor **ignora** (e remove) identificadores de torneios que não existem mais, em vez de recusar o salvamento. A tela (`Usuarios.jsx`) envia **só os torneios marcados que existem**.
10. Opção **"Todos os torneios (inclusive os futuros)"** na edição do usuário. Ela corresponde à lista vazia (sem restrição), que hoje não é explícita na tela. Usuários com restrição continuam vendo só os marcados.
11. O card do usuário mostra **quais torneios** ele pode acessar (ou "Todos").

## E. Contagem de jogadores (regra do evento)

Problema real: com **27 entradas iniciais e 10 reentradas**, o sistema mostrou **Jogando 37** e Eliminados 0. Reentrada é **o mesmo jogador** voltando depois de ser eliminado, não um jogador novo. O certo é **Jogando 27, Eliminados 10, Inscrições 37**.

Como o floor trabalha: **aperta só "+1 reentrada"** quando o jogador cai e volta. **Eliminações só são contadas depois do fim do registro** (ou a partir do momento em que não é mais possível fazer entradas no torneio).

12. **"+1 reentrada" registra sozinha a eliminação daquela ação** (uma eliminação embutida). O "Jogando" não muda. Desfazer ou cancelar a reentrada também desfaz a eliminação embutida.
13. **Enquanto o registro está aberto**, o botão **"−1 eliminação" fica escondido** na tela de um toque (`SalaoSessao.jsx`) e na Logística. Quem cai e não volta entra pela **conferência do floor**, que fica sempre disponível.
14. **Depois do fim do registro** (marcador "Fim do Registro" da estrutura da sessão, nível de fechamento configurado ou fechamento manual da sessão, o que vier primeiro):
    - "+1 entrada" e "+1 reentrada" somem;
    - **"−1 eliminação" aparece**; cada toque diminui o "Jogando" e registra a colocação.
15. **Lembrete de conferência no fim do registro:** quando o registro fechar, a tela de um toque mostra **"Registro encerrado · conferir jogando"** até o floor fazer a conferência. Como as eliminações não são contadas durante o registro, essa é a primeira contagem confiável.
16. **Contas iguais em todas as telas** (cards da Logística e do Salão, tela de um toque, relógio, telão, Tracking, chip da sessão):
    - **Inscrições** = entradas iniciais + reentradas (ações);
    - **Jogando** = entradas iniciais − eliminações depois do registro, ajustado pela conferência do floor (nas fases de continuação: classificados − descartes + entradas da fase − eliminações da fase, ajustado pela conferência);
    - **Eliminados** = inscrições − jogando (em ações), coerente com a regra do encerramento (inscrições − classificados);
    - **Stack médio** = fichas em jogo ÷ jogando.
    - Revise `backend/lib/headcount.js` (`countsFor`, `playerCounts`, `refreshPlayers`) e todos os consumidores.
17. Vale para classificatórias, Dia Único e fases de continuação com entradas abertas (High Rollers), sempre respeitando o fim do registro de cada sessão.

## F. Tracking das fases de continuação — `backend/lib/tracking.js`, `backend/lib/levelLog.js`, `TrackingSessao.jsx`

18. **O primeiro nível de cada fase de continuação** (Dia 2, Dia 3, Dia Final) começa obrigatoriamente com os **classificados** em "Jogando" (no teste, **161**). A conferência do floor aparece separada na coluna Conferência (**127 (−34)**). Hoje a primeira linha mostra 127 em "Jogando", que é o valor depois da conferência. Cada nível seguinte começa com o "Jogando" do fim do nível anterior.
19. **Descartes de classificados repetidos, só no primeiro dia de continuação** (Dia 2): um campo **"Descartes"**, para os jogadores que se classificaram em mais de um Dia 1 e seguem só com o maior stack.
    - Jogando inicial = **classificados − descartes** (por exemplo, 161 − 3 = 158).
    - **Dia 3 em diante e Dia Final não têm esse campo.**
    - O descarte das **fichas** desses stacks continua manual no Material, como já existe.
    - Registro com autor, horário e motivo; aparece no Tracking e no fechamento.
20. **"Inscritos" nas fases de continuação calculado na hora da exibição**: acumulado do torneio (por exemplo, 529) + entradas da própria fase até aquele nível. Hoje os níveis gravados antes da última atualização mostram 0, e os seguintes mostram 529. Crie uma **migração** que corrija os registros antigos com uma nota de correção (o registro original fica preservado em `corrections`).
21. **Duração real nos níveis já jogados.** Hoje os níveis 26, 27 e 28 aparecem todos às 19:34 com "30 min". Nos níveis jogados, mostre a duração real (início → fim, descontando as pausas). A duração planejada fica só nos níveis que ainda vão acontecer.

## G. Chat urgente

Hoje o aviso de mensagem urgente **só existe dentro da tela do Chat** (`Chat.jsx`): em qualquer outra tela, a mensagem chega sem nenhum sinal. Também não há som para o chat. O "visto" de urgentes (`urgentAck`) já existe no backend.

22. **Faixa de alerta global** (no nível do `App.jsx`, em todas as telas):
    - uma **faixa fina vermelha fixa no topo**: "Urgente · Salão → Material: Falta ficha de 5.000 na mesa 12 · **Atendido**";
    - não cobre a tela nem bloqueia o uso;
    - **fica até alguém do setor de destino tocar em "Atendido"**; se o canal for geral, até qualquer pessoa atender;
    - com várias urgentes, mostra "3 urgentes" e abre a lista compacta ao tocar;
    - funciona no celular, no tablet e no desktop, inclusive na tela de um toque e no telão (no telão, só um indicador discreto, sem o texto da mensagem).
23. **Som e vibração:**
    - um bipe curto quando a mensagem chega (reaproveite `lib/beep.js`) e **um lembrete a cada 2 minutos** enquanto ela não for atendida;
    - **vibração** no PWA (`navigator.vibrate`), quando o aparelho permitir;
    - botão de **silenciar por aparelho** (guardado localmente).
    - Lembre que o navegador só libera som depois da primeira interação com a página; trate isso sem erros.
24. **Quem enviou vê o andamento** ("Atendido por Leferson às 21:14"), e o atendimento fica no histórico do chat.
25. **Mensagens normais:** sem som e sem faixa, só um **número de não lidas** no ícone do Chat (menu lateral e barra de baixo).

## H. Relatórios

26. **Métrica por operador** em Relatórios: por pessoa e por período, a quantidade de trocas, as fichas **levadas, inseridas e devolvidas** (item 1), os recolhimentos e as conferências. Sem valores em dinheiro.

## I. Acesso pela rede local (etapa opcional, confirme com o usuário)

27. O usuário acessou pela rede local, em `http://192.168.3.97:5174`, sem HTTPS. Nessa condição, o navegador **não instala o PWA, não ativa o modo offline (service worker) e restringe notificações e alguns recursos**. Proponha uma forma de rodar com **HTTPS na rede do evento** (por exemplo, um certificado local para o servidor, documentado no README) ou confirme que isso fica para a publicação no domínio. **Não implemente sem a confirmação do usuário.**

---

## Testes obrigatórios

1. **Reentrada:** 27 entradas e 10 reentradas com o registro aberto → Jogando 27, Eliminados 10, Inscrições 37, stack médio dividido por 27. O botão "−1 eliminação" fica escondido. Desfazer uma reentrada desfaz a eliminação embutida. Depois do fim do registro, aparecem "−1 eliminação" e o lembrete de conferência.
2. **Troca com levado:** levado 100 × 100.000, entrada 61 → voltou 39. No livro, só 61 entram em jogo. O histórico mostra os três números. O cálculo pelas mesas não sobrescreve o que foi digitado.
3. **Fim do torneio (Warm Up):** recolhimento de 3 × 100, 118 × 25.000, 160 × 100.000 e 15 × 500.000 (26.450.300), com uma diferença de teste que vira ocorrência → conferência do Material → aprovação → finalizado, com as sessões encerradas e os fichários liberados. **Reabrir** (admin, com motivo) → fichários vinculados de novo, última sessão aberta, aprovação desfeita, saldo coerente.
4. **Dia Único:** a eliminação até o campeão não libera os fichários; o recolhimento, a conferência e a aprovação continuam obrigatórios.
5. **Dia 2 com descartes:** 161 classificados − 3 descartes = 158 no primeiro nível do Tracking; o Dia Final não tem o campo de descartes.
6. **Tracking:** "Inscritos" coerente em todos os níveis das fases de continuação (inclusive nos registros antigos, depois da migração); duração real nos níveis jogados.
7. **Usuários:** um usuário com torneios apagados na lista consegue ser salvo; Salão e Material entram pelo tablet e pelo celular e veem os torneios certos; a opção "Todos os torneios" mostra também um torneio criado depois.
8. **Chat urgente:** uma mensagem urgente do Salão para o Material aparece na faixa em qualquer tela do Material, toca e vibra, lembra a cada 2 minutos e some só depois de "Atendido"; quem enviou vê quem atendeu e quando.

Rode `npm test` no backend e `npm run lint`, `npm test` e `npm run build` no frontend, e deixe tudo passando. Crie testes automatizados para os itens 1, 4–7, 9, 12–16, 18–20 e 22.

## Fora deste escopo

- Notificações push com o app fechado (fica para depois da publicação no domínio).
- Descarte automático de fichas (depende do chip count de cada jogador).
- Recalcular o tempo do relógio quando o servidor cai com ele rodando.
- Qualquer valor em dinheiro.

## Forma de trabalho

1. **Não altere nada antes de apresentar um plano curto:** ordem das etapas, arquivos afetados, migrações e as decisões em aberto:
   - quem confere e quem aprova a finalização (item 5);
   - "Levado" também na Saída (item 1);
   - a etapa opcional de HTTPS na rede local (item 27).

   Espere a aprovação.
2. Ordem sugerida, cada etapa funcionando e testada:
   1. **D** (acesso dos usuários, que hoje bloqueia o teste em aparelhos);
   2. **E** (contagem de jogadores);
   3. **C** (fim do torneio e reabertura, para destravar o Warm Up);
   4. **A** (troca);
   5. **F** (Tracking);
   6. **G** (chat urgente);
   7. **B e H** (visual e relatórios);
   8. **I**, se aprovada.
3. Migração com `migrate-mongo` para os campos e coleções novos e para a limpeza das listas de acesso, segura para os dados existentes.
4. Commits pequenos, com mensagens em português.
5. Ao final de cada etapa: o que mudou, como testar no PWA (celular, tablet e desktop, com usuários de Salão, Material e Admin) e o que ficou pendente.
6. Se uma regra estiver ambígua, pergunte em vez de supor.
