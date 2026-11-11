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

// ---- filtro de marca: so' menores -----------------------------------------
import { filtrarMarcasMenores, overviewDeMenores } from "../src/lib/gerencial/marcas-menores-gerencial.ts";
import { buildKpiBand } from "../src/lib/gerencial/kpi-band.ts";

const comPedidos = (id: string, label: string, por: Record<string, number>, ped: Record<string, number>, ant?: Record<string, number>, pedAnt?: Record<string, number>) => ({
  ...marca(id, label, por, ant),
  pedidos: Object.keys(ped).length ? Object.values(ped).reduce((a, v) => a + v, 0) : null,
  pedidos_por_plataforma: ped,
  pedidos_por_plataforma_anterior: pedAnt ?? {},
  serie: [
    { data: "2026-11-08", faturamento: 0, por_plataforma: Object.fromEntries(Object.entries(por).map(([k, v]) => [k, v / 2])) },
    { data: "2026-11-09", faturamento: 0, por_plataforma: Object.fromEntries(Object.entries(por).map(([k, v]) => [k, v / 2])) },
  ],
});
const R = {
  disponivel: true,
  marcas: [
    comPedidos("yenzah", "Yenzah", { SHOPEE: 100, TIKTOK: 50 }, { SHOPEE: 4, TIKTOK: 2 }, { SHOPEE: 80, TIKTOK: 40 }, { SHOPEE: 3, TIKTOK: 2 }),
    comPedidos("aua", "Auá", { SHOPEE: 30 }, { SHOPEE: 1 }, { SHOPEE: 30 }, { SHOPEE: 1 }),
    comPedidos("by-samia", "By Samia", {}, {}),
    marca("denavita", "Denavita", {}, undefined, "aguardando_autorizacao"),
  ],
} as never;

test("so' as marcas escolhidas entram; a que nao foi escolhida e a aguardando ficam fora", () => {
  const f = filtrarMarcasMenores(R, ["yenzah"], TODOS);
  assert.deepEqual(f.marcas.map((m) => m.id), ["yenzah"]);
  assert.equal(f.consolidado?.total, 150);
  assert.equal(f.consolidado?.pedidos, 6);
  const dois = filtrarMarcasMenores(R, ["yenzah", "aua"], TODOS);
  assert.equal(dois.consolidado?.total, 180);
  assert.deepEqual(dois.consolidado?.por_plataforma.map((p) => [p.plataforma, p.faturamento]), [["SHOPEE", 130], ["TIKTOK", 50]]);
});

test("filtro de canal recorta total, serie e pedidos", () => {
  const f = filtrarMarcasMenores(R, ["yenzah"], ["tiktok"]);
  const y = f.marcas[0];
  assert.equal(y.total, 50);
  assert.equal(y.pedidos, 2);
  assert.deepEqual(y.serie.map((d) => d.faturamento), [25, 25]);
  const ml = filtrarMarcasMenores(R, ["yenzah"], ["ml"]);
  assert.equal(ml.marcas[0].total, null); // sem dado no recorte, nunca 0
  assert.equal(ml.consolidado?.total, null);
});

test("marca escolhida sem pedido: sem dado (null), nunca 0", () => {
  const f = filtrarMarcasMenores(R, ["by-samia"], TODOS);
  assert.equal(f.marcas[0].total, null);
  assert.equal(f.marcas[0].pedidos, null);
  assert.equal(f.consolidado?.total, null);
  assert.equal(overviewDeMenores(f, TODOS), null);
});

test("anterior so' vale com base em todas as marcas somadas", () => {
  const f = filtrarMarcasMenores(R, ["yenzah", "aua"], TODOS);
  assert.equal(f.consolidado?.total_anterior, 150);
  const semBase = filtrarMarcasMenores(
    { disponivel: true, marcas: [comPedidos("yenzah", "Yenzah", { SHOPEE: 100 }, { SHOPEE: 1 }, { SHOPEE: 80 }), comPedidos("aua", "Auá", { SHOPEE: 30 }, { SHOPEE: 1 })] } as never,
    ["yenzah", "aua"],
    TODOS,
  );
  assert.equal(semBase.consolidado?.total_anterior, null);
});

