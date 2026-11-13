/**
 * Regioes no padrao da Gerencial: 6 cartoes (GMV e Pedidos abrem detalhe por UF e por
 * marca), tom de cobertura pela regra existente, estados via StateBlock, formato da casa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { linhasPorMarca, linhasPorUf, tomDaCobertura, ufsForaDoTop, valorExato, ROTULO_UF } from "../src/lib/regioes-cartoes.ts";
import { fmtPctOrNA } from "../src/lib/regioes-format.ts";
import type { RegiaoBrandRow, RegiaoUfRow } from "../src/lib/api-client.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const uf = (u: string, gmv: number, orders: number) => ({ uf: u, gmv, orders }) as unknown as RegiaoUfRow;
const marca = (brand: string, label: string, marketplace: string, id: number, gmv: number, orders: number) => ({ brand, label, marketplace, marketplace_id: id, gmv, orders }) as unknown as RegiaoBrandRow;

test("cobertura de UF: a regra de severidade que ja' existia (ok / parcial / baixa), sem regra = ausente", () => {
  assert.equal(tomDaCobertura("ok"), "bom");
  assert.equal(tomDaCobertura("partial"), "atencao");
  assert.equal(tomDaCobertura("low"), "critico");
  assert.equal(tomDaCobertura("not_applicable"), "ausente");
  assert.equal(tomDaCobertura(null), "ausente");
});

test("detalhe por UF: so' UFs com venda, maior -> menor, top 10, participacao ANTES do absoluto", () => {
  const ufs = [uf("SP", 2_000_000, 100), uf("RJ", 1_000_000, 50), uf("MG", 0, 0), uf("XX", 500_000, 20), ...Array.from({ length: 12 }, (_, i) => uf(`U${i}`, 1000 + i, 1))];
  const l = linhasPorUf("gmv", ufs, 4_000_000);
  assert.equal(l.length, 10);
  assert.deepEqual(l.slice(0, 3).map((x) => [x.label, x.valor]), [["SP", "50,0% · R$ 2,00 mi"], ["RJ", "25,0% · R$ 1,00 mi"], ["UF não informada", "12,5% · R$ 500,0 mil"]]);
  assert.ok(!l.some((x) => x.label === "MG"), "UF sem venda nao entra no ranking");
  assert.equal(l[0].pct, 50);
  assert.equal(ufsForaDoTop(ufs, "gmv"), 15 - 10, "UFs com venda (SP, RJ, XX + 12) menos as 10 mostradas");
  assert.equal(ROTULO_UF("XX"), "UF não informada");
  assert.equal(linhasPorUf("pedidos", [uf("SP", 1, 1_234)], 2_000)[0].valor, "61,7% · 1,2 mil");
});

test("detalhe por marca e canal: maior -> menor, rotulo marca · canal, sem dado nunca vira zero", () => {
  const m = [marca("b", "KOKESHI", "Shopee", 2, 400, 4), marca("a", "BARBOURS", "Mercado Livre", 1, 600, 6)];
  const l = linhasPorMarca("gmv", m, 1_000);
  assert.deepEqual(l.map((x) => x.label), ["BARBOURS · Mercado Livre", "KOKESHI · Shopee"]);
  assert.equal(l[0].valor, "60,0% · R$ 600,00");
  const semDado = linhasPorMarca("gmv", [{ ...m[0], gmv: null } as unknown as RegiaoBrandRow], 1_000);
  assert.deepEqual([semDado[0].valor, semDado[0].ausente, semDado[0].pct], ["Sem dado", true, null]);
});

test("fmtPctOrNA: formato da casa (virgula), 'N/A' para ausencia (nunca 0%)", () => {
  assert.equal(fmtPctOrNA(null), "N/A");
  assert.equal(fmtPctOrNA(0), "0,0%");
  assert.equal(fmtPctOrNA(91), "91,0%");
});

test("cartoes: 4 na faixa (frete em Mais detalhes), so' as 7 identidades; so' GMV e Pedidos abrem detalhe; ausencia escrita", () => {
  const src = ler("src/components/regioes/RegioesCartoes.tsx");
  // ALVO-GRADE: sempre quatro CartaoIndicador; os dois de frete viram linhas em FreteRegioes
  assert.equal((src.match(/<CartaoIndicador\b/g) ?? []).length, 4);
  const usadas = [...src.matchAll(/(?:identidade[:=]\s*|cor\()"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(usadas.length >= 5);
  for (const id of new Set(usadas)) assert.ok(["gmv", "pedidos", "ticket", "ads", "roas", "prazo", "atendimento"].includes(id), id);
  assert.equal((src.match(/onAbrir=/g) ?? []).length, 2, "so' dois cartoes abrem detalhe");
  assert.ok(src.includes('onAbrir("gmv")') && src.includes('onAbrir("pedidos")'));
  // Revisor UX (#437): "100%" com pilula "Cobertura baixa" se lia como contradicao; o nivel fica no aviso da faixa
  assert.ok(!src.includes("pilula="), "UF preenchida sem pilula de cobertura");
  assert.ok(src.includes("valor={r?.gmv != null ? fmtBrlCurto(r.gmv) : null}") && src.includes('const AUSENTE = "sem dado no período"'), "ausencia = N/D com motivo, nunca zero");
  assert.ok(src.includes("rotulo={REGIONAL_GMV_LABEL}") && src.includes("rotulo={UF_FILL_LABEL}"), "rotulos do Gate DQ2 mantidos");
  assert.ok(src.includes('"N/A"') && src.includes("Shopee sem este dado"));
});

test("pagina de Regioes: sem KpiCard legado, dialogo unico, estados via StateBlock, formato da casa", () => {
  const pag = ler("app/regioes/page.tsx");
  assert.ok(!pag.includes("KpiCard") && !/\.toFixed\(/.test(pag) && !/\bfmtBrl\(/.test(pag) && !/\bfmtNumber\(/.test(pag));
  assert.equal((pag.match(/<KpiDrilldownDialog/g) ?? []).length, 1);
  assert.ok(pag.includes("icone={detalhe ?") && pag.includes("{detalhe && dataIsFresh && ("));
  assert.ok(pag.includes('tipo="erro"') && pag.includes('tipo="vazio"') && !pag.includes("bg-rose-50 border border-rose-200 rounded-2xl p-4"));
  assert.ok(pag.includes("<FaixaCarregando cartoes={TOTAL_DE_CARTOES_REGIOES}"));
  const mapa = ler("src/components/RegioesBrazilMap.tsx");
  assert.ok(!/toFixed\(|\bfmtBrl\(|\bfmtNumber\(/.test(mapa), "o mapa tambem no formato da casa");
});

test("topo do detalhe: valor EXATO em pt-BR (o cartao mostra o curto); sem resumo, nada", () => {
  assert.equal(valorExato("gmv", { gmv: 13_110_234.4, orders: 140_412 })?.split(String.fromCharCode(160)).join(" "), "R$ 13.110.234");
  assert.equal(valorExato("pedidos", { gmv: 1, orders: 140_412 }), "140.412");
  assert.equal(valorExato("gmv", null), null);
  const c = ler("src/components/regioes/RegioesDrilldownContent.tsx");
  assert.ok(c.includes("const exato = valorExato(chave, resumo);") && !c.includes("fmtBrlCurto(resumo"));
});

test("ⓘ do detalhe colado no ultimo selo (DrilldownContextLine dica); o ⓘ do cartao de GMV so' para canal com atraso", () => {
  const linha = ler("src/components/drilldown/DrilldownContextLine.tsx");
  assert.ok(linha.includes("dica?: ReactNode;") && linha.includes("inline-flex items-center gap-1.5"));
  for (const f of ["src/components/regioes/RegioesDrilldownContent.tsx", "src/components/canais/KpiCanalDrilldownContent.tsx", "src/components/qualidade/QualidadeDrilldownContent.tsx"]) {
    assert.ok(/<DrilldownContextLine[^>]*dica={/.test(ler(f)), f);
  }
  const pag = ler("app/regioes/page.tsx");
  assert.ok(pag.includes("regionalScope && canaisComAtraso.length > 0") && !pag.includes("Escopo: ${regionalScope"), "escopo ja' esta no selo; o ⓘ do cartao so' diz o que e' novo");
});
