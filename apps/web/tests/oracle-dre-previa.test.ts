// T-0092 — torre_dre espelha a DRE da T-0090: classificacao PREVIA (fecha_em),
// componentes parciais/extrapolados COM valor, margem conhecida com
// componentes_parciais e aviso, e o cenario estimado com as linhas e a origem
// de cada uma. Ausencia continua ausencia (null, nunca 0). Nada aqui toca rede.
import { test } from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";

import { buildOracleServer } from "../src/server/oracle/server.ts";
import { SlidingWindowRateLimiter } from "../src/server/oracle/rate-limit.ts";
import { OracleToolError } from "../src/server/oracle/errors.ts";
import { DRE_MAX_RESPONSE_BYTES, dreResultBytes, projectDre } from "../src/server/oracle/dre-contract.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const PUB = "2026-11-10T13:00:00Z"; // 23 h antes de NOW: lote valido

type Over = Record<string, unknown>;

/** Componente no formato da API pos-T-0090 (com origem/entra_na_margem/cobertura_rotulo). */
const comp = (status: string, valor: number | null, origem: string, over: Over = {}) => ({
  valor, pct_receita: valor === null ? null : valor / 10, status,
  motivo: status === "disponivel" ? null : `motivo ${status}`,
  fonte: null, somavel: true, partes: null, data_as_of: null, publicado_em: null,
  cobertura: null, cmv_pct_receita_coberta: null,
  origem, entra_na_margem: false, cobertura_rotulo: null, valor_medido: null,
  ...over,
});

const LINHAS_CENARIO = [
  { linha: "receita_bruta", tipo: "item", valor: 1000, origem: "realizado", somavel: false },
  { linha: "icms", tipo: "item", valor: 120, origem: "premissa", somavel: true },
  { linha: "cmv", tipo: "item", valor: 400, origem: "extrapolado", somavel: true },
  { linha: "despesas_marketplace", tipo: "item", valor: 322.58, origem: "extrapolado", somavel: true },
  { linha: "frete_primario", tipo: "item", valor: null, origem: "indisponivel", somavel: true },
  { linha: "margem_contribuicao_estimada", tipo: "subtotal", valor: 157.42, origem: "calculado", somavel: false },
];

function cenario(over: Over = {}) {
  return {
    competencia_premissas: "2026-10", natureza: "estimada", rotulo: "Margem de contribuicao estimada",
    estado: "parcial", previa: true, competencia_madura: false, receita_base: 1000, fonte_cmv: "dre_realizada",
    linhas: LINHAS_CENARIO.map((l) => ({
      ...l, rotulo: l.linha, pct_receita: l.valor === null ? null : l.valor / 10, percentual: null,
      status: "ok", motivo: null,
    })),
    componentes_ausentes: [{ linha: "frete_primario", motivo: "premissa ausente" }],
    motivos: [], avisos: ["previa"],
    margem_contribuicao_estimada: 157.42, margem_contribuicao_estimada_pct: 15.74,
    fonte_premissas: { rotulo: "Premissas de outubro/2026", competencia: "2026-10", data_fonte: "2026-10-13", source_sha256: "x", carregado_em: PUB },
    celulas: 1, celulas_sem_premissa: 0,
    ...over,
  };
}

