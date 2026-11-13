/**
 * Residuo da CX no padrao da Gerencial: os cartoes de taxa do Mercado Livre abrem o detalhe por
 * marca (sem clique antes) e os cartoes do CxResumo usam o `onAbrir` do KpiTile em vez de um
 * <button> por fora.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const ML = ler("app/cx/CxMercadoLivre.tsx");
const RESUMO = ler("src/components/gerencial/CxResumo.tsx");

test("CX ML: cartoes de taxa abrem o detalhe por marca; reembolso sem fonte nao abre", () => {
  assert.ok(ML.includes("onAbrir={r.taxa[i] != null ? () => abrir(i) : undefined}"), "so' abre com valor");
  assert.ok(ML.includes("<DetalheTaxa") && ML.includes("VISUAL_TAXA[taxaAberta].identidade"), "o detalhe herda cor e icone");
  assert.ok(!/reclamacao: \{ identidade/.test(ML), "Reclamacao sem cartao: sem detalhe orfao (revisao da Operacao, #426)");
  const SHOPEE = ler("app/cx/CxConteudo.tsx");
  assert.ok(SHOPEE.includes('contactRateAjuda={notasDoTile(r, "contactRate", dias)') && SHOPEE.includes("{contactRateDelta}"), "Contact rate: ressalva semChat no ⓘ e a variacao de volta");
  assert.ok(SHOPEE.includes("heroi.contexto].filter(Boolean)"), "Taxa de resposta: a fila do chat sempre na legenda");
  const reembolso = ML.slice(ML.indexOf("sem fonte: o ML ainda nao coleta reembolso"));
  assert.ok(!reembolso.slice(0, reembolso.indexOf("/>")).includes("onAbrir"), "reembolso sem fonte nao abre nada");
});

test("CxResumo: o cartao abre pelo onAbrir do KpiTile, sem <button> por fora", () => {
  const card = RESUMO.slice(RESUMO.indexOf("const card = ("), RESUMO.indexOf("return (", RESUMO.indexOf("const card = (")));
  assert.ok(card.includes("onAbrir={() => abrir(i)}"));
  assert.ok(!card.includes("<button"), "sem botao externo");
});
