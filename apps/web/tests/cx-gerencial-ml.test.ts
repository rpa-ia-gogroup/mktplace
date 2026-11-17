/**
 * CX na Gerencial com o Mercado Livre (16/11/2026): os mesmos cartoes da Shopee,
 * com o numero do ML; o que o ML nao mediu e' "Sem dado", nunca 0.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SEM_DADO_ML, resumoMl, valorMl, type CxMlResponse } from "../src/lib/cx-ml.ts";

const base = (marcas: CxMlResponse["marcas"]): CxMlResponse => ({
  gerado_em: "2026-11-16T10:00:00Z",
  janela: { inicio: "2026-10-17", fim: "2026-11-15", dias: 30 },
  cobertura: { marcas: marcas.map((m) => m.marca), fora: [] },
  diario_estado: "dado",
  reclamacoes_estado: "dado",
  marcas,
  coleta_desde: "2026-10-01",
});

test("valor do cartao: taxa medida vira %, sem medida vira 'Sem dado' (nunca 0)", () => {
  assert.equal(valorMl(null), SEM_DADO_ML);
  assert.equal(SEM_DADO_ML, "Sem dado");
  assert.notEqual(valorMl(0), SEM_DADO_ML); // zero medido e' zero de verdade
});

test("marca sem reclamacao medida nao vira zero: o contact rate do ML fica sem dado", () => {
  const r = resumoMl(base([{ marca: "apice", pedidos: 100, cancelamentos: 2, reclamacoes: null }]));
  assert.equal(valorMl(r.taxa.reclamacao), "Sem dado");
  assert.notEqual(valorMl(r.taxa.cancelamento), "Sem dado");
  assert.equal(valorMl(r.resposta), "Sem dado");
});

test("Gerencial: visao CX aparece com Shopee OU ML no filtro; um painel por canal", () => {
  const pagina = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /const temCx = cxShopee \|\| cxMl;/);
  const ml = readFileSync(new URL("../src/components/gerencial/CxResumoMl.tsx", import.meta.url), "utf8");
  // os mesmos cinco cartoes da Shopee, na mesma grade
  assert.match(ml, /grid grid-cols-1 gap-3 sm:grid-cols-6 lg:grid-cols-5/);
  for (const r of ["ROTULO_INDICADOR.contactRate", "ROTULO_INDICADOR.cancelamento", "ROTULO_INDICADOR.reembolso", '"Reenvio"']) assert.ok(ml.includes(r), r);
  assert.match(ml, /hrefCx\(\{ marca: brands\.length === 1 \? brands\[0\] : null, dias \}, "ml"\)/);
});
