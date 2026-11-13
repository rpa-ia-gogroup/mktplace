/**
 * Pedido da Nathalia (13/11): o cartao Marcas da Gerencial volta a mostrar
 * Full e Sem Full em cada marca, sem clicar, mantendo a barra da meta.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const SRC = readFileSync(join(import.meta.dirname, "../src/components/gerencial/MarcasMeta.tsx"), "utf8");

test("Marcas: Full e Sem Full na linha de cada marca, na escala da barra da meta", () => {
  const linha = SRC.split("</Linha>")[1]?.split("</li>")[0] ?? "";
  assert.match(linha, /<BarraFull rotulo="Full" partes=\{d\.full\}[^>]*escala=\{escala\}/);
  assert.match(linha, /<BarraFull rotulo="Sem Full" partes=\{d\.semFull\}[^>]*escala=\{escala\}/);
  assert.match(SRC, /tc-barra absolute inset-y-0 left-0 rounded-full bg-gradient-to-r/, "a barra da meta continua");
});
