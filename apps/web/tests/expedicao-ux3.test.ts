/**
 * Gate EXPEDICAO-UX-3 — a mesma hierarquia gerencial nos tres canais, e o
 * filtro de marca.
 *
 * O que erra em silencio aqui: o filtro de marca mostrando o TOTAL DO CANAL
 * sob o nome de uma marca (a API da fila nao recorta `totals`); uma marca de
 * duas contas somada no frontend; o Mercado Livre ganhando "vencidos" ou LDR;
 * a Shopee apresentando a particao por prazo como se fosse LDR; e "Fonte
 * avançou: não" lido como falha.
 */
import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFINICAO_FILA,
  EXPLICACAO_LIMIAR_48H,
  EXPLICACAO_LIMIAR_48H_SEM_PRAZO,
  KPIS_RISCO_ATUAL,
  SEM_LDR_SHOPEE,
  SEM_PRAZO_CANAL_ML,
  definicaoDaFila,
  dicaDaSecaoPrazo,
  explicacaoLimiar48h,
  envelhecimentoDaFila,
  faixasDePrazo,
  montarFilaPorConta,
  montarRiscoAtual,
  recortarPorMarca,
  rotuloFonte,
  type FrescorMarca,
  type RespostaExpedicao,
  type ResumoConta,
  type Totais,
} from "../src/lib/expedicao-contract.ts";
import {
  DEFINICAO_TIKTOK,
  explicarIndisponivelComMarca,
  queryDoTikTok,
} from "../src/lib/expedicao-tiktok-contract.ts";
import { comMarcaNaQuery, lerMarca, urlComMarca } from "../src/lib/expedicao-ux.ts";
import { urlDoCanal } from "../src/lib/expedicao-canal.ts";

register("./helpers/tsx-loader.mjs", import.meta.url);

const RAIZ = join(import.meta.dirname, "..");
const fonte = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const CLIENTE = fonte("app/expedicao/ExpedicaoClient.tsx");
const TIKTOK = fonte("src/components/expedicao/TikTokDispatchPanel.tsx");
const CASCA = fonte("app/expedicao/ExpedicaoShell.tsx");
const BASE = "https://torre.example/expedicao";

function totais(over: Partial<Totais> = {}): Totais {
  return {
    backlog_count: 100, overdue_count: 10, due_within_24h_count: 20, on_time_count: 65,
    deadline_unavailable_count: 5, over_48h_count: 30, slow_count: 4, zombie_count: 1,
    stalled_count: 5, ...over,
  };
}
function conta(shop: string, brand: string, over: Partial<Totais> = {}): ResumoConta {
  return {
    shop_account: shop, brand, run_status: "success", source_watermark_at: null,
    source_advanced: true, snapshot_hour: "2026-10-21T17:00:00Z", ...totais(over),
  };
}
function frescor(brand: string, oldest: number | null): FrescorMarca {
  return {
    brand, freshness: "fresh", status: "pass", severity: "low", source_watermark_at: null,
    source_age_hours: 1, oldest_row_age_hours: oldest, accounts: 1, observed_at: null,
    measures: null, derived_from_batch: false,
  };
}
function resposta(contas: ResumoConta[], fr: FrescorMarca[] = [], naoCobertas: string[] = []): RespostaExpedicao {
  return {
    availability: "available", unavailable_reason: null, channel: "mercadolivre", snapshot: null,
    totals: totais({ backlog_count: 999 }), accounts: contas, freshness: fr,
    coverage: { expected_accounts: [], observed_accounts: [], missing_accounts: [], unexpected_accounts: [], accounts: [], brands_not_covered: naoCobertas },
    queue: [], pagination: null,
    limitations: { no_automation: true, load_mode: "manual_snapshot", snapshot_age_hours: 1, brands_not_covered: naoCobertas, order_identifier_withheld: true, notes: [] },
  };
}

// ===========================================================================
// 1. Filtro de marca na URL e nas requisicoes
// ===========================================================================
test("`?marca=` aceita so' slug e atravessa a troca de canal", () => {
  assert.equal(lerMarca("?marca=barbours"), "barbours");
  for (const v of ["BARBOURS", "<script>", "", "a b", "x".repeat(41)]) {
    assert.equal(lerMarca(`?marca=${encodeURIComponent(v)}`), null, v);
  }
  const u = new URL(urlComMarca(`${BASE}?channel=mercadolivre`, "kokeshi"));
  assert.equal(u.searchParams.get("marca"), "kokeshi");
  assert.equal(new URL(urlComMarca(u.toString(), null)).searchParams.has("marca"), false);
  // a troca de canal mexe so' em channel/dias: a marca fica
  const tk = new URL(urlDoCanal(`${BASE}?marca=kokeshi&dias=10`, "shopee", "tiktokshop"));
  assert.equal(tk.searchParams.get("marca"), "kokeshi");
});

test("a marca vai para a API como `brands` — a tela nao filtra serie sozinha", () => {
  assert.equal(comMarcaNaQuery("window_hours=72", "lescent"), "window_hours=72&brands=lescent");
  assert.equal(comMarcaNaQuery("window_hours=72", null), "window_hours=72");
  assert.equal(queryDoTikTok("coleta", 7, "kokeshi"), "/api/v1/expedicao/tiktok?event=coleta&days=7&brands=kokeshi");
  assert.equal(queryDoTikTok("coleta", 7), "/api/v1/expedicao/tiktok?event=coleta&days=7");
  assert.match(CLIENTE, /comMarcaNaQuery\(queryDaTendenciaEmDias\(janela, filtros\.channel\), marcaAtiva\)/);
  assert.match(CLIENTE, /aplicarFiltro\(f, \{ brands: alvo \}\)/);
  assert.match(TIKTOK, /queryDoTikTok\(evento, dias, marca\)/);
});