test("KPIs: pedidos e ticket (GMV / pedidos) do Bling; Ads e ACOS sem dado, nunca 0", () => {
  const f = filtrarMarcasMenores(R, ["yenzah", "aua"], TODOS);
  const ov = overviewDeMenores(f, TODOS)!;
  assert.equal(ov.gmv, 180);
  assert.equal(ov.orders, 7);
  assert.ok(Math.abs(ov.avg_ticket - 180 / 7) < 1e-9);
  assert.equal(ov.ad_spend, null);
  assert.equal(ov.shopee_roas, null);
  const [, pedidos, ticket, ads, acos] = buildKpiBand(ov, TODOS, true);
  assert.ok(pedidos.value && ticket.value);
  assert.equal(ads.value, null);
  assert.ok(ads.unavailableReason);
  assert.equal(acos.value, null);
  assert.ok(acos.channelValues?.every((c) => c.value == null));
  assert.equal(ov.prev_orders, 6); // 3+2+1 do periodo anterior
});

test("menoresNaGerencial com marca escolhida: so' ela entra, as outras ficam fora", () => {
  const m = menoresNaGerencial(R, TODOS, true, ["aua"]);
  assert.equal(m.estado, "ok");
  if (m.estado !== "ok") return;
  assert.deepEqual(m.marcas.map((x) => x.brand), ["aua"]);
  assert.equal(m.total, 30);
});

test("pagina: so' menores no filtro cai na Gerencial do Bling, sem as fontes do Data Mart", () => {
  const pagina = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /escopoDeMarcas\(filters\.brands\)\.soMenores\) return <GerencialMarcasMenores/);
  assert.ok(pagina.indexOf("function GerencialInner") > pagina.indexOf("function GerencialComGrandes"));
  const so = readFileSync(new URL("../app/GerencialMarcasMenores.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(so, /useGerencialSources/);
});

// ---- C1-03: canal sem base no anterior (Shopee no Bling so' desde 22/10) ----
import { motivoSemBaseDoRecorte } from "../src/lib/gerencial/marcas-menores-gerencial.ts";
import { linhasDeMarcasMenores } from "../src/lib/gerencial/marcas-menores-adaptador.ts";

const C103 = {
  disponivel: true,
  marcas: [
    comPedidos("yenzah", "Yenzah", { SHOPEE: 100, TIKTOK: 50 }, { SHOPEE: 4, TIKTOK: 2 }, { TIKTOK: 40 }, { TIKTOK: 2 }),
    comPedidos("aua", "Auá", { TIKTOK: 30 }, { TIKTOK: 1 }, { TIKTOK: 30 }, { TIKTOK: 1 }),
  ],
} as never;
const SEM_SHOPEE = "sem dado de Shopee no período anterior";

test("C1-03 Gerencial com grandes: Shopee sem base no anterior tira o percentual das menores, com motivo", () => {
  const m = ok(C103);
  assert.equal(m.marcas[0].anterior, null);
  assert.equal(m.marcas[0].motivo, SEM_SHOPEE);
  assert.equal(m.marcas[1].motivo, null); // Auá: TikTok nos dois periodos
  assert.equal(m.anterior, null);
  assert.equal(m.motivo, SEM_SHOPEE);
  assert.deepEqual(m.anteriorPorCanal, { tiktok: 70 }); // o canal sem base sai; o TikTok segue comparavel
  const topo = gmvComMenores({ gmv: 1000, prevGmv: 900, momPct: 11.1 }, m, true);
  assert.deepEqual([topo.gmv, topo.prevGmv, topo.momPct, topo.variacaoInclui], [1180, null, 11.1, false]);
  assert.deepEqual(canalComMenores("shopee", 400, 300, 33, m, true), { gmv: 500, variacao: 33 }); // sem as menores
  assert.ok(Math.abs(canalComMenores("tiktok", 100, 90, 7, m, true).variacao! - ((180 - 160) / 160) * 100) < 1e-9);
  assert.match(notaMenores(m, topo.variacaoInclui, false, (v) => `R$ ${v}`)!, /A variação não as inclui \(sem dado de Shopee no período anterior\)/);
  const [y] = linhasDeMarcasMenores(m.marcas, true);
  assert.equal(y.mom_pct, null); // nada de +x% somando a Shopee inteira como crescimento
  assert.equal(y.tiktok_gmv_prev, 40);
  // so' TikTok no filtro: canais iguais nos dois periodos, comparacao normal
  const tk = ok(C103, ["tiktok"]);
  assert.deepEqual([tk.motivo, tk.anterior, tk.marcas[0].anterior], [null, 70, 40]);
});

