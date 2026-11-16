/**
 * T-0117 (A2-201) — legenda da margem conhecida na PREVIA com cenario.
 *
 * Desde 13/11 impostos e devolucoes entram na margem conhecida; a tela dizia
 * "Conhecida 13,4% (sem impostos, devoluções e parte do CMV)" por texto fixo.
 * A legenda agora sai de `margem_contribuicao_conhecida.faltam` da API.
 *
 * Fixtures sinteticas; o caso "impostos entram" reproduz a FORMA do total de
 * out/26 depois de 13/11 18:37Z (faltam = devolucoes e Ads; impostos usados),
 * nao os valores.
 */
import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

register("./helpers/tsx-loader.mjs", import.meta.url);

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: DreResumo } = await import("../src/components/dre/DreResumo.tsx");
const { margemPrincipal, legendaConhecida } = await import("../src/lib/dre.ts");
const fx = await import("./dre-fixtures.ts");
const fe = await import("./dre-fixtures-estimada.ts");

const texto = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const cenario = fe.cenarioFx({ estado: "parcial", previa: true, receita: 100_000, margem: 18_000 });

/** Celula PREVIA com cenario estimado (a estimada e' o destaque). */
function previa(o: { canal?: string | null; marca?: string | null; usados: string[]; faltam: string[] }) {
  const c = fx.celula({
    canal: o.canal ?? null,
    marca: o.marca ?? null,
    classificacao: "PREVIA",
    comps: {
      receita: fx.comp(100_000, "disponivel", { somavel: false }),
      taxas: fx.comp(15_000, "parcial"),
      frete: fx.comp(8_000, "parcial"),
      cmv: fx.comp(30_000, "parcial"),
      impostos: o.usados.includes("impostos")
        ? fx.comp(9_000, "parcial", { entra_na_margem: true })
        : fx.comp(null, "indisponivel", { motivo: "sem publicacao do webgex" }),
      devolucoes: o.usados.includes("devolucoes")
        ? fx.comp(2_000, "parcial", { entra_na_margem: true })
        : fx.comp(null, "indisponivel", { motivo: "sem fonte" }),
      ads: o.usados.includes("ads") ? fx.comp(4_000, "parcial") : fx.comp(null, "indisponivel"),
    },
    margem: 30_000,
    usados: o.usados,
    faltam: o.faltam,
  });
  return { ...c, previa: true, fecha_em: "2026-12-31", cenario_premissas: cenario };
}

function secundaria(c: ReturnType<typeof previa>): string {
  const p = margemPrincipal(c);
  assert.equal(p.tipo, "estimada");
  return p.tipo === "estimada" ? p.secundaria : "";
}

const resumo = (c: ReturnType<typeof previa>) =>
  texto(renderToStaticMarkup(h(DreResumo, { total: c, competencia: "10/2026", bloqueadores: [] }) as never));

test("A2-201: com impostos e devolucoes entrando, a legenda nao diz 'sem impostos' nem 'sem devoluções'", () => {
  // Forma do total de out/26 pos-13/11: impostos e devolucoes usados; devolucoes e Ads faltam em algum canal.
  const c = previa({
    usados: ["devolucoes", "taxas", "ads", "frete", "cmv", "impostos"],
    faltam: ["devolucoes", "ads"],
  });
  const s = secundaria(c);
  assert.doesNotMatch(s, /impostos/);
  assert.doesNotMatch(s, /parte do CMV/);
  assert.equal(s, "Conhecida: 30,0% (sem devoluções e Ads em ao menos um canal)");
  const t = resumo(c);
  assert.match(t, /Conhecida: 30,0% \(sem devoluções e Ads em ao menos um canal\)/);
  assert.doesNotMatch(t, /sem impostos/);
});

test("A2-201: com o imposto ausente, a legenda diz 'sem impostos'", () => {
  const c = previa({
    canal: "ml",
    marca: "barbours",
    usados: ["devolucoes", "taxas", "ads", "frete", "cmv"],
    faltam: ["impostos"],
  });
  assert.equal(secundaria(c), "Conhecida: 30,0% (sem impostos)", "celula canal x marca: sem qualificador");
  assert.match(resumo(c), /Conhecida: 30,0% \(sem impostos\)/);
});

test("A2-201: o escopo do agregado por canal qualifica a ausencia por marca", () => {
  const c = previa({ canal: "tiktok", usados: ["taxas", "frete", "cmv", "impostos"], faltam: ["devolucoes", "ads"] });
  assert.equal(legendaConhecida(c), " (sem devoluções e Ads em ao menos uma marca)");
});

test("A2-201: nada faltando -> sem parentese (nenhuma lista inventada)", () => {
  const c = previa({ usados: ["devolucoes", "taxas", "ads", "frete", "cmv", "impostos"], faltam: [] });
  assert.equal(legendaConhecida(c), "");
  assert.equal(secundaria(c), "Conhecida: 30,0%");
  assert.doesNotMatch(resumo(c), /Conhecida: 30,0% \(/);
});
