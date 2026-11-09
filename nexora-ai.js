/* =========================================================
   NEXORA AI (nexora-ai.js)

   Assistente financeira da plataforma. Duas camadas, bem separadas:

   1) ANÁLISE LOCAL (padrão, gratuita, roda no navegador)
      Regras determinísticas sobre os dados reais do usuário. NÃO é um
      modelo generativo e é apresentada assim. Reutiliza os cálculos que o
      sistema já tem (filtrarPorMesAno, todasAsDespesas, Despesas.situacao,
      Cartoes.resumoGeral, MercadoSimulador...) — não existe segunda lógica
      financeira aqui.

   2) IA GENERATIVA (opcional, DESLIGADA por padrão, ainda NÃO configurada)
      Interface `Provedor` trocável + camada de serviço. Só funciona se você
      criar um backend seguro e colocar a URL em NexoraIAConfig.proxyGenerativo.
      Nenhuma chave fica no navegador; só um resumo agregado (sem descrições,
      nomes ou e-mails) é enviado, e apenas com o interruptor ligado.

   Depende de script.js (State, Formato, Movimento...) e, opcionalmente, de
   mercado.js (cotações já guardadas).
   ========================================================= */

"use strict";

const NexoraIAConfig = {
  /** URL do SEU backend seguro para IA generativa (opcional). Vazio = recurso indisponível. */
  proxyGenerativo: "",
  tempoLimiteMs: 20000,
  atrasoAnaliseMs: 420, // pequena pausa para a resposta aparecer com calma (0 com movimento reduzido)
};

class ErroIA extends Error {
  constructor(tipo, mensagem) {
    super(mensagem);
    this.tipo = tipo;
  }
}

/* ---------------------------------------------------------
   1. UTILIDADES
--------------------------------------------------------- */
const IAUtil = {
  NOMES_MESES: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],

  /** minúsculas, sem acento, só letras/números/espaço: facilita reconhecer perguntas. */
  normalizar(texto) {
    return String(texto || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9% ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  },

  arredondar(valor) {
    return Math.round((Number(valor) || 0) * 100) / 100;
  },

  somar(lista, campo = "valor") {
    return this.arredondar(lista.reduce((soma, item) => soma + (Number(item[campo]) || 0), 0));
  },

  percentual(parte, total) {
    return total > 0 ? Math.round((parte / total) * 100) : 0;
  },

  periodo(mes, ano) {
    return {
      mes: String(mes).padStart(2, "0"),
      ano: String(ano),
      rotulo: `${this.NOMES_MESES[mes - 1]} de ${ano}`,
    };
  },

  periodoAtual() {
    const [ano, mes] = Formato.dataHojeISO().split("-").map(Number);
    return this.periodo(mes, ano);
  },

  anterior(per) {
    let mes = Number(per.mes) - 1;
    let ano = Number(per.ano);
    if (mes < 1) {
      mes = 12;
      ano -= 1;
    }
    return this.periodo(mes, ano);
  },

  ehAtual(per) {
    const atual = this.periodoAtual();
    return per.mes === atual.mes && per.ano === atual.ano;
  },

  /** "em setembro", "mês passado", "setembro de 2025"... Padrão: mês atual. */
  extrairPeriodo(norm) {
    const atual = this.periodoAtual();
    if (/mes passado|mes anterior|ultimo mes/.test(norm)) return this.anterior(atual);
    const nomes = this.NOMES_MESES.map((n) => this.normalizar(n));
    const indice = nomes.findIndex((nome) => new RegExp(`\\b${nome}\\b`).test(norm));
    if (indice >= 0) {
      const ano = norm.match(/\b(20\d{2})\b/);
      return this.periodo(indice + 1, ano ? Number(ano[1]) : Number(atual.ano));
    }
    return atual;
  },

  diasAte(isoData) {
    const [a, m, d] = Formato.dataHojeISO().split("-").map(Number);
    const [a2, m2, d2] = isoData.split("-").map(Number);
    return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a, m - 1, d)) / 86400000);
  },
};

/* ---------------------------------------------------------
   2. DADOS (sempre a partir do State e dos cálculos existentes)
--------------------------------------------------------- */
const IADados = {
  /** Mesmos números da tela Relatórios: receitas, despesas (inclui parcelas em andamento no mês atual), pago e a pagar. */
  resumoMes(per) {
    const dados = State.dados;
    const receitas = filtrarPorMesAno(dados.receitas, per.mes, per.ano);
    const registradas = filtrarPorMesAno(dados.despesas, per.mes, per.ano);
    const todas = filtrarPorMesAno(todasAsDespesas(dados), per.mes, per.ano);

    let pago = 0;
    let pendente = 0;
    registradas.forEach((despesa) => {
      const situacao = Despesas.situacao(despesa);
      pago += situacao.pago;
      pendente += situacao.pendente;
    });

    const porCategoria = {};
    todas.forEach((item) => {
      porCategoria[item.categoria] = (porCategoria[item.categoria] || 0) + (item.valor || 0);
    });
    const categorias = Object.entries(porCategoria)
      .map(([nome, valor]) => ({ nome, valor: IAUtil.arredondar(valor) }))
      .sort((a, b) => b.valor - a.valor);

    const totalDespesas = IAUtil.somar(todas);
    const totalRegistradas = IAUtil.somar(registradas);
    return {
      periodo: per,
      receitas: IAUtil.somar(receitas),
      qtdReceitas: receitas.length,
      totalDespesas,
      totalRegistradas,
      parcelasEmAndamento: IAUtil.arredondar(totalDespesas - totalRegistradas),
      qtdDespesas: todas.length,
      pago: IAUtil.arredondar(pago),
      pendente: IAUtil.arredondar(pendente),
      categorias,
    };
  },

  pendencias() {
    const dados = State.dados;
    const despesas = dados.despesas
      .map((despesa) => ({ despesa, situacao: Despesas.situacao(despesa) }))
      .filter((x) => !x.situacao.quitada)
      .sort((a, b) => (a.despesa.data < b.despesa.data ? -1 : a.despesa.data > b.despesa.data ? 1 : 0));
    const parcelas = dados.parcelas.filter((p) => p.parcelasRestantes > 0);
    const cartoes = dados.cartoes.length > 0 ? Cartoes.resumoGeral(dados) : null;
    return { despesas, parcelas, cartoes };
  },

  /** Resumo MÍNIMO para a camada generativa: só agregados — nunca descrições, nomes ou e-mail. */
  contextoMinimo() {
    const mes = this.resumoMes(IAUtil.periodoAtual());
    const geral = calcularResumo(State.dados);
    return {
      periodo: `${mes.periodo.ano}-${mes.periodo.mes}`,
      moeda: "BRL",
      receitasDoMes: mes.receitas,
      despesasDoMes: mes.totalDespesas,
      jaPagoNoMes: mes.pago,
      aPagarNoMes: mes.pendente,
      percentualDaRendaComprometida: calcularPercentualComprometido(geral.totalReceitas, geral.totalDespesas),
      principaisCategorias: mes.categorias.slice(0, 3).map((c) => ({ categoria: c.nome, valor: c.valor })),
      quantidadeDeContasPendentes: this.pendencias().despesas.length,
    };
  },
};

