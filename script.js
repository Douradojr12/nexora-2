/* =========================================================
   NEXORA — script.js
   Etapa 1: estrutura visual + arquitetura de dados.
   Etapa 2: cadastro, login e separação de dados por usuário.
   Etapa 3: dashboard com navegação e módulo de receitas.
   Etapa 4: módulo de despesas + saldo com alerta de déficit.
   ========================================================= */

"use strict";

/* ---------------------------------------------------------
   1. CAMADA DE DADOS (localStorage)

   Chaves usadas:
   - "cofre:usuarios" -> lista de contas cadastradas
   - "cofre:sessao"   -> id do usuário logado no momento (ou nada)
   - "cofre:dados:<idUsuario>" -> dados financeiros DAQUELE usuário
     (receitas, despesas, parcelas), separados por conta.
--------------------------------------------------------- */
const Storage = {
  CHAVE_USUARIOS: "cofre:usuarios",
  CHAVE_SESSAO: "cofre:sessao",
  PREFIXO_DADOS: "cofre:dados:",

  /** Formato do objeto de dados financeiros de UM usuário. */
  defaultData() {
    return {
      versao: 1,
      criadoEm: new Date().toISOString(),
      receitas: [],   // preenchido pelo módulo de receitas
      despesas: [],   // preenchido pelo módulo de despesas
      parcelas: [],   // preenchido pelo módulo de parcelas
      cartoes: [],        // cartões de crédito cadastrados
      comprasCartao: [],  // compras feitas nos cartões (formam as faturas)
    };
  },

  // ---------- usuários ----------
  listarUsuarios() {
    try {
      const bruto = localStorage.getItem(this.CHAVE_USUARIOS);
      return bruto ? JSON.parse(bruto) : [];
    } catch (erro) {
      console.error("Nexora: não foi possível ler os usuários cadastrados.", erro);
      return [];
    }
  },

  salvarUsuarios(usuarios) {
    try {
      localStorage.setItem(this.CHAVE_USUARIOS, JSON.stringify(usuarios));
      return true;
    } catch (erro) {
      console.error("Nexora: não foi possível salvar os usuários.", erro);
      return false;
    }
  },

  // ---------- sessão (quem está logado agora) ----------
  obterSessao() {
    return localStorage.getItem(this.CHAVE_SESSAO);
  },

  definirSessao(idUsuario) {
    localStorage.setItem(this.CHAVE_SESSAO, idUsuario);
  },

  encerrarSessao() {
    localStorage.removeItem(this.CHAVE_SESSAO);
  },

  // ---------- dados financeiros (por usuário) ----------
  carregar(idUsuario) {
    try {
      const bruto = localStorage.getItem(this.PREFIXO_DADOS + idUsuario);
      if (!bruto) return this.defaultData();
      const dados = JSON.parse(bruto);
      // garante que arrays de módulos futuros sempre existam,
      // mesmo em dados salvos por uma etapa anterior do projeto
      if (!Array.isArray(dados.receitas)) dados.receitas = [];
      if (!Array.isArray(dados.despesas)) dados.despesas = [];
      if (!Array.isArray(dados.parcelas)) dados.parcelas = [];
      if (!Array.isArray(dados.cartoes)) dados.cartoes = [];
      if (!Array.isArray(dados.comprasCartao)) dados.comprasCartao = [];
      return dados;
    } catch (erro) {
      console.error("Nexora: não foi possível ler os dados salvos.", erro);
      return this.defaultData();
    }
  },

  salvar(idUsuario, dados) {
    try {
      localStorage.setItem(this.PREFIXO_DADOS + idUsuario, JSON.stringify(dados));
      return true;
    } catch (erro) {
      console.error("Nexora: não foi possível salvar os dados.", erro);
      return false;
    }
  },
};

/* ---------------------------------------------------------
   2. AUTENTICAÇÃO (local, sem servidor)

   Observação importante: como ainda não existe um back-end,
   a senha é apenas ofuscada com um hash simples antes de ir
   para o localStorage. Isso evita guardar a senha em texto
   puro, mas NÃO é segurança de verdade — quando o projeto
   ganhar um servidor, a senha deve ser validada e protegida
   por lá (ex.: bcrypt), e este hash local deve ser removido.
--------------------------------------------------------- */
const Auth = {
  hashSenha(senha) {
    let hash = 0;
    for (let i = 0; i < senha.length; i++) {
      hash = (hash << 5) - hash + senha.charCodeAt(i);
      hash |= 0;
    }
    return "h" + Math.abs(hash).toString(36);
  },

  normalizarEmail(email) {
    return email.trim().toLowerCase();
  },

  emailValido(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  buscarPorEmail(email) {
    const emailNormalizado = this.normalizarEmail(email);
    return Storage.listarUsuarios().find((usuario) => usuario.email === emailNormalizado) || null;
  },

  /** Cria uma conta nova. Retorna { ok, erro, usuario }. */
  cadastrar({ nome, email, senha, confirmarSenha }) {
    nome = (nome || "").trim();
    const emailNormalizado = this.normalizarEmail(email || "");

    if (!nome) return { ok: false, erro: "Informe seu nome." };
    if (!emailNormalizado || !this.emailValido(emailNormalizado)) {
      return { ok: false, erro: "Informe um e-mail válido." };
    }
    if (!senha || senha.length < 6) {
      return { ok: false, erro: "A senha precisa ter pelo menos 6 caracteres." };
    }
    if (senha !== confirmarSenha) {
      return { ok: false, erro: "As senhas não coincidem." };
    }
    if (this.buscarPorEmail(emailNormalizado)) {
      return { ok: false, erro: "Já existe uma conta com este e-mail." };
    }

    const usuarios = Storage.listarUsuarios();
    const usuario = {
      id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      nome,
      email: emailNormalizado,
      senha: this.hashSenha(senha),
      criadoEm: new Date().toISOString(),
    };

    usuarios.push(usuario);
    Storage.salvarUsuarios(usuarios);
    Storage.salvar(usuario.id, Storage.defaultData());

    return { ok: true, usuario };
  },

  /** Autentica um usuário existente. Retorna { ok, erro, usuario }. */
  login({ email, senha }) {
    const emailNormalizado = this.normalizarEmail(email || "");

    if (!emailNormalizado || !senha) {
      return { ok: false, erro: "Preencha e-mail e senha." };
    }

    const usuario = this.buscarPorEmail(emailNormalizado);
    if (!usuario || usuario.senha !== this.hashSenha(senha)) {
      return { ok: false, erro: "E-mail ou senha incorretos." };
    }

    return { ok: true, usuario };
  },

  usuarioLogado() {
    const id = Storage.obterSessao();
    if (!id) return null;
    return Storage.listarUsuarios().find((usuario) => usuario.id === id) || null;
  },

  sair() {
    Storage.encerrarSessao();
  },
};

/* ---------------------------------------------------------
   3. FORMATAÇÃO (Real brasileiro)
--------------------------------------------------------- */
const Formato = {
  moeda(valor) {
    return valor.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  },

  /** Valores curtos para os eixos dos gráficos: R$ 850, R$ 1,5 mil, R$ 12 mil. */
  moedaCompacta(valor) {
    const abs = Math.abs(valor);
    const sinal = valor < 0 ? "-" : "";
    if (abs >= 1000) {
      return `${sinal}R$ ${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
    }
    return `${sinal}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
  },

  MESES: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],

  /** "2026-10" -> "Out/2026" (ou "Out/26" no formato curto). */
  mesAno(chave, curto = false) {
    const [ano, mes] = chave.split("-");
    return `${this.MESES[Number(mes) - 1]}/${curto ? ano.slice(2) : ano}`;
  },

  dataPorExtenso(data) {
    const texto = data.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  },

  dataCurta(isoDate) {
    // isoDate no formato "AAAA-MM-DD" (o que o <input type="date"> gera)
    const [ano, mes, dia] = isoDate.split("-");
    return `${dia}/${mes}/${ano}`;
  },

  dataHojeISO() {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, "0");
    const dia = String(hoje.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  },

  iniciais(nome) {
    const partes = nome.trim().split(/\s+/);
    const primeira = partes[0]?.[0] || "";
    const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
    return (primeira + ultima).toUpperCase();
  },

  primeiroNome(nome) {
    return nome.trim().split(/\s+/)[0];
  },
};

/* ---------------------------------------------------------
   4. RESUMO FINANCEIRO
   saldo = total de receitas - total de despesas.
   Quando o módulo de parcelas existir, pode entrar aqui também.
--------------------------------------------------------- */
/**
 * Despesas "efetivas" do usuário: os lançamentos da aba Despesas MAIS o valor
 * da parcela de cada compra parcelada ainda não quitada (aba Parcelas).
 * Cada compra em andamento entra como uma despesa da categoria "Parcelas",
 * datada de hoje (o valor que está saindo agora). Compras finalizadas
 * (0 parcelas restantes) deixam de pesar. Nada disso é gravado em disco:
 * é calculado na hora, então os dados salvos continuam com o mesmo formato.
 */
function todasAsDespesas(dados) {
  const hoje = Formato.dataHojeISO();
  const doParcelamento = dados.parcelas
    .filter((item) => item.parcelasRestantes > 0)
    .map((item) => ({
      id: "parcela-" + item.id,
      descricao: `${item.descricao} (parcela)`,
      valor: item.valorParcela,
      data: hoje,
      categoria: "Parcelas",
      origem: "parcela",
    }));
  return [...dados.despesas, ...doParcelamento];
}

function calcularResumo(dados) {
  const totalReceitas = dados.receitas.reduce((soma, item) => soma + (item.valor || 0), 0);
  const totalDespesas = todasAsDespesas(dados).reduce((soma, item) => soma + (item.valor || 0), 0);
  const saldo = totalReceitas - totalDespesas;

  return { totalReceitas, totalDespesas, saldo };
}

/**
 * Quanto da renda (receitas) já está comprometido com despesas, em %.
 * Retorna null quando não há receitas cadastradas (não dá para calcular).
 */
function calcularPercentualComprometido(totalReceitas, totalDespesas) {
  if (!totalReceitas || totalReceitas <= 0) return null;
  return (totalDespesas / totalReceitas) * 100;
}

/** Categoria de despesa com maior valor somado. Retorna null se não há despesas. */
function calcularMaiorCategoriaDeGasto(despesas) {
  if (despesas.length === 0) return null;

  const porCategoria = {};
  despesas.forEach((item) => {
    porCategoria[item.categoria] = (porCategoria[item.categoria] || 0) + (item.valor || 0);
  });

  let categoria = null;
  let valor = -Infinity;
  Object.entries(porCategoria).forEach(([nomeCategoria, soma]) => {
    if (soma > valor) {
      categoria = nomeCategoria;
      valor = soma;
    }
  });

  return { categoria, valor };
}

/** Mensagem amigável sobre a saúde financeira do usuário, para o Dashboard. */
function montarMensagemInteligente({ totalReceitas, totalDespesas, saldo, percentual }) {
  if (totalReceitas === 0 && totalDespesas === 0) {
    return {
      tipo: "neutro",
      texto: "Cadastre suas receitas e despesas para ver como está sua situação financeira.",
    };
  }
  if (saldo < 0) {
    return { tipo: "negativo", texto: "Suas despesas estão maiores que suas receitas." };
  }
  if (percentual !== null && percentual >= 80) {
    return {
      tipo: "alerta",
      texto: `Seu saldo está positivo, mas suas despesas já comprometem ${Math.round(percentual)}% da sua renda.`,
    };
  }
  return { tipo: "positivo", texto: "Seu saldo está positivo." };
}

/**
 * Filtra uma lista de lançamentos (receitas ou despesas) pelos critérios
 * informados. Qualquer campo vazio/ausente em `filtros` é ignorado.
 * @param {Array} lista
 * @param {{mes?:string, ano?:string, categoria?:string, status?:string, busca?:string}} filtros
 */
function aplicarFiltros(lista, filtros) {
  const { mes, ano, categoria, status, busca } = filtros;
  const buscaNormalizada = (busca || "").trim().toLowerCase();

  return lista.filter((item) => {
    if (mes && item.data && item.data.slice(5, 7) !== mes) return false;
    if (ano && item.data && item.data.slice(0, 4) !== ano) return false;
    if (categoria && item.categoria !== categoria) return false;
    if (status && item.status !== status) return false;
    if (buscaNormalizada && !item.descricao.toLowerCase().includes(buscaNormalizada)) return false;
    return true;
  });
}

/** Mantém apenas os itens de um mês/ano específicos (usado nos Relatórios). */
function filtrarPorMesAno(lista, mes, ano) {
  return lista.filter((item) => item.data && item.data.slice(5, 7) === mes && item.data.slice(0, 4) === ano);
}

/**
 * Preenche um <select> com anos (do ano atual - 5 até o ano atual + 1).
 * Chamado uma única vez na inicialização — por isso é seguro reconstruir
 * as opções sem perder nada que o usuário já tenha escolhido.
 */
function popularSelectAnos(selectEl, { incluirTodos = true } = {}) {
  const anoAtual = new Date().getFullYear();
  let html = incluirTodos ? '<option value="">Todos os anos</option>' : "";
  for (let ano = anoAtual - 5; ano <= anoAtual + 1; ano++) {
    html += `<option value="${ano}">${ano}</option>`;
  }
  selectEl.innerHTML = html;
}

/* ---------------------------------------------------------
   4b. MOVIMENTO
   Respeita a preferência do sistema por menos animações: quando
   ela está ligada, nada é animado (valores, gráficos, modal...).
--------------------------------------------------------- */
const Movimento = {
  reduzido() {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  },
};

/* ---------------------------------------------------------
   4c. REVELAÇÃO POR ROLAGEM
   Um único IntersectionObserver para toda a plataforma (sem listeners de
   scroll). Só usa transform/opacity. Elementos marcados com .rv aparecem ao
   entrar na tela (de baixo para cima, ou de cima para baixo se entrarem
   rolando para cima), em cascata quando vários entram juntos. Os marcados
   com .rv-depth perdem opacidade aos poucos ao sair pelo topo (nunca abaixo
   de 40%) e voltam ao subir. Sem IntersectionObserver ou com movimento
   reduzido, nada é escondido: o conteúdo aparece normalmente.
--------------------------------------------------------- */
const Reveal = {
  _io: null,
  _ativo: false,

  iniciar() {
    if (this._io || Movimento.reduzido() || typeof IntersectionObserver === "undefined") return;
    this._io = new IntersectionObserver((entradas) => this.aoObservar(entradas), {
      threshold: [0, 0.15, 0.35, 0.55, 0.75, 1],
      rootMargin: "0px 0px -6% 0px",
    });
    this._ativo = true;
    document.documentElement.classList.add("rv-ready");

    // se a preferência de movimento reduzido for ligada com a página aberta, tudo fica visível
    const preferencia = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (preferencia.addEventListener) {
      preferencia.addEventListener("change", () => {
        if (preferencia.matches) this.desligar();
      });
    }
  },

  /** Marca um elemento para ser revelado; devolve false se o sistema não está ativo. */
  registrar(el, { profundidade = false } = {}) {
    if (!this._ativo) return false;
    el.classList.add("rv");
    if (profundidade) el.classList.add("rv-depth");
    this._io.observe(el);
    return true;
  },

  aoObservar(entradas) {
    const novos = [];
    entradas.forEach((entrada) => {
      const el = entrada.target;
      const revelado = el.classList.contains("is-in");
      if (entrada.isIntersecting && !revelado) novos.push(entrada);
      if (revelado && el.classList.contains("rv-depth")) this.ajustarProfundidade(entrada);
    });

    // quem entra junto aparece em sequência, na ordem em que está na tela
    novos.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top || a.boundingClientRect.left - b.boundingClientRect.left);
    novos.forEach((entrada, indice) => {
      const el = entrada.target;
      const vindoDeCima = entrada.boundingClientRect.top < 0;
      el.style.setProperty("--rv-y", (vindoDeCima ? -22 : 26) + "px");
      el.style.setProperty("--rv-delay", Math.min(indice * 70, 420) + "ms");
      el.classList.add("is-in");
      this.aoRevelar(el);
    });
  },

  /** Saindo pelo topo: opacidade cai com a parte visível (altos demais não são penalizados). */
  ajustarProfundidade(entrada) {
    const raiz = entrada.rootBounds;
    if (!raiz) return;
    let opacidade = 1;
    if (entrada.boundingClientRect.top < raiz.top) {
      const base = Math.min(entrada.boundingClientRect.height, raiz.height) || 1;
      const visivel = Math.max(0, Math.min(1, entrada.intersectionRect.height / base));
      opacidade = 0.4 + 0.6 * visivel;
    }
    entrada.target.style.setProperty("--rv-fade", opacidade.toFixed(2));
  },

  /** Gráficos tocam a animação de entrada quando aparecem na tela (não escondidos abaixo da dobra). */
  aoRevelar(el) {
    if (typeof Chart === "undefined" || typeof Chart.getChart !== "function") return;
    el.querySelectorAll("canvas").forEach((canvas) => {
      try {
        const grafico = Chart.getChart(canvas);
        if (grafico) {
          grafico.reset();
          grafico.update();
        }
      } catch (erro) {
        /* animação é só enfeite: nunca deve atrapalhar */
      }
    });
  },

  /** Ao trocar de tela: o que ficou na tela anterior volta a "não revelado" (a entrada se repete na volta). */
  trocouDeTela() {
    if (!this._ativo) return;
    document.querySelectorAll(".view.is-hidden .rv.is-in").forEach((el) => el.classList.remove("is-in"));
    setTimeout(() => this.garantir(), 1200);
  },

  /** Rede de segurança: nada que esteja visível na tela pode ficar escondido. */
  garantir() {
    if (!this._ativo) return;
    const altura = window.innerHeight;
    document.querySelectorAll(".rv:not(.is-in)").forEach((el) => {
      if (el.offsetParent === null) return;
      const caixa = el.getBoundingClientRect();
      if (caixa.bottom > 0 && caixa.top < altura) el.classList.add("is-in");
    });
  },

  desligar() {
    this._ativo = false;
    document.documentElement.classList.remove("rv-ready");
    if (this._io) {
      this._io.disconnect();
      this._io = null;
    }
  },
};

