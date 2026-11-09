// FULL-UNIFICADO-1 — rota unica /full: abas, redirecionamentos e as regras da
// Visao geral (heroi, faixa de KPIs, %, ruptura por marca, top rupturas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { abasVisiveis, hrefAba, resolverAba } from "../src/lib/full-abas.ts";
import {
  fmtPct,
  heroiRuptura,
  kpiImpacto,
  kpiParamVenda,
  impactoPorMarca,
  mediana,
  pct,
  resumoML,
  resumoShopee,
  rupturaPorMarca,
  seloFrescor,
  topRupturas,
  total,
  fmtReais,
  dicaImpacto,
  canaisMisturados,
  colunasMarca,
  descricaoTop,
  fracao,
  nomeESku,
  subtituloRuptura,
  type CanalImpactoOk,
  type ImpactoRuptura,
  type ResumoCanal,
} from "../src/lib/full-visao-geral.ts";
import { tituloMarca } from "../src/lib/ml-full-estoque.ts";
import type { EstoqueFullOk, ProdutoEstoque } from "../src/lib/estoque-full.ts";
import type { InventarioML, MarcaML, MLFullEstoqueOk } from "../src/lib/ml-full-estoque.ts";
import { NAV_SECTIONS, getRouteTitle, isNavItemActive, navSections } from "../src/components/shell/nav-config.ts";

const fonte = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Fixtures minimas
// ---------------------------------------------------------------------------

function produto(brand: string, classe: ProdutoEstoque["classificacao_torre"], media = 1, cobertura: number | null = 10, vendedor: number | null = 0): ProdutoEstoque {
  return {
    shop_account: brand, brand, item_id: `${brand}-${Math.random()}`, model_id: "0", item_sku: null,
    item_name: `${brand} ${classe} ${media}`, item_status: null, is_kit: classe === "KIT_NAO_CONCILIADO",
    full_stock_saleable: 0, full_stock_total: 0, location_count: 1, por_cd: [], units_sold_28d: 0,
    days_with_sales_28d: 0, avg_daily_units_28d: String(media), cobertura_torre_dias: cobertura,
    classificacao_torre: classe, vinculo_vendas: "", reserved_stock: null, seller_stock_total: vendedor,
    summary_available_stock: null, units_sold_28d_legado_com_unpaid: null, ref_date: "2026-11-08",
  };
}

function shopee(produtos: ProdutoEstoque[], extra: Partial<EstoqueFullOk> = {}): EstoqueFullOk {
  const n = (c: string) => produtos.filter((p) => p.classificacao_torre === c).length;
  return {
    status: "ok", marketplace: "shopee", scope_label: "",
    indicadores: {
      unidades_vendaveis_operacional: 0, unidades_vendaveis_kits_contexto: 0, unidades_vendaveis_total: 0,
      produtos_ruptura: n("RUPTURA_CANDIDATA"), produtos_baixo: n("BAIXO_CANDIDATO"), produtos_excesso: n("EXCESSO_CANDIDATO"),
      produtos_sem_giro: 0, produtos_suficientes: n("SUFICIENTE"), produtos_sem_demanda_medida: 0,
      produtos_kit_nao_conciliado: n("KIT_NAO_CONCILIADO"), produtos_total: produtos.length, produtos_exigem_acao: 0,
    },
    produtos, total_no_filtro: produtos.length, truncado: false,
    frescor: { ref_date: "2026-11-08", source_captured_at: null, ingested_at: null, dias_desde_a_fotografia: 0, load_mode: "", no_automation: false },
    limites: { cobertura_baixa_dias: 7, cobertura_excesso_dias: 90, provisorio: true, observacao: "" },
    contas_cobertas: ["apice", "barbours", "lescent", "rituaria"], marcas_nao_cobertas: ["kokeshi"], limitacoes: [],
    ...extra,
  };
}

function inventario(brand: string, classe: InventarioML["classificacao_torre"], media = 1): InventarioML {
  return {
    posicao: 1, brand, read_status: "ok", eh_full: true, disponivel: 0, nao_disponivel: 0, transfer: 0,
    total_coerente: true, detalhe_coerente: true, anuncios: 1, anuncios_ativos: 1, anuncios_full: 1,
    compartilhado: false, unidades_28d: 0, media_diaria_28d: String(media), cobertura_torre_dias: "5",
    classificacao_torre: classe, vinculo_vendas: "", ref_date: "2026-11-04", sku: `SKU-${brand}`, titulo: null,
  };
}