/* ---------------------------------------------------------
   3. ANÁLISE LOCAL (regras)
   Cada resposta é uma lista de "blocos" que a interface desenha:
   p · destaque · lista · barras · passos · aviso · titulo
--------------------------------------------------------- */
const IAAnalise = {
  AJUDA: [
    "Quanto gastei neste mês?",
    "Qual categoria representa a maior parte das minhas despesas?",
    "Quanto sobrou depois de pagar minhas contas?",
    "Quais despesas estão aumentando?",
    "Quais parcelas ainda faltam pagar?",
    "Como posso organizar melhor meus gastos?",
    "Como funcionam os juros compostos?",
    "Qual é a diferença entre renda fixa e renda variável?",
  ],

  resposta(blocos, seguintes = []) {
    return { blocos, seguintes, origem: "local" };
  },

  semDados(texto) {
    return this.resposta([{ t: "p", texto }, { t: "aviso", texto: "Cadastre receitas e despesas nas telas correspondentes e pergunte de novo." }], ["Como funcionam os juros compostos?"]);
  },

  /** Ordem importa: regras mais específicas primeiro. */
  REGRAS: [
    { id: "juros", padrao: /juros? composto/, resp: (n) => IAAnalise.juros(n) },
    { id: "rendaFixaVariavel", padrao: /renda (fixa|variavel)|(fixa|variavel) (e|ou|x|vs)/, resp: () => IAAnalise.rendaFixaVariavel() },
    { id: "semPrevisao", padrao: /(vai|ira|vao) (subir|cair|valorizar|desvalorizar)|melhor investimento|onde (devo )?investir|vale a pena (investir|comprar)|devo (comprar|vender)|rentabilidade garantida/, resp: () => IAAnalise.semPrevisao() },
    { id: "cotacoes", padrao: /dolar|euro|bitcoin|btc|ethereum|\beth\b|ibovespa|ibov|cotac/, resp: (n) => IAAnalise.cotacoes(n) },
    { id: "sobra", padrao: /sobrou|sobra|restou|sobraram|depois de pagar/, resp: (n) => IAAnalise.sobra(n) },
    { id: "variacoes", padrao: /aument|subiu|subindo|cresc|compar|variac|mais que|menos que/, resp: (n) => IAAnalise.variacoes(n) },
    { id: "categorias", padrao: /categoria|maior parte|onde (eu )?gasto mais|em que (eu )?gasto|maiores gastos|maior gasto/, resp: (n) => IAAnalise.categorias(n) },
    { id: "pendencias", padrao: /parcela|faltam|falta pagar|vencimento|vencer|venc|atrasad|fatura|proxima conta|contas? a pagar|pendente|pendencia/, resp: () => IAAnalise.pendencias() },
    { id: "organizar", padrao: /organiz|economiz|dica|planej|reduzir|cortar|poupar|orcamento|meta/, resp: (n) => IAAnalise.organizar(n) },
    { id: "gastoMes", padrao: /gastei|gasto|despesa|quanto saiu|quanto paguei/, resp: (n) => IAAnalise.gastoMes(n) },
    { id: "receitas", padrao: /receita|ganhei|recebi|salario|renda/, resp: (n) => IAAnalise.receitas(n) },
    { id: "resumo", padrao: /saldo|resumo|situacao|como estou|panorama/, resp: () => IAAnalise.resumo() },
  ],

  responder(pergunta) {
    if (!State || !State.dados) throw new ErroIA("semdados", "Entre na sua conta para eu consultar seus dados.");
    const norm = IAUtil.normalizar(pergunta);
    for (const regra of this.REGRAS) {
      if (regra.padrao.test(norm)) return regra.resp(norm);
    }
    return this.naoEntendi();
  },

  naoEntendi() {
    return this.resposta(
      [
        { t: "p", texto: "Não consegui responder a essa pergunta com os dados e as regras que tenho. Eu só respondo o que consigo calcular a partir dos seus registros — não invento valores." },
        { t: "titulo", texto: "Perguntas que eu sei responder" },
        { t: "passos", itens: ["Gastos, receitas e saldo de um mês (ex.: “quanto gastei em setembro?”)", "Categorias com maior gasto e quanto sobrou", "Despesas que estão aumentando entre meses", "Contas e parcelas pendentes e próximos vencimentos", "Dicas de organização baseadas nos seus números", "Juros compostos e renda fixa × variável (explicações educativas)"] },
      ],
      this.AJUDA.slice(0, 3)
    );
  },

  // ---------- gastos do mês ----------
  gastoMes(norm) {
    const per = IAUtil.extrairPeriodo(norm);
    const m = IADados.resumoMes(per);
    if (m.qtdDespesas === 0) {
      return this.semDados(`Não encontrei despesas registradas em ${per.rotulo}.`);
    }
    const itens = [
      { rotulo: "Já pago", valor: Formato.moeda(m.pago), detalhe: "das despesas lançadas no mês" },
      { rotulo: "A pagar", valor: Formato.moeda(m.pendente), detalhe: "ainda pendente" },
    ];
    if (m.parcelasEmAndamento > 0) {
      itens.push({ rotulo: "Parcelas em andamento", valor: Formato.moeda(m.parcelasEmAndamento), detalhe: "da página Parcelas" });
    }
    const blocos = [
      { t: "destaque", rotulo: `Despesas de ${per.rotulo}`, valor: Formato.moeda(m.totalDespesas), sub: `${m.qtdDespesas} ${m.qtdDespesas === 1 ? "lançamento" : "lançamentos"} · mesmo valor da tela Relatórios` },
      { t: "lista", itens },
    ];
    const cartao = this.avisoCartao();
    if (cartao) blocos.push({ t: "aviso", texto: cartao });
    return this.resposta(blocos, ["Qual categoria representa a maior parte das minhas despesas?", "Quanto sobrou depois de pagar minhas contas?"]);
  },

  /** Compras no cartão ficam fora das despesas até a fatura ser paga: avisa para não parecer que "sumiram". */
  avisoCartao() {
    if (State.dados.cartoes.length === 0) return "";
    const g = Cartoes.resumoGeral(State.dados);
    if (!g.proximo || g.proximo.total <= 0) return "";
    return `Compras no cartão não entram nas despesas até você pagar a fatura. Próxima fatura: ${Formato.moeda(g.proximo.total)} (${g.proximo.cartaoNome}), vence em ${Formato.dataCurta(g.proximo.data)}.`;
  },

  // ---------- categorias ----------
  categorias(norm) {
    const per = IAUtil.extrairPeriodo(norm);
    const m = IADados.resumoMes(per);
    if (m.categorias.length === 0) return this.semDados(`Não encontrei despesas em ${per.rotulo} para agrupar por categoria.`);
    const topo = m.categorias[0];
    const barras = m.categorias.slice(0, 5).map((c) => ({
      rotulo: c.nome,
      valor: Formato.moeda(c.valor),
      pct: IAUtil.percentual(c.valor, m.totalDespesas),
    }));
    const blocos = [
      { t: "p", texto: `Em ${per.rotulo}, a maior parte das suas despesas está em **${topo.nome}**: ${Formato.moeda(topo.valor)}, ou ${IAUtil.percentual(topo.valor, m.totalDespesas)}% do total de ${Formato.moeda(m.totalDespesas)}.` },
      { t: "barras", itens: barras },
    ];
    if (m.categorias.length > 5) blocos.push({ t: "p", texto: `Há ${m.categorias.length - 5} categoria(s) menores não mostradas.` });
    return this.resposta(blocos, ["Quais despesas estão aumentando?", "Como posso organizar melhor meus gastos?"]);
  },

  // ---------- quanto sobrou ----------
  sobra(norm) {
    const per = IAUtil.extrairPeriodo(norm);
    const m = IADados.resumoMes(per);
    if (m.receitas === 0 && m.qtdDespesas === 0) return this.semDados(`Não encontrei receitas nem despesas em ${per.rotulo}.`);
    const sobraProjetada = IAUtil.arredondar(m.receitas - m.totalDespesas);
    const sobraEmCaixa = IAUtil.arredondar(m.receitas - m.pago);
    const blocos = [
      { t: "destaque", rotulo: `Sobra de ${per.rotulo} se você pagar tudo`, valor: Formato.moeda(sobraProjetada), sub: sobraProjetada < 0 ? "as despesas superam as receitas do mês" : "receitas − despesas do mês" },
      {
        t: "lista",
        itens: [
          { rotulo: "Receitas do mês", valor: Formato.moeda(m.receitas) },
          { rotulo: "Despesas do mês", valor: Formato.moeda(m.totalDespesas), detalhe: `já pago ${Formato.moeda(m.pago)} · a pagar ${Formato.moeda(m.pendente)}` },
          { rotulo: "Sobra descontando só o que já pagou", valor: Formato.moeda(sobraEmCaixa), detalhe: "visão de caixa" },
        ],
      },
      { t: "aviso", texto: "O saldo principal do Painel desconta todas as despesas lançadas (pagas e pendentes), por isso ele equivale à “sobra se você pagar tudo”." },
    ];
    const cartao = this.avisoCartao();
    if (cartao) blocos.push({ t: "aviso", texto: cartao });
    return this.resposta(blocos, ["Quais parcelas ainda faltam pagar?", "Como posso organizar melhor meus gastos?"]);
  },

  // ---------- receitas ----------
  receitas(norm) {
    const per = IAUtil.extrairPeriodo(norm);
    const m = IADados.resumoMes(per);
    if (m.qtdReceitas === 0) return this.semDados(`Não encontrei receitas registradas em ${per.rotulo}.`);
    return this.resposta(
      [{ t: "destaque", rotulo: `Receitas de ${per.rotulo}`, valor: Formato.moeda(m.receitas), sub: `${m.qtdReceitas} ${m.qtdReceitas === 1 ? "lançamento" : "lançamentos"}` }],
      ["Quanto gastei neste mês?", "Quanto sobrou depois de pagar minhas contas?"]
    );
  },

  // ---------- variações entre meses ----------
  variacoes(norm) {
    const per = IAUtil.extrairPeriodo(norm);
    const ant = IAUtil.anterior(per);
    const atual = IADados.resumoMes(per);
    const antes = IADados.resumoMes(ant);
    if (antes.qtdDespesas === 0 || atual.qtdDespesas === 0) {
      return this.semDados(`Para comparar preciso de despesas nos dois meses (${ant.rotulo} e ${per.rotulo}), e não encontrei em ${atual.qtdDespesas === 0 ? per.rotulo : ant.rotulo}.`);
    }
    // "Parcelas" (módulo) só existe no mês atual: fora da comparação para não gerar uma alta artificial
    const mapaAntes = Object.fromEntries(antes.categorias.map((c) => [c.nome, c.valor]));
    const linhas = [];
    atual.categorias
      .filter((c) => c.nome !== "Parcelas")
      .forEach((c) => {
        const anterior = mapaAntes[c.nome] || 0;
        const diferenca = IAUtil.arredondar(c.valor - anterior);
        const pct = anterior > 0 ? Math.round((diferenca / anterior) * 100) : null;
        linhas.push({ nome: c.nome, atual: c.valor, anterior, diferenca, pct });
      });
    const subiram = linhas
      .filter((l) => l.diferenca >= 50 && (l.pct === null || l.pct >= 20))
      .sort((a, b) => b.diferenca - a.diferenca);

    const blocos = [{ t: "p", texto: `Comparando ${per.rotulo} com ${ant.rotulo}, sem contar as parcelas do módulo Parcelas (que só existem no mês atual).` }];
    if (subiram.length === 0) {
      blocos.push({ t: "p", texto: "Não vejo aumentos relevantes (considero relevante quando sobe pelo menos 20% e R$ 50,00)." });
    } else {
      blocos.push({
        t: "lista",
        itens: subiram.slice(0, 5).map((l) => ({
          rotulo: l.nome,
          valor: `+${Formato.moeda(l.diferenca)}`,
          detalhe: `${Formato.moeda(l.anterior)} → ${Formato.moeda(l.atual)}${l.pct === null ? " · sem gasto no mês anterior" : ` · +${l.pct}%`}`,
        })),
      });
    }
    const caiu = linhas.filter((l) => l.diferenca <= -50).sort((a, b) => a.diferenca - b.diferenca)[0];
    if (caiu) blocos.push({ t: "p", texto: `Em sentido contrário, ${caiu.nome} caiu ${Formato.moeda(Math.abs(caiu.diferenca))} (${Formato.moeda(caiu.anterior)} → ${Formato.moeda(caiu.atual)}).` });
    return this.resposta(blocos, ["Qual categoria representa a maior parte das minhas despesas?", "Como posso organizar melhor meus gastos?"]);
  },

  // ---------- pendências e vencimentos ----------
  pendencias() {
    const p = IADados.pendencias();
    const blocos = [];

    if (p.despesas.length > 0) {
      blocos.push({ t: "titulo", texto: "Despesas pendentes" });
      blocos.push({
        t: "lista",
        itens: p.despesas.slice(0, 6).map(({ despesa, situacao }) => {
          const dias = IAUtil.diasAte(despesa.data);
          const quando = dias < 0 ? `venceu há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"}` : dias === 0 ? "vence hoje" : dias <= 7 ? `vence em ${dias} ${dias === 1 ? "dia" : "dias"}` : `em ${Formato.dataCurta(despesa.data)}`;
          const parcela = situacao.parcelado ? `parcela ${situacao.parcelaAtual}/${situacao.total} · ` : "";
          return { rotulo: despesa.descricao, valor: Formato.moeda(situacao.valorParcela), detalhe: `${parcela}${quando}` };
        }),
      });
      if (p.despesas.length > 6) blocos.push({ t: "p", texto: `E mais ${p.despesas.length - 6} pendente(s) na tela Despesas.` });
      blocos.push({ t: "aviso", texto: "Uso a data lançada em cada despesa como a data de vencimento." });
    }

    if (p.parcelas.length > 0) {
      const totalFalta = IAUtil.somar(p.parcelas.map((x) => ({ v: x.parcelasRestantes * x.valorParcela })), "v");
      blocos.push({ t: "titulo", texto: "Parcelas (página Parcelas)" });
      blocos.push({
        t: "lista",
        itens: p.parcelas.map((x) => ({
          rotulo: x.descricao,
          valor: `${x.parcelasRestantes} ${x.parcelasRestantes === 1 ? "parcela" : "parcelas"}`,
          detalhe: `${Formato.moeda(x.valorParcela)} cada · faltam ${Formato.moeda(x.parcelasRestantes * x.valorParcela)}`,
        })),
      });
      blocos.push({ t: "p", texto: `No total, ainda faltam ${Formato.moeda(totalFalta)} em parcelas.` });
    }

    if (p.cartoes && p.cartoes.proximo) {
      blocos.push({ t: "titulo", texto: "Cartões" });
      blocos.push({
        t: "lista",
        itens: [
          { rotulo: "Próxima fatura", valor: Formato.moeda(p.cartoes.proximo.total), detalhe: `${p.cartoes.proximo.cartaoNome} · vence em ${Formato.dataCurta(p.cartoes.proximo.data)}` },
          { rotulo: "Limite utilizado", valor: Formato.moeda(p.cartoes.usado), detalhe: `de ${Formato.moeda(p.cartoes.limite)}` },
        ],
      });
    }

    if (blocos.length === 0) {
      return this.resposta([{ t: "p", texto: "Não encontrei contas, parcelas ou faturas pendentes nos seus registros." }], ["Quanto gastei neste mês?"]);
    }
    return this.resposta(blocos, ["Quanto sobrou depois de pagar minhas contas?", "Como posso organizar melhor meus gastos?"]);
  },

  // ---------- resumo geral ----------
  resumo() {
    const dados = State.dados;
    const g = calcularResumo(dados);
    if (g.totalReceitas === 0 && g.totalDespesas === 0) return this.semDados("Ainda não há receitas nem despesas registradas.");
    const pct = calcularPercentualComprometido(g.totalReceitas, g.totalDespesas);
    return this.resposta(
      [
        { t: "destaque", rotulo: "Saldo do Painel", valor: Formato.moeda(g.saldo), sub: "receitas − despesas lançadas (pagas e pendentes)" },
        {
          t: "lista",
          itens: [
            { rotulo: "Receitas (total)", valor: Formato.moeda(g.totalReceitas) },
            { rotulo: "Despesas (total)", valor: Formato.moeda(g.totalDespesas) },
            { rotulo: "Renda comprometida", valor: pct === null ? "—" : `${Math.round(pct)}%` },
          ],
        },
      ],
      ["Quanto sobrou depois de pagar minhas contas?", "Quais parcelas ainda faltam pagar?"]
    );
  },

  // ---------- como organizar ----------
  organizar() {
    const dados = State.dados;
    const g = calcularResumo(dados);
    const mes = IADados.resumoMes(IAUtil.periodoAtual());
    if (g.totalReceitas === 0 && g.totalDespesas === 0) return this.semDados("Para sugerir uma organização preciso de pelo menos algumas receitas e despesas registradas.");

    const passos = [];
    const pct = calcularPercentualComprometido(g.totalReceitas, g.totalDespesas);
    if (pct === null) passos.push("Você ainda não tem receitas registradas: sem elas não consigo medir quanto da sua renda está comprometida.");
    else if (pct >= 100) passos.push(`Suas despesas já superam as receitas (${Math.round(pct)}% da renda). O primeiro passo é separar o que é essencial do que pode esperar.`);
    else if (pct >= 80) passos.push(`${Math.round(pct)}% da sua renda está comprometida: a margem é pequena para imprevistos. Vale revisar despesas variáveis.`);
    else passos.push(`${Math.round(pct)}% da sua renda está comprometida: há folga. Considere direcionar parte dela a uma reserva.`);

    if (mes.categorias.length > 0) {
      const topo = mes.categorias[0];
      const share = IAUtil.percentual(topo.valor, mes.totalDespesas);
      if (share >= 35) passos.push(`${topo.nome} concentra ${share}% das despesas do mês (${Formato.moeda(topo.valor)}). Uma categoria dominante é o melhor lugar para procurar economia.`);
      else passos.push(`Seus gastos do mês estão distribuídos; a maior categoria, ${topo.nome}, tem ${share}%.`);
    }
    const pend = IADados.pendencias();
    const atrasadas = pend.despesas.filter((x) => IAUtil.diasAte(x.despesa.data) < 0);
    if (atrasadas.length > 0) passos.push(`Você tem ${atrasadas.length} ${atrasadas.length === 1 ? "despesa pendente com data já vencida" : "despesas pendentes com data já vencida"}. Quitá-las ou ajustar a data evita juros e confusão nos números.`);
    if (pend.parcelas.length > 0) {
      const mensal = IAUtil.somar(pend.parcelas.map((x) => ({ v: x.valorParcela })), "v");
      passos.push(`Suas parcelas em andamento somam ${Formato.moeda(mensal)} por mês. Evite assumir novas parcelas até as atuais diminuírem.`);
    }
    passos.push("Referência educacional (não é recomendação personalizada): a regra 50/30/20 sugere ~50% da renda para necessidades, ~30% para desejos e ~20% para poupança e dívidas. Ajuste à sua realidade.");
    passos.push("Uma reserva de emergência costuma ser pensada para cobrir alguns meses de despesas essenciais; o tamanho ideal depende da estabilidade da sua renda.");
    return this.resposta(
      [{ t: "p", texto: "Com base nos seus números atuais:" }, { t: "passos", itens: passos }, { t: "aviso", texto: "São sugestões gerais de organização, não aconselhamento financeiro individual." }],
      ["Qual categoria representa a maior parte das minhas despesas?", "Quais parcelas ainda faltam pagar?"]
    );
  },

  // ---------- cotações já guardadas (nunca "em tempo real") ----------
  cotacoes(norm) {
    const itens = [];
    const aviso = [];
    const ativo = typeof Mercado !== "undefined" ? Mercado : null;
    const estadoCambio = ativo && ativo.estado.cambio;
    const estadoCripto = ativo && ativo.estado.cripto;
    const hora = (ms) => (ms ? `cotação de ${MercadoFmt.dataHora(ms)} (Brasília)` : "horário da cotação não informado");
    const consulta = (est) => (est && est.consultadoEm ? `consultada às ${MercadoFmt.horaLocal(est.consultadoEm)}` : "");

    const quer = (re) => re.test(norm) || /cotac/.test(norm);
    if (quer(/dolar/) && estadoCambio && estadoCambio.dados && estadoCambio.dados.usd) {
      itens.push({ rotulo: "Dólar (USD/BRL)", valor: MercadoFmt.moeda(estadoCambio.dados.usd.preco, "BRL", 4), detalhe: `${hora(estadoCambio.dados.usd.hora)} · ${consulta(estadoCambio)}` });
    }
    if (quer(/euro/) && estadoCambio && estadoCambio.dados && estadoCambio.dados.eur) {
      itens.push({ rotulo: "Euro (EUR/BRL)", valor: MercadoFmt.moeda(estadoCambio.dados.eur.preco, "BRL", 4), detalhe: `${hora(estadoCambio.dados.eur.hora)} · ${consulta(estadoCambio)}` });
    }
    if (quer(/bitcoin|btc/) && estadoCripto && estadoCripto.dados && estadoCripto.dados.btc) {
      itens.push({ rotulo: "Bitcoin (BTC)", valor: MercadoFmt.moeda(estadoCripto.dados.btc.preco), detalhe: `${hora(estadoCripto.dados.btc.hora)} · ${consulta(estadoCripto)}` });
    }
    if (quer(/ethereum|\beth\b/) && estadoCripto && estadoCripto.dados && estadoCripto.dados.eth) {
      itens.push({ rotulo: "Ethereum (ETH)", valor: MercadoFmt.moeda(estadoCripto.dados.eth.preco), detalhe: `${hora(estadoCripto.dados.eth.hora)} · ${consulta(estadoCripto)}` });
    }
    if (itens.length === 0) {
      return this.resposta(
        [
          { t: "p", texto: "Não tenho essa cotação carregada agora (a fonte pode estar indisponível, ou o ativo não é um dos que acompanho: dólar, euro, bitcoin e ethereum). Não vou inventar um valor." },
          { t: "aviso", texto: "Abra a página Mercado Financeiro e use “Atualizar” para consultar as fontes." },
        ],
        ["Como funcionam os juros compostos?"]
      );
    }
    if (ativo && ["cambio", "cripto"].some((f) => ativo.estado[f] && ativo.estado[f].dados && ativo.desatualizado(f))) {
      aviso.push("Atenção: algumas cotações estão desatualizadas (a última atualização falhou).");
    }
    aviso.push("Valores guardados na última consulta às fontes públicas — não são cotações em tempo real e não indicam o que acontecerá no futuro.");
    return this.resposta([{ t: "lista", itens }, ...aviso.map((texto) => ({ t: "aviso", texto }))], ["Qual é a diferença entre renda fixa e renda variável?"]);
  },

  // ---------- educação financeira ----------
  juros() {
    const exemplo = MercadoSimulador.simular({ inicial: 1000, aporte: 0, taxaPct: 1, meses: 12 });
    return this.resposta(
      [
        { t: "p", texto: "Juros compostos são juros calculados sobre o valor inicial **mais** os juros já acumulados — “juros sobre juros”. Por isso o crescimento acelera com o tempo." },
        { t: "destaque", rotulo: "Fórmula", valor: "M = C × (1 + i)ⁿ", sub: "M: montante · C: capital inicial · i: taxa por período (em decimal) · n: número de períodos" },
        { t: "lista", itens: [{ rotulo: "Exemplo hipotético", valor: Formato.moeda(exemplo.final), detalhe: "R$ 1.000,00 a 1% ao mês por 12 meses, sem aportes (bruto, nominal)" }] },
        { t: "aviso", texto: "É apenas um exemplo matemático: não é previsão nem garantia de rendimento, e não considera impostos, taxas nem inflação. Para simular com seus números, use o Simulador na página Mercado Financeiro." },
      ],
      ["Qual é a diferença entre renda fixa e renda variável?"]
    );
  },

  rendaFixaVariavel() {
    return this.resposta(
      [
        { t: "p", texto: "Explicação educativa, sem recomendar nenhum produto:" },
        {
          t: "lista",
          itens: [
            { rotulo: "Renda fixa", valor: "regra definida", detalhe: "A forma de remuneração é combinada na contratação (taxa prefixada, atrelada a um índice como o CDI ou à inflação). Em geral oscila menos, mas não é isenta de risco: há risco de crédito do emissor, de liquidez e de marcação a mercado antes do vencimento." },
            { rotulo: "Renda variável", valor: "sem retorno definido", detalhe: "O retorno depende do mercado (ações, fundos imobiliários, etc.). O potencial é maior, mas as oscilações também: você pode perder parte ou todo o valor investido." },
          ],
        },
        { t: "passos", itens: ["Prazo: quanto tempo você pode deixar o dinheiro aplicado.", "Liquidez: com que rapidez consegue resgatar sem prejuízo.", "Risco: quanto de oscilação você tolera.", "Custos e impostos: variam por produto e mudam com a legislação — confira as regras atuais."] },
        { t: "aviso", texto: "Nenhuma opção garante rentabilidade. Para decidir, considere seu objetivo e, se possível, a orientação de um profissional habilitado." },
      ],
      ["Como funcionam os juros compostos?"]
    );
  },

  semPrevisao() {
    return this.resposta(
      [
        { t: "p", texto: "Eu não consigo prever se um ativo vai subir ou cair, nem indicar o “melhor” investimento — ninguém consegue garantir isso." },
        { t: "passos", itens: ["Rentabilidade passada não garante resultado futuro.", "Todo investimento tem riscos; retornos maiores costumam vir com oscilações maiores.", "Defina primeiro objetivo, prazo e quanto de risco você tolera.", "Diversificar reduz a dependência de um único ativo, mas não elimina o risco."] },
        { t: "aviso", texto: "Conteúdo educativo, não é recomendação de investimento." },
      ],
      ["Qual é a diferença entre renda fixa e renda variável?", "Como funcionam os juros compostos?"]
    );
  },
};

