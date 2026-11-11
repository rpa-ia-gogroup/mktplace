/**
 * Produtos: o Pareto A/B/C/D (3 abas) no padrao da Gerencial. Cada card continua um
 * FILTRO da tabela (toggle), nao abre dialogo; ausencia nunca vira venda zero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { toggleBucketSelection } from "../src/lib/produtos-tab-transition.ts";
import { fmtBrlCurto, fmtPctSimples } from "../src/lib/formatters.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const SRC = ler("src/components/ProductParetoSummary.tsx");

test("cards A/B/C/D: KpiTile gerencial que FILTRA (ativo + aria-pressed), nao abre dialogo", () => {
  assert.ok(SRC.includes('variante="gerencial"') && SRC.includes('identidade="gmv"'), "identidade unica gmv (composicao do GMV; cor nao diz bom/ruim)");
  assert.ok(SRC.includes("ativo={activeBucket === b.bucket}") && SRC.includes('acaoFalada="filtrar a tabela"'));
  assert.ok(SRC.includes("onAbrir={() => onSelectBucket(toggleBucketSelection(activeBucket, b.bucket))}"));
  assert.ok(!/KpiDrilldownDialog|aria-haspopup/.test(SRC), "filtro, nao modal");
  // o toggle continua o mesmo: clicar de novo no ativo remove o filtro
  assert.equal(toggleBucketSelection("A_top50", "A_top50"), null);
  assert.equal(toggleBucketSelection(null, "B_next30"), "B_next30");
});

test("cores: so' a identidade gmv; sem as cores de estado antigas por faixa (verde/ciano/ambar/rosa)", () => {
  assert.ok(!/bg-emerald|bg-cyan|bg-amber|bg-rose|text-emerald|text-rose/.test(SRC));
  for (const k of ["A_top50", "B_next30", "C_next15", "D_tail"]) assert.ok(SRC.includes(k), k);
});

test("formato da casa: 'R$ 3,65 mi', '50,0%'; descricao da faixa vai para o ⓘ (menos legendas)", () => {
  assert.equal(fmtBrlCurto(3_650_000), "R$ 3,65 mi");
  assert.equal(fmtBrlCurto(365_000), "R$ 365,0 mil");
  assert.equal(fmtPctSimples(50), "50,0%");
  assert.ok(!SRC.includes("toFixed(") && !/R\$ \$\{/.test(SRC), "sem K/M com ponto");
  assert.ok(SRC.includes("ajuda={<InfoDica emControle texto={b.description} />}") && SRC.includes("`Curva ${b.label}`"));
});

test("ausencia nunca vira venda zero; esqueleto no formato do cartao; piso de 12px", () => {
  assert.ok(SRC.includes('data-testid="pareto-unavailable"') && SRC.includes('<StateBlock compacto tipo="indisponivel" titulo={unavailableReason} />'));
  assert.ok(SRC.includes("<FaixaCarregando cartoes={4}"));
  assert.ok(!SRC.includes("text-[11px]"), "piso tipografico de 12px");
  assert.ok(!SRC.includes("animate-pulse") && !SRC.includes("bg-slate"), "sem esqueleto/paleta legados");
});
