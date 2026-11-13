// T-0111 — formatacao de null: os totais que a API passa a mandar nulos (overview,
// Envio ML, Shopee FBS) aparecem como "—", nunca "R$ 0", "0" ou "0%".
// Guarda de regressao: estes formatadores ja' tratavam null; o teste fixa isso
// agora que `/ml-fulfillment` e `/shopee-fbs` podem mandar totais/shares/medias nulos.
import { test } from "node:test";
import assert from "node:assert/strict";

import { fmtCompacto } from "../src/lib/metas.ts";
import * as ml from "../src/lib/ml-fulfillment.ts";
import * as fbs from "../src/lib/shopee-fbs.ts";

test("T-0111 GMV do heroi da home: null vira '—'", () => {
  assert.equal(fmtCompacto(null), "—");
  assert.equal(fmtCompacto(undefined), "—");
  assert.equal(fmtCompacto(0), "R$ 0", "zero medido continua zero");
});

test("T-0111 Envio ML: total, contagem e share nulos viram '—'", () => {
  assert.equal(ml.fmtGmv(null), "—");
  assert.equal(ml.fmtGmv(undefined), "—");
  assert.equal(ml.fmtCount(null), "—");
  assert.equal(ml.fmtShare(null), "—");
  assert.equal(ml.parseGmv(null), null, "ausencia nao vira 0 no parse");
});

test("T-0111 Shopee FBS: total, contagem, share e media nulos viram '—'", () => {
  assert.equal(fbs.fmtGmv(null), "—");
  assert.equal(fbs.fmtCount(null), "—");
  assert.equal(fbs.fmtShare(null), "—");
  assert.equal(fbs.fmtHandling(null), "—");
  assert.equal(fbs.fmtHandling({ sample_count: 3, hours_avg: null, days_avg: null } as never), "—");
  assert.equal(fbs.parseGmv(null), null);
});

// Contrato final (3324a490): /regioes/summary pode mandar gmv/orders/ufs_com_venda null.
import { valorExato as valorExatoRegioes } from "../src/lib/regioes-cartoes.ts";
import { fmtShareOfTotalPct } from "../src/lib/regioes-format.ts";
import { readFileSync } from "node:fs";

test("T-0111 Regioes: total null nao vira 'R$ 0'/'0' nem participacao", () => {
  assert.equal(valorExatoRegioes("gmv", { gmv: null, orders: null }), null);
  assert.equal(valorExatoRegioes("pedidos", { gmv: null, orders: null }), null);
  assert.match(valorExatoRegioes("gmv", { gmv: 0, orders: 0 }) ?? "", /^R\$\s0$/, "zero medido continua zero");
  assert.equal(fmtShareOfTotalPct(10, null), null);
  const cartoes = readFileSync(new URL("../src/components/regioes/RegioesCartoes.tsx", import.meta.url), "utf8");
  assert.match(cartoes, /valor=\{r\?\.ufs_com_venda != null \?/, "UFs com venda nulo nao vira 'null/27'");
  assert.match(cartoes, /valor=\{r\?\.gmv != null \? fmtBrlCurto\(r\.gmv\) : null\}/);
});
