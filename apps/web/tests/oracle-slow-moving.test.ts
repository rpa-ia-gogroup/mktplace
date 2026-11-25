// torre_slow_moving — tool direta (ainda nao registrada em ORACLE_TOOLS).
// Fixtures FICTICIAS; a forma espelha SlowMovingResponse (apps/api/app/schemas/full_slow_moving.py).
import { test } from "node:test";
import assert from "node:assert/strict";

import { OracleToolError } from "../src/server/oracle/errors.ts";
import { TorreClient } from "../src/server/oracle/torre-client.ts";
import { slowMovingTool } from "../src/server/oracle/tools-slow-moving.ts";
import { FIXED_NOW } from "./oracle-fixtures.ts";

const sku = (o: Record<string, unknown>) => ({
  marca: "apice", sku: "AP-1", descricao: "Hidratante 200ml", categoria: "Corpo", curva: "C", status: "Ativo",
  estoque: 100, custo_unitario: 10, valor_parado: 1000, venda_dia: 0.5, cobertura_dias: 200,
  serie: { "ML-F": [0, 1, 0] }, receita_15d: { "ML-F": 42 },
  ...o,
});

const RESP = {
  status: "ok", fonte: "Supply Intelligence (Painel S&OE) · canal Marketplace", atualizado_em: "2026-11-23",
  meta_dias: 120, dias: ["2026-11-22"], vendas_disponivel: true,
  skus: [
    sku({ sku: "AP-1", valor_parado: 1000 }),
    sku({ marca: "kokeshi", sku: "KO-9", descricao: "Batom Descontinuado", curva: "A", status: "Descontinuado", valor_parado: 3000, estoque: 300, venda_dia: 0, cobertura_dias: null }),
    sku({ marca: "kokeshi", sku: "KO-2", descricao: "Brinde nécessaire", curva: "B", status: "Ativo", categoria: "Brinde", valor_parado: 500.456, estoque: null, custo_unitario: null }),
  ],
  capital_marketplace: { apice: 50000, kokeshi: 80000 },
  capital_full: { kokeshi: 12000 },
  parado_full: { kokeshi: 2000 },
};

type Env = { meta: Record<string, any>; data: any };

async function run(payload: unknown, args: Record<string, unknown> = {}, calls: URL[] = []): Promise<Env> {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(new URL(input.toString()));
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = new TorreClient({ baseUrl: "https://mktplace-api-6wif.onrender.com", fetchImpl });
  const res = await slowMovingTool.run(args, { client, now: () => FIXED_NOW });
  slowMovingTool.config.outputSchema.parse(res.structuredContent);
  return res.structuredContent as Env;
}

test("slow moving: caminho feliz, soma das linhas, top N por capital, sem parametros no GET", async () => {
  const calls: URL[] = [];
  const env = await run(RESP, { limite: 2 }, calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, "/api/v1/performance/full-slow-moving");
  assert.equal(calls[0].search, "");
  assert.deepEqual(env.data.total, { itens: 3, capital_parado: 4500.46 });
  assert.deepEqual(env.data.por_marca.map((m: any) => [m.marca, m.itens, m.capital_parado, m.capital_estoque_marketplace]),
    [["kokeshi", 2, 3500.46, 80000], ["apice", 1, 1000, 50000]]);
  assert.deepEqual(env.data.itens.map((i: any) => i.sku), ["KO-9", "AP-1"]);
  assert.equal(env.meta.total_count, 3);
  assert.equal(env.meta.returned_count, 2);
  assert.equal(env.meta.truncated, true);
  assert.equal(env.meta.limit, 2);
  assert.equal(env.data.regra.cobertura_minima_dias, 120);
  assert.deepEqual(env.data.itens[1].motivos, ["curva_C"]);
  assert.deepEqual(env.data.itens[0].motivos, ["descontinuado"]);
  // Full ML separado: nao entra no total do Marketplace.
  assert.deepEqual(env.data.full_ml.por_marca, [{ marca: "kokeshi", capital_no_full: 12000, parado_no_full: 2000 }]);
  assert.ok(env.data.limitations.some((l: any) => l.topic === "slow_moving_full_ml_separado"));
});

test("slow moving: sem venda -> cobertura NULA (nao 0); sem estoque/custo -> null; brinde por categoria", async () => {
  const env = await run(RESP, { limite: 25 });
  const ko9 = env.data.itens.find((i: any) => i.sku === "KO-9");
  assert.equal(ko9.cobertura_dias, null);
  assert.equal(ko9.sem_venda_15d, true);
  const ko2 = env.data.itens.find((i: any) => i.sku === "KO-2");
  assert.equal(ko2.estoque_pecas, null);
  assert.equal(ko2.custo_unitario, null);
  assert.deepEqual(ko2.motivos, ["curva_B", "brinde"]);
  assert.ok(env.meta.warnings.some((w: string) => /sem estoque em pecas/.test(w)));
});

