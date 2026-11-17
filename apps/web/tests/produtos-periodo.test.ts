// Periodo da aba Produtos: atalhos, mes e intervalo livre (um componente so' para ML, TikTok e Shopee).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ATALHOS_PRODUTOS, chavePeriodo, mesDoPeriodo, mesShopee, periodoDoAtalho, periodoDoMesProdutos, rotuloPeriodo,
} from "../src/lib/produtos-periodo.ts";
import { lastNMonths } from "../src/lib/produtos-tab-transition.ts";

const HOJE = new Date(2026, 10, 16); // segunda-feira
const MESES = lastNMonths(7, HOJE);

test("atalhos: textos pedidos e janelas fechadas (D-1)", () => {
  assert.deepEqual(ATALHOS_PRODUTOS.map((a) => a.texto),
    ["Este mês", "Mês passado", "Esta semana", "Semana passada", "Últimos 7 dias", "Últimos 30 dias"]);
  const r = (a: Parameters<typeof periodoDoAtalho>[0]) => { const p = periodoDoAtalho(a, HOJE); return `${p.inicio}..${p.fim}`; };
  assert.equal(r("mes_atual"), "2026-11-01..2026-11-15");
  assert.equal(r("mes_anterior"), "2026-10-01..2026-10-31");
  assert.equal(r("semana_passada"), "2026-11-09..2026-11-15");
  assert.equal(r("7d"), "2026-11-09..2026-11-15");
  assert.equal(r("30d"), "2026-10-17..2026-11-15");
});

test("mes da lista: atual e anterior viram atalho; os outros, o mes inteiro", () => {
  assert.equal(periodoDoMesProdutos("2026-11", HOJE).atalho, "mes_atual");
  assert.equal(periodoDoMesProdutos("2026-10", HOJE).atalho, "mes_anterior");
  assert.deepEqual(periodoDoMesProdutos("2026-02", HOJE), { inicio: "2026-02-01", fim: "2026-02-28", atalho: null });
});

test("Shopee (mart mensal) e chave de requisicao", () => {
  const sete = periodoDoAtalho("7d", HOJE);
  assert.equal(mesDoPeriodo(sete), null);
  assert.equal(mesShopee(sete), "2026-11");
  assert.equal(mesShopee({ inicio: "2026-09-20", fim: "2026-10-05", atalho: null }), "2026-10");
  assert.equal(mesShopee(periodoDoMesProdutos("2026-09", HOJE)), "2026-09");
  assert.equal(chavePeriodo(sete), "2026-11-09..2026-11-15");
});

test("rotulo do escopo", () => {
  assert.equal(rotuloPeriodo(periodoDoAtalho("7d", HOJE), MESES), "Últimos 7 dias · 09–15/11");
  assert.equal(rotuloPeriodo(periodoDoMesProdutos("2026-09", HOJE), MESES), "Set/26");
  assert.equal(rotuloPeriodo({ inicio: "2026-10-01", fim: "2026-11-15", atalho: null }, MESES), "01/10–15/11");
});

test("um componente de periodo para as tres abas; ML e TikTok mandam o intervalo", () => {
  const page = readFileSync(new URL("../app/produtos/page.tsx", import.meta.url), "utf8");
  assert.equal(page.match(/<PeriodoProdutosFiltro /g)?.length, 1);
  assert.ok(page.includes('soMes={tab === "shopee"}'));
  const api = readFileSync(new URL("../src/lib/api-client.ts", import.meta.url), "utf8");
  assert.ok(api.includes('qs.set("data_inicio", inicio)') && api.includes('qs.set("data_fim", fim)'));
});
