/**
 * Aba CX (04/11/2026) — filtros, montagem do chat, payload e menu.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AJUDA_CX,
  carregarCxShopee,
  duracao,
  carregarPedidosMotivo,
  csvPedidosMotivo,
  hrefCx,
  lerFiltrosCx,
  montarAtendimentoCx,
  montarPareto,
  montarAvaliacaoLoja,
  montarPedidosMotivo,
  montarStatusMarcas,
  simbolosMeta,
  textoSemComparacao,
  marcaUnica,
  resumoFiltrosCx,
  reais,
  chipsCx,
  avisoColetaChat,
  heroiCx,
  itensAtencaoCx,
  MAX_ITENS_ATENCAO,
  resumoCxGerencial,
  deltaPp,
  medianaRisco,
  mediaResposta,
  linhasDrilldownCx,
  foraDaCurva,
  metaCurta,
  problemaNoPayloadCx,
  tipoDoItem,
  urlCxShopee,
  urlPedidosMotivo,
  type ChatShopee,
  type PedidosMotivoResponse,
} from "../src/lib/cx.ts";
import { CX_NAV, getRouteTitle, navSections } from "../src/components/shell/nav-config.ts";

const MARCAS = ["apice", "barbours", "kokeshi", "lescent", "rituaria"];
const rotulo = (m: string) => m.toUpperCase();

function metrica(codigo: string, rotuloM: string, valor: number, situacao: "ok" | "fora", meta: string) {
  return {
    codigo, rotulo: rotuloM, grupo: "Atendimento", valor, unidade: "pct" as const, quantidade: null,
    anterior: valor - 1, meta: 60, comparador: ">=", rotulo_meta: meta, situacao, ajuda: null,
  };
}

function chat(): ChatShopee {
  return {
    estado: "dado",
    fonte: "Shopee",
    sem_foto: [{ marca: "lescent", motivo: "Sem fotografia capturada ainda." }],
    contas: [
      {
        marca: "apice", dia: "2026-11-04", capturado_em: null, nivel: "Bom", tom: "bom", termometro: 3,
        termometro_max: 4, resumo: null, destaques: [], avisos: [],
        metricas: [metrica("shopee_11", "Taxa de resposta do chat", 82.65, "ok", "Meta >= 60")],
      },
      {
        marca: "rituaria", dia: "2026-11-04", capturado_em: null, nivel: "Bom", tom: "atencao", termometro: 3,
        termometro_max: 4, resumo: null, destaques: [], avisos: [],
        metricas: [
          metrica("shopee_11", "Taxa de resposta do chat", 45.31, "fora", "Meta >= 60"),
          { ...metrica("shopee_22", "Nota da loja", 4.93, "ok", "Meta >= 4.5"), unidade: "nota" as const },
        ],
      },
    ],
  };
}

test("filtros: marca fora da allowlist e periodo invalido caem no padrao", () => {
  assert.deepEqual(lerFiltrosCx({ brands: "Apice", dias: "7" }, MARCAS), { marca: "apice", dias: 7 });
  assert.deepEqual(lerFiltrosCx({ brands: "<x>", dias: "15" }, MARCAS), { marca: null, dias: 30 });
  assert.equal(hrefCx({ marca: null, dias: 30 }), "/cx");
  assert.equal(hrefCx({ marca: "apice", dias: 90 }), "/cx?brands=apice&dias=90");
  assert.equal(urlCxShopee("http://api", { marca: null, dias: 30 }), "http://api/api/v1/cx/shopee?dias=30");
});

function payload() {
  return {
    gerado_em: "2026-11-04T19:00:00Z",
    janela: { inicio: "2026-10-05", fim: "2026-11-03", dias: 30 },
    chat: chat(),
    atendimento: {
      canal: "shopee",
      cobertura: { marcas: ["apice"], fora: [] },
      indicadores: [],
      marcas: [],
      pendencias: [],
      atualizado_em: null,
    },
  };
}

test("payload: valida chat e atendimento", () => {
  assert.equal(problemaNoPayloadCx(payload()), null);
  assert.equal(problemaNoPayloadCx({ ...payload(), chat: undefined }), "chat ausente");
  assert.equal(problemaNoPayloadCx({ ...payload(), atendimento: null }), "atendimento ausente");
});

test("carregar: nunca lanca; erro HTTP vira motivo", async () => {
  const ok = await carregarCxShopee({ marca: null, dias: 30 },
    (async () => new Response(JSON.stringify(payload()), { status: 200 })) as typeof fetch, "http://api");
  assert.equal(ok.ok, true);
  const falha = await carregarCxShopee({ marca: null, dias: 30 },
    (async () => new Response("x", { status: 503 })) as typeof fetch, "http://api");
  assert.deepEqual(falha, { ok: false, motivo: "A API respondeu 503." });
});

test("menu: CX fica em Operações logo depois da Expedição e tem titulo proprio", () => {
  const ops = navSections({ expedicao: true, cx: true }).find((s) => s.label === "Operações")!;
  const hrefs = ops.pages.map((p) => p.href);
  assert.equal(hrefs.indexOf("/cx"), hrefs.indexOf("/expedicao") + 1);
  assert.deepEqual(CX_NAV, { href: "/cx", label: "CX" });
  assert.equal(getRouteTitle("/cx"), "CX");
  const navList = readFileSync(new URL("../src/components/shell/NavList.tsx", import.meta.url), "utf8");
  assert.match(navList, /cx: true,/);
});

test("aba CX busca pelo navegador (torreFetch), nunca no servidor", () => {
  // 04/11/2026: com NEXT_PUBLIC_API_URL=/torre-api um fetch no servidor nao resolve.
  const pagina = readFileSync(new URL("../app/cx/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(pagina, /carregarCxShopee/);
  const conteudo = readFileSync(new URL("../app/cx/CxConteudo.tsx", import.meta.url), "utf8");
  assert.match(conteudo, /^"use client";/);
  assert.match(conteudo, /carregarCxShopee\(\{ marca, dias \}, torreFetch as typeof fetch\)/);
});

// ---------------------------------------------------------------------------
// Pagina enxuta (04/11/2026): Atendimento (planilha 1.2) e Pareto (1.1)
// ---------------------------------------------------------------------------
function comConversas(dias = 30) {
  const p = payload();
  return {
    ...p,
    janela: { ...p.janela, dias },
    chat: {
      ...p.chat,
      nao_lidas_estado: "dado" as const,
      nao_lidas: [
        { marca: "apice", valor: 4, capturado_em: null, conversas_7d: 40, conversas_30d: 200, aguardando_resposta: 3, conversas_truncado: false },
        { marca: "rituaria", valor: 6, capturado_em: null, conversas_7d: null, conversas_30d: null, aguardando_resposta: null, conversas_truncado: null },
      ],
    },
    atendimento: {
      ...p.atendimento,
      marcas: [
        { marca: "apice", pedidos: 1000, cancelamentos: 20, taxa_cancelamento_pct: 2, cancelamentos_comprador: 5, em_devolucao: 1 },
        { marca: "rituaria", pedidos: 300, cancelamentos: 3, taxa_cancelamento_pct: 1, cancelamentos_comprador: 1, em_devolucao: 0 },
      ],
      motivos: {
        titulo: "Motivos de cancelamento", estado: "dado" as const, total: 23, ajuda: "", excluidos: 9,
        rotulo_excluidos: "pedidos não pagos cancelados pela Shopee (fora da contagem)", motivo_indisponivel: null,
        itens: [{ codigo: "sem_estoque", rotulo: "Sem estoque", natureza: "vendedor" as const, quantidade: 23, pct: 100, mapeado: true }],
      },
    },
    devolucoes: {
      estado: "dado" as const, fonte: "x", total: 12, aceitas: 8, em_andamento: 2, canceladas: 2, reembolsado: 450.5,
      motivos: {
        titulo: "Motivos de devolução", estado: "dado" as const, total: 10, ajuda: "", excluidos: 2,
        rotulo_excluidos: "pedidos de devolução cancelados pelo próprio comprador (fora dos motivos)", motivo_indisponivel: null,
        itens: [
          { codigo: "not_receipt", rotulo: "Não recebeu o pedido", natureza: "logistica" as const, quantidade: 7, pct: 70, mapeado: true },
          { codigo: "change_mind", rotulo: "Mudou de ideia", natureza: "comprador" as const, quantidade: 3, pct: 30, mapeado: true },
        ],
      },
      marcas: [{ marca: "apice", devolucoes: 12, aceitas: 8, em_andamento: 2, canceladas: 2, reembolsado: 450.5 }],
    },
  };
}

test("atendimento: conversas, aguardando, % respondido e contact rate por loja", () => {
  const v = montarAtendimentoCx(comConversas(30), rotulo);
  assert.equal(v.estado, "dado");
  assert.equal(v.rotuloConversas, "Conversas (30 dias)");
  const apice = v.linhas.find((l) => l.chave === "apice")!;
  assert.deepEqual([apice.conversas, apice.aguardando, apice.naoLidas, apice.contactRate], ["200", "3", "4", "20,0%"]);
  assert.equal(apice.respondido?.valor, "82,7%", "% com 1 casa, como o resto da aba");
  assert.equal(apice.aguardandoPct, "1,5%", "3 aguardando / 200 conversas");
  const rit = v.linhas.find((l) => l.chave === "rituaria")!;
  assert.equal(rit.conversas, "—", "sem a leitura nova: traco, nunca zero");
  assert.equal(rit.contactRate, "—");
  assert.equal(rit.aguardandoPct, "—", "sem conversas: traco, nunca 0%");
  assert.equal(rit.respondido?.fora, true);
  assert.deepEqual(v.totais, { conversas: "200", aguardando: "3", aguardandoPct: "1,5%", naoLidas: "10", mais24h: "—", foraDaMeta: ["RITUARIA"] });
  assert.ok(v.notas.some((n) => /Tempo de resposta/.test(n)));
});

test("atendimento: 7 dias usa conversas_7d; 90 dias nao calcula contact rate", () => {
  assert.equal(montarAtendimentoCx(comConversas(7), rotulo).linhas[0].conversas, "40");
  assert.equal(montarAtendimentoCx(comConversas(7), rotulo).linhas[0].contactRate, "4,0%");
  const v90 = montarAtendimentoCx(comConversas(90), rotulo);
  assert.equal(v90.linhas[0].contactRate, "—");
  assert.ok(v90.notas.some((n) => /contact rate só/.test(n)));
});

test("atendimento: sem coleta de conversas avisa no rodape; truncado vira piso", () => {
  const p = comConversas(30);
  const sem = montarAtendimentoCx({ ...p, chat: { ...p.chat, nao_lidas_estado: "sem_fonte", nao_lidas: [] } }, rotulo);
  assert.ok(sem.notas.some((n) => /aguardando a coleta/.test(n)));
  assert.equal(sem.totais.conversas, "—");
  const trunc = comConversas(30);
  trunc.chat.nao_lidas[0].conversas_truncado = true;
  const v = montarAtendimentoCx(trunc, rotulo);
  assert.equal(v.linhas[0].conversas, "≥ 200");
  assert.equal(v.linhas[0].aguardandoPct, "≤ 1,5%", "conversas sao piso: o % e' teto");
  assert.ok(v.notas.some((n) => /piso/.test(n)));
});

test("pareto: devolucoes e cancelamentos juntos, do maior para o menor, com acumulado", () => {
  const v = montarPareto(comConversas(30), rotulo);
  assert.equal(v.estado, "dado");
  assert.deepEqual(v.itens.map((i) => [i.rotulo, i.tipo, i.quantidade, i.pct, i.acumulado]), [
    ["Sem estoque", "Cancelamento", "23", "69,7%", "69,7%"],
    ["Não recebeu o pedido", "Devolução", "7", "21,2%", "90,9%"],
    ["Mudou de ideia", "Devolução", "3", "9,1%", "100,0%"],
  ]);
  assert.equal(v.itens[0].largura, 100);
  assert.deepEqual(
    { ...v.totais, reembolsado: v.totais.reembolsado.replace(/\s/g, " ") },
    { reembolsado: "R$ 450,50", devolucoes: "10", cancelamentos: "23", reenviados: "—" },
  );
  assert.deepEqual(v.linhas.map((l) => [l.marca, l.pedidos, l.cancelamentos, l.devolucoes]), [
    ["APICE", "1.000", "20", "10"],
    ["RITUARIA", "300", "3", "—"],
  ]);
  // % dos pedidos; devolucao liquida (12 - 2 canceladas) / 1.000; reembolso = aceitas / pedidos
  assert.deepEqual(
    v.linhas.map((l) => [l.marca, l.cancelamentosPct, l.devolucoesPct, l.reembolsoPct, l.cancelamentoDelta]),
    [
      ["APICE", "2,0%", "1,0%", "0,8%", null],
      ["RITUARIA", "1,0%", "—", null, null],
    ],
  );
  assert.ok(v.notas.some((n) => /^9 pedidos não pagos/.test(n)));
  assert.ok(v.notas.some((n) => /Reenvios/.test(n)));
  assert.equal(v.resto, null);
});

test("pareto por marca: seta do cancelamento contra a janela anterior; sem historico, sem seta", () => {
  const p = comConversas(30);
  const [apice, rit] = p.atendimento.marcas;
  const v = montarPareto(
    { ...p, atendimento: { ...p.atendimento, marcas: [{ ...apice, pedidos_anterior: 1000, cancelamentos_anterior: 10 }, rit] } },
    rotulo,
  );
  assert.deepEqual([v.linhas[0].cancelamentoDelta, v.linhas[0].cancelamentoAntes], [{ texto: "▲ 1,0 p.p.", sentido: "piorou" }, "1,0%"]);
  assert.deepEqual([v.linhas[1].cancelamentoDelta, v.linhas[1].cancelamentoAntes], [null, null]);
});

test("avaliacao da loja: da pior para a melhor, meta da Shopee, sem nota fica de fora (nunca zero)", () => {
  const nota = (marca: string, valor: number, situacao: "ok" | "fora") => ({
    ...chat().contas[0],
    marca,
    metricas: [{ ...metrica("shopee_22", "Nota da loja", valor, situacao, "Meta >= 4.5"), unidade: "contagem" as const, meta: 4.5 }],
  });
  const a = montarAvaliacaoLoja(
    { chat: { ...chat(), contas: [nota("apice", 4.91, "ok"), nota("lescent", 4.77, "ok"), nota("barbours", 4.83, "ok"), { ...chat().contas[0], marca: "kokeshi" }] } },
    rotulo,
  );
  assert.equal(a?.meta, "meta ≥ 4,5");
  assert.deepEqual(a?.itens.map((x) => [x.marca, x.nota, x.pior, x.fora]), [
    ["LESCENT", "4,77", true, false],
    ["BARBOURS", "4,83", false, false],
    ["APICE", "4,91", false, false],
  ]);
  const fora = montarAvaliacaoLoja({ chat: { ...chat(), contas: [nota("apice", 4.2, "fora")] } }, rotulo);
  assert.deepEqual(fora?.itens.map((x) => [x.nota, x.pior, x.fora]), [["4,20", false, true]], "uma loja so': sem 'pior'");
  assert.equal(montarAvaliacaoLoja({ chat: { ...chat(), contas: [] } }, rotulo), null);
});

test("pareto: top 10 e o resto somado numa linha; sem devolucoes = nota, nao zero", () => {
  const p = comConversas(30);
  const itens = Array.from({ length: 12 }, (_, i) => ({
    codigo: `m${i}`, rotulo: `Motivo ${String(i).padStart(2, "0")}`, natureza: "vendedor" as const, quantidade: 12 - i, pct: 0, mapeado: true,
  }));
  const v = montarPareto({ ...p, atendimento: { ...p.atendimento, motivos: { ...p.atendimento.motivos, itens } }, devolucoes: undefined }, rotulo);
  assert.equal(v.itens.length, 10);
  assert.match(v.resto ?? "", /^\+ 2 motivo\(s\) com 3 caso\(s\)/);
  assert.equal(v.totais.devolucoes, "—");
  assert.equal(v.totais.reembolsado, "—");
  assert.ok(v.notas.some((n) => /aguardando a coleta/.test(n)));
});

// ---------------------------------------------------------------------------
// 05/11/2026: status por marca, ajuda dos numeros e filtro automatico
// ---------------------------------------------------------------------------
test("status por marca: nivel oficial, metrica fora da meta em alerta, pior primeiro", () => {
  const s = montarStatusMarcas(comConversas(30), rotulo);
  assert.deepEqual(s.map((x) => x.chave), ["rituaria", "apice", "lescent"]);
  const rit = s[0];
  assert.equal(rit.tom, "atencao");
  assert.equal(rit.rotulo, "Bom");
  assert.equal(rit.alertas.length, 1);
  assert.match(rit.alertas[0], /^Taxa de resposta do chat 45,3% \(meta ≥ 60%\)$/, "mesmo texto de meta da fila");
  const apice = s[1];
  assert.deepEqual([apice.tom, apice.alertas, apice.aguardando, apice.cancelamento, apice.devolucoes], ["bom", [], "3", "2,0%", "10"]);
  const lescent = s[2];
  assert.equal(lescent.tom, "ausente");
  assert.deepEqual(lescent.alertas, ["Sem fotografia capturada ainda."]);
  assert.equal(lescent.cancelamento, "—", "sem pedidos = ausente, nunca 0%");
});

test("status por marca: conta 'bom' com metrica fora nunca fica verde", () => {
  const p = comConversas(30);
  p.chat.contas[1] = { ...p.chat.contas[1], tom: "bom" };
  const rit = montarStatusMarcas(p, rotulo).find((x) => x.chave === "rituaria")!;
  assert.equal(rit.tom, "atencao");
});

test("ajuda: conversas e cancelamentos explicados no ⓘ, nao em nota", () => {
  assert.match(AJUDA_CX.conversas, /Cada comprador conta uma vez/);
  assert.match(AJUDA_CX.cancelamentos, /não pagos/);
  const tela = readFileSync(new URL("../app/cx/CxConteudo.tsx", import.meta.url), "utf8");
  assert.match(tela, /<ThAjuda ajuda=\{AJUDA_CX\.conversas\} dica=\{v\.rotuloConversas\}>Conversas<\/ThAjuda>/);
  assert.match(AJUDA_CX.cancelamentosMarca, /não pagos/);
  assert.match(tela, /<ThAjuda ajuda=\{AJUDA_CX\.cancelamentosMarca\}>Cancel\.<\/ThAjuda>/);
  // CX-IDENTIDADE: o status por marca virou pilulas no heroi, com uma ou todas as marcas
  assert.match(tela, /<SaudePorMarca itens=\{status\}/);
});

test("filtros no padrao do app: BrandFilter em menu, Popover de periodo, recolhivel no celular", () => {
  const f = readFileSync(new URL("../app/cx/FiltrosCx.tsx", import.meta.url), "utf8");
  assert.match(f, /^"use client";/);
  assert.match(f, /<BrandFilter[\s\S]*variante="menu"/);
  assert.match(f, /<Popover[\s\S]*rotulo="Período"/);
  assert.match(f, /router\.push\(hrefCx\(novo\)/, "a URL segue a fonte de verdade");
  assert.match(f, /sm:hidden/, "abaixo de sm, o botao Filtros com o resumo");
  assert.doesNotMatch(f, /<select/, "sem select nativo: o mesmo visual das outras abas");
  const pagina = readFileSync(new URL("../app/cx/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(pagina, /Aplicar/);
});

test("marca unica a partir do BrandFilter (multi): fica a recem-escolhida; desmarcar volta a todas", () => {
  assert.equal(marcaUnica(["apice"], null), "apice");
  assert.equal(marcaUnica(["apice", "kokeshi"], "apice"), "kokeshi");
  assert.equal(marcaUnica([], "apice"), null, "desmarcou a mesma: todas");
  assert.equal(marcaUnica([], null), null, "Todas");
  assert.equal(marcaUnica(["apice"], "apice"), "apice");
  assert.equal(resumoFiltrosCx({ marca: null, dias: 30 }, rotulo), "Shopee · Todas as marcas · Últimos 30 dias");
  assert.equal(resumoFiltrosCx({ marca: "apice", dias: 7 }, rotulo), "Shopee · APICE · Últimos 7 dias");
  // a URL nao muda: os mesmos brands e dias
  assert.equal(hrefCx({ marca: marcaUnica(["kokeshi"], null), dias: 7 }), "/cx?brands=kokeshi&dias=7");
});

// ---------------------------------------------------------------------------
// 05/11/2026: pedidos de um motivo do Pareto
// ---------------------------------------------------------------------------
function pedidosResp(extra: Partial<PedidosMotivoResponse> = {}): PedidosMotivoResponse {
  return {
    gerado_em: "2026-11-05T15:00:00Z", tipo: "devolucao", codigo: "spilled_contents", rotulo: "Produto vazou",
    estado: "dado", motivo_indisponivel: null, total: 2, truncado: false, parcial: false, numero_publico: true,
    pedidos: [
      { marca: "lescent", pedido: "251102ABC", devolucao: "R9", dia: "2026-11-02", situacao: "Reembolsada", valor: 59.9 },
      { marca: "lescent", pedido: "=CMD()", devolucao: null, dia: null, situacao: "Solicitada", valor: null },
    ],
    ...extra,
  };
}

test("pedidos do motivo: url com tipo, motivo, periodo e marca", () => {
  const f = { marca: "apice", dias: 7 as const };
  assert.equal(urlPedidosMotivo("/torre-api", f, "cancelamento", "out_of_stock"),
    "/torre-api/api/v1/cx/shopee/pedidos?tipo=cancelamento&motivo=out_of_stock&dias=7&brands=apice");
  assert.equal(tipoDoItem({ tipo: "Devolução" }), "devolucao");
  assert.equal(tipoDoItem({ tipo: "Cancelamento" }), "cancelamento");
});

test("pedidos do motivo: linhas, resumo com teto e avisos", () => {
  const v = montarPedidosMotivo(pedidosResp(), rotulo);
  assert.deepEqual(v.linhas[0], { chave: "lescent:R9", pedido: "251102ABC", marca: "LESCENT", dia: "02/11/2026", situacao: "Reembolsada", valor: reais(59.9) });
  assert.equal(v.linhas[1].valor, "—", "sem reembolso = ausente, nunca R$ 0");
  assert.equal(v.resumo, "2 pedido(s)");
  assert.ok(v.comValor);
  const t = montarPedidosMotivo(pedidosResp({ total: 900, truncado: true, parcial: true, numero_publico: false }), rotulo);
  assert.equal(t.resumo, "900 pedidos · mostrando os 2 mais recentes");
  assert.equal(t.avisos.length, 2);
});

test("pedidos do motivo: CSV com ; , valor com virgula e sem formula", () => {
  const csv = csvPedidosMotivo(pedidosResp(), "Produto vazou");
  const [cab, l1, l2] = csv.replace("﻿", "").split("\n");
  assert.equal(cab, "pedido;devolucao;marca;dia;situacao;valor_reembolsado;motivo");
  assert.equal(l1, "251102ABC;R9;lescent;2026-11-02;Reembolsada;59,9;Produto vazou");
  assert.ok(l2.startsWith("'=CMD()"), "celula que comeca com = nao vira formula");
  assert.ok(csv.startsWith("﻿"));
});

test("pedidos do motivo: carregar nunca lanca", async () => {
  const f = { marca: null, dias: 30 as const };
  const erro = await carregarPedidosMotivo(f, "devolucao", "x", (async () => new Response("", { status: 500 })) as typeof fetch, "");
  assert.deepEqual(erro, { ok: false, motivo: "A API respondeu 500." });
  const ok = await carregarPedidosMotivo(f, "devolucao", "x", (async () => Response.json(pedidosResp())) as typeof fetch, "");
  assert.ok(ok.ok);
});

test("pareto: cada motivo abre a lista de pedidos (botao com aria-expanded)", () => {
  const tela = readFileSync(new URL("../app/cx/CxConteudo.tsx", import.meta.url), "utf8");
  assert.match(tela, /aria-expanded=\{aberto\?\.chave === i\.chave\}/);
  assert.match(tela, /carregarPedidosMotivo\(filtros, tipo, item\.codigo, torreFetch as typeof fetch\)/);
  const v = montarPareto(comConversas(30), rotulo);
  assert.ok(v.itens.every((i) => i.codigo && i.chave.endsWith(i.codigo)));
});


// ---------------------------------------------------------------------------
// Fila do chat e tempo de resposta (05/11/2026)
// ---------------------------------------------------------------------------
test("duracao: minutos, horas e dias legiveis; ausencia vira traco", () => {
  assert.deepEqual(
    [duracao(20), duracao(754), duracao(2 * 3600 + 300), duracao(3 * 86400), duracao(26 * 3600), duracao(null)],
    ["< 1 min", "13 min", "2 h 05", "3 d", "1 d 2 h", "—"],
  );
});

test("atendimento: tempo de resposta (mediana) e fila por faixa de espera", () => {
  const p = comConversas(30);
  Object.assign(p.chat.nao_lidas[0], {
    aguardando_ate_1h: 1, aguardando_1a4h: 0, aguardando_4a24h: 1, aguardando_mais_24h: 1, espera_max_s: 2 * 86400,
    tempo_resposta_s: 754, tempo_resposta_p90_s: 7200, respostas: 40, respostas_ate_1h_pct: 75,
    respostas_desde: "2026-11-05T13:00:00Z", tempo_resposta_fonte: "mediana",
  });
  const v = montarAtendimentoCx(p, rotulo);
  const apice = v.linhas.find((l) => l.chave === "apice")!;
  assert.equal(apice.tempoResposta, "13 min");
  assert.match(apice.tempoDetalhe ?? "", /40 respostas · 9 em cada 10 em até 2 h 00 · 75,0% em até 1 h/);
  const rit = v.linhas.find((l) => l.chave === "rituaria")!;
  assert.equal(rit.tempoResposta, "—", "sem medida: traco, nunca zero");
  assert.deepEqual(v.fila, [{ chave: "apice", marca: "APICE", ate1h: "1", de1a4h: "0", de4a24h: "1", mais24h: "1",
    atrasada: true, maisAntiga: "2 d" }]);
  assert.equal(v.totais.mais24h, "1");
  assert.ok(v.notas.some((n) => /medido desde 05\/11/.test(n)), "periodo incompleto avisa");
  assert.ok(!v.notas.some((n) => /aguardando as primeiras respostas/.test(n)));
});

test("atendimento: Kokeshi mostra a media do Seller Centre", () => {
  const p = comConversas(30);
  Object.assign(p.chat.nao_lidas[0], { tempo_resposta_s: 2100, tempo_resposta_fonte: "media_seller_centre" });
  const v = montarAtendimentoCx(p, rotulo);
  assert.equal(v.linhas.find((l) => l.chave === "apice")!.tempoResposta, "35 min (média)");
});

test("atendimento: sem respostas medidas, o rodape diz que a coleta ainda vai medir", () => {
  const v = montarAtendimentoCx(comConversas(30), rotulo);
  assert.ok(v.notas.some((n) => /aguardando as primeiras respostas/.test(n)));
  assert.deepEqual(v.fila, []);
});

test("tela: fila do chat e coluna de tempo com ⓘ", () => {
  const tela = readFileSync(new URL("../app/cx/CxConteudo.tsx", import.meta.url), "utf8");
  assert.ok(tela.includes("<ThAjuda ajuda={AJUDA_CX.tempoResposta}>Tempo resp.</ThAjuda>"));
  assert.ok(tela.includes('data-testid="cx-fila"'));
  assert.ok(tela.includes("<InfoDica texto={AJUDA_CX.fila}"));
});

// ---------------------------------------------------------------------------
// Resumo da Gerencial (GERENCIAL-CX, 07/11/2026)
// ---------------------------------------------------------------------------
test("resumo da Gerencial: taxas so' com marcas que tem os dois lados; ausencia vira traco", () => {
  const r = resumoCxGerencial(comConversas(30), rotulo);
  assert.deepEqual(
    [r.contactRate, r.resposta, r.respostaMedia, r.respostaMeta, r.cancelamento, r.reembolsado, r.reembolsoPct, r.semChat],
    // 200/1000 (rituaria sem chat fica fora) · (82,65 + 45,31) / 2: rituaria sem conversas = media simples
    // · 23/1300 · 8 aceitas/1000
    ["20,0%", "64,0%", "simples", "meta ≥ 60%", "1,8%", reais(450.5), "0,8%", ["RITUARIA"]],
  );
  assert.equal(r.cancelamentoDelta, null, "API antiga, sem *_anterior: sem delta");

  const p = comConversas(30);
  p.chat.nao_lidas[0] = { ...p.chat.nao_lidas[0], conversas_truncado: true };
  assert.equal(resumoCxGerencial(p, rotulo).contactRate, "≥ 20,0%");

  const vazio = resumoCxGerencial(
    { ...comConversas(30), chat: { ...chat(), contas: [], nao_lidas_estado: "erro" }, devolucoes: undefined },
    rotulo,
  );
  assert.deepEqual(
    [vazio.contactRate, vazio.resposta, vazio.respostaMedia, vazio.reembolsado, vazio.reembolsoPct],
    ["—", "—", null, "—", null],
  );
});

test("meta da Shopee em texto curto; formato desconhecido fica como veio", () => {
  assert.equal(metaCurta("Meta >= 60"), "meta ≥ 60%");
  assert.equal(metaCurta("Meta <= 1.5"), "meta ≤ 1.5%");
  assert.equal(metaCurta("Excelente"), "Excelente");
});

test("taxa de resposta: media ponderada pelas conversas so' quando toda marca tem conversas; senao simples", () => {
  assert.deepEqual(mediaResposta([{ valor: 90, peso: 300 }, { valor: 60, peso: 100 }]), { valor: 82.5, tipo: "ponderada" });
  assert.deepEqual(mediaResposta([{ valor: 90, peso: 300 }, { valor: 60, peso: null }]), { valor: 75, tipo: "simples" });
  assert.deepEqual(mediaResposta([{ valor: 90, peso: 300 }, { valor: 60, peso: 0 }]), { valor: 75, tipo: "simples" });
  assert.deepEqual(mediaResposta([{ valor: null, peso: 300 }, { valor: 60, peso: 100 }]), { valor: 60, tipo: "ponderada" });
  assert.deepEqual(mediaResposta([{ valor: null, peso: 300 }]), { valor: null, tipo: null }, "nada medido: nunca zero");
});

test("resumo da Gerencial: delta do cancelamento so' nas marcas com historico; subir e' piorar", () => {
  const p = comConversas(30);
  const [apice, rit] = p.atendimento.marcas;
  const com = (a: object, r: object) => ({ ...p, atendimento: { ...p.atendimento, marcas: [{ ...apice, ...a }, { ...rit, ...r }] } });
  // apice 20/1000 = 2,0% agora contra 10/1000 = 1,0% antes; rituaria sem historico fica fora do delta
  const piorou = resumoCxGerencial(com({ pedidos_anterior: 1000, cancelamentos_anterior: 10 }, {}), rotulo);
  assert.deepEqual(piorou.cancelamentoDelta, { texto: "▲ 1,0 p.p.", sentido: "piorou" });
  assert.deepEqual(piorou.semHistoricoCancelamento, ["RITUARIA"]);
  assert.equal(piorou.marcas.find((m) => m.chave === "apice")?.cancelamentoAnterior, 1);
  const melhorou = resumoCxGerencial(com({ pedidos_anterior: 500, cancelamentos_anterior: 25 }, {}), rotulo);
  assert.deepEqual(melhorou.cancelamentoDelta, { texto: "▼ 3,0 p.p.", sentido: "melhorou" });
  assert.deepEqual(deltaPp(2.01, 2), { texto: "= estável", sentido: "estavel" });
  // pilula do card (CARDS-KPI): o mesmo delta em numero e o "antes" da janela anterior
  assert.deepEqual([piorou.cancelamentoDeltaPp, piorou.cancelamentoAntes], [1, "1,0%"]);
  assert.deepEqual([melhorou.cancelamentoDeltaPp, melhorou.cancelamentoAntes], [-3, "5,0%"]);
  const semHist = resumoCxGerencial(p, rotulo);
  assert.deepEqual([semHist.cancelamentoDeltaPp, semHist.cancelamentoAntes], [null, null], "sem historico: sem pilula nem antes");
});

type LinhaTeste = { marca: string; pedidos: number; canc: number; aceitas: number; conv?: number; resp?: number; sit?: "ok" | "fora" };
function comMarcas(ls: LinhaTeste[]) {
  const p = comConversas(30);
  const conta = p.chat.contas[0];
  return {
    ...p,
    chat: {
      ...p.chat,
      sem_foto: [],
      contas: ls
        .filter((l) => l.resp != null)
        .map((l) => ({ ...conta, marca: l.marca, metricas: [metrica("shopee_11", "Taxa de resposta do chat", l.resp!, l.sit ?? "ok", "Meta >= 60")] })),
      nao_lidas: ls.filter((l) => l.conv != null).map((l) => ({
        marca: l.marca, valor: null, capturado_em: null, conversas_30d: l.conv, aguardando_resposta: null,
      })),
    },
    atendimento: {
      ...p.atendimento,
      marcas: ls.map((l) => ({
        marca: l.marca, pedidos: l.pedidos, cancelamentos: l.canc, taxa_cancelamento_pct: null,
        cancelamentos_comprador: null, em_devolucao: null,
      })),
    },
    devolucoes: {
      ...p.devolucoes,
      marcas: ls.map((l) => ({ marca: l.marca, devolucoes: l.aceitas, aceitas: l.aceitas, reembolsado: l.aceitas * 10 })),
    },
  };
}

test("risco: base e' a mediana das marcas; com menos de 3 marcas medidas, ninguem fica acima", () => {
  const r = resumoCxGerencial(comConversas(30), rotulo); // 2 marcas
  assert.deepEqual(r.medianas, { contactRate: null, resposta: null, cancelamento: null, reembolso: null });
  // sem mediana ninguem fica acima; a meta oficial vale mesmo assim (rituaria 45,31% com situacao "fora")
  assert.deepEqual(r.marcas.map((m) => [m.chave, m.acima, m.tom]), [["rituaria", [], "critico"], ["apice", [], "bom"]]);
  assert.equal(medianaRisco([1, 9, 3, 7]), 5);
  assert.equal(medianaRisco([4, 1]), null);
});

test("risco: marca dominante de taxa baixa nao deixa as outras vermelhas", () => {
  // Kokeshi com 9.000 de 13.000 pedidos e taxas baixas: a taxa da Shopee (ponderada) cai para 2,3%
  // e 0,8%, e as quatro outras ficariam acima nos dois indicadores. Pela mediana, nenhuma passa de 1,2x.
  const r = resumoCxGerencial(
    comMarcas([
      { marca: "kokeshi", pedidos: 9000, canc: 90, aceitas: 45 },
      { marca: "apice", pedidos: 1000, canc: 50, aceitas: 20 },
      { marca: "barbours", pedidos: 1000, canc: 55, aceitas: 22 },
      { marca: "lescent", pedidos: 1000, canc: 60, aceitas: 24 },
      { marca: "rituaria", pedidos: 1000, canc: 40, aceitas: 18 },
    ]),
    rotulo,
  );
  assert.equal(r.cancelamento, "2,3%", "o tile segue a taxa da Shopee no filtro");
  assert.deepEqual([r.medianas.cancelamento, r.medianas.reembolso], [5, 2]);
  assert.ok(r.marcas.every((m) => m.tom === "bom" && m.acima.length === 0), JSON.stringify(r.marcas.map((m) => [m.chave, m.acima])));
  assert.deepEqual(r.alertas, [], "sem alerta: a tela diz 'Nenhuma marca fora da curva'");
});

test("risco: na taxa de resposta menor e' pior; muito fora em um indicador vem antes de pouco fora em dois", () => {
  const r = resumoCxGerencial(
    comMarcas([
      { marca: "apice", pedidos: 1000, canc: 50, aceitas: 20, conv: 100, resp: 90 },
      { marca: "barbours", pedidos: 1000, canc: 65, aceitas: 25, conv: 100, resp: 85 }, // 6,5/5 e 2,5/2: +0,30 +0,25
      { marca: "lescent", pedidos: 1000, canc: 50, aceitas: 20, conv: 100, resp: 88 },
      { marca: "rituaria", pedidos: 1000, canc: 45, aceitas: 18, conv: 100, resp: 20 }, // 86,5/20: +3,3
    ]),
    rotulo,
  );
  assert.equal(r.medianas.resposta, 86.5);
  assert.equal(r.respostaMedia, "ponderada");
  assert.equal(r.resposta, "70,8%"); // (90 + 85 + 88 + 20) / 4, pesos iguais
  assert.deepEqual(
    r.marcas.map((m) => [m.chave, m.acima, m.tom]),
    [
      ["rituaria", ["resposta"], "atencao"],
      ["barbours", ["cancelamento", "reembolso"], "critico"],
      ["apice", [], "bom"],
      ["lescent", [], "bom"],
    ],
  );
  assert.ok(Math.abs(r.marcas[0].excesso - (86.5 / 20 - 1)) < 1e-9);
  // linha "Atencao": ate' 2 marcas, cada uma com o PIOR indicador (barbours: cancelamento 6,5/5 = 1,30 > reembolso 2,5/2 = 1,25)
  assert.deepEqual(r.alertas, [
    { chave: "rituaria", marca: "RITUARIA", tom: "atencao", indicador: "resposta", valor: "20,0%", referencia: "(mediana 86,5%)" },
    { chave: "barbours", marca: "BARBOURS", tom: "critico", indicador: "cancelamento", valor: "6,5%", referencia: "(mediana 5,0%)" },
  ]);
  // resposta ALTA nunca e' alerta: 99% contra mediana 86,5% fica dentro
  assert.equal(foraDaCurva("resposta", 99, 86.5), false);
  assert.equal(foraDaCurva("resposta", 72, 86.5), true); // 86,5 / 1,2 = 72,08
  assert.equal(foraDaCurva("cancelamento", 6, 5), false); // 5 x 1,2 = 6: precisa PASSAR
});

test("risco: resposta abaixo da meta oficial da Shopee fica vermelha e na frente, com a meta no lugar da mediana", () => {
  const base = (resp: number, sit: "ok" | "fora") =>
    resumoCxGerencial(
      comMarcas([
        { marca: "apice", pedidos: 1000, canc: 50, aceitas: 20, conv: 100, resp: 90 },
        { marca: "barbours", pedidos: 1000, canc: 100, aceitas: 25, conv: 100, resp: 85 }, // 10/5 e 2,5/2: +1,0 +0,25
        { marca: "lescent", pedidos: 1000, canc: 50, aceitas: 20, conv: 100, resp: 88 },
        { marca: "rituaria", pedidos: 1000, canc: 45, aceitas: 18, conv: 100, resp, sit },
      ]),
      rotulo,
    );
  // fora da meta (situacao do payload): passa a frente da barbours, que tem excesso maior (1,25 > 86,5/55 - 1 = 0,57)
  const fora = base(55, "fora");
  assert.deepEqual(fora.alertas, [
    { chave: "rituaria", marca: "RITUARIA", tom: "critico", indicador: "resposta", valor: "55,0%", referencia: "(meta ≥ 60%)" },
    { chave: "barbours", marca: "BARBOURS", tom: "critico", indicador: "cancelamento", valor: "10,0%", referencia: "(mediana 5,0%)" },
  ]);
  // dentro da meta: segue a mediana (65 < 86,5 / 1,2), ambar e atras do maior excesso
  const dentro = base(65, "ok");
  assert.deepEqual(dentro.alertas.map((a) => [a.chave, a.tom, a.referencia]), [
    ["barbours", "critico", "(mediana 5,0%)"],
    ["rituaria", "atencao", "(mediana 86,5%)"],
  ]);
  assert.equal(dentro.marcas.find((m) => m.chave === "rituaria")?.foraMeta, false);
});

test("drill-down: marcas da pior para a melhor no sentido do indicador; sem medida no fim, com motivo", () => {
  const p = comMarcas([
    { marca: "apice", pedidos: 1000, canc: 50, aceitas: 20, conv: 100, resp: 90 },
    { marca: "barbours", pedidos: 1000, canc: 65, aceitas: 25, conv: 100, resp: 85 },
    { marca: "lescent", pedidos: 1000, canc: 50, aceitas: 20, conv: 100, resp: 88 },
    { marca: "rituaria", pedidos: 1000, canc: 45, aceitas: 18, conv: 100, resp: 20 },
  ]);
  const comKokeshi = {
    ...p,
    chat: { ...p.chat, sem_foto: [{ marca: "kokeshi", motivo: "Aguardando a primeira captura do bot." }] },
    atendimento: {
      ...p.atendimento,
      marcas: [
        ...p.atendimento.marcas.map((m) => (m.marca === "barbours" ? { ...m, pedidos_anterior: 1000, cancelamentos_anterior: 50 } : m)),
        { marca: "kokeshi", pedidos: 9000, cancelamentos: 90, taxa_cancelamento_pct: null, cancelamentos_comprador: null, em_devolucao: null },
      ],
    },
  };
  const r = resumoCxGerencial(comKokeshi, rotulo);

  const resp = linhasDrilldownCx(r, "resposta");
  assert.deepEqual(resp.map((l) => [l.marca, l.valor, l.fora]), [
    ["RITUARIA", "20,0%", true], // menor primeiro: cair e' pior
    ["BARBOURS", "85,0%", false],
    ["LESCENT", "88,0%", false],
    ["APICE", "90,0%", false],
    ["KOKESHI", "—", false],
  ]);
  assert.equal(resp[4].motivo, "Aguardando a primeira captura do bot.", "sem medida: traco e motivo, nunca zero");
  assert.equal(resp[0].detalhe, "meta ≥ 60% · 100 conversas");

  const canc = linhasDrilldownCx(r, "cancelamento");
  assert.deepEqual(canc.map((l) => l.marca), ["BARBOURS", "APICE", "LESCENT", "RITUARIA", "KOKESHI"]); // maior primeiro
  assert.deepEqual([canc[0].valor, canc[0].antes, canc[0].detalhe], ["6,5%", "5,0%", "65 cancelamentos / 1.000 pedidos"]);
  assert.equal(canc[4].antes, null, "kokeshi sem historico: sem 'antes'");
  assert.equal(canc[0].largura, 100);

  const cr = linhasDrilldownCx(r, "contactRate");
  assert.equal(cr.at(-1)?.motivo, "Sem leitura de conversas na coleta do chat.");
  assert.equal(cr[0].detalhe, "100 conversas / 1.000 pedidos");
});

test("seta do cancelamento: base explicita quando exclui marca sem historico", () => {
  const p = comConversas(30);
  const [apice, rit] = p.atendimento.marcas;
  const r = resumoCxGerencial(
    { ...p, atendimento: { ...p.atendimento, marcas: [{ ...apice, pedidos_anterior: 1000, cancelamentos_anterior: 10 }, rit] } },
    rotulo,
  );
  assert.deepEqual(r.cancelamentoBase, { anterior: "1,0%", atual: "2,0%" }); // so' apice; o tile mostra 1,8% com rituaria
  const resumoFonte = readFileSync(new URL("../src/components/gerencial/CxResumo.tsx", import.meta.url), "utf8");
  assert.match(resumoFonte, /r\.cancelamentoBase \? `comparação sem \$\{r\.semHistoricoCancelamento\.join\(", "\)\}` : `antes \$\{r\.cancelamentoAntes\}`/,
    "com base parcial o card diz 'sem MARCA', nunca 'antes X' ao lado do valor de todas as marcas");
  const todas = resumoCxGerencial(
    {
      ...p,
      atendimento: {
        ...p.atendimento,
        marcas: [{ ...apice, pedidos_anterior: 1000, cancelamentos_anterior: 10 }, { ...rit, pedidos_anterior: 300, cancelamentos_anterior: 3 }],
      },
    },
    rotulo,
  );
  assert.equal(todas.cancelamentoBase, null, "todas com historico: so' a seta");
});

// ---------------------------------------------------------------------------
// CX-IDENTIDADE (08/11/2026): cabecalho em chips, heroi, fila de atencao
// ---------------------------------------------------------------------------
test("chips: janela, hora da resposta e a captura MAIS ANTIGA da Saude da Conta", () => {
  const p = comConversas(30);
  p.chat.contas[0] = { ...p.chat.contas[0], capturado_em: "2026-11-04T12:30:00Z" };
  p.chat.contas[1] = { ...p.chat.contas[1], capturado_em: "2026-11-03T09:05:00Z" };
  const c = chipsCx(p);
  assert.equal(c.janela, "30 dias fechados · 05/10 a 03/11");
  assert.match(c.geradoEm, /^gerado em 04\/11\/2026/);
  assert.equal(c.saudeDaConta, "Saúde da Conta: 03/11 06:05", "horario de Brasilia, a mais antiga");
  assert.equal(chipsCx(comConversas(30)).saudeDaConta, null, "sem captura: sem chip (nunca inventa data)");
});

test("aviso da coleta do chat: so' quando falta a leitura", () => {
  const p = comConversas(30);
  assert.equal(avisoColetaChat(p), null);
  assert.equal(avisoColetaChat({ chat: { ...p.chat, nao_lidas_estado: "sem_fonte", nao_lidas: [] } }), "Conversas: aguardando a coleta");
  assert.equal(avisoColetaChat({ chat: { ...p.chat, nao_lidas_estado: "erro" } }), "Conversas indisponíveis nesta carga");
});

test("heroi: contexto com aguardando e >24 h; selo pela meta oficial", () => {
  const p = comConversas(30);
  p.chat.nao_lidas[0].aguardando_mais_24h = 1;
  const h = heroiCx(montarAtendimentoCx(p, rotulo));
  assert.equal(h.contexto, "3 conversas aguardando · 1 há mais de 24 h");
  assert.deepEqual(h.selo, { texto: "1 loja abaixo da meta", tom: "critico" });
  const ok = comConversas(30);
  ok.chat.contas = ok.chat.contas.slice(0, 1);
  assert.deepEqual(heroiCx(montarAtendimentoCx(ok, rotulo)).selo, { texto: "Todas na meta", tom: "ok" });
  const sem = heroiCx(montarAtendimentoCx({ ...ok, chat: { ...ok.chat, contas: [], nao_lidas_estado: "sem_fonte", nao_lidas: [] } }, rotulo));
  assert.deepEqual([sem.contexto, sem.selo], [null, null], "sem medida: sem selo e sem contexto, nunca zero");
});

test("atendimento: total de aguardando em %, nota em numero para ordenar", () => {
  const trunc = comConversas(30);
  trunc.chat.nao_lidas[0].conversas_truncado = true;
  const v = montarAtendimentoCx(trunc, rotulo);
  assert.deepEqual([v.totais.conversas, v.totais.aguardandoPct], ["≥ 200", "≤ 1,5%"], "piso no total tambem");
  assert.deepEqual(v.linhas.map((l) => [l.chave, l.notaNum]), [["apice", null], ["rituaria", 4.93]]);
});

test("fila de atencao: metrica fora da meta, >24 h, fora da curva sem repetir e sem foto", () => {
  const p = comConversas(30);
  Object.assign(p.chat.nao_lidas[0], { aguardando_mais_24h: 2, espera_max_s: 2 * 86400 });
  const r = resumoCxGerencial(p, rotulo);
  const itens = itensAtencaoCx(p, r, rotulo);
  assert.deepEqual(
    itens.map((i) => [i.severidade, i.titulo, i.detalhe]),
    [
      ["critico", "RITUARIA: Taxa de resposta do chat 45,3%", "meta ≥ 60%"],
      ["critico", "APICE: 2 conversas há mais de 24 h", "mais antiga: 2 d"],
      ["info", "LESCENT: Sem fotografia capturada ainda.", null],
    ],
  );
  assert.deepEqual(itens[0].abre, { marca: "rituaria" });
  // fora da curva: entra uma vez por marca+indicador; a resposta fora da meta oficial nao repete
  const curva = itensAtencaoCx(p, {
    medianas: { contactRate: 10, resposta: 80, cancelamento: 1, reembolso: 1 },
    marcas: [{ ...r.todas[0], chave: "rituaria", marca: "RITUARIA", acima: ["resposta", "cancelamento"], foraMeta: true, tom: "critico",
      valores: { contactRate: null, resposta: 45.31, cancelamento: 2, reembolso: null } }],
  }, rotulo);
  const daCurva = curva.filter((i) => i.chave.includes(":curva:"));
  assert.deepEqual(daCurva.map((i) => [i.titulo, i.detalhe, i.abre]), [["RITUARIA: cancelamento 2,0%", "mediana 1,0%", { indicador: "cancelamento" }]]);
  assert.ok(MAX_ITENS_ATENCAO <= 8);
});

test("pareto: linha de total da tabela por marca", () => {
  const p = comConversas(30);
  const [apice, rit] = p.atendimento.marcas;
  const v = montarPareto(
    { ...p, atendimento: { ...p.atendimento, marcas: [{ ...apice, pedidos_anterior: 1000, cancelamentos_anterior: 10 }, rit] } },
    rotulo,
  );
  assert.deepEqual(
    { ...v.total, reembolsado: v.total.reembolsado.replace(/\s/g, " ") },
    {
      pedidos: "1.300", cancelamentosPct: "1,8%", cancelamentoDelta: { texto: "▲ 1,0 p.p.", sentido: "piorou" },
      cancelamentoAntes: "1,0%", devolucoesPct: "1,0%", devolucoes: "10", reembolsado: "R$ 450,50", reembolsoPct: "0,8%",
    },
  );
});

test("tela CX no padrao Gerencial: heroi, faixa, fila, 7/12 | 5/12 e Mais detalhes", () => {
  const tela = readFileSync(new URL("../app/cx/CxConteudo.tsx", import.meta.url), "utf8");
  for (const peca of ["<Heroi", "<Faixa ", "<FilaAtencao", "lg:col-span-7", "lg:col-span-5", "<MaisDetalhes", "<KpiDrilldownDialog", "variante=\"gerencial\""]) {
    assert.ok(tela.includes(peca), peca);
  }
  assert.ok(tela.lastIndexOf("<Heroi") < tela.indexOf("<Faixa ") && tela.indexOf("<Faixa ") < tela.indexOf("<FilaAtencao"), "ordem da spec");
  assert.match(tela, /<PageHeader[\s\S]*icon=\{MessageCircle\}/);
  assert.doesNotMatch(tela, /subtitle=/, "subtitulo virou chip");
  // revisao do Prumo: sem cartao sem numero na faixa; um nome so' para a taxa; Pareto com 2 numeros por motivo
  assert.doesNotMatch(tela, /rotulo="Reenvio"/);
  assert.ok(tela.includes("grid grid-cols-1 gap-3 sm:grid-cols-3"));
  assert.ok(tela.includes(">{ROTULO_INDICADOR.resposta}</ThAjuda>") && !tela.includes("% respondido</ThAjuda>"));
  assert.doesNotMatch(tela, /· acum\. \{i\.acumulado\}/);
  assert.ok(tela.includes('<span className="sr-only"> · acumulado {i.acumulado}</span>'));
  const resumo = readFileSync(new URL("../src/components/gerencial/CxResumo.tsx", import.meta.url), "utf8");
  assert.match(resumo, /notasDoTile\(r: ResumoCx, i: IndicadorCx, dias = DIAS\)/, "Gerencial segue com 30 dias por padrao");
  // Linha "Atenção" (390 px): o "·" fecha o item ANTERIOR, dentro do mesmo bloco
  // inquebravel; a linha nova comeca pelo ponto da marca, nunca por "· ●".
  assert.doesNotMatch(resumo, /idx > 0 && <span aria-hidden="true" className="text-ink-faint">·<\/span>/);
  assert.match(resumo, /\{a\.referencia\}<\/span>\s*<\/span>[\s\S]{0,200}?\{idx < r\.alertas\.length - 1 && <span aria-hidden="true" className="text-ink-faint">·<\/span>\}\s*<\/span>/);
});

// ---------------------------------------------------------------------------
// Texto de meta: ">=" e "<=" da Shopee viram "≥" e "≤" (CX e Gerencial)
// ---------------------------------------------------------------------------
test("meta: sinais matematicos em todo texto de meta da CX e da Gerencial", () => {
  assert.equal(simbolosMeta("Meta >= 60"), "Meta ≥ 60");
  assert.equal(simbolosMeta("meta <= 2 dias"), "meta ≤ 2 dias");
  assert.equal(simbolosMeta("meta > 4,5"), "meta > 4,5", "sinal estrito fica como esta'");
  // Gerencial (card CX) usa metaCurta: o formato conhecido e o que cai no texto cru
  assert.equal(metaCurta("Meta >= 60"), "meta ≥ 60%");
  assert.equal(metaCurta("Meta <= 2 dias"), "meta ≤ 2 dias", "minusculo como o formato curto");
  // detalhe da marca, celula da tabela e fila: nenhum ">=" sobra
  const p = comConversas(30);
  const textos = [
    ...montarStatusMarcas(p, rotulo).flatMap((x) => x.alertas),
    ...montarAtendimentoCx(p, rotulo).linhas.flatMap((l) => [l.respondido?.meta, l.nota?.meta]),
    ...itensAtencaoCx(p, resumoCxGerencial(p, rotulo), rotulo).map((i) => `${i.titulo} ${i.detalhe ?? ""}`),
    resumoCxGerencial(p, rotulo).respostaMeta,
  ].filter((t): t is string => !!t);
  assert.ok(textos.length > 3);
  for (const t of textos) assert.doesNotMatch(t, />=|<=/, t);
  const sem = { ...metrica("x", "Prazo", 3, "fora", "Meta <= 2"), meta: null, unidade: "dias" as const };
  const s = montarStatusMarcas({ ...p, chat: { ...p.chat, contas: [{ ...p.chat.contas[0], metricas: [sem] }] } }, rotulo);
  assert.match(s.find((x) => x.chave === "apice")!.alertas[0], /\(meta ≤ 2\)$/, "sem numero de meta: o rotulo da Shopee, com o sinal certo");
});

// ---------------------------------------------------------------------------
// CARDS-KPI (09/11): cor de identidade nos cards da /cx, do site e do card CX da Gerencial
// ---------------------------------------------------------------------------
test("cards com cor de identidade: faixa da /cx, CX do site e card CX da Gerencial", () => {
  const tela = readFileSync(new URL("../app/cx/CxConteudo.tsx", import.meta.url), "utf8");
  assert.match(tela, /tile\("contactRate", "atendimento"/);
  assert.match(tela, /tile\("cancelamento", "ads", Ban, r\.cancelamento, null, rodapeComparacao\(r, "cancelamento"\)\)/);
  assert.match(tela, /tile\("reembolso", "gmv"/);
  const site = readFileSync(new URL("../app/cx/CxSite.tsx", import.meta.url), "utf8");
  for (const par of ['"NPS do site": { identidade: "atendimento"', '"Taxa de reenvio": { identidade: "ads"', '"Taxa de reembolso": { identidade: "gmv"', '"Reviews 1–3 ★": { identidade: "pedidos"']) {
    assert.ok(site.includes(par), par);
  }
  const resumo = readFileSync(new URL("../src/components/gerencial/CxResumo.tsx", import.meta.url), "utf8");
  assert.match(resumo, /resposta: \{ identidade: "ticket"/, "na Gerencial a resposta e' kpi-ticket (nao repete o contact rate)");
  assert.match(resumo, /identidade="ads"\s+icone=\{Repeat2\}\s+rotulo="Reenvio"\s+tom="ausente"/);
  assert.match(resumo, /<DeltaBadge pct=\{[^}]+\} unidade="pp" tone=\{estavel \? "neutral" : "lower_is_better"\}/);
  assert.match(resumo, /title=\{ROTULO_INDICADOR\[i\]\}/, "o truncate + title do #263 continua");
  assert.match(resumo, /grid grid-cols-1 gap-3 sm:grid-cols-6 lg:grid-cols-5/, "1 coluna no celular: rotulo inteiro");
});

// ---------------------------------------------------------------------------
// Sem comparacao (pedido da operacao, 09/11): motivo e data, vindos da API-3
// ---------------------------------------------------------------------------
test("sem periodo anterior: linha neutra com motivo e data; sem a API-3, nada", () => {
  assert.deepEqual(textoSemComparacao({ motivo: "coleta desde 04/11", a_partir_de: "2026-12-04", detalhe: "A coleta de conversas começou em 04/11." }),
    { texto: "comparação a partir de 04/12", detalhe: "A coleta de conversas começou em 04/11." }, "comeca pelo que o gestor procura; o motivo no title");
  assert.deepEqual(textoSemComparacao({ motivo: "só em 7 e 30 dias", a_partir_de: null }), { texto: "sem comparação", detalhe: "só em 7 e 30 dias" }, "nunca: sem data");
  assert.equal(textoSemComparacao(null), null);
  const p = comConversas(30);
  assert.deepEqual(resumoCxGerencial(p, rotulo).semAnterior, {}, "API sem o campo: nenhuma linha (nada inventado)");
  const r = resumoCxGerencial({ ...p, sem_anterior: {
    contact_rate: { motivo: "coleta desde 04/11", a_partir_de: "2026-12-04", detalhe: "x" },
    reembolso: { motivo: "devoluções desde 05/10", a_partir_de: "2026-12-04", detalhe: "y" },
  } }, rotulo);
  assert.equal(r.semAnterior.contactRate?.texto, "comparação a partir de 04/12");
  assert.equal(r.semAnterior.reembolso?.detalhe, "y", "sem repetir motivo e detalhe");
  assert.equal(r.semAnterior.cancelamento, undefined);
  const resumo = readFileSync(new URL("../src/components/gerencial/CxResumo.tsx", import.meta.url), "utf8");
  assert.match(resumo, /if \(c\.delta\) return \{ \.\.\.c, \.\.\.grafico \};[\s\S]{0,250}antes: <LinhaSemComparacao \{\.\.\.sem\} \/>/, "a pilula vence; sem ela, a linha");
  assert.match(resumo, /const sem = r\.totais\[i\] == null \? undefined : r\.semAnterior\[i\];/, "valor '—': sem linha de comparacao");
  assert.doesNotMatch(resumo, /LinhaSemComparacao[\s\S]{0,200}crit/, "nunca vermelho");
});

// ---------------------------------------------------------------------------
// API-3 (#290): delta, "antes" e serie diaria nos cards da Shopee
// ---------------------------------------------------------------------------
function comApi3() {
  const p = comConversas(7);
  p.chat.nao_lidas = p.chat.nao_lidas.map((n) => ({ ...n, conversas_anterior: n.marca === "apice" ? 30 : null }));
  p.chat.contas = p.chat.contas.map((c) => ({ ...c, resposta_anterior_pct: c.marca === "apice" ? 80 : 50 }));
  p.atendimento = { ...p.atendimento, marcas: p.atendimento.marcas.map((m) => ({ ...m, pedidos_anterior: m.marca === "apice" ? 1000 : 300, cancelamentos_anterior: 10 })) };
  p.devolucoes = { ...p.devolucoes!, marcas: p.devolucoes!.marcas.map((m) => ({ ...m, aceitas_anterior: 4, reembolsado_anterior: 300 })) };
  return p;
}

test("API-3 Shopee: anterior com as mesmas lojas do valor; delta em p.p.; resposta com os pesos de hoje", () => {
  const r = resumoCxGerencial(comApi3(), rotulo);
  // contact rate 7 d: so' apice tem conversas (40/1000 = 4%); antes 30/1000 = 3%
  assert.deepEqual([r.comparacao.contactRate?.delta?.toFixed(1), r.comparacao.contactRate?.antes, r.comparacao.contactRate?.tone], ["1.0", "antes 3,0%", "lower_is_better"]);
  assert.equal(r.comparacao.contactRate?.serie, null, "contact rate nunca tem serie");
  // reembolso: 8 aceitas / 1000 = 0,8% contra 4 / 1000 = 0,4%
  assert.deepEqual([r.comparacao.reembolso?.delta?.toFixed(1), r.comparacao.reembolso?.antes], ["0.4", "antes 0,4%"]);
  // resposta: media simples (rituaria sem conversas) de 80 e 50 = 65 contra 64 hoje; subir e' melhor
  assert.deepEqual([r.comparacao.resposta?.delta?.toFixed(1), r.comparacao.resposta?.tone], ["-1.0", "higher_is_better"]);
  // reembolso em R$ (Gerencial): 450,50 contra 300 = +50,2%
  assert.deepEqual([r.comparacaoReembolsoReais?.delta?.toFixed(1), r.comparacaoReembolsoReais?.unidade], ["50.2", "pct"]);
  assert.match(r.comparacaoReembolsoReais?.antes ?? "", /^antes R\$\s300,00$/);
});

test("API-3 Shopee: falta o anterior de uma loja do valor, nao compara (nunca parcial)", () => {
  const p = comApi3();
  p.chat.contas[1] = { ...p.chat.contas[1], resposta_anterior_pct: null };
  p.devolucoes = { ...p.devolucoes!, marcas: p.devolucoes!.marcas.map((m) => ({ ...m, aceitas_anterior: null })) };
  const r = resumoCxGerencial(p, rotulo);
  assert.equal(r.comparacao.resposta, null);
  assert.equal(r.comparacao.reembolso, null);
  assert.deepEqual(resumoCxGerencial(comConversas(30), rotulo).comparacao, { contactRate: null, resposta: null, cancelamento: null, reembolso: null }, "API antiga: nada");
});

test("API-3 Shopee: serie diaria agrega as lojas com a regra do card; loja sem medida anula o ponto", () => {
  const p = comApi3();
  const dias = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
  p.serie_diaria = dias.flatMap((dia, i) => [
    { dia, marca: "apice", pedidos: 100, cancelamentos: 2 + i, devolucoes_aceitas: 1, reembolsado: 10, resposta_pct: 80 },
    { dia, marca: "rituaria", pedidos: 100, cancelamentos: 0, devolucoes_aceitas: 0, reembolsado: 0, resposta_pct: 50 },
  ]);
  const r = resumoCxGerencial(p, rotulo);
  assert.deepEqual(r.comparacao.cancelamento?.serie, [1, 1.5, 2, 2.5], "Σcanc/Σped por dia");
  assert.deepEqual(r.comparacao.reembolso?.serie, [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(r.comparacaoReembolsoReais?.serie, [10, 10, 10, 10]);
  assert.equal(r.comparacao.cancelamento?.delta, null, "cancelamento: o delta de hoje segue em cancelamentoDelta");
  p.serie_diaria[3] = { ...p.serie_diaria[3], cancelamentos: null };
  assert.equal(resumoCxGerencial(p, rotulo).comparacao.cancelamento?.serie ?? null, null, "um ponto nulo: sem grafico");
});

test("cancelamento: com sem_anterior da API, regra geral (linha neutra, sem a pilula parcial); heroi com a linha", () => {
  const resumo = readFileSync(new URL("../src/components/gerencial/CxResumo.tsx", import.meta.url), "utf8");
  assert.match(resumo, /r\.semAnterior\.cancelamento \? \{\} : deltaCancelamento\(r\)/);
  const tela = readFileSync(new URL("../app/cx/CxConteudo.tsx", import.meta.url), "utf8");
  assert.match(tela, /!r\.comparacao\.resposta\?\.delta && r\.totais\.resposta != null && r\.semAnterior\.resposta/, "so' sem pilula e com valor");
  const p = comConversas(30);
  const [apice, rit] = p.atendimento.marcas;
  const r = resumoCxGerencial({ ...p, atendimento: { ...p.atendimento, marcas: [{ ...apice, pedidos_anterior: 1000, cancelamentos_anterior: 10 }, rit] },
    sem_anterior: { cancelamento: { motivo: "pedidos desde 04/10", a_partir_de: "2026-12-03", detalhe: "x" } } }, rotulo);
  assert.equal(r.semAnterior.cancelamento?.texto, "comparação a partir de 03/12");
  assert.ok(r.cancelamentoDelta, "o delta parcial continua calculado, mas a tela nao o mostra");
});
