// FULL-UNIFICADO-1 — rota unica /full: abas, redirecionamentos e as regras da
// Visao geral (manchete, %, ruptura por marca, top rupturas).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { abasVisiveis, hrefAba, resolverAba } from "../src/lib/full-abas.ts";
import {
  fmtPct,
  manchete,
  mediana,
  pct,
  resumoML,
  resumoShopee,
  rupturaPorMarca,
  seloFrescor,
  topRupturas,
  total,
  type ResumoCanal,
} from "../src/lib/full-visao-geral.ts";
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

test("manchete: numero, %, recorte por canal e vermelho so' com ruptura", () => {
  const m = manchete([resumoML(ML), resumoShopee(SHOPEE)]);
  assert.equal(m.texto, "3 produtos sem saldo no Full com demanda (37,5% do sortimento): 2 no ML (foto de 04/11) e 1 na Shopee (foto de 08/11)");
  assert.equal(m.critico, true);
});

test("manchete: sem ruptura nao e' critica", () => {
  const semRuptura = shopee([produto("apice", "SUFICIENTE")]);
  const m = manchete([resumoShopee(semRuptura)]);
  assert.equal(m.critico, false);
  assert.equal(m.texto, "Nenhum produto sem saldo no Full com demanda da Shopee");
});

test("manchete: canal fora e' dito, nunca somado como zero", () => {
  const m = manchete([resumoML(ML), { canal: "shopee", status: "erro", motivo: "caiu" }]);
  assert.equal(m.texto, "2 produtos sem saldo no Full com demanda do ML (50,0% do sortimento). Shopee: sem dado de estoque agora");
  assert.equal(manchete([{ canal: "ml", status: "erro", motivo: "" }, { canal: "shopee", status: "erro", motivo: "" }]).critico, false);
  assert.equal(manchete([resumoShopee(shopee([produto("apice", "RUPTURA_CANDIDATA")]))]).texto,
    "1 produto sem saldo no Full com demanda da Shopee (100,0% do sortimento)");
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

test("manchete: mesma data nao repete a foto", () => {
  const mesmaData = ml([inventario("kokeshi", "RUPTURA_CANDIDATA")], [marcaML("kokeshi", 1, 1)], {
    frescor: { ref_date: "2026-11-08", ultima_fotografia_disponivel: "2026-11-08", published_at: null, dias_desde_a_fotografia: 0, horas_desde_a_publicacao: null, publicacao_agendada: false },
  });
  assert.ok(!manchete([resumoML(mesmaData), resumoShopee(SHOPEE)]).texto.includes("foto de"));
});

test("selo de frescor diz canal, data e idade", () => {
  const r = resumoML(ML);
  if (r.status !== "ok") throw new Error("esperava ok");
  assert.equal(seloFrescor(r), "ML: foto de 04/11, 4 dias");
  assert.equal(r.frescorVelho, true);
  const s = resumoShopee(SHOPEE);
  if (s.status !== "ok") throw new Error("esperava ok");
  assert.equal(seloFrescor(s), "Shopee: foto de 08/11, hoje");
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
