/**
 * Cartao de CMV da Gerencial: numero e selos EXATOS da DRE (total de /api/v1/dre),
 * mes dito no cartao, ausencia = "Sem dado", nunca 0.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AVISO_CMV_EXTRAPOLADO, cartaoCmv, cartaoCmvNotas, linhaDre, linhasPorMarca, mesDoCmv, mesPorExtenso, LEGENDA_CMV, LEGENDA_NOTAS, NOTA_BLACK, NOTA_METODO, periodoCurto, textoDre, type CmvNotas } from "../src/lib/gerencial/cmv-card.ts";
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
  assert.ok(ler("app/page.tsx").includes("extra={<CmvCard channels={filters.channels} brands={filters.brands} dateFrom={filters.dateFrom} dateTo={filters.dateTo} compare={comparar} base={base} />}"));
  assert.ok((ler("app/globals.css").match(/--tc-kpi-cmv:/g) ?? []).length >= 2, "token claro e escuro");
});

// ---- CMV pelas notas no periodo do filtro (API /cmv-notas) ----

function nf(patch: Partial<CmvNotas> = {}): CmvNotas {
  return {
    date_from: "2026-11-01", date_to: "2026-11-25", ultima_nf: "2026-11-25", cobertura_minima: 0.98,
    cmv: 1, receita_com_custo: 1, receita: 1, cmv_pct: 27.44, cobertura: 0.9995, parcial: false, estimado_pct: 0.1335,
    dias_estimados: ["2026-11-24", "2026-11-25"], anterior_cmv_pct: 25.26,
    por_canal: [
      { canal: "tiktok", cmv: 1, receita_com_custo: 1, receita: 1, cmv_pct: 28.94, cobertura: 1, parcial: false, estimado_pct: 0.12 },
      { canal: "ml", cmv: 1, receita_com_custo: 1, receita: 1, cmv_pct: 26.46, cobertura: 1, parcial: false, estimado_pct: 0.18 },
      { canal: "shopee", cmv: 1, receita_com_custo: 1, receita: 1, cmv_pct: 25.78, cobertura: 1, parcial: false, estimado_pct: 0.12 },
    ],
    ...patch,
  };
}

test("periodo curto do filtro", () => {
  assert.equal(periodoCurto("2026-11-01", "2026-11-25"), "01–25/11");
  assert.equal(periodoCurto("2026-10-28", "2026-11-03"), "28/10–03/11");
  assert.equal(periodoCurto("2026-11-25", "2026-11-25"), "25/11");
});

test("notas: valor da API, periodo do filtro, 'inclui estimativa (X%)' e p.p. contra o anterior", () => {
  const c = cartaoCmvNotas(nf(), null, "2026-11-26");
  assert.equal(c.valor, "27,4%");
  // Sob o numero, so' "CMV estimado"; % estimado, metodo e aviso de Black no ⓘ.
  assert.equal(c.legenda, "CMV estimado");
  assert.equal(LEGENDA_CMV, "CMV estimado");
  assert.ok(c.dica.startsWith("13,4% do período estimado."));
  assert.ok(c.dica.includes(NOTA_METODO) && c.dica.includes(NOTA_BLACK) && c.dica.includes("ML 26,5%"));
  assert.equal(NOTA_METODO, "Método: notas fiscais; dias sem nota completa estimados pelo CMV % das notas dos últimos 3 dias × vendas.");
  assert.ok(NOTA_BLACK.includes("Black"));
  assert.ok(!c.dica.includes("notas de hoje"));
  assert.ok(Math.abs(c.deltaPp! - 2.18) < 1e-9);
  assert.equal(c.selo, null);
  // sem estimativa: so' o periodo; sem anterior: sem comparacao (nunca 0)
  const fechado = cartaoCmvNotas(nf({ estimado_pct: null, anterior_cmv_pct: null }), null, "2026-11-26");
  // sem dia estimado: "Pelas notas fiscais" e sem o aviso de Black
  assert.equal(fechado.legenda, "Pelas notas fiscais");
  assert.equal(LEGENDA_NOTAS, "Pelas notas fiscais");
  assert.ok(fechado.dica.startsWith("Período todo pelas notas, sem estimativa."));
  assert.ok(!fechado.dica.includes(NOTA_BLACK));
  assert.equal(fechado.deltaPp, null);
});

test("notas: Parcial abaixo de 98%; 'ate' = hoje avisa que a nota de hoje ainda entra", () => {
  const p = cartaoCmvNotas(nf({ parcial: true, cobertura: 0.97 }), null, "2026-11-26");
  assert.equal(p.parcial, true);
  assert.deepEqual(p.selo, { rotulo: "Parcial", tom: "atencao" });
  assert.ok(p.dica.includes("Receita sem custo: 3,0%"));
  assert.ok(cartaoCmvNotas(nf({ date_to: "2026-11-26" }), null, "2026-11-26").dica.includes("As notas de hoje ainda estão entrando."));
});

test("notas: sem CMV, o motivo real; nunca 0", () => {
  const s = cartaoCmvNotas(nf({ cmv_pct: null, receita: null, cobertura: null, estimado_pct: null, por_canal: [] }), null, "2026-11-26");
  assert.equal(s.valor, null);
  assert.equal(s.legenda, "Sem notas no recorte");
  const semCusto = cartaoCmvNotas(nf({ cmv_pct: null, cobertura: 0, por_canal: [] }), null, "2026-11-26");
  assert.equal(semCusto.legenda, "Sem notas com custo");
});

test("o mes fechado da DRE vai so' para o ⓘ (a 2a linha visivel saiu)", () => {
  const t = textoDre(resp({ ...EXTRAP, cobertura: 0.9978 }), "2026-10");
  assert.equal(t, "Mês fechado na DRE (Outubro/2026): 25,3%. Mês ainda aberto na DRE: fecha em 31/12/2026; o valor pode mudar com devoluções.");
  const linha = linhaDre(resp({ ...EXTRAP, cobertura: 0.9978 }), "2026-10");
  const d = cartaoCmvNotas(nf(), linha, "2026-11-26");
  assert.ok(d.dica.includes("Outubro fechado (DRE): 25,3%.") && d.legenda === "CMV estimado");
  const card = ler("src/components/gerencial/CmvCard.tsx");
  assert.ok(!card.includes('{fechado && <span className="block">{fechado}</span>}'), "a 2a linha da DRE saiu do cartao");
  assert.ok(card.includes("cartaoCmvNotas(estado.nf, fechado, hoje)"));
  assert.equal(textoDre(null, "2026-10"), null);
  assert.equal(linhaDre(resp({ ...EXTRAP, cobertura: 0.9978 }), "2026-10"), "Outubro fechado (DRE): 25,3%");
  assert.equal(linhaDre(null, "2026-10"), null);
  assert.equal(linhaDre(resp({ status: "snapshot_ausente" }), "2026-10"), null);
});

test("cartao segue o filtro (de/ate, comparativo, base) e nao faz conta", () => {
  const card = ler("src/components/gerencial/CmvCard.tsx");
  assert.ok(card.includes("/api/v1/performance/cmv-notas") && card.includes("Promise.allSettled"));
  for (const k of ['date_from: p.dateFrom', 'date_to: p.dateTo', 'q.set("compare", "true")', 'q.set("base", "realizados")']) assert.ok(card.includes(k), k);
  assert.ok(!card.includes("toFixed") && !card.includes("cmv / "), "nenhuma conta no front");
});

// ---- Detalhe do card: CMV por marca ----

test("detalhe por marca: ordem da API, p.p. vs anterior (sem anterior = sem pilula), estimado e Parcial", () => {
  const base = nf({
    por_marca: [
      { marca: "kokeshi", cmv: 1, receita_com_custo: 1, receita: 1_500_000, cmv_pct: 26.67, cobertura: 1, parcial: false, estimado_pct: 0.134, anterior_cmv_pct: 25.0 },
      { marca: "by-samia", cmv: 1, receita_com_custo: 1, receita: 100, cmv_pct: 33.33, cobertura: 0.9, parcial: true, estimado_pct: null, anterior_cmv_pct: null },
      { marca: "aua", cmv: null, receita_com_custo: null, receita: 50, cmv_pct: null, cobertura: 0, parcial: false, estimado_pct: null, anterior_cmv_pct: null },
    ],
  });
  const l = linhasPorMarca(base, true);
  assert.deepEqual(l.map((x) => x.marca), ["kokeshi", "by-samia", "aua"]);
  assert.equal(l[0].valor, "26,7%");
  assert.ok(Math.abs(l[0].deltaPp! - 1.67) < 1e-9);
  assert.equal(l[0].estimado, "13,4%");
  assert.equal(l[1].deltaPp, null);
  assert.equal(l[1].parcial, true);
  assert.equal(l[2].valor, null, "sem CMV: sem dado, nunca 0");
  // receita < R$ 50 mil: pilula apagada
  assert.deepEqual(l.map((x) => x.basePequena), [false, true, true]);
  assert.ok(linhasPorMarca(base, false).every((x) => x.deltaPp == null), "comparar desligado: sem pilula");
  assert.deepEqual(linhasPorMarca(nf(), true), [], "API anterior sem por_marca");
});

test("clique abre o detalhe por marca (padrao KpiDrilldownDialog) com 'Ver DRE' no rodape", () => {
  const card = ler("src/components/gerencial/CmvCard.tsx");
  assert.ok(card.includes("<KpiDrilldownDialog") && card.includes('title="CMV / receita por marca"'));
  assert.ok(card.includes("setAberto(true)") && card.includes("Ver DRE →"));
  assert.ok(card.includes('unidade: "pp"') && card.includes("menorMelhor: true") && card.includes("apagado: l.basePequena"));
  // topo no padrao do TACOS: total + chip do periodo + "Notas até DD/MM"; identidade no titulo
  assert.ok(card.includes("<NumeroAnimado texto={c?.valor") && card.includes("Notas até ${periodoCurto(estado.nf.ultima_nf"));
  assert.ok(card.includes('identidade="cmv"'));
  assert.ok(ler("src/components/ui/KpiTile.tsx").includes('cmv: { tinta: "text-kpi-cmv", borda: "border-kpi-cmv/30", ladrilho: "bg-kpi-cmv/10" }'));
  assert.ok(ler("tailwind.config.ts").includes('cmv: token("kpi-cmv")'));
  const linha = ler("src/components/drilldown/EvidenceRow.tsx");
  assert.ok(linha.includes('unidade === "pp" ? " p.p." : "%"') && linha.includes('"bg-raised text-ink-faint"'));
});
