import { test } from "node:test";
import assert from "node:assert/strict";

import { escopoDeMarcas, FILTER_BRAND_KEYS, semMarcasMenores, urlSemMarcasMenores } from "../src/lib/filters/brands.ts";
import { parseFiltersFromSearchParams } from "../src/lib/filters/url-state.ts";

test("o filtro lista as grandes e depois as menores", () => {
  assert.deepEqual(FILTER_BRAND_KEYS.slice(-3), ["yenzah", "aua", "by-samia"]);
  assert.equal(FILTER_BRAND_KEYS.length, 8);
});

test("escopo: Todas = grandes e menores; so' grandes = sem menores; so' menores = sem grandes; mistura soma os dois", () => {
  assert.deepEqual(escopoDeMarcas([]), { grandes: [], temGrandes: true, menores: ["yenzah", "aua", "by-samia"], temMenores: true, soMenores: false });
  assert.deepEqual(escopoDeMarcas(["apice"]), { grandes: ["apice"], temGrandes: true, menores: [], temMenores: false, soMenores: false });
  assert.deepEqual(escopoDeMarcas(["yenzah", "aua"]), { grandes: [], temGrandes: false, menores: ["yenzah", "aua"], temMenores: true, soMenores: true });
  const mix = escopoDeMarcas(["barbours", "yenzah"]);
  assert.deepEqual([mix.grandes, mix.menores, mix.soMenores], [["barbours"], ["yenzah"], false]);
});

test("a URL aceita as menores e o estado volta igual", () => {
  const f = parseFiltersFromSearchParams(new URLSearchParams("brands=apice,yenzah,desconhecida"));
  assert.deepEqual(f.brands, ["apice", "yenzah"]);
});

test("as APIs do Data Mart nunca recebem as menores", () => {
  assert.deepEqual(semMarcasMenores(["apice", "aua"]), ["apice"]);
  assert.equal(urlSemMarcasMenores("/api/v1/x?channels=ml&brands=apice,yenzah&date_from=a"), "/api/v1/x?channels=ml&brands=apice&date_from=a");
  assert.equal(urlSemMarcasMenores("/api/v1/x?channels=ml&brands=yenzah,aua&date_from=a"), "/api/v1/x?channels=ml&date_from=a");
  assert.equal(urlSemMarcasMenores("/api/v1/x?brands=yenzah&date_from=a"), "/api/v1/x?date_from=a");
  assert.equal(urlSemMarcasMenores("/api/v1/x?date_from=a&brands=by-samia"), "/api/v1/x?date_from=a");
  assert.equal(urlSemMarcasMenores("/api/v1/x?brands=yenzah"), "/api/v1/x");
  assert.equal(urlSemMarcasMenores("/api/v1/x?brands=apice%2Cyenzah"), "/api/v1/x?brands=apice");
  assert.equal(urlSemMarcasMenores("/api/v1/x?brands=apice,kokeshi"), "/api/v1/x?brands=apice,kokeshi");
  assert.equal(urlSemMarcasMenores("/api/v1/x?channels=ml"), "/api/v1/x?channels=ml");
});
