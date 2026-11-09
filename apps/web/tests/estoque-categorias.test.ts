/**
 * CARDS-CLICAVEIS (abas Estoque Shopee e Estoque ML): o numero do card e' o
 * tamanho da lista que ele abre (ou a soma das unidades, nos cards de volume).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  abrirCategoria, CATEGORIAS_ML, CATEGORIAS_SHOPEE, categoriaDaUrl, medidaDaLista, textoChip, urlComCategoria,
  type Categoria,
} from "../src/lib/estoque-categorias.ts";
import type { ProdutoEstoque } from "../src/lib/estoque-full.ts";
import type { InventarioML } from "../src/lib/ml-full-estoque.ts";

const ler = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// Que indicador da API cada card mostra (lido da propria aba, abaixo).
const CARD_SHOPEE: Record<string, string> = {
  unidades: "unidades_vendaveis_operacional", "exigem-acao": "produtos_exigem_acao", ruptura: "produtos_ruptura",
  baixo: "produtos_baixo", excesso: "produtos_excesso", "sem-giro": "produtos_sem_giro",
  suficiente: "produtos_suficientes", kits: "produtos_kit_nao_conciliado",
};
const CARD_ML: Record<string, string> = {
  disponivel: "disponivel_full", "exigem-acao": "inventarios_exigem_acao", "sem-leitura": "inventarios_sem_leitura",
  compartilhados: "inventarios_compartilhados", ruptura: "inventarios_ruptura", baixo: "inventarios_baixo",
  excesso: "inventarios_excesso", "nao-disponivel": "nao_disponivel_full",
};

test("cada card da aba mostra o indicador da sua categoria (e so' categorias conhecidas)", () => {
  for (const [f, mapa, cats] of [
    ["app/estoque-full/EstoqueFullClient.tsx", CARD_SHOPEE, CATEGORIAS_SHOPEE],
    ["app/estoque-ml-full/MLFullEstoqueClient.tsx", CARD_ML, CATEGORIAS_ML],
  ] as const) {
    const src = ler(f);
    const achados = [...src.matchAll(/\{ chave: "([\w-]+)", rotulo: "[^"]+", valor: fmt(?:Int|Opcional)\(i\.(\w+)\)/g)]
      .map((m) => [m[1], m[2]]);
    assert.deepEqual(Object.fromEntries(achados), mapa, f);
    assert.deepEqual(achados.map(([c]) => c), (cats as readonly Categoria<unknown>[]).map((c) => c.chave), `${f}: um card por categoria`);
  }
});

// Fotografia sintetica nas regras da API (classificacao pronta; kit fora do operacional).
const P = (classe: ProdutoEstoque["classificacao_torre"], vendavel: number, cob: number | null, curva: ProdutoEstoque["curva"] = null) =>
  ({ classificacao_torre: classe, full_stock_saleable: vendavel, cobertura_torre_dias: cob, curva }) as ProdutoEstoque;
const SHOPEE = [
  P("RUPTURA_CANDIDATA", 0, 0, "B"), P("RUPTURA_CANDIDATA", 0, 0, "AA"), P("BAIXO_CANDIDATO", 12, 3.5, "A"),
  P("EXCESSO_CANDIDATO", 900, 120), P("EXCESSO_CANDIDATO", 500, 300, "AA"), P("EXCESSO_CANDIDATO", 50, 95, "C"),
  P("SEM_GIRO_CANDIDATO", 40, null), P("SUFICIENTE", 80, 30, "A"), P("SEM_DEMANDA_MEDIDA", 0, null),
  P("KIT_NAO_CONCILIADO", 70, 10),
];
const contar = (cl: string) => SHOPEE.filter((p) => p.classificacao_torre === cl).length;
const IND_SHOPEE: Record<string, number> = {
  unidades_vendaveis_operacional: SHOPEE.filter((p) => p.classificacao_torre !== "KIT_NAO_CONCILIADO")
    .reduce((s, p) => s + p.full_stock_saleable, 0),
  produtos_exigem_acao: contar("RUPTURA_CANDIDATA") + contar("BAIXO_CANDIDATO"),
  produtos_ruptura: contar("RUPTURA_CANDIDATA"), produtos_baixo: contar("BAIXO_CANDIDATO"),
  produtos_excesso: contar("EXCESSO_CANDIDATO"), produtos_sem_giro: contar("SEM_GIRO_CANDIDATO"),
  produtos_suficientes: contar("SUFICIENTE"), produtos_kit_nao_conciliado: contar("KIT_NAO_CONCILIADO"),
};

const I = (o: Partial<InventarioML>) => ({
  eh_full: true, read_status: "OK", compartilhado: false, disponivel: 0, nao_disponivel: 0,
  classificacao_torre: "SUFICIENTE", cobertura_torre_dias: 20, curva: null, ...o,
}) as InventarioML;
const ML = [
  I({ classificacao_torre: "RUPTURA_CANDIDATA", disponivel: 0, nao_disponivel: 4, cobertura_torre_dias: 0, curva: "A" }),
  I({ classificacao_torre: "BAIXO_CANDIDATO", disponivel: 7, cobertura_torre_dias: 2, compartilhado: true }),
  I({ classificacao_torre: "EXCESSO_CANDIDATO", disponivel: 400, cobertura_torre_dias: 200, curva: "AA" }),
  I({ classificacao_torre: "EXCESSO_CANDIDATO", disponivel: 900, cobertura_torre_dias: 400 }),
  I({ classificacao_torre: "SUFICIENTE", disponivel: 60, nao_disponivel: 2, compartilhado: true, curva: "B" }),
  I({ classificacao_torre: "SEM_LEITURA", read_status: "NOT_FOUND", disponivel: null, nao_disponivel: null, cobertura_torre_dias: null }),
  // fora do Full: so' entram em "Compartilhados" e "Sem leitura"
  I({ eh_full: false, classificacao_torre: "FORA_DO_FULL", compartilhado: true, disponivel: 30 }),
  I({ eh_full: false, classificacao_torre: "FORA_DO_FULL", read_status: "ERRO", disponivel: null }),
];
const full = ML.filter((i) => i.eh_full && i.read_status === "OK");
const classe = (cl: string) => ML.filter((i) => i.classificacao_torre === cl).length;
const IND_ML: Record<string, number> = {
  disponivel_full: full.reduce((s, i) => s + (i.disponivel ?? 0), 0),
  nao_disponivel_full: full.reduce((s, i) => s + (i.nao_disponivel ?? 0), 0),
  inventarios_exigem_acao: classe("RUPTURA_CANDIDATA") + classe("BAIXO_CANDIDATO"),
  inventarios_sem_leitura: ML.filter((i) => i.read_status !== "OK").length,
  inventarios_compartilhados: ML.filter((i) => i.compartilhado).length,
  inventarios_ruptura: classe("RUPTURA_CANDIDATA"), inventarios_baixo: classe("BAIXO_CANDIDATO"),
  inventarios_excesso: classe("EXCESSO_CANDIDATO"),
};

test("contagem = lista: cada card abre exatamente o que conta (unidades: soma = card)", () => {
  for (const c of CATEGORIAS_SHOPEE) {
    assert.equal(medidaDaLista(c, abrirCategoria(SHOPEE, c)), IND_SHOPEE[CARD_SHOPEE[c.chave]], `Shopee ${c.chave}`);
  }
  // ML: a lista e' buscada com os fora do Full quando a categoria pede (Compartilhados, Sem leitura)
  for (const c of CATEGORIAS_ML) {
    const lista = c.foraDoFull ? ML : ML.filter((i) => i.eh_full);
    assert.equal(medidaDaLista(c, abrirCategoria(lista, c)), IND_ML[CARD_ML[c.chave]], `ML ${c.chave}`);
    // categorias so' do Full nao mudam se os fora do Full vierem na lista
    if (!c.foraDoFull) assert.equal(abrirCategoria(ML, c).length, abrirCategoria(lista, c).length, `ML ${c.chave} sem fora`);
  }
  const comp = CATEGORIAS_ML.find((c) => c.chave === "compartilhados")!;
  assert.equal(textoChip(comp, abrirCategoria(ML, comp)), "Mostrando: Compartilhados (3) · inclui 1 fora do Full");
  const exc = CATEGORIAS_SHOPEE.find((c) => c.chave === "excesso")!;
  assert.equal(textoChip(exc, abrirCategoria(SHOPEE, exc)), "Mostrando: Excesso (3)");
});

test("ordem: grupos da curva; excesso e unidades desc, ruptura asc, sem valor no fim", () => {
  const por = (cats: readonly Categoria<never>[], k: string) => cats.find((c) => c.chave === k)!;
  const exc = abrirCategoria(SHOPEE, por(CATEGORIAS_SHOPEE as never, "excesso"));
  // AA primeiro; nos demais (C e sem curva juntos), mais dias de cobertura primeiro
  assert.deepEqual(exc.map((p) => [p.curva, p.cobertura_torre_dias]), [["AA", 300], [null, 120], ["C", 95]]);
  const un = abrirCategoria(SHOPEE, por(CATEGORIAS_SHOPEE as never, "unidades"));
  assert.deepEqual(un.map((p) => p.full_stock_saleable), [500, 80, 12, 900, 50, 40]);
  const disp = abrirCategoria(ML, por(CATEGORIAS_ML as never, "disponivel"));
  assert.deepEqual(disp.map((i) => i.disponivel), [400, 900, 60, 7]);
  const rup = abrirCategoria(SHOPEE, por(CATEGORIAS_SHOPEE as never, "exigem-acao"));
  assert.deepEqual(rup.map((p) => p.curva), ["AA", "A", "B"]);
});

test("URL: ?categoria= ida e volta, preservando ?aba=; chave desconhecida = nenhuma", () => {
  const ida = urlComCategoria("/full", "aba=estoque-ml", "compartilhados");
  assert.equal(ida, "/full?aba=estoque-ml&categoria=compartilhados");
  const volta = urlComCategoria("/full", ida.split("?")[1], null);
  assert.equal(volta, "/full?aba=estoque-ml");
  assert.equal(urlComCategoria("/full", "categoria=excesso", null), "/full");
  const validas = CATEGORIAS_ML.map((c) => c.chave);
  assert.equal(categoriaDaUrl("compartilhados", validas), "compartilhados");
  assert.equal(categoriaDaUrl("kits", validas), null, "card da Shopee nao vale no ML");
  assert.equal(categoriaDaUrl(null, validas), null);
});

test("parcial: UM aviso no topo das abas; nenhum card repete o prefixo", () => {
  const sh = ler("app/estoque-full/EstoqueFullClient.tsx");
  assert.equal((sh.match(/Cobertura parcial: sem/g) ?? []).length, 1);
  assert.ok(sh.indexOf("Cobertura parcial: sem") < sh.indexOf("<FaixaCategorias"), "aviso antes dos cards");
  for (const f of ["app/estoque-full/EstoqueFullClient.tsx", "app/estoque-ml-full/MLFullEstoqueClient.tsx"]) {
    const src = ler(f);
    assert.ok(!src.includes("Parcial: ver aviso acima") && !src.includes("subvalorContagemML("), f);
    assert.match(src, /ativa=\{chaveCategoria\}/, f);
    assert.match(src, /<ChipCategoria ref=\{chipRef\}/, f);
  }
  const kpi = ler("src/components/ui/KpiTile.tsx");
  assert.match(kpi, /aria-pressed=\{filtra \? ativo : undefined\}/);
  assert.match(kpi, /aria-haspopup=\{filtra \? undefined : "dialog"\}/);
});
