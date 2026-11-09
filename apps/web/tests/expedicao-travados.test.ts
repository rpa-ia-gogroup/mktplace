/**
 * EXPEDICAO-TRAVADOS-1 — % de travados, popup com os pedidos travados e a
 * Expedicao com menos texto (pedido do usuario).
 */
import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { avisosDeCobertura, montarBarraDeQualidade } from "../src/lib/expedicao-contract.ts";

register("./helpers/tsx-loader.mjs", import.meta.url);

const RAIZ = join(import.meta.dirname, "..");
const fonte = (rel: string) => readFileSync(join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");
const CLIENTE = fonte("app/expedicao/ExpedicaoClient.tsx");

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { motivoDoTravado, percentualDaFila, queryDosTravados, LIMITE_TRAVADOS } = await import(
  "../src/lib/expedicao-travados.ts"
);
const { default: BarraDeQualidade } = await import("../src/components/expedicao/BarraDeQualidade.tsx");
const { default: EvolucaoPorMarca } = await import("../src/components/expedicao/EvolucaoPorMarca.tsx");

test("% da fila: uma casa decimal; sem base, nada", () => {
  assert.equal(percentualDaFila(17, 320), "5,3%");
  assert.equal(percentualDaFila(0, 100), "0,0%");
  assert.equal(percentualDaFila(3, 0), null);
});

test("motivo do travado em linguagem de gestor, sem inventar", () => {
  assert.equal(motivoDoTravado({ is_slow_vs_baseline: true, is_source_zombie: false }), "Mais lento que o normal da conta");
  assert.equal(motivoDoTravado({ is_slow_vs_baseline: true, is_source_zombie: true }), "Aberto há mais de 30 dias");
  assert.equal(motivoDoTravado({ is_slow_vs_baseline: false, is_source_zombie: false }), "Travado");
});

test("a lista usa a rota da fila: so' travados, mais antigos primeiro, da marca e da conta", () => {
  const q = new URLSearchParams(queryDosTravados("mercadolivre", "kokeshi", "123"));
  assert.equal(q.get("channel"), "mercadolivre");
  assert.equal(q.get("brands"), "kokeshi");
  assert.equal(q.get("accounts"), "123");
  assert.equal(q.get("situacao"), "stalled");
  assert.equal(q.get("order_by"), "oldest");
  assert.equal(q.get("limit"), String(LIMITE_TRAVADOS));
  const todas = new URLSearchParams(queryDosTravados("shopee", null, null));
  assert.equal(todas.get("brands"), null);
  assert.equal(todas.get("accounts"), null);
});

test("tela: cartao de travados com % e abre a lista; popup montado uma vez", () => {
  // IDENTIDADE-GERENCIAL: cada cartao da faixa e' um KpiTile "gerencial"
  // clicavel; o valor e' o % da fila e a contagem vem embaixo.
  assert.match(CLIENTE, /stalled: "travados"/);
  assert.match(CLIENTE, /const cartoesDaFaixa = chavesDaFaixa[\s\S]*?\.map\(cartaoDaFaixa\);/);
  assert.match(CLIENTE, /const pct = !ausente && base != null \? percentualDaFila\(v \?\? 0, base\) : null;/);
  assert.match(CLIENTE, /valor=\{k\.valorTexto \?\? \(ausente \? "—" : \(pct \?\? numero\(v \?\? 0\)\)\)\}/);
  assert.match(CLIENTE, /`\$\{numero\(v \?\? 0\)\} \$\{v === 1 \? "pedido" : "pedidos"\}`/);
  assert.match(CLIENTE, /onAbrir=\{abrirLista\(k, LISTA_DO_KPI\[k\.chave\]\)\}/);
  assert.equal((CLIENTE.match(/<TravadosDialog\b/g) ?? []).length, 1);
  assert.match(CLIENTE, /pctTravados: percentualDaFila\(a\.stalled_count, a\.backlog_count\)/);
});

test("tabela: o numero de travados abre a lista e mostra o %", () => {
  let aberto = 0;
  const html = renderToStaticMarkup(
    h(EvolucaoPorMarca, {
      resposta: null,
      fila: [
        {
          conta: "a", titulo: "ÁPICE", apelido: null, backlog: 320, vencidos: 25, acima48h: 16, travados: 17,
          pctTravados: "5,3%", aoVerTravados: () => { aberto += 1; }, barra: null,
        },
        {
          conta: "b", titulo: "BARBOURS", apelido: null, backlog: 208, vencidos: 0, acima48h: 3, travados: 0,
          pctTravados: "0,0%", barra: null,
        },
      ],
    }),
  );
  assert.match(html, /aria-label="Ver os 17 pedidos travados de ÁPICE"[^>]*>17<\/button>/);
  // IDENTIDADE-GERENCIAL: o % sai da tela e vai para title + sr-only da celula.
  assert.match(html, /title="5,3% da fila"/);
  assert.match(html, /<span class="sr-only"> · 5,3% da fila<\/span>/);
  assert.doesNotMatch(html, />5,3%</);
  assert.doesNotMatch(html, /0,0%/, "zero travado nao mostra %");
  assert.equal(aberto, 0);
});

test("menos texto: Prazo so' com LDR (em Mais detalhes); jornada so' com coorte; convite curto", () => {
  assert.match(CLIENTE, /\{ldrNaSecao \? \(\s*<SecaoGerencial titulo="Prazo">/);
  assert.equal((CLIENTE.match(/<SecaoGerencial titulo="Prazo"/g) ?? []).length, 1);
  assert.match(CLIENTE, /<JornadaPedidos [^>]*compacta \/>/);
  assert.match(CLIENTE, /conteudo="Lista de pedidos, mais críticos e fonte por conta\."/);
  const JORNADA = fonte("src/components/expedicao/JornadaPedidos.tsx");
  assert.match(JORNADA, /if \(!comFila && !comCoorte\) return null;/);
});

test("marca fora da cobertura vira linha curta com ⓘ, sem caixa", () => {
  const avisos = avisosDeCobertura({
    expected_accounts: [], observed_accounts: [], missing_accounts: [], unexpected_accounts: [],
    accounts: [], brands_not_covered: ["kokeshi"],
  });
  const barra = montarBarraDeQualidade(null, avisos, []);
  const html = renderToStaticMarkup(h(BarraDeQualidade, { barra }));
  assert.match(html, /KOKESHI fora da cobertura/);
  assert.match(html, /aria-label="KOKESHI não é coberta por esta fonte/);
  assert.doesNotMatch(html, /role="status"/, "informacao nao e' alerta");
});

test("revisao #124: popup sem coluna inutil, remonta por alvo e diz quando inclui FBS", () => {
  const POPUP = fonte("src/components/expedicao/TravadosDialog.tsx");
  assert.match(POPUP, /\{temPrazo \? <th scope="col">Prazo<\/th> : null\}/);
  assert.match(POPUP, /alvo\?\.incluiFbs \? "Lista da fila publicada, com pedidos FBS/);
  assert.match(POPUP, /estado\.tipo === "ok" && !temCodigo \? "Por segurança/);
  assert.match(POPUP, /\{rodape \? <p className="text-xs text-ink-faint">\{rodape\}<\/p> : null\}/);
  assert.match(CLIENTE, /<TravadosDialog\s+key=\{\s*alvoTravados\s*\?/);
  assert.match(CLIENTE, /incluiFbs: divisao !== null/);
  const JORNADA = fonte("src/components/expedicao/JornadaPedidos.tsx");
  // revisao #127: o modo compacto mantem o aviso de marca e as limitacoes
  const compacto = JORNADA.slice(JORNADA.indexOf("if (compacta) {"));
  assert.match(compacto, /avisoDeMarcaNaoAplicada\(marca, resposta\)/);
  // EXPEDICAO-SEM-TEXTAO: as limitacoes da fila seguem acessiveis, no "ⓘ".
  assert.match(JORNADA, /<AjudaMetrica\s+chave="jornada\.fila_aberta"\s+extras=\{\[\s*\.\.\.f\.limitacoes,/);
});


test("etapa (T-0015): rotulo do contrato, so' com etapa real, contagem na ordem do fluxo", async () => {
  const { rotuloDaEtapa, temEtapaPublicada, travadosPorEtapa, ETAPAS_DO_PEDIDO } = await import(
    "../src/lib/expedicao-travados.ts"
  );
  assert.equal(rotuloDaEtapa("aguardando_coleta"), "Aguardando coleta");
  assert.equal(rotuloDaEtapa("valor_novo"), "valor_novo", "desconhecido aparece cru");
  assert.equal(rotuloDaEtapa(null), "—");
  assert.equal(temEtapaPublicada([{ etapa: null }, { etapa: "nao_publicada" }]), false);
  assert.equal(temEtapaPublicada([{ etapa: "a_preparar" }]), true);
  assert.deepEqual(
    travadosPorEtapa([{ etapa: "aguardando_coleta" }, { etapa: "a_preparar" }, { etapa: "aguardando_coleta" }]).map(
      (e) => [e.rotulo, e.n],
    ),
    [["A preparar", 1], ["Aguardando coleta", 2]],
  );
  // o dominio e' o mesmo da API (expedicao_service.ETAPAS_FILA)
  const API = readFileSync(join(RAIZ, "../api/app/services/expedicao_service.py"), "utf8");
  for (const [k, rotulo] of ETAPAS_DO_PEDIDO) assert.ok(API.includes(`("${k}", "${rotulo}")`), k);
});

test("popup: coluna e resumo de etapa so' com etapa publicada", () => {
  const POPUP = fonte("src/components/expedicao/TravadosDialog.tsx");
  assert.match(POPUP, /\{temEtapa \? <th scope="col">Etapa<\/th> : null\}/);
  assert.match(POPUP, /data-testid="exp-travados-por-etapa"/);
  assert.match(POPUP, /Onde estão travados/);
});

// ---------------------------------------------------------------------------
// EXPEDICAO-NUMERO-PEDIDO — numero real do pedido e CSV dos travados
// ---------------------------------------------------------------------------
const { numeroDoPedido, mostrarColunaReferencia, rotuloDoNumero } = await import("../src/lib/expedicao-contract.ts");
const { colunasDoCsvTravados, linhaDoCsvTravados, csvDosTravados, nomeDoCsvTravados } = await import(
  "../src/lib/expedicao-travados.ts"
);

function travado(extra: Record<string, unknown> = {}) {
  return {
    order_number: "261027NUB4AHWG", order_ref: null, shop_account: "barbours", brand: "barbours",
    created_at: "2026-10-26T15:00:00Z", paid_at: null, dispatch_deadline: "2026-10-30T02:59:00Z",
    deadline_source: "native", deadline_status: "overdue", operational_age_status: "over_48h",
    is_slow_vs_baseline: true, is_source_zombie: false, is_stalled: true, hours_open: 91.2,
    hours_overdue: 12, logistic_type: null, carrier: "Full", source_ingested_at: null,
    source_freshness_status: "fresh", timestamp_quality: "ok", etapa: "aguardando_coleta",
    ...extra,
  } as never;
}

test("numero do pedido: o real primeiro, o order_ref como reserva, nunca vazio", () => {
  assert.equal(numeroDoPedido({ order_number: "47951836990", order_ref: "abc" }), "47951836990");
  assert.equal(numeroDoPedido({ order_number: null, order_ref: "abc" }), "abc");
  assert.equal(numeroDoPedido({ order_number: "", order_ref: null }), null);
  assert.equal(mostrarColunaReferencia([travado()]), true);
  assert.equal(mostrarColunaReferencia([travado({ order_number: null })]), false);
});

test("CSV dos travados: numero, etapa, dias em pt-BR, prazo em Brasilia, transportadora", () => {
  const r = linhaDoCsvTravados(travado(), "shopee");
  assert.equal(r["Pedido"], "261027NUB4AHWG");
  assert.equal(r["Canal"], "Shopee");
  assert.equal(r["Marca"], "BARBOURS");
  assert.equal(r["Etapa"], "Aguardando coleta");
  assert.equal(r["Dias em aberto"], "3,8");
  assert.equal(r["Por que travou"], "Mais lento que o normal da conta");
  assert.equal(r["Prazo de envio"], "29/10/2026 23:59");
  assert.equal(r["Transportadora"], "Full");
  // etapa ainda nao publicada sai vazia, nunca como texto de aviso
  assert.equal(linhaDoCsvTravados(travado({ etapa: "nao_publicada" }), "shopee")["Etapa"], null);

  const csv = csvDosTravados([travado()], "shopee");
  assert.ok(csv.startsWith("﻿"), "BOM para o Excel pt-BR");
  const [cab, linha] = csv.slice(1).split("\r\n");
  assert.equal(cab, colunasDoCsvTravados("shopee").join(";"));
  assert.match(linha, /^261027NUB4AHWG;Shopee;BARBOURS;Aguardando coleta;3,8;/);
});

test("Mercado Livre: o identificador e' o ENVIO, nunca chamado de pedido", () => {
  assert.equal(rotuloDoNumero("shopee"), "Pedido");
  assert.equal(rotuloDoNumero("mercadolivre"), "Envio");
  assert.equal(colunasDoCsvTravados("mercadolivre")[0], "Envio");
  const r = linhaDoCsvTravados(travado({ order_number: "47951836990" }), "mercadolivre");
  assert.equal(r["Envio"], "47951836990");
  assert.equal(r["Pedido"], undefined);
  assert.match(csvDosTravados([travado({ order_number: "47951836990" })], "mercadolivre"), /^\ufeffEnvio;Canal;/);
  assert.match(CLIENTE, /\{mostrarRef && <th scope="col" className="pl-4">\{rotuloDoNumero\(filtros\.channel\)\}<\/th>\}/);
});

test("nome do arquivo: canal, marca e dia de Brasilia", () => {
  const d = new Date("2026-10-31T01:00:00Z"); // ainda 30/10 em Brasilia
  assert.equal(nomeDoCsvTravados("shopee", "barbours", d), "travados-shopee-barbours-2026-10-30.csv");
  assert.equal(nomeDoCsvTravados("mercadolivre", null, d), "travados-mercadolivre-todas-2026-10-30.csv");
});

test("popup: coluna Pedido com o numero e botao Exportar CSV", () => {
  const POPUP = fonte("src/components/expedicao/TravadosDialog.tsx");
  assert.match(POPUP, /\{temCodigo \? <th scope="col">\{rotuloDoNumero\(canal\)\}<\/th> : null\}/);
  assert.match(POPUP, /\{numeroDoPedido\(l\) \?\? "—"\}/);
  assert.match(POPUP, /data-testid="exp-travados-csv"/);
  // EXPEDICAO-VENCE-AMANHA: o mesmo botao exporta a lista aberta (travados por padrao).
  assert.match(POPUP, /baixarCsv\(csvDaLista\(linhas, canal, lista\), nomeDoCsv\(lista, canal, alvo\.marca, new Date\(\)\)\)/);
  assert.match(POPUP, /URL\.revokeObjectURL\(url\)/);
  // numero nunca vira link para o marketplace
  assert.doesNotMatch(POPUP, /href=\{[^}]*numeroDoPedido/);
});

test("popup de travados largo e sem quebra nas colunas curtas (sem rolagem lateral)", () => {
  const POPUP = fonte("src/components/expedicao/TravadosDialog.tsx");
  const DIALOGO = fonte("src/components/KpiDrilldownDialog.tsx");
  assert.match(POPUP, /title=\{alvo\?\.titulo \?\? "Travados"\} largura="larga">/);
  assert.match(DIALOGO, /largura === "larga" \? "sm:max-w-4xl" : "sm:max-w-lg"/);
  assert.match(DIALOGO, /largura = "padrao"/, "sem a prop, os outros popups nao mudam");
  assert.match(POPUP, /\[&_th\]:whitespace-nowrap/);
  assert.match(POPUP, /<td className="whitespace-nowrap font-medium text-ink">\{rotuloDaEtapa\(l\.etapa\)\}<\/td>/);
});

// ---------------------------------------------------------------------------
// EXPEDICAO-POPUP-ETAPAS — consolidado por etapa no topo do popup
// ---------------------------------------------------------------------------
test("consolidado por etapa: % sobre o TOTAL da lista, da maior para a menor, 'Sem etapa' nunca some", async () => {
  const { consolidadoPorEtapa, pctDaEtapa } = await import("../src/lib/expedicao-travados.ts");
  const itens = consolidadoPorEtapa(
    [
      { stage: "a_preparar", count: 40 },
      { stage: null, count: 3 },
      { stage: "nao_publicada", count: 2 },
      { stage: "aguardando_coleta", count: 1420 },
    ],
    1465,
  );
  assert.deepEqual(itens.map((i) => i.n), [1420, 40, 5]);
  assert.equal(itens[2].rotulo, "Sem etapa");
  assert.equal(pctDaEtapa(1420, 1465), "96,9%");
  assert.equal(pctDaEtapa(1465, 1465), "100%");
  // Producao 09/11 (TikTok, vence ter 10/11): 20.505 e 7 de 20.512.
  assert.equal(pctDaEtapa(20505, 20512), ">99,9%");
  assert.equal(pctDaEtapa(7, 20512), "<0,1%");
  assert.equal(pctDaEtapa(0, 10), "0%");
  // A quebra cobre so' parte do total: o resto e' "Sem etapa", nunca escondido.
  const parcial = consolidadoPorEtapa([{ stage: "aguardando_coleta", count: 90 }], 100);
  assert.deepEqual(parcial.map((i) => i.n), [90, 10]);
  assert.equal(parcial[1].rotulo, "Sem etapa");
  // API antiga (sem quebra) ou lista vazia: nada.
  assert.deepEqual(consolidadoPorEtapa(null, 100), []);
  assert.deepEqual(consolidadoPorEtapa([], 0), []);
});

test("consolidado TikTok: etapa de cada lista do resumo; 100% numa etapa aparece; API antiga, nada", async () => {
  const { etapasDaLista } = await import("../src/lib/expedicao-tiktok-abertos.ts");
  const t = {
    open: 0, awaiting_shipment: 0, awaiting_collection: 0, on_hold: 0, overdue: 0, overdue_shipment: 0,
    overdue_collection: 0, due_today: 1465, due_next_day: 0, on_time: 0, over_48h: 0,
  };
  assert.deepEqual(etapasDaLista("due_today", t, 1465), [], "API antiga: sem a etapa da lista");
  const com = { ...t, due_today_collection: 1465, due_today_shipment: 0 };
  assert.deepEqual(etapasDaLista("due_today", com, 1465), [{ rotulo: "Aguardando coleta", n: 1465 }]);
  const misto = { ...t, over_48h: 10, over_48h_collection: 7, over_48h_shipment: 3 };
  assert.deepEqual(etapasDaLista("over_48h", misto, 10).map((e) => e.n), [7, 3]);
  assert.deepEqual(etapasDaLista("awaiting_shipment", t, 5).map((e) => e.n), [5]);
});