/* ---------------------------------------------------------
   4. PROVEDORES + SERVIÇO (camada isolada e trocável)
   Contrato de um provedor:
     { id, nome, usaServicoExterno, disponivel(), async responder(pergunta, contexto) → { blocos, seguintes, origem } }
--------------------------------------------------------- */
const ProvedorLocal = {
  id: "local",
  nome: "Análise local",
  usaServicoExterno: false,
  disponivel() {
    return true;
  },
  async responder(pergunta) {
    return IAAnalise.responder(pergunta);
  },
};

/**
 * Esqueleto do provedor generativo. Contrato do SEU backend (a criar):
 *   POST {proxyGenerativo}   corpo: { pergunta, contexto, idioma }   resposta: { resposta: "texto" }
 * A chave do provedor de IA fica SOMENTE no seu backend. Ainda não foi testado contra um serviço real.
 */
const ProvedorGenerativo = {
  id: "generativo",
  nome: "IA generativa (serviço externo)",
  usaServicoExterno: true,
  disponivel() {
    return Boolean(NexoraIAConfig.proxyGenerativo);
  },
  async responder(pergunta, contexto) {
    if (!this.disponivel()) throw new ErroIA("naoconfigurado", "A IA generativa não está configurada.");
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), NexoraIAConfig.tempoLimiteMs);
    let resposta;
    try {
      resposta = await fetch(NexoraIAConfig.proxyGenerativo, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pergunta, contexto, idioma: "pt-BR" }),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controle.signal,
      });
    } catch (erro) {
      if (erro && erro.name === "AbortError") throw new ErroIA("tempo", "O serviço demorou demais para responder.");
      throw new ErroIA("rede", "Não foi possível acessar o serviço de IA (sem conexão ou bloqueio do navegador).");
    } finally {
      clearTimeout(relogio);
    }
    if (resposta.status === 429) throw new ErroIA("limite", "O limite de consultas do serviço foi atingido. Tente novamente em instantes.");
    if (resposta.status === 401 || resposta.status === 403) throw new ErroIA("acesso", "O serviço recusou o acesso.");
    if (!resposta.ok) throw new ErroIA("servidor", "O serviço de IA está indisponível no momento.");
    let json;
    try {
      json = await resposta.json();
    } catch (erro) {
      throw new ErroIA("formato", "O serviço respondeu em um formato inesperado.");
    }
    if (!json || typeof json.resposta !== "string" || json.resposta.trim() === "") {
      throw new ErroIA("formato", "O serviço respondeu em um formato inesperado.");
    }
    const blocos = json.resposta
      .split(/\n{2,}/)
      .map((texto) => texto.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((texto) => ({ t: "p", texto }));
    blocos.push({ t: "aviso", texto: "Resposta gerada por um serviço externo de IA a partir de um resumo agregado dos seus dados. Pode conter erros: confira os números nas telas do Nexora." });
    return { blocos, seguintes: [], origem: "generativo" };
  },
};

