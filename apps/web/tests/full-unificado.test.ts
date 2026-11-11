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
  janelaDeslocada,
  antesImpacto,
  antesParamVenda,
  antesHeroi,
  semComparacao,
  curvaDe,
  ehKit,
  linhaCurvaCanal,
  impactoPorCurva,
  rankingRupturas,
  contarFiltros,
  dicaCurva,
  heroiCurva,
  chipFoto,
  contarGrupos,
  grupoDe,
  rotuloGrupo,
  filaPorGrupo,
  fmtFatia,
  avisoCanal,
  AVISO_LISTA_INCOMPLETA,
  RESUMO_BLOCO_FORA,
  blocosForaDaFila,
  celulaEstoque,
  celulaImpacto,
  contarCanais,
  filtrarCanal,
  filtroDoBloco,
  filtrosNaUrl,
  fotosHeroi,
  lerFiltrosUrl,
  SELO_CANAL,
  NOME_CANAL_LONGO,
  DICA_IMPACTO_FILA,
  type ItemRuptura,
  type CurvaAbc,
  type Curva,
  type ItemImpacto,
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
  assert.deepEqual(k(kpiImpacto("ml", IMPACTO)), { valor: "10,3%", comparacao: "R$ 13,3 mil/dia" });
  assert.deepEqual(k(kpiImpacto("shopee", IMPACTO, 18)), { valor: "2,8%", comparacao: "R$ 1,5 mil/dia" });
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
  // % nulo nao tem cara de erro: motivo curto (1 linha) e a conta no detalhe (title + sr-only)
  const comDias = (dias: number, motivo: string | null = null) =>
    ({ ...IMPACTO, ml: { ...IMPACTO.ml, pct_gmv_full: null, gmv_full_dia: null, dias_gmv: dias, motivo_pct: motivo } as CanalImpactoOk });
  const k27 = kpiImpacto("ml", comDias(27));
  assert.equal(k27.comparacao, "falta 1 dia de faturamento Full para o %");
  assert.equal(k27.detalhe, "27 de 28 dias de faturamento Full na janela da foto");
  assert.equal(kpiImpacto("ml", comDias(25)).comparacao, "faltam 3 dias de faturamento Full para o %");
  assert.equal(kpiImpacto("ml", comDias(0)).comparacao, "sem faturamento Full para o %");
  // janela completa e % nulo por outro motivo: nunca "28 de 28"; usa o motivo da API
  const outro = kpiImpacto("ml", comDias(28, "GMV Full zerado na janela."));
  assert.equal(outro.comparacao, "GMV Full zerado na janela.");
  assert.equal(outro.detalhe, undefined);
  assert.equal(kpiImpacto("ml", comDias(28)).comparacao, "% do faturamento indisponível");
  // janela do % deslocada (faturamento atrasado): o subtitulo diz o recorte; na vespera da foto, nao
  const desloc = { ...IMPACTO, ml: { ...IMPACTO.ml, janela_gmv_inicio: "2026-10-06", janela_gmv_fim: "2026-11-02" } as CanalImpactoOk };
  assert.equal(sp(kpiImpacto("ml", desloc).comparacao), "R$ 13,3 mil/dia");
  assert.equal(kpiImpacto("ml", desloc).detalhe, "do faturamento Full · % de 06/10 a 02/11");
  const vespera = { ...IMPACTO, ml: { ...IMPACTO.ml, janela_gmv_inicio: "2026-10-07", janela_gmv_fim: "2026-11-03" } as CanalImpactoOk };
  assert.equal(kpiImpacto("ml", vespera).detalhe, "do faturamento Full");
  assert.equal(janelaDeslocada({ ref_date: "2026-11-08", janela_gmv_inicio: null, janela_gmv_fim: null }), "", "sem janela: nada");
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
  assert.equal(descricaoTop(soML, true, false), "Sem estoque no Full, com venda nos últimos 28 dias", "canal unico nao se repete: o filtro ja' diz");
  const misto = topRupturas([resumoML(ML), resumoShopee(SHOPEE)], 10, IMPACTO);
  assert.equal(canaisMisturados(misto), true);
  assert.equal(subtituloRuptura(misto[1], { mostrarCanal: true, comImpacto: true }), "KOKESHI · ML · 3,0 un./dia");
  assert.equal(descricaoTop(misto, true, true), "Sem estoque no Full, com venda nos últimos 28 dias · lista incompleta");
  // sem impacto: a venda e' a coluna, a linha 2 fica so' a marca
  assert.equal(subtituloRuptura(soML[0], { mostrarCanal: false, comImpacto: false }), "KOKESHI");
  assert.equal(descricaoTop(soML, false, false), "Sem estoque no Full, com venda nos últimos 28 dias", "canal unico nao se repete: o filtro ja' diz");
});

test("ruptura por marca: coluna do canal fora (ou sem marca medida) nao e' desenhada", () => {
  const dois: ResumoCanal[] = [resumoML(ML), resumoShopee(SHOPEE)];
  assert.deepEqual(colunasMarca(dois, rupturaPorMarca(dois)), ["ml", "shopee"]);
  const fora: ResumoCanal[] = [resumoML(ML), { canal: "shopee", status: "erro", motivo: "caiu" }];
  assert.deepEqual(colunasMarca(fora, rupturaPorMarca(fora)), ["ml"]);
});

