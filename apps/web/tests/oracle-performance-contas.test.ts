// torre_performance_contas — nota OFICIAL das contas (ML, Shopee, TikTok).
// Numeros FICTICIOS; a forma espelha apps/api/app/schemas/performance_oficial.py.
import { test } from "node:test";
import assert from "node:assert/strict";

import { TorreClient } from "../src/server/oracle/torre-client.ts";
import { OracleToolError } from "../src/server/oracle/errors.ts";
import { performanceContasTool as tool } from "../src/server/oracle/tools-performance-contas.ts";
import { FIXED_NOW } from "./oracle-fixtures.ts";

const NOW_ISO = FIXED_NOW.toISOString();
const ML = {
  gerado_em: NOW_ISO, canal: "mercadolivre", estado: "dado", motivo: null, fonte: "ML seller_reputation",
  cobertura: { marcas: ["barbours"], fora: [{ marca: "apice", motivo: "Sem conta Mercado Livre integrada." }] },
  contas: [{
    marca: "barbours", dia: "2026-08-18", capturado_em: "2026-08-18T06:00:00Z", nivel: "MercadoLíder Platinum",
    tom: "bom", termometro: 5, termometro_max: 5, resumo: "1.200 vendas concluídas nos últimos 60 dias",
    destaques: [{ rotulo: "Termômetro", valor: "Verde", tom: "bom" }],
    metricas: [
      { codigo: "ml_claims", rotulo: "Reclamações", valor: 3.5, unidade: "pct", quantidade: 42, meta: 2, comparador: "<=",
        rotulo_meta: "Até 2% para MercadoLíder", situacao: "fora", ajuda: "texto" },
      // valor 0 REAL e valor ausente: o primeiro fica 0, o segundo fica null.
      { codigo: "ml_cancel", rotulo: "Cancelamentos", valor: 0, unidade: "pct", situacao: "ok", meta: 2, comparador: "<=" },
      { codigo: "ml_delay", rotulo: "Atrasos", valor: null, unidade: "pct", situacao: "sem_meta" },
    ],
    avisos: [],
  }],
  sem_foto: [],
};
const SHOPEE = {
  gerado_em: NOW_ISO, canal: "shopee", estado: "dado", motivo: null, fonte: "Shopee account_health",
  cobertura: { marcas: ["apice", "barbours"], fora: [] },
  contas: [{
    marca: "apice", dia: "2026-08-10", capturado_em: "2026-08-10T06:00:00Z", nivel: "Excelente", tom: "bom",
    termometro: 4, termometro_max: 4, destaques: [], metricas: [], avisos: ["Aviso da fonte"],
  }],
  sem_foto: [{ marca: "barbours", motivo: "Sem fotografia capturada ainda." }],
};
const TIKTOK = {
  gerado_em: NOW_ISO, canal: "tiktokshop", estado: "dado", motivo: null, fonte: "TikTok customer_service",
  cobertura: { marcas: ["apice"], fora: [] },
  contas: [{
    marca: "apice", dia: "2026-08-17", capturado_em: NOW_ISO, nivel: "Resposta 95%", tom: "bom",
    destaques: [], avisos: [],
    metricas: [{ codigo: "tt_resposta", rotulo: "Taxa de resposta", valor: 95, unidade: "pct", situacao: "sem_meta" }],
  }],
  sem_foto: [],
};

type Calls = URL[];
function client(routes: (u: URL) => unknown | undefined, calls: Calls = []) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const u = new URL(typeof input === "string" ? input : input.toString());
    calls.push(u);
    const payload = routes(u);
    if (payload === undefined) return new Response("nf", { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return new TorreClient({ baseUrl: "https://mktplace-api-6wif.onrender.com", fetchImpl });
}
const porCanal = (u: URL) => ({ mercadolivre: ML, shopee: SHOPEE, tiktokshop: TIKTOK })[u.searchParams.get("canal") ?? ""];

async function run(args: unknown, routes = porCanal, calls: Calls = []) {
  const res = await tool.run(args, { client: client(routes, calls), now: () => FIXED_NOW });
  tool.config.outputSchema.parse(res.structuredContent);
  return res.structuredContent as { meta: Record<string, any>; data: any };
}

test("caminho feliz: um GET por canal, nivel e indicadores oficiais, zero real preservado e ausente = null", async () => {
  const calls: Calls = [];
  const env = await run({ marcas: ["apice", "barbours"] }, porCanal, calls);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map((u) => u.searchParams.get("canal")).sort(), ["mercadolivre", "shopee", "tiktokshop"]);
  for (const u of calls) assert.deepEqual(u.searchParams.getAll("brands"), ["apice", "barbours"]);

  const ml = env.data.ml;
  assert.equal(ml.estado, "disponivel");
  assert.equal(ml.medicao, "nota_oficial");
  const c = ml.contas[0];
  assert.equal(c.nivel, "MercadoLíder Platinum");
  assert.equal(c.termometro, 5);
  const [claims, cancel, delay] = c.indicadores;
  assert.equal(claims.valor, 3.5);
  assert.equal(claims.meta, 2);
  assert.equal(claims.situacao, "fora");
  assert.equal(cancel.valor, 0, "zero real continua zero");
  assert.equal(delay.valor, null, "valor ausente = null, nunca 0");
  assert.equal(delay.meta, null);
  assert.ok(env.data.limitations.some((l: any) => l.topic === "performance_oficial_vs_ldr_interna"));
  assert.match(tool.config.description, /OFICIAL/);
  assert.match(tool.config.description, /torre_expedicao_operacional/);
});