const NexoraIAServico = {
  provedores: { local: ProvedorLocal, generativo: ProvedorGenerativo },
  modo: "local", // só vira "generativo" se o provedor estiver disponível E o usuário ligar o interruptor

  provedorAtivo() {
    const escolhido = this.provedores[this.modo];
    return escolhido && escolhido.disponivel() ? escolhido : this.provedores.local;
  },

  responder(pergunta) {
    const provedor = this.provedorAtivo();
    // só a camada generativa recebe contexto, e apenas o resumo mínimo
    const contexto = provedor.usaServicoExterno ? IADados.contextoMinimo() : null;
    return provedor.responder(pergunta, contexto);
  },
};

/* ---------------------------------------------------------
   5. INTERFACE
--------------------------------------------------------- */
const NexoraIA = {
  mensagens: 0,
  processando: false,
  _iniciado: false,

  $(id) {
    return document.getElementById(id);
  },

  iniciar() {
    if (this._iniciado) return;
    this._iniciado = true;

    this.$("iaForm").addEventListener("submit", (evento) => {
      evento.preventDefault();
      this.enviarDoCampo();
    });
    const campo = this.$("iaCampo");
    campo.addEventListener("keydown", (evento) => {
      if (evento.key === "Enter" && !evento.shiftKey) {
        evento.preventDefault();
        this.enviarDoCampo();
      }
    });
    campo.addEventListener("input", () => {
      campo.style.height = "auto";
      campo.style.height = Math.min(campo.scrollHeight, 120) + "px";
    });
    this.$("iaNova").addEventListener("click", () => {
      this.limpar();
      this.aoAbrir();
    });
    const interruptor = this.$("iaModoGenerativo");
    if (interruptor) {
      interruptor.addEventListener("change", () => {
        NexoraIAServico.modo = interruptor.checked ? "generativo" : "local";
        this.atualizarModo();
      });
    }
    // sugestões e botões dentro das mensagens (delegação)
    document.addEventListener("click", (evento) => {
      const botao = evento.target.closest && evento.target.closest("[data-ia-pergunta]");
      if (botao) this.enviar(botao.dataset.iaPergunta);
    });
    this.desenharSugestoes();
    this.atualizarModo();
  },

  aoAbrir() {
    this.iniciar();
    this.atualizarModo();
    if (this.mensagens === 0) this.boasVindas();
  },

  limpar() {
    const lista = this.$("iaMensagens");
    if (lista) lista.innerHTML = "";
    this.mensagens = 0;
    this.processando = false;
    NexoraIAServico.modo = "local";
    const interruptor = this.$("iaModoGenerativo");
    if (interruptor) interruptor.checked = false;
    if (this._iniciado) this.atualizarModo();
  },

  /* ---------- partes da tela ---------- */
  desenharSugestoes() {
    const area = this.$("iaSugestoes");
    area.innerHTML = "";
    IAAnalise.AJUDA.forEach((pergunta) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "ia-sugestao";
      botao.dataset.iaPergunta = pergunta;
      botao.textContent = pergunta;
      area.appendChild(botao);
    });
  },

  atualizarModo() {
    const generativoDisponivel = ProvedorGenerativo.disponivel();
    const bloco = this.$("iaModoBloco");
    const nota = this.$("iaModoNota");
    if (bloco) bloco.hidden = !generativoDisponivel;
    if (nota) nota.hidden = generativoDisponivel;
    const externo = NexoraIAServico.provedorAtivo().usaServicoExterno;
    const selo = this.$("iaSelo");
    selo.textContent = externo ? "Serviço externo" : "Análise local";
    selo.classList.toggle("is-externo", externo);
  },

  boasVindas() {
    const nome = State.usuario ? Formato.primeiroNome(State.usuario.nome) : "";
    this.adicionarRespostaIA({
      blocos: [
        { t: "p", texto: `Olá${nome ? ", " + nome : ""}! Eu sou a Nexora AI.` },
        { t: "p", texto: "Respondo perguntas sobre as suas finanças usando os registros reais da plataforma e regras de cálculo — por isso sou uma **análise inteligente baseada em regras**, e não um modelo generativo. Tudo é calculado no seu navegador: nada sai daqui." },
        { t: "aviso", texto: "Só respondo o que consigo calcular com os seus dados. Quando faltar informação, eu aviso em vez de inventar." },
      ],
      seguintes: [],
      origem: "local",
    });
  },

  /* ---------- envio ---------- */
  enviarDoCampo() {
    const campo = this.$("iaCampo");
    const texto = campo.value.trim();
    if (!texto) return;
    campo.value = "";
    campo.style.height = "auto";
    this.enviar(texto);
  },

  enviar(pergunta) {
    pergunta = String(pergunta || "").trim().slice(0, 300);
    if (!pergunta || this.processando) return;
    this.adicionarMensagemUsuario(pergunta);
    this.executar(pergunta);
  },

  async executar(pergunta) {
    this.definirProcessando(true);
    const indicador = this.mostrarDigitando();
    try {
      const provedor = NexoraIAServico.provedorAtivo();
      if (!provedor.usaServicoExterno && typeof Movimento !== "undefined" && !Movimento.reduzido()) {
        await new Promise((ok) => setTimeout(ok, NexoraIAConfig.atrasoAnaliseMs));
      }
      const resposta = await NexoraIAServico.responder(pergunta);
      indicador.remove();
      this.adicionarRespostaIA(resposta);
    } catch (erro) {
      indicador.remove();
      this.adicionarErro(pergunta, erro);
    } finally {
      this.definirProcessando(false);
    }
  },

  definirProcessando(valor) {
    this.processando = valor;
    this.$("iaEnviar").disabled = valor;
    this.$("iaMensagens").setAttribute("aria-busy", String(valor));
  },

  /* ---------- desenho das mensagens ---------- */
  rolarParaOFim() {
    const lista = this.$("iaMensagens");
    const reduzido = typeof Movimento !== "undefined" && Movimento.reduzido();
    lista.scrollTo({ top: lista.scrollHeight, behavior: reduzido ? "auto" : "smooth" });
  },

  adicionarMensagemUsuario(texto) {
    const linha = document.createElement("div");
    linha.className = "ia-msg ia-msg-usuario";
    const balao = document.createElement("div");
    balao.className = "ia-balao";
    balao.textContent = texto;
    linha.appendChild(balao);
    this.$("iaMensagens").appendChild(linha);
    this.mensagens += 1;
    this.rolarParaOFim();
  },

  mostrarDigitando() {
    const linha = document.createElement("div");
    linha.className = "ia-msg ia-msg-ia ia-digitando";
    linha.setAttribute("role", "status");
    linha.innerHTML =
      '<span class="ia-avatar-mini" aria-hidden="true">N</span><div class="ia-balao"><span class="ia-pontos" aria-hidden="true"><i></i><i></i><i></i></span><span class="ia-digitando-txt">Analisando seus dados…</span></div>';
    this.$("iaMensagens").appendChild(linha);
    this.rolarParaOFim();
    return linha;
  },

  /** Texto com **negrito** simples, sem HTML (seguro). */
  texto(elemento, texto) {
    String(texto)
      .split(/(\*\*[^*]+\*\*)/)
      .forEach((parte) => {
        if (/^\*\*[^*]+\*\*$/.test(parte)) {
          const forte = document.createElement("strong");
          forte.textContent = parte.slice(2, -2);
          elemento.appendChild(forte);
        } else if (parte) {
          elemento.appendChild(document.createTextNode(parte));
        }
      });
    return elemento;
  },

  desenharBloco(bloco) {
    const criar = (tag, classe) => {
      const el = document.createElement(tag);
      if (classe) el.className = classe;
      return el;
    };
    switch (bloco.t) {
      case "titulo":
        return this.texto(criar("h4", "ia-titulo"), bloco.texto);
      case "aviso":
        return this.texto(criar("p", "ia-aviso"), bloco.texto);
      case "destaque": {
        const el = criar("div", "ia-destaque");
        el.append(this.texto(criar("span"), bloco.rotulo), this.texto(criar("strong"), bloco.valor));
        if (bloco.sub) el.appendChild(this.texto(criar("small"), bloco.sub));
        return el;
      }
      case "lista": {
        const ul = criar("ul", "ia-lista");
        bloco.itens.forEach((item) => {
          const li = criar("li");
          const topo = criar("div", "ia-lista-topo");
          topo.append(this.texto(criar("span"), item.rotulo), this.texto(criar("strong"), item.valor));
          li.appendChild(topo);
          if (item.detalhe) li.appendChild(this.texto(criar("em"), item.detalhe));
          ul.appendChild(li);
        });
        return ul;
      }
      case "barras": {
        const ul = criar("ul", "ia-barras");
        bloco.itens.forEach((item) => {
          const li = criar("li");
          const topo = criar("div", "ia-lista-topo");
          topo.append(this.texto(criar("span"), item.rotulo), this.texto(criar("strong"), `${item.valor} · ${item.pct}%`));
          const trilho = criar("div", "ia-trilho");
          const barra = criar("i");
          barra.style.width = Math.max(2, Math.min(100, item.pct)) + "%";
          trilho.appendChild(barra);
          li.append(topo, trilho);
          ul.appendChild(li);
        });
        return ul;
      }
      case "passos": {
        const ol = criar("ul", "ia-passos");
        bloco.itens.forEach((texto) => ol.appendChild(this.texto(criar("li"), texto)));
        return ol;
      }
      default:
        return this.texto(criar("p"), bloco.texto || "");
    }
  },

  adicionarRespostaIA(resposta) {
    const linha = document.createElement("div");
    linha.className = "ia-msg ia-msg-ia";
    const avatar = document.createElement("span");
    avatar.className = "ia-avatar-mini";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "N";
    const balao = document.createElement("div");
    balao.className = "ia-balao";

    resposta.blocos.forEach((bloco, indice) => {
      const el = this.desenharBloco(bloco);
      el.classList.add("ia-bloco");
      el.style.setProperty("--ia-d", Math.min(indice * 110, 660) + "ms"); // aparecem em sequência
      balao.appendChild(el);
    });

    const origem = document.createElement("div");
    origem.className = "ia-origem";
    origem.textContent = resposta.origem === "generativo" ? "Resposta de serviço externo de IA (resumo agregado enviado)" : "Análise local · calculado no seu navegador com os seus dados";
    balao.appendChild(origem);

    if (resposta.seguintes && resposta.seguintes.length > 0) {
      const chips = document.createElement("div");
      chips.className = "ia-seguintes";
      resposta.seguintes.slice(0, 3).forEach((pergunta) => {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "ia-sugestao ia-sugestao-pequena";
        botao.dataset.iaPergunta = pergunta;
        botao.textContent = pergunta;
        chips.appendChild(botao);
      });
      balao.appendChild(chips);
    }

    linha.append(avatar, balao);
    this.$("iaMensagens").appendChild(linha);
    this.mensagens += 1;
    this.rolarParaOFim();
  },

  adicionarErro(pergunta, erro) {
    const linha = document.createElement("div");
    linha.className = "ia-msg ia-msg-ia ia-msg-erro";
    linha.setAttribute("role", "alert");
    const avatar = document.createElement("span");
    avatar.className = "ia-avatar-mini";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "!";
    const balao = document.createElement("div");
    balao.className = "ia-balao";
    const texto = document.createElement("p");
    texto.textContent = erro && erro.tipo ? erro.message : "Não consegui concluir essa análise agora. Tente novamente.";
    const acoes = document.createElement("div");
    acoes.className = "ia-seguintes";

    const tentar = document.createElement("button");
    tentar.type = "button";
    tentar.className = "secondary-btn ia-retry";
    tentar.textContent = "Tentar novamente";
    tentar.addEventListener("click", () => {
      linha.remove();
      this.mensagens -= 1;
      if (!this.processando) this.executar(pergunta);
    });
    acoes.appendChild(tentar);

    if (NexoraIAServico.provedorAtivo().usaServicoExterno) {
      const local = document.createElement("button");
      local.type = "button";
      local.className = "secondary-btn ia-retry";
      local.textContent = "Responder com análise local";
      local.addEventListener("click", () => {
        NexoraIAServico.modo = "local";
        const interruptor = this.$("iaModoGenerativo");
        if (interruptor) interruptor.checked = false;
        this.atualizarModo();
        linha.remove();
        this.mensagens -= 1;
        if (!this.processando) this.executar(pergunta);
      });
      acoes.appendChild(local);
    }

    balao.append(texto, acoes);
    linha.append(avatar, balao);
    this.$("iaMensagens").appendChild(linha);
    this.mensagens += 1;
    this.rolarParaOFim();
  },
};