/** tiktok x apice — PREVIA com taxa parcial e CMV extrapolado (formato T-0090). */
function celulaPrevia(over: Over = {}) {
  return {
    escopo: "canal_marca", mes: "2026-10", canal: "tiktok", canal_label: "TikTok Shop",
    marca: "apice", marca_label: "APICE", celulas: 1,
    classificacao: "PREVIA", previa: true, fecha_em: "2026-12-31",
    motivos_classificacao: ["2026-10 tiktok apice: mes imaturo: fecha apos 2026-12-31 (regra M+2)"],
    avisos_qualidade: [],
    componentes: {
      receita: comp("disponivel", 1000, "realizado", { somavel: false }),
      devolucoes: comp("indisponivel", null, "indisponivel"),
      taxas: comp("parcial", 300, "parcial", { entra_na_margem: true, publicado_em: PUB, cobertura_rotulo: "escrow em 93,0% dos pedidos" }),
      afiliados: comp("disponivel", 90, "realizado", { somavel: false }),
      ads: comp("indisponivel", null, "indisponivel"),
      frete: comp("disponivel", 50, "realizado", { entra_na_margem: true, publicado_em: PUB }),
      cmv: comp("nao_reconciliado", 400, "extrapolado", {
        entra_na_margem: true, publicado_em: PUB, valor_medido: 100,
        cobertura_rotulo: "NF cobre 25% do GMV; extrapolado de 25,0% coberto",
      }),
      impostos: comp("indisponivel", null, "indisponivel"),
    },
    componentes_disponiveis: ["receita", "afiliados", "frete"],
    componentes_ausentes: [],
    completude: { usados: 3, aplicaveis: 6, parciais: 2, texto: "3 de 6 custos (2 parciais)" },
    margem_contribuicao_conhecida: {
      valor: 250, pct_receita: 25, rotulo: "Margem de contribuicao conhecida", formula: "receita − taxas − frete − cmv",
      componentes_usados: ["taxas", "frete", "cmv"], componentes_parciais: ["taxas", "cmv"],
      faltam: ["devolucoes", "ads", "impostos"],
      aviso: "Margem conhecida inclui custos parciais (taxas, cmv); custo não medido não entra, então a margem tende a estar acima da real.",
    },
    data_maxima: { insumo_publicado_em: PUB },
    cenario_premissas: cenario(),
    ...over,
  };
}

/** ml x barbours — COMPLETA, tudo realizado. */
function celulaCompleta() {
  return {
    ...celulaPrevia(),
    canal: "ml", canal_label: "Mercado Livre", marca: "barbours", marca_label: "BARBOURS",
    classificacao: "COMPLETA", previa: false, fecha_em: null, motivos_classificacao: [],
    componentes: {
      receita: comp("disponivel", 1000, "realizado", { somavel: false }),
      devolucoes: comp("disponivel", 0, "realizado", { entra_na_margem: true }),
      taxas: comp("disponivel", 100, "realizado", { entra_na_margem: true, publicado_em: PUB }),
      afiliados: comp("nao_aplicavel", null, "nao_aplicavel", { somavel: false }),
      ads: comp("disponivel", 80, "realizado", { entra_na_margem: true }),
      frete: comp("disponivel", 50, "realizado", { entra_na_margem: true, publicado_em: PUB }),
      cmv: comp("disponivel", 400, "realizado", { entra_na_margem: true, publicado_em: PUB, valor_medido: 400 }),
      impostos: comp("disponivel", 90, "realizado", { entra_na_margem: true }),
    },
    margem_contribuicao_conhecida: {
      valor: 280, pct_receita: 28, rotulo: "Margem de contribuicao conhecida", formula: null,
      componentes_usados: ["devolucoes", "taxas", "ads", "frete", "cmv", "impostos"], componentes_parciais: [],
      faltam: [], aviso: null,
    },
    cenario_premissas: null,
  };
}

/** shopee x kokeshi — NAO_CALCULAVEL: sem receita, nada com numero. */
function celulaSemReceita() {
  const ind = (somavel = true) => comp("indisponivel", null, "indisponivel", { somavel });
  return {
    ...celulaPrevia(),
    canal: "shopee", canal_label: "Shopee", marca: "kokeshi", marca_label: "KOKESHI",
    classificacao: "NAO_CALCULAVEL", previa: false, fecha_em: null,
    motivos_classificacao: ["2026-10 shopee kokeshi: sem receita"],
    componentes: {
      receita: ind(false), devolucoes: ind(), taxas: ind(), afiliados: ind(false),
      ads: ind(), frete: ind(), cmv: ind(),
      // A fonte mandou 0 com origem indisponivel: sai nulo, nunca 0.
      impostos: comp("indisponivel", 0, "indisponivel"),
    },
    margem_contribuicao_conhecida: {
      valor: null, pct_receita: null, rotulo: "Margem de contribuicao conhecida", formula: null,
      componentes_usados: [], componentes_parciais: [], faltam: ["taxas", "cmv"], aviso: null,
    },
    cenario_premissas: null,
  };
}