function marcaML(brand: string, base: number | null, ruptura = 0): MarcaML {
  return {
    brand, tem_fotografia_no_dia: base !== null, estado: base === null ? null : "com_inventario",
    ultima_fotografia: null, published_at: null, inventarios: base, inventarios_full_lidos: base,
    inventarios_compartilhados: null, leitura: null, disponivel_full: null, nao_disponivel_full: null,
    transfer_full: null, unidades_28d_alocadas: null, unidades_28d_item_varios_inventarios: null,
    unidades_28d_sem_inventory_id: null, unidades_28d_fora_da_ponte: null, cobertura_da_alocacao: null,
    por_classificacao: base === null ? {} : { RUPTURA_CANDIDATA: ruptura }, nao_disponivel_por_status: [],
  };
}

function ml(inventarios: InventarioML[], marcas: MarcaML[], extra: Partial<MLFullEstoqueOk> = {}): MLFullEstoqueOk {
  const n = (c: string) => inventarios.filter((i) => i.classificacao_torre === c).length;
  const full = inventarios.filter((i) => i.classificacao_torre !== "FORA_DO_FULL").length;
  return {
    status: "ok", marketplace: "ml", scope_label: "",
    frescor: { ref_date: "2026-11-04", ultima_fotografia_disponivel: "2026-11-04", published_at: null, dias_desde_a_fotografia: 4, horas_desde_a_publicacao: null, publicacao_agendada: false },
    cobertura: { marcas_esperadas: [], marcas_com_fotografia: [], marcas_sem_fotografia: [], leitura: { inventarios: 0, inventarios_lidos: 0, inventarios_sem_leitura: 0 } },
    indicadores: {
      disponivel_full: 0, nao_disponivel_full: 0, transfer_full: 0, total_parcial: false, motivos_total_parcial: [],
      inventarios: inventarios.length, inventarios_full: full, inventarios_full_lidos: full, inventarios_fora_do_full: 0,
      inventarios_compartilhados: 0, inventarios_lidos: full, inventarios_sem_leitura: 0,
      inventarios_ruptura: n("RUPTURA_CANDIDATA"), inventarios_baixo: n("BAIXO_CANDIDATO"), inventarios_excesso: n("EXCESSO_CANDIDATO"),
      inventarios_sem_giro: 0, inventarios_suficientes: n("SUFICIENTE"), inventarios_sem_demanda_medida: 0, inventarios_exigem_acao: 0,
    },
    marcas, inventarios, total_no_filtro: inventarios.length, truncado: false, incluiu_fora_do_full: false,
    limites: { cobertura_baixa_dias: 7, cobertura_excesso_dias: 90, provisorio: true, observacao: "" }, limitacoes: [],
    ...extra,
  };
}

const SHOPEE = shopee([
  produto("apice", "RUPTURA_CANDIDATA", 9),
  produto("apice", "SUFICIENTE", 1, 20),
  produto("barbours", "BAIXO_CANDIDATO"),
  produto("barbours", "EXCESSO_CANDIDATO", 1, null),
  produto("barbours", "KIT_NAO_CONCILIADO"),
]);
const ML = ml(
  [inventario("kokeshi", "RUPTURA_CANDIDATA", 3), inventario("kokeshi", "RUPTURA_CANDIDATA", 12), inventario("kokeshi", "SUFICIENTE"), inventario("barbours", "SUFICIENTE")],
  [marcaML("kokeshi", 3, 2), marcaML("barbours", 1, 0), marcaML("lescent", null)],
);

// ---------------------------------------------------------------------------
// Resumo por canal
// ---------------------------------------------------------------------------

test("Shopee: kits ficam fora da base, e marca sem esteira e' ausencia, nao zero", () => {
  const r = resumoShopee(SHOPEE);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.base, 4);
  assert.equal(r.ruptura, 1);
  assert.deepEqual(r.coberturas, [10, 20, 10]);
  const kokeshi = r.marcas.find((m) => m.marca === "kokeshi")!;
  assert.equal(kokeshi.base, null);
  assert.ok(kokeshi.motivo);
  assert.deepEqual(r.marcas.find((m) => m.marca === "barbours"), { marca: "barbours", base: 2, ruptura: 0 });
});

test("lista truncada: cobertura e marca viram ausencia, os indicadores continuam", () => {
  const r = resumoShopee({ ...SHOPEE, truncado: true });
  if (r.status !== "ok") throw new Error("esperava ok");
  assert.equal(r.coberturas, null);
  assert.ok(r.marcas.every((m) => m.base === null));
  assert.equal(r.ruptura, 1);
});

test("ML: base e' inventario Full lido; marca sem fotografia e' ausencia", () => {
  const r = resumoML(ML);
  if (r.status !== "ok") throw new Error("esperava ok");
  assert.equal(r.base, 4);
  assert.equal(r.ruptura, 2);
  assert.ok(r.rupturasCompletas);
  const lescent = r.marcas.find((m) => m.marca === "lescent")!;
  assert.equal(lescent.base, null);
  assert.equal(lescent.ruptura, null);
});

