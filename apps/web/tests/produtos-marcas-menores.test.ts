import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { brandSurvivesTabChange, brandsForTab } from "../src/lib/produtos-tab-transition.ts";
import { linhasDoCanal, listaShopee, listaTikTok, periodoDoMes, precoMedio, resumoDoCanal } from "../src/lib/produtos-marcas-menores.ts";

const item = (plataforma: string, sku: string, receita: number | null, quantidade: number | null, pedidos: number | null = 1) => ({
  sku, produto: `Produto ${sku}`, plataforma, receita, quantidade, pedidos,
});
const R = {
  disponivel: true,
  completo: true,
  pedidos_total: 9,
  pedidos_lidos: 9,
  marcas: [
    {
      id: "yenzah", label: "Yenzah", status: "ok", produtos: [],
      itens_por_canal: [
        item("TIKTOK", "A", 600, 6, 4), item("TIKTOK", "B", 250, 5, 3), item("TIKTOK", "C", 100, null, null),
        item("TIKTOK", "D", 50, 1, 1), item("SHOPEE", "A", 999, 9, 9),
      ],
    },
    { id: "aua", label: "Auá", status: "ok", produtos: [], itens_por_canal: [item("TIKTOK", "Z", 40, 2, 2)] },
    { id: "denavita", label: "Denavita", status: "aguardando_autorizacao", produtos: [], itens_por_canal: [item("TIKTOK", "X", 5000, 5)] },
  ],
} as never;

test("so' o canal e a marca pedidos entram; a marca aguardando autorizacao nunca", () => {
  const tk = linhasDoCanal(R, "tiktok", ["yenzah"]);
  assert.deepEqual(tk.map((l) => l.sku).sort(), ["A", "B", "C", "D"]);
  assert.ok(tk.every((l) => l.marca === "yenzah"));
  assert.deepEqual(linhasDoCanal(R, "shopee", ["yenzah"]).map((l) => l.receita), [999]); // Shopee separada do TikTok
  assert.equal(linhasDoCanal(R, "tiktok").some((l) => l.sku === "X"), false); // Denavita fora
  assert.equal(linhasDoCanal(R, "tiktok").length, 5); // todas as menores com dado
  assert.deepEqual(linhasDoCanal(null, "tiktok"), []);
  assert.deepEqual(linhasDoCanal({ ...(R as object), disponivel: false } as never, "tiktok"), []);
});

test("Pareto A/B/C/D: classifica pelo acumulado ANTERIOR (o maior sempre cai em A), como o servidor", () => {
  const l = Object.fromEntries(linhasDoCanal(R, "tiktok", ["yenzah"]).map((x) => [x.sku, x.bucket]));
  // total 1000: A comeca em 0% (600), B em 60%, C em 85%, D em 95%
  assert.deepEqual(l, { A: "A_top50", B: "B_next30", C: "C_next15", D: "D_tail" });
  const unico = linhasDoCanal({ ...(R as object), marcas: [{ id: "aua", label: "Auá", status: "ok", produtos: [], itens_por_canal: [item("TIKTOK", "U", 10, 1)] }] } as never, "tiktok");
  assert.equal(unico[0].bucket, "A_top50"); // mesmo sendo 100% do GMV
});

test("TikTok: formato das props existentes; campo sem fonte no Bling fica vazio, nunca 0", () => {
  const r = listaTikTok(linhasDoCanal(R, "tiktok", ["yenzah"]), { refMonth: "2026-11", offset: 0, limit: 25 });
  assert.equal(r.total, 4);
  const [a, , c] = r.items;
  assert.deepEqual([a.product_id, a.gmv, a.items_sold, a.orders, a.avg_price], ["A", 600, 6, 4, 100]);
  assert.equal(c.items_sold, null); // quantidade desconhecida
  assert.equal(c.orders, null);
  assert.equal(c.avg_price, null); // sem quantidade, sem preco medio (nao e' 0)
  for (const x of r.items) {
    assert.equal(x.pct_gmv_video, null);
    assert.equal(x.pct_gmv_live, null);
    assert.equal(x.pct_gmv_card, null);
    assert.equal(x.problem_rate, null);
    assert.equal(x.rating_avg, null);
    assert.equal(x.total_ratings, null);
  }
});

test("Shopee: formato das props existentes; cancelamentos e compradores sem fonte ficam vazios", () => {
  const r = listaShopee(linhasDoCanal(R, "shopee", ["yenzah"]), { refMonth: "2026-11", offset: 0, limit: 25 });
  const [x] = r.items;
  assert.deepEqual([x.sku_ref, x.gmv, x.units_sold, x.orders], ["A", 999, 9, 9]);
  assert.equal(x.cancel_rate_pct, null);
  assert.equal(x.unique_buyers, null);
  assert.equal(x.canceled_orders, null);
  assert.equal(x.variation_name, null);
});