test("dado ausente: marca fora do canal, conta sem foto, foto velha e TikTok sem nota oficial sao ditos", async () => {
  const env = await run({});
  assert.deepEqual(env.data.ml.marcas_fora_do_canal, [{ marca: "apice", motivo: "Sem conta Mercado Livre integrada." }]);
  assert.deepEqual(env.data.shopee.sem_fotografia, [{ marca: "barbours", motivo: "Sem fotografia capturada ainda." }]);

  const velha = env.data.shopee.contas[0];
  assert.equal(velha.fotografia_velha, true);
  assert.equal(env.data.ml.contas[0].fotografia_velha, false);
  assert.equal(env.data.ml.contas[0].idade_horas, 6);
  const w = env.meta.warnings.join("\n");
  assert.match(w, /Shopee: fotografia defasada.*apice/);
  assert.match(w, /Shopee: sem fotografia para barbours/);
  assert.match(w, /Mercado Livre: marca inexistente no canal: apice/);

  assert.equal(env.data.tiktok.medicao, "atendimento_sem_nota_oficial");
  assert.ok(env.data.limitations.some((l: any) => l.topic === "tiktok_sem_nota_oficial"));
  assert.equal(env.meta.refreshed_at, "2026-08-10T06:00:00Z", "carimbo = fotografia mais antiga");
});

test("estado sem_fonte / erro do backend vira estado + motivo, sem contas e sem nota", async () => {
  const env = await run({ canais: ["ml", "shopee"] }, (u) =>
    u.searchParams.get("canal") === "mercadolivre"
      ? { ...ML, estado: "sem_fonte", motivo: "Aguardando a primeira captura diária.", contas: [], cobertura: { marcas: [], fora: [] } }
      : { ...SHOPEE, estado: "erro", motivo: "Fonte indisponível nesta carga.", contas: [] });
  assert.equal(env.data.ml.estado, "sem_fonte");
  assert.equal(env.data.ml.contas.length, 0);
  assert.equal(env.data.shopee.estado, "indisponivel");
  assert.equal(env.data.tiktok, null);
  assert.match(env.meta.warnings.join("\n"), /nao trate como nota zero/);
});

test("um canal fora do ar (404/flag desligada) nao derruba os outros; todos fora = SOURCE_UNAVAILABLE", async () => {
  const env = await run({ canais: ["ml", "shopee"] }, (u) => (u.searchParams.get("canal") === "shopee" ? SHOPEE : undefined));
  assert.equal(env.data.ml.estado, "indisponivel");
  assert.equal(env.data.ml.contas.length, 0);
  assert.equal(env.data.shopee.estado, "disponivel");

  await assert.rejects(
    () => run({}, () => undefined),
    (e: unknown) => e instanceof OracleToolError && e.category === "SOURCE_UNAVAILABLE",
  );
});

test("contrato quebrado ou canal trocado -> INVALID_UPSTREAM_RESPONSE", async () => {
  for (const quebrado of [
    { ...ML, estado: "talvez" },
    { ...ML, contas: [{ ...ML.contas[0], tom: "azul" }] },
    { ...ML, canal: "shopee" },
    { ...ML, cobertura: undefined },
  ]) {
    await assert.rejects(
      () => run({ canais: ["ml"] }, () => quebrado),
      (e: unknown) => e instanceof OracleToolError && e.category === "INVALID_UPSTREAM_RESPONSE",
    );
  }
});

test("entrada invalida (.strict, marca/canal desconhecidos, duplicata) falha antes de qualquer GET", async () => {
  for (const args of [{ marca: "apice" }, { marcas: ["denavita"] }, { canais: ["amazon"] }, { canais: ["ml", "ml"] }, { marcas: [] }]) {
    const calls: Calls = [];
    await assert.rejects(() => run(args, porCanal, calls));
    assert.equal(calls.length, 0);
  }
});

test("saida sem dado pessoal nem texto de ajuda da fonte", async () => {
  const sujo = {
    ...ML,
    contas: [{ ...ML.contas[0], cliente: "Fulano", email: "a@b.com", order_ref: "REF-1" }],
    sem_foto: [],
  };
  const env = await run({ canais: ["ml"] }, () => sujo);
  const s = JSON.stringify(env);
  for (const proibido of ["Fulano", "a@b.com", "REF-1", "\"ajuda\"", "cliente", "order_ref"]) {
    assert.ok(!s.includes(proibido), `saida nao pode conter ${proibido}`);
  }
});
