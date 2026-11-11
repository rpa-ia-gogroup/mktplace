/**
 * Metas no padrao da Gerencial: faixa de totais (Meta global + um por canal) saindo do
 * MESMO rascunho da grade; ausencia nunca vira zero.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cartoesMetas, SEM_META } from "../src/lib/metas-cartoes.ts";
import { chave, totais } from "../src/lib/metas.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

test("totais do rascunho: global e por canal, com participacao so' com base > 0", () => {
  const t = totais({ [chave("barbours", "tiktok")]: 3000, [chave("barbours", "ml")]: 1000, [chave("kokeshi", "ml")]: 1000 });
  const [g, tk, ml, sh] = cartoesMetas(t);
  assert.equal(g.chave, "global");
  assert.equal(g.ausente, false);
  assert.match(tk.comparacao ?? "", /60,0% da meta global|60% da meta global/);
  assert.match(ml.comparacao ?? "", /40,0% da meta global|40% da meta global/);
  assert.equal(sh.ausente, true, "canal sem meta e' ausencia, nao R$ 0");
  assert.equal(sh.comparacao, SEM_META);
});

test("sem nenhuma meta: tudo ausente; meta zero nao divide por zero", () => {
  for (const c of cartoesMetas(totais({}))) {
    assert.equal(c.ausente, true, c.chave);
    assert.equal(c.comparacao, c.chave === "global" ? SEM_META : null, c.chave);
    assert.equal(c.valor, "—");
  }
  const zero = cartoesMetas(totais({ [chave("barbours", "ml")]: 0 }));
  assert.equal(zero[0].ausente, false, "0 digitado e' meta zero, nao ausencia");
  assert.equal(zero[2].comparacao, null, "sem base positiva nao ha percentual");
});

test("pagina: faixa gerencial antes da grade, rodape sem o destaque antigo", () => {
  const T = ler("src/components/metas/MetasTotais.tsx");
  const C = ler("app/metas/MetasClient.tsx");
  const G = ler("src/components/metas/MetasGrade.tsx");
  assert.ok(T.includes('variante="gerencial"') && T.includes('identidade="gmv"') && T.includes("CHANNEL_DOT"));
  assert.ok(C.indexOf("<MetasTotais") > 0 && C.indexOf("<MetasTotais") < C.indexOf("<MetasGrade"));
  assert.ok(C.includes("totais(analise.efetivos)"), "o cartao acompanha o rascunho, como o rodape");
  assert.ok(!G.includes("text-lg font-bold text-accent"), "o destaque da Meta global saiu do rodape");
});