function resposta(celulas: unknown[], extra: Over = {}) {
  return {
    periodo: { date_from: "2026-10-01", date_to: "2026-10-31", meses: ["2026-10"], origem: "informado" },
    filtros: {},
    fontes: {
      neon: "ok",
      insumos_dre: { estado: "ok", publicado_em: PUB, publicado_em_mais_recente: PUB, motivo: null },
      premissas_dre: { estado: "ok", competencias_publicadas: ["2026-10"], rotulo: "Premissas de outubro/2026", data_fonte: "2026-10-13", carregado_em: PUB, motivo: null },
    },
    regras: {},
    total: { ...celulaPrevia(), escopo: "total", canal: null, marca: null, celulas: 3 },
    por_canal: [], por_marca: [],
    por_canal_marca: celulas,
    celulas_base: [],
    ...extra,
  };
}

const T0090 = () => resposta([celulaPrevia(), celulaCompleta(), celulaSemReceita()]);
const proj = (raw: unknown, now = NOW) => projectDre(raw, { ref_month: "2026-10" }, now) as any;
const topicos = (env: any) => env.data.limitations.map((l: any) => l.topic) as string[];

test("PREVIA: classificacao_fonte e fecha_em espelham a API (celula e total)", () => {
  const env = proj(T0090());
  const [tk] = env.data.celulas;
  assert.equal(tk.classificacao_fonte, "PREVIA");
  assert.equal(tk.fecha_em, "2026-12-31");
  assert.equal(env.data.total.classificacao_fonte, "PREVIA");
  assert.equal(env.data.total.fecha_em, "2026-12-31");
  const lim = env.data.limitations.find((l: any) => l.topic === "dre_previa");
  assert.ok(lim, "previa declarada em limitations");
  assert.equal(lim.motivo, "DRE_PREVIA");
  assert.match(lim.description, /ESTIMATIVA/);
  assert.match(lim.description, /2026-12-31/);
});

test("margem_principal segue a tela (margemPrincipal): estimada na PREVIA com cenario numerico", () => {
  const [tk, ml, sh] = proj(T0090()).data.celulas;
  assert.equal(tk.margem_principal, "estimada");
  assert.equal(ml.margem_principal, "conhecida", "mes maduro: conhecida");
  assert.equal(sh.margem_principal, "conhecida");
  // PREVIA sem cenario, ou com margem estimada nula: conhecida.
  const semCenario = proj(resposta([celulaPrevia({ cenario_premissas: null })])).data.celulas[0];
  assert.equal(semCenario.margem_principal, "conhecida");
  const nula = proj(resposta([celulaPrevia({ cenario_premissas: cenario({ margem_contribuicao_estimada: null }) })])).data.celulas[0];
  assert.equal(nula.margem_principal, "conhecida");
  // `previa: true` sem classificacao PREVIA tambem conta (ehPrevia).
  const flag = proj(resposta([celulaPrevia({ classificacao: "PARCIAL", previa: true })])).data.celulas[0];
  assert.equal(flag.margem_principal, "estimada");
});

test("linha parcial mantem o valor da API com cobertura_rotulo, origem e entra_na_margem", () => {
  const tk = proj(T0090()).data.celulas[0];
  assert.equal(tk.taxas.status, "PARCIAL");
  assert.equal(tk.taxas.valor, 300);
  assert.equal(tk.taxas.pct_receita, 30);
  assert.equal(tk.taxas.status_fonte, "parcial");
  assert.equal(tk.taxas.origem, "parcial");
  assert.equal(tk.taxas.entra_na_margem, true);
  assert.equal(tk.taxas.cobertura_rotulo, "escrow em 93,0% dos pedidos");
  // CMV extrapolado: valor estendido + medido cru, status da fonte preservado.
  assert.equal(tk.cmv.status, "PARCIAL");
  assert.equal(tk.cmv.origem, "extrapolado");
  assert.equal(tk.cmv.valor, 400);
  assert.equal(tk.cmv.valor_medido, 100);
  assert.equal(tk.cmv.status_fonte, "nao_reconciliado");
  assert.match(tk.cmv.cobertura_rotulo, /extrapolado/);
  // Realizado continua CALCULADO; afiliados nao entram na margem.
  assert.equal(tk.frete.status, "CALCULADO");
  assert.equal(tk.frete.origem, "realizado");
  assert.equal(tk.afiliados.entra_na_margem, false);
  // Ausente continua nulo.
  for (const k of ["devolucoes", "ads", "impostos"]) {
    assert.equal(tk[k].valor, null, k);
    assert.equal(tk[k].status, "NAO_CALCULAVEL", k);
    assert.equal(tk[k].origem, "indisponivel", k);
  }
});

