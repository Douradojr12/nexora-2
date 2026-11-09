# PROJECT.md — Nexora (evolução do Cofre)

> Documento de retomada. Descreve o que **realmente existe** no código. Atualize ao fim de cada bloco.
> Última atualização: Fase 1 + Fase 2 (marca Nexora, base grafite, revelação por rolagem) + Fase 3 (Nexora AI local).

## 1. Como executar
- Sem build: abra a pasta no VS Code e use **Live Server** no `index.html` (ou hospede em `https`). Abrir o arquivo direto do disco funciona, mas algumas fontes de cotação podem recusar chamadas (CORS — não verificado).
- Dependências externas (todas opcionais para o uso básico): Google Fonts (Fraunces/Inter); Chart.js carregado por CDN com servidores reserva (`index.html`, aviso "Gráfico indisponível" se falhar); APIs públicas de mercado (só na página Mercado/Painel).
- Backup do estado anterior à Nexora: `cofre-backup-pre-nexora.zip` (todos os arquivos antes do bloco 1).

## 2. Arquivos
| Arquivo | Papel |
|---|---|
| `index.html` | Telas (login, painel, receitas, despesas, parcelas, cartões, relatórios, mercado), menu, modal, toasts |
| `style.css` | Tokens + camadas de estilo (cresceu em camadas; ver "Problemas conhecidos") |
| `script.js` | Dados, autenticação, módulos, UI, gráficos do painel, navegação |
| `mercado.js` / `mercado.css` | Módulo independente de Mercado Financeiro (APIs, cache, conversor, simulador) |
| `nexora-ai.js` / `nexora-ai.css` | Nexora AI: análise local por regras, camada de serviço/provedores, interface de chat |
| `serverless/brapi-proxy.js` | Proxy **opcional** (Cloudflare Worker) para o Ibovespa; guarda o token no servidor |
| `README.md` | Documentação por funcionalidade |

## 3. Arquitetura (script.js)
Objetos globais (sem módulos ES): `Storage`, `Auth`, `Formato`, `Movimento` (reduced-motion), `State`, `Receitas`, `Despesas`, `Parcelas`, `Cartoes`, `Graficos`, `Toast`, `Modal`, `UI`, `MenuMobile`. Navegação: `UI.irPara(view)` alterna `#view-<nome>` (SPA, sem recarregar). `UI.renderX()` redesenha cada tela a partir de `State.dados`.
Nexora AI: `NexoraIA` (interface), `NexoraIAServico` + `ProvedorLocal`/`ProvedorGenerativo` (camada trocável), `IAAnalise` (regras), `IADados` (leitura dos cálculos existentes), `IAUtil`, `NexoraIAConfig`.
Mercado: `Mercado`, `MercadoApi`, `MercadoFontes`, `MercadoCache`, `MercadoSimulador`, `MercadoFmt` (inicia sozinho e observa a troca de telas).

**Dados (localStorage, chaves mantidas como `cofre:*` — NÃO renomear sem migração):**
- `cofre:usuarios` (contas; senha com hash simples), `cofre:sessao` (id logado)
- `cofre:dados:<idUsuario>`: `{ receitas[], despesas[], parcelas[], cartoes[], comprasCartao[] }`
  - despesa: `valor` (total da compra), `status` Pago/Pendente, `totalParcelas`, `parcelasRestantes`, `pagamentos[]` (histórico do "Já paguei")
- `cofre:mercado:v1`: cache público de cotações (sem dados pessoais)

## 4. Funcionalidades implementadas
Login/cadastro/logout · Painel (saldo, indicadores, resumo inteligente, gráficos, cartões, mercado) · Receitas e Despesas (CRUD, filtros por mês/ano/categoria/status/busca) · **Já paguei** (única e parcelada, histórico, desfazer, A pagar/Já pago) · Parcelas (abater, finalizada) · Cartões (limites, faturas por fechamento/vencimento, compras parceladas) · Relatórios por mês/ano (3 gráficos de colunas) · Mercado Financeiro (USD, EUR, BTC, ETH, ações brapi sem chave, conversor, simulador) · **Nexora AI** (chat com 12 tipos de pergunta respondidas por regras sobre os dados reais; atalho no Painel) · animações (revelação por rolagem, contadores, faixa do menu, modal, toasts), mobile com barra de abas, `prefers-reduced-motion`.
**Não existe ainda:** contas/transferências, carteira de investimentos, patrimônio líquido, orçamentos/metas/reserva, backup e restauração, exportação CSV, tela de Configurações ("em breve"), IA generativa ativa (só a arquitetura existe).

