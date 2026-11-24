import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compararPerda, indoBem, intensidade, matrizOndeDoi, META_FULL, statusMeta, veredito } from "../src/lib/full-veredito.ts";
import type { CanalImpactoOk, ImpactoAnterior, ImpactoRuptura, MarcaImpacto } from "../src/lib/full-visao-geral.ts";

const sp = (t: string | null | undefined) => t?.replace(/ /g, " ") ?? null;

function marca(brand: string, perda: number | null, extra: Partial<MarcaImpacto> = {}): MarcaImpacto {
  return { brand, rupturas: 1, sem_preco: 0, perda_dia: perda, perda_dia_sem_vendedor: perda, gmv_full_dia: null, pct_gmv_full: null, pct_gmv_full_sem_vendedor: null, ...extra };
}
function canal(c: "ml" | "shopee", perda: number | null, marcas: MarcaImpacto[], extra: Partial<CanalImpactoOk> = {}): CanalImpactoOk {
  return {
    canal: c, status: "ok", ref_date: "2026-11-24", rupturas: 3, sem_preco: 0, preco_fallback: 0, sem_estoque_vendedor: null,
    perda_dia: perda, perda_dia_sem_vendedor: perda, gmv_full_dia: null, dias_gmv: 28, pct_gmv_full: null,
    pct_gmv_full_sem_vendedor: null, motivo_pct: null, marcas, itens: [], ...extra,
  };
}
const ant = (perda: number): ImpactoAnterior => ({ ref_date: "2026-11-17", rupturas: 2, sem_estoque_vendedor: null, perda_dia: perda, perda_dia_sem_vendedor: perda, dias_gmv: 28, pct_gmv_full: null, pct_gmv_full_sem_vendedor: null, motivo_pct: null });

const IMP: ImpactoRuptura = {
  janela_gmv_dias: 28, limitacoes: [],
  ml: canal("ml", 10000, [marca("kokeshi", 9200), marca("lescent", 800), marca("barbours", 0)]),
  shopee: canal("shopee", 1500, [marca("barbours", 1500), marca("lescent", 0, { perda_dia: 300 }), marca("rituaria", null, { rupturas: null })]),
};

test("veredito: um valor por canal, lado a lado (nunca somado), concentração no canal que mais perde e AA/A da Shopee", () => {
  const v = veredito(IMP, null, 3)!;
  assert.equal(sp(v.titulo), "Perdendo R$ 10 mil/dia no ML e R$ 1,5 mil/dia na Shopee por ruptura no Full");
  assert.equal(v.perda, 10000);
  assert.equal(v.linha, "92% da perda do ML está na KOKESHI · 3 produtos AA/A zerados na Shopee");
  assert.deepEqual(v.comparacoes, [], "sem a 2a chamada, sem comparação (nunca 'igual')");
  const pior = { ...IMP, ml: { ...(IMP.ml as CanalImpactoOk), anterior: ant(8000) } };
  assert.deepEqual(veredito(IMP, pior, 0)!.comparacoes.map((c) => [c.canal, c.cmp.tom]), [["ml", "crit"]]);
  // ML fora: so' a Shopee
  const soShopee = veredito({ ...IMP, ml: { canal: "ml", status: "unavailable", motivo: "x" } }, null, 0)!;
  assert.equal(sp(soShopee.titulo), "Perdendo R$ 1,5 mil/dia na Shopee por ruptura no Full");
  assert.equal(soShopee.linha, "100% da perda da Shopee está na BARBOURS");
  assert.equal(veredito(null, null, null), null);
});

test("comparação com a foto anterior: pior/melhor com a data e o valor de antes", () => {
  const pior = { ...IMP, ml: { ...(IMP.ml as CanalImpactoOk), anterior: ant(8000) } };
  assert.equal(sp(compararPerda("ml", IMP, pior)?.texto), "pior que em 17/11 (R$ 8 mil/dia)");
  assert.equal(compararPerda("ml", IMP, pior)?.tom, "crit");
  const melhor = { ...IMP, ml: { ...(IMP.ml as CanalImpactoOk), anterior: ant(12000) } };
  assert.equal(compararPerda("ml", IMP, melhor)?.tom, "ok");
  const outraFoto = { ...melhor, ml: { ...(melhor.ml as CanalImpactoOk), ref_date: "2026-11-25" } };
  assert.equal(compararPerda("ml", IMP, outraFoto), null, "foto atual diferente: sem comparação");
});

