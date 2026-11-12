/**
 * Ritmo de despacho e Dias de backlog = backlog / media de despachados/dia.
 * Sem dado, media zero ou conta ambigua = "—", nunca zero nem infinito.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AVISO_PACE_INDISPONIVEL,
  diasDaLinha,
  diasDeBacklog,
  mediaDaMarca,
  paceDisponivel,
  rotuloDoDia,
  textoDoPace,
  urlPace,
  type RespostaPace,
} from "../src/lib/expedicao-pace.ts";
import { formatarDecimal } from "../src/lib/expedicao-formato.ts";

const dia = (d: string, n: number | null) => ({ dia: d, despachados: n });
const R: RespostaPace = {
  availability: "available",
  business_days: ["2026-11-05", "2026-11-06"],
  contas: [
    { channel: "shopee", brand: "apice", media_2du: 75 },
    { channel: "shopee", brand: "lescent", media_2du: null },
    { channel: "mercadolivre", brand: "apice", media_2du: 10 },
  ],
  totais: [
    { channel: "shopee", dias: [dia("2026-11-05", 100), dia("2026-11-06", 50)] },
    { channel: "mercadolivre", dias: [dia("2026-11-05", null), dia("2026-11-06", 10)] },
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
  assert.equal(diasDeBacklog(null, 75), null);
  assert.equal(diasDeBacklog(Number.NaN, 75), null);
  assert.equal(formatarDecimal(diasDeBacklog(150, 0), 1), "—");
});

test("1. Shopee: divide a fila do vendedor, a que a coluna propria mostra (300 total, 100 vendedor, 100/dia = 1,0)", () => {
  const dias = diasDaLinha({ canal: "shopee", backlog: 300, backlogVendedor: 100, media: 100, variasContas: false });
  assert.equal(dias, 1);
  // Nunca o backlog com FBS: 300 / 100 = 3,0 seria numero que o ritmo (sem FBS) nao sustenta.
  assert.notEqual(dias, 3);
  // Sem a fila do vendedor da conta: "—", nao o total com FBS.
  assert.equal(diasDaLinha({ canal: "shopee", backlog: 300, backlogVendedor: null, media: 100, variasContas: false }), null);
});

test("1. ML: divide o backlog da propria linha", () => {
  assert.equal(diasDaLinha({ canal: "mercadolivre", backlog: 300, backlogVendedor: null, media: 100, variasContas: false }), 3);
});

test("2. Shopee sem a divisao vendedor x FBS esconde a coluna e avisa; ML sempre mostra", () => {
  assert.equal(paceDisponivel("shopee", false), false);
  assert.equal(paceDisponivel("shopee", true), true);
  assert.equal(paceDisponivel("mercadolivre", false), true);
  assert.equal(AVISO_PACE_INDISPONIVEL, "Dias de backlog indisponíveis: a fila do vendedor não veio separada do FBS.");
});

test("3. marca com varias contas: a linha da conta nao divide", () => {
  assert.equal(diasDaLinha({ canal: "mercadolivre", backlog: 300, backlogVendedor: null, media: 100, variasContas: true }), null);
  assert.equal(diasDaLinha({ canal: "shopee", backlog: 300, backlogVendedor: 100, media: 100, variasContas: true }), null);
});

test("4. rotulo do dia e texto do ⓘ citam as datas usadas", () => {
  assert.equal(rotuloDoDia("2026-11-05"), "qui 05");
  assert.equal(rotuloDoDia("2026-11-06"), "sex 06");
  assert.match(textoDoPace("shopee", R), /Média de qui 05 e sex 06/);
  assert.match(textoDoPace("shopee", R), /sem FBS/);
  // So' um dia com dado.
  assert.match(textoDoPace("mercadolivre", R), /só sex 06 \(qui sem dado\)/);
  assert.match(textoDoPace("mercadolivre", R), /sem Full/);
  // A divisao citada e' a da linha: Shopee usa o Backlog sem FBS.
  assert.match(textoDoPace("shopee", R), /Dias de backlog = Backlog sem FBS ÷ ritmo/);
  assert.match(textoDoPace("mercadolivre", R), /Dias de backlog = backlog ÷ ritmo/);
  // Nenhum dia com dado: diz que o ritmo esta' indisponivel.
  const vazio = { ...R, totais: [{ ...R.totais![0], channel: "shopee",
    dias: [{ dia: "2026-11-05", despachados: null }, { dia: "2026-11-06", despachados: null }] }] } as typeof R;
  assert.match(textoDoPace("shopee", vazio), /Sem dado em qui 05 e sex 06: ritmo indisponível/);
  // Sem resposta: texto generico, sem inventar data.
  assert.match(textoDoPace("shopee", null), /2 últimos dias úteis/);
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
