/**
 * CX do site (DTC) — URL, payload, tiles, tabela por marca e frescor.
 * O que importa: ausencia nunca vira 0% e carga parada aparece.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AJUDA_SITE,
  avisoRecorte,
  carregarCxSite,
  diasSite,
  foraDasFontes,
  montarMarcasSite,
  montarTilesSite,
  problemaNoPayloadSite,
  RESSALVA_REENVIO,
  frescorDoBloco,
  semanaDe,
  seriePorSemana,
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

test("7 dias da aba aparece como 30 ao lado do titulo", () => {
  assert.equal(avisoRecorte(7), "30 dias: o site não tem recorte de 7");
  assert.equal(avisoRecorte(30), null);
  assert.equal(avisoRecorte(90), null);
});

test("ressalvas do reenvio/reembolso visiveis e no ⓘ dos dois", () => {
  assert.match(RESSALVA_REENVIO, /não bate com o Vision CX/);
  assert.match(RESSALVA_REENVIO, /Safra recente ainda recebe/);
  for (const ajuda of [AJUDA_SITE.reenvio, AJUDA_SITE.reembolso]) {
    assert.match(ajuda, /não bate com o Vision CX/);
    assert.match(ajuda, /Safra recente ainda recebe/);
  }
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
  assert.match(t[1].comparacao, /14 solicitações · safra out\/26/);

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
  assert.equal(frescorDoBloco(payload().reviews).parada, true);
  assert.match(frescorDoBloco(payload().reviews).texto, /Fonte: /);
  assert.equal(frescorDoBloco(payload().nps).parada, false);
  assert.match(frescorDoBloco(payload().nps).texto, /^(Atualizado em |Sem data de carga)/);
  assert.equal(textoSafra("2026-08-01", "2026-10-31"), "safras ago a out/26");
});

test("o CX do site saiu da aba /cx (pedido do usuario, 09/11); o lib e a API ficam", () => {
  const fonte = readFileSync(new URL("../app/cx/CxConteudo.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(fonte, /CxSite/);
  assert.throws(() => readFileSync(new URL("../app/cx/CxSite.tsx", import.meta.url), "utf8"));
});

// ---------------------------------------------------------------------------
// API-3 (#290): delta, "antes" e serie semanal/mensal nos cards do site
// ---------------------------------------------------------------------------
test("semana: segunda-feira em UTC; NPS da semana recalculado das contagens, nunca media", () => {
  assert.equal(semanaDe("2026-11-04"), "2026-11-02");
  assert.equal(semanaDe("2026-11-02"), "2026-11-02");
  assert.equal(semanaDe("2026-11-08"), "2026-11-02", "domingo fecha a semana");
  const dias = ["2026-10-12", "2026-10-13", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-03"];
  const serie = dias.map((dia, i) => ({ dia, respostas: 10, promotores: 6 + (i % 2), detratores: 1, nps: null }));
  // semana 12/10: (6+7-2)/20 = 55; 19/10: (6-1)/10 = 50; 26/10: (7-1)/10 = 60; 02/11: (6+7-2)/20 = 55
  const pts = seriePorSemana(serie, (p) => [p.promotores, p.detratores, p.respostas], ([pr, de, re]) => ((pr - de) / re) * 100);
  assert.deepEqual(pts?.map((v) => Math.round(v * 10) / 10), [55, 50, 60, 55]);
  const furada = serie.map((p, i) => (i === 3 ? { ...p, promotores: null } : p));
  assert.equal(seriePorSemana(furada, (p) => [p.promotores, p.detratores, p.respostas], () => 1), null, "dia sem contagem: sem grafico");
});

test("cards do site: delta e antes so' com o anterior; safra com 2 pontos tem delta e nao tem grafico", () => {
  const sem = montarTilesSite(payload());
  assert.ok(sem.every((t) => !t.comp), "API antiga: nenhum card compara");
  const p = payload();
  p.nps = { ...p.nps, nps_anterior: 40.3 };
  p.reenvio_reembolso = {
    ...p.reenvio_reembolso, taxa_reenvio_pct_anterior: 0.8, taxa_reembolso_pct_anterior: null,
    serie: [{ safra: "2026-09-01", taxa_reenvio_pct: 0.8, taxa_reembolso_pct: 0.63 }, { safra: "2026-10-01", taxa_reenvio_pct: 1, taxa_reembolso_pct: 0.5 }],
  };
  const [nps, reenvio, reembolso, reviews] = montarTilesSite(p);
  assert.deepEqual([nps.comp?.delta?.toFixed(1), nps.comp?.unidade, nps.comp?.tone, nps.comp?.antes], ["3.0", "pts", "higher_is_better", "antes 40,3"]);
  assert.deepEqual([reenvio.comp?.delta?.toFixed(1), reenvio.comp?.antes, reenvio.comp?.serie?.length, reenvio.comp?.granularidade], ["0.2", "antes 0,8%", 2, "month"]);
  assert.equal(reembolso.comp?.delta, null, "sem anterior: sem pilula");
  assert.equal(reembolso.comp?.antes, null);
  assert.equal(reviews.comp, null, "carga parada: sem anterior nem serie");
});
