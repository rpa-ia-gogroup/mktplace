// Preposicao do canal: "na Shopee", nunca "no Shopee" (FULL: detalhe por marca).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { doCanal, noCanal } from "../src/lib/canal-preposicao.ts";
import { canalComPreposicao } from "../src/lib/monitoramento-preco.ts";

test("noCanal / doCanal: genero pelo ID do canal, qualquer que seja o rotulo", () => {
  assert.equal(noCanal("ml", "ML"), "no ML");
  assert.equal(noCanal("ml", "Mercado Livre"), "no Mercado Livre");
  assert.equal(noCanal("shopee", "Shopee"), "na Shopee");
  assert.equal(noCanal("tiktok", "TikTok Shop"), "no TikTok Shop");
  assert.equal(doCanal("shopee", "Shopee"), "da Shopee");
  assert.equal(doCanal("tiktok", "TikTok Shop"), "do TikTok Shop");
  assert.equal(doCanal("ml", "Mercado Livre"), "do Mercado Livre");
});

test("monitoramento de preco: TikTok Shop deixa de sair 'da TikTok Shop'", () => {
  assert.equal(canalComPreposicao("tiktok"), "do TikTok Shop");
  assert.equal(canalComPreposicao("shopee"), "da Shopee");
});

test("nenhum texto da web monta 'no ${canal}' fixo onde o canal pode ser a Shopee", () => {
  const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8");
  assert.ok(!/ no \{NOME_CANAL\[/.test(ler("app/full/VisaoGeralFull.tsx")));
  assert.ok(!/ no \$\{row\.channel_label\}/.test(ler("app/canais/page.tsx")));
  assert.ok(!/ no \$\{channel\}/.test(ler("src/lib/executive-pulse.ts")));
});