test("tela: esqueleto da Gerencial, aviso do canal no heroi e sem rodape de frescor", () => {
  const src = readFileSync(new URL("../app/full/VisaoGeralFull.tsx", import.meta.url), "utf-8");
  const bloco = src.slice(src.indexOf("function BlocoCanalHeroi"), src.indexOf("function CelulaImpacto"));
  assert.ok(bloco.includes("const aviso = avisoCanal(c);") && !bloco.includes("c.aviso"), "aviso do canal so' com problema (avisoCanal)");
  assert.ok(!src.includes("chipFoto(") && bloco.includes("c.frescor"), "frescor em dia sai da vista: title do bloco e ⓘ do heroi");
  assert.ok(src.includes("fotosHeroi(canais)"), "datas das fotos no ⓘ do heroi");
  assert.ok(!src.includes("<footer"), "sem rodape de frescor");
  assert.ok(src.includes("<MaisDetalhes"), "outros indicadores recolhidos em Mais detalhes");
  assert.ok(src.includes("<Heroi") && src.includes('variante="gerencial"') && src.includes("<KpiDrilldownDialog"), "esqueleto da Gerencial");
  assert.equal((src.match(/<KpiDrilldownDialog/g) ?? []).length, 1, "um so' dialogo na pagina");
  assert.ok(!src.includes("selo="), "sem selo: nao ha' limite de negocio para ruptura");
  // CARD-KPI-GERENCIAL: cor de identidade da paleta (impacto = gmv, param a venda = pedidos);
  // API-4: delta e "antes" so' da foto anterior (helpers antes*); serie nunca (nao aprovada).
  assert.equal((src.match(/identidade="gmv"/g) ?? []).length, 2, "um KpiTile de impacto por canal + o modal da curva herda a cor");
  assert.equal((src.match(/identidade="pedidos"/g) ?? []).length, 2, "Sem estoque com demanda e Param a venda");
  assert.ok(!src.includes('identidade="ticket"'), "o cartao AA/A saiu da faixa (foi para o heroi)");
  assert.ok(!/serie=\{/.test(src), "sem sparkline: o Full nao tem serie aprovada");
  assert.equal((src.match(/delta=\{a && <Pilula a=\{a\} \/>\}/g) ?? []).length, 2, "pilula so' com o antes medido");
  assert.ok(src.includes("fetchImpactoRuptura(signal, true)"), "o antes vem da 2a chamada, depois do primeiro desenho");
  assert.ok(!/min-w-\[/.test(src), "nenhuma tabela com largura minima (390 sem rolagem)");
});

// ---------------------------------------------------------------------------
// API-4 -- o "antes" dos cartoes vem da foto anterior (2a chamada)
// ---------------------------------------------------------------------------

test("antes do impacto: p.p. contra a foto anterior, so' com a MESMA foto atual", () => {
  const comAnt = { ...IMPACTO, ml: { ...IMPACTO.ml, anterior: { ref_date: "2026-11-03", rupturas: 2, sem_estoque_vendedor: null, perda_dia: 1, perda_dia_sem_vendedor: null, dias_gmv: 28, pct_gmv_full: 0.0931, pct_gmv_full_sem_vendedor: null, motivo_pct: null } } as CanalImpactoOk };
  const a = antesImpacto("ml", IMPACTO, comAnt)!;
  assert.ok(Math.abs(a.pp - 1) < 1e-9, "10,31% contra 9,31% = +1,0 p.p.");
  assert.equal(a.texto, "antes 9,3% em 03/11", "no cartao de impacto, o antes curto");
  // sem a 2a chamada, sem anterior ou com outra foto atual: sem pilula (nunca zero)
  assert.equal(antesImpacto("ml", IMPACTO, null), null);
  assert.equal(antesImpacto("ml", IMPACTO, IMPACTO), null);
  const outraFoto = { ...comAnt, ml: { ...(comAnt.ml as CanalImpactoOk), ref_date: "2026-11-09" } };
  assert.equal(antesImpacto("ml", IMPACTO, outraFoto), null, "foto nova entre as chamadas");
  // Shopee: o destaque (so' quem para a venda)
  const sh = { ...IMPACTO, shopee: { ...IMPACTO.shopee, anterior: { ref_date: "2026-11-07", rupturas: 1, sem_estoque_vendedor: 1, perda_dia: 1, perda_dia_sem_vendedor: 1, dias_gmv: 28, pct_gmv_full: 0.2, pct_gmv_full_sem_vendedor: 0.0384 } } as CanalImpactoOk };
  assert.ok(Math.abs(antesImpacto("shopee", IMPACTO, sh)!.pp - -1) < 1e-9);
});

test("antes do 'param a venda' e do heroi: so' com os dois lados medidos", () => {
  const agora = resumoShopee(shopee([produto("apice", "RUPTURA_CANDIDATA", 1, 0, 0), produto("apice", "RUPTURA_CANDIDATA", 1, 0, 5)]));
  const ant = resumoShopee(shopee([produto("apice", "RUPTURA_CANDIDATA", 1, 0, 5), produto("apice", "RUPTURA_CANDIDATA", 1, 0, 5)], { ref_date: "2026-11-07" } as Partial<EstoqueFullOk>));
  const a = antesParamVenda(agora, ant)!;
  assert.equal(a.pp, 50);
  assert.equal(antesParamVenda(agora, null), null);
  assert.equal(antesParamVenda(agora, { canal: "shopee", status: "indisponivel", motivo: "sem foto" }), null);
  // heroi: exige ML e Shopee com foto anterior
  const canais: ResumoCanal[] = [resumoML(ML), resumoShopee(SHOPEE)];
  assert.equal(antesHeroi(canais, { ml: null, shopee: resumoShopee(SHOPEE) }), null, "ML sem foto anterior: sem delta");
  const h = antesHeroi(canais, { ml: resumoML(ML), shopee: resumoShopee(SHOPEE) })!;
  assert.equal(h.pp, 0);
  assert.match(h.texto, /^antes 37,5% · fotos de \d\d\/\d\d \(ML\) e \d\d\/\d\d \(Shopee\)$/);
});

test("sem comparacao: o motivo diz o que difere entre as fotos (title + sr-only)", () => {
  const recorte = { ...IMPACTO, ml: { ...IMPACTO.ml, anterior: null, motivo_anterior: "recorte",
    diferenca_recorte: { ref_date_anterior: "2026-11-04", so_na_atual: [], so_na_anterior: ["rituaria"] } } as CanalImpactoOk };
  assert.equal(semComparacao("ml", recorte), "sem comparação: a foto anterior do ML (04/11) tem RITUÁRIA e a atual não");
  const semFoto = { ...IMPACTO, shopee: { ...IMPACTO.shopee, anterior: null, motivo_anterior: "x", diferenca_recorte: null } as CanalImpactoOk };
  assert.equal(semComparacao("shopee", semFoto), "sem comparação: não há foto anterior da Shopee");
  const nova = { ...IMPACTO, ml: { ...IMPACTO.ml, anterior: null, diferenca_recorte: { ref_date_anterior: "2026-11-04", so_na_atual: ["apice"], so_na_anterior: [] } } as CanalImpactoOk };
  assert.equal(semComparacao("ml", nova), "sem comparação: a foto atual do ML tem ÁPICE e a anterior (04/11) não");
  // com comparacao (ou antes da 2a chamada): nada
  const comAnt = { ...IMPACTO, ml: { ...IMPACTO.ml, anterior: { ref_date: "2026-11-03", rupturas: 1, sem_estoque_vendedor: null, perda_dia: 1, perda_dia_sem_vendedor: null, dias_gmv: 28, pct_gmv_full: 0.1, pct_gmv_full_sem_vendedor: null, motivo_pct: null } } as CanalImpactoOk };
  assert.equal(semComparacao("ml", comAnt), null);
  assert.equal(semComparacao("ml", null), null);
});
// ---------------------------------------------------------------------------
// CURVA-ABC -- curva ABC no /full (planilha "Sortimento Gobeaute")
// ---------------------------------------------------------------------------

function itemImp(brand: string, sku: string, perda: number | null, extra: Partial<ItemImpacto> = {}): ItemImpacto {
  return { brand, sku, titulo: `Produto ${sku}`, media_diaria_28d: 1, preco_medio: 10, fonte_preco: "vendas_30d", mes_preco: null, estoque_vendedor: null, perda_dia: perda, ...extra };
}

function impactoCom(ml: ItemImpacto[], shopee: ItemImpacto[] = []): ImpactoRuptura {
  return {
    ...IMPACTO,
    ml: { ...(IMPACTO.ml as CanalImpactoOk), itens: ml },
    shopee: { ...(IMPACTO.shopee as CanalImpactoOk), itens: shopee },
  };
}

const ABC: CurvaAbc = {
  status: "ok", fonte: "Planilha 'Sortimento Gobeaute', aba 'ABC Curve'", lida_em: "2026-11-09T12:00:00Z",
  duplicadas: ["apice|20690", "apice|20563"],
  curva_por_sku: { "kokeshi|K1": "AA", "kokeshi|K2": "A", "kokeshi|K3": "C", "kokeshi|Kit9": "AA", "barbours|B1": "B" },
};

test("curva: kit e codigo fora da planilha ficam sem curva, nunca C", () => {
  assert.equal(curvaDe({ marca: "kokeshi", codigo: "K1", kit: false }, ABC), "AA");
  assert.equal(curvaDe({ marca: "kokeshi", codigo: "Kit9", kit: true }, ABC), null, "kit nao tem curva");
  assert.equal(curvaDe({ marca: "kokeshi", codigo: "X99", kit: false }, ABC), null);
  assert.equal(curvaDe({ marca: "lescent", codigo: "K1", kit: false }, ABC), null, "a chave e' marca + codigo");
  assert.equal(curvaDe({ marca: "kokeshi", codigo: "K1", kit: false }, { ...ABC, status: "unavailable" }), null);
  assert.equal(ehKit("Kit110"), true);
  assert.equal(ehKit("KIT005"), true);
  assert.equal(ehKit("10009"), false);
});

test("cartao AA/A: % do impacto do canal; abaixo de 50% de cobertura vira '—' com a contagem", () => {
  // 60 + 20 com curva AA/A de 100 = 80% de cobertura, 80% do impacto em AA/A
  const imp = impactoCom([itemImp("kokeshi", "K1", 60), itemImp("kokeshi", "K2", 20), itemImp("kokeshi", "X99", 20)]);
  const l = linhaCurvaCanal("ml", imp, ABC);
  assert.equal(l.estado, "ok");
  if (l.estado === "ok") {
    assert.ok(Math.abs(l.pct - 0.8) < 1e-9);
    assert.equal(l.itens, 2);
    assert.equal(l.detalhe, "curva em 2 de 3 rupturas · 80,0% do impacto");
  }
  // 40 de 100 com curva: 40% < 50%, sem %
  const pouca = linhaCurvaCanal("ml", impactoCom([itemImp("kokeshi", "K1", 40), itemImp("kokeshi", "X1", 60)]), ABC);
  assert.deepEqual(pouca, { estado: "pouca", texto: "curva em 1 de 2 rupturas" });
  // exatamente 50%: entra
  assert.equal(linhaCurvaCanal("ml", impactoCom([itemImp("kokeshi", "K3", 50), itemImp("kokeshi", "X1", 50)]), ABC).estado, "ok");
});

test("leitura em falha: '—' com motivo, nunca 0", () => {
  const imp = impactoCom([itemImp("kokeshi", "K1", 60)]);
  const falha: CurvaAbc = { status: "unavailable", motivo: "Curva ABC indisponível agora: credencial da planilha não configurada.", fonte: "", duplicadas: [], curva_por_sku: {} };
  const l = linhaCurvaCanal("ml", imp, falha);
  assert.deepEqual(l, { estado: "ausente", texto: "sem curva agora", motivo: falha.motivo });
  assert.equal(impactoPorCurva("ml", imp, falha), null);
  assert.match(dicaCurva(falha, imp), /nada vira "C"/);
  assert.equal(linhaCurvaCanal("ml", null, ABC).estado, "ausente", "impacto fora tambem nao vira 0");
});

test("fila em grupos: AA barato acima de A caro e de C caro; sem curva junto com B/C pelo impacto", () => {
  const canais: ResumoCanal[] = [resumoML(ML)];
  const ABC2: CurvaAbc = { ...ABC, curva_por_sku: { ...ABC.curva_por_sku, "kokeshi|B1": "B" } };
  const imp = impactoCom([
    itemImp("kokeshi", "K2", 834),   // A caro
    itemImp("kokeshi", "K1", 214),   // AA barato
    itemImp("kokeshi", "K3", 900),   // C caro
    itemImp("kokeshi", "X99", 500),  // sem curva
    itemImp("kokeshi", "B1", 300),   // B
  ]);
  assert.deepEqual(rankingRupturas(canais, imp, ABC2).map((t) => t.codigo), ["K1", "K2", "K3", "X99", "B1"],
    "AA, depois A, depois os demais (C 900 > sem curva 500 > B 300) so' pelo impacto");
  assert.deepEqual(contarGrupos(rankingRupturas(canais, imp, ABC2), ABC2), { AA: 1, A: 1, demais: 3 });
  assert.equal(grupoDe(null), "demais", "sem curva nao e' C, mas entra nos demais");
  assert.equal(rotuloGrupo("demais", 91), "Demais (B, C, sem curva) · 91 rupturas");
  assert.equal(rotuloGrupo("AA", 1), "AA · 1 ruptura");
  // desempate dentro do grupo: venda/dia
  const emp = impactoCom([itemImp("kokeshi", "X1", 50, { media_diaria_28d: 2 }), itemImp("kokeshi", "X2", 50, { media_diaria_28d: 9 })]);
  assert.deepEqual(rankingRupturas(canais, emp, ABC2).map((t) => t.codigo), ["X2", "X1"]);
});

test("fila: filtro corta antes do top 10 e cabecalho de grupo so' em 'Todas'", () => {
  assert.equal(descricaoTop([], true, false, true), "Sem estoque no Full, com venda nos últimos 28 dias");
  assert.equal(descricaoTop([], true, false, false), "Sem estoque no Full, com venda nos últimos 28 dias", "mesmo subtitulo com ou sem curva");
  const canais: ResumoCanal[] = [resumoML(ML)];
  const muitos = Array.from({ length: 12 }, (_, i) => itemImp("kokeshi", `Z${i}`, 1000 - i));
  const imp2 = impactoCom([...muitos, itemImp("kokeshi", "K3", 1)]);
  assert.ok(!topRupturas(canais, 10, imp2, ABC).some((t) => t.codigo === "K3"), "C barato fica fora do top 10");
  assert.deepEqual(topRupturas(canais, 10, imp2, ABC, "c").map((t) => t.codigo), ["K3"]);
  assert.deepEqual(contarFiltros(rankingRupturas(canais, imp2, ABC), ABC), { todas: 13, aa_a: 0, b: 0, c: 1, sem: 12 });
  const src = readFileSync(new URL("../app/full/VisaoGeralFull.tsx", import.meta.url), "utf-8");
  assert.ok(src.includes('comCurva && filtroAtivo === "todas" ? contarGrupos('), "cabecalho so' com o filtro Todas");
  assert.ok(src.includes("<ChipCurva curva={cv}"), "selo na linha 1, inclusive 'sem curva'");
});

test("drilldown por curva: % e R$/dia por curva + total; ⓘ cita as duplicatas da fonte", () => {
  const imp = impactoCom([itemImp("kokeshi", "K1", 60), itemImp("kokeshi", "K3", 30), itemImp("kokeshi", "Kit9", 10, {}), itemImp("kokeshi", "X1", null)]);
  const t = impactoPorCurva("ml", imp, ABC)!;
  assert.deepEqual(t.linhas.map((l) => [l.curva, l.perda, l.rupturas]), [["AA", 60, 1], ["A", 0, 0], ["B", 0, 0], ["C", 30, 1], ["sem", 10, 2]]);
  assert.equal(t.total.perda, 100);
  assert.equal(t.total.rupturas, 4);
  const semPreco = impactoPorCurva("ml", impactoCom([itemImp("kokeshi", "K1", 60), itemImp("kokeshi", "X1", null)]), ABC)!.linhas.find((l) => l.curva === "sem")!;
  assert.deepEqual([semPreco.perda, semPreco.pct, semPreco.rupturas], [null, null, 1], "sem preco: ausencia, nao R$ 0");
  assert.match(dicaCurva(ABC, imp), /A fonte tem 2 SKUs repetidos \(vale a linha de maior faturamento\)/);
  assert.match(dicaCurva(ABC, imp), /ML: curva em 2 de 4 rupturas/);
});

test("fatia por curva: nao nula nunca '0,0%', quase toda nunca '100,0%'; zero da Shopee coberto pelo vendedor e' marcado", () => {
  assert.equal(fmtFatia(0.0003), "<0,1%");
  assert.equal(fmtFatia(0), "0,0%");
  assert.equal(fmtFatia(0.9997), ">99,9%");
  assert.equal(fmtFatia(1), "100,0%");
  assert.equal(fmtFatia(0.25), "25,0%");
  const imp = impactoCom([], [itemImp("barbours", "B1", 40, { estoque_vendedor: 3 }), itemImp("barbours", "X1", 40, { estoque_vendedor: 0 })]);
  const b = impactoPorCurva("shopee", imp, ABC)!.linhas.find((l) => l.curva === "B")!;
  assert.equal(b.perda, 0);
  assert.equal(b.vendedorCobre, true);
  assert.equal(impactoPorCurva("shopee", imp, ABC)!.linhas.find((l) => l.curva === "sem")!.vendedorCobre, false);
});

// ---------------------------------------------------------------------------
// CURVA-ABC PR2 -- heroi com a contagem AA/A e o aviso de cobertura no chip
// ---------------------------------------------------------------------------

test("heroi: contagem AA/A, contexto e uma linha por canal; cobertura baixa sem %", () => {
  const canais: ResumoCanal[] = [resumoML(ML), resumoShopee(SHOPEE)];
  // ML: K1 (AA) e K2 (A) cobrem 80% do impacto -> com %
  const imp = impactoCom([itemImp("kokeshi", "K1", 60), itemImp("kokeshi", "K2", 20), itemImp("kokeshi", "X99", 20)]);
  const h = heroiCurva(canais, imp, ABC)!;
  assert.equal(h.valor, "2", "conta so' os AA/A (o Shopee do fixture nao tem curva)");
  assert.equal(h.contexto, "", "'de N rupturas com demanda' saiu da vista");
  assert.equal(h.titulo, "de 3 rupturas com demanda", "metodologia no title do numero");
  assert.equal(h.porCanal.ml, "2 AA/A · 80,0% do impacto potencial");
  assert.equal(h.critico, true);
  assert.equal(h.porCanal.shopee, "0 AA/A · nenhuma ruptura", "canal sem ruptura: nem %, nem 'curva em 0 de 0'");
  assert.equal(h.parcial, false);
  // cobertura < 50%: sem %, a cobertura escrita, e o heroi avisa que e' parcial
  const pouca = heroiCurva(canais, impactoCom([itemImp("kokeshi", "K1", 10), itemImp("kokeshi", "X1", 90)]), ABC)!;
  assert.equal(pouca.porCanal.ml, "1 AA/A · curva em 1 de 2 rupturas");
  assert.equal(pouca.parcial, true);
});

test("heroi: leitura da curva em falha vira '—' com o motivo, nunca 0", () => {
  const canais: ResumoCanal[] = [resumoML(ML), resumoShopee(SHOPEE)];
  const falha: CurvaAbc = { status: "unavailable", motivo: "Curva ABC indisponível agora: a planilha não respondeu.", fonte: "", duplicadas: [], curva_por_sku: {} };
  const h = heroiCurva(canais, IMPACTO, falha)!;
  assert.equal(h.valor, "—");
  assert.equal(h.contexto, "sem curva agora", "so' o aviso quando a curva falha");
  assert.equal(h.titulo, `${falha.motivo} · de 3 rupturas com demanda`);
  assert.deepEqual(h.porCanal, {}, "as linhas do meio voltam ao % sem estoque");
  assert.equal(heroiCurva(canais, IMPACTO, null)!.valor, "—", "carregando: tambem '—'");
});

test("chip da foto: aviso de cobertura escrito no chip ('sem RITUÁRIA'), o aviso inteiro no title", () => {
  const semRit = resumoML(ml([inventario("kokeshi", "RUPTURA_CANDIDATA")], [marcaML("kokeshi", 1, 1), { ...marcaML("rituaria", null), estado: null } as MarcaML],
    { indicadores: { ...ML.indicadores, total_parcial: true, motivos_total_parcial: ["Sem fotografia no dia: RITUÁRIA."] } } as Partial<MLFullEstoqueOk>));
  if (semRit.status !== "ok") throw new Error("esperava ok");
  const f = chipFoto(semRit);
  assert.match(f.texto, /· sem RITUÁRIA$/);
  assert.equal(f.atencao, true);
  assert.match(f.titulo, /Total parcial: Sem fotografia no dia: RITUÁRIA\./);
  const limpo = resumoShopee(SHOPEE);
  if (limpo.status !== "ok") throw new Error("esperava ok");
  assert.equal(chipFoto(limpo).texto, "foto de 08/11, hoje");
});

test("fila 'Todas': ate' 5 por grupo e os 3 grupos sempre visiveis; 'ver todos' abre o grupo", () => {
  const canais: ResumoCanal[] = [resumoML(ML)];
  // 8 AA, 7 A e um kit sem curva de impacto alto: no top 10 o 'Demais' sumiria
  const curvas: Record<string, Curva> = {};
  const its: ItemImpacto[] = [];
  for (let i = 0; i < 8; i++) { curvas[`kokeshi|AA${i}`] = "AA"; its.push(itemImp("kokeshi", `AA${i}`, 100 + i)); }
  for (let i = 0; i < 7; i++) { curvas[`kokeshi|A${i}`] = "A"; its.push(itemImp("kokeshi", `A${i}`, 200 + i)); }
  its.push(itemImp("kokeshi", "Kit1", 4200));
  const abc: CurvaAbc = { ...ABC, curva_por_sku: curvas };
  const ranking = rankingRupturas(canais, impactoCom(its), abc);
  assert.ok(!topRupturas(canais, 10, impactoCom(its), abc).some((t) => t.codigo === "Kit1"), "o problema: top 10 sem o kit de R$ 4,2 mil");
  const fila = filaPorGrupo(ranking, abc);
  assert.deepEqual(fila.map((g) => [g.grupo, g.total, g.itens.length]), [["AA", 8, 5], ["A", 7, 5], ["demais", 1, 1]]);
  assert.equal(fila[2].itens[0].codigo, "Kit1", "o maior impacto sem curva aparece na visao padrao");
  assert.equal(filaPorGrupo(ranking, abc, new Set(["AA"]))[0].itens.length, 8, "ver todos abre a lista do grupo");
  // grupo vazio nao aparece
  assert.deepEqual(filaPorGrupo(rankingRupturas(canais, impactoCom([itemImp("kokeshi", "Kit1", 1)]), abc), abc).map((g) => g.grupo), ["demais"]);
  const src = readFileSync(new URL("../app/full/VisaoGeralFull.tsx", import.meta.url), "utf-8");
  assert.ok(src.includes("filaPorGrupo(doCanalEscolhido, abc, abertos)") && src.includes("ver todos (${fmtInt(total)})"));
});

// ---------------------------------------------------------------------------
// FULL-CARINHO -- blocos de canal, aviso so' com problema, filtro de canal na URL
// ---------------------------------------------------------------------------

function rup(canal: "ml" | "shopee", codigo: string, extra: Partial<ItemRuptura> = {}): ItemRuptura {
  return { canal, marca: "kokeshi", nome: `Produto ${codigo}`, sku: codigo, mediaDiaria: 1, perdaDia: 10, codigo, kit: false, ...extra };
}

test("selo do canal: ponto e pilula da cor do canal (ML ciano, Shopee laranja)", () => {
  assert.equal(SELO_CANAL.ml.ponto, "bg-canal-ml");
  assert.equal(SELO_CANAL.shopee.ponto, "bg-canal-shopee");
  assert.match(SELO_CANAL.ml.pilula, /canal-ml/);
  assert.match(SELO_CANAL.shopee.pilula, /canal-shopee/);
  assert.deepEqual(NOME_CANAL_LONGO, { ml: "Mercado Livre", shopee: "Shopee" });
  const src = readFileSync(new URL("../src/components/full/SeloCanal.tsx", import.meta.url), "utf-8");
  assert.ok(src.includes("SELO_CANAL[canal]") && src.includes("NOME_CANAL_LONGO[canal]"));
  const tela = readFileSync(new URL("../app/full/VisaoGeralFull.tsx", import.meta.url), "utf-8");
  assert.equal((tela.match(/<SeloCanal canal=\{t\.canal\} \/>/g) ?? []).length, 3, "selo em toda linha: tabela, cartao e blocos recolhidos");
});

test("aviso do canal so' com foto de mais de 1 dia ou marca faltando; frescor em dia fora da vista", () => {
  const base = { refDate: "2026-11-07", semFoto: [] as string[] };
  assert.equal(avisoCanal({ ...base, diasFoto: 0 }), null);
  assert.equal(avisoCanal({ ...base, diasFoto: 1 }), null, "foto de ontem e' normal");
  assert.equal(avisoCanal({ ...base, diasFoto: null }), null);
  assert.equal(avisoCanal({ ...base, diasFoto: 2 }), "Foto de 07/11 · desatualizada");
  assert.equal(avisoCanal({ ...base, diasFoto: 0, semFoto: ["RITUÁRIA"] }), "Sem RITUÁRIA nesta foto");
  assert.equal(avisoCanal({ ...base, diasFoto: 3, semFoto: ["RITUÁRIA"] }), "Sem RITUÁRIA nesta foto · Foto de 07/11 · desatualizada");
  const canais: ResumoCanal[] = [resumoML(ML), resumoShopee(SHOPEE)];
  assert.match(fotosHeroi(canais) ?? "", /^Fotos: ML \d\d\/\d\d, Shopee \d\d\/\d\d\.$/);
});

test("celula de impacto: Shopee com estoque do vendedor = 'sem perda' explicado; sem preco nunca vira 0", () => {
  const c = celulaImpacto(rup("shopee", "S1", { estoqueVendedor: 12, perdaDia: 0, perdaBruta: 214.4 }));
  assert.equal(c.texto, "sem perda", "nem 'R$ 0' em destaque nem '—' (que e' ausencia): perda zero medida");
  assert.equal(c.zeroMedido, true);
  assert.equal(c.apoio, "vendedor tem estoque · a venda segue");
  assert.match(c.titulo ?? "", /\/dia se contar só o Full$/);
  assert.equal(celulaImpacto(rup("ml", "M1", { perdaDia: null })).ausente, "sem preço");
  assert.equal(celulaImpacto(rup("ml", "M1", { perdaDia: undefined })).texto, "—");
  assert.equal(celulaImpacto(rup("shopee", "S2", { perdaDia: null, estoqueVendedor: null })).ausente, "estoque do vendedor não informado");
  assert.equal(celulaImpacto(rup("ml", "M1", { perdaDia: 214.4 })).zeroMedido, undefined);
  assert.match(DICA_IMPACTO_FILA, /É potencial/);
});

test("celula de estoque: Full e' 0 por definicao da fila; fora do Full so' quando existe; ausencia nunca vira 0", () => {
  assert.deepEqual(celulaEstoque(rup("ml", "M1", { naoDisponivel: 150, transferencia: 120 })), { texto: "0", apoio: "150 não disponível · 120 em transferência" });
  assert.equal(celulaEstoque(rup("ml", "M1", { naoDisponivel: 0, transferencia: 0 })).apoio, "0 não disponível", "zero medido");
  assert.deepEqual(celulaEstoque(rup("ml", "M1", {})), { texto: "0", ausente: "estoque fora do Full não informado" });
  assert.deepEqual(celulaEstoque(rup("shopee", "S1", { estoqueVendedor: 2316 })), { texto: "0", apoio: "2.316 com o vendedor" });
  assert.equal(celulaEstoque(rup("shopee", "S1", { estoqueVendedor: null })).ausente, "estoque do vendedor não informado");
});

test("fila com impacto: o estoque fora do Full do ML vem da lista de estoque (join por marca+SKU)", () => {
  const inv = { ...inventario("kokeshi", "RUPTURA_CANDIDATA", 3), sku: "K1", nao_disponivel: 150, transfer: 120 };
  const canais = [resumoML(ml([inv], [marcaML("kokeshi", 1, 1)]))];
  const imp: ImpactoRuptura = {
    janela_gmv_dias: 28, limitacoes: [], shopee: canalImpacto("shopee"),
    ml: canalImpacto("ml", { itens: [
      { brand: "kokeshi", sku: "K1", titulo: "Kit", media_diaria_28d: 3, preco_medio: 100, fonte_preco: "vendas_30d", mes_preco: null, estoque_vendedor: null, perda_dia: 300 },
      { brand: "kokeshi", sku: "K9", titulo: "Sem match", media_diaria_28d: 1, preco_medio: 100, fonte_preco: "vendas_30d", mes_preco: null, estoque_vendedor: null, perda_dia: 100 },
    ] }),
  };
  const fila = rankingRupturas(canais, imp);
  assert.deepEqual(celulaEstoque(fila[0]), { texto: "0", apoio: "150 não disponível · 120 em transferência" });
  assert.equal(celulaEstoque(fila[1]).ausente, "estoque fora do Full não informado", "sem match = ausente, nunca 0");
});

test("brinde e descontinuado: fora das contagens e da fila; sem situacao (sem linha na BD) conta normal", () => {
  const sh = shopee([
    { ...produto("apice", "RUPTURA_CANDIDATA", 9), situacao: "brinde" },
    { ...produto("apice", "RUPTURA_CANDIDATA", 8), situacao: "descontinuado" },
    produto("apice", "RUPTURA_CANDIDATA", 7),                                   // sem linha na BD: conta normal
    { ...produto("apice", "RUPTURA_CANDIDATA", 6), situacao: null },
    { ...produto("apice", "SUFICIENTE", 1, 20), situacao: "brinde" },
    produto("apice", "SUFICIENTE", 1, 20),
  ]);
  const r = resumoShopee(sh);
  assert.equal(r.status, "ok");
  if (r.status !== "ok") return;
  assert.equal(r.ruptura, 2, "so' as duas sem situacao");
  assert.equal(r.base, 3, "base sem os 3 de fora");
  assert.equal(r.rupturas.length, 2);
  assert.deepEqual(r.foraDaFila.map((t) => t.situacao).sort(), ["brinde", "descontinuado"]);
  assert.equal(r.rupturasCompletas, true);
  assert.equal(r.semVendedor, 2);
  assert.deepEqual(r.marcas.find((m) => m.marca === "apice"), { marca: "apice", base: 3, ruptura: 2 });

  const trunc = resumoShopee({ ...sh, truncado: true });
  if (trunc.status !== "ok") return;
  assert.equal(trunc.ruptura, 4, "lista truncada: nada sai do indicador (nao da' para saber)");
  assert.equal(trunc.foraDaFila.length, 0);
});

test("brinde e descontinuado no ML: mesma regra; blocos recolhidos so' com item", () => {
  const brinde = { ...inventario("kokeshi", "RUPTURA_CANDIDATA", 3), sku: "B1", situacao: "brinde" as const };
  const desc = { ...inventario("kokeshi", "RUPTURA_CANDIDATA", 2), sku: "D1", situacao: "descontinuado" as const };
  const normal = { ...inventario("kokeshi", "RUPTURA_CANDIDATA", 12), sku: "N1" };
  const mlr = resumoML(ml([brinde, desc, normal, inventario("kokeshi", "SUFICIENTE")], [marcaML("kokeshi", 4, 3)]));
  assert.equal(mlr.status, "ok");
  if (mlr.status !== "ok") return;
  assert.equal(mlr.ruptura, 1);
  assert.equal(mlr.base, 2);
  assert.deepEqual(mlr.rupturas.map((t) => t.codigo), ["N1"]);
  assert.deepEqual(mlr.marcas.find((m) => m.marca === "kokeshi"), { marca: "kokeshi", base: 2, ruptura: 1 });
  const blocos = blocosForaDaFila([mlr]);
  assert.deepEqual(blocos.map((b) => b.titulo), ["Brindes sem estoque no Full (1)", "Descontinuados sem estoque no Full (1)"]);
  assert.deepEqual(blocosForaDaFila([resumoML(ML)]), [], "sem brinde/descontinuado: nenhum bloco");
  assert.match(DICA_IMPACTO_FILA, /Brindes e descontinuados não entram nas contagens nem no impacto/);
});

test("API que ja' descontou (situacao_aplicada): o front separa a lista e NAO desconta de novo", () => {
  const sh = shopee([
    { ...produto("apice", "RUPTURA_CANDIDATA", 9), situacao: "brinde" },
    produto("apice", "RUPTURA_CANDIDATA", 7),
    produto("apice", "SUFICIENTE", 1, 20),
  ]);
  // numeros ja' SEM o brinde (o que a API manda com situacao_aplicada)
  sh.indicadores = { ...sh.indicadores, produtos_ruptura: 1, produtos_total: 2, situacao_aplicada: true, brindes_fora: 1 };
  const r = resumoShopee(sh);
  if (r.status !== "ok") throw new Error("esperava ok");
  assert.equal(r.ruptura, 1);
  assert.equal(r.base, 2, "nao subtrai o brinde duas vezes");
  assert.equal(r.rupturas.length, 1);
  assert.equal(r.foraDaFila.length, 1);
  assert.equal(r.rupturasCompletas, true);
});

test("lista truncada: N dos blocos vira '—' com o aviso; precedencia brinde > descontinuado vem resolvida da API", () => {
  const sh = { ...shopee([produto("apice", "RUPTURA_CANDIDATA", 9)]), truncado: true };
  const r = resumoShopee(sh);
  if (r.status !== "ok") throw new Error("esperava ok");
  assert.equal(r.listaTruncada, true);
  const blocos = blocosForaDaFila([r]);
  assert.deepEqual(blocos.map((b) => b.titulo), ["Brindes sem estoque no Full (—)", "Descontinuados sem estoque no Full (—)"]);
  assert.ok(blocos.every((b) => b.aviso === AVISO_LISTA_INCOMPLETA));
  assert.equal(AVISO_LISTA_INCOMPLETA, "lista incompleta: brindes ainda contados");
  assert.equal(RESUMO_BLOCO_FORA, "não entram nas contagens nem no impacto");
  // um SKU so' chega com UMA situacao (API: brinde > descontinuado): o item nunca aparece nos dois blocos
  const um = resumoShopee(shopee([{ ...produto("apice", "RUPTURA_CANDIDATA", 9), situacao: "brinde" }]));
  assert.deepEqual(blocosForaDaFila([um]).map((b) => b.situacao), ["brinde"]);
});

test("filtro canal x curva combinados: cada contagem reflete o outro filtro", () => {
  const its = [rup("ml", "K1"), rup("ml", "K3"), rup("shopee", "K2"), rup("shopee", "X9"), rup("shopee", "B1", { marca: "barbours" })];
  assert.deepEqual(contarCanais(its, ABC, "todas"), { todos: 5, ml: 2, shopee: 3 });
  assert.deepEqual(contarCanais(its, ABC, "aa_a"), { todos: 2, ml: 1, shopee: 1 }, "AA/A: K1 (ML) e K2 (Shopee)");
  assert.deepEqual(contarFiltros(filtrarCanal(its, "shopee"), ABC), { todas: 3, aa_a: 1, b: 1, c: 0, sem: 1 });
  assert.deepEqual(contarFiltros(filtrarCanal(its, "ml"), ABC), { todas: 2, aa_a: 1, b: 0, c: 1, sem: 0 });
  assert.equal(filtrarCanal(its, "todos").length, 5);
});

test("clique no bloco do heroi: canal + AA/A; filtros na URL vao e voltam", () => {
  assert.deepEqual(filtroDoBloco("shopee"), { canal: "shopee", curva: "aa_a" });
  const q = filtrosNaUrl("aba=visao", "ml", "aa_a");
  assert.equal(q, "?aba=visao&canal=ml&curva=aa_a", "mantem a aba");
  assert.deepEqual(lerFiltrosUrl(new URLSearchParams(q)), { canal: "ml", curva: "aa_a" });
  assert.equal(filtrosNaUrl(q.slice(1), "todos", "todas"), "?aba=visao", "padrao sai da URL");
  assert.equal(filtrosNaUrl("", "todos", "todas"), "");
  assert.deepEqual(lerFiltrosUrl(new URLSearchParams("canal=tiktok&curva=zz")), { canal: "todos", curva: "todas" }, "valor estranho = padrao");
  const tela = readFileSync(new URL("../app/full/VisaoGeralFull.tsx", import.meta.url), "utf-8");
  assert.ok(tela.includes("filtroDoBloco(c.canal)") && tela.includes("aplicar(canal, \"todas\", true)"), "heroi e faixa levam a fila");
  assert.ok(tela.includes("por marca →") && tela.includes("Limpar filtros"));
});

test("fila: Shopee com estoque do vendedor vai para o fim do grupo, abaixo de quem tem perda", () => {
  const canais: ResumoCanal[] = [resumoShopee(SHOPEE)];
  const abc: CurvaAbc = { ...ABC, curva_por_sku: { "kokeshi|S1": "AA", "kokeshi|S2": "AA", "kokeshi|S3": "AA", "kokeshi|S4": "A" } };
  const imp = impactoCom([], [
    itemImp("kokeshi", "S1", 0, { estoque_vendedor: 5 }),
    itemImp("kokeshi", "S2", 50, { estoque_vendedor: 0 }),
    itemImp("kokeshi", "S3", null, { estoque_vendedor: 0 }),
    itemImp("kokeshi", "S4", 900, { estoque_vendedor: 0 }),
  ]);
  assert.deepEqual(rankingRupturas(canais, imp, abc).map((t) => t.codigo), ["S2", "S3", "S1", "S4"],
    "AA: com perda, sem preco, e por ultimo quem a venda segue; o grupo A continua abaixo");
});

