import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  filtrarBlack, horaAHora, naSemanaDaBlack, quadroMarcaCanal, resumoBlack, tomDesvio, ultimaHoraDoCanal, type LinhaBlack,
} from "../src/lib/black-hora.ts";
import { navSections, getRouteTitle } from "../src/components/shell/nav-config.ts";

const h24 = (v: number) => Array.from({ length: 24 }, () => v);
/** `corte` horas fechadas; depois `null` (nunca 0). */
const real = (v: number, corte: number) => Array.from({ length: 24 }, (_, h) => (h < corte ? v : null));

const L: LinhaBlack[] = [
  { marca: "kokeshi", canal: "shopee", meta_dia: 2400, meta_hora: h24(100), realizado_hora: real(120, 10) },
  { marca: "kokeshi", canal: "ml", meta_dia: 1200, meta_hora: h24(50), realizado_hora: real(40, 12) },
  { marca: "barbours", canal: "ml", meta_dia: 1200, meta_hora: h24(50), realizado_hora: real(50, 12) },
];

test("resumo: cada linha compara com a meta até a SUA hora fechada; projeção pela curva da meta", () => {
  const r = resumoBlack(L);
  assert.equal(r.realizado, 120 * 10 + 40 * 12 + 50 * 12);
  assert.equal(r.metaAteAgora, 100 * 10 + 50 * 12 + 50 * 12, "Shopee até 10h, ML até 12h");
  assert.equal(r.metaDia, 4800);
  assert.ok(Math.abs(r.pct! - 2280 / 2200) < 1e-9);
  assert.ok(Math.abs(r.projecao! - (2280 * 4800) / 2200) < 1e-9);
  assert.equal(r.ultimaHora, 9, "a hora comum fechada é a da Shopee");
});

test("sem meta: % e projeção ficam null (nunca 0)", () => {
  const sem = L.map((l) => ({ ...l, meta_dia: null, meta_hora: h24(0).map(() => null) }));
  const r = resumoBlack(sem);
  assert.equal(r.metaAteAgora, null);
  assert.equal(r.pct, null);
  assert.equal(r.projecao, null);
  assert.equal(horaAHora(sem)[0].meta, null);
});

test("hora a hora: realizado só nas horas fechadas em todas as linhas; % acumulado", () => {
  const hs = horaAHora(L);
  assert.equal(hs[0].meta, 200);
  assert.equal(hs[0].realizado, 210);
  assert.equal(hs[0].diferenca, 10);
  assert.equal(hs[9].realizadoAcum, 2100);
  assert.equal(hs[10].realizado, null, "a Shopee ainda não fechou as 10h");
  assert.equal(hs[10].pctAcum, null);
  assert.equal(hs[23].metaAcum, 4800);
});

test("filtros, última hora por canal, desvio e quadro marca × canal", () => {
  assert.equal(filtrarBlack(L, ["kokeshi"], "todos").length, 2);
  assert.equal(filtrarBlack(L, [], "ml").length, 2);
  assert.deepEqual(ultimaHoraDoCanal(L, "ml"), { hora: 11, meta: 100, realizado: 90 });
  assert.equal(ultimaHoraDoCanal(L, "shopee")?.hora, 9);
  assert.equal(tomDesvio(1.02), "ok");
  assert.equal(tomDesvio(0.95), "warn");
  assert.equal(tomDesvio(0.5), "crit");
  assert.equal(tomDesvio(null), null);
  const q = quadroMarcaCanal(L);
  assert.deepEqual(q.marcas, ["kokeshi", "barbours"]);
  assert.equal(q.celula("barbours", "shopee"), null, "sem a linha na meta");
  const k = q.celula("kokeshi", "shopee")!;
  assert.equal(k.realizado, 1200);
  assert.equal(k.pct, 0.5);
  assert.equal(k.ritmo, 1.2, "a cor vem do ritmo até a hora fechada, não do % do dia");
});

test("menu: Black Friday só na semana (24 a 30/11, BRT), logo depois da Gerencial", () => {
  assert.equal(naSemanaDaBlack(new Date("2026-11-24T03:00:00Z")), true);
  assert.equal(naSemanaDaBlack(new Date("2026-11-24T02:59:00Z")), false, "23h59 de 23/11 em Brasília");
  assert.equal(naSemanaDaBlack(new Date("2026-12-01T02:59:00Z")), true);
  assert.equal(naSemanaDaBlack(new Date("2026-12-01T03:00:00Z")), false);
  const visao = navSections({ black: true }).find((s) => s.label === "Visão")!;
  assert.deepEqual(visao.pages.slice(0, 2).map((p) => p.href), ["/", "/black"]);
  assert.ok(!navSections({}).some((s) => s.pages.some((p) => p.href === "/black")));
  assert.equal(getRouteTitle("/black"), "Black Friday");
});

test("tela: sem TikTok, filtros de marca e canal, tema e releitura", () => {
  const src = readFileSync(new URL("../app/black/BlackClient.tsx", import.meta.url), "utf8");
  assert.ok(!/tiktok/i.test(src.replace(/Sem TikTok|sem TikTok/g, "")), "a meta não tem TikTok");
  assert.match(src, /\/api\/v1\/performance\/black-hora\?dia=/);
  assert.match(src, /<BrandFilter variante="menu"/);
  assert.match(src, /rotulo="Canal"/);
  assert.match(src, /setInterval\(ler, RELER_MS\)/);
  const tema = readFileSync(new URL("../src/lib/theme.ts", import.meta.url), "utf8");
  assert.match(tema, /"\/black"\] as const/);
});