test("a casca le a marca na montagem e no voltar/avancar e a repassa aos dois corpos", () => {
  assert.match(CASCA, /setMarca\(lerMarca\(window\.location\.search\)\)/);
  assert.match(CASCA, /urlComMarca\(window\.location\.href, nova\)/);
  // Os dois corpos de canal + (CX-MKT-2/3) a faixa de LDR, que seguem a mesma
  // marca; a Performance oficial e' buscada na casca com a mesma marca.
  assert.equal((CASCA.match(/marca=\{marca\}/g) ?? []).length, 3);
  assert.match(CASCA, /<ExpedicaoClient[\s\S]*?marca=\{marca\}[\s\S]*?\/>/);
  assert.match(CASCA, /<TikTokDispatchPanel[\s\S]*?marca=\{marca\}[\s\S]*?\/>/);
  assert.match(CASCA, /<LdrTopo api=\{API\} marca=\{marca\} \/>/);
  assert.match(CASCA, /usePerformanceOficial\(API, canal, marca,/);
});

// ===========================================================================
// 2. Recorte por marca da fila: SELECAO, nunca soma
// ===========================================================================
test("sem marca: os totais do canal, como a API publicou", () => {
  const r = resposta([conta("1", "barbours")]);
  assert.equal(recortarPorMarca(r, null).totais?.backlog_count, 999);
});

test("marca de uma conta: a linha daquela conta, nao o total do canal", () => {
  const r = resposta([conta("1", "barbours", { backlog_count: 120 }), conta("2", "kokeshi", { backlog_count: 80 })]);
  const rec = recortarPorMarca(r, "kokeshi");
  assert.equal(rec.totais?.backlog_count, 80, "a API nao recorta totals: o canal tem 999");
  assert.deepEqual(rec.contas.map((c) => c.shop_account), ["2"]);
  assert.equal(rec.variasContas, false);
});

test("marca de duas contas: SEM total da marca (a tela nao soma contas)", () => {
  const r = resposta([conta("1", "barbours", { backlog_count: 120 }), conta("2", "barbours", { backlog_count: 30 })]);
  const rec = recortarPorMarca(r, "barbours");
  assert.equal(rec.totais, null);
  assert.equal(rec.variasContas, true);
  assert.equal(rec.contas.length, 2);
  assert.doesNotMatch(fonte("src/lib/expedicao-contract.ts").split("export function recortarPorMarca")[1].split("export ")[0], /reduce|\+=/);
  // e os KPIs viram ausencia, nunca zero
  for (const k of montarRiscoAtual(rec.totais, rec.frescor, "shopee")) {
    if (k.chave !== "marcas_alerta") assert.equal(k.valor, null, k.chave);
  }
});

test("marca fora da cobertura: ausencia, nao backlog zero", () => {
  const rec = recortarPorMarca(resposta([conta("1", "apice")], [], ["kokeshi"]), "kokeshi");
  assert.equal(rec.semConta, true);
  assert.equal(rec.foraDaCobertura, true);
  assert.equal(rec.totais, null);
  // IDENTIDADE-GERENCIAL: dito como item informativo de "O que exige atenção agora".
  assert.match(CLIENTE, /severidade: "info",[\s\S]*?"não é coberta pela fonte deste canal — não é backlog zero"/);
});

// ===========================================================================
// 3. Risco atual: so' o que o canal sustenta
// ===========================================================================
// EXPEDICAO-VENCE-AMANHA: o proximo dia de prazo entrou depois de "vence em 24 h".
// EXPEDICAO-PERTO-DE-VENCER: "vence em 24 h" e o proximo dia de prazo viraram
// UM cartao, "perto de vencer" (hoje + proximo dia de prazo).
test("Shopee: seis indicadores, com vencidos e perto de vencer", () => {
  assert.deepEqual(
    [...KPIS_RISCO_ATUAL.shopee],
    ["backlog", "overdue", "due_soon", "over48h", "stalled", "marcas_alerta"],
  );
  assert.equal(montarRiscoAtual(totais(), [], "shopee").length, 6);
});

test("Mercado Livre: nenhum vencido, nenhum 'vence em 24 h'", () => {
  const ml = montarRiscoAtual(totais(), [], "mercadolivre").map((k) => k.chave);
  assert.deepEqual(ml, ["backlog", "over48h", "stalled", "marcas_alerta"]);
  assert.ok(!ml.includes("overdue") && !ml.includes("due24h"));
});

test("acima de 48 h e' limiar interno nos dois canais, nunca SLA", () => {
  for (const canal of ["shopee", "mercadolivre"] as const) {
    const k = montarRiscoAtual(totais(), [], canal).find((x) => x.chave === "over48h")!;
    assert.match(k.rotulo, /limiar interno/i);
    assert.match(String(k.nota), /não é SLA/i);
  }
});

test("a nota de 48 h do Mercado Livre nao fala de vencidos nem da Shopee", () => {
  // Achado do QA: o cartao do ML exibia "o prazo contratual aparece em
  // Vencidos / Vence em 24h, que vem do ship_by_date da Shopee".
  const ml = montarRiscoAtual(totais(), [], "mercadolivre").find((x) => x.chave === "over48h")!;
  assert.doesNotMatch(String(ml.nota), /Shopee|ship_by_date|Vencidos|Vence em 24h/);
  assert.match(CLIENTE, /explicacaoLimiar48h\(filtros\.channel, temPrazo\)/);
  assert.equal(explicacaoLimiar48h("mercadolivre", false), EXPLICACAO_LIMIAR_48H_SEM_PRAZO);
  assert.equal(explicacaoLimiar48h("shopee", true), EXPLICACAO_LIMIAR_48H);
  // EXPEDICAO-ML-PRAZO: com SLA, a nota do ML cita o prazo DELE, nunca a Shopee.
  assert.doesNotMatch(explicacaoLimiar48h("mercadolivre", true), /Shopee|ship_by_date/);
});

test("o item de atencao nomeia a marca, nao o seller_id", () => {
  const um = montarFilaPorConta(totais({ over_48h_count: 9 }), [conta("2227056661", "kokeshi", { over_48h_count: 9 })], "mercadolivre");
  assert.match(um[0].titulo, /^KOKESHI:/);
  assert.doesNotMatch(um.map((i) => i.titulo).join(" "), /2227056661/);
  // duas contas da mesma marca: a conta volta, para dizer QUAL delas
  const dois = montarFilaPorConta(
    totais({ over_48h_count: 9 }),
    [conta("111", "barbours", { over_48h_count: 2 }), conta("222", "barbours", { over_48h_count: 7 })],
    "mercadolivre",
  );
  assert.equal(dois[0].titulo, "BARBOURS (conta 222): 7 dos 9 acima de 48 h");
});

// ===========================================================================
// 4. Prazo
// ===========================================================================
test("Shopee: particao do backlog por situacao de prazo, que fecha o total", () => {
  const f = faixasDePrazo(totais())!;
  assert.deepEqual(f.map((x) => x.chave), ["overdue", "due24h", "on_time", "sem_prazo"]);
  assert.equal(f.reduce((s, x) => s + x.valor, 0), 100);
  assert.equal(faixasDePrazo(null), null, "sem totais, sem faixa");
});

test("Shopee: a secao diz que NAO ha LDR e por que", () => {
  assert.match(SEM_LDR_SHOPEE, /LDR/);
  assert.match(SEM_LDR_SHOPEE, /só os\s+pedidos em aberto/);
  // IDENTIDADE-GERENCIAL: sem a LDR na tela, o aviso vai para o ⓘ do heroi.
  assert.match(CLIENTE, /!ldrNaSecao \? dicaDaSecaoPrazo\(filtros\.channel\) : null/);
  assert.match(CLIENTE, /<Ajuda chave=\{chaveAjudaHeroi\} extras=\{extrasHeroi\} \/>/);
  assert.equal(dicaDaSecaoPrazo("shopee"), SEM_LDR_SHOPEE);
});

test("Mercado Livre: prazo indisponivel pelo canal e envelhecimento da fila", () => {
  assert.match(
    SEM_PRAZO_CANAL_ML,
    /^Indisponível neste canal: o Mercado Livre não publica prazo de despacho na fonte atual\./,
  );
  assert.doesNotMatch(SEM_PRAZO_CANAL_ML, /Prazo indisponível pelo canal/, "frase antiga fora");
  assert.match(SEM_PRAZO_CANAL_ML, /Não há vencidos nem LDR/);
  const e = envelhecimentoDaFila(totais({ over_48h_count: 30 }), [frescor("a", 50), frescor("b", 200), frescor("c", null)])!;
  assert.deepEqual(e, { acima48h: 30, backlog: 100, maisAntigo: { marca: "b", horas: 200 } });
  assert.equal(envelhecimentoDaFila(totais(), [frescor("a", null)])!.maisAntigo, null, "idade ausente nao vira zero");
  assert.match(CLIENTE, /!temPrazo \? SEM_PRAZO_CANAL_ML :/);
  // O envelhecimento da fila: +48 h no heroi; o pedido mais antigo na faixa (ausente = "—").
  assert.match(CLIENTE, /rotulo=\{temPrazo \? "Vencidos" : "Acima de 48 h"\}/);
  assert.match(CLIENTE, /rotulo="Pedido mais antigo em fila"\s*valor=\{envelhecimento\?\.maisAntigo \? formatarHoras\(envelhecimento\.maisAntigo\.horas\) : "—"\}/);
});

test("TikTok: a secao de prazo e' a LDR, com o evento (coleta/despacho) nomeado", () => {
  assert.match(TIKTOK, /const secaoPrazo = \(comLdr: boolean\) =>\s*ldr \? \(\s*<SecaoGerencial\s+titulo="Prazo"/);
  assert.match(TIKTOK, /evento: \$\{ROTULO_EVENTO\[evento\]\}/);
  assert.match(TIKTOK, /rotulo="Evento"/);
});

// ===========================================================================
// 5. Mesma hierarquia e mesma linguagem
// ===========================================================================
test("os tres canais tem uma definicao curta da medicao", () => {
  assert.match(DEFINICAO_FILA.shopee, /ship_by_date/);
  assert.match(DEFINICAO_FILA.mercadolivre, /não publica prazo/);
  assert.match(DEFINICAO_TIKTOK, /coleta e despacho/);
  assert.match(CLIENTE, /definicao=\{definicaoDaFila\(filtros\.channel, fotografiaDoPrazo\)\}/);
  // Sem SLA na fotografia, a frase de sempre; com SLA, a do prazo do ML.
  assert.equal(definicaoDaFila("mercadolivre", null), DEFINICAO_FILA.mercadolivre);
  assert.equal(definicaoDaFila("shopee", null), DEFINICAO_FILA.shopee);
  assert.match(definicaoDaFila("mercadolivre", { deadline_published: true }), /SLA oficial do Mercado Livre/);
  assert.match(TIKTOK, /definicao=\{DEFINICAO_TIKTOK\}/);
});

test("as secoes tem o mesmo titulo nos tres canais", () => {
  // EXPEDICAO-TIKTOK-PADRAO: o "Risco atual" e o "Backlog por marca" do
  // TikTok moram no componente dos pedidos em aberto.
  // IDENTIDADE-GERENCIAL: o "Risco atual" virou o heroi "Vencidos" nos tres.
  const ABERTOS = fonte("src/components/expedicao/TikTokPedidosAbertos.tsx");
  assert.match(CLIENTE, /rotulo=\{temPrazo \? "Vencidos" : "Acima de 48 h"\}/);
  assert.match(ABERTOS, /<Heroi\s+rotulo="Vencidos"/);
  assert.match(CLIENTE, /titulo="Backlog por marca"/);
  assert.match(ABERTOS, /titulo="Backlog por marca"/);
  assert.match(TIKTOK, /<HeroiTikTok abertos=\{abertos\}/);
  assert.match(TIKTOK, /<BacklogPorMarcaTikTok /);
  for (const f of [CLIENTE, TIKTOK]) {
    assert.match(f, /titulo="Prazo"/);
  }
  assert.match(TIKTOK, /Concentração por marca/);
  assert.match(CLIENTE, /Concentração por marca/);
});

test("'Fonte avançou' virou linguagem de gestor", () => {
  assert.equal(rotuloFonte(true), "Recebeu atualização");
  assert.equal(rotuloFonte(false), "Sem atualização nova");
  assert.doesNotMatch(CLIENTE, /Fonte avançou|\(metadado\)/);
});

test("na concentracao a marca e' a identidade; a conta e' detalhe discreto", () => {
  assert.match(CLIENTE, /\{brandLabel\(a\.brand\)\}\s*\{a\.shop_account !== a\.brand \? \(/);
  assert.match(CLIENTE, /text-xs font-normal text-ink-faint">\s*conta \{a\.shop_account\}/);
  assert.doesNotMatch(CLIENTE, /<th scope="col">Conta<\/th>\s*<th scope="col">Marca<\/th>/);
});

test("TikTok com marca sem serie: nao diz 'nenhuma fotografia publicada'", () => {
  assert.equal(
    explicarIndisponivelComMarca("no_series_published", "kokeshi"),
    "Sem série do TikTok para esta marca na janela consultada.",
  );
  assert.match(explicarIndisponivelComMarca("no_series_published", null), /nenhuma fotografia foi publicada/);
});

test("TikTok: lojas acima da meta sem base suficiente e' ausencia", () => {
  // O cartao virou o chip da Concentracao: sem base, o chip nao existe (nunca "0").
  assert.match(TIKTOK, /\{dados\?\.brands\.length \? \(\s*<Chip/);
  assert.match(TIKTOK, /title=\{`De \$\{formatarInteiro\(dados\.brands\.length\)\} com base suficiente\.`\}/);
});

// ===========================================================================
// 6. Renderizacao do seletor de marca e do estado de frescor
// ===========================================================================
const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { SeletorMarca, ChipsFotografia } = await import("../src/components/expedicao/CabecalhoExpedicao.tsx");

test("seletor de marca: 'Todas', o mapa canonico e marcas novas do payload", () => {
  const html = renderToStaticMarkup(
    h(SeletorMarca, { marca: "kokeshi", marcasPresentes: ["marca-nova"], aoTrocar: () => {} }),
  );
  assert.match(html, /<label[^>]*for="([^"]+)"[^>]*>Marca<\/label>/);
  assert.match(html, /<option value="">Todas as marcas<\/option>/);
  for (const r of ["BARBOURS", "KOKESHI", "LESCENT", "RITUÁRIA", "ÁPICE", "MARCA-NOVA"]) {
    assert.ok(html.includes(`>${r}</option>`), r);
  }
  assert.match(html, /min-h-11/);
});

// EXPEDICAO-ULTIMA-ATUALIZACAO (30/10/2026): no topo, so' "Última atualização";
// "Atualizada"/"Fotografia"/"Fonte até" sairam. "Desatualizada" continua escrito.
test("topo: so' 'Última atualização'; 'Desatualizada' escrito quando velha", () => {
  const base = { rotulo: "Fotografia", publicadaEm: "2026-10-21T12:00:00Z", idade: "1.2 h", fonteLidaAte: "2026-10-21T11:00:00Z" };
  const fresca = renderToStaticMarkup(h(ChipsFotografia, { fotografia: { ...base, desatualizada: false } }));
  assert.match(fresca, /Última atualização <time dateTime="2026-10-21T12:00:00Z">\d{2}\/\d{2}, \d{2}:\d{2}<\/time>/);
  assert.doesNotMatch(fresca, />Atualizada|>Fotografia|Fonte até|Desatualizada/);
  // a idade e a fonte nao somem: vao para o hover do selo
  assert.match(fresca, /title="Publicada há 1\.2 h\. Fonte lida até/);
  const velha = renderToStaticMarkup(h(ChipsFotografia, { fotografia: { ...base, desatualizada: true } }));
  assert.match(velha, />Desatualizada</);
});

// ===========================================================================
// T-0010 — `?` das metricas e catalogo unico de definicoes
// ===========================================================================
import {
  AJUDA_CANAL_SEM_PRAZO,
  CAMPOS_DEFINICAO,
  DEFINICOES,
  KPIS_DA_FILA,
  METRICAS_POR_CANAL,
  chaveDoKpiDaFila,
  ehChaveMetrica,
} from "../src/lib/expedicao-definicoes.ts";
import { montarKpis } from "../src/lib/expedicao-contract.ts";

const { default: AjudaMetrica } = await import("../src/components/expedicao/AjudaMetrica.tsx");
const { KpiComAjuda } = await import("../src/components/expedicao/KpiComAjuda.tsx");

test("catalogo: toda metrica exibida tem os seis campos, curtos", () => {
  for (const [canal, chaves] of Object.entries(METRICAS_POR_CANAL)) {
    for (const c of chaves) {
      assert.ok(ehChaveMetrica(c), `${canal}: ${c} fora do catalogo`);
    }
  }
  for (const [chave, def] of Object.entries(DEFINICOES)) {
    assert.ok(def.nome.length > 2, chave);
    for (const [campo] of CAMPOS_DEFINICAO) {
      const t = def[campo];
      assert.ok(t.trim().length > 0, `${chave}.${campo} vazio`);
      assert.ok(t.length <= 260, `${chave}.${campo} longo demais (${t.length})`);
    }
  }
});

test("catalogo: todo KPI da fila, nos dois canais, tem `?`", () => {
  for (const canal of ["shopee", "mercadolivre"] as const) {
    const exibidos = montarKpis(totais(), [frescor("a", 1)], canal).map((k) => k.chave);
    for (const k of exibidos) {
      assert.ok(chaveDoKpiDaFila(canal, k), `${canal}.${k} sem definicao`);
      assert.ok((KPIS_DA_FILA as readonly string[]).includes(k), k);
    }
  }
});

test("catalogo: toda chave citada nas telas existe", () => {
  const arquivos = [
    "app/expedicao/ExpedicaoClient.tsx",
    "src/components/expedicao/TikTokDispatchPanel.tsx",
    "src/components/expedicao/LdrShopeePanel.tsx",
  ];
  let total = 0;
  for (const rel of arquivos) {
    for (const m of fonte(rel).matchAll(/(?:ajuda|chave)="([a-z_.]+)"/g)) {
      total += 1;
      assert.ok(ehChaveMetrica(m[1]), `${rel}: ${m[1]}`);
    }
  }
  assert.ok(total >= 12, `poucas chaves encontradas: ${total}`);
  // cada KPI do TikTok e da LDR Shopee passa pelo componente com `?`
  for (const rel of ["src/components/expedicao/TikTokDispatchPanel.tsx", "src/components/expedicao/LdrShopeePanel.tsx"]) {
    assert.doesNotMatch(fonte(rel), /<KpiTile\b/, `${rel} tem KPI sem ?`);
  }
  assert.match(CLIENTE, /ajuda=\{chaveDoKpiDaFila\(canal, kpi\.chave\)\}/);
});

test("LDR Shopee: indicador interno, nao o Account Health oficial", () => {
  const d = DEFINICOES["shopee.ldr"];
  assert.match(`${d.definicao} ${d.limitacoes}`, /interno/i);
  assert.match(d.limitacoes, /não é o índice oficial de Account Health/);
});

test("Mercado Livre: o `?` diz que nao ha SLA/LDR e nao inventa numero", () => {
  // Sem SLA na fotografia: a secao Prazo diz que nao ha o que medir.
  const sem = DEFINICOES[AJUDA_CANAL_SEM_PRAZO.prazo];
  assert.match(sem.limitacoes, /não publica prazo de despacho/);
  assert.match(sem.limitacoes, /SLA nem LDR/);
  // EXPEDICAO-ML-PRAZO: os cartoes de prazo do ML contam sobre o SLA oficial
  // e dizem de onde ele vem; nenhum cita a Shopee nem inventa numero.
  for (const c of ["mercadolivre.overdue", "mercadolivre.due24h", "mercadolivre.due_soon"] as const) {
    const d = DEFINICOES[c];
    assert.match(d.limitacoes, /SLA de despacho do envio/, c);
    assert.match(d.limitacoes, /indisponível/, c);
    assert.doesNotMatch(`${d.definicao} ${d.formula}`, /Shopee|ship_by_date/, c);
    assert.doesNotMatch(`${d.definicao} ${d.formula}`, /\d+\s*%/, "nenhum numero inventado");
  }
  assert.match(DEFINICOES["mercadolivre.over48h"].limitacoes, /não é SLA/);
});

test("R21: +48 h conta do marco de cada canal (Shopee = pagamento; ML = pronto para despacho)", () => {
  const sh = DEFINICOES["shopee.over48h"];
  assert.match(sh.definicao, /48 h desde o pagamento/);
  assert.match(sh.formula, /pay_time/);
  const ml = DEFINICOES["mercadolivre.over48h"];
  // no ML `paid_at` e' nulo de proposito: o relogio e' `date_ready_to_ship`
  assert.match(ml.definicao, /48 h desde que o envio ficou pronto para despacho/);
  assert.match(ml.formula, /date_ready_to_ship/);
  assert.doesNotMatch(`${ml.definicao} ${ml.formula}`, /pagamento|pay_time/);
});

test("R21: zumbi declara a idade (> 30 dias), sem afirmar que a fonte parou", () => {
  for (const [c, marco] of [["shopee", /pay_time/], ["mercadolivre", /date_ready_to_ship/]] as const) {
    const d = DEFINICOES[`${c}.zombie`];
    assert.match(d.definicao, /abertos há mais de 30 dias na fonte/, c);
    assert.match(d.formula, /> 30 dias \(720 h\)/, c);
    assert.match(d.formula, marco, c);
    assert.match(d.limitacoes, /Mede só a idade/, c);
    assert.doesNotMatch(`${d.definicao} ${d.formula} ${d.limitacoes}`, /pararam|parou|parad/, c);
  }
});

test("o ⓘ da metrica: InfoDica focavel com definicao e limitacao, sem a metodologia", () => {
  // Objetividade: o popover de seis campos virou o "ⓘ" do resto da Torre.
  const d = DEFINICOES["tiktok.ldr"];
  const html = renderToStaticMarkup(h(AjudaMetrica, { chave: "tiktok.ldr" }));
  const rotulo = html.match(/<span tabindex="0" role="img" aria-label="([^"]+)"/)?.[1];
  assert.ok(rotulo, html);
  assert.equal(rotulo, `${d.definicao} ${d.limitacoes}`);
  assert.match(rotulo!, /Indicador interno/, "a ressalva que muda a leitura fica");
  for (const campo of ["formula", "fonte", "janela", "cobertura"] as const) {
    assert.ok(!html.includes(d[campo]), `${campo} fora da tela`);
  }
  assert.doesNotMatch(html, /role="dialog"|<button|Fechar|Definição: /);
  assert.doesNotMatch(html, /<div\b/, "so' span: o ⓘ mora dentro de <p>");
});

test("nenhum elemento da Expedicao combina hidden= com classe de display (B1)", () => {
  // No Tailwind 3.4 ".block"/".flex" vencem o "[hidden]" do preflight: o
  // elemento "escondido" aparece. Esconder = nao renderizar.
  for (const rel of [
    "src/components/expedicao/AjudaMetrica.tsx",
    "src/components/expedicao/JornadaPedidos.tsx",
    "src/components/expedicao/LayoutExpedicao.tsx",
    "src/components/expedicao/KpiComAjuda.tsx",
    "src/components/expedicao/TikTokDispatchPanel.tsx",
    "src/components/expedicao/LdrShopeePanel.tsx",
    "app/expedicao/ExpedicaoClient.tsx",
    "app/expedicao/ExpedicaoShell.tsx",
  ]) {
    // Cada tag de abertura JSX, inteira (atributos em varias linhas).
    for (const tag of fonte(rel).match(/<[a-zA-Z]+\b(?:[^<>{}]|\{(?:[^{}]|\{[^{}]*\})*\})*>/g) ?? []) {
      if (/\shidden=/.test(tag)) {
        assert.doesNotMatch(tag, /\b(block|flex|grid|inline-flex|inline-block)\b/, `${rel}: ${tag}`);
      }
    }
  }
});

// ===========================================================================
// Revisao T-0010 — origem do numero (oficial x Torre x indisponivel) e "ⓘ"
// nos cabecalhos ordenaveis da "LDR por loja"
// ===========================================================================
import { ROTULO_ORIGEM } from "../src/lib/expedicao-definicoes.ts";

const { default: SortHeaderComAjuda } = await import("../src/components/expedicao/SortHeaderComAjuda.tsx");

test("catalogo: toda definicao declara a origem do numero", () => {
  const validas = Object.keys(ROTULO_ORIGEM);
  for (const [chave, def] of Object.entries(DEFINICOES) as [string, { origem?: string; formula: string; fonte: string; limitacoes: string }][]) {
    assert.ok(def.origem && validas.includes(def.origem), `${chave} sem origem declarada`);
    if (def.origem === "torre") {
      assert.doesNotMatch(def.formula, /Não se aplica/, `${chave}: calculo da Torre sem regra`);
    }
    if (def.origem === "oficial") {
      assert.ok(def.fonte.trim().length > 0, `${chave}: oficial sem fonte`);
    }
    if (def.origem === "indisponivel") {
      assert.match(def.formula, /Não se aplica/, `${chave}: indisponivel com formula`);
      assert.match(def.limitacoes, /não publica/, `${chave}: indisponivel sem motivo`);
    }
  }
});

test("origem: classificacao pelos fatos do codigo", () => {
  assert.equal(DEFINICOES["shopee.ldr"].origem, "torre", "LDR Shopee nao e' Account Health");
  assert.equal(DEFINICOES["tiktok.ldr"].origem, "torre");
  // 4% e' REFERENCIA do TikTok, nao a fonte do numero
  for (const c of ["tiktok.ldr", "tiktok.lojas_acima_meta"] as const) {
    const d = DEFINICOES[c];
    assert.match(d.referencia ?? "", /4%.*TikTok/, c);
    assert.doesNotMatch(d.fonte, /TikTok Shop|4%/, `${c}: a meta nao e' fonte`);
  }
  for (const k of ["backlog", "over48h", "stalled", "slow", "zombie"]) {
    assert.equal(DEFINICOES[`shopee.${k}` as keyof typeof DEFINICOES].origem, "torre", `shopee.${k}`);
    assert.equal(DEFINICOES[`mercadolivre.${k}` as keyof typeof DEFINICOES].origem, "torre", `mercadolivre.${k}`);
  }
  assert.equal(DEFINICOES["shopee.overdue"].origem, "torre");
  // EXPEDICAO-ML-PRAZO: o prazo e' o SLA do ML; a contagem e' da Torre. So'
  // a secao "sem prazo" continua indisponivel.
  for (const c of ["mercadolivre.overdue", "mercadolivre.due24h", "mercadolivre.due_soon"] as const) {
    assert.equal(DEFINICOES[c].origem, "torre", c);
  }
  assert.equal(DEFINICOES["mercadolivre.prazo"].origem, "indisponivel");
  // Hoje nenhuma metrica da Expedicao e' copiada da plataforma.
  assert.deepEqual(Object.entries(DEFINICOES).filter(([, d]) => d.origem === "oficial"), []);
});

test("LDR por loja: ⓘ nos cabecalhos ordenaveis, fora do botao de ordenar", () => {
  const props = {
    rotulo: "LDR",
    coluna: "rate",
    sort: { column: "rate", direction: "desc" as const },
    aoOrdenar: () => {},
    ajuda: "tiktok.ldr" as const,
  };
  const html = renderToStaticMarkup(h(SortHeaderComAjuda, props));
  assert.match(html, /^<th scope="col" aria-sort="descending"/);
  const i = html.indexOf('role="img"');
  assert.ok(i > 0, html);
  // Antes do ⓘ, o botao de ordenar ja' fechou: nada focavel dentro de botao.
  const antes = html.slice(0, i);
  assert.equal((antes.match(/<button\b/g) ?? []).length, 1, "so' o botao de ordenar");
  assert.equal((antes.match(/<\/button>/g) ?? []).length, 1, "o botao de ordenar fecha antes do ⓘ");
  assert.match(html, /min-h-11/, "alvo de 44 px do ordenar");

  // Arvore React: so' o botao de ordenar tem onClick, e o ⓘ nao mora nele.
  type No = { type: unknown; props: { onClick?: () => void; children?: unknown } };
  const ordenadas: string[] = [];
  const raiz = SortHeaderComAjuda({ ...props, aoOrdenar: (c: string) => ordenadas.push(c) }) as unknown as No;
  const filhos = (n: No): No[] =>
    ([] as unknown[]).concat(n.props.children ?? []).filter((x): x is No => typeof x === "object" && x !== null && "props" in x);
  const todos: { no: No; dentroDoOrdenar: boolean }[] = [];
  const andar = (n: No, dentro: boolean) => {
    todos.push({ no: n, dentroDoOrdenar: dentro });
    const ehOrdenar = n.type === "button";
    for (const f of filhos(n)) andar(f, dentro || ehOrdenar);
  };
  andar(raiz, false);
  const comClique = todos.filter((t) => typeof t.no.props.onClick === "function");
  assert.equal(comClique.length, 1, "um unico onClick: o de ordenar");
  assert.equal(comClique[0].no.type, "button");
  const ajuda = todos.find((t) => t.no.type === AjudaMetrica);
  assert.ok(ajuda, "o ⓘ e' o AjudaMetrica");
  assert.equal(ajuda!.dentroDoOrdenar, false, "o ⓘ nao esta' dentro do botao de ordenar");
  comClique[0].no.props.onClick!();
  assert.deepEqual(ordenadas, ["rate"]);
});

test("LDR por loja: Venciam, Atrasados e LDR com ⓘ; Loja segue no SortHeader", () => {
  const ini = TIKTOK.indexOf("LDR por loja no período");
  const tabela = TIKTOK.slice(ini, TIKTOK.indexOf("</thead>", ini));
  for (const [coluna, chave] of [["base", "tiktok.venciam"], ["late", "tiktok.atrasaram"], ["rate", "tiktok.ldr"]]) {
    assert.match(
      tabela,
      new RegExp(`<SortHeaderComAjuda\\s+rotulo="[^"]+"\\s+coluna="${coluna}"[^>]*ajuda="${chave.replace(".", "\\.")}"`),
      coluna,
    );
  }
  assert.match(tabela, /<SortHeader\s+rotulo="Loja"/);
  assert.doesNotMatch(tabela, /<SortHeader rotulo="(Venciam|Atrasados|LDR)"/);
});

// EXPEDICAO-VENCE-AMANHA: o ⓘ saiu da linha de comparacao para o lado do rotulo.
test("KpiComAjuda poe o ⓘ ao lado do rotulo do KPI", () => {
  const html = renderToStaticMarkup(
    h(KpiComAjuda, { ajuda: "shopee.backlog", rotulo: "Backlog total", valor: "1.820", comparacao: "Fila aberta." }),
  );
  assert.match(html, /Backlog total<span tabindex="0" role="img" aria-label="Cada pedido pago que ainda não foi expedido\./);
  assert.match(html, /<p class="mt-1\.5 text-xs leading-snug text-ink-muted">Fila aberta\.<\/p>/);
});

// ===========================================================================
// T-0021 — ML, secao Prazo: frase no padrao "Indisponível neste canal: …"
// ===========================================================================
test("ML Prazo: 'Indisponível neste canal: …' no ⓘ do heroi (a frase antiga sai)", () => {
  // IDENTIDADE-GERENCIAL: a secao "Prazo" do ML (sem SLA) esvaziou — +48 h e'
  // o heroi e o pedido mais antigo e' a faixa —, e a frase foi para o ⓘ do heroi.
  assert.match(CLIENTE, /!temPrazo \? SEM_PRAZO_CANAL_ML :/);
  assert.match(CLIENTE, /<Ajuda chave=\{chaveAjudaHeroi\} extras=\{extrasHeroi\} \/>/);
  const html = renderToStaticMarkup(h(AjudaMetrica, { chave: "mercadolivre.over48h", extras: [SEM_PRAZO_CANAL_ML] }));
  // O leitor de tela le' a frase inteira pelo `aria-label` do ⓘ.
  assert.match(html, /aria-label="[^"]*Indisponível neste canal: o Mercado Livre não publica prazo de despacho na fonte atual\./);
  assert.doesNotMatch(CLIENTE, /Prazo indisponível pelo canal/, "frase antiga fora");
  assert.doesNotMatch(CLIENTE, /<Panel titulo="Prazo de despacho"/, "painel vazio nao volta");
});

// ===========================================================================
// T-0033 — o ⓘ abre pelo teclado mesmo quando o foco rola a pagina
// ===========================================================================
// Tab ate' um ⓘ fora da tela: o onFocus abre, o navegador rola ate' o ⓘ e o
// evento dessa rolagem (no quadro seguinte) fechava o balao na hora — 22 de
// 22 em producao. Sem DOM aqui: a decisao mora em `rolagemAoAbrir`, com o
// relogio de quadros injetado; a ligacao no componente e' lida da fonte.
const { rolagemAoAbrir } = await import("../src/components/ui/InfoDica.tsx");
const DICA = fonte("src/components/ui/InfoDica.tsx");

function quadros() {
  const fila = new Map<number, () => void>();
  let seq = 0;
  return {
    quadro: (cb: () => void) => {
      fila.set(++seq, cb);
      return seq;
    },
    cancelar: (id: number) => void fila.delete(id),
    rodar() {
      const agora = [...fila.entries()];
      fila.clear();
      for (const [, cb] of agora) cb();
    },
    pendentes: () => fila.size,
  };
}

test("T-0033: aberto pelo foco, a rolagem do proprio foco reposiciona em vez de fechar", () => {
  const q = quadros();
  let pos = 0;
  let fechou = 0;
  const r = rolagemAoAbrir(true, () => pos++, () => fechou++, q.quadro, q.cancelar);
  // a rolagem do foco chega antes do primeiro requestAnimationFrame
  r.aoRolar();
  r.aoRolar();
  assert.equal(fechou, 0, "a rolagem do foco nao fecha");
  assert.equal(pos, 2, "cada evento da rolagem do foco recalcula a posicao");
  q.rodar();
  assert.equal(pos, 2);
  q.rodar();
  assert.equal(pos, 3, "ao fim do segundo quadro a posicao e' recalculada");
  assert.equal(q.pendentes(), 0);
  // dali em diante a rolagem e' do usuario: fecha (sem balao orfao)
  r.aoRolar();
  assert.equal(fechou, 1);
  assert.equal(pos, 3);
});

test("T-0033: aberto pelo mouse, rolar fecha na hora (comportamento de antes)", () => {
  const q = quadros();
  let pos = 0;
  let fechou = 0;
  const r = rolagemAoAbrir(false, () => pos++, () => fechou++, q.quadro, q.cancelar);
  assert.equal(q.pendentes(), 0, "sem janela de quadros");
  r.aoRolar();
  assert.equal(fechou, 1);
  assert.equal(pos, 0);
});

test("T-0033: fechar antes dos dois quadros cancela o recalculo pendente", () => {
  const q = quadros();
  let pos = 0;
  const r = rolagemAoAbrir(true, () => pos++, () => {}, q.quadro, q.cancelar);
  q.rodar(); // primeiro quadro agenda o segundo
  r.parar(); // Escape/blur/desmontagem
  q.rodar();
  assert.equal(pos, 0, "nada reposiciona um balao ja' fechado");
  assert.equal(q.pendentes(), 0);
});

test("T-0033: o InfoDica liga a rolagem por `rolagemAoAbrir` e sabe se abriu pelo foco", () => {
  assert.match(DICA, /porFoco\.current = e\.type === "focus";/);
  assert.match(DICA, /onFocus=\{abrir\}/);
  assert.match(DICA, /onMouseEnter=\{abrir\}/);
  assert.match(DICA, /const rolagem = rolagemAoAbrir\(porFoco\.current, posicionar, fechar\);/);
  assert.match(DICA, /window\.addEventListener\("scroll", rolagem\.aoRolar, true\);/);
  assert.match(DICA, /window\.removeEventListener\("scroll", rolagem\.aoRolar, true\);/);
  assert.match(DICA, /rolagem\.parar\(\);/);
  assert.doesNotMatch(DICA, /addEventListener\("scroll", fechar/, "rolar nao fecha direto");
  // resize e Escape continuam fechando direto
  assert.match(DICA, /window\.addEventListener\("resize", fechar\);/);
  assert.match(DICA, /if \(e\.key === "Escape"\) fechar\(\);/);
  // a posicao e' calculada na abertura (antes do primeiro quadro)
  assert.match(DICA, /\n {4}posicionar\(\);\n/);
});

// ---------------------------------------------------------------------------
// CARDS-KPIBAND — serie e delta dos cards (Shopee/ML por hora; LDR do TikTok)
// ---------------------------------------------------------------------------
test("card da fila: % por hora soma as contas da MESMA hora e o delta e' em p.p. com sinal", async () => {
  const { serieDaFila, haQuantoTempo } = await import("../src/lib/expedicao-evolucao.ts");
  const p = (hora: string, conta: string, backlog: number, over: number) =>
    ({ snapshot_hour: hora, shop_account: conta, backlog_count: backlog, over_48h_count: over, stalled_count: 0, overdue_count: 0 }) as never;
  const horas = ["2026-11-08T10:00:00Z", "2026-11-08T11:00:00Z", "2026-11-08T12:00:00Z", "2026-11-08T13:00:00Z"];
  const pontos = horas.flatMap((h, i) => [p(h, "a", 100, 10 + i * 2), p(h, "b", 100, 10)]);
  const s = serieDaFila(pontos, ["a", "b"], "over_48h_count");
  assert.deepEqual(s.serie, [10, 11, 12, 13]);
  assert.equal(s.antesPct, 10);
  assert.equal(s.deltaPp, 3); // subiu 3 p.p.: piora (lower_is_better pinta de vermelho)
  const caiu = serieDaFila([...pontos].reverse().map((x, i) => ({ ...(x as object), snapshot_hour: horas[3 - Math.floor(i / 2)] }) as never), ["a", "b"], "over_48h_count");
  assert.ok(caiu.deltaPp !== null);
  assert.equal(haQuantoTempo(3), "há 72 h");
  assert.equal(haQuantoTempo(1), "há 24 h");
  assert.equal(haQuantoTempo(7), "há 7 dias");
});

test("card da fila: hora sem alguma conta nao entra; serie curta ou parcial fica sem sparkline/delta", async () => {
  const { serieDaFila } = await import("../src/lib/expedicao-evolucao.ts");
  const p = (hora: string, conta: string) =>
    ({ snapshot_hour: hora, shop_account: conta, backlog_count: 100, over_48h_count: 5, stalled_count: 0, overdue_count: 0 }) as never;
  const h = (n: number) => `2026-11-08T${String(10 + n).padStart(2, "0")}:00:00Z`;
  // Primeira hora sem a conta "b": sem delta (nunca soma parcial); 4 completas ainda dao serie.
  const semPrimeira = [p(h(0), "a"), ...[1, 2, 3, 4].flatMap((n) => [p(h(n), "a"), p(h(n), "b")])];
  const s1 = serieDaFila(semPrimeira, ["a", "b"], "over_48h_count");
  assert.equal(s1.deltaPp, null);
  assert.equal(s1.antesPct, null);
  assert.equal(s1.serie?.length, 4);
  // So' 3 horas completas: sem sparkline.
  const curta = [1, 2, 3].flatMap((n) => [p(h(n), "a"), p(h(n), "b")]);
  assert.equal(serieDaFila(curta, ["a", "b"], "over_48h_count").serie, undefined);
  // Conta esperada que nunca aparece: nada.
  const s3 = serieDaFila(curta, ["a", "b", "c"], "over_48h_count");
  assert.deepEqual(s3, { serie: undefined, deltaPp: null, antesPct: null });
  // Sem contas ou sem pontos: nada.
  assert.equal(serieDaFila([], ["a"], "over_48h_count").serie, undefined);
});

test("card LDR do TikTok: sparkline so' com vencimentos fechados com taxa; delta so' com a janela anterior medida", async () => {
  const { serieDaLdr, deltaDaLdr } = await import("../src/lib/expedicao-tiktok-contract.ts");
  const dia = (due_date: string, rate: number | null, is_mature: boolean) =>
    ({ due_date, rate, is_mature, base: 1, late: 0, pending_overdue: 0, pending_on_time: 0, above_target: false, is_critical: false });
  assert.deepEqual(
    serieDaLdr([dia("2026-11-05", 0.03, true), dia("2026-11-03", 0.05, true), dia("2026-11-06", 0.2, false), dia("2026-11-04", null, true)]),
    [5, 3],
  );
  const d = deltaDaLdr({ rate: 0.1208, previous: { from: "2026-10-24", to: "2026-10-31", days: 7, rate: 0.0125, base: 41227, late: 515, mature_due_days: 5, reason: null } });
  assert.ok(d && Math.abs(d.pp - 10.83) < 1e-9 && Math.abs(d.antes - 1.25) < 1e-9);
  assert.equal(deltaDaLdr({ rate: 0.1, previous: { from: "x", to: "y", days: 7, rate: null, base: null, late: null, mature_due_days: 0, reason: "sem_historico" } }), null);
  assert.equal(deltaDaLdr({ rate: 0.1, previous: undefined }), null); // API antiga
  assert.equal(deltaDaLdr({ rate: null, previous: null }), null);
});
