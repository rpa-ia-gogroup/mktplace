// Clique na evolucao por vencimento (ML e Shopee) + Concentracao por marca nos tres canais.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  csvDosAtrasados,
  diaFechado,
  queryAtrasadosDia,
  rotuloStatus,
} from "../src/lib/expedicao-atrasados-dia.ts";
import { META_TETO, linhasDeConcentracao } from "../src/lib/expedicao-ldr-topo.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const fonte = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

test("rota da lista por canal, com marca e pagina", () => {
  assert.equal(queryAtrasadosDia("mercadolivre", "2026-11-12", null), "/api/v1/expedicao/ml/ldr/pedidos?vencimento=2026-11-12");
  assert.equal(
    queryAtrasadosDia("shopee", "2026-11-12", "lescent", 3),
    "/api/v1/expedicao/shopee/ldr/pedidos?vencimento=2026-11-12&brands=lescent&page=3",
  );
});

test("so' dia fechado abre a lista (hoje ainda esta' no prazo)", () => {
  const agora = new Date("2026-11-16T15:00:00Z");
  assert.equal(diaFechado("2026-11-15", agora), true);
  assert.equal(diaFechado("2026-11-16", agora), false);
  // 01:00 UTC de 17/11 ainda e' 16/11 em Brasilia
  assert.equal(diaFechado("2026-11-16", new Date("2026-11-17T01:00:00Z")), false);
});

test("status no nome do painel; codigo desconhecido sai cru, ausente vira '—'", () => {
  assert.equal(rotuloStatus("mercadolivre", "ready_to_ship"), "Pronto para envio");
  assert.equal(rotuloStatus("shopee", "PROCESSED"), "Aguardando coleta");
  assert.equal(rotuloStatus("shopee", "novo_status"), "novo_status");
  assert.equal(rotuloStatus("shopee", null), "—");
});

test("CSV com ';', BOM e numero ausente vazio (nunca inventado)", () => {
  const csv = csvDosAtrasados(
    "mercadolivre",
    [
      { brand: "kokeshi", order_id: "200001", status: "shipped", deadline_at: "2026-11-12T14:00:00", collected_at: "2026-11-13T09:00:00" },
      { brand: "barbours", order_id: null, status: "ready_to_ship", deadline_at: "2026-11-12T14:00:00", collected_at: null },
    ],
    "2026-11-12",
  );
  const [cab, l1, l2] = csv.replace("﻿", "").split("\n");
  assert.ok(csv.startsWith("﻿"));
  assert.equal(cab, "pedido;marca;status_hoje;dia_do_prazo;prazo;coletado_em;situacao");
  assert.equal(l1, "200001;kokeshi;A caminho;2026-11-12;2026-11-12 14:00:00;2026-11-13 09:00:00;coletado depois do prazo");
  assert.equal(l2, ";barbours;Pronto para envio;2026-11-12;2026-11-12 14:00:00;;ainda sem coleta");
});

test("concentracao Shopee/ML: so' marca com base, cor pela meta/teto do canal", () => {
  const linhas = linhasDeConcentracao(
    [
      { brand: "a", base: 100, late: 1, rate: 0.01 },
      { brand: "b", base: 100, late: 4, rate: 0.04 },
      { brand: "c", base: 100, late: 7, rate: 0.07 },
      { brand: "d", base: 0, late: 0, rate: null },
    ],
    META_TETO.mercadolivre,
    (b) => b.toUpperCase(),
  );
  assert.deepEqual(
    linhas.map((l) => [l.nome, l.severidade]),
    [["A", "ok"], ["B", "fora_da_meta"], ["C", "critico"]],
  );
});

test("ML e Shopee: evolucao clicavel + concentracao ao lado, com o popup comum", () => {
  const cliente = fonte("app/expedicao/ExpedicaoClient.tsx");
  assert.match(cliente, /aoClicar=\{faixaTopo \? setDiaAtrasado : undefined\}/);
  assert.match(cliente, /clicavel=\{\(dia\) => diaFechado\(dia\) && ladoLdr\.dias\.some\(\(d\) => d\.due_date === dia && d\.is_mature\)\}/);
  assert.match(cliente, /concentracao=\{\s*ladoLdr\?\.marcas \? \(\s*<ConcentracaoPorMarca/);
  assert.match(cliente, /<PopupAtrasadosDoDia\s+api=\{API\}\s+canal=\{filtros\.channel\}/);
  // O popup reaproveita o CSV de todas as paginas e a paginacao do TikTok.
  const popup = fonte("src/components/expedicao/PopupAtrasadosDoDia.tsx");
  assert.match(popup, /import \{ BotaoCsvCompleto, NavPaginas, baixarCsv \} from "@\/components\/expedicao\/TikTokColetaPerdida"/);
  // Marca sem fonte no canal nao vira "nenhum pedido".
  assert.match(popup, /brand_without_source/);
});

test("referencia: etiqueta no topo com o texto do canal, linha sempre na escala", () => {
  const evo = fonte("src/components/expedicao/EvolucaoPorVencimento.tsx");
  assert.match(evo, /const escala = Math\.max\(maximo, linha\.valor\);/);
  assert.match(evo, /alturaDaBarra\(d, escala\)/);
  const cliente = fonte("app/expedicao/ExpedicaoClient.tsx");
  assert.match(cliente, /rotulo: "Meta da Shopee"/);
  assert.match(cliente, /rotulo: "Meta do ML"/);
});

test("Revisor UX #478: popup no celular, 'Situação hoje', por marca rotulado, chip pela cor da tabela", async () => {
  const popup = fonte("src/components/expedicao/PopupAtrasadosDoDia.tsx");
  assert.match(popup, /<th scope="col" className=\{SO_TELA_LARGA\}>Situação hoje<\/th>/);
  assert.doesNotMatch(popup, />Hoje<\/th>/);
  for (const f of [popup, fonte("src/components/expedicao/TikTokColetaPerdida.tsx")]) {
    assert.match(f, /\$\{b\.missed === 1 \? "atrasado" : "atrasados"\} · \$\{formatarInteiro\(b\.still_waiting\)\} sem coleta/);
  }
  const conc = fonte("src/components/expedicao/ConcentracaoPorMarca.tsx");
  assert.match(conc, /linhas\.some\(\(m\) => m\.severidade === "critico"\) \? "critico" : acima \? "atencao" : "neutro"/);
  // Demo: o total do popup e' o `late` do dia na serie da barra.
  const { respostaFicticia } = await import("../src/lib/expedicao-fixtures.ts");
  for (const [rota, serie] of [["ml/ldr", "daily"], ["shopee/ldr", "ldr"]] as const) {
    const ldr = respostaFicticia(`http://x/api/v1/expedicao/${rota}`, "ok")!.corpo as Record<string, any>;
    const dias = (serie === "daily" ? ldr.daily : ldr.ldr.daily) as { due_date: string; late: number }[];
    const dia = dias[dias.length - 2];
    const lista = respostaFicticia(`http://x/api/v1/expedicao/${rota}/pedidos?vencimento=${dia.due_date}`, "ok")!.corpo as { list_total: number };
    assert.equal(lista.list_total, dia.late, rota);
  }
});
