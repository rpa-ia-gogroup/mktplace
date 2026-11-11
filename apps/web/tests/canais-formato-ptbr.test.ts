/**
 * Canais 2/2: formato pt-BR da casa em TODAS as tabelas da aba ("R$ 4,90 mi",
 * "44,5%", "58,6 mil", "10,4x") e os modais de Afiliados e Descontos TikTok no
 * padrao da Gerencial (icone + cor no cabecalho, estados com StateBlock).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fmtBrlCurto, fmtNumCurto, fmtPctSimples, fmtVezes } from "../src/lib/formatters.ts";

const ler = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf-8").replace(/\r\n/g, "\n");

test("formatadores da casa: o que o gestor le' nas tabelas de Canais", () => {
  assert.equal(fmtBrlCurto(4_900_000), "R$ 4,90 mi");
  assert.equal(fmtBrlCurto(10_800_000), "R$ 10,80 mi");
  assert.equal(fmtNumCurto(58_600), "58,6 mil");
  assert.equal(fmtPctSimples(44.5), "44,5%");
  assert.equal(fmtVezes(10.4), "10,4x");
});

test("Canais: nenhum formato em ingles na pagina nem no 'Canais lado a lado'", () => {
  for (const f of ["app/canais/page.tsx", "src/components/canais/ChannelOverview.tsx"]) {
    const src = ler(f);
    assert.ok(!/\.toFixed\(/.test(src), `${f}: sem toFixed (ponto decimal)`);
    // No ChannelOverview `fmtBrl`/`fmtNumber` sao PROPS de funcao; o que vale e' o que a pagina passa (abaixo).
    if (f.startsWith("app/")) assert.ok(!/\bfmtBrl\(/.test(src) && !/\bfmtNumber\(/.test(src), `${f}: sem fmtBrl()/fmtNumber() (K/M com ponto)`);
    assert.ok(!/\bfmtPct1\b|\bfmtRoas\b/.test(src), `${f}: sem os formatadores locais antigos`);
  }
  const pag = ler("app/canais/page.tsx");
  assert.ok(pag.includes("format={fmtVezes}") && pag.includes("format={fmtPctSimples}"), "ROAS em 'x' com 1 casa e % da casa");
  assert.ok(pag.includes("fmtBrl={fmtBrlCurto} fmtNumber={fmtNumCurto}"), "o topo recebe os formatadores da casa");
});

test("Canais: ausencia continua '—', nunca 0 (fmtPct local)", () => {
  const pag = ler("app/canais/page.tsx");
  assert.ok(pag.includes('return v == null ? "—" : fmtPctSimples(v);'));
});

for (const [arquivo, titulo, icone, identidade] of [
  ["src/components/AffiliateCostsPanel.tsx", "AFFILIATE_BLOCK_TITLE", "Handshake", "ads"],
  ["src/components/TiktokOrderDiscountsPanel.tsx", "DISCOUNTS_BLOCK_TITLE", "BadgePercent", "ticket"],
] as const) {
  test(`${arquivo.split("/").pop()}: modal herda icone e cor, estados via StateBlock, skeleton no token`, () => {
    const src = ler(arquivo);
    assert.ok(src.includes(`icone={${icone}}`) && src.includes(`identidade="${identidade}"`), "icone + cor de identidade no cabecalho do modal");
    assert.ok(src.includes(`title={${titulo}}`), "titulo do modal igual ao de antes");
    assert.ok(src.includes('import StateBlock from "./ui/StateBlock"'));
    assert.ok(!/<p className="text-sm text-(warn-ink|ink-faint)">/.test(src), "sem <p> solto nos estados terminais");
    assert.ok(src.includes('tipo="indisponivel" titulo="Indisponível: falha ao carregar canais."'), "texto do estado terminal igual ao de antes");
    assert.ok(src.includes("bg-raised") && !src.includes("bg-accent-soft rounded"), "skeleton em bg-raised (brilho do CSS)");
    assert.equal((src.match(/animate-pulse/g) ?? []).length, 1, "so' o ramo de loading pulsa");
  });
}

test("valores contabeis de Afiliados e Descontos seguem por extenso (nao abreviam)", () => {
  assert.ok(!/fmtBrlCurto|fmtNumCurto/.test(ler("src/components/AffiliateCostsPanel.tsx")));
  assert.ok(!/fmtBrlCurto|fmtNumCurto/.test(ler("src/components/TiktokOrderDiscountsPanel.tsx")));
  assert.ok(ler("src/lib/canais-tiktok-order-discounts.ts").includes("Nao abrevia"));
});

test("modais de Afiliados e Descontos: o ⓘ fica colado no ultimo selo (nao sozinho na linha de baixo no celular)", () => {
  for (const f of ["src/components/AffiliateCostsPanel.tsx", "src/components/TiktokOrderDiscountsPanel.tsx"]) {
    const src = ler(f);
    assert.ok(/<span className="inline-flex items-center gap-1\.5">\n(?:.*\n)*?\s*<InfoDica/.test(src), `${f}: selo + ⓘ no mesmo grupo`);
  }
});
