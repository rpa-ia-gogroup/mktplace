/**
 * UI-EXPEDICAO-1 — Expedicao mais objetiva (escolhas 8 a 12 do usuario).
 *
 *  8. vencidos como numero principal (vermelho) + secundarios; backlog pequeno;
 *  9. cada numero uma vez: a lista vira "onde agir" e a barra de prazo sobe;
 * 10. texto explicativo vira "ⓘ"; fica o selo "inclui FBS";
 * 11. uma tabela so' de marcas (fila de agora + tendencia do periodo);
 * 12. o periodo no topo comanda a pagina; a fila de agora tem o selo "agora".
 */
import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  montarFilaPorConta,
  type PontoTendencia,
  type RespostaTendencia,
  type ResumoConta,
  type Totais,
} from "../src/lib/expedicao-contract.ts";

register("./helpers/tsx-loader.mjs", import.meta.url);

const RAIZ = join(import.meta.dirname, "..");
const fonte = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const CLIENTE = fonte("app/expedicao/ExpedicaoClient.tsx").replace(/\r\n/g, "\n");
const CABECALHO = fonte("src/components/expedicao/CabecalhoExpedicao.tsx");

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

// ---------------------------------------------------------------------------
// 9. "O que exige atenção agora" por conta (o antigo "onde agir" e' o 1o item)
// ---------------------------------------------------------------------------
test("fila por conta: da maior concentracao para a menor, 'X dos Y vencidos'", () => {
  const itens = montarFilaPorConta(
    totais({ overdue_count: 27 }),
    [
      conta("b", "kokeshi", { overdue_count: 2, stalled_count: 0, due_soon_count: 0 }),
      conta("a", "apice", { overdue_count: 25, stalled_count: 3, due_soon_count: 4 }),
    ],
    "shopee",
  );
  assert.deepEqual(itens.map((i) => i.conta), ["a", "b"]);
  assert.equal(itens[0].titulo, "ÁPICE: 25 dos 27 vencidos");
  assert.equal(itens[0].detalhe, "3 travados · 4 perto de vencer");
  assert.equal(itens[0].severidade, "critico");
  assert.equal(itens[0].lista, "vencidos");
  assert.equal(itens[0].valor, 25, "o dialogo abre com o numero da conta");
  assert.equal(itens[1].detalhe, undefined, "sem travado nem perto, sem detalhe");
});

test("fila por conta: um pedido so' no singular; todos numa conta", () => {
  const um = montarFilaPorConta(
    totais({ overdue_count: 1 }),
    [conta("a", "apice", { overdue_count: 1, stalled_count: 0 }), conta("b", "kokeshi", { overdue_count: 0, stalled_count: 0 })],
    "shopee",
  );
  assert.equal(um[0].titulo, "ÁPICE: o único pedido vencido");
  const todos = montarFilaPorConta(
    totais({ overdue_count: 8 }),
    [conta("a", "apice", { overdue_count: 0, stalled_count: 0 }), conta("b", "kokeshi", { overdue_count: 8, stalled_count: 0 })],
    "shopee",
  );
  assert.equal(todos[0].titulo, "KOKESHI: todos os 8 vencidos");
});

test("fila por conta: sem vencido, perto de vencer ou travados vira atencao", () => {
  const itens = montarFilaPorConta(
    totais({ overdue_count: 0 }),
    [
      conta("a", "apice", { overdue_count: 0, stalled_count: 0, due_soon_count: 0 }),
      conta("b", "kokeshi", { overdue_count: 0, stalled_count: 2, due_soon_count: 5 }),
    ],
    "shopee",
  );
  assert.equal(itens.length, 1, "conta sem nada aceso nao entra");
  assert.equal(itens[0].severidade, "atencao");
  assert.equal(itens[0].titulo, "KOKESHI: 5 perto de vencer · 2 travados");
  assert.equal(itens[0].lista, "perto_de_vencer");
});

test("fila por conta: conta unica nao repete os numeros do heroi e da faixa", () => {
  const itens = montarFilaPorConta(totais({ overdue_count: 10 }), [conta("a", "apice", { overdue_count: 10 })], "shopee");
  assert.equal(itens[0].titulo, "ÁPICE: concentra todos os vencidos");
  assert.doesNotMatch(itens[0].titulo, /\d/);
  assert.equal(itens[0].detalhe, undefined);
});

test("fila por conta: Mercado Livre sem prazo fala de +48 h (atencao, nunca critico); sem totais, nada", () => {
  const ml = montarFilaPorConta(
    totais({ over_48h_count: 9 }),
    [conta("1", "kokeshi", { over_48h_count: 9 }), conta("2", "apice", { over_48h_count: 0, stalled_count: 0 })],
    "mercadolivre",
  );
  assert.equal(ml[0].titulo, "KOKESHI: todos os 9 acima de 48 h");
  assert.equal(ml[0].severidade, "atencao");
  assert.equal(ml[0].lista, "acima_48h");
  assert.doesNotMatch(ml.map((i) => i.titulo).join(" "), /vencid/);
  assert.deepEqual(montarFilaPorConta(null, [conta("a", "apice")], "shopee"), [], "ausencia nao vira item");
});

