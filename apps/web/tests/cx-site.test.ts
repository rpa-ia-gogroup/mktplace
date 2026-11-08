/**
 * CX do site (DTC) — URL, payload, tiles, tabela por marca e frescor.
 * O que importa: ausencia nunca vira 0% e carga parada aparece.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  carregarCxSite,
  diasSite,
  foraDasFontes,
  montarMarcasSite,
  montarTilesSite,
  problemaNoPayloadSite,
  seloFrescor,
  textoSafra,
  urlCxSite,
  type CxSiteResponse,
} from "../src/lib/cx-site.ts";

const rotulo = (m: string) => m.toUpperCase();

function payload(): CxSiteResponse {
  return {
    gerado_em: "2026-11-07T15:00:00Z",
    janela: { inicio: "2026-10-08", fim: "2026-11-06", dias: 30 },
    nps: {
      estado: "dado", fonte: "nps", atualizado_em: "2026-11-07T12:00:00Z",
      respostas: 150, nps: 43.3, promotores_pct: 60, neutros_pct: 23.33, detratores_pct: 16.67,
      marcas: [{ marca: "kokeshi", respostas: 100, nps: 60, promotores_pct: 70, detratores_pct: 10 }],
    },
    reenvio_reembolso: {
      estado: "dado", fonte: "rr", safra_inicio: "2026-10-01", safra_fim: "2026-10-31",
      reenvios: 14, reembolsos: 5, valor_reenvio: 1300, valor_reembolso: 500, sem_valor: 2,
      taxa_reenvio_pct: 1, taxa_reembolso_pct: 0.5,
      fora: [{ marca: "apice", motivo: "Ápice não aparece na base." }],
      marcas: [{ marca: "barbours", reenvios: 10, reembolsos: 5, valor_reenvio: 1000, valor_reembolso: 500,
        sem_valor: 2, faturamento: 100000, taxa_reenvio_pct: 1, taxa_reembolso_pct: 0.5 }],
    },
    reviews: {
      estado: "dado", fonte: "jm", atualizado_em: "2026-10-26T04:50:00Z",
      aviso_frescor: "Carga parada desde 26/10 (12 dias): o que veio depois não aparece.",
      reviews: 80, media: 4.2, baixas_pct: 9.5, minimo_reviews: 10,
      marcas: [{ marca: "kokeshi", reviews: 60, media: 4.2, baixas_pct: 18.3 }],
      piores: [], melhores: [],
    },
  };
}

test("rota aceita 30 ou 90: 7 dias da aba vira 30", () => {
  assert.equal(diasSite(7), 30);
  assert.equal(diasSite(90), 90);
  assert.equal(urlCxSite("/torre-api", { marca: "kokeshi", dias: 7 }), "/torre-api/api/v1/cx/site?brands=kokeshi&dias=30");
});

test("payload sem um bloco e' recusado", () => {
  assert.equal(problemaNoPayloadSite(payload()), null);
  const { reviews: _r, ...sem } = payload();
  assert.equal(problemaNoPayloadSite(sem), "reviews ausente");
});

test("carregar nunca lanca", async () => {
  const falha = (async () => { throw new Error("rede"); }) as unknown as typeof fetch;
  assert.deepEqual(await carregarCxSite({ marca: null, dias: 30 }, falha, ""), { ok: false, motivo: "Não foi possível contatar a API." });
  const r500 = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await carregarCxSite({ marca: null, dias: 30 }, r500, ""), { ok: false, motivo: "A API respondeu 500." });
  const ok = (async () => Response.json(payload())) as unknown as typeof fetch;
  assert.equal((await carregarCxSite({ marca: null, dias: 30 }, ok, "")).ok, true);
});

test("tiles priorizam percentual e ausencia nunca vira 0%", () => {
  const t = montarTilesSite(payload());
  assert.deepEqual(t.map((x) => x.valor), ["43,3", "1,0%", "0,5%", "9,5%"]);
  assert.match(t[1].comparacao, /safra out\/26/);

  const semTaxa = payload();
  semTaxa.reenvio_reembolso.taxa_reenvio_pct = null;
  semTaxa.reenvio_reembolso.motivo_sem_taxa = "Taxa indisponível: faturamento do site não carregou.";
  const t2 = montarTilesSite(semTaxa)[1];
  assert.equal(t2.valor, "—");
  assert.equal(t2.ausente, true);
  assert.match(t2.comparacao, /faturamento/);

  const parado = payload();
  parado.reviews = { ...parado.reviews, estado: "sem_fonte", reviews: null, media: null, baixas_pct: null,
    motivo_indisponivel: "Carga parada desde 26/10 (12 dias): o que veio depois não aparece." };
  const t3 = montarTilesSite(parado)[3];
  assert.equal(t3.valor, "—");
  assert.match(t3.comparacao, /26\/10/);
});

test("tabela por marca: celula sem fonte e' traco, e marcas fora viram frase", () => {
  const linhas = montarMarcasSite(payload(), rotulo);
  assert.deepEqual(linhas.map((l) => l.chave), ["barbours", "kokeshi"]);
  const barbours = linhas[0];
  assert.equal(barbours.nps, "—");
  assert.equal(barbours.reenvio, "1,0%");
  assert.equal(linhas[1].baixas, "18,3%");
  assert.deepEqual(foraDasFontes(payload(), rotulo), ["APICE: Ápice não aparece na base."]);
});

test("carga parada vira selo critico; safra em texto curto", () => {
  assert.equal(seloFrescor("Reviews", payload().reviews).tom, "critico");
  assert.equal(seloFrescor("NPS", payload().nps).tom, "neutro");
  assert.equal(textoSafra("2026-08-01", "2026-10-31"), "safras ago a out/26");
});

test("bloco entra na aba CX por uma linha", () => {
  const fonte = readFileSync(new URL("../app/cx/CxConteudo.tsx", import.meta.url), "utf8");
  assert.match(fonte, /<CxSite filtros=\{filtros\} \/>/);
  const bloco = readFileSync(new URL("../app/cx/CxSite.tsx", import.meta.url), "utf8");
  assert.match(bloco, /CX do site \(DTC\)/);
});