test("margem conhecida da API: PARCIAL com componentes_parciais e aviso; custos conhecidos somados", () => {
  const env = proj(T0090());
  const tk = env.data.celulas[0];
  assert.equal(tk.resultado.status, "PARCIAL");
  assert.equal(tk.resultado.valor, 250);
  assert.equal(tk.margem_pct, 25);
  assert.match(tk.resultado.motivo, /custos parciais na conta \(taxas, cmv\)/);
  assert.deepEqual(tk.margem_conhecida.componentes_usados, ["taxas", "frete", "cmv"]);
  assert.deepEqual(tk.margem_conhecida.componentes_parciais, ["taxas", "cmv"]);
  assert.match(tk.margem_conhecida.aviso, /acima da real/);
  assert.equal(tk.custos_conhecidos.status, "PARCIAL");
  assert.equal(tk.custos_conhecidos.valor, 750);
  assert.equal(tk.resultado.valor + tk.custos_conhecidos.valor, tk.receita.valor, "receita - custos = margem da API");
  const lim = env.data.limitations.find((l: any) => l.topic === "dre_componentes_parciais");
  assert.ok(lim);
  assert.equal(lim.motivo, "COMPONENTES_PARCIAIS");
  assert.match(lim.description, /COBERTURA INCOMPLETA/);
  assert.match(lim.description, /EXTRAPOLADAS/);
  assert.match(lim.description, /ACIMA da real/);
});

test("margem sem CMV na conta sai PARCIAL e diz por que (reflete a API, nao vira CALCULADO)", () => {
  const sem = celulaPrevia();
  (sem.componentes as any).cmv = comp("indisponivel", null, "indisponivel");
  sem.margem_contribuicao_conhecida = {
    ...sem.margem_contribuicao_conhecida, valor: 650, pct_receita: 65,
    componentes_usados: ["taxas", "frete"], componentes_parciais: ["taxas"],
    faltam: ["devolucoes", "ads", "cmv", "impostos"],
  };
  const tk = proj(resposta([sem])).data.celulas[0];
  assert.equal(tk.cmv.valor, null);
  assert.equal(tk.resultado.status, "PARCIAL");
  assert.equal(tk.resultado.valor, 650);
  assert.match(tk.resultado.motivo, /sem CMV na conta/);
});

test("cenario estimado: linhas com origem premissa/extrapolado, nulo continua nulo, limitacao declarada", () => {
  const env = proj(T0090());
  const cp = env.data.celulas[0].cenario_premissas;
  assert.equal(cp.natureza, "estimada");
  assert.equal(cp.celulas_sem_premissa, 0);
  assert.equal(cp.margem_estimada, 157.42, "subtotal estimado continua em margem_estimada");
  // So' as linhas ESTIMADAS, compactas (linha -> valor), separadas por origem.
  assert.deepEqual(cp.linhas_premissa, { icms: 120 });
  assert.deepEqual(cp.linhas_extrapoladas, { cmv: 400, despesas_marketplace: 322.58 });
  // Premissa ausente: valor nulo, nunca 0.
  const ausente = T0090() as any;
  ausente.por_canal_marca[0].cenario_premissas.linhas.push({
    linha: "pis", rotulo: "PIS", tipo: "item", valor: null, pct_receita: null, origem: "premissa",
    percentual: null, status: "indisponivel", motivo: "premissa ausente", somavel: true,
  });
  assert.equal(proj(ausente).data.celulas[0].cenario_premissas.linhas_premissa.pis, null);
  const lim = env.data.limitations.find((l: any) => l.topic === "dre_cenario_estimado");
  assert.ok(lim);
  assert.equal(lim.motivo, "CENARIO_ESTIMADO");
  assert.match(lim.description, /premissa sao taxa de orcamento/);
  assert.match(lim.description, /nao foram medidas/);
  // Cenario sem linhas (API antiga/fixture reduzida): `null`, nunca lista inventada.
  const semLinhas = T0090() as any;
  delete semLinhas.por_canal_marca[0].cenario_premissas.linhas;
  delete semLinhas.por_canal_marca[0].cenario_premissas.celulas_sem_premissa;
  const cp2 = proj(semLinhas).data.celulas[0].cenario_premissas;
  assert.equal(cp2.linhas_premissa, null);
  assert.equal(cp2.linhas_extrapoladas, null);
  assert.equal(cp2.celulas_sem_premissa, null);
  // Origem de linha fora do dominio: falha fechada.
  const ruim = T0090() as any;
  ruim.por_canal_marca[0].cenario_premissas.linhas[1].origem = "chute";
  assert.throws(() => proj(ruim), (e: unknown) => e instanceof OracleToolError && e.category === "INVALID_UPSTREAM_RESPONSE");
});

