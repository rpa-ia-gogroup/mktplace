import assert from "node:assert/strict";
import { test } from "node:test";

import { queryOportunidades, ROTULO_TIPO } from "../src/lib/oportunidades.ts";

test("oportunidades: marcas viram brands repetido; vazio = todas", () => {
  assert.equal(queryOportunidades([]), "");
  assert.equal(queryOportunidades(["barbours", "kokeshi"]), "brands=barbours&brands=kokeshi");
  assert.equal(ROTULO_TIPO.ruptura_full, "ruptura no Full");
});