test("metas: menor é melhor; ausência sem selo", () => {
  assert.deepEqual(statusMeta(1999, META_FULL.perdaDia), { texto: "Na meta", tom: "ok" });
  assert.deepEqual(statusMeta(2001, META_FULL.perdaDia), { texto: "Acima da meta", tom: "crit" });
  assert.deepEqual(statusMeta(0, META_FULL.aaA), { texto: "Na meta", tom: "ok" });
  assert.equal(statusMeta(null, META_FULL.ruptura), null);
});

test("matriz Onde dói: marca x canal, ausência é '—' com motivo, vendedor cobre = 'sem perda'", () => {
  const m = matrizOndeDoi(IMP)!;
  assert.deepEqual(m.canais, ["ml", "shopee"]);
  assert.deepEqual(m.linhas.map((l) => l.marca), ["kokeshi", "barbours", "lescent", "rituaria"]);
  assert.equal(m.max, 9200);
  const rit = m.linhas.find((l) => l.marca === "rituaria")!;
  assert.equal(rit.celulas.ml, undefined, "marca sem conta no canal: sem célula");
  assert.deepEqual(rit.celulas.shopee, { valor: null, texto: "—", motivo: "sem fotografia no dia" });
  assert.equal(m.linhas.find((l) => l.marca === "lescent")!.celulas.shopee!.texto, "sem perda");
  assert.equal(intensidade(9200, m.max), 1);
  assert.equal(intensidade(0, m.max), 0);
  assert.equal(intensidade(null, m.max), 0);
  assert.equal(matrizOndeDoi(null), null);
});

test("indo bem: só o que foi medido e está bom", () => {
  const melhor = { ...IMP, ml: { ...(IMP.ml as CanalImpactoOk), anterior: ant(12000) } };
  const xs = indoBem({ impacto: IMP, comAnterior: melhor, ruptura: 0.031, aaA: 0 }).map((x) => sp(x));
  assert.deepEqual(xs, [
    "Ruptura com demanda em 3,1% (meta ≤ 5,0%)",
    "Nenhum produto AA/A sem estoque no Full",
    "ML: perda melhor que em 17/11 (R$ 12 mil/dia)",
  ]);
  // ML dentro da meta e marca sem perda em todos os canais medidos
  const leve: ImpactoRuptura = { ...IMP, ml: canal("ml", 1200, [marca("kokeshi", 1200), marca("barbours", 0)]), shopee: canal("shopee", 0, [marca("barbours", 0)]) };
  assert.deepEqual(indoBem({ impacto: leve, comAnterior: null, ruptura: null, aaA: null }).map((x) => sp(x)), [
    "Venda perdida no ML dentro da meta (≤ R$ 2 mil/dia)",
    "BARBOURS: sem perda por ruptura",
  ]);
  assert.deepEqual(indoBem({ impacto: null, comAnterior: null, ruptura: 0.2, aaA: 4 }), []);
});

test("tela: veredito no topo, 4 KPIs com meta, Onde dói, Top 3 ações e Indo bem", () => {
  const src = readFileSync(new URL("../app/full/VisaoGeralFull.tsx", import.meta.url), "utf-8");
  for (const t of ["Venda perdida/dia · ML", "AA/A sem estoque", "Ruptura com demanda", "Impacto · Shopee", "Onde dói (R$/dia perdido)", "Top 3 ações", "Indo bem"]) {
    assert.ok(src.includes(t), t);
  }
  assert.ok(src.indexOf("veredito(") < src.indexOf("<CartaoIndicador"), "veredito antes dos KPIs");
  assert.ok(!src.includes("<VisaoRapidaEstoque"), "a matriz substitui a visão rápida (sem redundância)");
  assert.ok(src.includes("topo.slice(0, 3)") || src.includes(".slice(0, 3)"));
});
