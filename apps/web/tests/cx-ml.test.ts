/**
 * Aba CX · Mercado Livre (10/11/2026) — canal na URL, resumo, tabelas, fila e Pareto.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hrefCx, lerCanalCx, resumoFiltrosCx } from "../src/lib/cx.ts";
import {
  AJUDA_ML,
  carregarCxMl,
  itensAtencaoMl,
  montarAtendimentoMl,
  montarParetoMl,
  montarProblemasMl,
  problemaNoPayloadMl,
  resumoMl,
  textoPrazo,
  urlCxMl,
  type CxMlResponse,
  type LinhaMl,
} from "../src/lib/cx-ml.ts";

const rotulo = (m: string) => m.toUpperCase();
const AGORA = Date.parse("2026-11-10T20:00:00Z");

function linha(marca: string, extra: Partial<LinhaMl> = {}): LinhaMl {
  return {
    marca,
    pedidos: 1000,
    reclamacoes: 20,
    cancelamentos: 10,
    mediacoes: 10,
    perguntas: 30,
    pedidos_anterior: 1000,
    reclamacoes_anterior: 10,
    cancelamentos_anterior: 10,
    mediacoes_anterior: 20,
    aguardando_nos: 0,
    vencidas: 0,
    vencem_24h: 0,
    perguntas_sem_resposta: 0,
    ...extra,
  };
}

function resp(extra: Partial<CxMlResponse> = {}): CxMlResponse {
  return {
    gerado_em: "2026-11-10T20:00:00Z",
    janela: { inicio: "2026-10-11", fim: "2026-11-09", dias: 30 },
    janela_anterior: { inicio: "2026-09-11", fim: "2026-10-10", dias: 30 },
    cobertura: { marcas: ["kokeshi", "barbours"], fora: [{ marca: "apice", motivo: "Sem conta Mercado Livre integrada." }] },
    diario_estado: "dado",
    reclamacoes_estado: "dado",
    marcas: [linha("kokeshi"), linha("barbours", { reclamacoes: 40, reclamacoes_anterior: 30 })],
    coleta_desde: "2026-08-12",
    ...extra,
  };
}

test("canal na URL: so' ml vale; o resto e' Shopee; Shopee nao escreve canal", () => {
  assert.equal(lerCanalCx({ canal: "ml" }), "ml");
  assert.equal(lerCanalCx({ canal: "ML " }), "ml");
  assert.equal(lerCanalCx({ canal: "tiktok" }), "shopee");
  assert.equal(lerCanalCx({}), "shopee");
  assert.equal(hrefCx({ marca: null, dias: 30 }), "/cx");
  assert.equal(hrefCx({ marca: null, dias: 30 }, "ml"), "/cx?canal=ml");
  assert.equal(hrefCx({ marca: "kokeshi", dias: 7 }, "ml"), "/cx?canal=ml&brands=kokeshi&dias=7");
  assert.equal(resumoFiltrosCx({ marca: null, dias: 30 }, rotulo, "ml"), "Mercado Livre · Todas as marcas · Últimos 30 dias");
  assert.equal(resumoFiltrosCx({ marca: "apice", dias: 7 }, rotulo), "Shopee · APICE · Últimos 7 dias");
});

test("url da API e payload invalido", () => {
  assert.equal(urlCxMl("http://x", { marca: "kokeshi", dias: 7 }), "http://x/api/v1/cx/mercadolivre?brands=kokeshi&dias=7");
  assert.equal(urlCxMl("http://x", { marca: null, dias: 30 }), "http://x/api/v1/cx/mercadolivre?dias=30");
  assert.equal(problemaNoPayloadMl(null), "corpo vazio");
  assert.equal(problemaNoPayloadMl({ janela: {} }), "cobertura ausente");
  assert.equal(problemaNoPayloadMl({ janela: {}, cobertura: { marcas: [], fora: [] } }), "marcas ausentes");
  assert.equal(problemaNoPayloadMl(resp()), null);
});

test("carregar: ok, HTTP de erro, corpo invalido e falha de rede nunca lancam", async () => {
  const ok = (corpo: unknown, status = 200) => (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;
  const f = { marca: null, dias: 30 as const };
  const a = await carregarCxMl(f, ok(resp()), "http://x");
  assert.ok(a.ok && a.dados.marcas.length === 2);
  const b = await carregarCxMl(f, ok({}, 503), "http://x");
  assert.deepEqual(b, { ok: false, motivo: "A API respondeu 503." });
  const c = await carregarCxMl(f, ok({ janela: {} }), "http://x");
  assert.ok(!c.ok && /cobertura ausente/.test(c.motivo));
  const d = await carregarCxMl(f, (async () => { throw new Error("rede"); }) as unknown as typeof fetch, "http://x");
  assert.deepEqual(d, { ok: false, motivo: "Não foi possível contatar a API." });
});

test("resumo: taxa somando as marcas, seta em p.p. contra o anterior (subir e' pior)", () => {
  const r = resumoMl(resp());
  assert.equal(r.pedidos, 2000);
  assert.equal(r.contagem.reclamacao, 60);
  assert.equal(r.taxa.reclamacao, 3);
  assert.equal(r.taxa.cancelamento, 1);
  const c = r.comparacao.reclamacao!;
  assert.equal(c.delta, 1); // 3,0% contra 2,0%
  assert.deepEqual([c.unidade, c.tone, c.antes], ["pp", "lower_is_better", "antes 2,0%"]);
  assert.equal(r.comparacao.mediacao!.delta, -1);
});

test("resumo: marca sem um dos lados fica fora da taxa, nunca vira zero", () => {
  const r = resumoMl(resp({ marcas: [linha("kokeshi"), linha("barbours", { reclamacoes: null, pedidos: 500 })] }));
  assert.equal(r.taxa.reclamacao, 2); // so' a Kokeshi: 20/1000
  assert.equal(r.contagem.reclamacao, 20);
  const nada = resumoMl(resp({ marcas: [linha("kokeshi", { reclamacoes: null, cancelamentos: null, mediacoes: null })] }));
  assert.equal(nada.taxa.reclamacao, null);
  assert.equal(nada.contagem.reclamacao, null);
  assert.equal(nada.comparacao.reclamacao, null);
});

test("sem anterior da API: nao compara (nunca parcial) e a linha neutra traz a data", () => {
  const sem = { motivo: "coleta desde 12/08", a_partir_de: "2026-10-11", detalhe: "A coleta comecou em 12/08/2026." };
  const r = resumoMl(resp({
    marcas: [linha("kokeshi", { pedidos_anterior: null, reclamacoes_anterior: null })],
    sem_anterior: { reclamacao: sem },
  }));
  assert.equal(r.comparacao.reclamacao, null);
  assert.deepEqual(r.semAnterior.reclamacao, { texto: "comparação a partir de 11/10", detalhe: "A coleta comecou em 12/08/2026." });
  // uma marca com anterior e outra sem: o anterior parcial nao entra
  const parcial = resumoMl(resp({ marcas: [linha("kokeshi"), linha("barbours", { pedidos_anterior: null })] }));
  assert.equal(parcial.comparacao.reclamacao, null);
});

test("serie diaria: soma as marcas por dia; marca sem medida no dia anula o grafico", () => {
  const pt = (dia: string, marca: string, rec: number | null) => ({ dia, marca, pedidos: 100, reclamacoes: rec, cancelamentos: 1, mediacoes: 1 });
  const dias = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
  const serie = dias.flatMap((d, i) => [pt(d, "kokeshi", 2 + i), pt(d, "barbours", 2)]);
  const r = resumoMl(resp({ serie_diaria: serie }));
  assert.deepEqual(r.comparacao.reclamacao!.serie!.map((x) => Math.round(x * 100) / 100), [2, 2.5, 3, 3.5]);
  const furada = resumoMl(resp({ serie_diaria: serie.map((p, i) => (i === 3 ? { ...p, reclamacoes: null } : p)) }));
  assert.equal(furada.comparacao.reclamacao!.serie, null);
  assert.deepEqual(furada.comparacao.cancelamento!.serie, [1, 1, 1, 1]);
});

test("problemas por marca: pior taxa de reclamacao primeiro, com delta e 'antes'", () => {
  const { linhas } = montarProblemasMl(resp(), rotulo);
  assert.deepEqual(linhas.map((l) => l.marca), ["BARBOURS", "KOKESHI"]);
  const c = linhas[0].celulas.reclamacao;
  assert.deepEqual([c.pct, c.n, c.antes, c.delta?.sentido], ["4,0%", "40", "3,0%", "piorou"]);
  const k = linhas[1].celulas.mediacao;
  assert.equal(k.delta?.sentido, "melhorou");
  const sem = montarProblemasMl(resp({ marcas: [linha("kokeshi", { reclamacoes: null, pedidos_anterior: null })] }), rotulo);
  assert.deepEqual([sem.linhas[0].celulas.reclamacao.pct, sem.linhas[0].celulas.reclamacao.n, sem.linhas[0].celulas.reclamacao.delta], ["—", "—", null]);
});

test("prazo: vence em / venceu ha'; sem prazo, nada", () => {
  assert.deepEqual(textoPrazo("2026-11-11T01:00:00Z", AGORA), { texto: "vence em 5 h 00", vencido: false });
  assert.deepEqual(textoPrazo("2026-11-08T20:00:00Z", AGORA), { texto: "venceu há 2 d", vencido: true });
  assert.equal(textoPrazo(null, AGORA), null);
  assert.equal(textoPrazo("lixo", AGORA), null);
});

test("atendimento por loja: fila vencida primeiro; tempo oficial em min e 1a acao parcial com a cobertura", () => {
  const d = resp({
    marcas: [
      linha("kokeshi", { aguardando_nos: 3, vencidas: 0, vencem_24h: 1, prazo_mais_antigo: "2026-11-11T01:00:00Z", tempo_resposta_min: 2737, mensagens_pendentes: 20, perguntas_sem_resposta: 1 }),
      linha("barbours", { aguardando_nos: 5, vencidas: 2, vencem_24h: 0, prazo_mais_antigo: "2026-11-08T20:00:00Z", resposta_mediana_h: 21.3, reclamacoes_com_historico: 150, reclamacoes_respondidas: 44 }),
      linha("lescent", { aguardando_nos: 0, tempo_resposta_min: null, mensagens_pendentes: null, perguntas_sem_resposta: null }),
    ],
  });
  const { linhas, total } = montarAtendimentoMl(d, rotulo, AGORA);
  assert.deepEqual(linhas.map((l) => l.marca), ["BARBOURS", "KOKESHI", "LESCENT"]);
  const [b, k, l] = linhas;
  assert.equal(b.aguardandoDica, "2 vencidas");
  assert.deepEqual(b.prazo, { texto: "venceu há 2 d", vencido: true });
  assert.equal(b.primeiraResposta, "21 h 18");
  assert.equal(b.primeiraRespostaDica, "44 com ação nossa em 150 reclamações com histórico lido");
  assert.equal(k.tempoResposta, "1 d 21 h");
  assert.equal(k.aguardandoDica, "1 vence em 24 h");
  assert.equal(k.primeiraResposta, "—");
  assert.deepEqual([l.tempoResposta, l.mensagens, l.perguntasSemResposta, l.prazo], ["—", "—", "—", null]);
  assert.deepEqual(total, { aguardando: "8", perguntasSemResposta: "1", mensagens: "20" });
});

test("fila 'O que exige atencao': vencida e' critica, depois 24 h e perguntas, mensagens por ultimo", () => {
  const d = resp({
    marcas: [
      linha("kokeshi", { vencem_24h: 2, prazo_mais_antigo: "2026-11-11T01:00:00Z", perguntas_sem_resposta: 1, mensagens_pendentes: 20 }),
      linha("barbours", { vencidas: 1, prazo_mais_antigo: "2026-11-08T20:00:00Z" }),
      linha("lescent"),
    ],
  });
  const itens = itensAtencaoMl(d, rotulo, AGORA);
  assert.deepEqual(itens.map((i) => [i.severidade, i.titulo]), [
    ["critico", "BARBOURS: 1 reclamação com prazo vencido"],
    ["atencao", "KOKESHI: 2 reclamações vencem em 24 h"],
    ["atencao", "KOKESHI: 1 pergunta sem resposta"],
    ["info", "KOKESHI: 20 mensagens pós-venda não lidas"],
  ]);
  assert.equal(itens[0].detalhe, "a mais antiga venceu há 2 d");
  assert.equal(itens[1].detalhe, "a primeira vence em 5 h 00");
  assert.deepEqual(itensAtencaoMl(resp({ marcas: [linha("lescent")] }), rotulo, AGORA), []);
});

const bloco = (itens: [string, string, number][], extra = {}) => ({
  titulo: "t", estado: "dado" as const, total: itens.reduce((a, i) => a + i[2], 0), ajuda: "",
  itens: itens.map(([codigo, r, quantidade]) => ({ codigo, rotulo: r, natureza: "comprador" as const, quantidade, pct: 0, mapeado: codigo !== "novo" })),
  ...extra,
});

test("pareto: reclamacoes e cancelamentos juntos, ordenados, com tipo, resto e codigo novo sinalizado", () => {
  const v = montarParetoMl(resp({
    reclamacoes_motivos: bloco([["a", "Arrependimento do comprador", 60], ["novo", "novo", 5]]),
    cancelamentos_motivos: bloco([["b", "Sem estoque", 35]]),
  }));
  assert.equal(v.estado, "dado");
  assert.deepEqual(v.itens.map((i) => [i.rotulo, i.tipo, i.pct, i.largura]), [
    ["Arrependimento do comprador", "Reclamação", "60,0%", 100],
    ["Sem estoque", "Cancelamento", "35,0%", 58],
    ["novo", "Reclamação", "5,0%", 8],
  ]);
  assert.equal(v.itens[2].mapeado, false);
  assert.equal(v.itens[0].natureza, "Comprador");
  const muitos = montarParetoMl(resp({ reclamacoes_motivos: bloco(Array.from({ length: 12 }, (_, i) => [`m${i}`, `M${i}`, 12 - i] as [string, string, number])) }));
  assert.equal(muitos.itens.length, 10);
  assert.match(muitos.resto!, /^\+ 2 motivo\(s\) com 3 caso\(s\)/);
});

test("pareto: fonte caida e sem fonte nao viram 'nenhum problema'", () => {
  const erro = montarParetoMl(resp({ reclamacoes_motivos: { titulo: "t", estado: "erro", ajuda: "", itens: [], motivo_indisponivel: "x" }, cancelamentos_motivos: null }));
  assert.deepEqual([erro.estado, erro.motivo], ["erro", "Fonte indisponível nesta carga."]);
  const sem = montarParetoMl(resp({ reclamacoes_motivos: { titulo: "t", estado: "sem_fonte", ajuda: "", itens: [], motivo_indisponivel: "A coleta começou em 12/08/2026." }, cancelamentos_motivos: null }));
  assert.deepEqual([sem.estado, sem.motivo], ["sem_fonte", "A coleta começou em 12/08/2026."]);
  const vazio = montarParetoMl(resp({ reclamacoes_motivos: { titulo: "t", estado: "vazio_legitimo", ajuda: "", itens: [] }, cancelamentos_motivos: null }));
  assert.equal(vazio.estado, "vazio_legitimo");
});

test("ⓘ: a metodologia diz que e' calculo Torre, que a 1a acao e' parcial e que o tempo e' oficial", () => {
  assert.match(AJUDA_ML.reclamacao, /não é a taxa de reputação/);
  assert.match(AJUDA_ML.primeiraResposta, /PARCIAL/);
  assert.match(AJUDA_ML.primeiraResposta, /300/);
  assert.match(AJUDA_ML.tempoResposta, /OFICIAL/);
});

test("telas: a pagina escolhe o corpo pelo canal; o filtro tem os dois canais; sem legenda solta", () => {
  const pagina = readFileSync(new URL("../app/cx/page.tsx", import.meta.url), "utf8");
  assert.match(pagina, /lerCanalCx\(params\)/);
  assert.match(pagina, /canal === "ml" \? <CxMercadoLivre/);
  const filtros = readFileSync(new URL("../app/cx/FiltrosCx.tsx", import.meta.url), "utf8");
  assert.match(filtros, /CANAIS_CX\.map/);
  assert.match(filtros, /aria-pressed=\{ativo\}/);
  const tela = readFileSync(new URL("../app/cx/CxMercadoLivre.tsx", import.meta.url), "utf8");
  for (const peca of ["<Heroi", "<Faixa", "<FilaAtencao", "<Pareto", "<ProblemasPorMarca", "<AtendimentoPorLoja", "<MaisDetalhes"]) {
    assert.ok(tela.includes(peca), `falta ${peca}`);
  }
  assert.doesNotMatch(tela, /<StatCard|<SummaryPanel/);
  assert.match(tela, /torreFetch/);
  assert.doesNotMatch(tela, /\.devolucoes/, "devolucao nao e' desenhada: e' pendencia, nunca zero");
});