test("indisponivel carrega o motivo da API", () => {
  const r = resumoML({ status: "unavailable", marketplace: "ml", unavailable_reason: "flag off", motivo_tecnico: "feature_flag_desligada", scope_label: "" });
  assert.deepEqual(r, { canal: "ml", status: "indisponivel", motivo: "flag off" });
});

// ---------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------

test("pct e fmtPct: base zero ou ausente nunca vira 0%", () => {
  assert.equal(pct(1, 4), 0.25);
  assert.equal(pct(0, 0), null);
  assert.equal(pct(null, 10), null);
  assert.equal(fmtPct(null), "—");
  assert.equal(fmtPct(0.126), "12,6%");
  assert.equal(fmtPct(0), "0,0%");
});

test("mediana", () => {
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([4, 1, 2, 3]), 2.5);
  assert.equal(mediana([]), null);
  assert.equal(mediana(null), null);
});

test("total so' com os dois canais medidos", () => {
  const canais = [resumoML(ML), resumoShopee(SHOPEE)];
  assert.deepEqual(total(canais), { base: 8, ruptura: 3, baixo: 1, excesso: 1, coberturas: [5, 5, 5, 5, 10, 20, 10] });
  assert.equal(total([resumoML(ML), { canal: "shopee", status: "erro", motivo: "x" }]), null);
});

test("heroi: % antes do absoluto, total numa linha, 'x de y' so' no detalhe", () => {
  const h = heroiRuptura([resumoML(ML), resumoShopee(SHOPEE)])!;
  assert.deepEqual(h, { valor: "37,5%", contexto: "3 produtos do sortimento", detalhe: "3 de 8 itens no Full", critico: true });
});

test("heroi: sem ruptura nao e' critico; nenhum canal medido = null", () => {
  const h = heroiRuptura([resumoShopee(shopee([produto("apice", "SUFICIENTE")]))])!;
  assert.equal(h.critico, false);
  assert.equal(h.contexto, "nenhum produto sem estoque da Shopee");
  assert.equal(heroiRuptura([{ canal: "ml", status: "erro", motivo: "" }, { canal: "shopee", status: "erro", motivo: "" }]), null);
});

test("heroi: canal fora conta so' o medido e diz qual, nunca como zero", () => {
  const h = heroiRuptura([resumoML(ML), { canal: "shopee", status: "erro", motivo: "caiu" }])!;
  assert.equal(h.valor, "50,0%");
  assert.equal(h.contexto, "2 produtos do sortimento do ML");
  assert.equal(heroiRuptura([resumoShopee(shopee([produto("apice", "RUPTURA_CANDIDATA")]))])!.contexto, "1 produto do sortimento da Shopee");
});

test("ruptura por marca: pior primeiro, junta canais e mantem a ausencia por celula", () => {
  const linhas = rupturaPorMarca([resumoML(ML), resumoShopee(SHOPEE)]);
  assert.deepEqual(linhas.map((l) => l.marca).slice(0, 2), ["kokeshi", "apice"]);
  const kokeshi = linhas[0];
  assert.equal(kokeshi.taxa, 2 / 3);
  assert.equal(kokeshi.celulas.shopee?.base, null, "Shopee sem esteira: ausente, nao zero");
  const lescent = linhas.find((l) => l.marca === "lescent")!;
  assert.equal(lescent.taxa, null);
  assert.equal(linhas.at(-1)!.marca, "lescent", "sem medicao vai para o fim");
});

test("top rupturas: ordena por venda media diaria entre os dois canais", () => {
  const top = topRupturas([resumoML(ML), resumoShopee(SHOPEE)], 2);
  assert.deepEqual(top.map((t) => [t.canal, t.mediaDiaria]), [["ml", 12], ["shopee", 9]]);
  const canais: ResumoCanal[] = [{ canal: "ml", status: "erro", motivo: "" }];
  assert.deepEqual(topRupturas(canais), []);
});

// ---------------------------------------------------------------------------
// Abas, redirecionamentos e menu
// ---------------------------------------------------------------------------

