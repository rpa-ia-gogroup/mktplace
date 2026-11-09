/**
 * CARDS-CLICAVEIS (spec do Prumo) — cada card de Estoque Shopee / Estoque ML
 * abre, na tabela da aba, a lista dos itens que ele conta. A regra e' uma so':
 * o numero do card e' o tamanho da lista (ou, nos cards de unidades, a soma
 * das unidades da lista). Ordem: grupos da curva (AA -> A -> demais) e, dentro
 * do grupo, o criterio da categoria.
 */
import { ordenarPorCurva, type ItemComCurva } from "./estoque-curva.ts";
import { EXIGEM_ACAO, type ProdutoEstoque } from "./estoque-full.ts";
import type { InventarioML } from "./ml-full-estoque.ts";

export interface Categoria<T> {
  chave: string;
  /** Nome no chip "Mostrando: <rotulo> (n)". */
  rotulo: string;
  pertence: (t: T) => boolean;
  /** Criterio dentro do grupo de curva. */
  criterio: (t: T) => number | string | null | undefined;
  desc?: boolean;
  /** Cards de UNIDADES: a soma disto na lista = o numero do card. */
  unidades?: (t: T) => number;
  /** ML: a contagem inclui inventarios fora do Full (busca com incluir_fora_do_full). */
  foraDoFull?: (t: T) => boolean;
}

const cobertura = (t: { cobertura_torre_dias: number | string | null }) => t.cobertura_torre_dias;
const unidadesPositivas = (n: number | null | undefined) => (n ?? 0) > 0;

export const CATEGORIAS_SHOPEE: Categoria<ProdutoEstoque>[] = [
  {
    chave: "unidades", rotulo: "itens com unidades vendáveis no Full",
    pertence: (p) => p.classificacao_torre !== "KIT_NAO_CONCILIADO" && unidadesPositivas(p.full_stock_saleable),
    criterio: (p) => p.full_stock_saleable, desc: true, unidades: (p) => p.full_stock_saleable,
  },
  { chave: "exigem-acao", rotulo: "Exigem ação", pertence: (p) => EXIGEM_ACAO.includes(p.classificacao_torre), criterio: cobertura },
  { chave: "ruptura", rotulo: "Ruptura", pertence: (p) => p.classificacao_torre === "RUPTURA_CANDIDATA", criterio: cobertura },
  { chave: "baixo", rotulo: "Estoque baixo", pertence: (p) => p.classificacao_torre === "BAIXO_CANDIDATO", criterio: cobertura },
  { chave: "excesso", rotulo: "Excesso", pertence: (p) => p.classificacao_torre === "EXCESSO_CANDIDATO", criterio: cobertura, desc: true },
  { chave: "sem-giro", rotulo: "Sem giro", pertence: (p) => p.classificacao_torre === "SEM_GIRO_CANDIDATO", criterio: cobertura, desc: true },
  { chave: "suficiente", rotulo: "Suficiente", pertence: (p) => p.classificacao_torre === "SUFICIENTE", criterio: cobertura },
  { chave: "kits", rotulo: "Kits não conciliados", pertence: (p) => p.classificacao_torre === "KIT_NAO_CONCILIADO", criterio: cobertura },
];

const exigeML = (i: InventarioML) =>
  i.classificacao_torre === "RUPTURA_CANDIDATA" || i.classificacao_torre === "BAIXO_CANDIDATO";
const foraML = (i: InventarioML) => !i.eh_full;

export const CATEGORIAS_ML: Categoria<InventarioML>[] = [
  {
    chave: "disponivel", rotulo: "itens com unidades disponíveis no Full",
    pertence: (i) => i.eh_full && unidadesPositivas(i.disponivel),
    criterio: (i) => i.disponivel, desc: true, unidades: (i) => i.disponivel ?? 0,
  },
  { chave: "exigem-acao", rotulo: "Exigem ação", pertence: exigeML, criterio: cobertura },
  // A API conta "lido" como read_status = 'OK', em TODOS os inventarios (Full ou nao).
  { chave: "sem-leitura", rotulo: "Sem leitura", pertence: (i) => i.read_status !== "OK", criterio: cobertura, foraDoFull: foraML },
  { chave: "compartilhados", rotulo: "Compartilhados", pertence: (i) => i.compartilhado, criterio: cobertura, foraDoFull: foraML },
  { chave: "ruptura", rotulo: "Ruptura", pertence: (i) => i.classificacao_torre === "RUPTURA_CANDIDATA", criterio: cobertura },
  { chave: "baixo", rotulo: "Estoque baixo", pertence: (i) => i.classificacao_torre === "BAIXO_CANDIDATO", criterio: cobertura },
  { chave: "excesso", rotulo: "Excesso", pertence: (i) => i.classificacao_torre === "EXCESSO_CANDIDATO", criterio: cobertura, desc: true },
  {
    chave: "nao-disponivel", rotulo: "itens com unidades não disponíveis no Full",
    pertence: (i) => i.eh_full && unidadesPositivas(i.nao_disponivel),
    criterio: (i) => i.nao_disponivel, desc: true, unidades: (i) => i.nao_disponivel ?? 0,
  },
];

export function categoriaPorChave<T>(lista: readonly Categoria<T>[], chave: string | null | undefined): Categoria<T> | null {
  return lista.find((c) => c.chave === chave) ?? null;
}

/** A lista que o card abre, na ordem da spec. */
export function abrirCategoria<T extends ItemComCurva>(itens: readonly T[], cat: Categoria<T>): T[] {
  return ordenarPorCurva(itens.filter(cat.pertence), cat.criterio, cat.desc);
}

/** "Mostrando: Compartilhados (242) · inclui 57 fora do Full". */
export function textoChip<T>(cat: Categoria<T>, lista: readonly T[]): string {
  const base = `Mostrando: ${cat.rotulo} (${lista.length.toLocaleString("pt-BR")})`;
  if (!cat.foraDoFull) return base;
  const fora = lista.filter(cat.foraDoFull).length;
  return fora ? `${base} · inclui ${fora.toLocaleString("pt-BR")} fora do Full` : base;
}

/** O valor que o card mostra, medido na lista que ele abre (teste: = indicador da API). */
export function medidaDaLista<T>(cat: Categoria<T>, lista: readonly T[]): number {
  return cat.unidades ? lista.reduce((s, t) => s + cat.unidades!(t), 0) : lista.length;
}

/** Categoria lida da URL: chave desconhecida = nenhuma. */
export function categoriaDaUrl(lida: string | null, validas: readonly string[]): string | null {
  return lida && validas.includes(lida) ? lida : null;
}

/** Endereco com (ou sem) ?categoria=, preservando os outros parametros (?aba=). */
export function urlComCategoria(caminho: string, atuais: string, chave: string | null): string {
  const q = new URLSearchParams(atuais);
  if (chave) q.set("categoria", chave);
  else q.delete("categoria");
  const s = q.toString();
  return s ? `${caminho}?${s}` : caminho;
}
