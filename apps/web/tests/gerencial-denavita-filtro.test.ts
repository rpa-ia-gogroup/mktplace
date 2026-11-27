/**
 * Denavita no filtro de marca global (T-0119, Bling dela autorizado em #548/#556). Numeros de producao,
 * 01 a 25/11/2026: a Gerencial soma o GMV dela IGUAL a' aba Marcas menores, uma vez so' (o TikTok dela vem da
 * gold do Data Mart e NAO esta' na fato da Torre: o overview "Todas" = as 5 grandes, R$ 28.304.011,01).
 * TikTok dela = fonte provisoria; Shopee sem pedidos = aviso, nunca 0 silencioso.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FILTER_BRAND_KEYS, escopoDeMarcas, semMarcasMenores, urlSemMarcasMenores } from "../src/lib/filters/brands.ts";
import {
  AVISO_SHOPEE_DENAVITA,
  AVISO_TIKTOK_DENAVITA,
  comAvisosMenores,
  filtrarMarcasMenores,
  gmvComMenores,
  menoresNaGerencial,
  notaMenores,
  overviewDeMenores,
} from "../src/lib/gerencial/marcas-menores-gerencial.ts";
import type { MarcasMenores } from "../src/lib/marcas-menores.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const marca = (id: string, label: string, por: Record<string, number>, status = "ok") => ({
  id, label, status,
  total: Object.values(por).reduce((a, v) => a + v, 0),
  total_anterior: null,
  por_plataforma_anterior: {},
  pedidos_por_plataforma: Object.fromEntries(Object.keys(por).map((p) => [p, 10])),
  por_plataforma: Object.entries(por).map(([plataforma, faturamento]) => ({ plataforma, faturamento })),
  serie: [],
});
// /performance/marcas-menores de producao, 01-25/11 (consolidado da aba: R$ 392.123,51)
const PROD = {
  disponivel: true,
  periodo: { inicio: "2026-11-01", fim: "2026-11-25" },
  marcas: [
    marca("denavita", "Denavita", { MELI: 315063.92, TIKTOK: 49572.55 }),
    marca("yenzah", "Yenzah", { SHOPEE: 15557.21, TIKTOK: 5887.63 }),
    marca("aua", "Auá", { SHOPEE: 1541.24, TIKTOK: 1808.4 }),
    marca("by-samia", "By Samia", { SHOPEE: 612.94, TIKTOK: 2079.62 }),
  ],
} as unknown as MarcasMenores;
const ABA_TOTAL = 392123.51;
const ABA_DENAVITA = 364636.47;
const GRANDES_TODAS = 28304011.01;
const TODOS = ["ml", "shopee", "tiktok"] as const;
const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);

function ok(brands: string[], canais: readonly ("ml" | "shopee" | "tiktok")[] = TODOS) {
  const m = menoresNaGerencial(PROD, canais, true, escopoDeMarcas(brands).menores);
  if (m.estado !== "ok") throw new Error("esperava ok");
  return m;
}

test("Denavita esta' no filtro de marca global, entre as menores (nunca vai ao Data Mart)", () => {
  assert.ok(FILTER_BRAND_KEYS.includes("denavita"));
  assert.deepEqual(semMarcasMenores(["kokeshi", "denavita"]), ["kokeshi"]);
  assert.equal(urlSemMarcasMenores("/x?brands=kokeshi,denavita&a=1"), "/x?brands=kokeshi&a=1");
  assert.equal(urlSemMarcasMenores("/x?brands=denavita&a=1"), "/x?a=1");
});

test("Todas: as menores somam IGUAL a' aba (Denavita com ML), uma vez so' sobre as grandes", () => {
  const m = ok([]);
  perto(m.total, ABA_TOTAL);
  perto(m.porCanal.ml!, 315063.92); // ML da Denavita pelo Bling dela entra no canal ML
  perto(m.marcas.find((x) => x.brand === "denavita")!.total, ABA_DENAVITA);
  const topo = gmvComMenores({ gmv: GRANDES_TODAS, prevGmv: null, momPct: null }, m, false);
  perto(topo.gmv!, GRANDES_TODAS + ABA_TOTAL); // 28.696.134,52
  assert.deepEqual(m.provisorias, [], "com o Bling dela, a Denavita nao fica de fora");
});

test("so' Denavita: Gerencial do Bling = a linha dela na aba", () => {
  const esc = escopoDeMarcas(["denavita"]);
  assert.ok(esc.soMenores);
  const f = filtrarMarcasMenores(PROD, esc.menores, TODOS);
  perto(f.consolidado!.total!, ABA_DENAVITA);
  perto(overviewDeMenores(f, TODOS)!.gmv, ABA_DENAVITA);
  perto(overviewDeMenores(f, TODOS)!.ml_gmv!, 315063.92);
  perto(ok(["denavita"]).total, ABA_DENAVITA);
});

test("Denavita + Kokeshi: grandes = Kokeshi pelo Data Mart; menores = so' a Denavita", () => {
  const esc = escopoDeMarcas(["kokeshi", "denavita"]);
  assert.deepEqual([esc.grandes, esc.menores, esc.soMenores], [["kokeshi"], ["denavita"], false]);
  const m = ok(["kokeshi", "denavita"]);
  perto(m.total, ABA_DENAVITA);
  assert.deepEqual(m.marcas.map((x) => x.brand), ["denavita"]);
});

test("TikTok da Denavita = fonte provisoria; Shopee sem pedidos = aviso visivel, nunca 0 silencioso", () => {
  assert.deepEqual(ok([]).avisos, [AVISO_TIKTOK_DENAVITA, AVISO_SHOPEE_DENAVITA]);
  assert.deepEqual(ok(["denavita"], ["ml"]).avisos, [], "so' ML: nada a avisar");
  assert.deepEqual(ok(["yenzah"]).avisos, [], "sem a Denavita no filtro: sem aviso dela");
  // so' Shopee: a Denavita nao soma nada, mas o aviso aparece
  const sh = ok(["denavita"], ["shopee"]);
  assert.equal(sh.total, 0);
  assert.deepEqual(sh.avisos, [AVISO_SHOPEE_DENAVITA]);
  assert.deepEqual(comAvisosMenores(null, sh), { texto: AVISO_SHOPEE_DENAVITA.curto, aviso: true });
  const linha = comAvisosMenores({ texto: "inclui R$ 392 mil das demais marcas, sem meta", aviso: false }, ok([]));
  assert.equal(linha!.texto, "inclui R$ 392 mil das demais marcas, sem meta · TikTok da Denavita: fonte provisória · Shopee da Denavita sem pedidos");
  assert.equal(linha!.aviso, true);
  const nota = notaMenores(ok([]), false, false, (v) => String(Math.round(v)))!;
  assert.match(nota, /fonte provisória \(gold\.tiktok_brand_daily/);
  assert.match(nota, /parou no Bling dela desde 22\/10 \(não é a Torre\)/);
});

test("Denavita sem o Bling dela (so' TikTok provisorio) continua fora da soma", () => {
  const d = { ...PROD, marcas: [marca("denavita", "Denavita", { TIKTOK: 100 }, "parcial_fonte_provisoria")] } as unknown as MarcasMenores;
  const m = menoresNaGerencial(d, TODOS, true, ["denavita"]);
  assert.ok(m.estado === "ok" && m.total === 0 && m.provisorias[0] === "Denavita" && m.avisos.length === 0);
});

test("fiacao: ML pede as menores com a Denavita; a aba recortada mantem o ML dela", () => {
  assert.ok(ler("app/page.tsx").includes('filters.channels.some((c) => c !== "ml" || escopo.menores.includes(DENAVITA))'));
  assert.ok(ler("app/page.tsx").includes("const linhaMenores = comAvisosMenores("));
  assert.ok(ler("app/GerencialMarcasMenores.tsx").includes('canais.filter((c) => c !== "ml" || escopo.menores.includes(DENAVITA))'));
  assert.ok(ler("app/marcas-menores/page.tsx").includes('canal === "todos" ? ["ml", "shopee", "tiktok"] : [canal]'));
});
