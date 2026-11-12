import { test } from "node:test";
import assert from "node:assert/strict";
import { REALIZADOS, SO_PAGOS, notaBase, parseBase } from "../src/lib/base-vendas.ts";

test("parseBase: so' 'realizados' sai do padrao pagos", () => {
  assert.equal(parseBase("realizados"), "realizados");
  assert.equal(parseBase(null), "pagos");
  assert.equal(parseBase("xyz"), "pagos");
});

test("notaBase segue a base que a API devolveu", () => {
  const todos = ["tiktok", "ml", "shopee"] as const;
  assert.equal(notaBase(null, todos), SO_PAGOS);
  // API sem o contrato novo nao ecoa `base`: o (i) nao pode dizer realizados.
  assert.equal(notaBase({}, todos), SO_PAGOS);
  const eco = { base: "realizados" as const, nao_pago_disponivel: { tiktok: true, ml: false, shopee: false } };
  assert.equal(
    notaBase(eco, todos),
    `ML: só pagos (sem fonte de não pagos). Shopee: só pagos (sem não pagos no período). ${REALIZADOS}`,
  );
  // Canal fora do filtro nao aparece.
  assert.equal(notaBase(eco, ["tiktok"]), REALIZADOS);
});
