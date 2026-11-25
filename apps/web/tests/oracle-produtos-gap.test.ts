// torre_produtos_gap — fixtures FICTICIAS; a forma espelha `produtos_gap_service.get_produtos_gap` (apps/api).
import { mock, test } from "node:test";
import assert from "node:assert/strict";

import { OracleToolError } from "../src/server/oracle/errors.ts";
import { TorreClient } from "../src/server/oracle/torre-client.ts";
import { produtosGapTool } from "../src/server/oracle/tools-produtos-gap.ts";
import { FIXED_NOW } from "./oracle-fixtures.ts";

const sku = (o: Record<string, unknown>) => ({
  sku: "KS-1", nome: "Kit Facial Kokeshi", receita_hoje: 500, pecas_hoje: 10, receita_comparado: 1500,
  pecas_comparado: 20, diferenca_rs: -1000, diferenca_pct: -66.7, preco_medio_hoje: 50, preco_medio_comparado: 75,
  variacao_preco_pct: -33.3,
  por_canal: [{ canal: "ml", receita_hoje: 500, pecas_hoje: 10, receita_comparado: 1500, pecas_comparado: 20, diferenca_rs: -1000 }],
  estoque: [{ canal: "ml", estado: "medido", full_vendavel: 0, estoque_vendedor_fora_do_full: null, classificacao: "RUPTURA_CANDIDATA" }],
  ...o,
});

const RESP = {
  disponivel: true, marca: "kokeshi", dia: "2026-11-25", dia_comparado: "2026-11-24", comparar: "ontem",
  fonte: "venda por hora por SKU (pedidos e itens do Data Mart), cada canal no seu corte; sem escalonamento por curva",
  metodo: "mesmo_corte_de_hora",
  canais: [
    { canal: "ml", estado: "medido", corte_hora: 15, motivo: null },
    { canal: "shopee", estado: "medido", corte_hora: 14, motivo: null },
    { canal: "tiktok", estado: "sem_dado", corte_hora: null, motivo: "Sem pedidos da marca neste canal nos dois dias." },
  ],
  total: { receita_hoje: 700, receita_comparado: 2000, diferenca_rs: -1300, diferenca_pct: -65 },
  skus_considerados: 3,
  maiores_quedas: [
    sku({}),
    sku({
      sku: "KS-2", nome: "Gota de Colágeno", receita_hoje: 0, pecas_hoje: 0, receita_comparado: 400, pecas_comparado: 4,
      diferenca_rs: -400, diferenca_pct: -100, preco_medio_hoje: null, variacao_preco_pct: null,
      por_canal: [{ canal: "shopee", receita_hoje: 0, pecas_hoje: 0, receita_comparado: 400, pecas_comparado: 4, diferenca_rs: -400 }],
      estoque: [{ canal: "shopee", estado: "medido", full_vendavel: 0, estoque_vendedor_fora_do_full: 36000, classificacao: "RUPTURA_CANDIDATA" }],
    }),
  ],
  maiores_altas: [
    sku({
      sku: "KS-9", nome: "Novo", receita_hoje: 200, pecas_hoje: 2, receita_comparado: 0, pecas_comparado: 0,
      diferenca_rs: 200, diferenca_pct: null, preco_medio_hoje: 100, preco_medio_comparado: null, variacao_preco_pct: null,
      estoque: [{ canal: "ml", estado: "sem_dado", full_vendavel: null, estoque_vendedor_fora_do_full: null, classificacao: null }],
    }),
  ],
  limitacoes: ["Canal sem dado fica fora dos totais e da lista (ausencia, nao venda zero)."],
};

type Env = { meta: Record<string, any>; data: any };

async function run(payload: unknown, args: Record<string, unknown> = { marca: "kokeshi" }, calls: URL[] = []): Promise<Env> {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(new URL(input.toString()));
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const client = new TorreClient({ baseUrl: "https://mktplace-api-6wif.onrender.com", fetchImpl });
  const res = await produtosGapTool.run(args, { client, now: () => FIXED_NOW });
  produtosGapTool.config.outputSchema.parse(res.structuredContent);
  return res.structuredContent as Env;
}