test("abas: a flag do desempenho Shopee esconde so' a propria aba", () => {
  const sem = abasVisiveis({ desempenhoShopee: false }).map((a) => a.chave);
  assert.deepEqual(sem, ["visao-geral", "estoque-ml", "estoque-shopee", "envio-ml"]);
  assert.equal(abasVisiveis({ desempenhoShopee: true }).length, 5);
  assert.equal(resolverAba("desempenho-shopee", abasVisiveis({ desempenhoShopee: false })), "visao-geral");
  assert.equal(resolverAba(["estoque-ml"], abasVisiveis({ desempenhoShopee: false })), "estoque-ml");
  assert.equal(resolverAba("qualquer", abasVisiveis({ desempenhoShopee: true })), "visao-geral");
  assert.equal(resolverAba(undefined, abasVisiveis({ desempenhoShopee: true })), "visao-geral");
  assert.equal(hrefAba("visao-geral"), "/full");
  assert.equal(hrefAba("envio-ml"), "/full?aba=envio-ml");
});

test("rotas antigas redirecionam para a sub-aba certa", () => {
  const casos: [string, string][] = [
    ["app/full-ml/page.tsx", 'hrefAba("envio-ml")'],
    ["app/full-shopee/page.tsx", 'hrefAba("desempenho-shopee")'],
    ["app/estoque-full/page.tsx", 'hrefAba("estoque-shopee")'],
    ["app/estoque-ml-full/page.tsx", 'hrefAba("estoque-ml")'],
  ];
  for (const [pagina, alvo] of casos) {
    const src = fonte(pagina);
    assert.ok(src.includes(`redirect(${alvo})`), `${pagina} deve redirecionar para ${alvo}`);
  }
  // Com a flag off o desempenho Shopee continua 404, sem redirecionar.
  const shopeePage = fonte("app/full-shopee/page.tsx");
  assert.ok(shopeePage.indexOf("notFound()") < shopeePage.indexOf("redirect("));
});

test("menu: uma entrada 'Full' em Operações, sem as quatro antigas", () => {
  const hrefs = navSections({ expedicao: true, performanceContas: true }).flatMap((s) => s.pages.map((p) => p.href));
  assert.ok(hrefs.includes("/full"));
  for (const antiga of ["/full-ml", "/full-shopee", "/estoque-full", "/estoque-ml-full"]) {
    assert.ok(!hrefs.includes(antiga), antiga);
  }
  const ops = NAV_SECTIONS.find((s) => s.label === "Operações")!;
  assert.ok(ops.pages.some((p) => p.href === "/full" && p.label === "Full"));
  assert.equal(getRouteTitle("/full"), "Full");
  assert.equal(isNavItemActive("/full", "/full"), true);
  for (const s of NAV_SECTIONS) for (const p of s.pages) {
    if (p.href !== "/full" && p.href !== "/") assert.equal(isNavItemActive(p.href, "/full"), false, p.href);
  }
});

test("selo de frescor: data e idade; foto velha escreve 'desatualizada'", () => {
  const r = resumoML(ML);
  if (r.status !== "ok") throw new Error("esperava ok");
  assert.equal(r.frescorVelho, true);
  assert.equal(seloFrescor(r), "foto de 04/11 · desatualizada");
  const s = resumoShopee(SHOPEE);
  if (s.status !== "ok") throw new Error("esperava ok");
  assert.equal(seloFrescor(s), "foto de 08/11, hoje");
});

test("Shopee: ruptura no Full com estoque do vendedor nao para a venda", () => {
  const r = resumoShopee(shopee([
    produto("apice", "RUPTURA_CANDIDATA", 1, 0, 5),
    produto("apice", "RUPTURA_CANDIDATA", 1, 0, 0),
    produto("apice", "RUPTURA_CANDIDATA", 1, 0, null),
  ]));
  if (r.status !== "ok") throw new Error("esperava ok");
  assert.equal(r.ruptura, 3);
  assert.equal(r.semVendedor, 1, "so' o zero medido conta; null e' desconhecido");
  const m = resumoML(ML);
  if (m.status !== "ok") throw new Error("esperava ok");
  assert.equal(m.semVendedor, null, "no ML nao se aplica");
  assert.equal(m.rupturas[0].estoqueVendedor, undefined);
});

// ---------------------------------------------------------------------------
// FULL-IMPACTO-1 — impacto POTENCIAL no faturamento
// ---------------------------------------------------------------------------

function canalImpacto(canal: "ml" | "shopee", extra: Partial<CanalImpactoOk> = {}): CanalImpactoOk {
  return {
    canal, status: "ok", ref_date: canal === "ml" ? "2026-11-04" : "2026-11-08", rupturas: 0, sem_preco: 0,
    preco_fallback: 0, sem_estoque_vendedor: null, perda_dia: null, perda_dia_sem_vendedor: null,
    gmv_full_dia: null, dias_gmv: 28, pct_gmv_full: null, pct_gmv_full_sem_vendedor: null, motivo_pct: null,
    marcas: [], itens: [], ...extra,
  };
}

