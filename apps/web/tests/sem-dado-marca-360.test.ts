// T-0111 (A1-13) — Marca 360: a API devolve `data: []` para Apice x ML e o zero
// nascia NO FRONT (`summarize` somava a lista vazia). Agora GMV, Pedidos e
// Ticket sao "—" (null), com "Sem dado no recorte"; o texto do Ads segue o
// canal selecionado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { summarize } from "../src/lib/brand-daily-summary.ts";
import { cartoesSituacao } from "../src/lib/brand/situacao-cartoes.ts";
import type { DailyRow } from "../src/lib/mock-daily.ts";

const fonte = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

function dia(over: Partial<DailyRow>): DailyRow {
  return {
    date: "2026-10-01", tiktok_gmv: null, ml_gmv: null, shopee_gmv: null,
    total_gmv: 0, orders: 0, avg_ticket: null, ad_spend: null, ...over,
  };
}

test("T-0111 lista vazia (Apice x ML, out/26): GMV, pedidos, ticket e ads ausentes, nunca 0", () => {
  const s = summarize([], ["ml"]);
  assert.equal(s.gmv, null);
  assert.equal(s.orders, null);
  assert.equal(s.avgTicket, null);
  assert.equal(s.adSpend, null);
});

test("T-0111 canal selecionado sem linha em nenhum dia (ml_gmv null na serie 'all'): ausente", () => {
  const linhas = [dia({ tiktok_gmv: 1000, shopee_gmv: 300, total_gmv: 1300, orders: 10 })];
  const s = summarize(linhas, ["ml"]);
  assert.equal(s.gmv, null);
  assert.equal(s.orders, null);
});

test("T-0111 os cartoes da Situacao mostram '—' (valor null) e sem mini serie de zeros", () => {
  const vazio = summarize([], ["ml"]);
  const [gmv, pedidos, ticket, ads] = cartoesSituacao(vazio, vazio, [], false);
  assert.deepEqual([gmv.valor, pedidos.valor, ticket.valor, ads.valor], [null, null, null, null]);
  const comNulos = [dia({ date: "2026-10-01" }), dia({ date: "2026-10-02" })];
  const s = summarize(comNulos, ["ml"]);
  assert.deepEqual(cartoesSituacao(s, s, comNulos, false)[0].serie, [], "GMV sem dado nao desenha serie de zeros");
});

test("T-0111 zero medido (linha com 0) continua 0", () => {
  const s = summarize([dia({ ml_gmv: 0, total_gmv: 0, orders: 0 })], ["ml"]);
  assert.equal(s.gmv, 0);
  assert.equal(s.orders, 0);
});

test("T-0111 legenda do Ads usa o canal selecionado (nao 'TikTok Shop' com so' o ML)", async () => {
  const { legendaAdsAusente } = await import("../src/lib/brand/situacao-cartoes.ts");
  assert.equal(legendaAdsAusente(["ml"], true), "Sem dado no recorte");
  assert.doesNotMatch(legendaAdsAusente(["ml"], false), /TikTok/);
  assert.equal(legendaAdsAusente(["tiktok"], false), "N/D para TikTok Shop");
});

test("T-0111 pagina: aviso 'Sem dado no recorte' e legenda do Ads pelo canal", () => {
  const page = fonte("app/brand/[brand]/page.tsx");
  assert.match(page, /const semDadoMarca = isLive && cur\.gmv == null;/);
  assert.match(page, /\{semDadoMarca && \(/);
  assert.match(page, /adsAusente=\{legendaAdsAusente\(filter, semDadoMarca\)\}/);
  const comp = fonte("src/components/brand/SituacaoCartoes.tsx");
  assert.match(comp, /ausente \? adsAusente :/);
  assert.match(comp, /valor=\{ausente \? "—"/);
});