test("ordenacao: padrao GMV desc; vazio sempre no fim; bucket filtra e o total acompanha; pagina corta", () => {
  const linhas = linhasDoCanal(R, "tiktok", ["yenzah"]);
  const base = { refMonth: "2026-11", offset: 0, limit: 25 };
  assert.deepEqual(listaTikTok(linhas, base).items.map((i) => i.product_id), ["A", "B", "C", "D"]);
  const porQtdAsc = listaTikTok(linhas, { ...base, sortColumn: "items_sold", sortDirection: "asc" }).items.map((i) => i.product_id);
  assert.deepEqual(porQtdAsc, ["D", "B", "A", "C"]); // C (sem quantidade) por ultimo
  const porQtdDesc = listaTikTok(linhas, { ...base, sortColumn: "items_sold", sortDirection: "desc" }).items.map((i) => i.product_id);
  assert.equal(porQtdDesc[porQtdDesc.length - 1], "C"); // vazio no fim tambem em desc
  const nome = listaTikTok(linhas, { ...base, sortColumn: "product_name", sortDirection: "asc" }).items.map((i) => i.product_id);
  assert.deepEqual(nome, ["A", "B", "C", "D"]);
  const soB = listaTikTok(linhas, { ...base, bucket: "B_next30" });
  assert.deepEqual([soB.total, soB.items.map((i) => i.product_id)], [1, ["B"]]);
  const p2 = listaTikTok(linhas, { ...base, offset: 3, limit: 3 });
  assert.deepEqual([p2.total, p2.items.map((i) => i.product_id)], [4, ["D"]]);
});

test("resumo A/B/C/D: soma dos buckets = GMV total; sem produto com receita, sem cards (nunca R$ 0)", () => {
  const linhas = linhasDoCanal(R, "tiktok", ["yenzah"]);
  const s = resumoDoCanal(linhas, "2026-11", "yenzah");
  assert.equal(s.total_gmv, 1000);
  assert.deepEqual(s.buckets.map((b) => [b.label, b.count, b.gmv]), [["A", 1, 600], ["B", 1, 250], ["C", 1, 100], ["D", 1, 50]]);
  assert.equal(Math.round(s.buckets.reduce((a, b) => a + b.gmv_pct, 0)), 100);
  assert.equal(s.eligible_count, 4);
  assert.equal(s.quality, null);
  // preco medio ponderado: so' sobre quem tem quantidade (C fica de fora): (600+250+50)/(6+5+1)
  assert.equal(s.avg_price_weighted, 900 / 12);
  const vazio = resumoDoCanal(linhasDoCanal({ ...(R as object), marcas: [] } as never, "tiktok"), "2026-11", null);
  assert.deepEqual([vazio.buckets, vazio.total_gmv, vazio.avg_price_weighted], [[], 0, null]);
});

test("preco medio so' com quantidade conhecida", () => {
  assert.equal(precoMedio({ receita: 90, quantidade: 3 }), 30);
  assert.equal(precoMedio({ receita: 90, quantidade: null }), null);
  assert.equal(precoMedio({ receita: 90, quantidade: 0 }), null);
});

test("periodo do mes: o Bling nao tem o futuro", () => {
  assert.deepEqual(periodoDoMes("2026-10", "2026-11-10"), { inicio: "2026-10-01", fim: "2026-10-31" });
  assert.deepEqual(periodoDoMes("2026-11", "2026-11-10"), { inicio: "2026-11-01", fim: "2026-11-10" });
  assert.deepEqual(periodoDoMes("2026-02", "2026-11-10"), { inicio: "2026-02-01", fim: "2026-02-28" });
});

test("seletor de marca: as menores so' em TikTok e Shopee; trocar para ML solta a marca", () => {
  for (const m of ["yenzah", "aua", "by-samia"]) {
    assert.ok(brandsForTab("tiktok").includes(m));
    assert.ok(brandsForTab("shopee").includes(m));
    assert.ok(!brandsForTab("ml").includes(m));
    assert.equal(brandSurvivesTabChange(m, "shopee"), true);
    assert.equal(brandSurvivesTabChange(m, "ml"), false);
  }
});

test("pagina /produtos: marca menor nao chama o Data Mart e a rota nao cai na guarda do AppShell", () => {
  const pagina = readFileSync(new URL("../app/produtos/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /if \(tab === "tiktok" && !ehMenor\) loadTK\(\)/);
  assert.match(pagina, /if \(tab === "shopee" && !ehMenor\) loadSH\(\)/);
  assert.match(pagina, /if \(tab !== "tiktok" \|\| ehMenor\) return;/);
  assert.match(pagina, /if \(tab !== "shopee" \|\| ehMenor\) return;/);
  const guarda = readFileSync(new URL("../src/components/shell/GuardaMarcasMenores.tsx", import.meta.url), "utf8");
  assert.match(guarda, /ROTAS_COM_DADO_DAS_MENORES = \["\/", "\/marcas-menores", "\/produtos"\]/);
});