test("CALCULADO completo continua igual (todos realizados)", () => {
  const ml = proj(T0090()).data.celulas[1];
  assert.equal(ml.classificacao_fonte, "COMPLETA");
  assert.equal(ml.fecha_em, null);
  for (const k of ["receita", "devolucoes", "taxas", "ads", "frete", "cmv", "impostos"]) {
    assert.equal(ml[k].status, "CALCULADO", k);
    assert.equal(ml[k].origem, "realizado", k);
  }
  assert.equal(ml.devolucoes.valor, 0, "zero medido continua 0");
  assert.equal(ml.afiliados.status, "NAO_APLICAVEL");
  assert.equal(ml.afiliados.valor, null);
  assert.equal(ml.resultado.status, "CALCULADO");
  assert.equal(ml.resultado.valor, 280);
  assert.equal(ml.resultado.motivo, "Margem de contribuicao conhecida");
  assert.equal(ml.margem_pct, 28);
  assert.equal(ml.custos_conhecidos.status, "CALCULADO");
  assert.equal(ml.custos_conhecidos.valor, 720);
  assert.deepEqual(ml.margem_conhecida.componentes_parciais, []);
  assert.equal(ml.margem_conhecida.aviso, null);
  assert.equal(ml.cenario_premissas, null);
});

test("NAO_CALCULAVEL / ausente -> null, nunca 0 (mesmo se a fonte mandar 0)", () => {
  const sh = proj(T0090()).data.celulas[2];
  assert.equal(sh.classificacao_fonte, "NAO_CALCULAVEL");
  for (const k of ["receita", "devolucoes", "taxas", "ads", "frete", "cmv", "impostos"]) {
    assert.equal(sh[k].valor, null, k);
    assert.equal(sh[k].status, "NAO_CALCULAVEL", k);
  }
  assert.equal(sh.resultado.valor, null);
  assert.equal(sh.resultado.status, "NAO_CALCULAVEL");
  assert.equal(sh.margem_pct, null);
  assert.equal(sh.custos_conhecidos.valor, null);
  // Origem que promete numero sem numero na fonte: continua nulo.
  const inconsistente = celulaPrevia();
  (inconsistente.componentes as any).taxas = comp("parcial", null, "parcial", { entra_na_margem: true });
  const tk = proj(resposta([inconsistente])).data.celulas[0];
  assert.equal(tk.taxas.valor, null);
  assert.equal(tk.taxas.status, "NAO_CALCULAVEL");
  assert.equal(tk.resultado.valor, null, "custo da margem sem valor exposto: margem nao sai");
  assert.equal(tk.resultado.status, "NAO_CALCULAVEL");
});

test("lote vencido derruba tambem o parcial dependente do lote, e a margem que o usa", () => {
  const velho = "2026-11-08T00:00:00Z"; // 84 h antes de NOW
  const raw = T0090() as any;
  raw.fontes.insumos_dre.publicado_em = velho;
  const env = proj(raw);
  const tk = env.data.celulas[0];
  for (const k of ["taxas", "cmv", "frete"]) {
    assert.equal(tk[k].valor, null, k);
    assert.equal(tk[k].status_fonte, "snapshot_vencido", k);
  }
  assert.ok(!("valor_medido" in tk.cmv), "medido de lote vencido nao sai");
  assert.equal(tk.resultado.valor, null);
  assert.equal(tk.resultado.status, "NAO_CALCULAVEL");
  assert.ok(topicos(env).includes("dre_insumos_indisponiveis"));
  assert.ok(topicos(env).includes("dre_valor_nao_confirmado"), "valor da fonte nao exposto e' declarado");
});