test("C1-03 Gerencial so' menores: sem percentual no consolidado, motivo para a tela; caso normal intacto", () => {
  const f = filtrarMarcasMenores(C103, ["yenzah", "aua"], TODOS);
  assert.equal(f.consolidado?.total_anterior, null);
  assert.deepEqual(f.consolidado?.por_plataforma_anterior, { TIKTOK: 70 });
  const ov = overviewDeMenores(f, TODOS)!;
  assert.equal(ov.gmv, 180);
  assert.equal(ov.gmv_mom_pct, null);
  assert.equal(ov.prev_orders, null);
  assert.equal(motivoSemBaseDoRecorte(f), SEM_SHOPEE);
  // so' TikTok: comparacao volta
  const tk = filtrarMarcasMenores(C103, ["yenzah", "aua"], ["tiktok"]);
  assert.equal(motivoSemBaseDoRecorte(tk), null);
  assert.ok(Math.abs(overviewDeMenores(tk, ["tiktok"])!.gmv_mom_pct! - ((80 - 70) / 70) * 100) < 1e-9);
  // normal (Shopee e TikTok nos dois periodos): nada muda
  const normal = filtrarMarcasMenores(R, ["yenzah", "aua"], TODOS);
  assert.equal(motivoSemBaseDoRecorte(normal), null);
  assert.deepEqual(normal.consolidado?.por_plataforma_anterior, { SHOPEE: 110, TIKTOK: 40 });
  assert.ok(Math.abs(overviewDeMenores(normal, TODOS)!.gmv_mom_pct! - ((180 - 150) / 150) * 100) < 1e-9);
  const m = ok(R);
  assert.deepEqual([m.motivo, m.anterior], [null, 150]);
  assert.ok(Math.abs(linhasDeMarcasMenores(m.marcas, true)[0].mom_pct! - ((150 - 120) / 120) * 100) < 1e-9);
});

test("C1-03 tela so' menores: '—' com o motivo visivel quando nao ha base", () => {
  const so = readFileSync(new URL("../app/GerencialMarcasMenores.tsx", import.meta.url), "utf8");
  assert.match(so, /motivoSemBaseDoRecorte\(f\)/);
  assert.match(so, /\{ texto: `Variação: — \(\$\{semBase\}\)`, aviso: true \}/);
});

test("produtos das menores pedem com os mesmos canais e marcas do GMV (Gerencial)", () => {
  const cliente = readFileSync(new URL("../src/lib/api-client.ts", import.meta.url), "utf8");
  assert.match(cliente, /qs\.set\("canais"/);
  assert.match(cliente, /qs\.set\("marcas"/);
  const pagina = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /produtosMenoresAtivo, \{\s*canais: filters\.channels,\s*marcas: escopo\.menores/);
  const so = readFileSync(new URL("../app/GerencialMarcasMenores.tsx", import.meta.url), "utf8");
  assert.match(so, /useProdutosMarcasMenores\(filters\.dateFrom, filters\.dateTo, !semCanalDelas, \{ canais, marcas: escopo\.menores \}\)/);
});

test("carregamento: esqueleto na hora (nada de tela bloqueada) e produtos pedidos junto, sem esperar as marcas", () => {
  const so = readFileSync(new URL("../app/GerencialMarcasMenores.tsx", import.meta.url), "utf8");
  const aba = readFileSync(new URL("../app/marcas-menores/page.tsx", import.meta.url), "utf8");
  for (const [nome, src] of [["Gerencial so' menores", so], ["aba Marcas menores", aba]] as const) {
    assert.match(src, /<EsqueletoMarcasMenores \/>/, `${nome}: sem esqueleto`);
    assert.doesNotMatch(src, /tipo="carregando"/, `${nome}: tela inteira bloqueada em "Carregando"`);
    assert.match(src, /useProdutosMarcasMenores\(filters\.dateFrom, filters\.dateTo/, `${nome}: produtos esperam as marcas`);
  }
  const pagina = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /useProdutosMarcasMenores\(filters\.dateFrom, filters\.dateTo/);
});
