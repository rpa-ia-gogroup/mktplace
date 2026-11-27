/**
 * Black e TV com a MESMA receita da Gerencial (Hoje): horas fechadas + hora em andamento (fato diária).
 * Meta até agora = meta das horas fechadas + meta da hora em andamento × fração já decorrida.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { horaAHora, horaMinuto, linhasComParcial, quadroMarcaCanal, resumoBlack, type RespostaBlack } from "../src/lib/black-hora.ts";
import { canalDoOverview, marcasDoBrands, metaDe } from "../src/lib/black-tv.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");
const h24 = (v: number) => Array.from({ length: 24 }, () => v);
const real = (v: number, corte: number) => Array.from({ length: 24 }, (_, h) => (h < corte ? v : null));

const RESP: RespostaBlack = {
  dia: "2026-11-27", disponivel: true, motivo: null,
  meta: { disponivel: true, motivo: null, fonte: "x", lida_em: null },
  cortes: { shopee: 9, ml: 9 },
  parcial: {
    shopee: { hora: 9, ate: "2026-11-27T09:42:00-03:00", fracao: 0.7 },
    ml: { hora: 9, ate: "2026-11-27T09:47:00-03:00", fracao: 47 / 60 },
  },
  linhas: [
    { marca: "kokeshi", canal: "shopee", meta_dia: 2400, meta_hora: h24(100), realizado_hora: real(120, 9), realizado_parcial: 80 },
    { marca: "kokeshi", canal: "ml", meta_dia: 1200, meta_hora: h24(60), realizado_hora: real(40, 9), realizado_parcial: 30 },
  ],
};

test("resumo: realizado soma a hora em andamento; meta da hora entra pró-rata; rótulo 'até 09:42'", () => {
  const r = resumoBlack(linhasComParcial(RESP));
  assert.equal(r.realizado, 120 * 9 + 80 + 40 * 9 + 30);
  assert.ok(Math.abs(r.metaAteAgora! - (100 * 9 + 100 * 0.7 + 60 * 9 + 60 * (47 / 60))) < 1e-9);
  assert.ok(Math.abs(r.pct! - r.realizado / r.metaAteAgora!) < 1e-12);
  assert.equal(r.ate, "09:42", "o canal mais atrasado");
  assert.equal(r.ultimaHora, 8, "a hora fechada não muda");
  // cada canal no seu 'até'
  assert.equal(resumoBlack(linhasComParcial(RESP).filter((l) => l.canal === "ml")).ate, "09:47");
  // quadro marca x canal: mesma conta
  const cel = quadroMarcaCanal(linhasComParcial(RESP)).celula("kokeshi", "shopee")!;
  assert.equal(cel.realizado, 1160);
  assert.ok(Math.abs(cel.metaAteAgora! - 970) < 1e-9);
});

test("carga da diária já na hora seguinte: a meta soma a hora do corte inteira e a fração da seguinte", () => {
  const adiante = { ...RESP, parcial: { ...RESP.parcial, shopee: { hora: 9, ate: "2026-11-27T10:15:00-03:00", fracao: 1 } } };
  const r = resumoBlack(linhasComParcial(adiante).filter((l) => l.canal === "shopee"));
  assert.ok(Math.abs(r.metaAteAgora! - (100 * 9 + 100 + 100 * 0.25)) < 1e-9);
  assert.equal(r.ate, "10:15");
});

test("API antiga (sem parcial): tudo como antes, só horas fechadas e rótulo de hora cheia", () => {
  const velha = { ...RESP, parcial: undefined, linhas: RESP.linhas.map(({ realizado_parcial: _, ...l }) => l) };
  const r = resumoBlack(linhasComParcial(velha));
  assert.equal(r.realizado, 120 * 9 + 40 * 9);
  assert.equal(r.metaAteAgora, 100 * 9 + 60 * 9);
  assert.equal(r.ate, null);
  assert.ok(horaAHora(linhasComParcial(velha)).every((h) => h.parcialAcum === null));
});

test("gráfico: ponto parcial na hora do corte, ligado ao último acumulado fechado", () => {
  const hs = horaAHora(linhasComParcial(RESP));
  assert.equal(hs[8].realizadoAcum, 160 * 9);
  assert.equal(hs[8].parcialAcum, 160 * 9, "início do trecho tracejado");
  assert.equal(hs[9].realizadoAcum, null);
  assert.equal(hs[9].parcialAcum, 160 * 9 + 110);
  assert.ok(hs.filter((h) => h.parcialAcum !== null).length === 2);
  const g = ler("app/black/BlackGrafico.tsx");
  assert.ok(g.includes("segment={[parcial.de, parcial.ate]}") && g.includes('strokeDasharray="3 4"'), "tracejado até a posição de 'ate'");
  assert.ok(g.includes('fill="transparent" stroke={tema.total}'), "ponto vazado");
  assert.ok(ler("app/black/BlackClient.tsx").includes("ate={r.ate}"));
});

test("TV: canais do overview de hoje e marcas do brands (a fonte da Gerencial); sem dado nunca vira 0", () => {
  assert.deepEqual(canalDoOverview("ml", { current: { gmv: 106730.18, orders: 1900 }, refreshed_at: "2026-11-27T12:42:55Z" }),
    { id: "ml", gmv: 106730.18, pedidos: 1900, ate: "2026-11-27T12:42:55Z" });
  assert.deepEqual(canalDoOverview("tiktok", { current: { gmv: null, orders: 0 } }), { id: "tiktok", gmv: null, pedidos: 0, ate: null });
  assert.deepEqual(marcasDoBrands([{ brand: "apice", ml_gmv: null, shopee_gmv: 53282.28, tiktok_gmv: 97869.38 }]),
    [{ brand: "apice", porCanal: { shopee: 53282.28, tiktok: 97869.38 } }]);
  assert.equal(horaMinuto("2026-11-27T12:42:55Z"), "09:42");
});

test("TV: meta pela regra da /black (metaDe com a hora em andamento)", () => {
  const m = metaDe(RESP)!;
  const r = resumoBlack(linhasComParcial(RESP));
  assert.deepEqual([m.real, m.ate, m.dia, m.atingido, m.rotulo], [r.realizado, r.metaAteAgora, 3600, r.pct, "09:42"]);
  assert.equal(metaDe(RESP, "barbours"), null);
  const tv = ler("app/black/tv/TvClient.tsx");
  assert.ok(!tv.includes("hoje-por-hora"), "a TV não lê mais o hoje-por-hora cortado na hora cheia");
  assert.ok(tv.includes("/api/v1/performance/overview?") && tv.includes("/api/v1/performance/brands?"));
  assert.ok(ler("app/black/BlackClient.tsx").includes("filtrarBlack(linhasComParcial(dados), marcas, canal)"));
  // rodapé: só 'Tela cheia' e 'Sair (Esc)'; aviso curto só quando a leitura falha
  const rodape = tv.slice(tv.indexOf("<footer"), tv.indexOf("</footer>"));
  assert.ok(!rodape.includes("Vendas pagas") && !rodape.includes("lido às") && !rodape.includes("atualiza a cada"));
  assert.ok(rodape.includes('erro && dados ? "sem conexão, mostrando a última leitura" : ""'));
  assert.ok(rodape.includes("Tela cheia") && rodape.includes("Sair (Esc)"));
});
