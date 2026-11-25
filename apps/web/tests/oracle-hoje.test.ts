// torre_hoje (MCP-AMPLIADO) — vendas de hoje por hora. Nada aqui toca rede.
// Grupos: caminho feliz (cortes por canal), ausencia x zero, indisponivel,
// canais_fora, base=realizados, contrato quebrado, entrada estrita, sem PII.
import { test } from "node:test";
import assert from "node:assert/strict";

import { OracleToolError } from "../src/server/oracle/errors.ts";
import { TorreClient } from "../src/server/oracle/torre-client.ts";
import { hojeTool } from "../src/server/oracle/tools-hoje.ts";
import { FIXED_NOW } from "./oracle-fixtures.ts";

const bloco = (gmv: number, pedidos: number) => ({ gmv, pedidos, ticket: pedidos ? Math.round((gmv / pedidos) * 100) / 100 : null });
const tend = (hoje: number, ate: number, dia: number, projecao: number | null) => ({
  hoje, ontem_mesma_hora: ate, ontem_dia: dia, projecao,
});

/** Payload fiel ao schema Pydantic; cortes DIFERENTES (ml 14h, shopee 12h, tiktok 14h). */
const HOJE = {
  disponivel: true,
  motivo: null,
  dia: "2026-08-18",
  corte_hora: 14,
  canais: [
    { channel: "tiktok", fonte_ate: "2026-08-18T17:10:00+00:00", horas_fechadas_hoje: 14, corte_hora: 14 },
    { channel: "ml", fonte_ate: "2026-08-18T17:20:00+00:00", horas_fechadas_hoje: 14, corte_hora: 14 },
    { channel: "shopee", fonte_ate: "2026-08-18T15:05:00+00:00", horas_fechadas_hoje: 12, corte_hora: 12 },
  ],
  limitacoes: ["Shopee: fonte atrasada em relacao aos demais canais.\u0000"],
  hoje: bloco(9000, 90),
  ontem: bloco(8000, 80),
  semana_passada: bloco(7000, 70),
  por_canal: [
    { channel: "tiktok", hoje: bloco(2000, 20), ontem: bloco(1800, 18), semana_passada: bloco(1500, 15) },
    { channel: "ml", hoje: bloco(5000, 50), ontem: bloco(4500, 45), semana_passada: bloco(4000, 40) },
    { channel: "shopee", hoje: bloco(2000, 20), ontem: bloco(1700, 17), semana_passada: bloco(1500, 15) },
  ],
  por_marca: [
    {
      brand: "apice", ...tend(6000, 5500, 12000, 13090.91),
      por_canal: [
        { channel: "ml", ...tend(4000, 3500, 7000, 8000) },
        { channel: "shopee", ...tend(2000, 2000, 5000, 5000) },
      ],
      canais_fora: [],
    },
    {
      brand: "kokeshi", ...tend(3000, 0, 2000, null),
      por_canal: [{ channel: "tiktok", ...tend(3000, 0, 2000, null) }],
      canais_fora: ["shopee"],
    },
  ],
  base: "pagos",
  nao_pago_disponivel: null,
};

type Handler = (u: URL) => unknown;

