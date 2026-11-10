import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

import { canalComMenores, gmvComMenores, menoresNaGerencial, notaMenores } from "../src/lib/gerencial/marcas-menores-gerencial.ts";

const marca = (id: string, label: string, por: Record<string, number>, ant?: Record<string, number>, status = "ok") => ({
  id, label, status,
  total: Object.keys(por).length ? Object.values(por).reduce((a, v) => a + v, 0) : null,
  total_anterior: ant ? Object.values(ant).reduce((a, v) => a + v, 0) : null,
  por_plataforma_anterior: ant ?? {},
  por_plataforma: Object.entries(por).map(([plataforma, faturamento]) => ({ plataforma, faturamento })),
  serie: [],
});
const resp = (marcas: ReturnType<typeof marca>[]) => ({ disponivel: true, marcas }) as never;
const TODOS = ["ml", "shopee", "tiktok"] as const;

const D = resp([
  marca("yenzah", "Yenzah", { SHOPEE: 100, TIKTOK: 50 }, { SHOPEE: 80, TIKTOK: 40 }),
  marca("aua", "Auá", { SHOPEE: 30 }, { SHOPEE: 30 }),
  marca("by-samia", "By Samia", {}, undefined),
  marca("denavita", "Denavita", {}, undefined, "aguardando_autorizacao"),
]);

function ok(d: never, canais: readonly ("ml" | "shopee" | "tiktok")[] = TODOS) {
  const m = menoresNaGerencial(d, canais, true);
  if (m.estado !== "ok") throw new Error("esperava ok");
  return m;
}

test("soma das menores por canal; sem pedido nao entra; Denavita aguarda (nunca 0)", () => {
  const m = ok(D);
  assert.equal(m.total, 180);
  assert.deepEqual(m.porCanal, { shopee: 130, tiktok: 50 });
  assert.deepEqual(m.marcas.map((x) => x.brand), ["yenzah", "aua"]);
  assert.deepEqual(m.aguardando, ["Denavita"]);
});

test("filtro de canal: so' Shopee soma so' Shopee; so' ML nao soma nada", () => {
  assert.equal(ok(D, ["shopee"]).total, 130);
  assert.equal(ok(D, ["ml"]).total, 0);
});

test("filtros que escondem (marca grande, demo): fora; carregando e Bling fora", () => {
  assert.equal(menoresNaGerencial(D, TODOS, false).estado, "fora");
  assert.equal(menoresNaGerencial(undefined, TODOS, true).estado, "carregando");
  assert.equal(menoresNaGerencial(null, TODOS, true).estado, "indisponivel");
  assert.equal(menoresNaGerencial({ disponivel: false, marcas: [] } as never, TODOS, true).estado, "indisponivel");
});

test("GMV do topo: total com e sem menores; variacao so' com base nos dois periodos", () => {
  const m = ok(D);
  const base = { gmv: 1000, prevGmv: 900, momPct: (100 / 900) * 100 };
  const com = gmvComMenores(base, m, true);
  assert.equal(com.gmv, 1180);
  assert.equal(com.prevGmv, 900 + 150); // anterior das menores: 80 + 40 + 30
  assert.ok(Math.abs(com.momPct! - ((1180 - 1050) / 1050) * 100) < 1e-9);
  assert.equal(com.variacaoInclui, true);
  assert.deepEqual(gmvComMenores(base, null, true), { ...base, variacaoInclui: false });
});

test("sem base das menores (ou Hoje): variacao fica sem elas e 'antes R$' some", () => {
  const semBase = ok(resp([marca("yenzah", "Yenzah", { SHOPEE: 100 })]));
  const r = gmvComMenores({ gmv: 1000, prevGmv: 900, momPct: 11.1 }, semBase, true);
  assert.deepEqual([r.gmv, r.prevGmv, r.momPct, r.variacaoInclui], [1100, null, 11.1, false]);
  const hoje = gmvComMenores({ gmv: 500, prevGmv: null, momPct: 5 }, ok(D), false);
  assert.deepEqual([hoje.gmv, hoje.momPct, hoje.variacaoInclui], [680, 5, false]);
});

test("marca sem base derruba a base de todas (conjunto igual nos dois lados)", () => {
  const m = ok(resp([marca("yenzah", "Yenzah", { SHOPEE: 100 }, { SHOPEE: 80 }), marca("aua", "Auá", { SHOPEE: 30 })]));
  assert.equal(m.anterior, null);
});

test("canal: rosca soma as menores no canal delas; variacao do canal com base propria", () => {
  const m = ok(D);
  const sh = canalComMenores("shopee", 400, 300, 33, m, true);
  assert.equal(sh.gmv, 530);
  assert.ok(Math.abs(sh.variacao! - ((530 - 410) / 410) * 100) < 1e-9); // anterior Shopee das menores: 80 + 30
  assert.deepEqual(canalComMenores("ml", 700, 600, 16, m, true), { gmv: 700, variacao: 16 }); // ML intacto
  assert.deepEqual(canalComMenores("tiktok", 100, null, 7, m, false), { gmv: 150, variacao: 7 });
});

test("nota do (i): inclui valor e variacao; indisponivel diz que o GMV nao as inclui; sem menores, nada", () => {
  const m = menoresNaGerencial(D, TODOS, true);
  const fmt = (v: number) => `R$ ${v}`;
  assert.match(notaMenores(m, true, false, fmt)!, /Yenzah, Auá.*R\$ 180.*Sem meta.*Denavita: aguardando.*variação as inclui/);
  assert.match(notaMenores(m, false, true, fmt)!, /hoje não as inclui/);
  assert.match(notaMenores({ estado: "indisponivel" }, false, false, fmt)!, /indisponíveis.*não as inclui/);
  assert.equal(notaMenores({ estado: "fora" }, false, false, fmt), null);
});

test("pagina: variacaoDoCanal e' declarada antes de quem a usa (const arrow: acesso antes disso quebra a tela inteira)", () => {
  const pagina = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.ok(pagina.indexOf("const variacaoDoCanal") < pagina.indexOf("const canalMenores"));
});
