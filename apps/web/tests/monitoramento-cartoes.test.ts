/**
 * Monitoramento de precos no padrao da Gerencial: os 6 KPIs e os 3 de qualidade viram KpiTile
 * gerencial (so' as 7 identidades), continuam FILTRANDO a fila, e canal nao publicado segue
 * mostrando travessao (ausencia nunca vira zero).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PAG = readFileSync(new URL("../app/monitoramento-preco/page.tsx", import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const KPIS = PAG.split('aria-label="Indicadores"')[1].split("</section>")[0];

test("KPIs e qualidade: KpiTile gerencial que filtra a fila (nao abre dialogo), com esqueleto padrao", () => {
  assert.equal((KPIS.match(/<KpiTile/g) ?? []).length, 2, "um para os 6 KPIs e um para os 3 de qualidade (mapeados)");
  assert.equal((KPIS.match(/variante="gerencial"/g) ?? []).length, 2);
  assert.equal((KPIS.match(/acaoFalada="ver na fila"/g) ?? []).length, 2);
  assert.ok(KPIS.includes("ativo={k.status ? status === k.status : undefined}"));
  assert.ok(KPIS.includes("<FaixaCarregando cartoes={6}") && !KPIS.includes("animate-pulse"));
});

test("canal nao publicado: travessao nos nove cartoes, nunca a contagem zerada do envelope", () => {
  assert.equal((KPIS.match(/canalIndisponivel \? INDISPONIVEL : fmtContagem\(k\.valor\)/g) ?? []).length, 2);
});

test("so' as 7 identidades existentes, uma por cartao", () => {
  const mapa = PAG.split("const VISUAL_KPI")[1].split("};")[0];
  const usadas = [...mapa.matchAll(/identidade: "([a-z]+)"/g)].map((m) => m[1]);
  assert.equal(usadas.length, 9);
  for (const u of usadas) assert.ok(["gmv", "pedidos", "ticket", "ads", "roas", "prazo", "atendimento"].includes(u), u);
});

test("estados da tabela no padrao: StateBlock + RetryButton, mesmos textos", () => {
  for (const t of ['tipo="carregando"', 'tipo="erro"', 'tipo="indisponivel"', 'tipo="vazio"', "<RetryButton", "mensagemDeFalha(erroStatus)"]) assert.ok(PAG.includes(t), t);
});