// ---------------------------------------------------------------------------
// 8. heroi
// ---------------------------------------------------------------------------
const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { SecaoGerencial } = await import("../src/components/expedicao/SecoesExpedicao.tsx");
const { default: EvolucaoPorMarca } = await import("../src/components/expedicao/EvolucaoPorMarca.tsx");

test("heroi: % da fila antes do absoluto; zero nao pinta; +48 h e' ambar; marcas em alerta so' com alerta", () => {
  assert.match(CLIENTE, /const pctHeroi = valorHeroi !== null && backlogRisco !== null \? percentualDaFila\(valorHeroi, backlogRisco\) : null;/);
  assert.match(CLIENTE, /\{numero\(valorHeroi\)\} de \{numero\(backlogRisco\)\} na fila/);
  assert.match(CLIENTE, /\? valorHeroi > 0\s*\? \{ texto: "Com atraso", tom: "crit" \}\s*: \{ texto: "Em dia", tom: "ok" \}/);
  assert.match(CLIENTE, /qtdAlerta > 0 \? \(\s*<Chip ponto tom="atencao"/);
  // Ausencia (marca de varias contas, sem total) e' "—" com o motivo, nunca 0.
  assert.match(CLIENTE, /valor=\{valorHeroi === null \? null : pctHeroi\}/);
  assert.match(CLIENTE, /avisoRecorte \?\?\s*\(valorHeroi === null \? \(\s*"Medida não publicada nesta fotografia\."/);
  assert.match(CLIENTE, /pilula=\{\s*valorHeroi === null\s*\? null/);
});

test("secao: o ⓘ e o selo ficam fora do h3 (nome da secao = titulo)", () => {
  const html = renderToStaticMarkup(
    h(SecaoGerencial, { titulo: "Risco atual", dica: "Segundo a fotografia de ontem.", selo: h("em", null, "agora") }, "x"),
  );
  assert.match(html, /<h3[^>]*>Risco atual<\/h3>/);
  assert.match(html, /aria-label="Segundo a fotografia de ontem\."/);
  assert.match(html, /<em>agora<\/em>/);
});

// ---------------------------------------------------------------------------
// 11. tabela unica
// ---------------------------------------------------------------------------
const H = (hora: number) => `2026-10-21T${String(hora).padStart(2, "0")}:00:00Z`;
function ponto(c: string, marca: string, hora: string, backlog: number): PontoTendencia {
  return {
    snapshot_hour: hora, shop_account: c, brand: marca, refresh_batch_id: "b", observed_at: hora,
    source_watermark_at: null, source_advanced: true, run_status: "success", backlog_count: backlog,
    overdue_count: 0, due_within_24h_count: 0, on_time_count: 0, deadline_unavailable_count: backlog,
    over_48h_count: 7, slow_count: 0, zombie_count: 0, stalled_count: 2,
  };
}
function tendencia(points: PontoTendencia[]): RespostaTendencia {
  const horas = points.map((p) => p.snapshot_hour).sort();
  return {
    availability: "available", unavailable_reason: null, channel: "shopee", window_hours: 48,
    from_hour: horas[0] ?? null, to_hour: horas.at(-1) ?? null, points, truncated: false,
    limitations: {
      no_automation: true, load_mode: "manual_snapshot", snapshot_age_hours: 0.5,
      brands_not_covered: [], order_identifier_withheld: true, notes: [],
    },
  };
}
const linha = (c: string, titulo: string, backlog: number, vencidos: number | null) => ({
  conta: c, titulo, apelido: null, backlog, vencidos, acima48h: 3, travados: 1, barra: h("u", null, `barra-${c}`),
});

test("tabela unica: fotografia + tendencia; conta sem ponto continua na tabela", () => {
  const html = renderToStaticMarkup(
    h(EvolucaoPorMarca, {
      resposta: tendencia([ponto("a", "apice", H(13), 50), ponto("a", "apice", H(15), 60)]),
      fila: [linha("a", "ÁPICE", 61, 25), linha("b", "KOKESHI", 9, 0)],
    }),
  );
  for (const c of ["Backlog", "Vencidos", "Acima de 48 h", "Travados", "Prazo", "Tendência"]) {
    assert.match(html, new RegExp(`<th scope="col"[^>]*>${c}`), c);
  }
  // os numeros da linha sao os da FOTOGRAFIA (61), nao o ultimo ponto (60)
  // EXPEDICAO-TABELA-AMANHA: vencido em etiqueta vermelha
  assert.match(html, /ÁPICE<\/th><td[^>]*>61<\/td><td[^>]*><span class="relative"><span class="[^"]*bg-crit-soft[^"]*">25<\/span>/);
  assert.match(html, /<u>barra-a<\/u>/);
  assert.match(html, /KOKESHI<\/th><td[^>]*>9<\/td>/);
  assert.match(html, /sem ponto no período/);
  assert.equal((html.match(/<polyline/g) ?? []).length, 1, "so' a conta com serie tem linha");
});

test("tabela unica: sem tendencia ainda mostra as marcas; canal sem prazo sem coluna de vencidos", () => {
  const html = renderToStaticMarkup(
    h(EvolucaoPorMarca, { resposta: null, fila: [linha("1", "KOKESHI", 9, null)], rotuloBarra: "Distribuição" }),
  );
  assert.match(html, /KOKESHI/);
  assert.doesNotMatch(html, />Vencidos</);
  assert.match(html, />Distribuição</);
  assert.equal(renderToStaticMarkup(h(EvolucaoPorMarca, { resposta: null, fila: [] })), "");
});

// ---------------------------------------------------------------------------
// Fiacao na tela
// ---------------------------------------------------------------------------
test("tela: heroi, faixa e fila sem repetir numero; a barra de prazo e' o meio do heroi", () => {
  assert.match(CLIENTE, /const chaveDestaque = temPrazo \? "overdue" : "over48h";/);
  assert.match(CLIENTE, /<Panel[\s\S]*?\{meioHeroi\}\s*<\/Panel>/);
  assert.match(CLIENTE, /const meioHeroi = temPrazo \?[\s\S]*?\{barraDePrazo\(\)\}/);
  // A faixa nao repete o heroi: so' perto de vencer, +48 h e travados (sem prazo, travados).
  assert.match(CLIENTE, /const chavesDaFaixa = temPrazo \? \["due_soon", "over48h", "stalled"\] : \["stalled"\];/);
  // "Ver pedidos →" sempre visivel (nao so' no hover), abrindo a lista do heroi.
  assert.match(CLIENTE, /const abrirHeroi = destaque \? abrirLista\(destaque, LISTA_DO_KPI\[destaque\.chave\]\) : undefined;/);
  assert.match(CLIENTE, /onAbrir=\{abrirHeroi\}/);
  assert.doesNotMatch(CLIENTE, /opacity-0[^"]*group-hover:opacity-100/);
  // O 1o item da fila e' o antigo "onde agir"; ate' 6 itens.
  assert.match(CLIENTE, /\]\.slice\(0, MAX_ITENS_DA_FILA\);/);
});

test("tela: 'desatualizada' uma vez (cabecalho) e no ⓘ do heroi; 'inclui FBS' so' no heroi, com ⓘ", () => {
  // O selo de secao saiu; o aviso escrito fica no chip do cabecalho, e o
  // "confirme antes de agir" no ⓘ do heroi (via `quando`).
  assert.doesNotMatch(CLIENTE, /SeloLeitura/);
  assert.match(CLIENTE, /desatualizada: confirme antes de agir/);
  assert.match(CLIENTE, /const extrasHeroi = \[\s*quando,/);
  assert.match(CABECALHO, /<SeloAtualizado em=\{f\.publicadaEm\} atrasado=\{Boolean\(f\.publicadaEm && f\.desatualizada\)\}/);
  assert.match(CLIENTE, /incluiFbs \? AVISO_FILA_COM_FBS : null/);
  assert.match(CLIENTE, /\{incluiFbs \? <span data-testid="exp-aviso-fbs"> · com FBS<\/span> : null\}/);
  // Nas tabelas da fila publicada, a base fica ESCRITA no titulo ("· com FBS").
  assert.match(CLIENTE, /\{titulo\} · com FBS<\/span>/);
  assert.match(CLIENTE, /<TituloComFbs titulo="Backlog por marca"/);
  assert.match(CABECALHO, /<InfoDica texto=\{definicao\} \/>/);
});

test("tela: o periodo fica no topo, so' na visao do gestor", () => {
  assert.match(CLIENTE, /controles: visao === "gestor" \? controlePeriodo : undefined,/);
  // FILTROS-PADRAO: o Periodo e' o gatilho comum (`SeletorPeriodo`), com o "ⓘ" do periodo consultado.
  assert.match(CLIENTE, /const controlePeriodo = \([\s\S]*?<SeletorPeriodo\b/);
  assert.match(CLIENTE, /periodoConsultado \? <InfoDica texto=\{periodoConsultado\} \/> : undefined/);
});

test("LDR: trocar o periodo nao apaga a divisao da fila de agora; trocar a marca, sim", () => {
  const PAINEL = fonte("src/components/expedicao/LdrShopeePanel.tsx");
  assert.match(PAINEL, /if \(marcaDaResposta\.current !== marca\) setResposta\(null\);/);
  assert.match(PAINEL, /marcaDaResposta\.current = marca;\s*setResposta\(json\);/);
});

test("tabela unica: com fotografia, o apelido da conta e' o dela (uma numeracao so')", () => {
  const html = renderToStaticMarkup(
    h(EvolucaoPorMarca, {
      resposta: tendencia([ponto("a", "apice", H(13), 50), ponto("a", "apice", H(15), 60)]),
      fila: [
        { ...linha("a", "ÁPICE", 61, 25), apelido: "conta 1 de 2" },
        { ...linha("b", "ÁPICE", 9, 0), apelido: "conta 2 de 2" },
      ],
    }),
  );
  assert.match(html, /conta 1 de 2/);
  assert.match(html, /conta 2 de 2/);
});
