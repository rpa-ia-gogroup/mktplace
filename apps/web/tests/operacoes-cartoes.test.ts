/**
 * Operacoes no padrao da Gerencial: Velocidade ML vira grupos por marca de 4 KpiTile; a
 * regra de leitura do ROAS e' a que a tela ja' tinha; ausencia nunca vira zero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leituraRoas, valoresVelocidade } from "../src/lib/operacoes-cartoes.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

test("ROAS: baixo so' abaixo de 3x COM gasto; >= 8x bom; resto atencao; sem valor e' ausente", () => {
  assert.deepEqual([leituraRoas(2.9, 100).baixo, leituraRoas(2.9, 100).tom], [true, "critico"]);
  assert.deepEqual([leituraRoas(2.9, 0).baixo, leituraRoas(2.9, 0).tom], [false, "atencao"], "sem gasto nao e' ROAS baixo");
  assert.equal(leituraRoas(3, 100).tom, "atencao");
  assert.equal(leituraRoas(8, 100).tom, "bom");
  const sem = leituraRoas(null, 100);
  assert.deepEqual([sem.tom, sem.texto, sem.baixo], ["ausente", "—", false]);
});

test("valores no formato da casa", () => {
  const v = valoresVelocidade({ brand: "barbours", gmv_7d: 358500, ad_spend_7d: 77500, roas_7d: 4.6, orders_7d: 2600 });
  assert.equal(v.pedidos, "2,6 mil");
  assert.match(v.gmv, /^R\$\s358,5 mil$/);
  assert.equal(v.roas.texto, "4,6x");
});

test("pagina: grupos gerenciais com as identidades existentes, estados no padrao", () => {
  const C = ler("src/components/operacoes/VelocidadeMl.tsx");
  const P = ler("app/operacoes/page.tsx");
  assert.equal((C.match(/variante="gerencial"/g) ?? []).length, 4);
  assert.deepEqual([...C.matchAll(/identidade="([a-z]+)"/g)].map((m) => m[1]), ["gmv", "ads", "roas", "pedidos"]);
  assert.ok(P.includes("<GrupoVelocidade") && P.includes("<GrupoSemDados"));
  assert.ok(P.includes('tipo="erro"') && P.includes('tipo="indisponivel"') && P.includes("<RetryButton"));
  assert.ok(!P.includes("Erro de carregamento"), "o banner duplicado do erro saiu");
  assert.ok(!/fmtBrl\(|fmtNumber\(|toFixed/.test(P), "formato da casa em toda a pagina (alertas, tabelas e eixo)");
});

test("C1-02: trend TikTok em ordem cronologica pela data ISO, mesmo cruzando o mes (nunca pelo rotulo dd/mm)", async () => {
  const { buildChartData } = await import("../src/lib/operacoes-trend.ts");
  const linha = (ref_date: string, brand: string, gmv: number) => ({ ref_date, brand, gmv, orders: 1 });
  const dados = buildChartData([
    linha("2026-11-01", "kokeshi", 10),
    linha("2026-10-30", "kokeshi", 5),
    linha("2026-11-09", "barbours", 7),
    linha("2026-10-31", "barbours", 3),
    linha("2026-10-30", "kokeshi", 2),
  ]);
  assert.deepEqual(dados.map((d) => d.date), ["30/10", "31/10", "01/11", "09/11"]);
  assert.equal(dados[0].kokeshi, 7, "mesma data e marca somam");
  const pag = ler("app/operacoes/page.tsx");
  assert.ok(!pag.includes("localeCompare"), "o eixo nao ordena mais o rotulo");
});
