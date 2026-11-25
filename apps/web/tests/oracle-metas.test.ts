// torre_metas — resultado do mes e meta do dia, com as funcoes do Gerencial.
// Nada aqui toca rede: o upstream e' um `fetch` falso. Numeros FICTICIOS.
import { test } from "node:test";
import assert from "node:assert/strict";

import { OracleToolError } from "../src/server/oracle/errors.ts";
import { TorreClient } from "../src/server/oracle/torre-client.ts";
import { metasTool } from "../src/server/oracle/tools-metas.ts";
import { progressoDoDia } from "../src/lib/metas-curva.ts";
import { FIXED_NOW } from "./oracle-fixtures.ts";

type Route = unknown | ((u: URL) => unknown);

function deps(routes: Record<string, Route>, calls: URL[] = [], now: Date = FIXED_NOW) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const u = new URL(typeof input === "string" ? input : input.toString());
    calls.push(u);
    const r = routes[u.pathname];
    const payload = typeof r === "function" ? (r as (u: URL) => unknown)(u) : r;
    return new Response(JSON.stringify(payload ?? { detail: "nao" }), {
      status: payload === undefined ? 404 : 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { client: new TorreClient({ baseUrl: "https://mktplace-api-6wif.onrender.com", fetchImpl }), now: () => now };
}

async function run(routes: Record<string, Route>, args: Record<string, unknown> = {}, calls: URL[] = [], now: Date = FIXED_NOW) {
  const r = await metasTool.run(args, deps(routes, calls, now));
  const env = metasTool.config.outputSchema.parse(r.structuredContent) as { meta: any; data: any };
  return { env, r };
}

const METAS_AGO = {
  mes: "2026-08",
  marcas: [], canais: [],
  celulas: [
    { brand: "apice", channel: "ml", meta_gmv: 100000 },
    { brand: "apice", channel: "shopee", meta_gmv: 50000 },
    { brand: "kokeshi", channel: "ml", meta_gmv: 60000 },
    // Sem linha em /brands: sem venda, mas COM meta.
    { brand: "lescent", channel: "ml", meta_gmv: 20000 },
    // Meta zero nao e' meta.
    { brand: "rituaria", channel: "shopee", meta_gmv: 0 },
  ],
  ultima_alteracao: "2026-08-01T10:00:00Z",
};

const linha = (brand: string, tiktok: number | null, ml: number | null, shopee: number | null) => ({
  brand, label: brand.toUpperCase(), tiktok_gmv: tiktok, ml_gmv: ml, shopee_gmv: shopee, total_gmv: 1, orders: 1,
});

const MES = {
  brands: [linha("apice", 5000, 51000, 20000), linha("kokeshi", null, 30000, null)],
  refreshed_at: "2026-08-18T08:00:00Z",
};
const DIA_17 = { brands: [linha("apice", null, 3000, 1000), linha("kokeshi", null, 2000, null)], refreshed_at: "2026-08-18T08:00:00Z" };
const DIA_18 = { brands: [linha("apice", null, 500, null), linha("kokeshi", null, null, null)], refreshed_at: "2026-08-18T09:00:00Z" };
// 17/08 sem venda: o ultimo dia COM dado e' 16/08.
const TREND = {
  data: Array.from({ length: 17 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, "0")}`, label: String(i + 1), gmv: i === 16 ? 0 : 1000, orders: 1,
  })),
  refreshed_at: "2026-08-18T08:00:00Z",
};

const ROTAS: Record<string, Route> = {
  "/api/v1/metas/2026-08": METAS_AGO,
  "/api/v1/performance/brands": (u: URL) => {
    const de = u.searchParams.get("date_from");
    const ate = u.searchParams.get("date_to");
    if (de === "2026-08-01") return MES;
    if (de === "2026-08-17" && ate === "2026-08-17") return DIA_17;
    if (de === "2026-08-18" && ate === "2026-08-18") return DIA_18;
    return undefined;
  },
  "/api/v1/performance/trend": TREND,
};

test("metas: caminho feliz — mes comparavel so' nas celulas com meta, ate' ontem, ultimo dia com dado", async () => {
  const calls: URL[] = [];
  const { env } = await run(ROTAS, {}, calls);
  const m = env.data.resultado_do_mes;
  assert.equal(m.estado, "calculado");
  assert.deepEqual(m.periodo, { inicio: "2026-08-01", fim: "2026-08-17" });
  assert.equal(m.ultimo_dia_com_dado, "2026-08-16");

  const t = m.total;
  assert.equal(t.meta, 230000, "meta zero e TikTok (sem meta) nao entram");
  assert.equal(t.realizado, 101000, "os 5.000 do TikTok sem meta ficam FORA do realizado");
  assert.equal(t.atingimento_pct, 43.91);
  assert.equal(t.falta, 129000);
  assert.equal(t.dias_no_mes, 31);
  assert.equal(t.dias_com_dado, 16, "usa o ultimo dia com venda, nao ontem");
  assert.equal(t.status, "abaixo");
  assert.ok(t.projecao > 0 && t.projecao < t.meta);

  assert.deepEqual(m.por_marca.map((x: any) => x.marca).sort(), ["apice", "kokeshi", "lescent"]);
  const apice = m.por_marca.find((x: any) => x.marca === "apice");
  assert.equal(apice.realizado, 71000);
  assert.deepEqual(apice.canais_com_meta, ["ml", "shopee"]);
  const lescent = m.por_marca.find((x: any) => x.marca === "lescent");
  assert.equal(lescent.realizado, 0, "marca COM meta e sem venda: zero, como o Gerencial");
  assert.deepEqual(m.sem_venda_no_periodo, [{ marca: "lescent", canal: "ml" }]);
  assert.deepEqual(m.por_canal.map((x: any) => x.canal).sort(), ["ml", "shopee"]);

  // Ausencias ditas, nunca meta zero.
  assert.deepEqual(env.data.canais_sem_meta, ["tiktok"]);
  assert.deepEqual(env.data.marcas_sem_meta, ["barbours", "rituaria"]);
  assert.ok(env.meta.warnings.some((w: string) => w.includes("tiktok") && w.includes("NAO entra")));
  assert.ok(env.data.limitations.some((l: any) => l.topic === "metas_mesma_regra_gerencial"));
  assert.ok(env.data.limitations.some((l: any) => l.topic === "metas_sem_curva_diaria"));

  // Metas: o parametro de caminho nao vai para a query; brands sai com a janela e o escopo.
  const metasCall = calls.find((u) => u.pathname === "/api/v1/metas/2026-08")!;
  assert.equal(metasCall.search, "");
  const brandsMes = calls.find((u) => u.pathname.endsWith("/brands") && u.searchParams.get("date_from") === "2026-08-01")!;
  assert.equal(brandsMes.searchParams.get("date_to"), "2026-08-17");
  assert.equal(brandsMes.searchParams.get("channels"), "all");
  assert.equal(calls.length, 5, "metas + brands(mes) + trend + brands(ontem) + brands(hoje)");
});

test("metas: meta do dia — ontem fechado e hoje em andamento (celula sem venda fica fora)", async () => {
  const { env } = await run(ROTAS);
  const [ontem, hoje] = env.data.meta_do_dia;
  assert.equal(ontem.dia, "2026-08-17");
  assert.equal(ontem.em_andamento, false);
  assert.equal(hoje.dia, "2026-08-18");
  assert.equal(hoje.em_andamento, true);

  // A conta e' a do Gerencial: confere contra a funcao pura.
  const celulas = METAS_AGO.celulas.filter((c) => c.meta_gmv > 0);
  const linhas = (b: typeof DIA_17) => b.brands.map((x) => ({ brand: x.brand, tiktok_gmv: x.tiktok_gmv, ml_gmv: x.ml_gmv, shopee_gmv: x.shopee_gmv }));
  const o = progressoDoDia({ celulas, linhas: linhas(DIA_17), dia: "2026-08-17", hoje: "2026-08-18" })!;
  assert.equal(ontem.resultado.meta_do_dia, o.metaDoDia);
  assert.equal(ontem.resultado.realizado, 6000);
  assert.equal(ontem.resultado.status, "nao_atingida");
  assert.deepEqual(ontem.resultado.sem_dado, [], "dia fechado e canal ja' chegou: marca sem venda conta zero");

  const h = progressoDoDia({ celulas, linhas: linhas(DIA_18), dia: "2026-08-18", hoje: "2026-08-18" })!;
  assert.equal(hoje.resultado.meta_com_dado, h.metaComDado);
  assert.equal(hoje.resultado.realizado, 500);
  assert.equal(hoje.resultado.status, "em_andamento");
  assert.ok(hoje.resultado.meta_com_dado < hoje.resultado.meta_do_dia);
  assert.deepEqual(
    hoje.resultado.sem_dado.map((c: any) => `${c.marca}/${c.canal}`).sort(),
    ["apice/shopee", "kokeshi/ml", "lescent/ml"],
  );
  assert.ok(hoje.resultado.resumo_sem_dado.length > 0);
  assert.ok(env.meta.warnings.some((w: string) => w.includes("em andamento")));
});

test("metas: dia pedido (com curva de nov/26): evento do dia e meta da curva, hoje em BRT", async () => {
  const now = new Date("2026-11-12T12:00:00Z");
  const nov = { mes: "2026-11", marcas: [], canais: [], ultima_alteracao: null, celulas: [{ brand: "apice", channel: "ml", meta_gmv: 300000 }] };
  const dia11 = { brands: [linha("apice", null, 700000, null)], refreshed_at: null };
  const routes = { "/api/v1/metas/2026-11": nov, "/api/v1/performance/brands": dia11, "/api/v1/performance/trend": { data: [], refreshed_at: null } };
  const { env } = await run(routes, { dia: "2026-11-11", marcas: ["apice"], canais: ["ml"] }, [], now);
  assert.equal(env.data.hoje, "2026-11-12");
  assert.equal(env.data.meta_do_dia.length, 1);
  const d = env.data.meta_do_dia[0];
  assert.equal(d.evento, "11/11");
  const o = progressoDoDia({ celulas: nov.celulas, linhas: [{ brand: "apice", tiktok_gmv: null, ml_gmv: 700000, shopee_gmv: null }], dia: "2026-11-11", hoje: "2026-11-12" })!;
  assert.equal(d.resultado.meta_do_dia, o.metaDoDia);
  assert.ok(d.resultado.meta_do_dia > 300000 / 30, "dia de evento pesa mais que o dia normal");
  assert.ok(!env.data.limitations.some((l: any) => l.topic === "metas_sem_curva_diaria"), "nov/26 tem curva");
});

test("metas: mes sem nenhuma meta -> dado ausente dito, nunca 0% nem meta 0 (e nenhuma chamada de GMV)", async () => {
  const calls: URL[] = [];
  const { env } = await run(
    { "/api/v1/metas/2026-07": { mes: "2026-07", marcas: [], canais: [], celulas: [], ultima_alteracao: null } },
    { mes: "2026-07" }, calls,
  );
  const m = env.data.resultado_do_mes;
  assert.equal(m.estado, "sem_meta_no_escopo");
  assert.equal(m.total, null);
  assert.deepEqual(m.por_marca, []);
  assert.deepEqual(env.data.celulas_com_meta, []);
  assert.deepEqual(env.data.meta_do_dia, []);
  assert.equal(env.data.marcas_sem_meta.length, 5);
  assert.equal(env.data.canais_sem_meta.length, 3);
  assert.ok(env.meta.warnings.some((w: string) => w.includes("nao meta zero")));
  assert.deepEqual(calls.map((u) => u.pathname), ["/api/v1/metas/2026-07"]);
});

test("metas: escopo sem meta (marca/canal pedido sem celula) -> sem_meta no escopo, nao zero", async () => {
  const { env } = await run(ROTAS, { marcas: ["barbours"] });
  assert.equal(env.data.resultado_do_mes.estado, "sem_meta_no_escopo");
  assert.equal(env.data.resultado_do_mes.total, null);
  assert.deepEqual(env.data.marcas_sem_meta, ["barbours"]);
});

test("metas: mes encerrado (jul) usa o mes inteiro, sem meta do dia por padrao", async () => {
  const jul = { mes: "2026-07", marcas: [], canais: [], ultima_alteracao: null, celulas: [{ brand: "apice", channel: "ml", meta_gmv: 100000 }] };
  const calls: URL[] = [];
  const { env } = await run({
    "/api/v1/metas/2026-07": jul,
    "/api/v1/performance/brands": { brands: [linha("apice", null, 120000, null)], refreshed_at: null },
    "/api/v1/performance/trend": { data: [], refreshed_at: null },
  }, { mes: "2026-07" }, calls);
  const m = env.data.resultado_do_mes;
  assert.deepEqual(m.periodo, { inicio: "2026-07-01", fim: "2026-07-31" });
  assert.equal(m.total.encerrado, true);
  assert.equal(m.total.status, "atingida");
  assert.equal(m.total.atingimento_pct, 120);
  assert.equal(m.total.falta, 0);
  assert.deepEqual(env.data.meta_do_dia, []);
  assert.equal(m.ultimo_dia_com_dado, null, "serie vazia nao inventa dia com dado");
  assert.ok(!env.data.limitations.some((l: any) => l.topic === "metas_dias_fechados"));
});

test("metas: falha da serie diaria e do GMV de hoje ficam ditas, sem virar zero e sem derrubar o mes", async () => {
  const routes = { ...ROTAS, "/api/v1/performance/trend": undefined, "/api/v1/performance/brands": (u: URL) => (u.searchParams.get("date_from") === "2026-08-18" ? undefined : u.searchParams.get("date_from") === "2026-08-17" ? DIA_17 : MES) };
  const { env } = await run(routes);
  assert.equal(env.data.resultado_do_mes.ultimo_dia_com_dado, null);
  assert.equal(env.data.resultado_do_mes.total.dias_com_dado, 17, "sem a serie, ontem — como o Gerencial");
  const hoje = env.data.meta_do_dia[1];
  assert.equal(hoje.disponibilidade, "unavailable");
  assert.equal(hoje.resultado, null);
  assert.equal(hoje.motivo_indisponivel, "falha_ao_ler_gmv_do_dia");
  assert.ok(env.meta.warnings.some((w: string) => w.includes("nao trate como zero")));
});

test("metas: mes futuro e primeiro dia do mes dizem que nao ha realizado", async () => {
  const calls: URL[] = [];
  const dez = { mes: "2026-12", marcas: [], canais: [], ultima_alteracao: null, celulas: [{ brand: "apice", channel: "ml", meta_gmv: 1000 }] };
  const { env } = await run({ "/api/v1/metas/2026-12": dez }, { mes: "2026-12" }, calls);
  assert.equal(env.data.resultado_do_mes.estado, "mes_futuro");
  assert.equal(env.data.resultado_do_mes.total, null);
  assert.equal(env.data.celulas_com_meta[0].meta_gmv, 1000);
  assert.equal(calls.length, 1);

  const set = { mes: "2026-09", marcas: [], canais: [], ultima_alteracao: null, celulas: [{ brand: "apice", channel: "ml", meta_gmv: 1000 }] };
  const dia1 = new Date("2026-09-01T12:00:00Z");
  const r = await run({ "/api/v1/metas/2026-09": set, "/api/v1/performance/brands": { brands: [], refreshed_at: null } }, {}, [], dia1);
  assert.equal(r.env.data.resultado_do_mes.estado, "sem_dia_fechado");
  assert.deepEqual(r.env.data.meta_do_dia.map((d: any) => d.dia), ["2026-09-01"], "ontem e' de agosto");
});

test("metas: contrato quebrado -> INVALID_UPSTREAM_RESPONSE", async () => {
  const invalido = (e: unknown) => e instanceof OracleToolError && e.category === "INVALID_UPSTREAM_RESPONSE";
  await assert.rejects(() => run({ ...ROTAS, "/api/v1/metas/2026-08": { mes: "2026-08", celulas: "x" } }), invalido);
  await assert.rejects(
    () => run({ ...ROTAS, "/api/v1/metas/2026-08": { ...METAS_AGO, celulas: [{ brand: "apice", channel: "amazon", meta_gmv: 1 }] } }),
    invalido,
    "canal fora do enum fechado",
  );
  await assert.rejects(() => run({ ...ROTAS, "/api/v1/metas/2026-08": { ...METAS_AGO, mes: "2026-07" } }), invalido, "mes devolvido difere do pedido");
  await assert.rejects(
    () => run({ ...ROTAS, "/api/v1/performance/brands": { brands: [{ brand: "apice", ml_gmv: "muito" }] } }),
    invalido,
  );
});

test("metas: entrada invalida falha antes de qualquer chamada (strict, mes, dia)", async () => {
  const calls: URL[] = [];
  for (const args of [
    { foo: 1 },
    { mes: "2026-13" },
    { mes: "2023-01" },
    { dia: "2026-08-19" },
    { dia: "2026-07-30", mes: "2026-08" },
    { canais: ["amazon"] },
    { marcas: ["apice", "apice"] },
    { canais: [] },
  ]) {
    await assert.rejects(() => metasTool.run(args, deps(ROTAS, calls)), undefined, JSON.stringify(args));
  }
  assert.equal(calls.length, 0);
});

test("metas: saida sem dado pessoal e dentro do teto do adapter", async () => {
  const { env, r } = await run(ROTAS);
  const s = JSON.stringify(env);
  for (const proibido of ["cliente", "customer", "buyer", "endereco", "address", "order_id", "pedido", "cpf", "email", "texto"]) {
    assert.ok(!s.toLowerCase().includes(proibido), `saida nao pode conter ${proibido}`);
  }
  assert.ok(s.length < 64 * 1024, `saida compacta (${s.length} bytes)`);
  assert.match(r.content[0].text, /Metas\. 2026-08/);
  assert.equal(env.meta.filters_applied.base, "pagos");
});
