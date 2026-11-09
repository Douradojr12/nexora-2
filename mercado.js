/* =========================================================
   NEXORA — Mercado Financeiro (mercado.js)

   Módulo independente: cotações (moedas, bolsa, cripto), conversor,
   simulador de rendimentos e o resumo do Dashboard.

   - Usa só dados públicos. NENHUM dado pessoal (receitas, despesas,
     usuário...) é enviado a essas fontes: as chamadas são GET sem
     cookies e sem cabeçalhos personalizados.
   - Não há chave secreta neste arquivo. O Ibovespa exige chave na brapi;
     para isso existe o proxy opcional em serverless/brapi-proxy.js.
   - Cache em localStorage (compartilhado: cotações são públicas) para
     evitar chamadas excessivas; atualização automática moderada.
   - Reaproveita Formato, Graficos (Chart.js), Toast, Movimento e UI de
     script.js — este arquivo só precisa ser carregado no index.html.
   ========================================================= */

"use strict";

/* ---------------------------------------------------------
   1. CONFIGURAÇÃO
--------------------------------------------------------- */
const MercadoConfig = {
  /**
   * URL base do SEU proxy da brapi (opcional), ex.:
   * "https://cofre-brapi.seunome.workers.dev". Veja serverless/brapi-proxy.js.
   * Vazio = só os 4 tickers que a brapi libera sem chave (e sem Ibovespa).
   */
  proxyBrapi: "",

  acoesSemChave: ["PETR4", "VALE3", "ITUB4", "MGLU3"],
  acoesComProxy: ["PETR4", "VALE3", "ITUB4", "MGLU3", "BBAS3", "WEGE3"],
  indice: "^BVSP",

  // validade do cache (ms) — a API de câmbio já guarda 1 min no servidor
  ttl: {
    cambio: 2 * 60 * 1000,
    cripto: 3 * 60 * 1000,
    bolsa: 15 * 60 * 1000, // plano gratuito da brapi tem ~30 min de atraso
    historico: 30 * 60 * 1000,
  },
  esperaEntreManuais: 15 * 1000, // evita "martelar" o botão Atualizar
  tempoLimite: 10 * 1000,
  verificacao: 30 * 1000, // de quanto em quanto tempo o relógio confere se algo venceu
  maxFalhasBackoff: 5,
};

class ErroMercado extends Error {
  constructor(tipo, mensagem, extra = {}) {
    super(mensagem);
    this.tipo = tipo;
    Object.assign(this, extra);
  }
}

