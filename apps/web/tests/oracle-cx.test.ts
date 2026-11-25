// torre_cx (MCP-AMPLIADO) — atendimento/CX dos marketplaces. Nada aqui toca rede.
// Grupos: caminho feliz (Pareto top 10, totais), ausencia x zero, TikTok
// `carregando`, falha de um canal sem derrubar os outros, contrato quebrado,
// entrada estrita e ausencia de dado pessoal.
import { test } from "node:test";
import assert from "node:assert/strict";

import { OracleToolError } from "../src/server/oracle/errors.ts";
import { TorreClient } from "../src/server/oracle/torre-client.ts";
import { CX_PARETO_TOP, cxTool } from "../src/server/oracle/tools-cx.ts";
import { FIXED_NOW } from "./oracle-fixtures.ts";

const JANELA = { inicio: "2026-07-19", fim: "2026-08-17", dias: 30 };
const COBERTURA = { marcas: ["kokeshi", "barbours"], fora: [{ marca: "apice", motivo: "Sem conta Mercado Livre integrada." }] };

/** Campos que a fonte NUNCA deveria mandar para esta tool — a fixture manda assim mesmo. */
const PESSOAL = { pedido: "PED-SECRETO-1", comprador: "Maria Silva", comentario: "texto livre do cliente", order_ref: "REF-9" };

const motivo = (i: number, q: number) => ({
  codigo: `m${i}`, rotulo: `Motivo ${i}`, natureza: "comprador", quantidade: q, pct: q, mapeado: true,
});

function mlRow(marca: string, extra: Record<string, unknown> = {}) {
  return {
    marca, pedidos: 1000, reclamacoes: 20, cancelamentos: 10, reembolsos: 5, valor_reembolsado: 1500.5,
    mediacoes: 2, devolucoes: 7, perguntas: 30, perguntas_respondidas: 28, aguardando_nos: 3, vencidas: 1,
    vencem_24h: 0, prazo_mais_antigo: "2026-08-17T10:00:00Z", perguntas_sem_resposta: 2,
    perguntas_sem_resposta_24h: 0, pergunta_mais_antiga: null, tempo_resposta_min: 12.5,
    mensagens_pendentes: 0, conta_dia: "2026-08-17", resposta_mediana_h: 4, reclamacoes_com_historico: 18,
    reclamacoes_respondidas: 17, pedidos_anterior: 900, ...PESSOAL, ...extra,
  };
}

const ML = {
  gerado_em: "2026-08-18T11:00:00Z",
  janela: JANELA,
  cobertura: COBERTURA,
  diario_estado: "dado",
  reclamacoes_estado: "dado",
  motivo_indisponivel: null,
  marcas: [mlRow("kokeshi"), mlRow("barbours", { perguntas: null, perguntas_respondidas: null, devolucoes: 0 })],
  reclamacoes_motivos: {
    titulo: "Reclamacoes", estado: "dado", total: 60, ajuda: "x",
    itens: Array.from({ length: 12 }, (_, i) => motivo(i, 12 - i)), // 12 motivos > top 10
  },
  cancelamentos_motivos: {
    titulo: "Cancelamentos", estado: "vazio_legitimo", total: null, itens: [], ajuda: "x",
    motivo_indisponivel: "Nenhum cancelamento no recorte.",
  },
  atualizado_em: "2026-08-18T10:30:00Z",
  aviso_frescor: null,
  coleta_desde: "2026-06-01",
  pendencias: [],
};