test("produtos_gap: GET com marca/canal/comparar/limite; numeros da API passam intactos, na ordem", async () => {
  const calls: URL[] = [];
  const env = await run(RESP, { marca: "kokeshi", canal: "ml", comparar: "semana_passada", limite: 5 }, calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, "/api/v1/performance/produtos-gap");
  assert.equal(calls[0].searchParams.get("brand"), "kokeshi");
  assert.equal(calls[0].searchParams.get("canal"), "ml");
  assert.equal(calls[0].searchParams.get("comparar"), "semana_passada");
  assert.equal(calls[0].searchParams.get("limite"), "5");
  assert.deepEqual(env.data.maiores_quedas.map((i: any) => i.sku), ["KS-1", "KS-2"], "ordem do maior gap preservada");
  const a = env.data.maiores_quedas[0];
  assert.deepEqual(
    [a.receita_hoje, a.pecas_hoje, a.receita_comparado, a.pecas_comparado, a.diferenca_rs, a.diferenca_pct],
    [500, 10, 1500, 20, -1000, -66.7],
  );
  assert.deepEqual([a.preco_medio_hoje, a.preco_medio_comparado, a.variacao_preco_pct], [50, 75, -33.3]);
  assert.deepEqual(env.data.total, RESP.total, "total vem da API, nao e' somado aqui");
  assert.equal(env.data.fonte, RESP.fonte);
  assert.equal(env.meta.returned_count, 3);
  assert.equal(env.meta.period.start, "2026-11-25");
});

test("produtos_gap: padrao e' ontem, limite 10 e todos os canais (canal nao vai no GET)", async () => {
  const calls: URL[] = [];
  await run(RESP, { marca: "apice" }, calls);
  assert.equal(calls[0].searchParams.get("comparar"), "ontem");
  assert.equal(calls[0].searchParams.get("limite"), "10");
  assert.equal(calls[0].searchParams.has("canal"), false);
});

test("produtos_gap: ausencia continua ausencia (null), estoque do vendedor ao lado do Full", async () => {
  const env = await run(RESP);
  const [, ks2] = env.data.maiores_quedas;
  assert.equal(ks2.preco_medio_hoje, null, "sem peca hoje: sem preco, nao 0");
  assert.equal(ks2.receita_hoje, 0, "zero medido (o canal tem dado) continua 0");
  assert.deepEqual(ks2.estoque[0], {
    canal: "shopee", estado: "medido", full_vendavel: 0, estoque_vendedor_fora_do_full: 36000, classificacao: "RUPTURA_CANDIDATA",
  });
  const nova = env.data.maiores_altas[0];
  assert.equal(nova.diferenca_pct, null);
  assert.equal(nova.preco_medio_comparado, null);
  assert.deepEqual(nova.estoque[0], { canal: "ml", estado: "sem_dado", full_vendavel: null, estoque_vendedor_fora_do_full: null, classificacao: null });
});