test("slow moving: filtro de marca soma so' as linhas da marca; marca sem linha = 0 real (base lida)", async () => {
  const env = await run(RESP, { marcas: ["apice", "lescent"] });
  assert.deepEqual(env.data.total, { itens: 1, capital_parado: 1000 });
  assert.deepEqual(env.data.por_marca.map((m: any) => [m.marca, m.itens, m.capital_parado]), [["apice", 1, 1000], ["lescent", 0, 0]]);
  assert.equal(env.data.full_ml, null, "kokeshi fora do filtro e sem full nas outras marcas");
  assert.ok(env.meta.warnings.some((w: string) => /Full do Mercado Livre nao lido/.test(w)));
  assert.deepEqual(env.meta.filters_applied.marcas, ["apice", "lescent"]);
});

test("slow moving: lista vazia SEM fotografia -> total NULO + aviso (nunca capital zero)", async () => {
  const env = await run({ ...RESP, skus: [], atualizado_em: null, capital_full: {}, parado_full: {} });
  assert.equal(env.data.total, null);
  assert.equal(env.meta.total_count, null);
  assert.deepEqual(env.data.itens, []);
  assert.equal(env.data.fotografia_em, null);
  assert.ok(env.meta.warnings.some((w: string) => /nao afirme que nao ha capital parado/.test(w)));
  const env2 = await run({ ...RESP, skus: [] });
  assert.deepEqual(env2.data.total, { itens: 0, capital_parado: 0 }, "base lida e vazia = zero real");
});

test("slow moving: status diferente de ok -> indisponivel, sem numero", async () => {
  const env = await run({ ...RESP, status: "unavailable" });
  assert.equal(env.data.disponibilidade, "unavailable");
  assert.equal(env.data.total, null);
  assert.deepEqual(env.data.itens, []);
  assert.ok(env.meta.warnings.some((w: string) => /nao trate como capital zero/.test(w)));
});

test("slow moving: 503 do backend -> SOURCE_UNAVAILABLE", async () => {
  const fetchImpl = (async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const client = new TorreClient({ baseUrl: "https://mktplace-api-6wif.onrender.com", fetchImpl });
  await assert.rejects(
    () => slowMovingTool.run({}, { client, now: () => FIXED_NOW }),
    (e: unknown) => e instanceof OracleToolError && e.category === "SOURCE_UNAVAILABLE",
  );
});

test("slow moving: contrato quebrado -> INVALID_UPSTREAM_RESPONSE", async () => {
  for (const bad of [
    { ...RESP, skus: [{ ...RESP.skus[0], valor_parado: "mil" }] },
    { ...RESP, skus: [{ ...RESP.skus[0], sku: undefined }] },
    { ...RESP, meta_dias: undefined },
    { ...RESP, capital_full: { kokeshi: "x" } },
  ]) {
    await assert.rejects(
      () => run(bad),
      (e: unknown) => e instanceof OracleToolError && e.category === "INVALID_UPSTREAM_RESPONSE",
    );
  }
});

test("slow moving: entrada invalida (.strict, limite, marca, duplicata) falha antes do GET", async () => {
  const calls: URL[] = [];
  for (const bad of [{ limite: 0 }, { limite: 26 }, { limite: 1.5 }, { marcas: ["gocase"] }, { marcas: ["apice", "apice"] }, { marcas: [] }, { busca: "x" }, { sku: "AP-1" }]) {
    await assert.rejects(() => run(RESP, bad, calls));
  }
  assert.equal(calls.length, 0);
});

test("slow moving: sem serie diaria, receita nem campo pessoal na saida; textos saneados", async () => {
  const env = await run({ ...RESP, skus: [sku({ descricao: "  Creme\u0000\n  corporal ".padEnd(400, "x") })] });
  const s = JSON.stringify(env);
  for (const proibido of ["serie", "receita_15d", "ML-F", "cliente", "comprador", "endereco"]) {
    assert.ok(!s.includes(proibido), `saida nao pode conter ${proibido}`);
  }
  const prod = env.data.itens[0].produto as string;
  assert.ok(prod.length <= 120 && !/[\u0000\n]/.test(prod));
});

test("slow moving: o limite padrao e' 10 e nunca passa de 25 itens", async () => {
  const muitos = Array.from({ length: 40 }, (_, i) => sku({ sku: `S-${i}`, valor_parado: 100 + i }));
  const env = await run({ ...RESP, skus: muitos });
  assert.equal(env.data.itens.length, 10);
  assert.equal(env.meta.total_count, 40);
  assert.equal(env.data.itens[0].sku, "S-39");
  assert.equal((await run({ ...RESP, skus: muitos }, { limite: 25 })).data.itens.length, 25);
});