const SHOPEE = {
  gerado_em: "2026-08-18T11:00:00Z",
  janela: JANELA,
  chat: {
    estado: "dado", motivo: null, fonte: "Shopee",
    contas: [{
      marca: "apice", dia: "2026-08-17", capturado_em: "2026-08-17T20:00:00Z", nivel: "Excelente",
      metricas: [
        { codigo: "shopee_11", rotulo: "Taxa de resposta do chat", valor: 82.65, unidade: "pct", anterior: 80, meta: 60, comparador: ">=", situacao: "ok" },
        { codigo: "shopee_22", rotulo: "Nota da loja", valor: 4.93, unidade: "nota", anterior: null, meta: 4.5, comparador: ">=", situacao: "ok" },
      ],
      avisos: ["foto de ontem"], destaques: [{ rotulo: "x", valor: "y", tom: "bom" }], ...PESSOAL,
    }],
    sem_foto: [{ marca: "lescent", motivo: "Sem fotografia capturada ainda." }],
    nao_lidas_estado: "dado",
    nao_lidas: [{
      marca: "apice", valor: 4, capturado_em: "2026-08-18T10:00:00Z", conversas_7d: 50, conversas_30d: 200,
      aguardando_resposta: 3, conversas_truncado: true, aguardando_ate_1h: 1, aguardando_1a4h: 1,
      aguardando_4a24h: 0, aguardando_mais_24h: 1, espera_max_s: 90000, tempo_resposta_s: 600,
      tempo_resposta_p90_s: 3000, respostas: 120, respostas_ate_1h_pct: 77.5, respostas_mais_1d: 2,
      respostas_desde: "2026-07-01T00:00:00Z", tempo_resposta_fonte: "mediana",
    }],
  },
  atendimento: {
    canal: "shopee", cobertura: { marcas: ["apice"], fora: [] },
    indicadores: [
      { codigo: "taxa_cancelamento", rotulo: "Taxa de cancelamento", tipo: "torre", estado: "dado", valor: 3.2, unidade: "pct", fonte: "x", ajuda: "x" },
      { codigo: "contact_rate", rotulo: "Contact rate", tipo: "torre", estado: "sem_fonte", valor: null, unidade: "pct", fonte: "—", ajuda: "x", motivo_indisponivel: "So' em 7 e 30 dias." },
    ],
    motivos: {
      titulo: "Cancelamentos", estado: "dado", total: 100, ajuda: "x", excluidos: 40, rotulo_excluidos: "Pedido nao pago",
      itens: [motivo(1, 70), motivo(2, 30)],
    },
    marcas: [{ marca: "apice", pedidos: 5000, taxa_cancelamento_pct: 3.2, cancelamentos: 160, cancelamentos_comprador: 90, em_devolucao: 12 }],
    pendencias: [], atualizado_em: "2026-08-18T10:00:00Z",
  },
  devolucoes: {
    estado: "vazio_legitimo", fonte: "x", motivo_indisponivel: null, total: null, marcas: [], motivos: null,
  },
};

const TIKTOK = {
  gerado_em: "2026-08-18T11:30:00Z",
  dias: 30, inicio: "2026-07-19", fim: "2026-08-17",
  marcas: [
    { marca: "kokeshi", estado: "dado", motivo: null, dias_faltando: 0, truncado: false, devolucoes: 8, reembolsado: 400.25, cancelamentos: 12, nao_pagos: 3, cancelamentos_comprador: 9, pedidos: 900 },
    { marca: "barbours", estado: "sem_permissao", motivo: "O app da Torre nao tem permissao." },
  ],
  motivos: [
    { tipo: "Cancelamento", motivo: "Mudou de ideia\u0000", quantidade: 9, autor: "Comprador", marcas: [{ marca: "kokeshi", quantidade: 9 }],
      skus: [{ marca: "kokeshi", sku: "SKU-1", produto: "Produto X", quantidade: 4 }] },
    { tipo: "Devolução", motivo: "Produto danificado", quantidade: 5, autor: null, marcas: [{ marca: "kokeshi", quantidade: 5 }], skus: [] },
  ],
};

const ROTAS: Record<string, unknown> = {
  "/api/v1/cx/mercadolivre": ML,
  "/api/v1/cx/shopee": SHOPEE,
  "/api/v1/cx/tiktok": TIKTOK,
};

type Handler = (u: URL) => Response;
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

function deps(rotas: Record<string, unknown | Handler>, calls: URL[] = []) {
  const client = new TorreClient({
    baseUrl: "https://mktplace-api-6wif.onrender.com",
    fetchImpl: (async (input: RequestInfo | URL) => {
      const u = new URL(typeof input === "string" ? input : input.toString());
      calls.push(u);
      const r = rotas[u.pathname];
      if (r === undefined) return json({ detail: "nf" }, 404);
      return typeof r === "function" ? (r as Handler)(u) : json(r);
    }) as unknown as typeof fetch,
  });
  return { client, now: () => FIXED_NOW };
}

async function run(args: Record<string, unknown> = {}, rotas: Record<string, unknown | Handler> = ROTAS, calls: URL[] = []) {
  const res = await cxTool.run(args, deps(rotas, calls));
  cxTool.config.outputSchema.parse(res.structuredContent); // a saida TEM de passar no schema declarado
  return res.structuredContent as { meta: Record<string, any>; data: any };
}

