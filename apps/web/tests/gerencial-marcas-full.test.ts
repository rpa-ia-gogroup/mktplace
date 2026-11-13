/**
 * Pedido da Nathalia (13/11): o cartao Marcas da Gerencial volta a mostrar
 * Full e Sem Full em cada marca, sem clicar, mantendo a barra da meta.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = readFileSync(join(import.meta.dirname, "../src/components/gerencial/MarcasMeta.tsx"), "utf8");
const LINHA = SRC.split("</Linha>")[1]?.split("</li>")[0] ?? "";

test("Marcas: Full e Sem Full (com %) na linha de cada marca, na escala da barra da meta", () => {
  assert.match(LINHA, /<BarraFull rotulo="Full" pct=\{pctFull\}[^>]*escala=\{escala\}/);
  assert.match(LINHA, /<BarraFull rotulo="Sem Full" pct=\{100 - pctFull\}[^>]*escala=\{escala\}/);
  assert.match(SRC, /tc-barra absolute inset-y-0 left-0 rounded-full bg-gradient-to-r/, "a barra da meta continua");
});

test("Marcas: venda sem medida de envio aparece como linha propria, nunca calada", () => {
  assert.match(LINHA, /soma\(d\.semDado\) > 0 && \(\s*<BarraFull rotulo="Sem dado de envio"/);
});