## 5. Regras financeiras (estado atual × exigência do prompt)
| Regra | Situação |
|---|---|
| Compra no cartão ≠ despesa; pagar fatura não duplica | OK: compras ficam fora das despesas; o pagamento da fatura é lançado como despesa |
| Parcelas pagas/restantes corretas | OK em Despesas (`situacao`) e Parcelas; centavos divididos sem sobra |
| Totais não duplicam ao pagar | OK: "Já paguei" não altera totais (cada despesa conta 1× na data lançada) |
| Saldo atual × projetado | **Lacuna:** o saldo = receitas − todas as despesas (pagas e pendentes) − parcelas ativas ⇒ é, na prática, projetado. "Saldo previsto após faturas" existe só para cartões |
| Precisão monetária | **Lacuna:** valores em reais como `number` (float); formatação esconde ruído, mas somas não são em centavos inteiros |
| Parcelas (módulo) nos relatórios | **Limitação:** entram como despesa "de hoje" (sem data por parcela); risco de dupla contagem se a mesma compra for lançada também em Despesas parceladas |
| Despesas por data de pagamento | Hoje contam na data lançada, não na data paga |
| Transferências, aportes/retiradas, patrimônio | Não aplicável ainda (módulos inexistentes) |
| Dados demonstrativos | Nenhum no produto (OK) |

## 6. Alterações recentes
- **Fase 1:** diagnóstico, backup (zip), este arquivo.
- **Bloco 1 (Fase 2):** marca **Nexora** em título, descrição, favicon (monograma "N"), logotipo, menu, login, rodapé, avisos e comentários; menu lateral em preto/grafite com bordô de destaque; variáveis centralizadas `--nx-*` / `--side-bg-*` / `--logo-bg` (fim do `style.css`). Chaves de armazenamento **não** mudaram. Áreas de leitura seguem claras.

- **Bloco 2 (Fase 2):** objeto `Reveal` em `script.js` (+ CSS `rv-*` no fim do `style.css`): **um único** `IntersectionObserver`, zero listeners de scroll, só `transform`/`opacity`. Cartões (`.summary-card/.form-card/.list-card/.chart-card/.mk-card`) entram de baixo para cima (de cima para baixo se entrarem rolando para cima), em cascata (70 ms, máx. 420 ms) quando vários entram juntos; a entrada se repete ao voltar para a tela. Só gráficos e indicadores (`.rv-depth`) perdem opacidade ao sair pelo topo (mínimo 40%) e voltam ao subir. Gráficos tocam a animação de entrada quando aparecem. Pulso discreto nas mensagens de alerta/déficit. Sem `IntersectionObserver` ou com `prefers-reduced-motion` nada é escondido (volta ao escalonamento simples); ligar o movimento reduzido com a página aberta mostra tudo na hora. Foco por teclado em algo ainda não revelado o revela (`:focus-within`); rede de segurança `garantir()` revela o que estiver visível.

- **Fase 3 (Nexora AI):** perguntas reconhecidas por regras (ordem de especificidade): gastos do mês, categorias, quanto sobrou, aumentos entre meses, parcelas/vencimentos/faturas, organização, saldo/resumo, receitas, cotações já guardadas, juros compostos, renda fixa × variável, recusa de previsões. Reaproveita `filtrarPorMesAno`, `todasAsDespesas`, `Despesas.situacao`, `Cartoes.resumoGeral`, `calcularResumo`, `MercadoSimulador` (mesmos números de Painel e Relatórios). Fora do escopo ou sem dados: explica, nunca inventa. Conversa só na sessão (limpa ao sair da conta). Camada generativa **desligada e não configurada**: contrato `POST {proxyGenerativo}` `{pergunta, contexto, idioma}` → `{resposta}`; só vai um resumo agregado (`contextoMinimo`), nunca descrições/nomes/e-mail, e só com o interruptor ligado; erros tratados (rede, tempo, 401/403, 429, 5xx, formato) com "Tentar novamente" e "Responder com análise local".

