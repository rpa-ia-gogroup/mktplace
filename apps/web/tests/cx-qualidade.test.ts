/**
 * Qualidade da resposta (Nath, 24/11/2026): SLA de 1 dia, fila de agora, sem fonte nunca vira 0.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { qualidadeMl, qualidadeShopee, SLA_LIMITE_S } from "../src/lib/cx-qualidade.ts";

const rotulo = (m: string) => m.toUpperCase();
const nl = (x: Record<string, unknown>) => ({ marca: "apice", valor: null, capturado_em: null, ...x });

test("Shopee: media acima de 1 dia fica fora do SLA e vem primeiro", () => {
  const v = qualidadeShopee(
    {
      chat: {
        estado: "dado",
        notas: [],
        contas: [],
        sem_foto: [],
        nao_lidas: [
          nl({ marca: "apice", tempo_resposta_fonte: "mediana", tempo_resposta_s: 600, tempo_resposta_media_s: 3600, respostas: 40, respostas_mais_1d: 2, aguardando_resposta: 3, espera_max_s: 7200 }),
          nl({ marca: "barbours", tempo_resposta_fonte: "mediana", tempo_resposta_s: 900, tempo_resposta_media_s: SLA_LIMITE_S + 60, respostas: 10, respostas_mais_1d: 4, aguardando_resposta: 0, espera_max_s: null }),
        ],
      },
    } as never,
    rotulo,
  );
  assert.deepEqual(v.linhas.map((l) => l.chave), ["barbours", "apice"]);
  const [b, a] = v.linhas;
  assert.equal(b.tempoFora, true);
  assert.equal(a.tempoFora, false);
  assert.equal(a.tempo, "1 h 00");
  assert.equal(a.tempoDetalhe, "mediana 10 min · 2 de 40 respostas acima de 1 dia");
  assert.equal(a.filaDetalhe, "mais antiga há 2 h 00");
  assert.match(v.semFonte, /CSAT.*TMA/);
});

test("Shopee: loja sem medida fica com traco e motivo, nunca zero", () => {
  const [l] = qualidadeShopee({ chat: { estado: "dado", notas: [], contas: [], sem_foto: [], nao_lidas: [nl({})] } } as never, rotulo).linhas;
  assert.equal(l.tempo, "—");
  assert.equal(l.fila, "—");
  assert.equal(l.tempoFora, false);
  assert.ok(l.tempoDetalhe);
});

test("Shopee: Kokeshi usa a media do Seller Centre; fila parada ha' mais de 1 dia fica fora", () => {
  const [l] = qualidadeShopee(
    { chat: { estado: "dado", notas: [], contas: [], sem_foto: [], nao_lidas: [nl({ marca: "kokeshi", tempo_resposta_fonte: "media_seller_centre", tempo_resposta_s: 1800, aguardando_resposta: 5, espera_max_s: 2 * SLA_LIMITE_S })] } } as never,
    rotulo,
  ).linhas;
  assert.equal(l.tempo, "30 min");
  assert.equal(l.filaFora, true);
  assert.equal(l.tempoDetalhe, "média do Seller Centre");
});

test("ML: tempo oficial em minutos, pergunta com mais de 24 h deixa a fila fora", () => {
  const agora = Date.parse("2026-11-24T12:00:00Z");
  const v = qualidadeMl(
    {
      marcas: [
        { marca: "rituaria", tempo_resposta_min: 90, perguntas_sem_resposta: 2, perguntas_sem_resposta_24h: 1, pergunta_mais_antiga: "2026-11-22T12:00:00Z", resposta_mediana_h: 5 },
        { marca: "barbours", tempo_resposta_min: null, perguntas_sem_resposta: null },
      ],
    } as never,
    rotulo,
    agora,
  );
  const r = v.linhas.find((l) => l.chave === "rituaria")!;
  assert.equal(r.tempo, "1 h 30");
  assert.equal(r.filaFora, true);
  assert.equal(r.filaDetalhe, "mais antiga há 2 d");
  assert.match(r.tempoDetalhe!, /reclamações: 1ª ação em 5 h 00/);
  const b = v.linhas.find((l) => l.chave === "barbours")!;
  assert.equal(b.tempo, "—");
  assert.equal(b.fila, "—");
});