const IMPACTO: ImpactoRuptura = {
  janela_gmv_dias: 28, limitacoes: [],
  ml: canalImpacto("ml", {
    perda_dia: 13307.94, pct_gmv_full: 0.1031,
    marcas: [
      { brand: "kokeshi", rupturas: 2, sem_preco: 0, perda_dia: 8000, perda_dia_sem_vendedor: null, gmv_full_dia: 50000, pct_gmv_full: 0.16, pct_gmv_full_sem_vendedor: null },
      { brand: "barbours", rupturas: 0, sem_preco: 0, perda_dia: 0, perda_dia_sem_vendedor: null, gmv_full_dia: 40000, pct_gmv_full: 0, pct_gmv_full_sem_vendedor: null },
    ],
    itens: [
      { brand: "kokeshi", sku: "K1", titulo: "Kit", media_diaria_28d: 3, preco_medio: 100, fonte_preco: "vendas_30d", mes_preco: null, estoque_vendedor: null, perda_dia: 300 },
      { brand: "kokeshi", sku: "K2", titulo: null, media_diaria_28d: 12, preco_medio: null, fonte_preco: null, mes_preco: null, estoque_vendedor: null, perda_dia: null },
    ],
  }),
  shopee: canalImpacto("shopee", {
    perda_dia: 7487.8, perda_dia_sem_vendedor: 1459.43, pct_gmv_full: 0.1455, pct_gmv_full_sem_vendedor: 0.0284,
    marcas: [
      // bruto alto, mas o destaque (sem estoque do vendedor) e' menor que o da Kokeshi no ML
      { brand: "apice", rupturas: 1, sem_preco: 0, perda_dia: 9000, perda_dia_sem_vendedor: 500, gmv_full_dia: 12000, pct_gmv_full: 0.75, pct_gmv_full_sem_vendedor: 0.04 },
    ],
    itens: [
      { brand: "apice", sku: "A1", titulo: "Serum A1", media_diaria_28d: 9, preco_medio: 50, fonte_preco: "mes", mes_preco: "2026-11-01", estoque_vendedor: 0, perda_dia: 450 },
    ],
  }),
};

/** O compacto do pt-BR usa espaco nao separavel ("13,3 mil"); o teste compara o texto. */
const sp = (t: string | null) => t?.replace(/ /g, " ") ?? null;

test("fmtReais: compacto em pt-BR e ausencia nunca vira R$ 0", () => {
  assert.equal(sp(fmtReais(13307.94)), "R$ 13,3 mil");
  assert.equal(sp(fmtReais(950)), "R$ 950");
  assert.equal(fmtReais(null), "—");
  assert.equal(sp(fmtReais(0)), "R$ 0", "zero medido continua zero");
});

test("cartao de impacto: % no valor, R$ na comparacao, por canal; ausencia nunca vira R$ 0", () => {
  const k = (c: { valor: string; comparacao: string }) => ({ valor: sp(c.valor), comparacao: sp(c.comparacao) });
  assert.deepEqual(k(kpiImpacto("ml", IMPACTO)), { valor: "10,3%", comparacao: "R$ 13,3 mil/dia do faturamento Full" });
  assert.deepEqual(k(kpiImpacto("shopee", IMPACTO, 18)), { valor: "2,8%", comparacao: "R$ 1,5 mil/dia · só quem para a venda" });
  // todas com estoque do vendedor: zero MEDIDO e explicado, mesmo com a rota fora
  assert.deepEqual(kpiImpacto("shopee", IMPACTO, 0), { valor: "0,0%", comparacao: "nenhum, o vendedor tem estoque" });
  assert.equal(kpiImpacto("shopee", null, 0).comparacao, "nenhum, o vendedor tem estoque");
  // impacto fora: "—" + "indisponível agora"
  assert.deepEqual(kpiImpacto("ml", null), { valor: "—", comparacao: "indisponível agora" });
  const soML = { ...IMPACTO, shopee: { canal: "shopee" as const, status: "unavailable" as const, motivo: "x" } };
  assert.deepEqual(kpiImpacto("shopee", soML, 18), { valor: "—", comparacao: "indisponível agora" });
  // pct ausente: o R$ vira o valor; perda ausente: "—" sem preco
  const semPct = { ...IMPACTO, ml: { ...IMPACTO.ml, pct_gmv_full: null } as CanalImpactoOk };
  assert.equal(sp(kpiImpacto("ml", semPct).valor), "R$ 13,3 mil/dia");
  const semPerda = { ...IMPACTO, ml: { ...IMPACTO.ml, perda_dia: null } as CanalImpactoOk };
  assert.deepEqual(kpiImpacto("ml", semPerda), { valor: "—", comparacao: "sem preço" });
  for (const c of [kpiImpacto("ml", null), kpiImpacto("shopee", soML, 18), kpiImpacto("ml", semPerda)]) {
    assert.ok(!sp(`${c.valor} ${c.comparacao}`)!.includes("R$ 0"));
  }
});

