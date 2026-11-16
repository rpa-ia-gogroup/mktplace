// T-0111 (A1-13) — home: sem linha na fonte, GMV e Pedidos mostram "—" com
// "Sem dado no recorte"; nunca "R$ 0"/"0". Zero so' quando a fonte tem linha
// com 0. Cobre a resposta NOVA da API (null) e a ANTIGA (0 com refreshed_at nulo).
//
// O modulo novo (`overview-sem-dado.ts`) e' importado DENTRO dos testes, para
// que a contraprova contra o codigo antigo conte falha por caso, e nao uma so'.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildKpiBand } from "../src/lib/gerencial/kpi-band.ts";
import { gmvComMenores, pedidosTicketComMenores } from "../src/lib/gerencial/marcas-menores-gerencial.ts";
import type { OverviewData } from "../src/lib/api-client.ts";

const fonte = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const semDado = () => import("../src/lib/overview-sem-dado.ts");

// /performance/overview?channels=ml&brands=apice&date_from=2026-10-01&date_to=2026-10-31&compare=true
const ANTIGA = {
  current: { gmv: 0, tiktok_gmv: null, ml_gmv: null, shopee_gmv: null, orders: 0, avg_ticket: 0 },
  previous: { gmv: 0, orders: 0, avg_ticket: 0 },
  gmv_mom_pct: null,
  refreshed_at: null,
};
const NOVA = {
  current: { gmv: null, tiktok_gmv: null, ml_gmv: null, shopee_gmv: null, orders: null, avg_ticket: null },
  previous: { gmv: null, orders: null, avg_ticket: null },
  gmv_mom_pct: null,
  refreshed_at: null,
};

/** O OverviewData que `fetchOverview` monta (mesma normalizacao). */
async function overviewDe(raw: typeof ANTIGA | typeof NOVA): Promise<OverviewData> {
  const { totaisDoOverview } = await semDado();
  const t = totaisDoOverview(raw.current, raw.previous, raw.gmv_mom_pct, raw.refreshed_at);
  return {
    gmv: t.gmv, orders: t.orders, avg_ticket: t.avg_ticket,
    tiktok_gmv: null, ml_gmv: null, shopee_gmv: null,
    ad_spend: null, ml_roas: null, ml_cancel_rate_pct: null, shopee_roas: null,
    tiktok_customers: null, ml_unique_buyers: null, shopee_unique_buyers: null,
    gmv_mom_pct: t.gmv_mom_pct, prev_gmv: t.prev_gmv, prev_orders: t.prev_orders, prev_avg_ticket: t.prev_avg_ticket,
    sem_dado: t.sem_dado,
  };
}

/** Overview ja' sem dado, como a tela recebe (sem depender do modulo novo). */
const OV_SEM_DADO = {
  gmv: null, orders: null, avg_ticket: null,
  tiktok_gmv: null, ml_gmv: null, shopee_gmv: null,
  ad_spend: null, ml_roas: null, ml_cancel_rate_pct: null, shopee_roas: null,
  tiktok_customers: null, ml_unique_buyers: null, shopee_unique_buyers: null,
  gmv_mom_pct: null, prev_gmv: null, prev_orders: null, prev_avg_ticket: null,
} as unknown as OverviewData;

test("T-0111 normalizador: resposta antiga (0 + refreshed_at nulo) vira sem dado", async () => {
  const { totaisDoOverview } = await semDado();
  const t = totaisDoOverview(ANTIGA.current, ANTIGA.previous, ANTIGA.gmv_mom_pct, ANTIGA.refreshed_at);
  assert.equal(t.sem_dado, true);
  assert.deepEqual([t.gmv, t.orders, t.avg_ticket], [null, null, null]);
  assert.deepEqual([t.prev_gmv, t.prev_orders, t.gmv_mom_pct], [null, null, null]);
});

test("T-0111 normalizador: resposta nova (null) vira sem dado", async () => {
  const { totaisDoOverview } = await semDado();
  const t = totaisDoOverview(NOVA.current, NOVA.previous, NOVA.gmv_mom_pct, NOVA.refreshed_at);
  assert.equal(t.sem_dado, true);
  assert.deepEqual([t.gmv, t.orders, t.avg_ticket, t.prev_gmv], [null, null, null, null]);
});

test("T-0111 normalizador: atual vazio com anterior real nao vira -100% (API antiga)", async () => {
  const { totaisDoOverview } = await semDado();
  const t = totaisDoOverview(ANTIGA.current, { gmv: 800, orders: 32, avg_ticket: 25 }, -100, null);
  assert.equal(t.gmv, null);
  assert.equal(t.prev_gmv, 800, "o anterior com linha continua medido");
  assert.equal(t.gmv_mom_pct, null, "sem o atual nao ha variacao");
});