function deps(handler: Handler, calls: URL[] = []) {
  const client = new TorreClient({
    baseUrl: "https://mktplace-api-6wif.onrender.com",
    fetchImpl: (async (input: RequestInfo | URL) => {
      const u = new URL(typeof input === "string" ? input : input.toString());
      calls.push(u);
      return new Response(JSON.stringify(handler(u)), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch,
  });
  return { client, now: () => FIXED_NOW };
}

async function run(payload: unknown, args: Record<string, unknown> = {}, calls: URL[] = []) {
  const res = await hojeTool.run(args, deps(() => payload, calls));
  // A saida TEM de passar no outputSchema declarado.
  hojeTool.config.outputSchema.parse(res.structuredContent);
  return res.structuredContent as { meta: Record<string, any>; data: any };
}

test("hoje: caminho feliz — cada canal no seu corte, total com aviso, sem calcular variacao", async () => {
  const calls: URL[] = [];
  const env = await run(HOJE, {}, calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, "/api/v1/performance/hoje-por-hora");
  assert.equal(calls[0].searchParams.get("base"), "pagos");
  assert.equal(calls[0].searchParams.get("channels"), null);

  const d = env.data;
  assert.equal(d.disponivel, true);
  assert.equal(d.cortes_diferentes, true);
  const sh = d.canais.find((c: any) => c.canal === "shopee");
  assert.equal(sh.corte_hora, 12);
  assert.equal(sh.vendas_ate, "12:00");
  assert.equal(sh.ultima_hora_fechada, 11);
  assert.equal(d.total.hoje.gmv, 9000);
  assert.equal(d.total.ontem.gmv, 8000);
  assert.equal(d.total.semana_passada.gmv, 7000);
  assert.deepEqual(d.total.canais_no_total.sort(), ["ml", "shopee", "tiktok"]);
  assert.equal(d.por_canal.find((c: any) => c.canal === "ml").hoje.gmv, 5000);

  assert.equal(env.meta.monetary_unit, "reais");
  assert.deepEqual(env.meta.period, { start: "2026-08-18", end: "2026-08-18", inclusive: true });
  assert.equal(env.meta.refreshed_at, "2026-08-18T15:05:00+00:00", "fonte mais antiga");
  const w = env.meta.warnings.join("\n");
  assert.match(w, /cortes diferentes/);
  assert.match(w, /Dia corrente parcial/);
  assert.match(w, /Shopee: fonte atrasada/, "limitacao da API passa, saneada");
  assert.ok(!w.includes("\u0000"));
  // Nenhuma variacao inventada pelo MCP.
  assert.ok(!JSON.stringify(env.data).match(/variacao|delta|pct/i));
});

test("hoje: projecao por marca; null = sem base (nunca 0) e canais_fora vira warning", async () => {
  const env = await run(HOJE);
  const [apice, kokeshi] = env.data.por_marca;
  assert.equal(apice.projecao, 13090.91);
  assert.equal(apice.tendencia_vale_como_total, true);
  assert.equal(kokeshi.projecao, null);
  assert.notEqual(kokeshi.projecao, 0);
  assert.equal(kokeshi.por_canal[0].projecao, null);
  assert.equal(kokeshi.tendencia_vale_como_total, false);
  assert.deepEqual(kokeshi.canais_fora, ["shopee"]);
  const w = env.meta.warnings.join("\n");
  assert.match(w, /kokeshi: Shopee ficou FORA/);
  assert.match(w, /Sem projecao .* kokeshi/);
});

test("hoje: canal sem hora fechada => nulos (nunca 0) e total parcial avisado", async () => {
  const payload = {
    ...HOJE,
    canais: [
      HOJE.canais[0],
      { channel: "ml", fonte_ate: null, horas_fechadas_hoje: 0, corte_hora: 0 },
    ],
    por_canal: [
      HOJE.por_canal[0],
      { channel: "ml", hoje: bloco(0, 0), ontem: bloco(0, 0), semana_passada: bloco(0, 0) },
    ],
    por_marca: [{
      brand: "apice", ...tend(2000, 1800, 9000, 10000),
      por_canal: [{ channel: "ml", ...tend(0, 0, 4000, null) }, { channel: "tiktok", ...tend(2000, 1800, 5000, 5555.56) }],
      canais_fora: [],
    }],
  };
  const env = await run(payload, { canais: ["tiktok", "ml"] });
  const ml = env.data.por_canal.find((c: any) => c.canal === "ml");
  assert.equal(ml.hoje, null);
  assert.equal(ml.ontem, null);
  assert.equal(ml.semana_passada, null);
  assert.equal(env.data.canais.find((c: any) => c.canal === "ml").vendas_ate, null);
  const mlMarca = env.data.por_marca[0].por_canal.find((c: any) => c.canal === "ml");
  assert.equal(mlMarca.hoje, null);
  assert.equal(mlMarca.projecao, null);
  assert.deepEqual(env.data.total.canais_no_total, ["tiktok"]);
  assert.match(env.meta.warnings.join("\n"), /Mercado Livre: nenhuma hora fechada .* nao e' venda zero.*PARCIAL/);
});

test("hoje: nenhum canal com hora fechada => total null, nao zero", async () => {
  const payload = {
    ...HOJE, corte_hora: 0,
    canais: HOJE.canais.map((c) => ({ ...c, fonte_ate: null, horas_fechadas_hoje: 0, corte_hora: 0 })),
    hoje: bloco(0, 0), ontem: bloco(0, 0), semana_passada: bloco(0, 0), por_marca: [],
  };
  const env = await run(payload);
  assert.equal(env.data.total, null);
  assert.equal(env.meta.refreshed_at, null);
  assert.equal(env.data.cortes_diferentes, false);
});

test("hoje: marca pedida sem linha e' dita, nao zero; filtros vao como CSV", async () => {
  const calls: URL[] = [];
  const payload = { ...HOJE, por_marca: [HOJE.por_marca[0]] };
  const env = await run(payload, { canais: ["shopee", "ml"], marcas: ["rituaria", "apice"] }, calls);
  assert.equal(calls[0].searchParams.get("channels"), "ml,shopee");
  assert.equal(calls[0].searchParams.get("brands"), "apice,rituaria");
  assert.deepEqual(env.data.marcas_sem_linha, ["rituaria"]);
  assert.ok(!env.data.por_marca.some((m: any) => m.brand === "rituaria"));
  assert.match(env.meta.warnings.join("\n"), /rituaria.*ausencia de dado, nao venda zero/);
  assert.deepEqual(env.meta.filters_applied.marcas, ["rituaria", "apice"]);
});

test("hoje: disponivel=false => nenhum numero e motivo dito", async () => {
  const env = await run({
    disponivel: false, motivo: "As vendas por hora ainda nao estao publicadas.", dia: "2026-08-18",
    corte_hora: null, canais: [], limitacoes: [], por_canal: [], por_marca: [], base: "pagos", nao_pago_disponivel: null,
  });
  assert.equal(env.data.disponivel, false);
  assert.match(env.data.motivo_indisponivel, /nao estao publicadas/);
  assert.equal(env.data.total, null);
  assert.deepEqual(env.data.por_canal, []);
  assert.deepEqual(env.data.por_marca, []);
  assert.match(env.meta.warnings[0], /indisponiveis.*nao trate como zero/);
});

test("hoje: base=realizados explica nao pagos e ML sem fonte de nao pago", async () => {
  const calls: URL[] = [];
  const env = await run(
    { ...HOJE, base: "realizados", nao_pago_disponivel: { tiktok: true, ml: false, shopee: true } },
    { base: "realizados" }, calls,
  );
  assert.equal(calls[0].searchParams.get("base"), "realizados");
  assert.equal(env.data.base, "realizados");
  assert.deepEqual(env.data.nao_pago_disponivel, { tiktok: true, ml: false, shopee: true });
  assert.ok(env.data.limitations.some((l: any) => l.topic === "hoje_base_realizados"));
  assert.match(env.meta.warnings.join("\n"), /base=realizados: Mercado Livre sem fonte de nao pago/);
  // Base pagos: nenhum aviso de nao pago.
  const pagos = await run(HOJE);
  assert.ok(!pagos.meta.warnings.join("\n").includes("nao pago"));
  assert.equal(pagos.data.nao_pago_disponivel, null);
});

test("hoje: contrato quebrado => INVALID_UPSTREAM_RESPONSE", async () => {
  const quebrados: unknown[] = [
    { ...HOJE, canais: undefined },
    { ...HOJE, base: "outra" },
    { ...HOJE, por_canal: [{ channel: "amazon", hoje: bloco(1, 1), ontem: bloco(1, 1), semana_passada: bloco(1, 1) }] },
    { ...HOJE, canais: [{ channel: "ml", fonte_ate: null, horas_fechadas_hoje: 3 }] }, // sem corte_hora
    { ...HOJE, por_marca: [{ ...HOJE.por_marca[0], canais_fora: undefined }] },
    "<html>",
  ];
  for (const q of quebrados) {
    await assert.rejects(
      () => hojeTool.run({}, deps(() => q)),
      (e: unknown) => e instanceof OracleToolError && e.category === "INVALID_UPSTREAM_RESPONSE",
    );
  }
});

test("hoje: entrada estrita — chave desconhecida, canal/marca/base invalidos, duplicados", async () => {
  const invalidos: Record<string, unknown>[] = [
    { periodo: "mes" }, { canais: ["amazon"] }, { marcas: ["gocase"] }, { base: "todos" },
    { canais: [] }, { canais: ["ml", "ml"] }, { marcas: "apice" },
  ];
  for (const args of invalidos) {
    await assert.rejects(() => hojeTool.run(args, deps(() => HOJE)), `deveria recusar ${JSON.stringify(args)}`);
  }
});

test("hoje: saida sem campo pessoal", async () => {
  const env = await run({ ...HOJE, cliente: "Maria", endereco: "Rua X", order_ref: "REF-1" });
  const s = JSON.stringify(env);
  for (const proibido of ["Maria", "Rua X", "REF-1", "cliente", "endereco", "order_ref"]) {
    assert.ok(!s.includes(proibido), `saida nao pode conter ${proibido}`);
  }
});
