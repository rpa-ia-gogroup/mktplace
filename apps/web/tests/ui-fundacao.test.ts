/**
 * UI-FUNDACAO (F1) — as pecas comuns de toda aba e a BARREIRA: rota nova
 * nasce no esqueleto `Aba`; as que ainda nao migraram estao listadas abaixo,
 * e a lista so' diminui (uma rota que migrou e continua listada tambem falha).
 */
import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { rotuloAtualizado } from "../src/lib/atualizado.ts";

register("./helpers/tsx-loader.mjs", import.meta.url);

const { createElement: h } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { default: SeloAtualizado } = await import("../src/components/ui/SeloAtualizado.tsx");
const { default: Esqueleto } = await import("../src/components/ui/Esqueleto.tsx");
const { LinhaTotal, ouVazio, VAZIO } = await import("../src/components/ui/Tabela.tsx");
const { default: Panel } = await import("../src/components/ui/Panel.tsx");
const { default: Aba } = await import("../src/components/layout/Aba.tsx");
const { LayoutDashboard } = await import("lucide-react");

const RAIZ = join(import.meta.dirname, "..");
const ler = (f: string) => readFileSync(join(RAIZ, f), "utf8");

test("rotuloAtualizado: hoje so' a hora; outro dia com a data; sem horario, null", () => {
  const agora = new Date("2026-11-12T23:30:00Z"); // 20:30 em Brasilia
  assert.equal(rotuloAtualizado("2026-11-13T00:10:00Z", agora), "21:10");
  assert.equal(rotuloAtualizado("2026-11-11T12:05:00Z", agora), "11/11 09:05");
  assert.equal(rotuloAtualizado(null, agora), null);
  assert.equal(rotuloAtualizado("lixo", agora), null);
});

test("SeloAtualizado: 'Atualizado HH:MM', demonstracao escrita e ausencia como '—'", () => {
  const vivo = renderToStaticMarkup(h(SeloAtualizado, { em: new Date().toISOString(), aoVivo: true }));
  assert.match(vivo, /Atualizado <span[^>]*>\d{2}:\d{2}<\/span>/);
  assert.match(vivo, /Ao vivo · /, "o ao vivo e' dito ao leitor de tela, nao so' pelo ponto verde");
  assert.match(renderToStaticMarkup(h(SeloAtualizado, { em: null, aoVivo: false })), /Demonstração · API offline/);
  assert.match(renderToStaticMarkup(h(SeloAtualizado, { em: null })), /Atualizado <span[^>]*>—<\/span>/);
  assert.match(renderToStaticMarkup(h(SeloAtualizado, { em: null, carregando: true })), /Atualizando…/);
});

test("Esqueleto: no formato do conteudo e anunciado como carregando", () => {
  for (const forma of ["cartoes", "tabela", "grafico", "lista"] as const) {
    const html = renderToStaticMarkup(h(Esqueleto, { forma }));
    assert.match(html, /role="status"/, forma);
    assert.match(html, /aria-busy="true"/, forma);
    assert.match(html, /Carregando…/, forma);
  }
  const cartoes = renderToStaticMarkup(h(Esqueleto, { forma: "cartoes", quantidade: 3 }));
  assert.equal((cartoes.match(/rounded-xl/g) ?? []).length, 3);
});

test("Tabela: vazio e' '—' (nunca 0) e o total fica no tfoot", () => {
  const n = (v: number) => v.toLocaleString("pt-BR");
  assert.equal(ouVazio(null, n), VAZIO);
  assert.equal(ouVazio(undefined, n), VAZIO);
  assert.equal(ouVazio(Number.NaN, n), VAZIO);
  assert.equal(ouVazio(0, n), "0");
  const html = renderToStaticMarkup(h("table", null, h(LinhaTotal, { celulas: ["10", VAZIO] })));
  assert.match(html, /<tfoot><tr[^>]*><th scope="row"[^>]*>Total<\/th><td[^>]*>10<\/td><td[^>]*>—<\/td><\/tr><\/tfoot>/);
});