test("T-0111 normalizador: zero COM linha na fonte (refreshed_at presente) continua 0", async () => {
  const { totaisDoOverview } = await semDado();
  const t = totaisDoOverview({ gmv: 0, orders: 0, avg_ticket: 0 }, null, null, "2026-11-13T17:40:29Z");
  assert.equal(t.sem_dado, false);
  assert.equal(t.gmv, 0);
  assert.equal(t.orders, 0);
});

test("T-0111 normalizador: dado real passa intacto", async () => {
  const { totaisDoOverview } = await semDado();
  const t = totaisDoOverview({ gmv: 1000, orders: 40, avg_ticket: 25 }, { gmv: 800, orders: 32, avg_ticket: 25 }, 25, "2026-11-13T17:40:29Z");
  assert.deepEqual([t.gmv, t.orders, t.avg_ticket, t.prev_gmv, t.prev_orders, t.gmv_mom_pct], [1000, 40, 25, 800, 32, 25]);
  assert.equal(t.sem_dado, false);
});

test("T-0111 faixa de KPIs: GMV e Pedidos sem dado sao '—' com motivo, nunca R$ 0 / 0", () => {
  const [gmv, pedidos, ticket] = buildKpiBand(OV_SEM_DADO, ["ml"], true);
  assert.equal(gmv.value, null, "GMV sem dado renderiza '—'");
  assert.equal(gmv.exactValue, null);
  assert.equal(gmv.unavailableReason, "Sem dado no recorte");
  assert.equal(gmv.deltaPct, null);
  assert.equal(pedidos.value, null, "Pedidos sem dado renderiza '—'");
  assert.equal(pedidos.unavailableReason, "Sem dado no recorte");
  assert.equal(pedidos.comparisonNote, null, "sem dado nao e' 'comparacao indisponivel'");
  assert.equal(ticket.value, null);
  assert.match(ticket.unavailableReason ?? "", /Sem dado no recorte/);
});

test("T-0111 faixa de KPIs: resposta antiga e nova chegam iguais na tela", async () => {
  for (const raw of [ANTIGA, NOVA]) {
    const [gmv, pedidos] = buildKpiBand(await overviewDe(raw), ["ml"], true);
    assert.deepEqual([gmv.value, pedidos.value], [null, null]);
    assert.ok(![gmv.value, pedidos.value].some((v) => v === "R$ 0,00" || v === "0"));
  }
});

test("T-0111 faixa de KPIs: zero medido continua aparecendo como zero", () => {
  const ov = { ...OV_SEM_DADO, gmv: 0, orders: 0, avg_ticket: 0, prev_gmv: 0 } as OverviewData;
  const [gmv, pedidos] = buildKpiBand(ov, ["ml"], true);
  assert.ok(gmv.value && /^R\$\s0,00$/.test(gmv.value));
  assert.equal(pedidos.value, "0");
});

test("T-0111 marcas menores: grandes sem dado nao somam 0 nem apagam as menores", () => {
  const m = { estado: "ok", total: 500, anterior: null, pedidos: 5, pedidosAnterior: null, porCanal: {}, anteriorPorCanal: {}, marcas: [] } as never;
  const topo = gmvComMenores({ gmv: null, prevGmv: null, momPct: null }, m, true);
  assert.equal(topo.gmv, 500);
  assert.equal(topo.momPct, null);
  const kpis = pedidosTicketComMenores(buildKpiBand(OV_SEM_DADO, ["shopee"], true), OV_SEM_DADO, topo, m);
  assert.equal(kpis.find((k) => k.key === "orders")!.value, "5");
});

test("T-0111 home: o heroi recebe o aviso de sem dado e mostra o texto", () => {
  const page = fonte("app/page.tsx");
  assert.match(page, /semDadoNoRecorte=\{overview != null && overview\.gmv == null\}/);
  const hero = fonte("src/components/gerencial/MetaHero.tsx");
  assert.match(hero, /\{semDadoNoRecorte && \(/);
  assert.match(hero, /SEM_DADO_NO_RECORTE_DICA/);
});

test("T-0111 contrato final: `previous` null (sem compare) nao quebra o normalizador nem a faixa", async () => {
  const { totaisDoOverview } = await semDado();
  const t = totaisDoOverview({ gmv: 1000, orders: 40, avg_ticket: 25 }, null, null, "2026-11-13T17:40:29Z");
  assert.deepEqual([t.gmv, t.prev_gmv, t.prev_orders, t.gmv_mom_pct], [1000, null, null, null]);
  const src = fonte("src/lib/api-client.ts");
  assert.ok(!/raw\.previous\.[a-z_]+/.test(src), "todo acesso a `previous` usa `?.`");
});
