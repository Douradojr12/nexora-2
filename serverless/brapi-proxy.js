/* =========================================================================
   COFRE — proxy OPCIONAL da brapi (Cloudflare Workers)

   Para quê: a brapi só libera sem chave PETR4, VALE3, ITUB4 e MGLU3. O
   Ibovespa (^BVSP) e outras ações exigem uma chave, e a documentação deles
   proíbe expor a chave em código de navegador. Este proxy guarda a chave
   como SEGREDO no servidor e repassa só leituras de cotação/histórico.

   Como usar (resumo; passo a passo no README):
   1. Crie uma conta gratuita na brapi (brapi.dev) e copie seu token.
   2. No painel da Cloudflare: Workers → Create → cole este arquivo.
   3. Settings → Variables: crie o SEGREDO  BRAPI_TOKEN  com o seu token e a
      variável  ALLOWED_ORIGINS  com os endereços do seu site, separados por
      vírgula (ex.: https://seusite.com — para testar abrindo o index.html do
      disco, inclua também  null ).
   4. Copie a URL do Worker para  MercadoConfig.proxyBrapi  em mercado.js.

   NUNCA coloque o token em mercado.js nem em nenhum arquivo do site.
   ========================================================================= */

const ROTAS = {
  "/quote": "https://brapi.dev/api/v2/stocks/quote",
  "/historical": "https://brapi.dev/api/v2/stocks/historical",
};
const PARAMETROS = {
  "/quote": ["symbols"],
  "/historical": ["symbols", "range", "interval", "sortOrder"],
};
const SIMBOLO = /^\^?[A-Za-z0-9.]{1,12}$/; // PETR4, ^BVSP...

export default {
  async fetch(request, env) {
    const origem = request.headers.get("Origin") || "";
    const permitidas = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const liberada = permitidas.includes(origem);
    const cors = {
      "Access-Control-Allow-Origin": liberada ? origem : permitidas[0] || "null",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Expose-Headers": "Retry-After",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "GET") return resposta({ error: "Método não permitido." }, 405, cors);
    if (origem && !liberada) return resposta({ error: "Origem não autorizada." }, 403, cors);
    if (!env.BRAPI_TOKEN) return resposta({ error: "BRAPI_TOKEN não configurado." }, 500, cors);

    const url = new URL(request.url);
    const rota = url.pathname.replace(/\/+$/, "");
    if (!ROTAS[rota]) return resposta({ error: "Rota inexistente." }, 404, cors);

    const destino = new URL(ROTAS[rota]);
    for (const nome of PARAMETROS[rota]) {
      const valor = url.searchParams.get(nome);
      if (valor === null) continue;
      if (nome === "symbols" && !valor.split(",").every((s) => SIMBOLO.test(s))) {
        return resposta({ error: "Símbolo inválido." }, 400, cors);
      }
      destino.searchParams.set(nome, valor);
    }
    if (!destino.searchParams.get("symbols")) return resposta({ error: "Informe symbols." }, 400, cors);

    const origemResposta = await fetch(destino.toString(), {
      headers: { Authorization: `Bearer ${env.BRAPI_TOKEN}`, Accept: "application/json" },
    });
    const cabecalhos = { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" };
    const espera = origemResposta.headers.get("Retry-After");
    if (espera) cabecalhos["Retry-After"] = espera;
    return new Response(origemResposta.body, { status: origemResposta.status, headers: cabecalhos });
  },
};

function resposta(corpo, status, cabecalhos) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...cabecalhos, "Content-Type": "application/json; charset=utf-8" },
  });
}