## 7. Decisões técnicas
- Manter `cofre:*` no armazenamento (migração desnecessária e arriscada).
- Base grafite/preto aplicada primeiro ao menu; conteúdo permanece claro (leitura). Tema escuro completo = decisão pendente (ver próximos passos).
- Revelação por rolagem: efeito de saída restrito a gráficos/indicadores (leitura natural nas listas e formulários); `animation-fill-mode: backwards` para o hover continuar livre.
- Valor de despesa parcelada = total da compra; parcela = valor ÷ parcelas.
- Mercado: sem chave no navegador; Ibovespa só via proxy próprio.

## 8. Testes (executados de verdade, Chromium headless no ambiente de desenvolvimento)
- Suíte da Nexora AI (Chromium real, dados reais simulados): **31/31** — as 8 perguntas pedidas contra os números do sistema (incl. igualdade com a tela Relatórios), períodos, conta vazia, recusa de previsões, cotação sem dado, XSS, dados intactos, provedor generativo (desligado por padrão, privacidade do payload, erros, volta ao local), logout limpa conversa, indicador de processamento, celular e regressão (marca, saldo, revelação).
- Suíte do bloco 2 (revelação, Chromium real com `IntersectionObserver` nativo): **34/34** — ativação, 1 observador/0 listeners de scroll, cascata, abaixo da dobra escondido, rolar para baixo/cima, profundidade ≥ 40%, hover pós-revelação, repetição ao navegar, foco por teclado, movimento reduzido, sem IO, troca de preferência em tempo real, celular sem rolagem lateral.
- Suíte do bloco 1: **47/47** (identidade, compatibilidade com dados existentes, fluxos principais, mobile/tablet, console sem erros).
- Suítes das etapas anteriores (Já paguei 60/60, Mercado 102/102 etc.) foram rodadas **antes** deste bloco; **perdidas no reinício do ambiente** e não reexecutadas após a mudança de marca. Cobertura equivalente dos fluxos principais está na suíte do bloco 1.
- **Não testado:** a IA generativa contra um serviço real (só contra respostas simuladas); reanimação de gráficos ao aparecer com o Chart.js **real** (`getChart().reset().update()` foi verificado só com um Chart simulado); APIs reais (CoinGecko/AwesomeAPI/brapi) e CORS; Chart.js real (nos testes foi simulado); Safari/Firefox; aparelhos reais; leitores de tela.

## 9. Problemas conhecidos
1. Saldo "atual" é projetado (ver §5). 2. Dinheiro em float. 3. Dupla contagem possível Parcelas × Despesas parceladas. 4. `style.css` acumula camadas e regras sobrescritas (refatorar). 5. Autenticação local fraca (hash não criptográfico; qualquer pessoa com acesso ao navegador lê os dados) — não é segurança real. 6. Barra de abas com 7 itens (≤360 px só a ativa mostra o texto). 7. Limites/CORS das fontes de mercado não verificados. 8. O valor guardado em `--rv-fade` de elementos fora da tela pode ficar defasado após saltos instantâneos de rolagem; é inofensivo (recalculado ao reentrar).

## 9b. Requisitos para a IA generativa (futuro, ainda NÃO existe)
Camada local (regras + dados reais, sem custo) → gratuita. Generativa exige backend/serverless próprio (chave só no servidor), minimização de dados (enviar agregados, nunca o registro completo), aviso claro quando usar serviço externo, tratamento de erro/limite e interface `ProvedorIA.responder(pergunta, contexto)` trocável. Custos: normalmente cobrança por uso do provedor + hospedagem da função (há planos gratuitos limitados) — confirmar preços atuais antes de contratar.

## 10. Próximas tarefas (sequência proposta)
1. **Fase 4 (prioridade):** corrigir as lacunas do §5 — saldo atual × projetado, dinheiro em centavos inteiros, dupla contagem Parcelas × Despesas parceladas; depois backup/restauração e exportação CSV.
2. **Planejamento:** orçamentos por categoria, metas e reserva de emergência (a Nexora AI já tem onde responder sobre eles).
3. **Investimentos:** carteira, aportes/retiradas e patrimônio líquido.
4. **Acabamento da identidade** (cabeçalho, estados vazios, gráficos; decidir tema escuro completo opcional nas preferências).
5. **Fase 3 (feita):** Nexora AI local (perguntas sobre gastos, categorias, comparação de meses, parcelas), reutilizando `calcularResumo`, `Despesas.situacao`, `Cartoes.resumo`.
6. **Fase 4 (antiga):** corrigir lacunas do §5 (saldo atual × projetado, centavos inteiros, dupla contagem), backup/restauração e CSV.
