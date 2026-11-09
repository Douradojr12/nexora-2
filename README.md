# Nexora — Controle Financeiro Pessoal

Sistema web para substituir a planilha de Excel de controle financeiro pessoal.
Construído com **HTML5 + CSS3 + JavaScript puro**, sem frameworks, com os dados
salvos no **localStorage** do navegador.

> **Nota:** o projeto, antes chamado Cofre, agora se chama **Nexora**. As chaves do `localStorage` continuam `cofre:*` de propósito, para não perder nenhum dado já salvo. Veja `PROJECT.md` para o mapa técnico completo.

## Status desta etapa

Esta é a **primeira versão completa** do Nexora: login/cadastro, Dashboard
com indicadores e gráficos, receitas, despesas, parcelas, filtros e uma
página de Relatórios por período.

O que já existe:
- Layout completo do app (barra lateral, topo, cartão de saldo, grade de módulos).
- Sistema de cores, tipografia e componentes (cards, botões, badges).
- Responsividade para computador e celular (menu lateral vira gaveta no mobile).
- Tela de autenticação com login e criação de conta, com validação e
  mensagens de erro amigáveis.
- Sessão local e dados separados por usuário no `localStorage`.
- **Módulo de receitas**, **módulo de despesas** e **módulo de parcelas**
  completos, com adicionar/editar/excluir (parcelas com botão para diminuir
  uma parcela e status "Finalizada" automático).
