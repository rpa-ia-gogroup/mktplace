// T-0115b — Marca 360: COS do TikTok com o repasse em maturação mostra "—" e o
// selo "maturando" (regra da T-0115, decidida na API), nunca "0,0%".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { cosCartao } from "../src/lib/brand/cos-maturacao.ts";

const fonte = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const fmt = (v: number) => `${v.toFixed(1)}%`;

test("T-0115b repasse maturando: COS '—' com selo 'maturando'", () => {
  assert.deepEqual(cosCartao(null, "maturando", fmt), { valor: "—", selo: "maturando" });
});

test("T-0115b repasse maduro: COS da API, sem selo", () => {
  assert.deepEqual(cosCartao(30.2, "maduro", fmt), { valor: "30.2%", selo: null });
});

test("T-0115b sem dado ou API antiga (sem o campo): 'Sem dado', sem selo", () => {
  assert.deepEqual(cosCartao(null, "sem_dado", fmt), { valor: "Sem dado", selo: null });
  assert.deepEqual(cosCartao(null, undefined, fmt), { valor: "Sem dado", selo: null });
});

test("T-0115b o painel mensal usa o helper no cartao de COS e o tipo publica o status", () => {
  const painel = fonte("src/components/brand/TikTokMonthlyPanel.tsx");
  assert.match(painel, /cosCartao\(detail\.cos_pct, detail\.tiktok_repasse_status,/);
  assert.match(painel, /<StatCos detail=\{detail\} \/>/);
  assert.doesNotMatch(painel, /<Stat label="COS" value=\{pct\(detail\.cos_pct\)\}/);
  const tipos = fonte("src/lib/api-client.ts");
  assert.ok(tipos.includes('tiktok_repasse_status?: "maduro" | "maturando" | "sem_dado" | null;'));
});