test("cartao 'param a venda': % das rupturas sem vendedor, 'x de y' no detalhe, estados da rodada 1", () => {
  const r = resumoShopee(shopee([
    produto("apice", "RUPTURA_CANDIDATA", 1, 0, 0),
    produto("apice", "RUPTURA_CANDIDATA", 1, 0, 0),
    produto("apice", "RUPTURA_CANDIDATA", 1, 0, 5),
    produto("apice", "RUPTURA_CANDIDATA", 1, 0, 7),
  ]));
  assert.deepEqual(kpiParamVenda(r), { valor: "50,0%", comparacao: "sem estoque do vendedor", detalhe: "2 de 4" });
  const todas = resumoShopee(shopee([produto("apice", "RUPTURA_CANDIDATA", 1, 0, 3)]));
  assert.deepEqual(kpiParamVenda(todas), { valor: "0,0%", comparacao: "todas têm estoque do vendedor" });
  assert.deepEqual(kpiParamVenda({ canal: "shopee", status: "erro", motivo: "x" }), { valor: "—", comparacao: "Shopee sem dado agora" });
  assert.equal(kpiParamVenda(resumoShopee(shopee([produto("apice", "SUFICIENTE")]))).comparacao, "nenhuma ruptura na Shopee");
});

test("drilldown do impacto: % do Full da marca e R$/dia, da maior perda para a menor; canal fora = null", () => {
  const ml = impactoPorMarca("ml", IMPACTO)!;
  assert.deepEqual(ml.map((l) => [l.marca, l.pct, l.perda]), [["kokeshi", 0.16, 8000], ["barbours", 0, 0]]);
  // Shopee pelo destaque (sem estoque do vendedor), nao pelo bruto
  assert.deepEqual(impactoPorMarca("shopee", IMPACTO)!.map((l) => [l.marca, l.pct, l.perda]), [["apice", 0.04, 500]]);
  assert.equal(impactoPorMarca("ml", null), null);
  const coberta = { ...IMPACTO, shopee: { ...IMPACTO.shopee, marcas: [{ brand: "lescent", rupturas: 1, sem_preco: 0, perda_dia: 90, perda_dia_sem_vendedor: 0, gmv_full_dia: 1000, pct_gmv_full: 0.09, pct_gmv_full_sem_vendedor: 0 }] } as CanalImpactoOk };
  assert.equal(impactoPorMarca("shopee", coberta)![0].vendedorTemEstoque, true, "vendedor cobre: explicado, nao R$ 0");
});

test("dica de impacto: ressalvas do proprio canal, R$ bruto da Shopee so' no ⓘ", () => {
  const imp = { ...IMPACTO, ml: { ...IMPACTO.ml, preco_fallback: 16, sem_preco: 2 } as CanalImpactoOk };
  const ml = sp(dicaImpacto("ml", imp))!;
  assert.ok(ml.includes("16 usam o preço anunciado") && ml.includes("2 sem preço ficaram fora da soma"));
  const sh = sp(dicaImpacto("shopee", imp))!;
  assert.ok(sh.includes("Contando também os que têm estoque do vendedor: R$ 7,5 mil/dia."));
  assert.ok(!sh.includes("sem preço ficaram fora"), "o sem preço do ML nao vaza para a Shopee");
  assert.ok(sp(dicaImpacto("shopee", null))!.startsWith("Impacto POTENCIAL"));
});

test("ruptura por marca com impacto: ordena pela maior perda de destaque, nunca a soma", () => {
  const linhas = rupturaPorMarca([resumoML(ML), resumoShopee(SHOPEE)], IMPACTO);
  assert.equal(linhas[0].marca, "kokeshi");
  assert.equal(linhas[0].maiorPerda, 8000);
  const apice = linhas.find((l) => l.marca === "apice")!;
  assert.equal(apice.maiorPerda, 500, "Shopee usa o sem estoque do vendedor, nao o bruto");
  assert.equal(linhas.find((l) => l.marca === "barbours")!.maiorPerda, 0, "zero medido");
  assert.equal(linhas.find((l) => l.marca === "lescent")!.maiorPerda, null, "sem impacto: ausente");
});