- **Dashboard completo**:
  - Saudação pelo nome do usuário e cartão de saldo em destaque, com alerta
    visual de déficit quando o saldo fica negativo (sem mudanças na lógica
    de cálculo: saldo continua sendo sempre receitas − despesas).
  - **5 cards de indicadores**: Receitas, Despesas, Saldo, % da renda
    comprometida (despesas ÷ receitas) e Parcelas pendentes.
  - **Resumo financeiro** com uma mensagem inteligente sobre a situação
    atual ("Seu saldo está positivo.", "Suas despesas estão maiores que
    suas receitas." ou um alerta quando as despesas já comprometem 80%+ da
    renda) e uma lista com total recebido, total gasto, saldo, % da renda
    comprometida, maior categoria de gasto e quantidade de despesas.
  - **3 gráficos** (via [Chart.js](https://www.chartjs.org/)): Receitas x despesas (barras), Despesas por categoria (rosca) e
    Evolução do saldo acumulado ao longo das datas lançadas (linha). Todos
    são redesenhados automaticamente sempre que o Dashboard é aberto, já
    refletindo receitas, despesas ou parcelas adicionadas, editadas ou
    excluídas. Cada gráfico mostra uma mensagem de "sem dados" enquanto não
    há lançamentos suficientes para desenhá-lo.
- **Filtros** nas listas de Receitas e Despesas: mês, ano, categoria e busca
  por descrição (Despesas tem também filtro por status — Pago/Pendente).
  Cada lista tem um botão "Limpar filtros", e a mensagem de lista vazia muda
  conforme o caso ("nenhuma receita cadastrada ainda" vs. "nenhum lançamento
  encontrado com esses filtros"). Um filtro por "Receita/despesa" não foi
  necessário porque cada lista já é dedicada a um tipo só.
- **Página de Relatórios**, com seletor de mês/ano (começa sempre no mês
  atual): receitas do mês, despesas do mês, saldo do período, parcelas
  pendentes, detalhe por categoria (com o % de cada uma) e as 5 maiores
  despesas do período. Inclui **3 gráficos de colunas**: receitas x despesas x
  saldo do mês, gastos por categoria e receitas x despesas mês a mês no ano
  escolhido.
- **Módulo de Cartões de crédito** (tudo no `localStorage`, separado por usuário):
  - Cadastro de cartões: nome, instituição/banco, limite total, dia de
    fechamento e dia de vencimento (com editar e excluir).
  - Para cada cartão: limite total, **limite utilizado**, **limite disponível**
    (com barra de uso), **fatura atual** e **próximo vencimento**.
  - Compras no cartão: descrição, valor, data, número de parcelas (1 a 48) e
    categoria. Compras parceladas caem **uma parcela por fatura**, nos meses
    seguintes (a diferença de centavos fica na última parcela).
  - **Faturas**: seletor de cartão e uma linha do tempo com a fatura fechada
    (se ainda não venceu), a atual e as próximas, cada uma com período,
    fechamento, vencimento, total e a lista de compras/parcelas.
  - Regras de calendário: compra feita até o dia de fechamento (inclusive) entra
    na fatura do mês; depois, na do mês seguinte. Se o dia de vencimento é maior
    que o de fechamento, a fatura vence no mesmo mês; senão, no seguinte. Dias
    inexistentes (ex.: 31 em fevereiro) usam o último dia do mês. Fatura com
    vencimento já passado é considerada paga e não pesa no limite.
  - **Integração com o Dashboard**: bloco "Cartões de crédito" com fatura atual,
    limite utilizado/disponível, próximo vencimento e **saldo previsto** (saldo
    menos as próximas faturas).
- Menu lateral com Dashboard, Receitas, Despesas, Parcelas, Cartões e
  Relatórios todos navegáveis; só Configurações segue como "em breve".

> **Despesa registrada x fatura do cartão (sem contar duas vezes).** As compras
> do cartão **não** viram despesas sozinhas: elas formam a fatura e ficam fora do
> saldo. O saldo continua sendo receitas − despesas registradas (+ parcelas em
> andamento da aba Parcelas). Quando você **pagar** a fatura, registre o pagamento
> na aba Despesas (categoria "Cartão"): aí o dinheiro que saiu entra no saldo, e a
> fatura (já vencida) deixa de pesar no limite. Assim a mesma compra nunca é somada
> duas vezes. O "saldo previsto" do Dashboard é só uma estimativa, não altera o saldo.
- **Refinamento visual e de experiência** (sem mexer em cálculos nem na
  estrutura dos dados):
  - Identidade **bordô** (veja "Identidade visual e movimento" abaixo), tipografia
    Fraunces (títulos e valores) + Inter (interface), sombras suaves, raios de borda
    consistentes e transições rápidas.
  - Menu lateral bordô com faixa de seleção que desliza até o item ativo; barra
    superior translúcida (efeito vidro fosco).
  - Cartão de saldo com acabamento premium (muda para tons de tijolo em caso de déficit),
    cards de indicadores que sobem levemente ao passar o mouse e gráficos mais
    limpos (grades suaves, barras arredondadas, rosca com espaçamento).
  - Listas em estilo "extrato bancário", com etiquetas de status coloridas,
    botões de ação discretos e barra de progresso nas parcelas.
  - Formulários e filtros com foco destacado, setas customizadas e filtros em
    formato de pílula (busca com ícone).
  - **Notificações (toasts)** de sucesso/aviso ao salvar, editar, excluir, abater
    parcela, entrar e sair, e **modal de confirmação** no lugar do `confirm()`
    do navegador (Esc, clique fora ou "Cancelar" fecham sem excluir).
  - Estados vazios ilustrados e mensagens de erro com destaque e animação.
  - **Mobile de verdade**: barra de abas fixa na parte de baixo (Painel,
    Receitas, Despesas, Parcelas, Relatórios), cards de indicadores em 2 colunas,
    lançamentos reorganizados para o toque (botões maiores), campos com 16px
    (evita zoom automático no iPhone), modal como "bottom sheet" e respeito à
    área segura dos aparelhos com entalhe.
  - Respeita a preferência do sistema por menos animações.

> **Parcelas contam como despesas.** O valor da parcela de cada compra
> parcelada ainda **em andamento** (aba Parcelas) é somado às despesas: ele entra
> no total de despesas, no saldo, no % da renda comprometida, nos gráficos do
> Painel e nos Relatórios, como uma despesa da categoria "Parcelas" datada de hoje.
> Quando a compra é quitada (0 parcelas restantes), ela deixa de pesar. Isso é
> calculado na hora — os dados salvos continuam com o mesmo formato. Atenção para
> não lançar a mesma compra também na aba Despesas, senão ela conta duas vezes.

O que **ainda não existe** (deixado de fora de propósito):
- Tela de configurações

## Identidade visual e movimento

**Paleta** (tokens no `:root` do `style.css`):

| Uso | Cor |
|---|---|
| Bordô principal (botões, seleção, ícones de destaque, gráficos) | `#641E32` |
| Bordô profundo (menu lateral, cartão de saldo) | `#35121E` |
| Rosa champagne (detalhes, despesas nos gráficos) | `#D5A3B1` |
| Fundo / cards | `#F7F3F4` / `#FFFFFF` |
| Texto principal / secundário | `#292126` / `#827780` |

Verde-sálvia, âmbar e tijolo existem só para **significado** (positivo/receita, alerta/pendente,
negativo/despesa) — nunca como cor da marca. Assim "Pago", "Pendente" e saldo negativo continuam
inconfundíveis. Rótulos de apoio usam um tom um pouco mais escuro (`--ink-soft`) que o texto
secundário, para manter o contraste legível.

**Animações** (só `transform`/`opacity`, curtas e sem repetição contínua):
- Menu lateral e abas do celular: uma faixa de seleção desliza até o item ativo, o ícone faz um
  pequeno movimento e o item muda de cor suavemente.
- Cada tela entra com deslocamento + fade; no Painel (e nas demais telas) os cards entram de baixo
  para cima em sequência (≈ 70 ms entre eles) e depois ficam livres para o efeito de hover.
- Valores do Painel contam suavemente (~0,7 s) ao abrir a tela. O cálculo real não muda nem é
  atrasado: a contagem só afeta o que aparece, termina sempre no mesmo texto formatado em R$ e o valor
  exato fica em `data-valor`.
- Gráficos entram com animação curta, barra a barra; o aviso "Gráfico indisponível" aparece se o
  Chart.js não carregar.
- Modal de confirmação: fundo escurece, o cartão entra com fade + leve zoom e sai no sentido inverso
  (no celular vira um painel que sobe da base). Clique duplo em "Excluir" não apaga duas vezes.
- Formulário em modo de edição ganha um realce e o selo "Editando"; mensagens de erro tremem de leve.
- Botões: elevação no hover, "ondinha" no clique e ícone "+" que gira nos botões de adicionar;
  notificações têm uma barra de tempo; uma barrinha fina no topo indica a troca de tela.

**Acessibilidade e desempenho:** com `prefers-reduced-motion` ligado no sistema, nada é animado
(valores aparecem direto, gráficos sem animação, modal fecha na hora). O item ativo do menu recebe
`aria-current="page"`. No celular os deslocamentos são menores e nada é cortado.

> Observação: os formulários de cadastro/edição são cartões dentro da própria página (não modais).
> O efeito de fade + zoom foi aplicado ao modal de confirmação; transformar os formulários em modais
> seria uma mudança de layout à parte.

## Gráficos (Chart.js) e funcionamento offline

Os gráficos usam o [Chart.js](https://www.chartjs.org/) 4.x. O `index.html` tenta carregar a
biblioteca de vários servidores, em ordem, até um funcionar: cdnjs (4.5.1) → jsDelivr (4.5.1) → cdnjs
(4.4.1) → unpkg (4.5.1) → arquivo local `vendor/chart.umd.js`. Enquanto baixa, os gráficos mostram um
"carregando" e são desenhados sozinhos assim que a biblioteca chega. Se nenhum servidor responder, cada
gráfico mostra um aviso, e o resto do sistema continua funcionando normalmente.

**Para usar 100% offline** (ou se sua rede bloquear CDNs): baixe
`https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.js`, salve em
`controle-financeiro/vendor/chart.umd.js` e pronto — o sistema usa esse arquivo como último recurso.

> Histórico: a versão anterior apontava para o Chart.js **4.4.4 do cdnjs, que não existe** (o cdnjs
> publica 4.4.1 e 4.5.0+), por isso os gráficos não apareciam. Isso foi corrigido.

## Mercado Financeiro

Nova página no menu (e resumo no Dashboard) com moedas e conversor, bolsa, criptomoedas e simulador de
rendimentos. Código em `mercado.js` e `mercado.css`; usa os componentes do Nexora (gráficos, avisos,
formatação, animações). **Nenhum dado pessoal (receitas, despesas, usuário) é enviado às fontes** —
são consultas GET públicas, sem cookies.

| Módulo | Fonte (endpoint) | Chave? | Observações |
|---|---|---|---|
| Dólar e Euro | AwesomeAPI `economia.awesomeapi.com.br/json/last/USD-BRL,EUR-BRL` e `json/daily/PAR/30` | não | `bid` = cotação; mostra `pctChange` e o `timestamp` da fonte |
| Criptomoedas | CoinGecko `api.coingecko.com/api/v3/simple/price` e `coins/{id}/market_chart` (reserva: AwesomeAPI BTC/ETH-BRL) | não usada | sem chave a CoinGecko limita por IP e pode bloquear por CORS; por isso há reserva |
| Ações | brapi `brapi.dev/api/v2/stocks/quote` e `historical` | não usada | sem chave só PETR4, VALE3, ITUB4 e MGLU3; 1 ticker por chamada; atraso de ~30 min |
| Ibovespa (`^BVSP`) | brapi via **seu proxy** | **sim (no proxy)** | exige chave; chave não pode ficar no navegador |

**Cache e atualização:** cotações ficam no `localStorage` (`cofre:mercado:v1`, compartilhado, sem dados pessoais).
Validade: câmbio 2 min, cripto 3 min, bolsa 15 min, históricos 30 min. A atualização automática só roda com
a aba visível e apenas no Painel ou no Mercado Financeiro; após falhas o intervalo aumenta (backoff). O botão
"Atualizar" tem espera de 15 s entre cliques.

**Falhas:** a última cotação válida é preservada e marcada como "Desatualizado" (com a hora da última consulta);
nunca aparece zero ou valor inventado. Sem dados anteriores, aparece "Indisponível" e o botão "Tentar novamente".
A tela distingue o horário da **cotação** (informado pela fonte, em Brasília) do horário da **consulta**.

**Simulador:** aportes no fim de cada mês, `saldo = saldo anterior × (1 + taxa/100) + aporte`; com taxa 0 o saldo
final é exatamente o inicial mais os aportes. Três cenários com taxas editáveis (padrões hipotéticos 0,50 /
0,80 / 1,20 % ao mês), prazo de 1 mês a 50 anos, gráfico e tabela mensal/anual. Resultados **brutos e nominais**
(sem impostos, taxas ou inflação) e **não são garantia de rendimento**.

### Ativar o Ibovespa (configuração externa)
1. Crie uma conta gratuita na brapi e copie seu token.
2. Crie um Cloudflare Worker com o conteúdo de `serverless/brapi-proxy.js`.
3. No Worker, crie o **segredo** `BRAPI_TOKEN` e a variável `ALLOWED_ORIGINS` (endereços do seu site, separados
   por vírgula; para testar abrindo o arquivo do disco inclua também `null`).
4. Cole a URL do Worker em `MercadoConfig.proxyBrapi` no início de `mercado.js`.

Nunca coloque o token em `mercado.js` nem em arquivo algum do site/repositório. Com o proxy, a lista passa a
incluir o Ibovespa e mais ações (consumo estimado: ~7 chamadas a cada 15 min com a página aberta).

> O que **não** foi possível verificar: as APIs reais não foram chamadas durante o desenvolvimento (sem acesso à
> internet no ambiente). Endpoints e campos foram conferidos nas documentações oficiais e testados com respostas
> simuladas nesse formato. Pontos a confirmar no seu navegador: se cada fonte libera CORS para o seu endereço
> (inclusive abrindo o `index.html` do disco) e se os limites gratuitos atuais atendem ao seu uso.

## Despesas: botão "Já paguei"

Cada despesa pendente tem o botão **Já paguei**. Ele aproveita os campos que já existiam (`status`,
`totalParcelas`, `parcelasRestantes`) e só acrescenta o histórico `pagamentos` (data, parcela e valor de cada pagamento).

- **Parcela única:** o clique marca como **Pago** (restantes = 0) e ela sai de "Pendentes", mas continua na lista e
  no histórico.
- **Parcelada:** cada clique registra **uma** parcela e diminui 1 de `parcelasRestantes` (12 → 11 → …). Na última,
  a despesa vira **Quitado**. O valor original da compra (`valor`, o **total**) nunca muda; cada parcela é
  `valor ÷ parcelas`, em centavos (100 em 3x = 33,33 + 33,33 + 33,34).
- **Sem duplicidade:** clique/toque duplo na mesma despesa (< 0,8 s) conta uma vez só; o botão não existe em despesa quitada.
- **Totais:** continuam contando cada despesa **uma vez**, com o valor cheio, na data lançada — pagar não soma nem
  subtrai nada. "A pagar" e "Já pago" (resumo da tela) sempre somam o valor lançado.
- **Desfazer:** o aviso "Pagamento registrado" tem o botão *Desfazer*, e o histórico de cada despesa tem
  "Desfazer último pagamento" (com confirmação).
- **Visões:** Pendentes · Pagas · Todas (sincronizadas com o filtro de status). Dados antigos continuam
  funcionando (a parcela é deduzida de `totalParcelas − parcelasRestantes`).

## Revelação por rolagem

Os cartões de cada tela aparecem ao entrar na área visível (de baixo para cima; de cima para baixo ao rolar para cima), em cascata, com um único `IntersectionObserver` e só `transform`/`opacity`. Gráficos e indicadores perdem opacidade aos poucos ao sair pelo topo (nunca abaixo de 40%) e voltam ao subir. Respeita `prefers-reduced-motion` e navegadores sem `IntersectionObserver` (nesses casos nada fica escondido). Código: objeto `Reveal` em `script.js` e regras `rv-*` no fim do `style.css`.

## Nexora AI

Menu **Nexora AI** (e atalho no Painel). Responde perguntas sobre gastos do mês, categorias, quanto sobrou, aumentos entre meses, parcelas e vencimentos, organização, cotações já guardadas, juros compostos e renda fixa × variável — **por regras, com os seus dados reais** (mesmos números do Painel e dos Relatórios). Não é um modelo generativo e não inventa valores: sem dados, ela avisa. A conversa não é salva. A IA generativa existe só como arquitetura (desligada); veja `PROJECT.md`.

## Estrutura de arquivos

```text
controle-financeiro/
├── index.html   → estrutura da página (sidebar, topo, cartão de saldo, módulos)
├── style.css    → design system (cores, tipografia, layout, responsividade)
├── script.js    → camada de dados (localStorage) + interações da interface
├── mercado.js   → módulo Mercado Financeiro (APIs, cache, conversor, simulador)
├── mercado.css  → estilos do Mercado Financeiro
├── nexora-ai.js → Nexora AI (análise local + camada para IA generativa futura)
├── nexora-ai.css→ estilos da Nexora AI
├── serverless/
│   └── brapi-proxy.js → proxy OPCIONAL para o Ibovespa (guarda o token no servidor)
└── README.md    → este arquivo
```

## Como abrir no Visual Studio Code

1. Extraia/coloque a pasta `controle-financeiro` em algum lugar do seu computador.
2. Abra o VS Code.
3. Vá em **Arquivo → Abrir Pasta...** (*File → Open Folder...*) e selecione a
   pasta `controle-financeiro`.
4. Instale a extensão **Live Server** (de Ritwick Dey), disponível na aba de
   Extensões do VS Code (ícone de quadrados no menu lateral, busque por
   "Live Server").
5. Com o arquivo `index.html` aberto, clique com o botão direito nele e escolha
   **"Open with Live Server"** (ou clique em "Go Live" no canto inferior direito
   da janela).
6. O navegador vai abrir automaticamente em algo como
   `http://127.0.0.1:5500/index.html`, já com o app funcionando.

> Também é possível simplesmente abrir o `index.html` direto no navegador
> (duplo clique no arquivo), mas o Live Server é recomendado porque recarrega
> a página sozinho a cada alteração salva no código.

## Como os dados são guardados

O `localStorage` deste navegador passa a ter três tipos de chave:

- `cofre:usuarios` — lista de todas as contas cadastradas (nome, e-mail e
  senha ofuscada por um hash simples, sem texto puro).
- `cofre:sessao` — guarda apenas o id de quem está logado agora, para o app
  lembrar a sessão se a página for recarregada.
- `cofre:dados:<idDoUsuario>` — os dados financeiros **daquele usuário**,
  no mesmo formato de antes:

```json
{
  "versao": 1,
  "criadoEm": "2026-08-31T12:00:00.000Z",
  "receitas": [
    {
      "id": "r...",
      "descricao": "Salário de agosto",
      "valor": 3500,
      "data": "2026-08-05",
      "categoria": "Salário"
    }
  ],
  "despesas": [
    {
      "id": "d...",
      "descricao": "Conta de energia",
      "valor": 210,
      "data": "2026-08-10",
      "categoria": "Moradia",
      "formaPagamento": "PIX",
      "status": "Pago",
      "fixa": true,
      "totalParcelas": 1,
      "parcelasRestantes": 1
    }
  ],
  "parcelas": [
    {
      "id": "p...",
      "descricao": "Celular",
      "valorParcela": 200,
      "totalParcelas": 12,
      "parcelasRestantes": 8
    }
  ],
  "cartoes": [
    {
      "id": "c...",
      "nome": "Nubank Platinum",
      "banco": "Nubank",
      "limite": 5000,
      "diaFechamento": 25,
      "diaVencimento": 5
    }
  ],
  "comprasCartao": [
    {
      "id": "k...",
      "cartaoId": "c...",
      "descricao": "Notebook",
      "valor": 1200,
      "data": "2026-10-02",
      "parcelas": 6,
      "categoria": "Compras"
    }
  ]
}
```

O "Finalizada" da página de Parcelas não fica salvo como campo — ele é
sempre calculado na hora, comparando `parcelasRestantes` com zero. O mesmo vale
para os cartões: faturas, limite utilizado/disponível e vencimentos são
calculados na hora a partir de `cartoes` e `comprasCartao` — não são gravados.

Ou seja, cada conta criada ganha seu próprio "cofre" isolado — os
lançamentos de um usuário nunca aparecem para outro.

Isso significa que os dados são salvos **apenas neste navegador, neste
computador** — não há servidor nem banco de dados nesta etapa. Se limpar os
dados do navegador, todas as contas e o histórico salvo são perdidos.

> **Sobre a senha:** como ainda não existe servidor, a senha é apenas
> ofuscada por um hash simples antes de ser salva — isso não é segurança de
> verdade. Quando o projeto ganhar um back-end, a validação de senha deve
> passar a acontecer lá (com uma biblioteca própria para isso, como bcrypt).

## Próximos passos sugeridos

1. Tela de **configurações** (ex.: editar nome/e-mail, trocar senha, excluir conta).
2. Se um dia o projeto ganhar um back-end: mover a validação de senha para
   lá e parar de guardar até o hash dela no `localStorage`.

Cada etapa deve manter o app funcionando de ponta a ponta antes de avançar
para a próxima.