/* ---------------------------------------------------------
   5. ESTADO DA APLICAÇÃO (em memória, após login)
--------------------------------------------------------- */
const State = {
  usuario: null,
  dados: null,
  view: "dashboard",
  editandoReceitaId: null,
  editandoDespesaId: null,
  editandoParcelaId: null,
  editandoCartaoId: null,
  editandoCompraId: null,
  cartaoSelecionadoId: null,
  faturaSelecionada: null,
};

function persistirDados() {
  Storage.salvar(State.usuario.id, State.dados);
}

/* ---------------------------------------------------------
   6. MÓDULO DE RECEITAS (CRUD)
--------------------------------------------------------- */
const Receitas = {
  gerarId() {
    return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  /** Valida os campos do formulário. Retorna { ok, erro, receita }. */
  validar({ descricao, valor, data, categoria }) {
    descricao = (descricao || "").trim();
    const valorNumerico = parseFloat(valor);

    if (!descricao) return { ok: false, erro: "Informe uma descrição para a receita." };
    if (!valor || isNaN(valorNumerico) || valorNumerico <= 0) {
      return { ok: false, erro: "Informe um valor válido, maior que zero." };
    }
    if (!data) return { ok: false, erro: "Informe a data da receita." };
    if (!categoria) return { ok: false, erro: "Selecione uma categoria." };

    return {
      ok: true,
      receita: { descricao, valor: valorNumerico, data, categoria },
    };
  },

  adicionar(dados, receita) {
    dados.receitas.push({ id: this.gerarId(), ...receita });
  },

  editar(dados, id, receita) {
    const item = dados.receitas.find((item) => item.id === id);
    if (item) Object.assign(item, receita);
  },

  excluir(dados, id) {
    dados.receitas = dados.receitas.filter((item) => item.id !== id);
  },

  buscar(dados, id) {
    return dados.receitas.find((item) => item.id === id) || null;
  },

  /** Mais recentes primeiro. */
  ordenadas(dados) {
    return [...dados.receitas].sort((a, b) => (a.data < b.data ? 1 : -1));
  },
};

/* ---------------------------------------------------------
   7. MÓDULO DE DESPESAS (CRUD)
--------------------------------------------------------- */
const Despesas = {
  gerarId() {
    return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  /** Valida os campos do formulário. Retorna { ok, erro, despesa }. */
  validar({
    descricao,
    valor,
    data,
    categoria,
    formaPagamento,
    status,
    fixa,
    totalParcelas,
    parcelasRestantes,
  }) {
    descricao = (descricao || "").trim();
    const valorNumerico = parseFloat(valor);
    const totalParcelasNumerico = parseInt(totalParcelas, 10);
    const parcelasRestantesNumerico = parseInt(parcelasRestantes, 10);

    if (!descricao) return { ok: false, erro: "Informe uma descrição para a despesa." };
    if (!valor || isNaN(valorNumerico) || valorNumerico <= 0) {
      return { ok: false, erro: "Informe um valor válido, maior que zero." };
    }
    if (!data) return { ok: false, erro: "Informe a data da despesa." };
    if (!categoria) return { ok: false, erro: "Selecione uma categoria." };
    if (!formaPagamento) return { ok: false, erro: "Selecione a forma de pagamento." };
    if (!status) return { ok: false, erro: "Selecione o status da despesa." };
    if (!totalParcelas || isNaN(totalParcelasNumerico) || totalParcelasNumerico < 1) {
      return { ok: false, erro: "O total de parcelas precisa ser 1 ou mais." };
    }
    if (parcelasRestantes === "" || parcelasRestantes === null || isNaN(parcelasRestantesNumerico) || parcelasRestantesNumerico < 0) {
      return { ok: false, erro: "As parcelas restantes precisam ser 0 ou mais." };
    }
    if (parcelasRestantesNumerico > totalParcelasNumerico) {
      return { ok: false, erro: "As parcelas restantes não podem ser maiores que o total de parcelas." };
    }

    return {
      ok: true,
      despesa: {
        descricao,
        valor: valorNumerico,
        data,
        categoria,
        formaPagamento,
        // sem parcelas restantes não há o que pagar: a despesa está quitada
        status: parcelasRestantesNumerico === 0 ? "Pago" : status,
        fixa: fixa === "sim",
        totalParcelas: totalParcelasNumerico,
        parcelasRestantes: parcelasRestantesNumerico,
      },
    };
  },

  adicionar(dados, despesa) {
    dados.despesas.push({ id: this.gerarId(), ...despesa });
  },

  // ---------- "Já paguei" ----------
  /**
   * Situação de pagamento, calculada a partir dos campos que já existiam
   * (status, totalParcelas, parcelasRestantes) — nada é guardado em duplicidade.
   * Em compra parcelada, `valor` é o total da compra e cada parcela é valor ÷
   * parcelas (em centavos; a diferença de arredondamento fica na última).
   */
  situacao(despesa) {
    const total = Math.max(1, Number(despesa.totalParcelas) || 1);
    const centavos = total > 1 ? Cartoes.parcelasEmCentavos(despesa.valor, total) : [Math.round(despesa.valor * 100)];
    const restantes = Number.isFinite(Number(despesa.parcelasRestantes)) ? Number(despesa.parcelasRestantes) : total;
    const quitada = despesa.status === "Pago" || restantes <= 0;
    const pagasQtd = quitada ? total : total > 1 ? Math.min(total, Math.max(0, total - restantes)) : 0;
    const somar = (lista) => lista.reduce((soma, c) => soma + c, 0);
    const pagoCentavos = somar(centavos.slice(0, pagasQtd));
    return {
      total,
      parcelado: total > 1,
      quitada,
      pagasQtd,
      restantes: total - pagasQtd,
      parcelaAtual: Math.min(total, pagasQtd + 1),
      valorParcela: centavos[Math.min(pagasQtd, total - 1)] / 100, // parcela que será paga no próximo clique
      pago: pagoCentavos / 100,
      pendente: (somar(centavos) - pagoCentavos) / 100,
    };
  },

  _travas: new Map(),

  /**
   * Registra o pagamento de UMA parcela (ou da despesa única). Clique duplo /
   * toque duplo na mesma despesa em menos de 0,8 s conta uma vez só.
   */
  registrarPagamento(dados, id, hoje = Formato.dataHojeISO()) {
    const despesa = this.buscar(dados, id);
    if (!despesa) return { ok: false, erro: "Despesa não encontrada." };
    const agora = Date.now();
    if (agora - (this._travas.get(id) || 0) < 800) return { ok: false, duplicado: true };

    const situacao = this.situacao(despesa);
    if (situacao.quitada) return { ok: false, erro: "Esta despesa já está quitada." };
    this._travas.set(id, agora);

    const pagamento = {
      numero: situacao.parcelaAtual,
      valor: situacao.valorParcela,
      pagoEm: hoje,
      registradoEm: new Date().toISOString(),
    };
    despesa.pagamentos = Array.isArray(despesa.pagamentos) ? despesa.pagamentos : [];
    despesa.pagamentos.push(pagamento);
    despesa.parcelasRestantes = situacao.total - pagamento.numero;
    const concluida = despesa.parcelasRestantes <= 0;
    if (concluida) {
      despesa.parcelasRestantes = 0;
      despesa.status = "Pago";
    }
    return { ok: true, pagamento, concluida, despesa, parcelas: situacao.total };
  },

  /** Desfaz o ÚLTIMO pagamento (se `registradoEm` for informado, só se for exatamente aquele). */
  desfazerPagamento(dados, id, registradoEm) {
    const despesa = this.buscar(dados, id);
    const lista = despesa && Array.isArray(despesa.pagamentos) ? despesa.pagamentos : [];
    if (lista.length === 0) return { ok: false, erro: "Não há pagamento para desfazer." };
    const ultimo = lista[lista.length - 1];
    if (registradoEm && ultimo.registradoEm !== registradoEm) {
      return { ok: false, erro: "Só o último pagamento pode ser desfeito." };
    }
    lista.pop();
    const total = Math.max(1, Number(despesa.totalParcelas) || 1);
    despesa.parcelasRestantes = total - (ultimo.numero - 1);
    despesa.status = "Pendente";
    this._travas.delete(id);
    return { ok: true, pagamento: ultimo, despesa };
  },

  /** Totais para o resumo da tela: quanto falta pagar e quanto já foi pago (sempre somam o valor lançado). */
  resumoPagamentos(dados) {
    const r = { pendente: 0, pago: 0, qtdPendentes: 0, qtdPagas: 0 };
    dados.despesas.forEach((despesa) => {
      const s = this.situacao(despesa);
      r.pendente += s.pendente;
      r.pago += s.pago;
      if (s.quitada) r.qtdPagas += 1;
      else r.qtdPendentes += 1;
    });
    r.pendente = Math.round(r.pendente * 100) / 100;
    r.pago = Math.round(r.pago * 100) / 100;
    return r;
  },

  editar(dados, id, despesa) {
    const item = dados.despesas.find((item) => item.id === id);
    if (item) Object.assign(item, despesa);
  },

  excluir(dados, id) {
    dados.despesas = dados.despesas.filter((item) => item.id !== id);
  },

  buscar(dados, id) {
    return dados.despesas.find((item) => item.id === id) || null;
  },

  /** Mais recentes primeiro. */
  ordenadas(dados) {
    return [...dados.despesas].sort((a, b) => (a.data < b.data ? 1 : -1));
  },
};

/* ---------------------------------------------------------
   8. MÓDULO DE PARCELAS (compras parceladas)

   Propositalmente simples: não é um sistema de financiamento.
   Cada registro só guarda descrição, valor da parcela, total de
   parcelas e quantas ainda faltam. O status "Finalizada" é sempre
   calculado a partir de parcelasRestantes, nunca guardado à parte,
   para não correr o risco de os dois ficarem incoerentes.
--------------------------------------------------------- */
const Parcelas = {
  gerarId() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  /** Valida os campos do formulário. Retorna { ok, erro, parcela }. */
  validar({ descricao, valorParcela, totalParcelas, parcelasRestantes }) {
    descricao = (descricao || "").trim();
    const valorNumerico = parseFloat(valorParcela);
    const totalNumerico = parseInt(totalParcelas, 10);
    const restantesNumerico = parseInt(parcelasRestantes, 10);

    if (!descricao) return { ok: false, erro: "Informe uma descrição para a compra." };
    if (!valorParcela || isNaN(valorNumerico) || valorNumerico <= 0) {
      return { ok: false, erro: "Informe o valor da parcela, maior que zero." };
    }
    if (!totalParcelas || isNaN(totalNumerico) || totalNumerico < 1) {
      return { ok: false, erro: "O total de parcelas precisa ser 1 ou mais." };
    }
    if (parcelasRestantes === "" || isNaN(restantesNumerico) || restantesNumerico < 0) {
      return { ok: false, erro: "Informe quantas parcelas ainda faltam (0 ou mais)." };
    }
    if (restantesNumerico > totalNumerico) {
      return { ok: false, erro: "As parcelas restantes não podem ser maiores que o total de parcelas." };
    }

    return {
      ok: true,
      parcela: {
        descricao,
        valorParcela: valorNumerico,
        totalParcelas: totalNumerico,
        parcelasRestantes: restantesNumerico,
      },
    };
  },

  status(parcela) {
    return parcela.parcelasRestantes <= 0 ? "Finalizada" : "Em andamento";
  },

  adicionar(dados, parcela) {
    dados.parcelas.push({ id: this.gerarId(), ...parcela });
  },

  editar(dados, id, parcela) {
    const item = dados.parcelas.find((item) => item.id === id);
    if (item) Object.assign(item, parcela);
  },

  excluir(dados, id) {
    dados.parcelas = dados.parcelas.filter((item) => item.id !== id);
  },

  buscar(dados, id) {
    return dados.parcelas.find((item) => item.id === id) || null;
  },

  /** Diminui uma parcela restante (nunca abaixo de zero). */
  diminuirUma(dados, id) {
    const item = this.buscar(dados, id);
    if (item && item.parcelasRestantes > 0) item.parcelasRestantes -= 1;
  },

  /** Não finalizadas primeiro, depois por quantas parcelas ainda faltam (mais faltam primeiro). */
  ordenadas(dados) {
    return [...dados.parcelas].sort((a, b) => {
      const aFinalizada = a.parcelasRestantes <= 0;
      const bFinalizada = b.parcelasRestantes <= 0;
      if (aFinalizada !== bFinalizada) return aFinalizada ? 1 : -1;
      return b.parcelasRestantes - a.parcelasRestantes;
    });
  },

  /** Total de parcelas ainda a pagar e valor mensal comprometido (só compras não finalizadas). */
  resumo(dados) {
    const ativas = dados.parcelas.filter((item) => item.parcelasRestantes > 0);
    const totalParcelasPendentes = ativas.reduce((soma, item) => soma + item.parcelasRestantes, 0);
    const valorMensal = ativas.reduce((soma, item) => soma + item.valorParcela, 0);
    return { totalParcelasPendentes, valorMensal };
  },
};

/* ---------------------------------------------------------
   8b. MÓDULO DE CARTÕES DE CRÉDITO

   Conceitos mantidos SEPARADOS de propósito:
   - "despesa registrada": o que você lança na aba Despesas (dinheiro que
     realmente saiu). É o que alimenta o saldo.
   - "fatura do cartão": o conjunto de compras/parcelas do cartão que
     vence em uma data. Compras no cartão NÃO viram despesas sozinhas;
     quando a fatura é paga, o pagamento é registrado como despesa.
   Assim a mesma compra nunca é contada duas vezes.

   Só duas listas são gravadas: dados.cartoes e dados.comprasCartao.
   Faturas, limites e vencimentos são calculados na hora.

   Regras de calendário:
   - Compra feita até o dia de fechamento (inclusive) entra na fatura que
     fecha naquele mês; depois disso, na fatura do mês seguinte.
   - Se o dia de vencimento é MAIOR que o de fechamento, a fatura vence no
     mesmo mês em que fecha; senão, vence no mês seguinte.
   - Dias que não existem no mês (ex.: 31 em fevereiro) usam o último dia.
   - Uma compra parcelada cai uma parcela por fatura, em meses seguidos.
   - Fatura com vencimento já passado é considerada paga (não pesa no
     limite utilizado).
--------------------------------------------------------- */
const Cartoes = {
  gerarId(prefixo) {
    return prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  // ---------- validação ----------
  validarCartao({ nome, banco, limite, diaFechamento, diaVencimento }) {
    nome = (nome || "").trim();
    banco = (banco || "").trim();
    const limiteNumerico = parseFloat(limite);
    const fechamento = parseInt(diaFechamento, 10);
    const vencimento = parseInt(diaVencimento, 10);

    if (!nome) return { ok: false, erro: "Informe o nome do cartão." };
    if (!banco) return { ok: false, erro: "Informe a instituição ou banco." };
    if (!limite || isNaN(limiteNumerico) || limiteNumerico <= 0) {
      return { ok: false, erro: "Informe o limite total, maior que zero." };
    }
    if (isNaN(fechamento) || fechamento < 1 || fechamento > 31) {
      return { ok: false, erro: "O dia de fechamento precisa estar entre 1 e 31." };
    }
    if (isNaN(vencimento) || vencimento < 1 || vencimento > 31) {
      return { ok: false, erro: "O dia de vencimento precisa estar entre 1 e 31." };
    }

    return {
      ok: true,
      cartao: { nome, banco, limite: limiteNumerico, diaFechamento: fechamento, diaVencimento: vencimento },
    };
  },

  validarCompra({ cartaoId, descricao, valor, data, parcelas, categoria }) {
    descricao = (descricao || "").trim();
    const valorNumerico = parseFloat(valor);
    const parcelasNumerico = parseInt(parcelas, 10);

    if (!cartaoId) return { ok: false, erro: "Cadastre e selecione um cartão primeiro." };
    if (!descricao) return { ok: false, erro: "Informe uma descrição para a compra." };
    if (!valor || isNaN(valorNumerico) || valorNumerico <= 0) {
      return { ok: false, erro: "Informe um valor válido, maior que zero." };
    }
    if (!data) return { ok: false, erro: "Informe a data da compra." };
    if (isNaN(parcelasNumerico) || parcelasNumerico < 1 || parcelasNumerico > 48) {
      return { ok: false, erro: "O número de parcelas precisa estar entre 1 e 48." };
    }
    if (!categoria) return { ok: false, erro: "Selecione uma categoria." };

    return {
      ok: true,
      compra: { cartaoId, descricao, valor: valorNumerico, data, parcelas: parcelasNumerico, categoria },
    };
  },

  // ---------- CRUD ----------
  adicionarCartao(dados, cartao) {
    const novo = { id: this.gerarId("c"), ...cartao };
    dados.cartoes.push(novo);
    return novo;
  },
  editarCartao(dados, id, cartao) {
    const item = dados.cartoes.find((c) => c.id === id);
    if (item) Object.assign(item, cartao);
  },
  /** Excluir um cartão também exclui as compras dele. */
  excluirCartao(dados, id) {
    dados.cartoes = dados.cartoes.filter((c) => c.id !== id);
    dados.comprasCartao = dados.comprasCartao.filter((c) => c.cartaoId !== id);
  },
  adicionarCompra(dados, compra) {
    dados.comprasCartao.push({ id: this.gerarId("k"), ...compra });
  },
  editarCompra(dados, id, compra) {
    const item = dados.comprasCartao.find((c) => c.id === id);
    if (item) Object.assign(item, compra);
  },
  excluirCompra(dados, id) {
    dados.comprasCartao = dados.comprasCartao.filter((c) => c.id !== id);
  },
  comprasDoCartao(dados, cartaoId) {
    return dados.comprasCartao
      .filter((c) => c.cartaoId === cartaoId)
      .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
  },

  // ---------- calendário ("YYYY-MM" = chave de mês) ----------
  pad(numero) {
    return String(numero).padStart(2, "0");
  },
  ultimoDia(ano, mes) {
    return new Date(ano, mes, 0).getDate(); // mes de 1 a 12
  },
  somarMeses(chave, quantidade) {
    const [ano, mes] = chave.split("-").map(Number);
    const total = ano * 12 + (mes - 1) + quantidade;
    return `${Math.floor(total / 12)}-${this.pad((total % 12) + 1)}`;
  },
  dataNoMes(chave, dia) {
    const [ano, mes] = chave.split("-").map(Number);
    return `${chave}-${this.pad(Math.min(dia, this.ultimoDia(ano, mes)))}`;
  },
  /** Em qual fatura (chave do mês de fechamento) cai uma compra feita nesta data. */
  chaveDaData(cartao, isoData) {
    const [ano, mes, dia] = isoData.split("-").map(Number);
    const fechamentoNoMes = Math.min(cartao.diaFechamento, this.ultimoDia(ano, mes));
    const chave = `${ano}-${this.pad(mes)}`;
    return dia <= fechamentoNoMes ? chave : this.somarMeses(chave, 1);
  },
  fechamentoDaFatura(cartao, chave) {
    return this.dataNoMes(chave, cartao.diaFechamento);
  },
  vencimentoDaFatura(cartao, chave) {
    const mesDoVencimento = cartao.diaVencimento > cartao.diaFechamento ? chave : this.somarMeses(chave, 1);
    return this.dataNoMes(mesDoVencimento, cartao.diaVencimento);
  },

  /** Divide o valor em parcelas (em centavos); a diferença de arredondamento vai para a última. */
  parcelasEmCentavos(valor, quantidade) {
    const total = Math.round(valor * 100);
    const base = Math.floor(total / quantidade);
    const resto = total - base * quantidade;
    return Array.from({ length: quantidade }, (_, i) => base + (i === quantidade - 1 ? resto : 0));
  },

  // ---------- faturas ----------
  /** { "2026-10": { chave, itens: [...], totalCentavos } } com todas as parcelas do cartão. */
  mapaDeFaturas(dados, cartao) {
    const mapa = {};
    dados.comprasCartao
      .filter((compra) => compra.cartaoId === cartao.id)
      .forEach((compra) => {
        const primeira = this.chaveDaData(cartao, compra.data);
        this.parcelasEmCentavos(compra.valor, compra.parcelas).forEach((centavos, indice) => {
          const chave = this.somarMeses(primeira, indice);
          if (!mapa[chave]) mapa[chave] = { chave, itens: [], totalCentavos: 0 };
          mapa[chave].itens.push({
            compraId: compra.id,
            descricao: compra.descricao,
            categoria: compra.categoria,
            data: compra.data,
            numero: indice + 1,
            totalParcelas: compra.parcelas,
            valor: centavos / 100,
          });
          mapa[chave].totalCentavos += centavos;
        });
      });
    return mapa;
  },

  montarFatura(cartao, mapa, chave, chaveAtual) {
    const base = mapa[chave] || { chave, itens: [], totalCentavos: 0 };
    return {
      chave,
      itens: base.itens,
      total: base.totalCentavos / 100,
      fechamento: this.fechamentoDaFatura(cartao, chave),
      vencimento: this.vencimentoDaFatura(cartao, chave),
      status: chave < chaveAtual ? "fechada" : chave === chaveAtual ? "atual" : "futura",
    };
  },

  /**
   * Tudo o que a tela precisa de um cartão: limites, fatura atual, próximo
   * vencimento e a linha do tempo de faturas (fechada aguardando vencimento,
   * atual e as próximas).
   */
  resumo(dados, cartao, hoje = Formato.dataHojeISO()) {
    const mapa = this.mapaDeFaturas(dados, cartao);
    const chaveAtual = this.chaveDaData(cartao, hoje);
    const chaveAnterior = this.somarMeses(chaveAtual, -1);

    // limite utilizado = tudo que ainda vai vencer (fatura fechada + atual + futuras)
    const usadoCentavos = Object.values(mapa)
      .filter((fatura) => this.vencimentoDaFatura(cartao, fatura.chave) >= hoje)
      .reduce((soma, fatura) => soma + fatura.totalCentavos, 0);
    const usado = usadoCentavos / 100;

    const anteriorAindaAberta = this.vencimentoDaFatura(cartao, chaveAnterior) >= hoje;
    const inicio = anteriorAindaAberta ? chaveAnterior : chaveAtual;
    const ultimaComCompra = Object.keys(mapa).sort().pop() || chaveAtual;
    let fim = this.somarMeses(chaveAtual, 3);
    if (ultimaComCompra > fim) fim = ultimaComCompra;

    const linhaDoTempo = [];
    for (let chave = inicio; chave <= fim && linhaDoTempo.length < 60; chave = this.somarMeses(chave, 1)) {
      linhaDoTempo.push(this.montarFatura(cartao, mapa, chave, chaveAtual));
    }

    return {
      limite: cartao.limite,
      usado,
      disponivel: cartao.limite - usado,
      percentual: cartao.limite > 0 ? (usado / cartao.limite) * 100 : 0,
      cicloAtual: chaveAtual,
      faturaAtual: this.montarFatura(cartao, mapa, chaveAtual, chaveAtual),
      proximoVencimento: linhaDoTempo[0],
      linhaDoTempo,
    };
  },

  /** Soma de todos os cartões, para o Dashboard. */
  resumoGeral(dados, hoje = Formato.dataHojeISO()) {
    const geral = { limite: 0, usado: 0, faturaAtual: 0, proximasFaturas: 0, proximo: null };
    dados.cartoes.forEach((cartao) => {
      const r = this.resumo(dados, cartao, hoje);
      geral.limite += r.limite;
      geral.usado += r.usado;
      geral.faturaAtual += r.faturaAtual.total;
      geral.proximasFaturas += r.proximoVencimento.total;
      if (!geral.proximo || r.proximoVencimento.vencimento < geral.proximo.data) {
        geral.proximo = {
          data: r.proximoVencimento.vencimento,
          total: r.proximoVencimento.total,
          cartaoNome: cartao.nome,
        };
      }
    });
    geral.disponivel = geral.limite - geral.usado;
    return geral;
  },
};

/* ---------------------------------------------------------
   9. GRÁFICOS DO DASHBOARD (Chart.js)

   Os três gráficos são recriados (destruídos + desenhados de novo)
   toda vez que o Dashboard é exibido ou os dados mudam — como o
   projeto é pequeno, isso é mais simples e confiável do que tentar
   atualizar cada gráfico "no lugar", e o custo é imperceptível.
--------------------------------------------------------- */
const Graficos = {
  // paleta derivada das cores já usadas no restante do app
  PALETA_CATEGORIAS: [
    "#641E32", "#D5A3B1", "#9B4A5F", "#35121E", "#C98B9B",
    "#7E3447", "#E6C4CD", "#A8707E", "#4B1A29", "#B88A6A", "#8E7C84",
  ],

  instancias: {
    receitasDespesas: null,
    categorias: null,
    evolucaoSaldo: null,
    relResumo: null,
    relCategorias: null,
    relAnual: null,
  },

  configurarPadroes() {
    if (typeof Chart === "undefined") return;
    try {
      this.aplicarPadroes();
    } catch (erro) {
      console.error("Nexora: não foi possível aplicar o estilo padrão dos gráficos.", erro);
    }
  },

  aplicarPadroes() {
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = "#5F555C";
    Chart.defaults.plugins.tooltip.backgroundColor = "#292126";
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
    Chart.defaults.plugins.tooltip.titleFont = { weight: "600" };
    Chart.defaults.animation.duration = 650;
    Chart.defaults.animation.easing = "easeOutQuart";
    Chart.defaults.scale.grid.color = "rgba(41, 33, 38, 0.06)";
    Chart.defaults.scale.border.display = false;
    Chart.defaults.scale.ticks.font = { size: 11 };
    if (Movimento.reduzido()) Chart.defaults.animation = false;
  },

  /** Entrada em cascata (barra a barra / ponto a ponto), curta e suave. */
  animacaoEscalonada() {
    if (Movimento.reduzido()) return false;
    return {
      duration: 600,
      easing: "easeOutQuart",
      delay: (ctx) => (ctx.type === "data" && ctx.mode === "default" ? ctx.dataIndex * 55 : 0),
    };
  },

  /** Sem o Chart.js (ex.: sem internet) mostra um aviso em vez de caixas vazias. */
  marcarOffline() {
    document.querySelectorAll(".chart-canvas-wrap").forEach((caixa) => {
      caixa.classList.remove("is-loading");
      caixa.classList.add("is-offline");
    });
  },

  /** Desenha um gráfico; se algo der errado nele, os outros continuam funcionando. */
  criar(chave, idCanvas, configuracao) {
    try {
      const canvas = document.getElementById(idCanvas);
      this.instancias[chave] = new Chart(canvas.getContext("2d"), configuracao);
    } catch (erro) {
      this.instancias[chave] = null;
      console.error(`Nexora: não foi possível desenhar o gráfico "${chave}".`, erro);
    }
  },

  /**
   * O Chart.js ainda não chegou (internet lenta) ou não carregou: mostra o
   * "carregando", espera o carregador da página e desenha assim que ele estiver pronto.
   */
  aguardarBiblioteca() {
    const caixas = document.querySelectorAll(".chart-canvas-wrap");
    caixas.forEach((caixa) => {
      caixa.classList.remove("is-offline");
      caixa.classList.add("is-loading");
    });
    if (this._aguardando) return;
    this._aguardando = true;

    const pronta = window.__chartPronto || Promise.resolve(typeof Chart !== "undefined");
    pronta.then((ok) => {
      this._aguardando = false;
      caixas.forEach((caixa) => caixa.classList.remove("is-loading"));
      if (!ok || typeof Chart === "undefined") {
        this.marcarOffline();
        return;
      }
      this.configurarPadroes();
      if (!State.dados) return;
      if (State.view === "dashboard") UI.renderDashboard();
      else if (State.view === "relatorios") UI.renderRelatorios();
      // nas outras telas os gráficos são desenhados quando o usuário abrir o Painel
    });
  },

  destruir(chave) {
    if (this.instancias[chave]) {
      this.instancias[chave].destroy();
      this.instancias[chave] = null;
    }
  },

  /** Recalcula e redesenha os três gráficos a partir dos dados atuais. */
  atualizar(dados) {
    if (typeof Chart === "undefined") { this.aguardarBiblioteca(); return; } // ainda carregando (ou sem internet)

    this.atualizarReceitasDespesas(dados);
    this.atualizarCategorias(dados);
    this.atualizarEvolucaoSaldo(dados);
  },

  atualizarReceitasDespesas(dados) {
    const { totalReceitas, totalDespesas } = calcularResumo(dados);
    const semDados = totalReceitas === 0 && totalDespesas === 0;

    document.getElementById("graficoReceitasDespesasEmpty").classList.toggle("is-hidden", !semDados);
    document.getElementById("graficoReceitasDespesas").classList.toggle("is-hidden", semDados);

    this.destruir("receitasDespesas");
    if (semDados) return;

        this.criar("receitasDespesas", "graficoReceitasDespesas", {
      type: "bar",
      data: {
        labels: ["Receitas", "Despesas"],
        datasets: [{
          data: [totalReceitas, totalDespesas],
          backgroundColor: ["#641E32", "#D5A3B1"],
          borderRadius: 10,
          borderSkipped: false,
          maxBarThickness: 72,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: this.animacaoEscalonada(),
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => Formato.moeda(ctx.raw) } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: (v) => Formato.moeda(v) } },
        },
      },
    });
  },

  atualizarCategorias(dados) {
    const despesas = todasAsDespesas(dados);
    const semDados = despesas.length === 0;
    document.getElementById("graficoCategoriasEmpty").classList.toggle("is-hidden", !semDados);
    document.getElementById("graficoCategorias").classList.toggle("is-hidden", semDados);

    this.destruir("categorias");
    if (semDados) return;

    const porCategoria = {};
    despesas.forEach((item) => {
      porCategoria[item.categoria] = (porCategoria[item.categoria] || 0) + (item.valor || 0);
    });

    const labels = Object.keys(porCategoria);
    const valores = Object.values(porCategoria);

        this.criar("categorias", "graficoCategorias", {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: valores,
          backgroundColor: labels.map((_, i) => this.PALETA_CATEGORIAS[i % this.PALETA_CATEGORIAS.length]),
          borderWidth: 3,
          borderColor: "#FFFFFF",
          borderRadius: 6,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14, font: { size: 11 } } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${Formato.moeda(ctx.raw)}` } },
        },
      },
    });
  },

  /** Mostra/esconde o canvas e a mensagem de "sem dados" de um gráfico. */
  alternarVazio(idCanvas, semDados) {
    document.getElementById(idCanvas + "Empty").classList.toggle("is-hidden", !semDados);
    document.getElementById(idCanvas).classList.toggle("is-hidden", semDados);
  },

  /**
   * Gráficos de colunas da página de Relatórios.
   * Os dois primeiros seguem o mês/ano escolhidos; o terceiro mostra o ano
   * inteiro, mês a mês. As parcelas em andamento entram como despesas.
   */
  atualizarRelatorios(dados, mes, ano) {
    if (typeof Chart === "undefined") { this.aguardarBiblioteca(); return; }

    const despesasTodas = todasAsDespesas(dados);
    const receitasPeriodo = filtrarPorMesAno(dados.receitas, mes, ano);
    const despesasPeriodo = filtrarPorMesAno(despesasTodas, mes, ano);
    const somar = (lista) => lista.reduce((total, item) => total + (item.valor || 0), 0);
    const totalReceitas = somar(receitasPeriodo);
    const totalDespesas = somar(despesasPeriodo);
    const saldo = totalReceitas - totalDespesas;

    const opcoes = (comLegenda) => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: this.animacaoEscalonada(),
      plugins: {
        legend: comLegenda
          ? { position: "top", align: "end", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 14, font: { size: 11 } } }
          : { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => (ctx.dataset.label ? ctx.dataset.label + ": " : "") + Formato.moeda(ctx.raw),
          },
        },
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (v) => Formato.moedaCompacta(v) } },
      },
    });

    // 1) Receitas x despesas x saldo do mês
    const semResumo = totalReceitas === 0 && totalDespesas === 0;
    this.alternarVazio("graficoRelResumo", semResumo);
    this.destruir("relResumo");
    if (!semResumo) {
      this.criar("relResumo", "graficoRelResumo", {
        type: "bar",
        data: {
          labels: ["Receitas", "Despesas", "Saldo"],
          datasets: [{
            data: [totalReceitas, totalDespesas, saldo],
            backgroundColor: ["#641E32", "#D5A3B1", saldo >= 0 ? "#35121E" : "#BC5047"],
            borderRadius: 10,
            borderSkipped: false,
            maxBarThickness: 72,
          }],
        },
        options: opcoes(false),
      });
    }

    // 2) Gastos por categoria (colunas, da maior para a menor)
    const porCategoria = {};
    despesasPeriodo.forEach((item) => {
      porCategoria[item.categoria] = (porCategoria[item.categoria] || 0) + (item.valor || 0);
    });
    const categorias = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);
    this.alternarVazio("graficoRelCategorias", categorias.length === 0);
    this.destruir("relCategorias");
    if (categorias.length > 0) {
      this.criar("relCategorias", "graficoRelCategorias", {
        type: "bar",
        data: {
          labels: categorias.map(([nome]) => nome),
          datasets: [{
            data: categorias.map(([, valor]) => valor),
            backgroundColor: categorias.map((_, i) => this.PALETA_CATEGORIAS[i % this.PALETA_CATEGORIAS.length]),
            borderRadius: 8,
            borderSkipped: false,
            maxBarThickness: 56,
          }],
        },
        options: opcoes(false),
      });
    }

    // 3) Mês a mês no ano escolhido (receitas x despesas)
    const receitasPorMes = new Array(12).fill(0);
    const despesasPorMes = new Array(12).fill(0);
    const acumular = (lista, destino) => {
      lista.forEach((item) => {
        if (item.data && item.data.slice(0, 4) === ano) {
          destino[parseInt(item.data.slice(5, 7), 10) - 1] += item.valor || 0;
        }
      });
    };
    acumular(dados.receitas, receitasPorMes);
    acumular(despesasTodas, despesasPorMes);

    const semAno = receitasPorMes.every((v) => v === 0) && despesasPorMes.every((v) => v === 0);
    this.alternarVazio("graficoRelAnual", semAno);
    this.destruir("relAnual");
    if (!semAno) {
      this.criar("relAnual", "graficoRelAnual", {
        type: "bar",
        data: {
          labels: ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],
          datasets: [
            { label: "Receitas", data: receitasPorMes, backgroundColor: "#641E32", borderRadius: 6, borderSkipped: false, maxBarThickness: 22 },
            { label: "Despesas", data: despesasPorMes, backgroundColor: "#D5A3B1", borderRadius: 6, borderSkipped: false, maxBarThickness: 22 },
          ],
        },
        options: opcoes(true),
      });
    }
  },

  atualizarEvolucaoSaldo(dados) {
    const despesas = todasAsDespesas(dados);
    const semDados = dados.receitas.length === 0 && despesas.length === 0;
    document.getElementById("graficoEvolucaoSaldoEmpty").classList.toggle("is-hidden", !semDados);
    document.getElementById("graficoEvolucaoSaldo").classList.toggle("is-hidden", semDados);

    this.destruir("evolucaoSaldo");
    if (semDados) return;

    const eventos = [
      ...dados.receitas.map((item) => ({ data: item.data, valor: item.valor })),
      ...despesas.map((item) => ({ data: item.data, valor: -item.valor })),
    ].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

    let acumulado = 0;
    const porData = {};
    eventos.forEach((evento) => {
      acumulado += evento.valor;
      porData[evento.data] = acumulado; // mesma data = fica com o acumulado mais recente
    });

    const datasIso = Object.keys(porData);
    const valoresAcumulados = Object.values(porData);

        this.criar("evolucaoSaldo", "graficoEvolucaoSaldo", {
      type: "line",
      data: {
        labels: datasIso.map(Formato.dataCurta),
        datasets: [{
          data: valoresAcumulados,
          borderColor: "#641E32",
          backgroundColor: "rgba(100, 30, 50, 0.10)",
          fill: true,
          tension: 0.3,
          pointRadius: 3,
          pointHoverRadius: 6,
          borderWidth: 2.5,
          pointBackgroundColor: "#FFFFFF",
          pointBorderColor: "#641E32",
          pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: this.animacaoEscalonada(),
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => Formato.moeda(ctx.raw) } },
        },
        scales: {
          x: { grid: { display: false } },
          y: { ticks: { callback: (v) => Formato.moeda(v) } },
        },
      },
    });
  },
};

/* ---------------------------------------------------------
   9b. NOTIFICAÇÕES (toasts) E MODAL DE CONFIRMAÇÃO
   Camada puramente visual: mostra feedback ao usuário e pede
   confirmação antes de excluir. Não altera nenhum dado.
--------------------------------------------------------- */
const Toast = {
  ICONES: {
    sucesso: '<path d="M20 6 9 17l-5-5"/>',
    erro: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  },

  mostrar(mensagem, tipo = "sucesso", duracao = 3200, acao = null) {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${tipo}`;
    toast.style.setProperty("--duracao", duracao + "ms");
    toast.setAttribute("role", tipo === "erro" ? "alert" : "status");
    toast.innerHTML =
      '<span class="toast-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      (this.ICONES[tipo] || this.ICONES.info) +
      '</svg></span><span class="toast-texto"></span>';
    toast.querySelector(".toast-texto").textContent = mensagem;

    const remover = () => {
      if (!toast.isConnected || toast.classList.contains("is-leaving")) return;
      toast.classList.add("is-leaving");
      setTimeout(() => toast.remove(), 240);
    };
    toast.addEventListener("click", remover);

    if (acao && acao.rotulo) {
      const botao = document.createElement("button");
      botao.type = "button";
      botao.className = "toast-acao";
      botao.textContent = acao.rotulo;
      botao.addEventListener("click", (evento) => {
        evento.stopPropagation();
        remover();
        acao.aoClicar();
      });
      toast.appendChild(botao);
    }

    container.appendChild(toast);
    while (container.children.length > 3) container.firstElementChild.remove(); // no máximo 3 na tela
    setTimeout(remover, duracao);
  },
};

const Modal = {
  /**
   * Abre o modal de confirmação. `aoConfirmar` só roda se a pessoa clicar
   * no botão de confirmar; Esc, clique fora ou "Cancelar" apenas fecham.
   */
  confirmar({ titulo = "Confirmar exclusão", texto = "", textoConfirmar = "Excluir" } = {}, aoConfirmar) {
    const modal = document.getElementById("confirmModal");
    const btnOk = document.getElementById("confirmModalOk");
    const btnCancelar = document.getElementById("confirmModalCancel");
    const focoAnterior = document.activeElement;

    document.getElementById("confirmModalTitle").textContent = titulo;
    document.getElementById("confirmModalText").textContent = texto;
    btnOk.textContent = textoConfirmar;

    const aoTeclar = (evento) => {
      if (evento.key === "Escape") fechar();
      if (evento.key === "Tab") {
        evento.preventDefault();
        (document.activeElement === btnOk ? btnCancelar : btnOk).focus();
      }
    };

    let fechado = false;
    function fechar() {
      if (fechado) return;
      fechado = true;
      document.body.style.overflow = "";
      document.removeEventListener("keydown", aoTeclar);
      if (focoAnterior && typeof focoAnterior.focus === "function") focoAnterior.focus();

      if (Movimento.reduzido()) {
        modal.classList.add("is-hidden");
        return;
      }
      // sai com fade + leve zoom (o inverso da entrada) e só então some de vez
      modal.classList.add("is-closing");
      Modal._timer = setTimeout(() => {
        modal.classList.remove("is-closing");
        modal.classList.add("is-hidden");
      }, 210);
    }

    btnCancelar.onclick = fechar;
    modal.onclick = (evento) => { if (evento.target === modal) fechar(); };
    btnOk.onclick = () => {
      if (fechado) return; // evita confirmar duas vezes durante a animação de saída
      fechar();
      aoConfirmar();
    };

    clearTimeout(Modal._timer);
    modal.classList.remove("is-closing");
    document.addEventListener("keydown", aoTeclar);
    document.body.style.overflow = "hidden";
    modal.classList.remove("is-hidden");
    btnCancelar.focus();
  },
};

/* ---------------------------------------------------------
   10. RENDERIZAÇÃO DA UI
--------------------------------------------------------- */
const UI = {
  els: {},

  cachearElementos() {
    // telas (login/cadastro x app)
    this.els.authScreen = document.getElementById("authScreen");
    this.els.appScreen = document.getElementById("appScreen");

    // formulários de autenticação
    this.els.loginForm = document.getElementById("loginForm");
    this.els.loginEmail = document.getElementById("loginEmail");
    this.els.loginSenha = document.getElementById("loginSenha");
    this.els.loginMessage = document.getElementById("loginMessage");

    this.els.cadastroForm = document.getElementById("cadastroForm");
    this.els.cadastroNome = document.getElementById("cadastroNome");
    this.els.cadastroEmail = document.getElementById("cadastroEmail");
    this.els.cadastroSenha = document.getElementById("cadastroSenha");
    this.els.cadastroConfirmarSenha = document.getElementById("cadastroConfirmarSenha");
    this.els.cadastroMessage = document.getElementById("cadastroMessage");

    this.els.showCadastro = document.getElementById("showCadastro");
    this.els.showLogin = document.getElementById("showLogin");

    // navegação / chrome do app
    this.els.pageTitle = document.getElementById("pageTitle");
    this.els.pageSubtitle = document.getElementById("pageSubtitle");
    this.els.navItems = document.querySelectorAll(".nav-item[data-nav], .tab-item[data-nav]");
    this.els.views = document.querySelectorAll(".view");
    this.els.menuBtn = document.getElementById("menuBtn");
    this.els.sidebar = document.getElementById("sidebar");
    this.els.overlay = document.getElementById("overlay");
    this.els.userName = document.getElementById("userName");
    this.els.userAvatar = document.getElementById("userAvatar");
    this.els.logoutBtn = document.getElementById("logoutBtn");
    this.els.navSair = document.getElementById("navSair");

    // dashboard
    this.els.dashboardGreeting = document.getElementById("dashboardGreeting");
    this.els.heroBalance = document.getElementById("heroBalance");
    this.els.heroValue = document.getElementById("heroValue");
    this.els.heroStatus = document.getElementById("heroStatus");
    this.els.heroStatusIcon = document.getElementById("heroStatusIcon");
    this.els.heroStatusText = document.getElementById("heroStatusText");
    this.els.statReceitas = document.getElementById("statReceitas");
    this.els.statDespesas = document.getElementById("statDespesas");
    this.els.toggleVisibility = document.getElementById("toggleVisibility");
    this.els.eyeLabel = document.getElementById("eyeLabel");

    // dashboard: cards de KPI
    this.els.kpiReceitas = document.getElementById("kpiReceitas");
    this.els.kpiDespesas = document.getElementById("kpiDespesas");
    this.els.kpiSaldo = document.getElementById("kpiSaldo");
    this.els.kpiSaldoIcon = document.getElementById("kpiSaldoIcon");
    this.els.kpiPercentual = document.getElementById("kpiPercentual");
    this.els.kpiParcelasPendentes = document.getElementById("kpiParcelasPendentes");

    // dashboard: resumo financeiro + mensagem inteligente
    this.els.resumoMensagem = document.getElementById("resumoMensagem");
    this.els.resumoMensagemIcon = document.getElementById("resumoMensagemIcon");
    this.els.resumoMensagemTexto = document.getElementById("resumoMensagemTexto");
    this.els.resumoTotalRecebido = document.getElementById("resumoTotalRecebido");
    this.els.resumoTotalGasto = document.getElementById("resumoTotalGasto");
    this.els.resumoSaldo = document.getElementById("resumoSaldo");
    this.els.resumoPercentual = document.getElementById("resumoPercentual");
    this.els.resumoMaiorCategoria = document.getElementById("resumoMaiorCategoria");
    this.els.resumoQtdDespesas = document.getElementById("resumoQtdDespesas");

    // receitas
    this.els.receitaForm = document.getElementById("receitaForm");
    this.els.receitaFormTitle = document.getElementById("receitaFormTitle");
    this.els.receitaId = document.getElementById("receitaId");
    this.els.receitaDescricao = document.getElementById("receitaDescricao");
    this.els.receitaValor = document.getElementById("receitaValor");
    this.els.receitaData = document.getElementById("receitaData");
    this.els.receitaCategoria = document.getElementById("receitaCategoria");
    this.els.receitaMessage = document.getElementById("receitaMessage");
    this.els.receitaSubmitBtn = document.getElementById("receitaSubmitBtn");
    this.els.receitaCancelarBtn = document.getElementById("receitaCancelarBtn");
    this.els.receitasList = document.getElementById("receitasList");
    this.els.receitasEmpty = document.getElementById("receitasEmpty");
    this.els.receitasEmptyTexto = document.getElementById("receitasEmptyTexto");
    this.els.receitasCount = document.getElementById("receitasCount");
    this.els.receitaFiltroBusca = document.getElementById("receitaFiltroBusca");
    this.els.receitaFiltroMes = document.getElementById("receitaFiltroMes");
    this.els.receitaFiltroAno = document.getElementById("receitaFiltroAno");
    this.els.receitaFiltroCategoria = document.getElementById("receitaFiltroCategoria");
    this.els.receitaFiltroLimpar = document.getElementById("receitaFiltroLimpar");

    // despesas
    this.els.despesaForm = document.getElementById("despesaForm");
    this.els.despesaFormTitle = document.getElementById("despesaFormTitle");
    this.els.despesaId = document.getElementById("despesaId");
    this.els.despesaDescricao = document.getElementById("despesaDescricao");
    this.els.despesaValor = document.getElementById("despesaValor");
    this.els.despesaData = document.getElementById("despesaData");
    this.els.despesaCategoria = document.getElementById("despesaCategoria");
    this.els.despesaFormaPagamento = document.getElementById("despesaFormaPagamento");
    this.els.despesaStatus = document.getElementById("despesaStatus");
    this.els.despesaFixa = document.getElementById("despesaFixa");
    this.els.despesaTotalParcelas = document.getElementById("despesaTotalParcelas");
    this.els.despesaParcelasRestantes = document.getElementById("despesaParcelasRestantes");
    this.els.despesaMessage = document.getElementById("despesaMessage");
    this.els.despesaSubmitBtn = document.getElementById("despesaSubmitBtn");
    this.els.despesaCancelarBtn = document.getElementById("despesaCancelarBtn");
    this.els.despesasList = document.getElementById("despesasList");
    this.els.despesasEmpty = document.getElementById("despesasEmpty");
    this.els.despesasEmptyTexto = document.getElementById("despesasEmptyTexto");
    this.els.despesasCount = document.getElementById("despesasCount");
    this.els.despesaFiltroBusca = document.getElementById("despesaFiltroBusca");
    this.els.despesaFiltroMes = document.getElementById("despesaFiltroMes");
    this.els.despesaFiltroAno = document.getElementById("despesaFiltroAno");
    this.els.despesaFiltroCategoria = document.getElementById("despesaFiltroCategoria");
    this.els.despesaFiltroStatus = document.getElementById("despesaFiltroStatus");
    this.els.despesaFiltroLimpar = document.getElementById("despesaFiltroLimpar");

    // parcelas
    this.els.resumoParcelasPendentes = document.getElementById("resumoParcelasPendentes");
    this.els.resumoParcelasValorMensal = document.getElementById("resumoParcelasValorMensal");
    this.els.parcelaForm = document.getElementById("parcelaForm");
    this.els.parcelaFormTitle = document.getElementById("parcelaFormTitle");
    this.els.parcelaId = document.getElementById("parcelaId");
    this.els.parcelaDescricao = document.getElementById("parcelaDescricao");
    this.els.parcelaValor = document.getElementById("parcelaValor");
    this.els.parcelaTotalParcelas = document.getElementById("parcelaTotalParcelas");
    this.els.parcelaParcelasRestantes = document.getElementById("parcelaParcelasRestantes");
    this.els.parcelaMessage = document.getElementById("parcelaMessage");
    this.els.parcelaSubmitBtn = document.getElementById("parcelaSubmitBtn");
    this.els.parcelaCancelarBtn = document.getElementById("parcelaCancelarBtn");
    this.els.parcelasList = document.getElementById("parcelasList");
    this.els.parcelasEmpty = document.getElementById("parcelasEmpty");
    this.els.parcelasCount = document.getElementById("parcelasCount");

    // relatórios
    this.els.relatorioMes = document.getElementById("relatorioMes");
    this.els.relatorioAno = document.getElementById("relatorioAno");
    this.els.relatorioReceitas = document.getElementById("relatorioReceitas");
    this.els.relatorioDespesas = document.getElementById("relatorioDespesas");
    this.els.relatorioSaldo = document.getElementById("relatorioSaldo");
    this.els.relatorioSaldoIcon = document.getElementById("relatorioSaldoIcon");
    this.els.relatorioParcelasPendentes = document.getElementById("relatorioParcelasPendentes");
    this.els.relatorioCategoriasList = document.getElementById("relatorioCategoriasList");
    this.els.relatorioCategoriasEmpty = document.getElementById("relatorioCategoriasEmpty");
    this.els.relatorioMaioresList = document.getElementById("relatorioMaioresList");
    this.els.relatorioMaioresEmpty = document.getElementById("relatorioMaioresEmpty");

    // despesas: resumo de pagamentos (cada id vira this.els.<id>)
    ["despesasResumoPendente", "despesasResumoPendenteQtd", "despesasResumoPago", "despesasResumoPagoQtd",
     "despesasSegPendentes", "despesasSegPagas", "despesasSegTodas"].forEach((id) => {
      this.els[id] = document.getElementById(id);
    });

    // cartões de crédito (cada id vira this.els.<id>)
    ["cartaoForm", "cartaoFormTitle", "cartaoId", "cartaoNome", "cartaoBanco", "cartaoLimite", "cartaoFechamento", "cartaoVencimento", "cartaoMessage", "cartaoSubmitBtn", "cartaoCancelarBtn", "cartoesList", "cartoesEmpty", "cartoesCount", "faturasCard", "cartaoSelecionado", "faturaChips", "faturaTitulo", "faturaStatus", "faturaDatas", "faturaTotal", "faturaEmpty", "faturaItens", "comprasLayout", "compraForm", "compraFormTitle", "compraCartaoInfo", "compraId", "compraDescricao", "compraValor", "compraData", "compraParcelas", "compraCategoria", "compraMessage", "compraSubmitBtn", "compraCancelarBtn", "comprasList", "comprasEmpty", "comprasCount", "dashCartoesGrid", "dashCartoesEmpty", "dashFaturaAtual", "dashFaturaAtualSub", "dashLimiteUsado", "dashLimiteSub", "dashProxVenc", "dashProxVencSub", "dashSaldoPrevisto", "dashSaldoPrevistoSub", "dashSaldoPrevistoIcon"].forEach((id) => {
      this.els[id] = document.getElementById(id);
    });
  },

  // ---------- telas de autenticação x app ----------
  mostrarApp(usuario) {
    this.els.authScreen.classList.add("is-hidden");
    this.els.appScreen.classList.remove("is-hidden");
    this.els.userName.textContent = usuario.nome;
    this.els.userAvatar.textContent = Formato.iniciais(usuario.nome);
    this.els.userAvatar.title = usuario.nome + " · " + usuario.email;
  },

  mostrarAuth() {
    this.els.appScreen.classList.add("is-hidden");
    this.els.authScreen.classList.remove("is-hidden");
    this.els.loginForm.classList.remove("is-hidden");
    this.els.cadastroForm.classList.add("is-hidden");
    this.definirMensagem(this.els.loginMessage, "");
    this.definirMensagem(this.els.cadastroMessage, "");
    this.els.loginForm.reset();
    this.els.cadastroForm.reset();
  },

  definirMensagem(elemento, texto, tipo) {
    elemento.textContent = texto;
    elemento.classList.remove("is-error", "is-success");
    void elemento.offsetWidth; // força reflow: reinicia a animação (ex.: tremidinha do erro)
    if (tipo) elemento.classList.add(tipo);
  },

  // ---------- navegação entre telas internas do app ----------
  irPara(view) {
    State.view = view;

    this.els.navItems.forEach((item) => {
      const ativo = item.dataset.nav === view;
      item.classList.toggle("is-active", ativo);
      if (ativo) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });

    this.els.views.forEach((secao) => {
      secao.classList.toggle("is-hidden", secao.id !== "view-" + view);
    });

    const titulos = {
      dashboard: ["Painel", Formato.dataPorExtenso(new Date())],
      receitas: ["Receitas", "Cadastre e acompanhe suas entradas de dinheiro."],
      despesas: ["Despesas", "Registre e acompanhe seus gastos."],
      parcelas: ["Parcelas", "Acompanhe suas compras parceladas."],
      cartoes: ["Cartões", "Limites, compras e faturas dos seus cartões de crédito."],
      relatorios: ["Relatórios", "Veja como estão suas finanças no período selecionado."],
      mercado: ["Mercado Financeiro", "Câmbio, bolsa, criptomoedas e simulador de rendimentos."],
      ia: ["Nexora AI", "Pergunte sobre suas finanças e receba análises com os seus dados."],
    };
    const [titulo, subtitulo] = titulos[view] || ["Nexora", ""];
    this.els.pageTitle.textContent = titulo;
    this.els.pageSubtitle.textContent = subtitulo;

    if (view === "dashboard") {
      this._entradaDashboard = true; // os valores "contam" a partir de zero ao abrir o painel
      this.renderDashboard();
      this._entradaDashboard = false;
    }
    if (view === "receitas") {
      cancelarEdicaoReceita();
      this.renderReceitas();
    }
    if (view === "despesas") {
      cancelarEdicaoDespesa();
      this.renderDespesas();
    }
    if (view === "parcelas") {
      cancelarEdicaoParcela();
      this.renderParcelas();
    }
    if (view === "cartoes") {
      cancelarEdicaoCartao();
      cancelarEdicaoCompra();
      this.renderCartoes();
    }
    if (view === "relatorios") this.renderRelatorios();
    if (view === "mercado" && typeof Mercado !== "undefined") Mercado.aoAbrir();
    if (view === "ia" && typeof NexoraIA !== "undefined") NexoraIA.aoAbrir();

    MenuMobile.fechar();
    window.scrollTo(0, 0);
    this.moverIndicadores();
    this.mostrarProgresso();
    Reveal.trocouDeTela();
  },

  // ---------- movimento ----------
  /** Leva a faixa de seleção (menu lateral e abas do celular) até o item ativo. */
  moverIndicadores() {
    const posicionar = (container, indicador, ativo, eixo) => {
      if (!container || !indicador || !ativo) return;
      if (!ativo.offsetWidth && !ativo.offsetHeight) return; // oculto neste tamanho de tela
      if (eixo === "y") {
        indicador.style.setProperty("--y", ativo.offsetTop + "px");
        indicador.style.setProperty("--h", ativo.offsetHeight + "px");
      } else {
        indicador.style.setProperty("--x", ativo.offsetLeft + "px");
        indicador.style.setProperty("--w", ativo.offsetWidth + "px");
      }
      const primeiraVez = !container.classList.contains("has-indicator");
      container.classList.add("has-indicator");
      // a 1ª posição é direta; só as seguintes deslizam
      if (primeiraVez) {
        requestAnimationFrame(() => requestAnimationFrame(() => indicador.classList.add("is-animated")));
      }
    };
    const nav = document.querySelector(".nav");
    const tabbar = document.querySelector(".tabbar");
    posicionar(nav, document.getElementById("navIndicator"), nav && nav.querySelector(".nav-item.is-active"), "y");
    posicionar(tabbar, document.getElementById("tabIndicator"), tabbar && tabbar.querySelector(".tab-item.is-active"), "x");
  },

  /** Barrinha no topo ao trocar de tela (feedback visual; não atrasa nada). */
  mostrarProgresso() {
    const barra = document.getElementById("topProgress");
    if (!barra || Movimento.reduzido()) return;
    barra.classList.remove("is-running");
    void barra.offsetWidth;
    barra.classList.add("is-running");
  },

  /** Cards de cada tela entram em sequência (cada um recebe seu índice --i). */
  prepararEscalonamento() {
    // cartões de cada tela; só gráficos e indicadores ganham o efeito de profundidade (leitura natural nos demais)
    const comProfundidade = ".chart-card, .mk-grafico-card, .summary-card, .mk-quote, .mk-cenario";
    document.querySelectorAll(".view").forEach((tela) => {
      tela.querySelectorAll(".summary-card, .form-card, .list-card, .chart-card, .mk-card, .ia-card").forEach((card, indice) => {
        if (Reveal.registrar(card, { profundidade: card.matches(comProfundidade) })) return;
        // sem IntersectionObserver / com movimento reduzido: entrada simples de antes
        card.classList.add("stagger");
        card.style.setProperty("--i", indice);
      });
    });
  },

  /** Realça o cartão do formulário quando ele entra (ou sai) do modo de edição. */
  destacarFormulario(formulario, editando) {
    const cartao = formulario && formulario.closest(".form-card");
    if (!cartao) return;
    cartao.classList.remove("is-editando");
    if (editando) {
      void cartao.offsetWidth;
      cartao.classList.add("is-editando");
    }
  },

  /**
   * Mostra um valor com contagem suave. O número REAL já está calculado: aqui
   * só se anima o que aparece na tela (700 ms). O texto final é sempre o
   * mesmo que seria exibido sem animação, e o valor exato fica em data-valor.
   */
  definirValorAnimado(el, valor, tipo = "moeda") {
    if (el._animacao) {
      cancelAnimationFrame(el._animacao);
      el._animacao = null;
    }
    if (valor === null || valor === undefined) {
      el.textContent = "—";
      el._valorExibido = 0;
      delete el.dataset.valor;
      return;
    }
    const formatar = (v) =>
      tipo === "moeda" ? Formato.moeda(v) : tipo === "percentual" ? `${Math.round(v)}%` : String(Math.round(v));

    el.dataset.valor = String(valor);
    const inicio = this._entradaDashboard ? 0 : typeof el._valorExibido === "number" ? el._valorExibido : valor;

    if (Movimento.reduzido() || State.view !== "dashboard" || inicio === valor) {
      el.textContent = formatar(valor);
      el._valorExibido = valor;
      return;
    }

    el.textContent = formatar(inicio);
    const duracao = 700;
    const t0 = performance.now();
    const passo = (agora) => {
      const progresso = Math.min(1, (agora - t0) / duracao);
      const suave = 1 - Math.pow(1 - progresso, 3); // desacelera no fim
      const atual = progresso < 1 ? inicio + (valor - inicio) * suave : valor;
      el.textContent = formatar(atual);
      el._valorExibido = atual;
      el._animacao = progresso < 1 ? requestAnimationFrame(passo) : null;
    };
    el._animacao = requestAnimationFrame(passo);
  },

  // ---------- dashboard ----------
  renderDashboard() {
    const { totalReceitas, totalDespesas, saldo } = calcularResumo(State.dados);

    this.els.dashboardGreeting.textContent = `Olá, ${Formato.primeiroNome(State.usuario.nome)} 👋`;
    this.definirValorAnimado(this.els.heroValue, saldo);
    this.definirValorAnimado(this.els.statReceitas, totalReceitas);
    this.definirValorAnimado(this.els.statDespesas, totalDespesas);

    const negativo = saldo < 0;
    this.els.heroBalance.classList.toggle("is-negative", negativo);

    if (negativo) {
      this.els.heroStatusIcon.innerHTML = '<path d="M12 5v14"/><path d="m5 12 7 7 7-7"/>';
      this.els.heroStatusText.textContent = "Déficit: suas despesas ultrapassaram as receitas";
    } else {
      this.els.heroStatusIcon.innerHTML = '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>';
      this.els.heroStatusText.textContent = "Saldo positivo";
    }

    // ---------- cards de KPI ----------
    const percentual = calcularPercentualComprometido(totalReceitas, totalDespesas);
    const maiorCategoria = calcularMaiorCategoriaDeGasto(todasAsDespesas(State.dados));
    const { totalParcelasPendentes } = Parcelas.resumo(State.dados);

    this.definirValorAnimado(this.els.kpiReceitas, totalReceitas);
    this.definirValorAnimado(this.els.kpiDespesas, totalDespesas);
    this.definirValorAnimado(this.els.kpiSaldo, saldo);
    this.els.kpiSaldoIcon.classList.toggle("icon-red", negativo);
    this.els.kpiSaldoIcon.classList.toggle("icon-green", !negativo);
    this.definirValorAnimado(this.els.kpiPercentual, percentual, "percentual");
    this.definirValorAnimado(this.els.kpiParcelasPendentes, totalParcelasPendentes, "inteiro");

    // ---------- resumo financeiro + mensagem inteligente ----------
    const mensagem = montarMensagemInteligente({ totalReceitas, totalDespesas, saldo, percentual });
    this.els.resumoMensagem.className = "resumo-mensagem msg-" + mensagem.tipo;
    this.els.resumoMensagemTexto.textContent = mensagem.texto;
    this.els.resumoMensagemIcon.innerHTML =
      mensagem.tipo === "negativo"
        ? '<path d="M12 5v14"/><path d="m5 12 7 7 7-7"/>'
        : mensagem.tipo === "neutro"
        ? '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><circle cx="12" cy="16" r="0.5" fill="currentColor"/>'
        : '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>';

    this.definirValorAnimado(this.els.resumoTotalRecebido, totalReceitas);
    this.definirValorAnimado(this.els.resumoTotalGasto, totalDespesas);
    this.definirValorAnimado(this.els.resumoSaldo, saldo);
    this.definirValorAnimado(this.els.resumoPercentual, percentual, "percentual");
    this.els.resumoMaiorCategoria.textContent = maiorCategoria
      ? `${maiorCategoria.categoria} (${Formato.moeda(maiorCategoria.valor)})`
      : "—";
    this.els.resumoQtdDespesas.textContent = String(todasAsDespesas(State.dados).length);

    // ---------- cartões de crédito (faturas separadas das despesas) ----------
    this.renderDashboardCartoes(saldo);

    // ---------- mercado financeiro (resumo; isolado dos dados pessoais) ----------
    if (typeof Mercado !== "undefined") {
      try {
        Mercado.aoAbrirDashboard();
      } catch (erro) {
        console.error("Nexora: resumo do mercado indisponível.", erro);
      }
    }

    // ---------- gráficos ----------
    Graficos.atualizar(State.dados);
  },

  // ---------- receitas: formulário ----------
  preencherFormularioReceita(receita) {
    this.destacarFormulario(this.els.receitaForm, true);
    this.els.receitaId.value = receita.id;
    this.els.receitaDescricao.value = receita.descricao;
    this.els.receitaValor.value = receita.valor;
    this.els.receitaData.value = receita.data;
    this.els.receitaCategoria.value = receita.categoria;

    this.els.receitaFormTitle.textContent = "Editar receita";
    this.els.receitaSubmitBtn.textContent = "Salvar alterações";
    this.els.receitaCancelarBtn.classList.remove("is-hidden");
  },

  limparFormularioReceita() {
    this.destacarFormulario(this.els.receitaForm, false);
    this.els.receitaForm.reset();
    this.els.receitaId.value = "";
    this.els.receitaData.value = Formato.dataHojeISO();
    this.els.receitaCategoria.value = "Salário";

    this.els.receitaFormTitle.textContent = "Nova receita";
    this.els.receitaSubmitBtn.textContent = "Adicionar receita";
    this.els.receitaCancelarBtn.classList.add("is-hidden");
    this.definirMensagem(this.els.receitaMessage, "");
  },

  // ---------- receitas: lista ----------
  renderReceitas() {
    const todas = Receitas.ordenadas(State.dados);
    const filtros = {
      mes: this.els.receitaFiltroMes.value,
      ano: this.els.receitaFiltroAno.value,
      categoria: this.els.receitaFiltroCategoria.value,
      busca: this.els.receitaFiltroBusca.value,
    };
    const lista = aplicarFiltros(todas, filtros);

    this.els.receitasCount.textContent =
      lista.length === 1 ? "1 registro" : `${lista.length} registros`;

    this.els.receitasEmpty.classList.toggle("is-hidden", lista.length > 0);
    this.els.receitasEmptyTexto.textContent =
      todas.length === 0
        ? "Nenhuma receita cadastrada ainda."
        : "Nenhum lançamento encontrado com esses filtros.";
    this.els.receitasList.innerHTML = "";

    lista.forEach((receita) => {
      const item = document.createElement("li");
      item.className = "record-item";
      item.innerHTML = `
        <span class="record-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
        </span>
        <div class="record-info">
          <p class="record-desc"></p>
          <div class="record-meta">
            <span class="record-tag"></span>
            <span class="record-tag"></span>
          </div>
        </div>
        <span class="record-value"></span>
        <div class="record-actions">
          <button type="button" class="btn-editar" title="Editar" aria-label="Editar receita">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="btn-excluir" title="Excluir" aria-label="Excluir receita">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      `;

      item.querySelector(".record-desc").textContent = receita.descricao;
      const tags = item.querySelectorAll(".record-tag");
      tags[0].textContent = receita.categoria;
      tags[1].textContent = Formato.dataCurta(receita.data);
      item.querySelector(".record-value").textContent = "+ " + Formato.moeda(receita.valor);

      item.querySelector(".btn-editar").addEventListener("click", () => {
        State.editandoReceitaId = receita.id;
        UI.preencherFormularioReceita(receita);
        UI.els.receitaDescricao.focus();
      });

      item.querySelector(".btn-excluir").addEventListener("click", () => {
        Modal.confirmar({ texto: `Excluir a receita "${receita.descricao}"? Essa ação não pode ser desfeita.` }, () => {
          Receitas.excluir(State.dados, receita.id);
          persistirDados();

          if (State.editandoReceitaId === receita.id) cancelarEdicaoReceita();

          UI.renderReceitas();
          UI.renderDashboard();
          Toast.mostrar("Receita excluída.", "info");
        });
      });

      this.els.receitasList.appendChild(item);
    });
  },

  // ---------- despesas: formulário ----------
  preencherFormularioDespesa(despesa) {
    this.destacarFormulario(this.els.despesaForm, true);
    this.els.despesaId.value = despesa.id;
    this.els.despesaDescricao.value = despesa.descricao;
    this.els.despesaValor.value = despesa.valor;
    this.els.despesaData.value = despesa.data;
    this.els.despesaCategoria.value = despesa.categoria;
    this.els.despesaFormaPagamento.value = despesa.formaPagamento;
    this.els.despesaStatus.value = despesa.status;
    this.els.despesaFixa.value = despesa.fixa ? "sim" : "nao";
    this.els.despesaTotalParcelas.value = despesa.totalParcelas;
    this.els.despesaParcelasRestantes.value = despesa.parcelasRestantes;

    this.els.despesaFormTitle.textContent = "Editar despesa";
    this.els.despesaSubmitBtn.textContent = "Salvar alterações";
    this.els.despesaCancelarBtn.classList.remove("is-hidden");
  },

  limparFormularioDespesa() {
    this.destacarFormulario(this.els.despesaForm, false);
    this.els.despesaForm.reset();
    this.els.despesaId.value = "";
    this.els.despesaData.value = Formato.dataHojeISO();
    this.els.despesaCategoria.value = "Alimentação";
    this.els.despesaFormaPagamento.value = "Dinheiro";
    this.els.despesaStatus.value = "Pago";
    this.els.despesaFixa.value = "nao";
    this.els.despesaTotalParcelas.value = 1;
    this.els.despesaParcelasRestantes.value = 1;

    this.els.despesaFormTitle.textContent = "Nova despesa";
    this.els.despesaSubmitBtn.textContent = "Adicionar despesa";
    this.els.despesaCancelarBtn.classList.add("is-hidden");
    this.definirMensagem(this.els.despesaMessage, "");
  },

  // ---------- despesas: pagamentos ----------
  /** Resumo "a pagar / já pago" e botões Pendentes · Pagas · Todas (sincronizados com o filtro de status). */
  renderResumoPagamentos() {
    const r = Despesas.resumoPagamentos(State.dados);
    this.els.despesasResumoPendente.textContent = Formato.moeda(r.pendente);
    this.els.despesasResumoPendenteQtd.textContent =
      r.qtdPendentes === 1 ? "1 despesa pendente" : `${r.qtdPendentes} despesas pendentes`;
    this.els.despesasResumoPago.textContent = Formato.moeda(r.pago);
    this.els.despesasResumoPagoQtd.textContent = r.qtdPagas === 1 ? "1 despesa quitada" : `${r.qtdPagas} despesas quitadas`;
    this.els.despesasSegPendentes.textContent = String(r.qtdPendentes);
    this.els.despesasSegPagas.textContent = String(r.qtdPagas);
    this.els.despesasSegTodas.textContent = String(State.dados.despesas.length);

    const atual = this.els.despesaFiltroStatus.value;
    document.querySelectorAll("[data-despesa-visao]").forEach((botao) => {
      const ativo = botao.dataset.despesaVisao === atual;
      botao.classList.toggle("is-active", ativo);
      botao.setAttribute("aria-pressed", String(ativo));
    });
  },

  /** "Histórico de pagamentos" (recolhível) de uma despesa. */
  montarHistoricoPagamentos(despesa, sit) {
    const pagamentos = Array.isArray(despesa.pagamentos) ? despesa.pagamentos : [];
    if (pagamentos.length === 0) return null;

    const detalhes = document.createElement("details");
    detalhes.className = "desp-hist";
    const resumo = document.createElement("summary");
    resumo.textContent = `Histórico de pagamentos (${pagamentos.length})`;
    detalhes.appendChild(resumo);

    const lista = document.createElement("ul");
    pagamentos.forEach((pagamento) => {
      const li = document.createElement("li");
      const rotulo = document.createElement("span");
      rotulo.textContent = sit.parcelado ? `Parcela ${pagamento.numero}/${sit.total}` : "Pagamento";
      const valor = document.createElement("strong");
      valor.textContent = Formato.moeda(pagamento.valor);
      const data = document.createElement("span");
      data.className = "desp-hist-data";
      data.textContent = `pago em ${Formato.dataCurta(pagamento.pagoEm)}`;
      li.append(rotulo, valor, data);
      lista.appendChild(li);
    });
    detalhes.appendChild(lista);

    const desfazer = document.createElement("button");
    desfazer.type = "button";
    desfazer.className = "desp-desfazer";
    desfazer.textContent = "Desfazer último pagamento";
    desfazer.addEventListener("click", () => {
      Modal.confirmar(
        { titulo: "Desfazer pagamento", texto: `Desfazer o último pagamento de "${despesa.descricao}"? A despesa volta a ficar pendente.`, textoConfirmar: "Desfazer" },
        () => UI.desfazerPagamentoDespesa(despesa.id)
      );
    });
    detalhes.appendChild(desfazer);
    return detalhes;
  },

  registrarPagamentoDespesa(id) {
    const r = Despesas.registrarPagamento(State.dados, id);
    if (r.duplicado) return; // clique/toque duplo: já registrado
    if (!r.ok) {
      Toast.mostrar(r.erro, "erro");
      return;
    }
    persistirDados();
    if (State.editandoDespesaId === id) cancelarEdicaoDespesa(); // evita salvar o formulário com dados antigos
    this.renderDespesas();
    this.destacarDespesa(id);

    const d = r.despesa;
    const mensagem =
      r.parcelas === 1
        ? `Pagamento registrado: ${d.descricao}.`
        : r.concluida
        ? `Pagamento registrado — ${d.descricao} quitada! 🎉`
        : `Pagamento registrado — parcela ${r.pagamento.numero}/${r.parcelas}. Restam ${d.parcelasRestantes}.`;
    Toast.mostrar(mensagem, "sucesso", 6000, {
      rotulo: "Desfazer",
      aoClicar: () => UI.desfazerPagamentoDespesa(id, r.pagamento.registradoEm),
    });
  },

  desfazerPagamentoDespesa(id, registradoEm) {
    const r = Despesas.desfazerPagamento(State.dados, id, registradoEm);
    if (!r.ok) {
      Toast.mostrar(r.erro, "erro");
      return;
    }
    persistirDados();
    if (State.editandoDespesaId === id) cancelarEdicaoDespesa();
    this.renderDespesas();
    this.destacarDespesa(id);
    Toast.mostrar("Pagamento desfeito. A despesa voltou a ficar pendente.", "info");
  },

  /** Realce rápido da linha que acabou de mudar. */
  destacarDespesa(id) {
    const linha = this.els.despesasList.querySelector(`[data-id="${id}"]`);
    if (!linha) return;
    linha.classList.add("is-pago-agora");
    setTimeout(() => linha.classList.remove("is-pago-agora"), 1300);
  },

  // ---------- despesas: lista ----------
  renderDespesas() {
    const todas = Despesas.ordenadas(State.dados);
    const filtros = {
      mes: this.els.despesaFiltroMes.value,
      ano: this.els.despesaFiltroAno.value,
      categoria: this.els.despesaFiltroCategoria.value,
      status: this.els.despesaFiltroStatus.value,
      busca: this.els.despesaFiltroBusca.value,
    };
    const lista = aplicarFiltros(todas, filtros);
    this.renderResumoPagamentos();

    this.els.despesasCount.textContent =
      lista.length === 1 ? "1 registro" : `${lista.length} registros`;

    this.els.despesasEmpty.classList.toggle("is-hidden", lista.length > 0);
    this.els.despesasEmptyTexto.textContent =
      todas.length === 0
        ? "Nenhuma despesa cadastrada ainda."
        : "Nenhum lançamento encontrado com esses filtros.";
    this.els.despesasList.innerHTML = "";

    lista.forEach((despesa) => {
      const sit = Despesas.situacao(despesa);
      const item = document.createElement("li");
      item.className = "record-item" + (sit.quitada ? " is-quitada" : "");
      item.dataset.id = despesa.id;
      item.innerHTML = `
        <span class="record-icon icon-expense">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14"/><path d="m5 12 7 7 7-7"/></svg>
        </span>
        <div class="record-info">
          <p class="record-desc"></p>
          <div class="record-meta"></div>
        </div>
        <span class="record-value is-expense"></span>
        <div class="record-actions">
          <button type="button" class="btn-pagar" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
            <span>Já paguei</span>
          </button>
          <button type="button" class="btn-editar" title="Editar" aria-label="Editar despesa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="btn-excluir" title="Excluir" aria-label="Excluir despesa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      `;

      item.querySelector(".record-desc").textContent = despesa.descricao;
      item.querySelector(".record-value").textContent = "- " + Formato.moeda(despesa.valor);

      const meta = item.querySelector(".record-meta");
      const tagCategoria = document.createElement("span");
      tagCategoria.className = "record-tag";
      tagCategoria.textContent = despesa.categoria;
      meta.appendChild(tagCategoria);

      const tagPagamento = document.createElement("span");
      tagPagamento.className = "record-tag";
      tagPagamento.textContent = despesa.formaPagamento;
      meta.appendChild(tagPagamento);

      const tagData = document.createElement("span");
      tagData.className = "record-tag";
      tagData.textContent = Formato.dataCurta(despesa.data);
      meta.appendChild(tagData);

      const tagStatus = document.createElement("span");
      tagStatus.className = "record-tag record-tag-status " + (sit.quitada ? "status-pago" : "status-pendente");
      tagStatus.textContent = sit.quitada ? (sit.parcelado ? "Quitado" : "Pago") : "Pendente";
      meta.appendChild(tagStatus);

      if (despesa.fixa) {
        const tagFixa = document.createElement("span");
        tagFixa.className = "record-tag record-tag-fixa";
        tagFixa.textContent = "Fixa";
        meta.appendChild(tagFixa);
      }

      const info = item.querySelector(".record-info");
      if (sit.parcelado) {
        const tagParcelas = document.createElement("span");
        tagParcelas.className = "record-tag";
        tagParcelas.textContent = sit.quitada
          ? `${sit.total}x de ${Formato.moeda(Cartoes.parcelasEmCentavos(despesa.valor, sit.total)[0] / 100)}`
          : `Parcela ${sit.parcelaAtual}/${sit.total} · ${Formato.moeda(sit.valorParcela)}`;
        meta.appendChild(tagParcelas);

        // andamento do parcelamento (valor original e parcela preservados; só avança a contagem)
        const andamento = document.createElement("div");
        andamento.className = "desp-andamento";
        andamento.innerHTML =
          '<div class="record-progress"><div class="record-progress-fill"></div></div><p class="desp-andamento-txt"></p>';
        andamento.querySelector(".record-progress-fill").style.width = Math.round((sit.pagasQtd / sit.total) * 100) + "%";
        andamento.querySelector(".desp-andamento-txt").textContent = sit.quitada
          ? `${sit.total} de ${sit.total} parcelas pagas`
          : `${sit.pagasQtd} de ${sit.total} parcelas pagas · ${sit.restantes} ${sit.restantes === 1 ? "restante" : "restantes"} (${Formato.moeda(sit.pendente)})`;
        info.appendChild(andamento);
      }

      const historico = this.montarHistoricoPagamentos(despesa, sit);
      if (historico) info.appendChild(historico);

      // botão "Já paguei": só em despesa pendente
      const botaoPagar = item.querySelector(".btn-pagar");
      if (!sit.quitada) {
        botaoPagar.hidden = false;
        const rotuloAcao = sit.parcelado
          ? `Registrar pagamento da parcela ${sit.parcelaAtual} de ${sit.total} (${Formato.moeda(sit.valorParcela)})`
          : `Registrar pagamento de ${Formato.moeda(sit.valorParcela)}`;
        botaoPagar.title = rotuloAcao;
        botaoPagar.setAttribute("aria-label", `Já paguei: ${despesa.descricao}. ${rotuloAcao}`);
        botaoPagar.addEventListener("click", () => UI.registrarPagamentoDespesa(despesa.id));
      }

      item.querySelector(".btn-editar").addEventListener("click", () => {
        State.editandoDespesaId = despesa.id;
        UI.preencherFormularioDespesa(despesa);
        UI.els.despesaDescricao.focus();
      });

      item.querySelector(".btn-excluir").addEventListener("click", () => {
        Modal.confirmar({ texto: `Excluir a despesa "${despesa.descricao}"? Essa ação não pode ser desfeita.` }, () => {
          Despesas.excluir(State.dados, despesa.id);
          persistirDados();

          if (State.editandoDespesaId === despesa.id) cancelarEdicaoDespesa();

          UI.renderDespesas();
          UI.renderDashboard();
          Toast.mostrar("Despesa excluída.", "info");
        });
      });

      this.els.despesasList.appendChild(item);
    });
  },

  // ---------- parcelas: formulário ----------
  preencherFormularioParcela(parcela) {
    this.destacarFormulario(this.els.parcelaForm, true);
    this.els.parcelaId.value = parcela.id;
    this.els.parcelaDescricao.value = parcela.descricao;
    this.els.parcelaValor.value = parcela.valorParcela;
    this.els.parcelaTotalParcelas.value = parcela.totalParcelas;
    this.els.parcelaParcelasRestantes.value = parcela.parcelasRestantes;

    this.els.parcelaFormTitle.textContent = "Editar compra parcelada";
    this.els.parcelaSubmitBtn.textContent = "Salvar alterações";
    this.els.parcelaCancelarBtn.classList.remove("is-hidden");
  },

  limparFormularioParcela() {
    this.destacarFormulario(this.els.parcelaForm, false);
    this.els.parcelaForm.reset();
    this.els.parcelaId.value = "";
    this.els.parcelaTotalParcelas.value = 12;
    this.els.parcelaParcelasRestantes.value = 12;

    this.els.parcelaFormTitle.textContent = "Nova compra parcelada";
    this.els.parcelaSubmitBtn.textContent = "Adicionar parcela";
    this.els.parcelaCancelarBtn.classList.add("is-hidden");
    this.definirMensagem(this.els.parcelaMessage, "");
  },

  // ---------- parcelas: resumo + lista ----------
  renderParcelas() {
    const { totalParcelasPendentes, valorMensal } = Parcelas.resumo(State.dados);
    this.els.resumoParcelasPendentes.textContent = String(totalParcelasPendentes);
    this.els.resumoParcelasValorMensal.textContent = Formato.moeda(valorMensal);

    const lista = Parcelas.ordenadas(State.dados);

    this.els.parcelasCount.textContent =
      lista.length === 1 ? "1 registro" : `${lista.length} registros`;

    this.els.parcelasEmpty.classList.toggle("is-hidden", lista.length > 0);
    this.els.parcelasList.innerHTML = "";

    lista.forEach((parcela) => {
      const status = Parcelas.status(parcela);
      const finalizada = status === "Finalizada";
      const pagas = parcela.totalParcelas - parcela.parcelasRestantes;
      const progresso = Math.round((pagas / parcela.totalParcelas) * 100);

      const item = document.createElement("li");
      item.className = "record-item" + (finalizada ? " is-finalizada" : "");
      item.innerHTML = `
        <span class="record-icon icon-expense">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="4" rx="1"/><rect x="3" y="16" width="10" height="4" rx="1"/></svg>
        </span>
        <div class="record-info">
          <p class="record-desc"></p>
          <div class="record-meta">
            <span class="record-tag"></span>
            <span class="record-tag"></span>
            <span class="record-tag record-tag-status"></span>
          </div>
          <div class="record-progress"><div class="record-progress-fill"></div></div>
        </div>
        <span class="record-value is-expense"></span>
        <div class="record-actions">
          <button type="button" class="btn-diminuir" title="Diminuir uma parcela" aria-label="Diminuir uma parcela">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12h14"/></svg>
          </button>
          <button type="button" class="btn-editar" title="Editar" aria-label="Editar compra parcelada">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="btn-excluir" title="Excluir" aria-label="Excluir compra parcelada">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      `;

      item.querySelector(".record-desc").textContent = parcela.descricao;
      item.querySelector(".record-value").textContent = "- " + Formato.moeda(parcela.valorParcela);
      item.querySelector(".record-progress-fill").style.width = progresso + "%";

      const tags = item.querySelectorAll(".record-tag");
      tags[0].textContent = `${parcela.totalParcelas}x de ${Formato.moeda(parcela.valorParcela)}`;
      tags[1].textContent = finalizada
        ? "Quitada"
        : `${parcela.parcelasRestantes} de ${parcela.totalParcelas} restantes`;
      tags[2].textContent = status;
      tags[2].classList.add(finalizada ? "status-finalizada" : "status-andamento");

      const btnDiminuir = item.querySelector(".btn-diminuir");
      btnDiminuir.disabled = finalizada;
      if (finalizada) btnDiminuir.title = "Compra já quitada";

      btnDiminuir.addEventListener("click", () => {
        Parcelas.diminuirUma(State.dados, parcela.id);
        persistirDados();
        UI.renderParcelas();

        const atual = Parcelas.buscar(State.dados, parcela.id);
        if (atual && atual.parcelasRestantes === 0) {
          Toast.mostrar(`"${atual.descricao}" foi quitada! 🎉`);
        } else if (atual) {
          Toast.mostrar(`Parcela abatida — faltam ${atual.parcelasRestantes}.`);
        }
      });

      item.querySelector(".btn-editar").addEventListener("click", () => {
        State.editandoParcelaId = parcela.id;
        UI.preencherFormularioParcela(parcela);
        UI.els.parcelaDescricao.focus();
      });

      item.querySelector(".btn-excluir").addEventListener("click", () => {
        Modal.confirmar({ texto: `Excluir a compra parcelada "${parcela.descricao}"? Essa ação não pode ser desfeita.` }, () => {
          Parcelas.excluir(State.dados, parcela.id);
          persistirDados();

          if (State.editandoParcelaId === parcela.id) cancelarEdicaoParcela();

          UI.renderParcelas();
          Toast.mostrar("Compra parcelada excluída.", "info");
        });
      });

      this.els.parcelasList.appendChild(item);
    });
  },

  // ---------- cartões ----------
  cartaoSelecionado() {
    return State.dados.cartoes.find((c) => c.id === State.cartaoSelecionadoId) || null;
  },

  preencherFormularioCartao(cartao) {
    this.destacarFormulario(this.els.cartaoForm, true);
    this.els.cartaoId.value = cartao.id;
    this.els.cartaoNome.value = cartao.nome;
    this.els.cartaoBanco.value = cartao.banco;
    this.els.cartaoLimite.value = cartao.limite;
    this.els.cartaoFechamento.value = cartao.diaFechamento;
    this.els.cartaoVencimento.value = cartao.diaVencimento;
    this.els.cartaoFormTitle.textContent = "Editar cartão";
    this.els.cartaoSubmitBtn.textContent = "Salvar alterações";
    this.els.cartaoCancelarBtn.classList.remove("is-hidden");
  },

  limparFormularioCartao() {
    this.destacarFormulario(this.els.cartaoForm, false);
    this.els.cartaoForm.reset();
    this.els.cartaoId.value = "";
    this.els.cartaoFormTitle.textContent = "Novo cartão";
    this.els.cartaoSubmitBtn.textContent = "Adicionar cartão";
    this.els.cartaoCancelarBtn.classList.add("is-hidden");
    this.definirMensagem(this.els.cartaoMessage, "");
  },

  preencherFormularioCompra(compra) {
    this.destacarFormulario(this.els.compraForm, true);
    this.els.compraId.value = compra.id;
    this.els.compraDescricao.value = compra.descricao;
    this.els.compraValor.value = compra.valor;
    this.els.compraData.value = compra.data;
    this.els.compraParcelas.value = compra.parcelas;
    this.els.compraCategoria.value = compra.categoria;
    this.els.compraFormTitle.textContent = "Editar compra no cartão";
    this.els.compraSubmitBtn.textContent = "Salvar alterações";
    this.els.compraCancelarBtn.classList.remove("is-hidden");
  },

  limparFormularioCompra() {
    this.destacarFormulario(this.els.compraForm, false);
    this.els.compraForm.reset();
    this.els.compraId.value = "";
    this.els.compraData.value = Formato.dataHojeISO();
    this.els.compraParcelas.value = 1;
    this.els.compraCategoria.value = "Compras";
    this.els.compraFormTitle.textContent = "Nova compra no cartão";
    this.els.compraSubmitBtn.textContent = "Adicionar compra";
    this.els.compraCancelarBtn.classList.add("is-hidden");
    this.definirMensagem(this.els.compraMessage, "");
  },

  renderCartoes() {
    const cartoes = State.dados.cartoes;
    if (!cartoes.some((c) => c.id === State.cartaoSelecionadoId)) {
      State.cartaoSelecionadoId = cartoes.length ? cartoes[0].id : null;
      State.faturaSelecionada = null;
    }
    const temCartoes = cartoes.length > 0;

    this.els.cartoesCount.textContent = cartoes.length === 1 ? "1 cartão" : `${cartoes.length} cartões`;
    this.els.cartoesEmpty.classList.toggle("is-hidden", temCartoes);
    this.els.faturasCard.classList.toggle("is-hidden", !temCartoes);
    this.els.comprasLayout.classList.toggle("is-hidden", !temCartoes);

    this.renderCartaoTiles();
    if (temCartoes) {
      this.renderSeletorCartao();
      this.renderFaturas();
      this.renderCompras();
    }
  },

  renderSeletorCartao() {
    const select = this.els.cartaoSelecionado;
    select.innerHTML = "";
    State.dados.cartoes.forEach((cartao) => {
      const opcao = document.createElement("option");
      opcao.value = cartao.id;
      opcao.textContent = `${cartao.nome} · ${cartao.banco}`;
      select.appendChild(opcao);
    });
    select.value = State.cartaoSelecionadoId;
  },

  renderCartaoTiles() {
    const lista = this.els.cartoesList;
    lista.innerHTML = "";

    State.dados.cartoes.forEach((cartao, indice) => {
      const r = Cartoes.resumo(State.dados, cartao);
      const prox = r.proximoVencimento;

      const item = document.createElement("li");
      item.className = "cartao-tile" + (cartao.id === State.cartaoSelecionadoId ? " is-selecionado" : "");
      item.innerHTML = `
        <div class="cartao-visual cartao-v${indice % 4}">
          <div class="cartao-topo"><span class="cartao-banco"></span><span class="cartao-chip"></span></div>
          <strong class="cartao-nome"></strong>
          <span class="cartao-datas"></span>
        </div>
        <div class="cartao-corpo">
          <div class="record-progress"><div class="record-progress-fill"></div></div>
          <div class="cartao-uso-legenda"><span class="uso-percentual"></span><span>do limite em uso</span></div>
          <dl class="cartao-metricas">
            <div><dt>Limite total</dt><dd data-k="limite"></dd></div>
            <div><dt>Limite utilizado</dt><dd data-k="usado"></dd></div>
            <div><dt>Limite disponível</dt><dd data-k="disponivel"></dd></div>
            <div><dt>Fatura atual</dt><dd data-k="fatura"></dd></div>
            <div class="wide"><dt>Próximo vencimento</dt><dd data-k="vencimento"></dd></div>
          </dl>
          <div class="cartao-acoes">
            <button type="button" class="secondary-btn btn-ver">Ver faturas</button>
            <div class="record-actions">
              <button type="button" class="btn-editar" title="Editar" aria-label="Editar cartão">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button type="button" class="btn-excluir" title="Excluir" aria-label="Excluir cartão">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;

      item.querySelector(".cartao-banco").textContent = cartao.banco;
      item.querySelector(".cartao-nome").textContent = cartao.nome;
      item.querySelector(".cartao-datas").textContent =
        `Fecha dia ${cartao.diaFechamento} · Vence dia ${cartao.diaVencimento}`;

      const preenchimento = item.querySelector(".record-progress-fill");
      preenchimento.style.width = Math.min(100, r.percentual) + "%";
      if (r.percentual >= 90) preenchimento.classList.add("is-critico");
      else if (r.percentual >= 70) preenchimento.classList.add("is-alerta");
      item.querySelector(".uso-percentual").textContent = `${Math.round(r.percentual)}%`;

      const dd = (chave) => item.querySelector(`[data-k="${chave}"]`);
      dd("limite").textContent = Formato.moeda(r.limite);
      dd("usado").textContent = Formato.moeda(r.usado);
      dd("disponivel").textContent = Formato.moeda(r.disponivel);
      dd("fatura").textContent = Formato.moeda(r.faturaAtual.total);
      dd("vencimento").textContent = `${Formato.dataCurta(prox.vencimento)} · ${Formato.moeda(prox.total)}`;
      if (r.disponivel < 0) dd("disponivel").classList.add("is-negativo");

      item.querySelector(".btn-ver").addEventListener("click", () => {
        State.cartaoSelecionadoId = cartao.id;
        State.faturaSelecionada = null;
        cancelarEdicaoCompra();
        UI.renderCartoes();
        UI.els.faturasCard.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      item.querySelector(".btn-editar").addEventListener("click", () => {
        State.editandoCartaoId = cartao.id;
        UI.preencherFormularioCartao(cartao);
        UI.els.cartaoNome.focus();
      });

      item.querySelector(".btn-excluir").addEventListener("click", () => {
        const qtd = State.dados.comprasCartao.filter((c) => c.cartaoId === cartao.id).length;
        const aviso = qtd > 0 ? ` As ${qtd} compra(s) registradas nele também serão excluídas.` : "";
        Modal.confirmar({ texto: `Excluir o cartão "${cartao.nome}"?${aviso} Essa ação não pode ser desfeita.` }, () => {
          Cartoes.excluirCartao(State.dados, cartao.id);
          persistirDados();
          if (State.editandoCartaoId === cartao.id) cancelarEdicaoCartao();
          cancelarEdicaoCompra();
          UI.renderCartoes();
          Toast.mostrar("Cartão excluído.", "info");
        });
      });

      lista.appendChild(item);
    });
  },

  renderFaturas() {
    const cartao = this.cartaoSelecionado();
    if (!cartao) return;

    const r = Cartoes.resumo(State.dados, cartao);
    if (!r.linhaDoTempo.some((f) => f.chave === State.faturaSelecionada)) {
      State.faturaSelecionada = r.cicloAtual;
    }

    const rotulos = { atual: "Atual", fechada: "Fechada", futura: "Futura" };
    const chips = this.els.faturaChips;
    const posicao = chips.scrollLeft;
    chips.innerHTML = "";
    r.linhaDoTempo.forEach((fatura) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className =
        `fatura-chip is-${fatura.status}` + (fatura.chave === State.faturaSelecionada ? " is-active" : "");
      chip.innerHTML = '<span class="chip-status"></span><span class="chip-mes"></span><span class="chip-valor"></span>';
      chip.querySelector(".chip-status").textContent = rotulos[fatura.status];
      chip.querySelector(".chip-mes").textContent = Formato.mesAno(fatura.chave, true);
      chip.querySelector(".chip-valor").textContent = Formato.moeda(fatura.total);
      chip.addEventListener("click", () => {
        State.faturaSelecionada = fatura.chave;
        UI.renderFaturas();
      });
      chips.appendChild(chip);
    });
    chips.scrollLeft = posicao;

    const fatura = r.linhaDoTempo.find((f) => f.chave === State.faturaSelecionada);
    this.els.faturaTitulo.textContent = `Fatura de ${Formato.mesAno(fatura.chave)}`;
    const status = this.els.faturaStatus;
    status.className = "record-tag record-tag-status";
    if (fatura.status === "atual") {
      status.textContent = "Aberta";
      status.classList.add("status-finalizada");
    } else if (fatura.status === "fechada") {
      status.textContent = "Fechada · aguardando vencimento";
      status.classList.add("status-andamento");
    } else {
      status.textContent = "Futura";
    }
    this.els.faturaDatas.textContent =
      `Fecha em ${Formato.dataCurta(fatura.fechamento)} · Vence em ${Formato.dataCurta(fatura.vencimento)}`;
    this.els.faturaTotal.textContent = Formato.moeda(fatura.total);

    const itens = [...fatura.itens].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : 0));
    this.els.faturaEmpty.classList.toggle("is-hidden", itens.length > 0);
    this.els.faturaItens.innerHTML = "";
    itens.forEach((parcela) => {
      const li = document.createElement("li");
      li.className = "record-item";
      li.innerHTML = `
        <span class="record-icon icon-expense">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>
        </span>
        <div class="record-info">
          <p class="record-desc"></p>
          <div class="record-meta"></div>
        </div>
        <span class="record-value is-expense"></span>
      `;
      li.querySelector(".record-desc").textContent = parcela.descricao;
      li.querySelector(".record-value").textContent = "- " + Formato.moeda(parcela.valor);
      const meta = li.querySelector(".record-meta");
      const etiquetas = [parcela.categoria, "Compra em " + Formato.dataCurta(parcela.data)];
      if (parcela.totalParcelas > 1) etiquetas.push(`Parcela ${parcela.numero}/${parcela.totalParcelas}`);
      etiquetas.forEach((texto) => {
        const tag = document.createElement("span");
        tag.className = "record-tag";
        tag.textContent = texto;
        meta.appendChild(tag);
      });
      this.els.faturaItens.appendChild(li);
    });
  },

  renderCompras() {
    const cartao = this.cartaoSelecionado();
    if (!cartao) return;

    this.els.compraCartaoInfo.textContent = `Compra no cartão ${cartao.nome} · ${cartao.banco}`;
    const compras = Cartoes.comprasDoCartao(State.dados, cartao.id);

    this.els.comprasCount.textContent = compras.length === 1 ? "1 registro" : `${compras.length} registros`;
    this.els.comprasEmpty.classList.toggle("is-hidden", compras.length > 0);
    this.els.comprasList.innerHTML = "";

    compras.forEach((compra) => {
      const item = document.createElement("li");
      item.className = "record-item";
      item.innerHTML = `
        <span class="record-icon icon-expense">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>
        </span>
        <div class="record-info">
          <p class="record-desc"></p>
          <div class="record-meta"></div>
        </div>
        <span class="record-value is-expense"></span>
        <div class="record-actions">
          <button type="button" class="btn-editar" title="Editar" aria-label="Editar compra">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="btn-excluir" title="Excluir" aria-label="Excluir compra">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      `;
      item.querySelector(".record-desc").textContent = compra.descricao;
      item.querySelector(".record-value").textContent = "- " + Formato.moeda(compra.valor);

      const primeiraParcela = Cartoes.parcelasEmCentavos(compra.valor, compra.parcelas)[0] / 100;
      const meta = item.querySelector(".record-meta");
      [
        compra.categoria,
        Formato.dataCurta(compra.data),
        compra.parcelas > 1 ? `${compra.parcelas}x de ${Formato.moeda(primeiraParcela)}` : "À vista",
      ].forEach((texto) => {
        const tag = document.createElement("span");
        tag.className = "record-tag";
        tag.textContent = texto;
        meta.appendChild(tag);
      });

      item.querySelector(".btn-editar").addEventListener("click", () => {
        State.editandoCompraId = compra.id;
        UI.preencherFormularioCompra(compra);
        UI.els.compraDescricao.focus();
      });

      item.querySelector(".btn-excluir").addEventListener("click", () => {
        Modal.confirmar({ texto: `Excluir a compra "${compra.descricao}" do cartão? Ela sairá das faturas. Essa ação não pode ser desfeita.` }, () => {
          Cartoes.excluirCompra(State.dados, compra.id);
          persistirDados();
          if (State.editandoCompraId === compra.id) cancelarEdicaoCompra();
          UI.renderCartoes();
          Toast.mostrar("Compra excluída.", "info");
        });
      });

      this.els.comprasList.appendChild(item);
    });
  },

  /** Bloco "Cartões de crédito" do Dashboard — separado das despesas registradas. */
  renderDashboardCartoes(saldo) {
    const vazio = State.dados.cartoes.length === 0;
    this.els.dashCartoesGrid.classList.toggle("is-hidden", vazio);
    this.els.dashCartoesEmpty.classList.toggle("is-hidden", !vazio);
    if (vazio) return;

    const g = Cartoes.resumoGeral(State.dados);
    const qtd = State.dados.cartoes.length;

    this.definirValorAnimado(this.els.dashFaturaAtual, g.faturaAtual);
    this.els.dashFaturaAtualSub.textContent = qtd === 1 ? "1 cartão" : `Soma de ${qtd} cartões`;

    this.definirValorAnimado(this.els.dashLimiteUsado, g.usado);
    this.els.dashLimiteSub.textContent = `Disponível ${Formato.moeda(g.disponivel)} de ${Formato.moeda(g.limite)}`;

    this.els.dashProxVenc.textContent = Formato.dataCurta(g.proximo.data);
    this.els.dashProxVencSub.textContent = `${g.proximo.cartaoNome} · ${Formato.moeda(g.proximo.total)}`;

    const previsto = saldo - g.proximasFaturas;
    this.definirValorAnimado(this.els.dashSaldoPrevisto, previsto);
    this.els.dashSaldoPrevistoSub.textContent = `Saldo menos ${Formato.moeda(g.proximasFaturas)} das próximas faturas`;
    this.els.dashSaldoPrevistoIcon.classList.toggle("icon-red", previsto < 0);
    this.els.dashSaldoPrevistoIcon.classList.toggle("icon-green", previsto >= 0);
  },

  // ---------- relatórios ----------
  renderRelatorios() {
    const mes = this.els.relatorioMes.value;
    const ano = this.els.relatorioAno.value;

    const receitasPeriodo = filtrarPorMesAno(State.dados.receitas, mes, ano);
    const despesasPeriodo = filtrarPorMesAno(todasAsDespesas(State.dados), mes, ano);

    const totalReceitasPeriodo = receitasPeriodo.reduce((soma, item) => soma + (item.valor || 0), 0);
    const totalDespesasPeriodo = despesasPeriodo.reduce((soma, item) => soma + (item.valor || 0), 0);
    const saldoPeriodo = totalReceitasPeriodo - totalDespesasPeriodo;

    this.els.relatorioReceitas.textContent = Formato.moeda(totalReceitasPeriodo);
    this.els.relatorioDespesas.textContent = Formato.moeda(totalDespesasPeriodo);
    this.els.relatorioSaldo.textContent = Formato.moeda(saldoPeriodo);
    this.els.relatorioSaldoIcon.classList.toggle("icon-red", saldoPeriodo < 0);
    this.els.relatorioSaldoIcon.classList.toggle("icon-green", saldoPeriodo >= 0);

    const { totalParcelasPendentes } = Parcelas.resumo(State.dados);
    this.els.relatorioParcelasPendentes.textContent = String(totalParcelasPendentes);

    // ---------- gastos por categoria ----------
    const porCategoria = {};
    despesasPeriodo.forEach((item) => {
      porCategoria[item.categoria] = (porCategoria[item.categoria] || 0) + (item.valor || 0);
    });
    const categoriasOrdenadas = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]);

    this.els.relatorioCategoriasEmpty.classList.toggle("is-hidden", categoriasOrdenadas.length > 0);
    this.els.relatorioCategoriasList.innerHTML = "";
    categoriasOrdenadas.forEach(([categoria, valor]) => {
      const percentual = totalDespesasPeriodo > 0 ? Math.round((valor / totalDespesasPeriodo) * 100) : 0;
      const li = document.createElement("li");
      const spanCategoria = document.createElement("span");
      spanCategoria.textContent = categoria;
      const strongValor = document.createElement("strong");
      strongValor.textContent = `${Formato.moeda(valor)} (${percentual}%)`;
      li.append(spanCategoria, strongValor);
      this.els.relatorioCategoriasList.appendChild(li);
    });

    // ---------- maiores despesas (top 5 do período) ----------
    const maiores = [...despesasPeriodo].sort((a, b) => b.valor - a.valor).slice(0, 5);

    this.els.relatorioMaioresEmpty.classList.toggle("is-hidden", maiores.length > 0);
    this.els.relatorioMaioresList.innerHTML = "";
    maiores.forEach((despesa) => {
      const item = document.createElement("li");
      item.className = "record-item";
      item.innerHTML = `
        <span class="record-icon icon-expense">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14"/><path d="m5 12 7 7 7-7"/></svg>
        </span>
        <div class="record-info">
          <p class="record-desc"></p>
          <div class="record-meta">
            <span class="record-tag"></span>
            <span class="record-tag"></span>
          </div>
        </div>
        <span class="record-value is-expense"></span>
      `;
      item.querySelector(".record-desc").textContent = despesa.descricao;
      const tags = item.querySelectorAll(".record-tag");
      tags[0].textContent = despesa.categoria;
      tags[1].textContent = Formato.dataCurta(despesa.data);
      item.querySelector(".record-value").textContent = "- " + Formato.moeda(despesa.valor);
      this.els.relatorioMaioresList.appendChild(item);
    });

    // ---------- gráficos de colunas ----------
    Graficos.atualizarRelatorios(State.dados, mes, ano);
  },
};

/* ---------------------------------------------------------
   9. MENU MOBILE (gaveta da sidebar)
--------------------------------------------------------- */
const MenuMobile = {
  abrir() {
    UI.els.sidebar.classList.add("is-open");
    UI.els.overlay.classList.add("is-visible");
  },
  fechar() {
    UI.els.sidebar.classList.remove("is-open");
    UI.els.overlay.classList.remove("is-visible");
  },
};

function configurarMenuMobile() {
  UI.els.menuBtn.addEventListener("click", MenuMobile.abrir);
  UI.els.overlay.addEventListener("click", MenuMobile.fechar);
}

/* ---------------------------------------------------------
   10. FLUXO DE SESSÃO (entrar / sair / carregar dados)
--------------------------------------------------------- */
function entrarComoUsuario(usuario) {
  Storage.definirSessao(usuario.id);
  State.usuario = usuario;
  State.dados = Storage.carregar(usuario.id);
  State.editandoReceitaId = null;
  State.editandoDespesaId = null;
  State.editandoParcelaId = null;
  State.editandoCartaoId = null;
  State.editandoCompraId = null;
  State.cartaoSelecionadoId = null;
  State.faturaSelecionada = null;

  UI.mostrarApp(usuario);
  UI.irPara("dashboard");
}

function sairDaConta() {
  Auth.sair();
  State.usuario = null;
  State.dados = null;
  State.editandoReceitaId = null;
  State.editandoDespesaId = null;
  State.editandoParcelaId = null;
  State.editandoCartaoId = null;
  State.editandoCompraId = null;
  State.cartaoSelecionadoId = null;
  State.faturaSelecionada = null;
  UI.mostrarAuth();
  Toast.mostrar("Você saiu da sua conta.", "info");
  if (typeof NexoraIA !== "undefined") NexoraIA.limpar();
}

function configurarAutenticacao() {
  // alternar entre os formulários
  UI.els.showCadastro.addEventListener("click", (evento) => {
    evento.preventDefault();
    UI.definirMensagem(UI.els.loginMessage, "");
    UI.definirMensagem(UI.els.cadastroMessage, "");
    UI.els.loginForm.classList.add("is-hidden");
    UI.els.cadastroForm.classList.remove("is-hidden");
  });

  UI.els.showLogin.addEventListener("click", (evento) => {
    evento.preventDefault();
    UI.definirMensagem(UI.els.loginMessage, "");
    UI.definirMensagem(UI.els.cadastroMessage, "");
    UI.els.cadastroForm.classList.add("is-hidden");
    UI.els.loginForm.classList.remove("is-hidden");
  });

  // envio do login
  UI.els.loginForm.addEventListener("submit", (evento) => {
    evento.preventDefault();

    const resultado = Auth.login({
      email: UI.els.loginEmail.value,
      senha: UI.els.loginSenha.value,
    });

    if (!resultado.ok) {
      UI.definirMensagem(UI.els.loginMessage, resultado.erro, "is-error");
      return;
    }

    entrarComoUsuario(resultado.usuario);
    Toast.mostrar(`Bem-vindo(a) de volta, ${Formato.primeiroNome(resultado.usuario.nome)}!`);
  });

  // envio do cadastro
  UI.els.cadastroForm.addEventListener("submit", (evento) => {
    evento.preventDefault();

    const resultado = Auth.cadastrar({
      nome: UI.els.cadastroNome.value,
      email: UI.els.cadastroEmail.value,
      senha: UI.els.cadastroSenha.value,
      confirmarSenha: UI.els.cadastroConfirmarSenha.value,
    });

    if (!resultado.ok) {
      UI.definirMensagem(UI.els.cadastroMessage, resultado.erro, "is-error");
      return;
    }

    // conta criada -> já loga o usuário e vai direto para o painel
    entrarComoUsuario(resultado.usuario);
    Toast.mostrar("Conta criada com sucesso! Bem-vindo(a) à Nexora.");
  });

  // sair (botão da topbar e item do menu lateral)
  UI.els.logoutBtn.addEventListener("click", sairDaConta);
  UI.els.navSair.addEventListener("click", (evento) => {
    evento.preventDefault();
    sairDaConta();
  });
}

/* ---------------------------------------------------------
   11. NAVEGAÇÃO ENTRE TELAS INTERNAS (menu lateral)
--------------------------------------------------------- */
function configurarNavegacao() {
  document.querySelectorAll("[data-goto]").forEach((link) => {
    link.addEventListener("click", (evento) => {
      evento.preventDefault();
      UI.irPara(link.dataset.goto);
    });
  });

  UI.els.navItems.forEach((item) => {
    item.addEventListener("click", (evento) => {
      evento.preventDefault();
      if (item.classList.contains("is-disabled")) return;
      UI.irPara(item.dataset.nav);
    });
  });
}

/* ---------------------------------------------------------
   12. OCULTAR/MOSTRAR SALDO (dashboard)
--------------------------------------------------------- */
function configurarOcultarSaldo() {
  const btn = UI.els.toggleVisibility;
  const label = UI.els.eyeLabel;
  const valor = UI.els.heroValue;
  let oculto = false;

  btn.addEventListener("click", () => {
    oculto = !oculto;
    btn.setAttribute("aria-pressed", String(oculto));
    valor.style.filter = oculto ? "blur(8px)" : "none";
    label.textContent = oculto ? "mostrar" : "ocultar";
  });
}

/* ---------------------------------------------------------
   13. FORMULÁRIO DE RECEITAS
--------------------------------------------------------- */
function cancelarEdicaoReceita() {
  State.editandoReceitaId = null;
  UI.limparFormularioReceita();
}

function configurarFormularioReceita() {
  UI.els.receitaForm.addEventListener("submit", (evento) => {
    evento.preventDefault();

    const resultado = Receitas.validar({
      descricao: UI.els.receitaDescricao.value,
      valor: UI.els.receitaValor.value,
      data: UI.els.receitaData.value,
      categoria: UI.els.receitaCategoria.value,
    });

    if (!resultado.ok) {
      UI.definirMensagem(UI.els.receitaMessage, resultado.erro, "is-error");
      return;
    }

    const eraEdicao = Boolean(State.editandoReceitaId);
    if (eraEdicao) {
      Receitas.editar(State.dados, State.editandoReceitaId, resultado.receita);
    } else {
      Receitas.adicionar(State.dados, resultado.receita);
    }

    persistirDados();
    cancelarEdicaoReceita();
    UI.renderReceitas();
    UI.renderDashboard();
    Toast.mostrar(eraEdicao ? "Receita atualizada com sucesso." : "Receita adicionada com sucesso.");
  });

  UI.els.receitaCancelarBtn.addEventListener("click", () => {
    cancelarEdicaoReceita();
  });
}

/* ---------------------------------------------------------
   14. FORMULÁRIO DE DESPESAS
--------------------------------------------------------- */
function cancelarEdicaoDespesa() {
  State.editandoDespesaId = null;
  UI.limparFormularioDespesa();
}

function configurarFormularioDespesa() {
  UI.els.despesaForm.addEventListener("submit", (evento) => {
    evento.preventDefault();

    const resultado = Despesas.validar({
      descricao: UI.els.despesaDescricao.value,
      valor: UI.els.despesaValor.value,
      data: UI.els.despesaData.value,
      categoria: UI.els.despesaCategoria.value,
      formaPagamento: UI.els.despesaFormaPagamento.value,
      status: UI.els.despesaStatus.value,
      fixa: UI.els.despesaFixa.value,
      totalParcelas: UI.els.despesaTotalParcelas.value,
      parcelasRestantes: UI.els.despesaParcelasRestantes.value,
    });

    if (!resultado.ok) {
      UI.definirMensagem(UI.els.despesaMessage, resultado.erro, "is-error");
      return;
    }

    const eraEdicao = Boolean(State.editandoDespesaId);
    if (eraEdicao) {
      Despesas.editar(State.dados, State.editandoDespesaId, resultado.despesa);
    } else {
      Despesas.adicionar(State.dados, resultado.despesa);
    }

    persistirDados();
    cancelarEdicaoDespesa();
    UI.renderDespesas();
    UI.renderDashboard();
    Toast.mostrar(eraEdicao ? "Despesa atualizada com sucesso." : "Despesa adicionada com sucesso.");
  });

  UI.els.despesaCancelarBtn.addEventListener("click", () => {
    cancelarEdicaoDespesa();
  });
}

/* ---------------------------------------------------------
   15. FORMULÁRIO DE PARCELAS
--------------------------------------------------------- */
function cancelarEdicaoParcela() {
  State.editandoParcelaId = null;
  UI.limparFormularioParcela();
}

function configurarFormularioParcela() {
  UI.els.parcelaForm.addEventListener("submit", (evento) => {
    evento.preventDefault();

    const resultado = Parcelas.validar({
      descricao: UI.els.parcelaDescricao.value,
      valorParcela: UI.els.parcelaValor.value,
      totalParcelas: UI.els.parcelaTotalParcelas.value,
      parcelasRestantes: UI.els.parcelaParcelasRestantes.value,
    });

    if (!resultado.ok) {
      UI.definirMensagem(UI.els.parcelaMessage, resultado.erro, "is-error");
      return;
    }

    const eraEdicao = Boolean(State.editandoParcelaId);
    if (eraEdicao) {
      Parcelas.editar(State.dados, State.editandoParcelaId, resultado.parcela);
    } else {
      Parcelas.adicionar(State.dados, resultado.parcela);
    }

    persistirDados();
    cancelarEdicaoParcela();
    UI.renderParcelas();
    Toast.mostrar(eraEdicao ? "Compra parcelada atualizada." : "Compra parcelada adicionada.");
  });

  UI.els.parcelaCancelarBtn.addEventListener("click", () => {
    cancelarEdicaoParcela();
  });
}

/* ---------------------------------------------------------
   16. FILTROS (Receitas / Despesas) E RELATÓRIOS
--------------------------------------------------------- */
function configurarFiltrosReceitas() {
  popularSelectAnos(UI.els.receitaFiltroAno);

  [UI.els.receitaFiltroMes, UI.els.receitaFiltroAno, UI.els.receitaFiltroCategoria].forEach((campo) => {
    campo.addEventListener("change", () => UI.renderReceitas());
  });
  UI.els.receitaFiltroBusca.addEventListener("input", () => UI.renderReceitas());

  UI.els.receitaFiltroLimpar.addEventListener("click", () => {
    UI.els.receitaFiltroMes.value = "";
    UI.els.receitaFiltroAno.value = "";
    UI.els.receitaFiltroCategoria.value = "";
    UI.els.receitaFiltroBusca.value = "";
    UI.renderReceitas();
  });
}

function configurarFiltrosDespesas() {
  popularSelectAnos(UI.els.despesaFiltroAno);

  [UI.els.despesaFiltroMes, UI.els.despesaFiltroAno, UI.els.despesaFiltroCategoria, UI.els.despesaFiltroStatus].forEach(
    (campo) => campo.addEventListener("change", () => UI.renderDespesas())
  );
  UI.els.despesaFiltroBusca.addEventListener("input", () => UI.renderDespesas());
  document.querySelectorAll("[data-despesa-visao]").forEach((botao) => {
    botao.addEventListener("click", () => {
      UI.els.despesaFiltroStatus.value = botao.dataset.despesaVisao; // mesmo filtro de status
      UI.renderDespesas();
    });
  });

  UI.els.despesaFiltroLimpar.addEventListener("click", () => {
    UI.els.despesaFiltroMes.value = "";
    UI.els.despesaFiltroAno.value = "";
    UI.els.despesaFiltroCategoria.value = "";
    UI.els.despesaFiltroStatus.value = "";
    UI.els.despesaFiltroBusca.value = "";
    UI.renderDespesas();
  });
}

function configurarRelatorios() {
  popularSelectAnos(UI.els.relatorioAno, { incluirTodos: false });

  // começa sempre no mês/ano atuais
  const hoje = new Date();
  UI.els.relatorioMes.value = String(hoje.getMonth() + 1).padStart(2, "0");
  UI.els.relatorioAno.value = String(hoje.getFullYear());

  UI.els.relatorioMes.addEventListener("change", () => UI.renderRelatorios());
  UI.els.relatorioAno.addEventListener("change", () => UI.renderRelatorios());
}

/* ---------------------------------------------------------
   16b. CARTÕES DE CRÉDITO (formulários, seletor de cartão)
--------------------------------------------------------- */
function cancelarEdicaoCartao() {
  State.editandoCartaoId = null;
  UI.limparFormularioCartao();
}

function cancelarEdicaoCompra() {
  State.editandoCompraId = null;
  UI.limparFormularioCompra();
}

function configurarCartoes() {
  // ---- cadastro/edição do cartão ----
  UI.els.cartaoForm.addEventListener("submit", (evento) => {
    evento.preventDefault();

    const resultado = Cartoes.validarCartao({
      nome: UI.els.cartaoNome.value,
      banco: UI.els.cartaoBanco.value,
      limite: UI.els.cartaoLimite.value,
      diaFechamento: UI.els.cartaoFechamento.value,
      diaVencimento: UI.els.cartaoVencimento.value,
    });

    if (!resultado.ok) {
      UI.definirMensagem(UI.els.cartaoMessage, resultado.erro, "is-error");
      return;
    }

    const eraEdicao = Boolean(State.editandoCartaoId);
    if (eraEdicao) {
      Cartoes.editarCartao(State.dados, State.editandoCartaoId, resultado.cartao);
    } else {
      const novo = Cartoes.adicionarCartao(State.dados, resultado.cartao);
      State.cartaoSelecionadoId = novo.id;
      State.faturaSelecionada = null;
    }

    persistirDados();
    cancelarEdicaoCartao();
    UI.renderCartoes();
    Toast.mostrar(eraEdicao ? "Cartão atualizado com sucesso." : "Cartão adicionado com sucesso.");
  });

  UI.els.cartaoCancelarBtn.addEventListener("click", cancelarEdicaoCartao);

  // ---- cartão exibido nas faturas e compras ----
  UI.els.cartaoSelecionado.addEventListener("change", () => {
    State.cartaoSelecionadoId = UI.els.cartaoSelecionado.value;
    State.faturaSelecionada = null;
    cancelarEdicaoCompra();
    UI.renderCartoes();
  });

  // ---- compras no cartão ----
  UI.els.compraForm.addEventListener("submit", (evento) => {
    evento.preventDefault();

    const resultado = Cartoes.validarCompra({
      cartaoId: State.cartaoSelecionadoId,
      descricao: UI.els.compraDescricao.value,
      valor: UI.els.compraValor.value,
      data: UI.els.compraData.value,
      parcelas: UI.els.compraParcelas.value,
      categoria: UI.els.compraCategoria.value,
    });

    if (!resultado.ok) {
      UI.definirMensagem(UI.els.compraMessage, resultado.erro, "is-error");
      return;
    }

    const eraEdicao = Boolean(State.editandoCompraId);
    if (eraEdicao) {
      Cartoes.editarCompra(State.dados, State.editandoCompraId, resultado.compra);
    } else {
      Cartoes.adicionarCompra(State.dados, resultado.compra);
    }

    persistirDados();
    cancelarEdicaoCompra();
    UI.renderCartoes();
    Toast.mostrar(eraEdicao ? "Compra atualizada com sucesso." : "Compra lançada na fatura do cartão.");
  });

  UI.els.compraCancelarBtn.addEventListener("click", cancelarEdicaoCompra);
}

/* ---------------------------------------------------------
   16c. MOVIMENTO (efeito de toque, indicadores, escalonamento)
--------------------------------------------------------- */
function configurarMovimento() {
  Reveal.iniciar();
  UI.prepararEscalonamento();

  // efeito de toque (ondinha) nos botões principais
  document.addEventListener("pointerdown", (evento) => {
    if (Movimento.reduzido() || !evento.target.closest) return;
    const botao = evento.target.closest(".primary-btn, .secondary-btn, .danger-btn");
    if (!botao || botao.disabled) return;
    const area = botao.getBoundingClientRect();
    const tamanho = Math.max(area.width, area.height);
    const onda = document.createElement("span");
    onda.className = "ripple";
    onda.style.width = onda.style.height = tamanho + "px";
    onda.style.left = evento.clientX - area.left - tamanho / 2 + "px";
    onda.style.top = evento.clientY - area.top - tamanho / 2 + "px";
    botao.appendChild(onda);
    setTimeout(() => onda.remove(), 650);
  });

  // a faixa de seleção acompanha redimensionamento e carregamento das fontes
  let quadro = null;
  window.addEventListener("resize", () => {
    if (quadro) cancelAnimationFrame(quadro);
    quadro = requestAnimationFrame(() => UI.moverIndicadores());
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => UI.moverIndicadores());
}

/* ---------------------------------------------------------
   17. INICIALIZAÇÃO
--------------------------------------------------------- */
function iniciar() {
  UI.cachearElementos();
  configurarAutenticacao();
  configurarNavegacao();
  configurarOcultarSaldo();
  configurarMenuMobile();
  configurarFormularioReceita();
  configurarFormularioDespesa();
  configurarFormularioParcela();
  configurarFiltrosReceitas();
  configurarFiltrosDespesas();
  configurarRelatorios();
  configurarCartoes();
  if (typeof Mercado !== "undefined") Mercado.iniciar();
  configurarMovimento();
  Graficos.configurarPadroes();

  const usuario = Auth.usuarioLogado();
  if (usuario) {
    entrarComoUsuario(usuario);
  } else {
    UI.mostrarAuth();
  }
}

document.addEventListener("DOMContentLoaded", iniciar);