test("top rupturas com impacto: por R$/dia, sem preco no fim, canal sem impacto depois", () => {
  const top = topRupturas([resumoML(ML), resumoShopee(SHOPEE)], 10, IMPACTO);
  assert.deepEqual(top.map((t) => [t.canal, t.perdaDia]), [["shopee", 450], ["ml", 300], ["ml", null]]);
  assert.equal(top[0].estoqueVendedor, 0);
  assert.equal(top[1].estoqueVendedor, undefined);
  const soML = { ...IMPACTO, shopee: { canal: "shopee" as const, status: "unavailable" as const, motivo: "x" } };
  const misto = topRupturas([resumoML(ML), resumoShopee(SHOPEE)], 10, soML);
  assert.deepEqual(misto.map((t) => t.perdaDia), [300, null, undefined], "Shopee sem impacto: itens do estoque, R$ ausente");
});

test("rotulo de marca igual ao do resto da Torre", () => {
  assert.equal(tituloMarca("apice"), "ÁPICE");
  assert.equal(tituloMarca("rituaria"), "RITUÁRIA");
  assert.equal(tituloMarca("kokeshi"), "KOKESHI");
});

// ---------------------------------------------------------------------------
// FULL-IMPACTO-COERENCIA — a mesma regra da Shopee na manchete, marca e top 10
// ---------------------------------------------------------------------------

const itemSh = (brand: string, perda: number | null, vendedor: number | null) => ({
  brand, sku: `${brand}-${perda}-${vendedor}`, titulo: `${brand} ${vendedor}`, media_diaria_28d: 1, preco_medio: 10,
  fonte_preco: "mes" as const, mes_preco: "2026-11-01", estoque_vendedor: vendedor, perda_dia: perda,
});

const COERENCIA: ImpactoRuptura = {
  ...IMPACTO,
  shopee: canalImpacto("shopee", {
    perda_dia: 2650, perda_dia_sem_vendedor: 50,
    marcas: [
      { brand: "barbours", rupturas: 2, sem_preco: 0, perda_dia: 2600, perda_dia_sem_vendedor: 0, gmv_full_dia: 1000, pct_gmv_full: 2.6, pct_gmv_full_sem_vendedor: 0 },
      { brand: "apice", rupturas: 2, sem_preco: 0, perda_dia: 50, perda_dia_sem_vendedor: 50, gmv_full_dia: 1000, pct_gmv_full: 0.05, pct_gmv_full_sem_vendedor: 0.05 },
    ],
    itens: [
      itemSh("barbours", 1400, 5239), // vendedor tem estoque: destaque R$ 0
      itemSh("barbours", 1200, 3841),
      itemSh("apice", 50, 0), // sem estoque do vendedor: perde de verdade
      itemSh("apice", 30, null), // nao sabemos o estoque do vendedor
    ],
  }),
};

test("top 10: item da Shopee com estoque do vendedor vale R$ 0, como na manchete", () => {
  const top = topRupturas([resumoML(ML), resumoShopee(SHOPEE)], 10, COERENCIA);
  const sh = top.filter((t) => t.canal === "shopee");
  // ML 300 e Shopee 50 primeiro; os com estoque do vendedor (R$ 0) depois; desconhecido no fim
  assert.deepEqual(top.map((t) => [t.canal, t.perdaDia]).slice(0, 2), [["ml", 300], ["shopee", 50]]);
  const comVendedor = sh.filter((t) => (t.estoqueVendedor ?? 0) > 0);
  assert.deepEqual(comVendedor.map((t) => [t.perdaDia, t.perdaBruta]).sort(), [[0, 1200], [0, 1400]], "bruto so' como apoio");
  assert.equal(sh.find((t) => t.estoqueVendedor === null)!.perdaDia, null, "desconhecido nao vira zero");
  assert.ok(top.indexOf(comVendedor[0]) > top.findIndex((t) => t.perdaDia === 50));
});

test("tabela por marca: Shopee com ruptura coberta pelo vendedor e' explicada, nao 'R$ 0 · 0,0%'", () => {
  const resumo = resumoShopee(shopee([produto("barbours", "RUPTURA_CANDIDATA"), produto("apice", "RUPTURA_CANDIDATA")]));
  const linhas = rupturaPorMarca([resumo], COERENCIA);
  assert.equal(linhas.find((l) => l.marca === "barbours")!.vendedorTemEstoque, true);
  assert.equal(linhas.find((l) => l.marca === "apice")!.vendedorTemEstoque, false, "misto: um item para a venda");
});

// ---------------------------------------------------------------------------
// FULL-VISAO-RODADA-2 — menos poluida: 1 numero + 1 secundario por celula
// ---------------------------------------------------------------------------

