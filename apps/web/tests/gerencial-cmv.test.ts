/**
 * Cartao de CMV da Gerencial: numero e selos EXATOS da DRE (total de /api/v1/dre),
 * mes dito no cartao, ausencia = "Sem dado", nunca 0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AVISO_CMV_EXTRAPOLADO, cartaoCmv, mesDoCmv, mesPorExtenso } from "../src/lib/gerencial/cmv-card.ts";
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
  assert.ok(card.includes('<span className="text-balance">'), "legenda equilibrada quando quebra em 2 linhas");
  assert.ok(card.includes('cor="rgb(var(--tc-kpi-cmv))"'));
  assert.ok(!/\b0%/.test(card), "nenhum 0 fabricado");
  assert.ok(card.includes('rotulo="CMV / receita"'), "rotulo sai em caixa alta: CMV / RECEITA");
  assert.ok(card.includes('"last:min-[480px]:max-xl:col-span-2"'), "5o cartao: linha inteira so' em 2 colunas; em xl, 5 numa linha");
  assert.ok(ler("app/page.tsx").includes("extra={<CmvCard channels={filters.channels} brands={filters.brands}"));
  assert.ok((ler("app/globals.css").match(/--tc-kpi-cmv:/g) ?? []).length >= 2, "token claro e escuro");
});
