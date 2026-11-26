/**
 * Cartao de CMV da Gerencial: numero e selos EXATOS da DRE (total de /api/v1/dre),
 * mes dito no cartao, ausencia = "Sem dado", nunca 0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AVISO_CMV_EXTRAPOLADO, cartaoCmv, cartaoCmvNotas, linhaDre, mesDoCmv, mesPorExtenso, textoDre, type CmvNotas } from "../src/lib/gerencial/cmv-card.ts";
import type { DreResponse } from "../src/lib/dre.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

function resp(cmv: Record<string, unknown> | null, extra: Record<string, unknown> = {}): DreResponse {
  const total = cmv && {
    classificacao: "PREVIA",
    previa: true,
    fecha_em: "2026-12-31",
    componentes: { cmv: { valor: null, pct_receita: null, status: "indisponivel", origem: null, ...cmv } },
    ...extra,
  };
  return { periodo: { meses: ["2026-10"] }, regras: { cmv_cobertura_minima: 0.98 }, total } as unknown as DreResponse;
}

test("mes do CMV: fim do periodo; mes aberto cai no anterior ao corrente", () => {
  assert.equal(mesDoCmv("2026-10-31", "2026-11-26"), "2026-10");
  assert.equal(mesDoCmv("2026-11-26", "2026-11-26"), "2026-10");
  assert.equal(mesDoCmv("2027-01-10", "2027-01-10"), "2026-12");
  assert.equal(mesDoCmv("2026-09-15", "2026-11-26"), "2026-09");
});

const EXTRAP = { valor: 5921979.97, pct_receita: 25.32, status: "parcial", origem: "extrapolado", cobertura_rotulo: "97,2% realizado" };

test("subtitulo: mes por extenso da competencia devolvida; 'último mês com custo' so' quando caiu no mes fechado", () => {
  assert.equal(mesPorExtenso("2026-10"), "Outubro/2026");
  assert.equal(mesPorExtenso("2027-03"), "Março/2027");
  assert.equal(cartaoCmv(resp({ ...EXTRAP, cobertura: 0.9978 }), "2026-10", true).legenda, "Outubro/2026 · último mês com custo");
  assert.equal(cartaoCmv(resp({ ...EXTRAP, cobertura: 0.9978 }), "2026-10", false).legenda, "Outubro/2026");
});

test("prévia sai do subtitulo e vai pro ⓘ com a data de fechamento da DRE", () => {
  const c = cartaoCmv(resp({ ...EXTRAP, cobertura: 0.9978 }), "2026-10", true);
  assert.ok(!/pr[ée]via/i.test(c.legenda));
  assert.ok(c.dica.includes("Mês ainda aberto na DRE: fecha em 31/12/2026; o valor pode mudar com devoluções."));
  // sem data na resposta: a frase sai sem data, nada inventado
  const semData = cartaoCmv(resp({ ...EXTRAP, cobertura: 0.9978 }, { fecha_em: null }), "2026-10");
  assert.ok(semData.dica.includes("Mês ainda aberto na DRE; o valor pode mudar com devoluções."));
  // mes fechado: nada de aviso
  const fechado = cartaoCmv(resp({ ...EXTRAP, cobertura: 0.9978 }, { classificacao: "COMPLETA", previa: false }), "2026-10");
  assert.ok(!fechado.dica.includes("Mês ainda aberto"));
});

test("selo Extrapolado so' com cobertura abaixo de regras.cmv_cobertura_minima", () => {
  const alto = cartaoCmv(resp({ ...EXTRAP, cobertura: 0.9978 }), "2026-10");
  assert.equal(alto.valor, "25,3%");
  assert.equal(alto.selo, null);
  assert.ok(alto.dica.includes(AVISO_CMV_EXTRAPOLADO) && alto.dica.includes("97,2% realizado"));
  assert.equal(cartaoCmv(resp({ ...EXTRAP, cobertura: 0.98 }), "2026-10").selo, null);
  assert.deepEqual(cartaoCmv(resp({ ...EXTRAP, cobertura: 0.95 }), "2026-10").selo, { rotulo: "Extrapolado", tom: "atencao" });
  // cobertura nao publicada: nao da' para afirmar que cobre, o selo fica
  assert.equal(cartaoCmv(resp({ ...EXTRAP, cobertura: null }), "2026-10").selo?.rotulo, "Extrapolado");
});

test("demais selos da DRE seguem iguais; realizado nao tem selo", () => {
  assert.equal(cartaoCmv(resp({ valor: 10, pct_receita: 20, status: "provisorio", origem: "parcial" }), "2026-10").selo?.rotulo, "Parcial");
  assert.equal(cartaoCmv(resp({ valor: 10, pct_receita: 20, status: "provisorio" }), "2026-10").selo?.rotulo, "Provisório");
  assert.equal(cartaoCmv(resp({ valor: 10, pct_receita: 20, status: "disponivel", origem: "realizado" }), "2026-10").selo, null);
});

test("sem CMV (insumo nao publicado ou recorte vazio) = sem dado, nunca 0", () => {
  const a = cartaoCmv(resp({ status: "snapshot_ausente" }), "2026-11", true);
  assert.equal(a.valor, null);
  assert.equal(a.legenda, "Outubro/2026 · insumo não publicado"); // minuscula depois do "·"
  const b = cartaoCmv(resp(null), "2026-11");
  assert.equal(b.valor, null);
  assert.equal(b.legenda, "Outubro/2026 · sem receita no recorte");
});

test("cartao usa a chamada da DRE, sem rota nova, e entra na faixa da Gerencial", () => {
  const card = ler("src/components/gerencial/CmvCard.tsx");
  assert.ok(card.includes('from "@/lib/dre-api"') && card.includes("fetchDre("));
  assert.ok(card.includes('<span className="block text-balance">'), "legenda equilibrada quando quebra em 2 linhas");
  assert.ok(card.includes('cor="rgb(var(--tc-kpi-cmv))"'));
  assert.ok(!/\b0%/.test(card), "nenhum 0 fabricado");
  assert.ok(card.includes('rotulo="CMV / receita"'), "rotulo sai em caixa alta: CMV / RECEITA");
  assert.ok(card.includes('"last:min-[480px]:max-xl:col-span-2"'), "5o cartao: linha inteira so' em 2 colunas; em xl, 5 numa linha");
  assert.ok(ler("app/page.tsx").includes("extra={<CmvCard channels={filters.channels} brands={filters.brands}"));
  assert.ok((ler("app/globals.css").match(/--tc-kpi-cmv:/g) ?? []).length >= 2, "token claro e escuro");
});

// ---- CMV do mes ate ontem pelas notas (API /cmv-notas) ----

function nf(patch: Partial<CmvNotas> = {}): CmvNotas {
  return {
    mes: "2026-11", ate: "2026-11-25", carregado_em: "2026-11-26T10:01", cobertura_minima: 0.98,
    cmv: 8419394.4, receita_com_custo: 27361226.59, receita: 27962662.76, cmv_pct: 30.77, cobertura: 0.9785, parcial: true,
    por_canal: [
      { canal: "tiktok", cmv: 1, receita_com_custo: 1, receita: 1, cmv_pct: 34.98, cobertura: 0.9997, parcial: false },
      { canal: "ml", cmv: 1, receita_com_custo: 1, receita: 1, cmv_pct: 25.46, cobertura: 0.9021, parcial: true },
      { canal: "shopee", cmv: 1, receita_com_custo: 1, receita: 1, cmv_pct: 27.28, cobertura: 0.9994, parcial: false },
    ],
    ...patch,
  };
}

test("notas: valor da API, subtitulo 'Novembro até 25/11 (pelas notas)', selo Parcial pela cobertura", () => {
  const c = cartaoCmvNotas(nf(), null);
  assert.equal(c.valor, "30,8%");
  assert.equal(c.legenda, "Novembro até 25/11 (pelas notas)");
  assert.deepEqual(c.selo, { rotulo: "Parcial", tom: "atencao" });
  assert.ok(c.dica.includes("Receita sem custo: 2,1%"));
  assert.ok(c.dica.includes("ML 25,5% (sem custo 9,8%)") && c.dica.includes("Shopee 27,3%") && c.dica.includes("TikTok 35,0%"));
  assert.equal(cartaoCmvNotas(nf({ parcial: false, cobertura: 0.99 }), null).selo, null);
});

test("notas: sem dado = 'sem dado', nunca 0; canal unico sem lista por canal", () => {
  const s = cartaoCmvNotas(nf({ cmv_pct: null, cobertura: null, parcial: false, ate: null, receita: null, por_canal: [] }), null);
  assert.equal(s.valor, null);
  assert.equal(s.legenda, "Novembro · sem notas no recorte");
  // ha' nota, mas nenhuma com custo: o motivo diz isso
  const semCusto = cartaoCmvNotas(nf({ cmv_pct: null, cmv: null, receita_com_custo: null, cobertura: 0, parcial: false, por_canal: [] }), null);
  assert.equal(semCusto.legenda, "Novembro · sem notas com custo");
  const um = cartaoCmvNotas(nf({ por_canal: [nf().por_canal[2]] }), null);
  assert.ok(!um.dica.includes("Shopee 27,3%"));
});

test("o mes fechado da DRE vai para o ⓘ, com a data de fechamento", () => {
  const t = textoDre(resp({ ...EXTRAP, cobertura: 0.9978 }), "2026-10");
  assert.equal(t, "Mês fechado na DRE (Outubro/2026): 25,3%. Mês ainda aberto na DRE: fecha em 31/12/2026; o valor pode mudar com devoluções.");
  assert.ok(cartaoCmvNotas(nf(), t).dica.endsWith(t!));
  assert.equal(textoDre(null, "2026-10"), null);
  // 2a linha visivel: mes e valor da DRE; sem DRE ou sem valor, some
  assert.equal(linhaDre(resp({ ...EXTRAP, cobertura: 0.9978 }), "2026-10"), "Outubro fechado (DRE): 25,3%");
  assert.equal(linhaDre(null, "2026-10"), null);
  assert.equal(linhaDre(resp({ status: "snapshot_ausente" }), "2026-10"), null);
});

test("cartao le a rota das notas e a DRE so' para o ⓘ", () => {
  const card = ler("src/components/gerencial/CmvCard.tsx");
  assert.ok(card.includes("/api/v1/performance/cmv-notas") && card.includes("Promise.allSettled"));
  assert.ok(!card.includes("toFixed") && !card.includes("cmv / "), "nenhuma conta no front");
});
