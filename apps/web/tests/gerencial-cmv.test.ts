/**
 * Cartao de CMV da Gerencial: numero e selos EXATOS da DRE (total de /api/v1/dre),
 * mes dito no cartao, ausencia = "Sem dado", nunca 0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AVISO_CMV_EXTRAPOLADO, cartaoCmv, mesDoCmv } from "../src/lib/gerencial/cmv-card.ts";
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
  return { periodo: { meses: ["2026-10"] }, total } as unknown as DreResponse;
}

test("mes do CMV: fim do periodo; mes aberto cai no anterior ao corrente", () => {
  assert.equal(mesDoCmv("2026-10-31", "2026-11-26"), "2026-10");
  assert.equal(mesDoCmv("2026-11-26", "2026-11-26"), "2026-10");
  assert.equal(mesDoCmv("2027-01-10", "2027-01-10"), "2026-12");
  assert.equal(mesDoCmv("2026-09-15", "2026-11-26"), "2026-09");
});

test("CMV extrapolado: pct_receita da DRE, selo Extrapolado, previa e aviso no ⓘ", () => {
  const c = cartaoCmv(
    resp({ valor: 5921979.97, pct_receita: 25.32, status: "parcial", origem: "extrapolado", cobertura_rotulo: "97,2% realizado" }),
    "2026-10",
  );
  assert.equal(c.valor, "25,3%");
  assert.equal(c.competencia, "Competência 10/2026");
  assert.deepEqual(c.selo, { rotulo: "Extrapolado", tom: "atencao" });
  assert.equal(c.previa, "Prévia · fecha em 31/12/2026");
  assert.ok(c.dica.includes(AVISO_CMV_EXTRAPOLADO) && c.dica.includes("97,2% realizado"));
});

test("CMV provisorio leva o selo da DRE; realizado nao tem selo", () => {
  assert.equal(cartaoCmv(resp({ valor: 10, pct_receita: 20, status: "provisorio", origem: "parcial" }), "2026-10").selo?.rotulo, "Parcial");
  assert.equal(cartaoCmv(resp({ valor: 10, pct_receita: 20, status: "provisorio" }), "2026-10").selo?.rotulo, "Provisório");
  assert.equal(cartaoCmv(resp({ valor: 10, pct_receita: 20, status: "disponivel", origem: "realizado" }), "2026-10").selo, null);
});

test("sem CMV (insumo nao publicado ou recorte vazio) = sem dado, nunca 0", () => {
  const a = cartaoCmv(resp({ status: "snapshot_ausente" }), "2026-11");
  assert.equal(a.valor, null);
  assert.equal(a.semDado, "Insumo não publicado");
  const b = cartaoCmv(resp(null), "2026-11");
  assert.equal(b.valor, null);
  assert.equal(b.semDado, "Sem dado");
});

test("cartao usa a chamada da DRE, sem rota nova, e entra na faixa da Gerencial", () => {
  const card = ler("src/components/gerencial/CmvCard.tsx");
  assert.ok(card.includes('from "@/lib/dre-api"') && card.includes("fetchDre("));
  assert.ok(card.includes('cor="rgb(var(--tc-kpi-cmv))"'));
  assert.ok(!/\b0%/.test(card), "nenhum 0 fabricado");
  assert.ok(ler("app/page.tsx").includes("extra={<CmvCard channels={filters.channels} brands={filters.brands}"));
  assert.ok((ler("app/globals.css").match(/--tc-kpi-cmv:/g) ?? []).length >= 2, "token claro e escuro");
});
