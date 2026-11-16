// Testes da identidade de requisicao por tabela/resumo em Produtos (Gate
// U4, rodada de correcao consolidada — FINDING 1) e do estado de
// disponibilidade parcial (FINDING 3).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPeriodTableKey, buildPeriodSummaryKey,
  resolveChannelAvailability, describeProdutosPartialWarning,
} from "../src/lib/produtos-request-key.ts";

const PERIOD_TABLE_BASE = { brand: "kokeshi", period: "2026-07", bucket: null, offset: 0, sortColumn: null, sortDirection: null };

test("chave de tabela ML/TikTok/Shopee (compartilhada) muda com marca, periodo, bucket, offset e sort", () => {
  const base = buildPeriodTableKey(PERIOD_TABLE_BASE);
  assert.notEqual(buildPeriodTableKey({ ...PERIOD_TABLE_BASE, brand: "apice" }), base);
  assert.notEqual(buildPeriodTableKey({ ...PERIOD_TABLE_BASE, period: "2026-06" }), base);
  assert.notEqual(buildPeriodTableKey({ ...PERIOD_TABLE_BASE, bucket: "B_next30" }), base);
  assert.notEqual(buildPeriodTableKey({ ...PERIOD_TABLE_BASE, offset: 25 }), base);
  assert.notEqual(buildPeriodTableKey({ ...PERIOD_TABLE_BASE, sortColumn: "gmv", sortDirection: "asc" }), base);
});

test("chave de resumo TikTok/Shopee (compartilhada) so depende de marca+periodo", () => {
  const a = buildPeriodSummaryKey({ brand: "kokeshi", period: "2026-07" });
  const b = buildPeriodSummaryKey({ brand: "kokeshi", period: "2026-07" });
  assert.equal(a, b);
  assert.notEqual(a, buildPeriodSummaryKey({ brand: "kokeshi", period: "2026-06" }));
});

// ── resolveChannelAvailability — cobertura obrigatoria do FINDING 1 ──────

test("chave desatualizada (render anterior ao efeito, ex.: troca de aba/filtro) -> loading, mesmo com dado em memoria", () => {
  const status = resolveChannelAvailability({ resolvedKey: "old-key", requestKey: "new-key", loading: false, hasData: true });
  assert.equal(status, "loading");
});

test("retorno a uma aba previamente visitada: chave da aba antiga nao bate com a nova identidade -> loading", () => {
  // Simula: usuario estava em ML (resolvedKey="brandA"), foi para TikTok e
  // voltou para ML com filtro diferente (requestKey="brandB") antes do
  // efeito da nova busca rodar.
  const status = resolveChannelAvailability({ resolvedKey: "brandA", requestKey: "brandB", loading: false, hasData: true });
  assert.equal(status, "loading");
});

test("loading=true sempre vence, mesmo com chaves batendo", () => {
  const status = resolveChannelAvailability({ resolvedKey: "k", requestKey: "k", loading: true, hasData: true });
  assert.equal(status, "loading");
});

test("chave bate, nao esta carregando, tem dado -> available (sucesso, inclusive vazio ja tratado por hasData=true)", () => {
  const status = resolveChannelAvailability({ resolvedKey: "k", requestKey: "k", loading: false, hasData: true });
  assert.equal(status, "available");
});

test("chave bate, nao esta carregando, SEM dado -> unavailable (falha resolvida para a identidade atual)", () => {
  const status = resolveChannelAvailability({ resolvedKey: "k", requestKey: "k", loading: false, hasData: false });
  assert.equal(status, "unavailable");
});

// ── describeProdutosPartialWarning — FINDING 3 (Produtos) ────────────────

test("tabela e resumo disponiveis -> sem aviso (sucesso completo)", () => {
  assert.equal(describeProdutosPartialWarning("available", "available"), null);
});

test("tabela disponivel, resumo indisponivel -> aviso de dados parciais mencionando o resumo", () => {
  const msg = describeProdutosPartialWarning("available", "unavailable");
  assert.ok(msg && msg.toLowerCase().includes("resumo"));
});

test("resumo disponivel, tabela indisponivel -> aviso de dados parciais mencionando a tabela", () => {
  const msg = describeProdutosPartialWarning("unavailable", "available");
  assert.ok(msg && msg.toLowerCase().includes("tabela"));
});

test("ambos indisponiveis (erro total) -> sem aviso de PARCIAL (estado de erro/offline de cada componente ja cobre)", () => {
  assert.equal(describeProdutosPartialWarning("unavailable", "unavailable"), null);
});

test("qualquer um ainda carregando -> nunca mostra aviso parcial (evita falso positivo antes de resolver)", () => {
  assert.equal(describeProdutosPartialWarning("loading", "available"), null);
  assert.equal(describeProdutosPartialWarning("available", "loading"), null);
  assert.equal(describeProdutosPartialWarning("loading", "loading"), null);
});
