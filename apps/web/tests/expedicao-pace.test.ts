/**
 * Pace de despacho: dias de backlog = backlog / media de despachados/dia.
 * Sem dado ou media zero = "—", nunca zero nem infinito.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { diasDeBacklog, mediaDaMarca, urlPace, type RespostaPace } from "../src/lib/expedicao-pace.ts";
import { formatarDecimal } from "../src/lib/expedicao-formato.ts";

const R: RespostaPace = {
  availability: "available",
  contas: [
    { channel: "shopee", brand: "apice", media_2du: 75 },
    { channel: "shopee", brand: "lescent", media_2du: null },
    { channel: "mercadolivre", brand: "apice", media_2du: 10 },
  ],
};

test("backlog / media", () => {
  assert.equal(diasDeBacklog(150, 75), 2);
  assert.equal(formatarDecimal(diasDeBacklog(100, 30), 1), "3,3");
  assert.equal(diasDeBacklog(0, 75), 0); // backlog zerado e' zero dia de verdade
});

test("media zero, ausente ou backlog ausente = null (nunca infinito)", () => {
  assert.equal(diasDeBacklog(150, 0), null);
  assert.equal(diasDeBacklog(150, null), null);
  assert.equal(diasDeBacklog(150, undefined), null);
  assert.equal(diasDeBacklog(null, 75), null);
  assert.equal(diasDeBacklog(Number.NaN, 75), null);
  assert.equal(formatarDecimal(diasDeBacklog(150, 0), 1), "—");
});

test("media da marca respeita o canal e a disponibilidade", () => {
  assert.equal(mediaDaMarca(R, "shopee", "apice"), 75);
  assert.equal(mediaDaMarca(R, "mercadolivre", "apice"), 10);
  assert.equal(mediaDaMarca(R, "shopee", "lescent"), null);
  assert.equal(mediaDaMarca(R, "shopee", "barbours"), null);
  assert.equal(mediaDaMarca({ ...R, availability: "unavailable" }, "shopee", "apice"), null);
  assert.equal(mediaDaMarca(null, "shopee", "apice"), null);
});

test("url pede o canal", () => {
  assert.equal(urlPace("http://x", "shopee"), "http://x/api/v1/expedicao/despachados?channel=shopee");
});