test("resposta anterior a T-0090 (sem origem): continua conservadora", () => {
  const antiga = celulaPrevia();
  for (const c of Object.values(antiga.componentes) as any[]) {
    delete c.origem; delete c.entra_na_margem; delete c.cobertura_rotulo; delete c.valor_medido;
  }
  const env = proj(resposta([antiga]));
  const tk = env.data.celulas[0];
  assert.equal(tk.taxas.valor, null, "parcial sem origem nao e' exposto");
  assert.equal(tk.taxas.origem, null);
  assert.equal(tk.cmv.valor, null);
  assert.equal(tk.frete.status, "CALCULADO");
  assert.equal(tk.frete.entra_na_margem, false);
  assert.equal(tk.resultado.valor, null);
  assert.ok(topicos(env).includes("dre_valor_nao_confirmado"));
});

test("teto de 240 KB preservado com linhas do cenario e textos longos; corte declarado", async () => {
  const longo = (i: number) => `motivo ${i} `.padEnd(280, "x");
  const lista = Array.from({ length: 32 }, (_, i) => longo(i));
  const linhas = Array.from({ length: 29 }, (_, i) => ({
    linha: `linha_${i}`, rotulo: `Linha ${i}`, tipo: "item", valor: 1234.56 + i, pct_receita: 12.34,
    origem: i % 2 ? "premissa" : "extrapolado", percentual: 0.12, status: "ok", motivo: `motivo ${i}`, somavel: true,
  }));
  const gorda = (canal: string | null, marca: string | null) => {
    const c = celulaPrevia({ canal, marca, motivos_classificacao: lista, avisos_qualidade: lista }) as any;
    c.cenario_premissas = cenario({ linhas, motivos: lista.slice(0, 4), avisos: lista.slice(0, 4) });
    for (const k of Object.keys(c.componentes)) c.componentes[k].cobertura_rotulo = longo(0);
    return c;
  };
  const canais = ["tiktok", "ml", "shopee"];
  const marcas = ["apice", "barbours", "kokeshi", "lescent", "rituaria"];
  const grande = resposta(canais.flatMap((c) => marcas.map((m) => gorda(c, m))), {
    total: gorda(null, null),
    por_canal: canais.map((c) => gorda(c, null)),
    por_marca: marcas.map((m) => gorda(null, m)),
  });
  const bruto = new TextEncoder().encode(JSON.stringify(grande)).byteLength;
  // Acima do teto padrao do adapter (256 KB), abaixo do teto da DRE no adapter (1 MiB).
  assert.ok(bruto > 256 * 1024 && bruto < 1024 * 1024, `fixture com ${bruto} bytes`);

  const env = projectDre(grande, { ref_month: "2026-10" }, NOW, DRE_MAX_RESPONSE_BYTES) as any;
  assert.ok(dreResultBytes(env) <= DRE_MAX_RESPONSE_BYTES, `resposta com ${dreResultBytes(env)} bytes`);
  assert.equal(env.meta.total_count, 24);
  assert.ok(env.meta.returned_count < 24);
  assert.equal(env.meta.truncated, true);
  assert.equal(env.data.corte.celulas_omitidas, 24 - env.meta.returned_count);
  assert.ok(env.data.total, "o total nunca e' o primeiro a sair");
  assert.equal(Object.keys(env.data.total.cenario_premissas.linhas_premissa).length, 14);
  assert.equal(Object.keys(env.data.total.cenario_premissas.linhas_extrapoladas).length, 15);
  assert.ok(topicos(env).includes("dre_corte_por_tamanho"));

  // Pela tool (JSON-RPC em memoria): mesma garantia, abaixo de 256 KB.
  const server = buildOracleServer({
    backendBaseUrl: "https://mktplace-api.onrender.com",
    fetchImpl: (async () => new Response(JSON.stringify(grande), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch,
    now: () => NOW,
    rateLimiter: new SlidingWindowRateLimiter({ limit: 1000, windowMs: 60_000 }),
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "dre-previa", version: "0.0.0" });
  await Promise.all([client.connect(ct), server.connect(st)]);
  const res = await client.callTool({ name: "torre_dre", arguments: { ref_month: "2026-10" } });
  assert.notEqual(res.isError, true, JSON.stringify(res.content).slice(0, 300));
  assert.ok(new TextEncoder().encode(JSON.stringify(res)).byteLength < 256 * 1024);
});

test("payload realista T-0090 (3 celulas) cabe sem corte", () => {
  const env = projectDre(T0090(), { ref_month: "2026-10" }, NOW, DRE_MAX_RESPONSE_BYTES) as any;
  assert.equal(env.meta.truncated, false);
  assert.equal(env.data.corte, null);
  assert.equal(env.data.celulas.length, 3);
});