test("fracao: a vista mostra so' o %, o 'x de y' vai para title + sr-only", () => {
  assert.deepEqual(fracao(59, 468), { texto: "12,6%", detalhe: "59 de 468" });
  assert.equal(fracao(null, 468), null, "ausencia nunca vira 0%");
  assert.equal(fracao(3, 0), null);
});

test("top 10: nome sem o codigo, com e sem titulo", () => {
  assert.deepEqual(nomeESku("KIT001", "Kit Rotina Facial", "x"), { nome: "Kit Rotina Facial", sku: "KIT001" });
  assert.deepEqual(nomeESku("KIT001", "  ", "x"), { nome: "KIT001", sku: null }, "sem titulo: o SKU vira o nome, sem repetir");
  assert.deepEqual(nomeESku(null, null, "sem identificação"), { nome: "sem identificação", sku: null });
  // ML do estoque e do impacto: nunca mais "SKU · titulo"
  const top = topRupturas([resumoML(ML)], 10, IMPACTO);
  assert.deepEqual(top.map((t) => [t.nome, t.sku]), [["Kit", "K1"], ["K2", null]]);
  const semImpacto = topRupturas([resumoML(ML)], 10);
  assert.ok(semImpacto.every((t) => t.nome === "SKU-kokeshi" && t.sku === null && !t.nome.includes(" · ")));
});

test("top 10: canal so' aparece quando a lista mistura canais", () => {
  const soML = topRupturas([resumoML(ML)], 10, IMPACTO);
  assert.equal(canaisMisturados(soML), false);
  assert.equal(subtituloRuptura(soML[0], { mostrarCanal: false, comImpacto: true }), "KOKESHI · 3,0 un./dia");
  assert.equal(descricaoTop(soML, true, false), "Rupturas de maior impacto potencial por dia · todos do ML");
  const misto = topRupturas([resumoML(ML), resumoShopee(SHOPEE)], 10, IMPACTO);
  assert.equal(canaisMisturados(misto), true);
  assert.equal(subtituloRuptura(misto[1], { mostrarCanal: true, comImpacto: true }), "KOKESHI · ML · 3,0 un./dia");
  assert.equal(descricaoTop(misto, true, true), "Rupturas de maior impacto potencial por dia · lista incompleta");
  // sem impacto: a venda e' a coluna, a linha 2 fica so' a marca
  assert.equal(subtituloRuptura(soML[0], { mostrarCanal: false, comImpacto: false }), "KOKESHI");
  assert.equal(descricaoTop(soML, false, false), "Rupturas com mais venda por dia · todos do ML");
});

test("ruptura por marca: coluna do canal fora (ou sem marca medida) nao e' desenhada", () => {
  const dois: ResumoCanal[] = [resumoML(ML), resumoShopee(SHOPEE)];
  assert.deepEqual(colunasMarca(dois, rupturaPorMarca(dois)), ["ml", "shopee"]);
  const fora: ResumoCanal[] = [resumoML(ML), { canal: "shopee", status: "erro", motivo: "caiu" }];
  assert.deepEqual(colunasMarca(fora, rupturaPorMarca(fora)), ["ml"]);
});

test("tela: esqueleto da Gerencial, aviso do canal no heroi e sem rodape de frescor", () => {
  const src = readFileSync(new URL("../app/full/VisaoGeralFull.tsx", import.meta.url), "utf-8");
  const linha = src.slice(src.indexOf("function LinhaCanal"), src.indexOf("function ChipFoto"));
  assert.ok(linha.includes("c.aviso"), "aviso no li do canal");
  assert.ok(!src.includes("<footer"), "sem rodape de frescor");
  assert.ok(src.includes("<MaisDetalhes"), "outros indicadores recolhidos em Mais detalhes");
  assert.ok(src.includes("<Heroi") && src.includes('variante="gerencial"') && src.includes("<KpiDrilldownDialog"), "esqueleto da Gerencial");
  assert.equal((src.match(/<KpiDrilldownDialog/g) ?? []).length, 1, "um so' dialogo na pagina");
  assert.ok(!src.includes("selo="), "sem selo: nao ha' limite de negocio para ruptura");
  // CARD-KPI-GERENCIAL: cor de identidade da paleta (impacto = gmv, param a venda = pedidos);
  // sem delta, "antes" nem serie enquanto nao houver foto anterior real (API-4).
  assert.equal((src.match(/identidade="gmv"/g) ?? []).length, 1, "um KpiTile de impacto, renderizado por canal");
  assert.equal((src.match(/identidade="pedidos"/g) ?? []).length, 1);
  assert.ok(!/(delta|antes|serie)=\{/.test(src), "nada inventado: sem periodo anterior nem serie");
  assert.ok(!/min-w-\[/.test(src), "nenhuma tabela com largura minima (390 sem rolagem)");
});
