/**
 * VENDAS-POR-HORA-1 — o "Hoje" padronizado da Gerencial
 * (`src/lib/gerencial/hoje-por-hora.ts` e a fiacao nos cards da pagina).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { comparacaoDeHoje, rotuloDoCorte, rotuloDosCortes, variacao } from "../src/lib/gerencial/hoje-por-hora.ts";

test("rotulo do corte: 'até 13h'; sem hora fechada, nada", () => {
  assert.equal(rotuloDoCorte(13), "até 13h");
  assert.equal(rotuloDoCorte(0), null);
  assert.equal(rotuloDoCorte(null), null);
});

test("variacao contra a base; sem base nao inventa 100%", () => {
  assert.equal(variacao(110, 100), 10);
  assert.equal(variacao(90, 100), -10);
  assert.equal(variacao(10, 0), null);
});

const bloco = (gmv: number, pedidos: number) => ({ gmv, pedidos, ticket: pedidos ? gmv / pedidos : null });
const resposta = {
  disponivel: true, dia: "2026-11-06", corte_hora: 14, canais: [], limitacoes: [],
  hoje: bloco(1150, 23), ontem: bloco(1000, 25), semana_passada: bloco(900, 20),
  por_canal: [{ channel: "ml" as const, hoje: bloco(600, 10), ontem: bloco(500, 10), semana_passada: bloco(0, 0) }],
};

test("comparacao de hoje: ontem ate' a mesma hora, nos numeros dos cards", () => {
  const c = comparacaoDeHoje(resposta)!;
  assert.equal(c.rotulo, "vs ontem até 14h");
  assert.equal(c.gmvPct, 15);
  assert.equal(c.pedidosPct, -8);
  assert.equal(Math.round(c.ticketPct! * 10) / 10, 25);
  assert.equal(c.porCanal.ml, 20);
});

test("comparacao de hoje: sem tabela ou sem hora fechada, nada; Kokeshi fora vira aviso no rotulo", () => {
  assert.equal(comparacaoDeHoje(null), null);
  assert.equal(comparacaoDeHoje({ ...resposta, disponivel: false }), null);
  assert.equal(comparacaoDeHoje({ ...resposta, corte_hora: 0 }), null);
  const k = comparacaoDeHoje({ ...resposta, limitacoes: ["Kokeshi na Shopee fica fora do corte por hora: ..."] })!;
  assert.equal(k.rotulo, "vs ontem até 14h (sem Kokeshi Shopee)");
});

test("corte por canal: cada canal na sua hora, curto; mesmo corte junta; sem corte por canal cai no do topo", () => {
  const f = (channel: "tiktok" | "ml" | "shopee", corte_hora?: number) => ({ channel, fonte_ate: null, horas_fechadas_hoje: 0, corte_hora });
  const d = { corte_hora: 8, canais: [f("tiktok", 8), f("ml", 8), f("shopee", 6)] };
  assert.equal(rotuloDosCortes(d), "ML e TikTok até 8h · Shopee até 6h");
  assert.equal(rotuloDosCortes({ ...d, canais: [f("ml", 8), f("shopee", 8)] }), "até 8h");
  assert.equal(rotuloDosCortes({ ...d, canais: [f("ml", 8), f("shopee", 0)] }), "até 8h"); // Shopee sem hora fechada: fora
  assert.equal(rotuloDosCortes({ corte_hora: 14, canais: [f("ml")] }), "até 14h");
  assert.equal(rotuloDosCortes({ corte_hora: 0, canais: [f("ml", 0)] }), null);
  const c = comparacaoDeHoje({ ...resposta, ...d })!;
  assert.equal(c.rotulo, "vs ontem ML e TikTok até 8h · Shopee até 6h");
  assert.match(c.detalhe!, /mais atrasado não segura/);
  assert.equal(comparacaoDeHoje(resposta)!.detalhe, null);
});

const pagina = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const cliente = readFileSync(new URL("../src/lib/api-client.ts", import.meta.url), "utf8");

test("sem card proprio: a pagina usa a comparacao de hoje nos cards de sempre", () => {
  assert.doesNotMatch(pagina, /HojeAteAHora/);
  assert.match(pagina, /comparacaoDeHoje\(/);
});

test("busca /hoje-por-hora sem o cache de 5 min", () => {
  // So' o corpo de fetchHojePorHora: da assinatura ate' o "}" de fechamento na coluna 0. Fatiar ate' o fim do
  // arquivo alcancava o withCache das funcoes que vem depois (fetchMarcasMenores etc.), e `indexOf("\n}\n")`
  // nao acha nada em arquivo CRLF.
  const resto = cliente.slice(cliente.indexOf("export async function fetchHojePorHora")).replace(/\r\n/g, "\n");
  const fn = resto.slice(0, resto.indexOf("\n}\n") + 3);
  assert.ok(fn.length > 50 && fn.length < 800, "o corpo isolado tem o tamanho de uma funcao so'");
  assert.match(fn, /apiFetch<HojePorHora>\(`\/api\/v1\/performance\/hoje-por-hora\?\$\{qs\.toString\(\)\}`\)/);
  assert.doesNotMatch(fn, /withCache/);
});

test("tendencia so' com os canais mostrados: com TikTok fora do valor, TikTok fica fora da conta", async () => {
  const { tendenciaNosCanais } = await import("../src/lib/gerencial/hoje-por-hora.ts");
  const t = (hoje: number, ate: number, dia: number) => ({ hoje, ontem_mesma_hora: ate, ontem_dia: dia, projecao: null });
  const m = {
    brand: "barbours", ...t(160, 100, 340),
    por_canal: [
      { channel: "tiktok" as const, ...t(100, 50, 200) },
      { channel: "ml" as const, ...t(40, 30, 90) },
      { channel: "shopee" as const, ...t(20, 20, 50) },
    ],
  };
  // ML + Shopee: 60 x 140 / 50 = 168, contra 140 de ontem.
  assert.deepEqual(tendenciaNosCanais(m, ["ml", "shopee"]), { projecao: 168, ontemDia: 140 });
  assert.equal(tendenciaNosCanais({ ...m, por_canal: [] }, ["ml"]), null);
  assert.equal(tendenciaNosCanais(m, ["ml", "shopee", "tiktok"])!.ontemDia, 340);
});

import { tendenciaConsolidada } from "../src/lib/gerencial/hoje-por-hora.ts";

const marca = (brand: string, hoje: number, ate: number, dia: number) => ({
  brand, hoje, ontem_mesma_hora: ate, ontem_dia: dia, projecao: null,
  por_canal: [{ channel: "ml" as const, hoje, ontem_mesma_hora: ate, ontem_dia: dia, projecao: null }],
});
const esp = (meta: number) => ({ meta, canais: ["ml" as const] });

test("tendencia consolidada: soma das marcas, % sobre a meta delas", () => {
  const c = tendenciaConsolidada(
    { a: marca("a", 50, 100, 200), b: marca("b", 30, 60, 120) }, // 100 + 60
    { a: esp(200), b: esp(100) },
  )!;
  assert.equal(c.projecao, 160);
  assert.equal(c.meta, 300);
  assert.deepEqual([c.somadas, c.total], [2, 2]);
});

test("tendencia consolidada: marca sem projecao nao vira zero, fica parcial", () => {
  const c = tendenciaConsolidada(
    { a: marca("a", 50, 100, 200), b: marca("b", 30, 0, 0) },
    { a: esp(200), b: esp(100), c: esp(50) }, // b sem ritmo, c sem linha
  )!;
  assert.equal(c.projecao, 100);
  assert.equal(c.meta, 200);
  assert.deepEqual([c.somadas, c.total], [1, 3]);
  assert.equal(tendenciaConsolidada({ b: marca("b", 30, 0, 0) }, { b: esp(100) }), null);
  assert.equal(tendenciaConsolidada(null, { b: esp(100) }), null);
});