/* ---------------------------------------------------------
   2. FORMATAÇÃO (pt-BR)
--------------------------------------------------------- */
const MercadoFmt = {
  moeda(valor, moeda = "BRL", casas = 2) {
    return valor.toLocaleString("pt-BR", {
      style: "currency",
      currency: moeda,
      minimumFractionDigits: casas,
      maximumFractionDigits: casas,
    });
  },
  numero(valor, casas = 0) {
    return valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  },
  pct(valor) {
    const texto = Math.abs(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (valor > 0 ? "+" : valor < 0 ? "-" : "") + texto + "%";
  },
  /** "10/10 14:32" no horário de Brasília (a fonte informa UTC-3). */
  dataHora(ms) {
    return new Date(ms)
      .toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" })
      .replace(",", "");
  },
  /** Hora local da consulta, "14:35". */
  horaLocal(ms) {
    return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  },
  diaMes(ms) {
    return new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  },
  /** Aceita "1.234,56", "1234,56", "1234.56" e "1.000" (milhar). Devolve NaN se inválido. */
  lerNumero(texto) {
    if (texto === null || texto === undefined) return NaN;
    let s = String(texto).trim().replace(/\s/g, "").replace(/^R\$/i, "");
    if (s === "") return NaN;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  },
  paraMs(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n > 1e11 ? n : n * 1000; // a AwesomeAPI usa segundos (e, em alguns históricos, milissegundos)
  },
};

/* ---------------------------------------------------------
   3. CAMADA DE REDE (compartilhada pelas fontes)
--------------------------------------------------------- */
const MercadoApi = {
  async buscarJSON(url, { tempoLimite = MercadoConfig.tempoLimite } = {}) {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), tempoLimite);
    let resposta;
    try {
      resposta = await fetch(url, { signal: controle.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    } catch (erro) {
      if (erro && erro.name === "AbortError") {
        throw new ErroMercado("tempo", "A fonte demorou demais para responder.");
      }
      throw new ErroMercado("rede", "Não foi possível acessar a fonte (sem conexão ou bloqueio do navegador).");
    } finally {
      clearTimeout(relogio);
    }

    if (!resposta.ok) {
      const status = resposta.status;
      if (status === 429) {
        const espera = Number(resposta.headers.get("Retry-After"));
        throw new ErroMercado("limite", "Limite de consultas da fonte atingido. Tente novamente em instantes.", {
          status,
          esperaMs: Number.isFinite(espera) && espera > 0 ? espera * 1000 : null,
        });
      }
      if (status === 401 || status === 403) {
        throw new ErroMercado("acesso", "A fonte exige autorização para este dado.", { status });
      }
      if (status === 404) throw new ErroMercado("naoencontrado", "Dado não encontrado na fonte.", { status });
      throw new ErroMercado("servidor", "A fonte está com problemas no momento.", { status });
    }

    try {
      return await resposta.json();
    } catch (erro) {
      throw new ErroMercado("formato", "A fonte respondeu em um formato inesperado.");
    }
  },
};

/* ---------------------------------------------------------
   4. CACHE (localStorage, compartilhado — dados públicos)
--------------------------------------------------------- */
const MercadoCache = {
  CHAVE: "cofre:mercado:v1",
  ler() {
    try {
      const bruto = localStorage.getItem(this.CHAVE);
      const dados = bruto ? JSON.parse(bruto) : {};
      return dados && typeof dados === "object" ? dados : {};
    } catch (erro) {
      return {};
    }
  },
  gravar(chave, valor) {
    try {
      const tudo = this.ler();
      tudo[chave] = valor;
      localStorage.setItem(this.CHAVE, JSON.stringify(tudo));
    } catch (erro) {
      /* sem espaço/permissão: o app segue sem cache */
    }
  },
};

/* ---------------------------------------------------------
   5. FONTES DE DADOS (cada uma devolve dados já normalizados)
--------------------------------------------------------- */
const MercadoFontes = {
  AWESOME: "https://economia.awesomeapi.com.br",
  COINGECKO: "https://api.coingecko.com/api/v3",
  BRAPI: "https://brapi.dev/api/v2/stocks",

  // ---------- AwesomeAPI: campos documentados em docs.awesomeapi.com.br ----------
  normalizarAwesome(item) {
    const preco = Number(item && item.bid);
    if (!Number.isFinite(preco) || preco <= 0) return null;
    const pct = Number(item.pctChange);
    const ask = Number(item.ask);
    return {
      preco, // "bid" (compra)
      venda: Number.isFinite(ask) && ask > 0 ? ask : null,
      pct: Number.isFinite(pct) ? pct : null,
      hora: MercadoFmt.paraMs(item.timestamp), // momento da negociação informado pela fonte
    };
  },

  async cambio() {
    const json = await MercadoApi.buscarJSON(`${this.AWESOME}/json/last/USD-BRL,EUR-BRL`);
    const usd = this.normalizarAwesome(json && json.USDBRL);
    const eur = this.normalizarAwesome(json && json.EURBRL);
    if (!usd && !eur) throw new ErroMercado("formato", "A fonte não trouxe cotações de dólar ou euro.");
    return { usd, eur, fonte: "AwesomeAPI" };
  },

  async criptoAwesome() {
    const json = await MercadoApi.buscarJSON(`${this.AWESOME}/json/last/BTC-BRL,ETH-BRL`);
    return {
      btc: this.normalizarAwesome(json && json.BTCBRL),
      eth: this.normalizarAwesome(json && json.ETHBRL),
    };
  },

  // ---------- CoinGecko: simple/price (docs.coingecko.com) ----------
  async criptoCoinGecko() {
    const url =
      `${this.COINGECKO}/simple/price?ids=bitcoin,ethereum&vs_currencies=brl` +
      `&include_24hr_change=true&include_last_updated_at=true`;
    const json = await MercadoApi.buscarJSON(url);
    const ler = (id) => {
      const item = json && json[id];
      const preco = Number(item && item.brl);
      if (!Number.isFinite(preco) || preco <= 0) return null;
      const pct = item.brl_24h_change === null || item.brl_24h_change === undefined ? NaN : Number(item.brl_24h_change);
      return {
        preco,
        pct: Number.isFinite(pct) ? pct : null, // a fonte devolve null quando o preço está parado
        hora: MercadoFmt.paraMs(item.last_updated_at),
      };
    };
    return { btc: ler("bitcoin"), eth: ler("ethereum") };
  },

  /** CoinGecko primeiro; o que faltar (ou se falhar) vem da AwesomeAPI. Cada moeda guarda sua fonte. */
  async cripto() {
    let resultado = { btc: null, eth: null };
    let erroPrincipal = null;
    try {
      resultado = await this.criptoCoinGecko();
      if (resultado.btc) resultado.btc.fonte = "CoinGecko";
      if (resultado.eth) resultado.eth.fonte = "CoinGecko";
    } catch (erro) {
      erroPrincipal = erro;
    }
    if (!resultado.btc || !resultado.eth) {
      try {
        const reserva = await this.criptoAwesome();
        ["btc", "eth"].forEach((chave) => {
          if (!resultado[chave] && reserva[chave]) resultado[chave] = { ...reserva[chave], fonte: "AwesomeAPI" };
        });
      } catch (erro) {
        if (!resultado.btc && !resultado.eth) throw erroPrincipal || erro;
      }
    }
    if (!resultado.btc && !resultado.eth) {
      throw erroPrincipal || new ErroMercado("formato", "Nenhuma fonte trouxe o preço das criptomoedas.");
    }
    return resultado;
  },

  // ---------- brapi (v2): quote / historical ----------
  usaProxy() {
    return Boolean(MercadoConfig.proxyBrapi);
  },
  listaBolsa() {
    return this.usaProxy()
      ? [MercadoConfig.indice, ...MercadoConfig.acoesComProxy]
      : [...MercadoConfig.acoesSemChave];
  },
  urlBrapi(caminho, parametros) {
    const consulta = new URLSearchParams(parametros).toString();
    const base = this.usaProxy() ? MercadoConfig.proxyBrapi.replace(/\/+$/, "") : this.BRAPI;
    return `${base}/${caminho}?${consulta}`;
  },

  normalizarCotacaoBrapi(resposta) {
    const item = resposta && Array.isArray(resposta.results) ? resposta.results[0] : null;
    const dado = item && item.data;
    const preco = Number(dado && dado.regularMarketPrice);
    if (!dado || !Number.isFinite(preco)) return null;
    const pct = Number(dado.regularMarketChangePercent);
    const variacao = Number(dado.regularMarketChange);
    const hora = dado.regularMarketTime ? Date.parse(dado.regularMarketTime) : NaN;
    return {
      simbolo: item.symbol || item.requestedSymbol,
      nome: dado.shortName || dado.longName || item.symbol,
      moeda: dado.currency || "BRL",
      preco,
      variacao: Number.isFinite(variacao) ? variacao : null,
      pct: Number.isFinite(pct) ? pct : null,
      hora: Number.isFinite(hora) ? hora : null,
    };
  },

  /**
   * Um ticker por chamada, em sequência: o plano gratuito aceita 1 ativo por
   * requisição e 1 chamada simultânea. Falhas pontuais não derrubam os demais.
   */
  async bolsa(anterior) {
    const itens = { ...((anterior && anterior.itens) || {}) };
    const erros = {};
    let sucessos = 0;
    let ultimoErro = null;

    for (const simbolo of this.listaBolsa()) {
      try {
        const json = await MercadoApi.buscarJSON(this.urlBrapi("quote", { symbols: simbolo }));
        const cotacao = this.normalizarCotacaoBrapi(json);
        if (!cotacao) {
          erros[simbolo] = "Sem dados para este ativo na fonte.";
          continue;
        }
        itens[simbolo] = { ...cotacao, consultadoEm: Date.now() };
        sucessos += 1;
      } catch (erro) {
        ultimoErro = erro;
        erros[simbolo] = erro.message;
        if (erro.tipo === "limite") break; // não insiste quando o limite estourou
      }
    }
    if (sucessos === 0) {
      throw ultimoErro || new ErroMercado("formato", "A fonte não trouxe cotações de ações.");
    }
    return { itens, erros, fonte: "brapi" };
  },

  // ---------- históricos (séries [{t, v}] em ordem crescente) ----------
  async historicoCambio(par) {
    const json = await MercadoApi.buscarJSON(`${this.AWESOME}/json/daily/${par}/30`);
    return this.serieAwesome(json);
  },

  serieAwesome(json) {
    if (!Array.isArray(json)) throw new ErroMercado("formato", "Histórico em formato inesperado.");
    const pontos = json
      .map((item) => ({ t: MercadoFmt.paraMs(item.timestamp), v: Number(item.bid) }))
      .filter((p) => p.t && Number.isFinite(p.v) && p.v > 0)
      .sort((a, b) => a.t - b.t);
    if (pontos.length < 2) throw new ErroMercado("formato", "Histórico insuficiente na fonte.");
    return pontos;
  },

  async historicoCripto(sigla) {
    const idCoinGecko = sigla === "BTC" ? "bitcoin" : "ethereum";
    try {
      const json = await MercadoApi.buscarJSON(`${this.COINGECKO}/coins/${idCoinGecko}/market_chart?vs_currency=brl&days=30`);
      const bruto = json && Array.isArray(json.prices) ? json.prices : null;
      if (!bruto) throw new ErroMercado("formato", "Histórico em formato inesperado.");
      // a fonte devolve pontos por hora: fica o último de cada dia
      const porDia = new Map();
      bruto.forEach(([t, v]) => {
        if (Number.isFinite(t) && Number.isFinite(v) && v > 0) porDia.set(MercadoFmt.diaMes(t), { t, v });
      });
      const pontos = [...porDia.values()].sort((a, b) => a.t - b.t);
      if (pontos.length < 2) throw new ErroMercado("formato", "Histórico insuficiente na fonte.");
      return pontos;
    } catch (erro) {
      const json = await MercadoApi.buscarJSON(`${this.AWESOME}/json/daily/${sigla}-BRL/30`);
      return this.serieAwesome(json);
    }
  },

  async historicoBolsa(simbolo) {
    const url = this.urlBrapi("historical", { symbols: simbolo, range: "1mo", interval: "1d", sortOrder: "asc" });
    const json = await MercadoApi.buscarJSON(url);
    const item = json && Array.isArray(json.results) ? json.results[0] : null;
    const lista = item && item.data && item.data.historicalDataPrice;
    if (!Array.isArray(lista)) throw new ErroMercado("formato", "Histórico indisponível para este ativo.");
    const pontos = lista
      .map((p) => ({ t: MercadoFmt.paraMs(p.date), v: Number(p.close) }))
      .filter((p) => p.t && Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    if (pontos.length < 2) throw new ErroMercado("formato", "Histórico insuficiente na fonte.");
    return pontos;
  },
};

/* ---------------------------------------------------------
   6. SIMULADOR (funções puras, testáveis)
--------------------------------------------------------- */
const MercadoSimulador = {
  CENARIOS: [
    { id: "conservador", nome: "Conservador", taxaPadrao: "0,50" },
    { id: "intermediario", nome: "Intermediário", taxaPadrao: "0,80" },
    { id: "otimista", nome: "Otimista", taxaPadrao: "1,20" },
  ],
  MAX_MESES: 600,

  /**
   * Aportes no FINAL de cada mês:
   *   saldo(m) = saldo(m-1) × (1 + taxa) + aporte
   * A taxa chega em % e é convertida para decimal (÷100). Com taxa zero o
   * saldo é exatamente inicial + aporte × meses.
   */
  simular({ inicial, aporte, taxaPct, meses }) {
    const taxa = taxaPct / 100;
    const saldos = [inicial];
    const investido = [inicial];
    let saldo = inicial;
    for (let mes = 1; mes <= meses; mes++) {
      saldo = taxa === 0 ? inicial + aporte * mes : saldo * (1 + taxa) + aporte;
      saldos.push(saldo);
      investido.push(inicial + aporte * mes);
    }
    const totalInvestido = inicial + aporte * meses;
    return { saldos, investido, final: saldo, totalInvestido, rendimentos: saldo - totalInvestido };
  },

  /** Valida os campos (texto) e devolve valores numéricos ou os erros por campo. */
  validar({ inicial, aporte, prazo, unidade, taxas }) {
    const erros = {};
    const valores = { taxas: {} };

    const dinheiro = (campo, texto, rotulo) => {
      if (String(texto ?? "").trim() === "") {
        erros[campo] = `Informe o ${rotulo}.`;
        return;
      }
      const numero = MercadoFmt.lerNumero(texto);
      if (Number.isNaN(numero)) erros[campo] = `O ${rotulo} não é um número válido.`;
      else if (numero < 0) erros[campo] = `O ${rotulo} não pode ser negativo.`;
      else if (numero > 1e12) erros[campo] = `O ${rotulo} é grande demais.`;
      else valores[campo] = numero;
    };
    dinheiro("inicial", inicial, "valor inicial");
    dinheiro("aporte", aporte, "aporte mensal");
    if (valores.inicial === 0 && valores.aporte === 0) {
      erros.aporte = "Informe um valor inicial ou um aporte mensal maior que zero.";
    }

    if (String(prazo ?? "").trim() === "") {
      erros.prazo = "Informe o prazo.";
    } else {
      const numero = MercadoFmt.lerNumero(prazo);
      if (Number.isNaN(numero)) erros.prazo = "O prazo não é um número válido.";
      else if (!Number.isInteger(numero)) erros.prazo = "O prazo deve ser um número inteiro.";
      else if (numero < 1) erros.prazo = "O prazo deve ser de pelo menos 1.";
      else {
        const meses = unidade === "anos" ? numero * 12 : numero;
        if (meses > this.MAX_MESES) erros.prazo = "O prazo máximo é de 50 anos (600 meses).";
        else valores.meses = meses;
      }
    }

    this.CENARIOS.forEach((cenario) => {
      const texto = taxas[cenario.id];
      const campo = "taxa_" + cenario.id;
      if (String(texto ?? "").trim() === "") {
        erros[campo] = `Informe a taxa do cenário ${cenario.nome.toLowerCase()}.`;
        return;
      }
      const numero = MercadoFmt.lerNumero(texto);
      if (Number.isNaN(numero)) erros[campo] = `A taxa do cenário ${cenario.nome.toLowerCase()} não é um número válido.`;
      else if (numero < 0) erros[campo] = `A taxa do cenário ${cenario.nome.toLowerCase()} não pode ser negativa.`;
      else if (numero > 100) erros[campo] = `A taxa do cenário ${cenario.nome.toLowerCase()} não pode passar de 100% ao mês.`;
      else valores.taxas[cenario.id] = numero;
    });

    return { ok: Object.keys(erros).length === 0, erros, valores };
  },
};

/* ---------------------------------------------------------
   7. MÓDULO PRINCIPAL (estado, atualização, tela)
--------------------------------------------------------- */
const Mercado = {
  estado: {
    cambio: null,
    cripto: null,
    bolsa: null,
  },
  historicos: {}, // "cambio:USD" -> { pontos, consultadoEm, erro, carregando }
  selecao: { cambio: "USD", cripto: "BTC", bolsa: "PETR4" },
  conversor: { de: "USD", para: "BRL" },
  visaoTabela: "anual",
  _iniciado: false,
  _relogio: null,

  novoEstadoFonte(salvo) {
    return {
      dados: salvo && salvo.dados ? salvo.dados : null,
      consultadoEm: salvo && salvo.consultadoEm ? salvo.consultadoEm : 0,
      erro: null,
      carregando: false,
      emAndamento: null,
      falhas: 0,
      proximaTentativa: 0,
      ultimaTentativa: 0,
    };
  },

  /* ---------- inicialização ---------- */
  iniciar() {
    if (this._iniciado) return;
    this._iniciado = true;

    const cache = MercadoCache.ler();
    ["cambio", "cripto", "bolsa"].forEach((fonte) => {
      this.estado[fonte] = this.novoEstadoFonte(cache[fonte]);
    });
    Object.entries(cache.historicos || {}).forEach(([chave, valor]) => {
      if (valor && Array.isArray(valor.pontos)) {
        this.historicos[chave] = { pontos: valor.pontos, consultadoEm: valor.consultadoEm || 0, erro: null, carregando: false };
      }
    });

    this.ligarEventos();
    this.renderTudo();
    this.renderSimulador();

    this._relogio = setInterval(() => this.verificar(), MercadoConfig.verificacao);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.verificar();
    });
  },

  ligarEventos() {
    // botões "Atualizar" / "Tentar novamente"
    document.addEventListener("click", (evento) => {
      const botao = evento.target.closest && evento.target.closest("[data-mk-refresh]");
      if (botao) {
        this.atualizarManual(botao.dataset.mkRefresh);
        return;
      }
      const chip = evento.target.closest && evento.target.closest("[data-mk-chip]");
      if (chip) this.escolherAtivo(chip.dataset.tipo, chip.dataset.id);
    });

    // conversor
    const valor = document.getElementById("mkConvValor");
    const de = document.getElementById("mkConvDe");
    const para = document.getElementById("mkConvPara");
    if (valor && de && para) {
      valor.addEventListener("input", () => this.renderConversor());
      de.addEventListener("change", () => {
        this.conversor.de = de.value;
        this.renderConversor();
      });
      para.addEventListener("change", () => {
        this.conversor.para = para.value;
        this.renderConversor();
      });
      document.getElementById("mkConvInverter").addEventListener("click", () => {
        const antigoDe = de.value;
        de.value = para.value;
        para.value = antigoDe;
        this.conversor.de = de.value;
        this.conversor.para = para.value;
        this.renderConversor();
      });
    }

    // simulador
    const formulario = document.getElementById("simForm");
    if (formulario) {
      formulario.addEventListener("submit", (evento) => {
        evento.preventDefault();
        this.renderSimulador(true);
      });
      let adiar = null;
      formulario.addEventListener("input", () => {
        clearTimeout(adiar);
        adiar = setTimeout(() => this.renderSimulador(false), 220);
      });
      formulario.addEventListener("change", () => this.renderSimulador(false));
    }
    document.querySelectorAll("[data-mk-visao]").forEach((botao) => {
      botao.addEventListener("click", () => {
        this.visaoTabela = botao.dataset.mkVisao;
        this.renderSimulador(false);
      });
    });
  },

  /* ---------- ciclo de vida das telas ---------- */
  aoAbrir() {
    this.iniciar();
    this.renderTudo();
    this.verificar();
    ["cambio", "cripto", "bolsa"].forEach((tipo) => this.garantirHistorico(tipo));
    this.renderSimulador(false);
  },

  aoAbrirDashboard() {
    this.iniciar();
    this.renderResumoDashboard();
    this.verificar();
  },

  precisaDeDados() {
    return typeof State !== "undefined" && State.usuario && (State.view === "mercado" || State.view === "dashboard");
  },

  /* ---------- atualização ---------- */
  /** Confere o que venceu e atualiza. Usado pelo relógio, ao abrir telas e ao voltar à aba. */
  verificar() {
    if (document.hidden || !this.precisaDeDados()) return;
    const agora = Date.now();
    ["cambio", "cripto", "bolsa"].forEach((fonte) => {
      const est = this.estado[fonte];
      if (!est || est.carregando || agora < est.proximaTentativa) return;
      if (!est.dados || agora - est.consultadoEm >= MercadoConfig.ttl[fonte]) this.atualizar(fonte);
    });
  },

  atualizarManual(alvo) {
    const fontes = alvo === "todos" ? ["cambio", "cripto", "bolsa"] : [alvo];
    const agora = Date.now();
    const atualizadas = [];
    fontes.forEach((fonte) => {
      const est = this.estado[fonte];
      if (!est || est.carregando) return;
      if (agora - est.ultimaTentativa < MercadoConfig.esperaEntreManuais) return; // recém consultada: não insiste
      this.atualizar(fonte, { forcar: true });
      atualizadas.push(fonte);
    });
    if (atualizadas.length === 0 && typeof Toast !== "undefined") {
      Toast.mostrar("Já atualizado há instantes. Aguarde alguns segundos.", "info");
    }
    // o histórico só é refeito junto com a fonte que realmente foi atualizada
    atualizadas.forEach((tipo) => this.garantirHistorico(tipo, true));
  },

  atualizar(fonte, { forcar = false } = {}) {
    const est = this.estado[fonte];
    if (est.emAndamento) return est.emAndamento;
    if (!forcar && est.dados && Date.now() - est.consultadoEm < MercadoConfig.ttl[fonte]) return Promise.resolve(est.dados);

    est.carregando = true;
    est.ultimaTentativa = Date.now();
    this.renderFonte(fonte);

    const execucao = (async () => {
      try {
        const dados = fonte === "bolsa" ? await MercadoFontes.bolsa(est.dados) : await MercadoFontes[fonte]();
        est.dados = dados;
        est.consultadoEm = Date.now();
        est.erro = null;
        est.falhas = 0;
        est.proximaTentativa = 0;
        MercadoCache.gravar(fonte, { dados, consultadoEm: est.consultadoEm });
      } catch (erro) {
        // preserva a última cotação válida; só registra a falha
        est.erro = { tipo: erro.tipo || "desconhecido", mensagem: erro.message || "Falha ao atualizar." };
        est.falhas += 1;
        const base = MercadoConfig.ttl[fonte];
        const espera = erro.esperaMs || Math.min(base * Math.pow(2, Math.min(est.falhas, MercadoConfig.maxFalhasBackoff)), 15 * 60 * 1000);
        est.proximaTentativa = Date.now() + espera;
      } finally {
        est.carregando = false;
        est.emAndamento = null;
        this.renderFonte(fonte);
      }
    })();
    est.emAndamento = execucao;
    return execucao;
  },

  desatualizado(fonte) {
    const est = this.estado[fonte];
    if (!est || !est.dados) return false;
    if (est.erro) return true;
    return Date.now() - est.consultadoEm > MercadoConfig.ttl[fonte] * 3;
  },

  /* ---------- históricos ---------- */
  chaveHistorico(tipo, id) {
    return `${tipo}:${id}`;
  },

  async garantirHistorico(tipo, forcar = false) {
    if (typeof State === "undefined" || State.view !== "mercado") return;
    const id = this.selecao[tipo];
    if (tipo === "bolsa" && id === MercadoConfig.indice && !MercadoFontes.usaProxy()) return;
    const chave = this.chaveHistorico(tipo, id);
    let h = this.historicos[chave];
    if (!h) h = this.historicos[chave] = { pontos: null, consultadoEm: 0, erro: null, carregando: false };

    const valido = h.pontos && Date.now() - h.consultadoEm < MercadoConfig.ttl.historico;
    if (h.carregando || (valido && !forcar)) {
      this.renderHistorico(tipo);
      return;
    }
    h.carregando = true;
    h.erro = null;
    this.renderHistorico(tipo);
    try {
      const pontos =
        tipo === "cambio"
          ? await MercadoFontes.historicoCambio(`${id}-BRL`)
          : tipo === "cripto"
          ? await MercadoFontes.historicoCripto(id)
          : await MercadoFontes.historicoBolsa(id);
      h.pontos = pontos;
      h.consultadoEm = Date.now();
      const cache = MercadoCache.ler();
      const guardados = cache.historicos || {};
      guardados[chave] = { pontos, consultadoEm: h.consultadoEm };
      MercadoCache.gravar("historicos", guardados);
    } catch (erro) {
      h.erro = erro.message || "Não foi possível carregar o histórico.";
    } finally {
      h.carregando = false;
      this.renderHistorico(tipo);
    }
  },

  escolherAtivo(tipo, id) {
    if (!tipo || !id || this.selecao[tipo] === id) return;
    this.selecao[tipo] = id;
    this.renderChips(tipo);
    this.garantirHistorico(tipo);
  },

  /* ---------- renderização ---------- */
  renderTudo() {
    ["cambio", "cripto", "bolsa"].forEach((fonte) => this.renderFonte(fonte));
  },

  renderFonte(fonte) {
    try {
      if (fonte === "cambio") this.renderCambio();
      else if (fonte === "cripto") this.renderCripto();
      else this.renderBolsa();
      this.renderResumoDashboard();
    } catch (erro) {
      console.error("Nexora: falha ao desenhar o Mercado Financeiro.", erro);
    }
  },

  /** Monta o que um cartão precisa mostrar a partir do estado da fonte. */
  montarInfo(fonte, dado, formatarPreco) {
    const est = this.estado[fonte];
    const info = { preco: null, pct: null, hora: null, consultadoEm: est.consultadoEm || null, fonte: "", estado: "ok", mensagem: "", formatarPreco };
    if (dado) {
      info.preco = dado.preco;
      info.pct = dado.pct;
      info.hora = dado.hora;
      info.fonte = dado.fonte || (est.dados && est.dados.fonte) || "";
      if (this.desatualizado(fonte)) {
        info.estado = "stale";
        info.mensagem = "Desatualizado";
      } else if (dado.hora && Date.now() - dado.hora > 3 * 24 * 3600 * 1000) {
        info.mensagem = "Cotação com mais de 3 dias";
      }
    } else if (est.carregando || (!est.erro && !est.dados)) {
      info.estado = "carregando";
    } else {
      info.estado = "erro";
      info.mensagem = "Indisponível no momento";
    }
    return info;
  },

  pintarCartao(prefixo, v) {
    const raiz = document.getElementById(prefixo);
    if (!raiz) return;
    const preco = document.getElementById(prefixo + "-preco");
    const variacao = document.getElementById(prefixo + "-var");
    const hora = document.getElementById(prefixo + "-hora");
    const estado = document.getElementById(prefixo + "-estado");

    raiz.classList.toggle("is-loading", v.estado === "carregando");
    raiz.classList.toggle("is-stale", v.estado === "stale");
    raiz.classList.toggle("is-erro", v.estado === "erro");
    raiz.classList.toggle("is-indisponivel", v.estado === "indisponivel");
    raiz.setAttribute("aria-busy", v.estado === "carregando" ? "true" : "false");

    if (preco) {
      const texto = v.preco !== null && v.preco !== undefined ? v.formatarPreco(v.preco) : "—";
      if (preco.textContent !== texto) {
        const tinhaValor = preco.dataset.valor === "1";
        preco.textContent = texto;
        preco.dataset.valor = v.preco !== null && v.preco !== undefined ? "1" : "0";
        if (tinhaValor && v.preco !== null && !(typeof Movimento !== "undefined" && Movimento.reduzido())) {
          preco.classList.remove("mk-flash");
          void preco.offsetWidth;
          preco.classList.add("mk-flash");
        }
      }
    }

    if (variacao) {
      if (v.pct !== null && v.pct !== undefined && Number.isFinite(v.pct)) {
        const seta = v.pct > 0 ? "▲" : v.pct < 0 ? "▼" : "•";
        variacao.hidden = false;
        variacao.className = "mk-var " + (v.pct > 0 ? "is-up" : v.pct < 0 ? "is-down" : "is-flat");
        variacao.textContent = `${seta} ${MercadoFmt.pct(v.pct)}`;
        variacao.setAttribute("aria-label", `Variação de ${MercadoFmt.pct(v.pct)}`);
      } else {
        variacao.hidden = true;
      }
    }

    if (hora) {
      const linhas = [];
      if (v.hora) linhas.push(`Cotação: ${MercadoFmt.dataHora(v.hora)} (Brasília)`);
      if (v.consultadoEm) linhas.push(`Consultado às ${MercadoFmt.horaLocal(v.consultadoEm)}${v.fonte ? " · " + v.fonte : ""}`);
      if (!v.hora && !v.consultadoEm) linhas.push(v.estado === "carregando" ? "Carregando…" : "Sem dados");
      hora.textContent = linhas.join("\n");
    }

    if (estado) {
      estado.hidden = !v.mensagem;
      estado.textContent = v.mensagem || "";
    }
  },

  pintarMini(prefixo, v) {
    const raiz = document.getElementById(prefixo);
    if (!raiz) return;
    this.pintarCartao(prefixo, v);
    const hora = document.getElementById(prefixo + "-hora");
    if (!hora) return;
    if (v.estado === "indisponivel") hora.textContent = v.mensagem || "Indisponível";
    else if (v.estado === "erro") hora.textContent = "Indisponível no momento";
    else if (v.estado === "carregando") hora.textContent = "Carregando…";
    else {
      const base = v.hora ? `Cotação ${MercadoFmt.dataHora(v.hora)}` : v.consultadoEm ? `Consultado ${MercadoFmt.horaLocal(v.consultadoEm)}` : "";
      hora.textContent = v.estado === "stale" ? `Desatualizado${base ? " · " + base : ""}` : base;
    }
  },

  statusFonte(fonte) {
    const est = this.estado[fonte];
    if (est.carregando) return { texto: "Atualizando…", classe: "is-carregando" };
    if (est.dados && est.erro) return { texto: `Desatualizado · última consulta às ${MercadoFmt.horaLocal(est.consultadoEm)}`, classe: "is-stale" };
    if (est.dados) return { texto: `Atualizado às ${MercadoFmt.horaLocal(est.consultadoEm)}`, classe: "is-ok" };
    if (est.erro) return { texto: "Indisponível", classe: "is-erro" };
    return { texto: "Aguardando dados…", classe: "is-carregando" };
  },

  pintarStatusEAviso(fonte, ids) {
    const status = document.getElementById(ids.status);
    if (status) {
      const s = this.statusFonte(fonte);
      status.textContent = s.texto;
      status.className = "mk-status " + s.classe;
    }
    const botao = document.querySelector(`[data-mk-refresh="${fonte}"]`);
    if (botao) {
      botao.classList.toggle("is-loading", this.estado[fonte].carregando);
      botao.setAttribute("aria-busy", this.estado[fonte].carregando ? "true" : "false");
    }
    const aviso = document.getElementById(ids.aviso);
    if (!aviso) return;
    const est = this.estado[fonte];
    aviso.innerHTML = "";
    if (!est.erro) {
      aviso.classList.add("is-hidden");
      return;
    }
    const texto = document.createElement("span");
    texto.className = "mk-aviso-texto";
    texto.textContent = est.dados
      ? `${est.erro.mensagem} Mostrando a última cotação válida (consultada às ${MercadoFmt.horaLocal(est.consultadoEm)}).`
      : `${est.erro.mensagem} Ainda não há dados para mostrar.`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "secondary-btn mk-retry";
    retry.dataset.mkRefresh = fonte;
    retry.textContent = "Tentar novamente";
    aviso.append(texto, retry);
    aviso.classList.remove("is-hidden");
  },

  renderCambio() {
    const fmt = (v) => MercadoFmt.moeda(v, "BRL", 4);
    const d = this.estado.cambio.dados;
    this.pintarCartao("mk-usd", this.montarInfo("cambio", d && d.usd, fmt));
    this.pintarCartao("mk-eur", this.montarInfo("cambio", d && d.eur, fmt));
    this.pintarStatusEAviso("cambio", { status: "mkStatusCambio", aviso: "mkAvisoCambio" });
    this.renderConversor();
  },

  renderCripto() {
    const fmt = (v) => MercadoFmt.moeda(v, "BRL", 2);
    const d = this.estado.cripto.dados;
    this.pintarCartao("mk-btc", this.montarInfo("cripto", d && d.btc, fmt));
    this.pintarCartao("mk-eth", this.montarInfo("cripto", d && d.eth, fmt));
    this.pintarStatusEAviso("cripto", { status: "mkStatusCripto", aviso: "mkAvisoCripto" });
  },

  infoIbovespa() {
    const fmt = (v) => `${MercadoFmt.numero(v, 0)} pts`;
    if (!MercadoFontes.usaProxy()) {
      return { preco: null, pct: null, hora: null, consultadoEm: null, fonte: "", estado: "indisponivel", mensagem: "Requer configuração", formatarPreco: fmt };
    }
    const d = this.estado.bolsa.dados;
    const item = d && d.itens && d.itens[MercadoConfig.indice];
    const info = this.montarInfo("bolsa", item ? { ...item, fonte: "brapi" } : null, fmt);
    if (item) info.consultadoEm = item.consultadoEm;
    return info;
  },

  renderBolsa() {
    this.pintarCartao("mk-ibov", this.infoIbovespa());

    const nota = document.getElementById("mkNotaIbov");
    if (nota) nota.classList.toggle("is-hidden", MercadoFontes.usaProxy());

    // lista de ações
    const lista = document.getElementById("mkAcoesLista");
    const vazio = document.getElementById("mkAcoesVazio");
    const d = this.estado.bolsa.dados;
    const simbolos = MercadoFontes.listaBolsa().filter((s) => s !== MercadoConfig.indice);
    const temItens = d && d.itens && simbolos.some((s) => d.itens[s]);

    if (lista) {
      lista.innerHTML = "";
      const carregando = this.estado.bolsa.carregando && !temItens;
      lista.classList.toggle("is-loading", carregando);
      simbolos.forEach((simbolo) => {
        const item = d && d.itens && d.itens[simbolo];
        const linha = document.createElement("li");
        linha.className = "mk-acao" + (item ? "" : " is-sem-dado");

        const ticker = document.createElement("button");
        ticker.type = "button";
        ticker.className = "mk-acao-ticker";
        ticker.dataset.mkChip = "1";
        ticker.dataset.tipo = "bolsa";
        ticker.dataset.id = simbolo;
        ticker.setAttribute("aria-label", `Ver histórico de ${simbolo}`);
        ticker.textContent = simbolo;

        const nome = document.createElement("span");
        nome.className = "mk-acao-nome";
        nome.textContent = item ? item.nome : carregando ? "Carregando…" : "Indisponível";

        const preco = document.createElement("strong");
        preco.className = "mk-acao-preco";
        preco.textContent = item ? MercadoFmt.moeda(item.preco, item.moeda || "BRL", 2) : "—";

        const variacao = document.createElement("span");
        variacao.className = "mk-var";
        if (item && item.pct !== null) {
          variacao.classList.add(item.pct > 0 ? "is-up" : item.pct < 0 ? "is-down" : "is-flat");
          variacao.textContent = `${item.pct > 0 ? "▲" : item.pct < 0 ? "▼" : "•"} ${MercadoFmt.pct(item.pct)}`;
        } else {
          variacao.hidden = true;
        }

        const hora = document.createElement("span");
        hora.className = "mk-acao-hora";
        hora.textContent = item && item.hora ? MercadoFmt.dataHora(item.hora) : "";

        linha.append(ticker, nome, preco, variacao, hora);
        lista.appendChild(linha);
      });
    }
    if (vazio) vazio.classList.toggle("is-hidden", Boolean(temItens) || this.estado.bolsa.carregando);

    this.renderChips("bolsa");
    this.pintarStatusEAviso("bolsa", { status: "mkStatusBolsa", aviso: "mkAvisoBolsa" });
    // falhas pontuais (alguns ativos) com dados válidos nos demais
    const aviso = document.getElementById("mkAvisoBolsa");
    if (aviso && d && d.erros && Object.keys(d.erros).length > 0 && !this.estado.bolsa.erro) {
      aviso.textContent = `Sem dados agora para: ${Object.keys(d.erros).join(", ")}.`;
      aviso.classList.remove("is-hidden");
    }
  },

  renderResumoDashboard() {
    const brl4 = (v) => MercadoFmt.moeda(v, "BRL", 4);
    const brl2 = (v) => MercadoFmt.moeda(v, "BRL", 2);
    const cambio = this.estado.cambio && this.estado.cambio.dados;
    const cripto = this.estado.cripto && this.estado.cripto.dados;
    if (!this.estado.cambio) return;
    this.pintarMini("dm-usd", this.montarInfo("cambio", cambio && cambio.usd, brl4));
    this.pintarMini("dm-eur", this.montarInfo("cambio", cambio && cambio.eur, brl4));
    this.pintarMini("dm-btc", this.montarInfo("cripto", cripto && cripto.btc, brl2));
    this.pintarMini("dm-ibov", this.infoIbovespa());
  },

  /* ---------- conversor ---------- */
  taxasBRL() {
    const d = this.estado.cambio && this.estado.cambio.dados;
    if (!d) return null;
    return { BRL: { preco: 1, hora: null }, USD: d.usd, EUR: d.eur };
  },

  /** Conversão por BRL: valor × (BRL por unidade de origem) ÷ (BRL por unidade de destino). */
  calcularConversao(valor, de, para, taxas) {
    const origem = taxas[de];
    const destino = taxas[para];
    if (!origem || !destino) return null;
    const taxa = origem.preco / destino.preco;
    const horas = [origem.hora, destino.hora].filter(Boolean);
    return { resultado: valor * taxa, taxa, hora: horas.length ? Math.min(...horas) : null };
  },

  renderConversor() {
    const campoValor = document.getElementById("mkConvValor");
    const saida = document.getElementById("mkConvResultado");
    const detalhe = document.getElementById("mkConvDetalhe");
    const erro = document.getElementById("mkConvErro");
    if (!campoValor || !saida) return;
    const de = document.getElementById("mkConvDe").value;
    const para = document.getElementById("mkConvPara").value;
    const simbolos = { BRL: "BRL", USD: "USD", EUR: "EUR" };

    const mostrarErro = (texto) => {
      erro.textContent = texto;
      erro.hidden = !texto;
      campoValor.classList.toggle("has-error", Boolean(texto));
      campoValor.setAttribute("aria-invalid", texto ? "true" : "false");
    };

    const bruto = campoValor.value;
    const valor = MercadoFmt.lerNumero(bruto);
    if (String(bruto).trim() === "") {
      mostrarErro("Informe um valor para converter.");
      saida.textContent = "—";
      detalhe.textContent = "";
      return;
    }
    if (Number.isNaN(valor) || valor < 0) {
      mostrarErro(valor < 0 ? "O valor não pode ser negativo." : "Digite um número válido (ex.: 1.250,50).");
      saida.textContent = "—";
      detalhe.textContent = "";
      return;
    }
    mostrarErro("");

    const taxas = this.taxasBRL();
    const precisaUsd = de === "USD" || para === "USD";
    const precisaEur = de === "EUR" || para === "EUR";
    if (de !== para && (!taxas || (precisaUsd && !taxas.USD) || (precisaEur && !taxas.EUR))) {
      saida.textContent = "—";
      detalhe.textContent = this.estado.cambio && this.estado.cambio.carregando
        ? "Carregando cotações…"
        : "Cotação indisponível no momento. Use “Tentar novamente” acima.";
      return;
    }

    const calc = de === para ? { resultado: valor, taxa: 1, hora: null } : this.calcularConversao(valor, de, para, taxas);
    saida.textContent = MercadoFmt.moeda(calc.resultado, simbolos[para], 2);
    const casas = Math.abs(calc.taxa) >= 1 ? 4 : 6;
    const partes = [`Cotação usada: 1 ${de} = ${MercadoFmt.moeda(calc.taxa, simbolos[para], casas)}`];
    if (de !== para && calc.hora) partes.push(`Cotação de ${MercadoFmt.dataHora(calc.hora)} (Brasília)`);
    if (de !== para && this.estado.cambio.consultadoEm) partes.push(`consultada às ${MercadoFmt.horaLocal(this.estado.cambio.consultadoEm)}`);
    if (de !== para && this.desatualizado("cambio")) partes.push("⚠ cotação desatualizada");
    detalhe.textContent = partes.join(" · ");
  },

  /* ---------- gráficos históricos ---------- */
  opcoesAtivos(tipo) {
    if (tipo === "cambio") return [["USD", "Dólar (USD)"], ["EUR", "Euro (EUR)"]];
    if (tipo === "cripto") return [["BTC", "Bitcoin"], ["ETH", "Ethereum"]];
    const base = MercadoFontes.listaBolsa().map((s) => [s, s === MercadoConfig.indice ? "Ibovespa" : s]);
    return base;
  },

  renderChips(tipo) {
    const contenedor = document.getElementById("mkChips" + tipo.charAt(0).toUpperCase() + tipo.slice(1));
    if (!contenedor) return;
    contenedor.innerHTML = "";
    this.opcoesAtivos(tipo).forEach(([id, rotulo]) => {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "mk-chip" + (this.selecao[tipo] === id ? " is-active" : "");
      botao.dataset.mkChip = "1";
      botao.dataset.tipo = tipo;
      botao.dataset.id = id;
      botao.setAttribute("aria-pressed", String(this.selecao[tipo] === id));
      botao.textContent = rotulo;
      contenedor.appendChild(botao);
    });
  },

  /** Executa `fn` quando o Chart.js estiver disponível (ou marca a caixa como offline). */
  comChart(caixa, fn) {
    if (typeof Chart !== "undefined") {
      if (typeof Graficos !== "undefined") Graficos.configurarPadroes();
      fn();
      return;
    }
    caixa.classList.add("is-loading");
    (window.__chartPronto || Promise.resolve(false)).then((ok) => {
      caixa.classList.remove("is-loading");
      if (ok && typeof Chart !== "undefined") {
        Graficos.configurarPadroes();
        fn();
      } else {
        caixa.classList.add("is-offline");
      }
    });
  },

  renderHistorico(tipo) {
    const sufixo = tipo.charAt(0).toUpperCase() + tipo.slice(1);
    const canvas = document.getElementById("mkGrafico" + sufixo);
    const msg = document.getElementById("mkGrafico" + sufixo + "Msg");
    if (!canvas || !msg) return;
    const caixa = canvas.parentElement;
    this.renderChips(tipo);

    const id = this.selecao[tipo];
    const rotulo = tipo === "cambio" ? `${id}/BRL` : tipo === "cripto" ? `${id}/BRL` : id === MercadoConfig.indice ? "Ibovespa" : id;
    const titulo = document.getElementById("mkGrafico" + sufixo + "Titulo");
    if (titulo) titulo.textContent = `Histórico de 30 dias · ${rotulo}`;

    const mostrarMensagem = (texto, comRetry) => {
      msg.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = texto;
      msg.appendChild(p);
      if (comRetry) {
        const botao = document.createElement("button");
        botao.type = "button";
        botao.className = "secondary-btn mk-retry";
        botao.dataset.mkRefresh = tipo;
        botao.textContent = "Tentar novamente";
        msg.appendChild(botao);
      }
      msg.classList.remove("is-hidden");
      canvas.classList.add("is-hidden");
      if (typeof Graficos !== "undefined") Graficos.destruir("mk" + sufixo);
    };

    if (tipo === "bolsa" && id === MercadoConfig.indice && !MercadoFontes.usaProxy()) {
      mostrarMensagem("O histórico do Ibovespa exige o proxy da brapi (veja o README).", false);
      return;
    }

    const h = this.historicos[this.chaveHistorico(tipo, id)];
    if (!h || (h.carregando && !h.pontos)) {
      mostrarMensagem("Carregando histórico…", false);
      return;
    }
    if (!h.pontos) {
      mostrarMensagem(h.erro ? `Histórico indisponível: ${h.erro}` : "Histórico indisponível.", true);
      return;
    }

    msg.classList.add("is-hidden");
    canvas.classList.remove("is-hidden");
    const pontos = h.pontos;
    const dec = tipo === "cambio" ? 4 : 2;
    const ehIndice = tipo === "bolsa" && id === MercadoConfig.indice;
    const formatar = (v) => (ehIndice ? `${MercadoFmt.numero(v, 0)} pts` : MercadoFmt.moeda(v, "BRL", dec));
    const reduzido = typeof Movimento !== "undefined" && Movimento.reduzido();

    this.comChart(caixa, () => {
      Graficos.destruir("mk" + sufixo);
      Graficos.criar("mk" + sufixo, "mkGrafico" + sufixo, {
        type: "line",
        data: {
          labels: pontos.map((p) => MercadoFmt.diaMes(p.t)),
          datasets: [{
            label: rotulo,
            data: pontos.map((p) => p.v),
            borderColor: "#641E32",
            backgroundColor: "rgba(100, 30, 50, 0.10)",
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 5,
            borderWidth: 2.2,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reduzido ? false : { duration: 550, easing: "easeOutQuart" },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (ctx) => formatar(ctx.raw) } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
            y: { ticks: { callback: (v) => (ehIndice ? MercadoFmt.numero(v, 0) : MercadoFmt.numero(v, tipo === "cambio" ? 2 : 0)) } },
          },
        },
      });
    });

    // aviso discreto quando o histórico mostrado está velho
    const velho = h.erro && h.pontos;
    const nota = document.getElementById("mkGrafico" + sufixo + "Nota");
    if (nota) {
      nota.textContent = velho ? `Não foi possível atualizar o histórico; mostrando dados de ${MercadoFmt.horaLocal(h.consultadoEm)}.` : "";
      nota.hidden = !velho;
    }
  },

  /* ---------- simulador ---------- */
  lerCamposSimulador() {
    const valor = (id) => (document.getElementById(id) ? document.getElementById(id).value : "");
    return {
      inicial: valor("simInicial"),
      aporte: valor("simAporte"),
      prazo: valor("simPrazo"),
      unidade: valor("simUnidade"),
      taxas: {
        conservador: valor("simTaxaConservador"),
        intermediario: valor("simTaxaIntermediario"),
        otimista: valor("simTaxaOtimista"),
      },
    };
  },

  renderSimulador(focarNoErro = false) {
    const formulario = document.getElementById("simForm");
    if (!formulario) return;
    const resultado = MercadoSimulador.validar(this.lerCamposSimulador());

    const mapaCampos = {
      inicial: "simInicial",
      aporte: "simAporte",
      prazo: "simPrazo",
      taxa_conservador: "simTaxaConservador",
      taxa_intermediario: "simTaxaIntermediario",
      taxa_otimista: "simTaxaOtimista",
    };
    Object.entries(mapaCampos).forEach(([campo, id]) => {
      const el = document.getElementById(id);
      const erro = resultado.erros[campo];
      el.classList.toggle("has-error", Boolean(erro));
      el.setAttribute("aria-invalid", erro ? "true" : "false");
    });

    const msg = document.getElementById("simMensagem");
    const corpo = document.getElementById("simResultados");
    const lista = Object.values(resultado.erros);
    if (!resultado.ok) {
      msg.textContent = lista[0] + (lista.length > 1 ? ` (+${lista.length - 1} ${lista.length - 1 === 1 ? "outro problema" : "outros problemas"})` : "");
      msg.classList.remove("is-success");
      msg.classList.add("is-error");
      corpo.classList.add("is-hidden");
      if (focarNoErro) {
        const primeiro = Object.keys(resultado.erros)[0];
        const alvo = document.getElementById(mapaCampos[primeiro]);
        if (alvo) alvo.focus();
      }
      return;
    }
    msg.textContent = "";
    msg.classList.remove("is-error", "is-success");
    corpo.classList.remove("is-hidden");

    const { inicial, aporte, meses, taxas } = resultado.valores;
    const cenarios = MercadoSimulador.CENARIOS.map((c) => ({
      ...c,
      taxa: taxas[c.id],
      ...MercadoSimulador.simular({ inicial, aporte, taxaPct: taxas[c.id], meses }),
    }));

    // cartões dos cenários
    cenarios.forEach((c) => {
      const set = (sufixo, texto) => {
        const el = document.getElementById(`sim-${c.id}-${sufixo}`);
        if (el) el.textContent = texto;
      };
      set("taxa", `${MercadoFmt.numero(c.taxa, 2)}% ao mês`);
      set("investido", MercadoFmt.moeda(c.totalInvestido));
      set("rendimentos", MercadoFmt.moeda(c.rendimentos));
      set("final", MercadoFmt.moeda(c.final));
    });
    document.getElementById("simPrazoTexto").textContent =
      `Prazo: ${meses} ${meses === 1 ? "mês" : "meses"}${meses >= 12 ? ` (${MercadoFmt.numero(meses / 12, meses % 12 === 0 ? 0 : 1)} ${meses === 12 ? "ano" : "anos"})` : ""}`;

    this.renderGraficoSimulador(cenarios, meses);
    this.renderTabelaSimulador(cenarios, meses);
  },

  renderGraficoSimulador(cenarios, meses) {
    const canvas = document.getElementById("simGrafico");
    if (!canvas) return;
    // com a tela oculta não há o que medir: o gráfico é desenhado quando a página abre
    if (typeof State !== "undefined" && State.view !== "mercado") return;
    const caixa = canvas.parentElement;
    const passo = Math.max(1, Math.ceil(meses / 120));
    const indices = [];
    for (let m = 0; m <= meses; m += passo) indices.push(m);
    if (indices[indices.length - 1] !== meses) indices.push(meses);
    const rotulo = (m) => (m === 0 ? "Início" : m % 12 === 0 ? `Ano ${m / 12}` : `Mês ${m}`);
    const cores = { conservador: "#D5A3B1", intermediario: "#8E3A50", otimista: "#35121E" };
    const reduzido = typeof Movimento !== "undefined" && Movimento.reduzido();

    const datasets = cenarios.map((c) => ({
      label: c.nome,
      data: indices.map((m) => c.saldos[m]),
      borderColor: cores[c.id],
      backgroundColor: cores[c.id],
      borderWidth: 2.2,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0.2,
    }));
    datasets.push({
      label: "Total investido",
      data: indices.map((m) => cenarios[0].investido[m]),
      borderColor: "#827780",
      backgroundColor: "#827780",
      borderDash: [6, 4],
      borderWidth: 1.8,
      pointRadius: 0,
      pointHoverRadius: 4,
      tension: 0,
    });

    this.comChart(caixa, () => {
      Graficos.destruir("mkSimulador");
      Graficos.criar("mkSimulador", "simGrafico", {
        type: "line",
        data: { labels: indices.map(rotulo), datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reduzido ? false : { duration: 450, easing: "easeOutQuart" },
          interaction: { mode: "index", intersect: false },
          plugins: {
            legend: { position: "top", align: "end", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14, font: { size: 11 } } },
            tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${MercadoFmt.moeda(ctx.raw)}` } },
          },
          scales: {
            x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
            y: { beginAtZero: true, ticks: { callback: (v) => Formato.moedaCompacta(v) } },
          },
        },
      });
    });
  },

  renderTabelaSimulador(cenarios, meses) {
    const corpo = document.getElementById("simTabelaCorpo");
    if (!corpo) return;
    document.querySelectorAll("[data-mk-visao]").forEach((botao) => {
      const ativo = botao.dataset.mkVisao === this.visaoTabela;
      botao.classList.toggle("is-active", ativo);
      botao.setAttribute("aria-pressed", String(ativo));
    });

    const periodos = [];
    if (this.visaoTabela === "mensal") {
      for (let m = 1; m <= meses; m++) periodos.push(m);
    } else {
      for (let m = 12; m <= meses; m += 12) periodos.push(m);
      if (periodos[periodos.length - 1] !== meses) periodos.push(meses);
    }

    corpo.innerHTML = "";
    const fragmento = document.createDocumentFragment();
    periodos.forEach((m) => {
      const linha = document.createElement("tr");
      const celulas = [
        this.visaoTabela === "mensal" ? `Mês ${m}` : m % 12 === 0 ? `Ano ${m / 12}` : `Mês ${m}`,
        MercadoFmt.moeda(cenarios[0].investido[m]),
        ...cenarios.map((c) => MercadoFmt.moeda(c.saldos[m])),
      ];
      celulas.forEach((texto, indice) => {
        const celula = document.createElement(indice === 0 ? "th" : "td");
        if (indice === 0) celula.scope = "row";
        celula.textContent = texto;
        linha.appendChild(celula);
      });
      fragmento.appendChild(linha);
    });
    corpo.appendChild(fragmento);
  },
};