test("Painel: um unico 'ⓘ' colado ao titulo e a acao a' direita", () => {
  const html = renderToStaticMarkup(
    h(Panel, { titulo: "Marcas", ajuda: "Como se calcula.", acao: h("button", null, "Ver todos") }, "corpo"),
  );
  assert.match(html, /<h3[^>]*>Marcas/);
  assert.match(html, /Como se calcula\./);
  assert.match(html, /Ver todos/);
});

test("SortHeader: seta so' na coluna ativa; nas outras, so' no hover/foco", () => {
  const c = ler("src/components/ui/SortHeader.tsx");
  assert.match(c, /opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100/);
});

test("movimento: 120/180/240 ms, utilitarios novos e tudo sob prefers-reduced-motion", () => {
  const css = ler("app/globals.css");
  assert.match(css, /--mov-rapido: 120ms;/);
  assert.match(css, /--mov-base: 180ms;/);
  assert.match(css, /--mov-lento: 240ms;/);
  assert.match(css, /\.tc-troca\[aria-busy="true"\]/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.tc-painel-entra,/);
  // o Popover usa os tokens, nao duracoes soltas
  assert.doesNotMatch(ler("src/components/ui/Popover.tsx"), /opacity_(150|200)ms/);
});

test("Aba: icone em caixa + titulo | selo, barra sticky, e a ordem faixa -> atencao -> paineis", () => {
  const html = renderToStaticMarkup(
    h(
      Aba,
      {
        icone: LayoutDashboard,
        titulo: "Canais",
        selo: h("span", null, "SELO"),
        filtros: h("span", null, "FILTROS"),
        faixa: h("span", null, "FAIXA"),
        atencao: h("span", null, "ATENCAO"),
      },
      h("span", null, "PAINEIS"),
    ),
  );
  assert.match(html, /<h2[^>]*>.*<svg.*Canais<\/span><\/h2>/s);
  assert.match(html, /sticky top-0/);
  const ordem = ["SELO", "FILTROS", "FAIXA", "ATENCAO", "PAINEIS"].map((m) => html.indexOf(m));
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem);
});

// ---------------------------------------------------------------------------
// Barreira: toda rota usa o esqueleto `Aba`, exceto as listadas (a migrar).
// ---------------------------------------------------------------------------
const AINDA_FORA_DO_ESQUELETO = new Set([
  "/",
  "/brand/[brand]",
  "/canais",
  "/cx",
  "/dre",
  "/estoque-full",
  "/estoque-ml-full",
  "/expedicao",
  "/financeiro",
  "/full",
  "/full-ml",
  "/full-shopee",
  "/inteligencia",
  "/marcas-menores",
  "/metas",
  "/monitoramento-preco",
  "/monitoramento-preco/revendedores",
  "/operacoes",
  "/pedidos",
  "/performance-contas",
  "/produtos",
  "/qualidade",
  "/referencias-externas/avoe",
  "/regioes",
  "/tempo-real",
]);

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "api" ? [] : paginas(p);
    return n === "page.tsx" ? [p] : [];
  });
}

/** A rota usa `<Aba` na propria pasta (page.tsx ou o client que ela monta). */
function usaAba(pasta: string, raiz: boolean): boolean {
  return readdirSync(pasta)
    .filter((n) => n.endsWith(".tsx") && (!raiz || n === "page.tsx" || /^Gerencial/.test(n)))
    .some((n) => /<Aba\b/.test(readFileSync(join(pasta, n), "utf8")));
}

test("barreira: rota fora do esqueleto `Aba` so' se estiver na lista (que so' diminui)", () => {
  const app = join(RAIZ, "app");
  for (const pagina of paginas(app)) {
    const pasta = join(pagina, "..");
    const rota = "/" + relative(app, pasta).split(sep).join("/");
    const chave = rota === "/" ? "/" : rota.replace(/\/$/, "");
    const migrou = usaAba(pasta, chave === "/");
    if (migrou) {
      assert.ok(!AINDA_FORA_DO_ESQUELETO.has(chave), `${chave} ja' usa <Aba>: tire-a da lista de excecoes`);
    } else {
      assert.ok(AINDA_FORA_DO_ESQUELETO.has(chave), `${chave} nao usa <Aba> (UI-FUNDACAO): rota nova nasce no esqueleto`);
    }
  }
});