test("cx: caminho feliz — 3 chamadas, brands/dias na query, Pareto top 10 com truncated, totais por soma", async () => {
  const calls: URL[] = [];
  const env = await run({ marcas: ["kokeshi", "barbours"], dias: 30 }, ROTAS, calls);
  assert.deepEqual(calls.map((u) => u.pathname).sort(), ["/api/v1/cx/mercadolivre", "/api/v1/cx/shopee", "/api/v1/cx/tiktok"]);
  for (const u of calls) {
    assert.deepEqual(u.searchParams.getAll("brands"), ["barbours", "kokeshi"]);
    assert.equal(u.searchParams.get("dias"), "30");
  }
  const { ml, shopee, tiktok } = env.data;
  assert.equal(ml.estado, "disponivel");
  assert.equal(ml.pareto.reclamacao.itens.length, CX_PARETO_TOP);
  assert.equal(ml.pareto.reclamacao.truncated, true);
  assert.equal(ml.pareto.reclamacao.total_motivos, 12);
  assert.equal(ml.pareto.reclamacao.total, 60);
  assert.deepEqual(ml.pareto.reclamacao.itens[0], { rotulo: "Motivo 0", natureza: "comprador", quantidade: 12, pct: 12, por_marca: [] });
  assert.equal(ml.totais.reclamacoes, 40);
  assert.equal(ml.totais.pedidos, 2000);
  assert.deepEqual(ml.marcas_sem_cobertura, [{ marca: "apice", motivo: "Sem conta Mercado Livre integrada." }]);
  assert.equal(ml.pareto.devolucao.estado, "sem_fonte");
  // Shopee: taxa de resposta e nota vem da Saude da Conta, com a meta da Shopee.
  const m = shopee.chat.contas[0].metricas;
  assert.equal(m.find((x: any) => x.codigo === "shopee_11").valor, 82.65);
  assert.equal(m.find((x: any) => x.codigo === "shopee_22").valor, 4.93);
  assert.equal(shopee.pareto.cancelamento.excluidos.quantidade, 40);
  assert.equal(shopee.pareto.reclamacao.estado, "sem_fonte");
  assert.equal(shopee.cancelamentos.marcas[0].taxa_cancelamento_pct, 3.2);
  // TikTok: Pareto por tipo; a API nao manda pct (null) nem total (soma dos motivos).
  assert.equal(tiktok.pareto.cancelamento.total, 9);
  assert.equal(tiktok.pareto.cancelamento.itens[0].pct, null);
  assert.equal(tiktok.pareto.cancelamento.itens[0].rotulo, "Mudou de ideia"); // controle removido
  assert.equal(tiktok.pareto.devolucao.itens[0].rotulo, "Produto danificado");
  assert.equal(env.meta.period.start, "2026-07-19");
  assert.equal(env.meta.returned_count, 3);
  assert.equal(env.meta.filters_applied.dias, 30);
  assert.ok(env.meta.warnings.some((w: string) => /Pareto mostra so'/.test(w)));
});

test("cx: ausencia nunca vira zero — null na soma, nao pago fora, vazio legitimo = total 0 com observacao", async () => {
  const env = await run({});
  const { ml, shopee, tiktok } = env.data;
  // barbours sem perguntas: a soma NAO e' parcial.
  assert.equal(ml.marcas[1].perguntas, null);
  assert.equal(ml.totais.perguntas, null);
  assert.equal(ml.marcas[1].devolucoes, 0); // zero verdadeiro continua zero
  assert.equal(ml.totais.devolucoes, 7);
  // vazio legitimo da fonte.
  assert.equal(ml.pareto.cancelamento.estado, "disponivel");
  assert.equal(ml.pareto.cancelamento.total, 0);
  assert.match(ml.pareto.cancelamento.observacao, /Nenhum cancelamento/);
  assert.equal(shopee.devolucoes.estado, "disponivel");
  assert.equal(shopee.devolucoes.aceitas, null);
  assert.equal(shopee.pareto.devolucao.estado, "sem_fonte");
  // contact_rate sem fonte: estado explicito, valor null.
  const cr = shopee.cancelamentos.indicadores.find((i: any) => i.codigo === "contact_rate");
  assert.deepEqual([cr.estado, cr.valor], ["sem_fonte", null]);
  assert.match(cr.motivo_indisponivel, /7 e 30/);
  // TikTok: marca sem permissao e' sem_fonte com numeros nulos; totais nulos (marca sem leitura).
  const bar = tiktok.marcas.find((x: any) => x.marca === "barbours");
  assert.deepEqual([bar.estado, bar.devolucoes, bar.cancelamentos], ["sem_fonte", null, null]);
  assert.equal(tiktok.totais, null);
  assert.ok(env.meta.warnings.some((w: string) => /barbours.*ausencia/.test(w)));
  assert.ok(env.meta.warnings.some((w: string) => /PISO/.test(w))); // conversas_truncado
  assert.ok(env.meta.warnings.some((w: string) => /lescent/.test(w))); // sem foto
});

test("cx: TikTok carregando = dado ausente, sem numero, sem retry; os outros canais seguem", async () => {
  const calls: URL[] = [];
  const carregando = { carregando: true, dias: 30, marcas: [], motivos: [] };
  const env = await run({}, { ...ROTAS, "/api/v1/cx/tiktok": carregando }, calls);
  assert.equal(calls.filter((u) => u.pathname === "/api/v1/cx/tiktok").length, 1);
  const tk = env.data.tiktok;
  assert.equal(tk.estado, "indisponivel");
  assert.match(tk.motivo_indisponivel, /carregando/);
  assert.deepEqual([tk.totais, tk.marcas.length, tk.pareto.cancelamento.total], [null, 0, null]);
  assert.equal(env.data.ml.estado, "disponivel");
  assert.ok(env.meta.warnings.some((w: string) => /TikTok Shop: indisponivel.*nao trate como zero/.test(w)));
});

test("cx: TikTok com leitura parcial (truncado) avisa PISO; marca pedida sem conta vira marcas_sem_conta", async () => {
  const parcial = { ...TIKTOK, marcas: [{ ...TIKTOK.marcas[0], truncado: true, dias_faltando: 2 }] };
  const env = await run({ canais: ["tiktok"], marcas: ["kokeshi", "lescent"] }, { ...ROTAS, "/api/v1/cx/tiktok": parcial });
  assert.equal(env.data.ml, null);
  assert.equal(env.data.tiktok.marcas[0].parcial, true);
  assert.deepEqual(env.data.tiktok.marcas_sem_conta, ["lescent"]);
  assert.ok(env.meta.warnings.some((w: string) => /leitura incompleta.*PISO/.test(w)));
});

test("cx: so' chama o canal pedido; dias=0 manda 0 e avisa dia corrente", async () => {
  const calls: URL[] = [];
  const env = await run({ canais: ["ml"], dias: 0 }, ROTAS, calls);
  assert.deepEqual(calls.map((u) => u.pathname), ["/api/v1/cx/mercadolivre"]);
  assert.equal(calls[0].searchParams.get("dias"), "0");
  assert.equal(calls[0].searchParams.has("brands"), false);
  assert.equal(env.data.shopee, null);
  assert.ok(env.meta.warnings.some((w: string) => /dia corrente/.test(w)));
});

test("cx: falha de UM canal nao derruba os outros; todos falhando = erro da tool", async () => {
  const env = await run({}, { ...ROTAS, "/api/v1/cx/shopee": () => json({ detail: "boom" }, 503) });
  assert.equal(env.data.shopee.estado, "indisponivel");
  assert.equal(env.data.shopee.motivo_indisponivel, "SOURCE_UNAVAILABLE");
  assert.equal(env.data.shopee.chat, null);
  assert.equal(env.data.ml.estado, "disponivel");
  assert.equal(env.data.tiktok.estado, "disponivel");
  assert.ok(env.meta.warnings.some((w: string) => /Shopee: indisponivel/.test(w)));

  const todos = () => json({ detail: "boom" }, 503);
  await assert.rejects(
    () => cxTool.run({}, deps({ "/api/v1/cx/mercadolivre": todos, "/api/v1/cx/shopee": todos, "/api/v1/cx/tiktok": todos })),
    (e: unknown) => e instanceof OracleToolError && e.category === "SOURCE_UNAVAILABLE",
  );
});

test("cx: ML com as duas fontes em erro e marca sem conta", async () => {
  const quebrado = { ...ML, diario_estado: "erro", reclamacoes_estado: "erro", motivo_indisponivel: "Falha na leitura.", marcas: [mlRow("kokeshi", { pedidos: null, reclamacoes: null })], reclamacoes_motivos: null, cancelamentos_motivos: null };
  const env = await run({ canais: ["ml"] }, { ...ROTAS, "/api/v1/cx/mercadolivre": quebrado });
  assert.equal(env.data.ml.estado, "indisponivel");
  assert.equal(env.data.ml.motivo_indisponivel, "Falha na leitura.");
  assert.equal(env.data.ml.pareto.reclamacao.estado, "indisponivel");
  assert.equal(env.data.ml.totais.reclamacoes, null);

  const semConta = { ...ML, cobertura: { marcas: [], fora: [{ marca: "apice", motivo: "Sem conta Mercado Livre integrada." }] }, marcas: [] };
  const e2 = await run({ canais: ["ml"], marcas: ["apice"] }, { ...ROTAS, "/api/v1/cx/mercadolivre": semConta });
  assert.equal(e2.data.ml.estado, "sem_fonte");
  assert.match(e2.data.ml.motivo_indisponivel, /apice/);
  assert.equal(e2.data.ml.totais, null);
});

test("cx: contrato quebrado vira INVALID_UPSTREAM_RESPONSE (um canal so')", async () => {
  const casos: Array<[string, string, unknown]> = [
    ["ml", "/api/v1/cx/mercadolivre", { ...ML, marcas: undefined }],
    ["ml", "/api/v1/cx/mercadolivre", { ...ML, diario_estado: "talvez" }],
    ["shopee", "/api/v1/cx/shopee", { ...SHOPEE, chat: { ...SHOPEE.chat, estado: "novo_estado" } }],
    ["shopee", "/api/v1/cx/shopee", { ...SHOPEE, devolucoes: undefined }],
    ["tiktok", "/api/v1/cx/tiktok", { ...TIKTOK, marcas: [{ marca: "kokeshi", estado: "inventado" }] }],
    ["tiktok", "/api/v1/cx/tiktok", { ...TIKTOK, motivos: [{ tipo: "Outro", motivo: "x", quantidade: 1, marcas: [] }] }],
  ];
  for (const [canal, path, payload] of casos) {
    await assert.rejects(
      () => cxTool.run({ canais: [canal] }, deps({ ...ROTAS, [path]: payload })),
      (e: unknown) => e instanceof OracleToolError && e.category === "INVALID_UPSTREAM_RESPONSE",
      `${canal} ${JSON.stringify(payload).slice(0, 60)}`,
    );
  }
  // Com mais de um canal, o quebrado vira bloco indisponivel com a classe do erro.
  const env = await run({}, { ...ROTAS, "/api/v1/cx/mercadolivre": { ...ML, marcas: undefined } });
  assert.equal(env.data.ml.estado, "indisponivel");
  assert.equal(env.data.ml.motivo_indisponivel, "INVALID_UPSTREAM_RESPONSE");
  assert.equal(env.data.shopee.estado, "disponivel");
});

test("cx: entrada estrita — recusa antes de qualquer chamada", async () => {
  const invalidos: Array<Record<string, unknown>> = [
    { brand: "kokeshi" }, // typo de `marcas`
    { dias: 15 },
    { dias: "30" },
    { marcas: ["inexistente"] },
    { marcas: [] },
    { canais: ["amazon"] },
    { canais: ["ml", "ml"] },
    { pedido: "PED-1" },
    { motivo: "x" },
  ];
  for (const args of invalidos) {
    const calls: URL[] = [];
    await assert.rejects(() => cxTool.run(args, deps(ROTAS, calls)), `deveria recusar ${JSON.stringify(args)}`);
    assert.equal(calls.length, 0);
  }
  assert.deepEqual(cxTool.config.inputSchema!.parse({}), { dias: 30 });
});

test("cx: nenhum dado pessoal na saida (pedido, comprador, texto, SKU/produto do TikTok)", async () => {
  const res = await cxTool.run({}, deps(ROTAS));
  const txt = JSON.stringify(res);
  for (const proibido of ["PED-SECRETO-1", "Maria Silva", "texto livre do cliente", "REF-9", "SKU-1", "Produto X"]) {
    assert.equal(txt.includes(proibido), false, `vazou: ${proibido}`);
  }
  const chaves = new Set<string>();
  (function varrer(v: unknown) {
    if (Array.isArray(v)) v.forEach(varrer);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { chaves.add(k); varrer(x); }
  })(res.structuredContent);
  for (const c of ["pedido", "order_ref", "comprador", "comentario", "skus", "produto", "sku", "destaques"]) {
    assert.equal(chaves.has(c), false, `chave pessoal na saida: ${c}`);
  }
});

test("cx: description diz o que responde e o que NAO cobre; so' parametros allowlisted", () => {
  const d = cxTool.config.description;
  for (const t of ["taxa de resposta", "nota", "por que cancelam", "quantas reclamacoes", "site/DTC", "pedido individual", "NAO"]) {
    assert.ok(d.includes(t), `description sem '${t}'`);
  }
  assert.equal(cxTool.name, "torre_cx");
});