test("produtos_gap: canal sem dado e' dito (corte nulo, motivo, aviso), nao vira zero", async () => {
  const env = await run(RESP);
  const tk = env.data.canais.find((c: any) => c.canal === "tiktok");
  assert.deepEqual([tk.estado, tk.corte_hora], ["sem_dado", null]);
  assert.ok(env.meta.warnings.some((w: string) => /tiktok: sem dado/.test(w) && /nao e' venda zero/.test(w)));
  assert.ok(env.data.limitations.some((l: any) => l.topic === "produtos_gap_mesmo_corte"));
});

test("produtos_gap: sem nenhum canal com dado -> sem total e sem lista", async () => {
  const vazio = {
    ...RESP, disponivel: false, total: null, skus_considerados: null, maiores_quedas: [], maiores_altas: [],
    canais: RESP.canais.map((c) => ({ ...c, estado: "sem_dado", corte_hora: null, motivo: "Nenhuma hora de hoje fechada neste canal ainda." })),
  };
  const env = await run(vazio);
  assert.equal(env.data.total, null);
  assert.equal(env.data.skus_considerados, null);
  assert.equal(env.data.disponivel, false);
});

test("produtos_gap: entrada estrita falha antes do GET", async () => {
  const calls: URL[] = [];
  for (const bad of [
    {}, { marca: "gocase" }, { marca: "kokeshi", canal: "site" }, { marca: "kokeshi", comparar: "mes_passado" },
    { marca: "kokeshi", limite: 0 }, { marca: "kokeshi", limite: 51 }, { marca: "kokeshi", limite: 1.5 },
    { marca: "kokeshi", busca: "x" }, { marca: ["kokeshi"] },
  ]) {
    await assert.rejects(() => run(RESP, bad as Record<string, unknown>, calls), `${JSON.stringify(bad)} deveria falhar`);
  }
  assert.equal(calls.length, 0);
});

test("produtos_gap: contrato quebrado vira INVALID_UPSTREAM_RESPONSE", async () => {
  for (const quebrado of [
    { ...RESP, metodo: "escalado_pela_curva" },
    { ...RESP, maiores_quedas: [{ ...RESP.maiores_quedas[0], receita_hoje: "500" }] },
    { ...RESP, canais: [{ canal: "site", estado: "medido" }] },
  ]) {
    await assert.rejects(
      () => run(quebrado),
      (e: unknown) => e instanceof OracleToolError && e.category === "INVALID_UPSTREAM_RESPONSE",
    );
  }
});

test("produtos_gap: o client so' aceita brand/canal/comparar/limite nesta rota", async () => {
  const calls: URL[] = [];
  const fetchImpl = (async (i: RequestInfo | URL) => (calls.push(new URL(i.toString())), new Response("{}"))) as unknown as typeof fetch;
  const client = new TorreClient({ baseUrl: "https://mktplace-api-6wif.onrender.com", fetchImpl });
  for (const p of [{ marca: "kokeshi" }, { brands: "kokeshi" }, { busca: "x" }, { offset: 1 }]) {
    await assert.rejects(() => client.get("produtosGap", p as never), (e: unknown) => e instanceof OracleToolError);
  }
  assert.equal(calls.length, 0);
});

test("produtos_gap: descricao em pt-BR diz o corte, a fonte e o estoque do vendedor; sem dado pessoal", async () => {
  const d = produtosGapTool.config.description ?? "";
  assert.match(d, /MESMO CORTE/);
  assert.match(d, /Data Mart/);
  assert.match(d, /fora do Full/);
  assert.ok(d.length < 2200);
  const out = JSON.stringify((await run(RESP)).data);
  assert.doesNotMatch(out, /buyer|comprador|cpf|nickname/i);
});

test("produtos_gap: timeout maior (20 s) so' nesta rota; as demais seguem em 8 s; timeout fixado vence", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const sinais: Record<string, AbortSignal> = {};
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      sinais[new URL(input.toString()).pathname] = init!.signal!;
      return new Promise(() => {});
    }) as unknown as typeof fetch;
    const client = new TorreClient({ baseUrl: "https://mktplace-api-6wif.onrender.com", fetchImpl });
    const ignora = () => {};
    void client.get("produtosGap", { brand: "kokeshi" }).catch(ignora);
    void client.get("hojePorHora", {}).catch(ignora);
    await Promise.resolve();
    mock.timers.tick(9_000);
    assert.equal(sinais["/api/v1/performance/hoje-por-hora"]?.aborted, true, "padrao: 8 s");
    assert.equal(sinais["/api/v1/performance/produtos-gap"]?.aborted, false, "rota lenta ainda espera");
    mock.timers.tick(11_001);
    assert.equal(sinais["/api/v1/performance/produtos-gap"]?.aborted, true, "mas nao para sempre: 20 s");

    const fixo = new TorreClient({ baseUrl: "https://mktplace-api-6wif.onrender.com", fetchImpl, timeoutMs: 1_000 });
    void fixo.get("produtosGap", { brand: "apice" }).catch(ignora);
    await Promise.resolve();
    const antes = Object.keys(sinais).length;
    mock.timers.tick(1_001);
    assert.ok(antes >= 2);
    assert.equal(sinais["/api/v1/performance/produtos-gap"].aborted, true);
  } finally {
    mock.timers.reset();
  }
});
