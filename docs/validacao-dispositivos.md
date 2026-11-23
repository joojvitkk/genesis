# Roteiro de validação no PWA instalado (celular, tablet, desktop; online e offline)

Cada item marca o que conferir. "Offline" = modo avião depois de abrir a tela uma vez online.
O app é só online: offline **bloqueia lançamentos** e mostra o indicador; não há fila.

## Instalação
- [ ] Android (Chrome) e iOS (Safari → Compartilhar → Adicionar à Tela de Início): o ícone abre em tela cheia (standalone).
- [ ] Desktop (Chrome/Edge): "Instalar GENESIS" abre numa janela própria.
- [ ] Com o app aberto sem rede, a tela de login/shell carrega (pré-cache do service worker).

## Salão agora — `/salao`
- [ ] Cartões das sessões de HOJE (em andamento ou agendadas em até 24 h), ordenados pelo horário; torneios parecidos (nº, TURBO/HYPER, etiqueta de cor) distinguíveis.
- [ ] Cartão do torneio mostra **Chip Count total** (todos os dias), sem stack inicial.
- [ ] Tocar num cartão abre `/salao-sessao/...` já na sessão.

## Salão de um toque — `/salao-sessao/:tid/:sid`
- [ ] Torneio e sessão sempre visíveis; contadores (inscritos, jogando, nível, relógio) atualizam sozinhos.
- [ ] Celular (vertical e horizontal): "+1 entrada / +1 reentrada / −1 eliminação" na barra inferior, ao alcance do polegar; alvos ≥ 44 px.
- [ ] **Toque duplo** rápido em "+1 entrada" grava UMA entrada ("Entrada #n registrada · Dia X").
- [ ] "Desfazer (n s)" cancela na hora; depois dos 8 s vira "Cancelar com motivo".
- [ ] Lote (ex.: 5) e "Conferir jogando" gravam na sessão certa; com outra sessão escolhida no painel, pede confirmação.
- [ ] **Offline:** botões de lançamento desabilitados e indicador "Sem conexão — lançamentos bloqueados"; ao voltar a rede, "Online" e os lançamentos voltam.

## Tracking da sessão — `/tracking-sessao/:tid/:sid`
- [ ] Tablet/desktop: grade completa no formato da folha; horário previsto com `*`; linhas "Fim do registro" e "Fim do dia".
- [ ] Celular: lista compacta, nível atual fixo no topo, cabeçalho recolhível, sem rolagem horizontal.
- [ ] Nível atual atualiza ao vivo; pausar o relógio desloca a previsão dos próximos níveis.
- [ ] **Offline:** mostra o último estado com data/hora ("Sem conexão: mostrando o último estado sincronizado em …").
- [ ] Trocar de usuário (logout/login) não mostra a folha em cache do usuário anterior.
- [ ] PDF / imprimir: A4 retrato com colunas de anotação em branco.

## Material — aba Material e Livro
- [ ] Resumo (No salão · Em jogo (Chip Count) · Disponível em stacks · Pendências) e botões Enviar / Volta de fichas / Troca / Descarte / Conferir.
- [ ] Volta de fichas: sugestão "enviados − usados"; confirmar com um toque devolve os stacks ao fichário.
- [ ] Livro: celular mostra uma sessão por vez; CSV e PDF (A4 deitado) funcionam.
- [ ] Conferência de fim de dia (Ocorrências → Conferência → Fim de dia): sacos × Chip Count e ilha × disponível; só diferença física vira ocorrência.

## Telão — `/torneios/:id/telao`
- [ ] Mostra "Fim do registro … · Fim do dia … (previsto)" quando a estrutura tem essas linhas.
