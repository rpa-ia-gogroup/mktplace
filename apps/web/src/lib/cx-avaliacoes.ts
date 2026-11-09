/**
 * Avaliacoes de produto da Shopee na aba CX (`GET /api/v1/cx/shopee/avaliacoes`).
 *
 * Nota ACUMULADA (todas as avaliacoes ja' lidas): nao segue o periodo da aba.
 * Ausencia nunca vira zero: marca sem dado sai "—" com o motivo. `truncado` =
 * a contagem e' um piso ("≥"). Sem texto de avaliacao (sem PII).
 */
import type { FiltrosCx } from "./cx.ts";
import { nota, pct } from "./cx-site.ts";
import { MOTIVO_TIMEOUT, TIMEOUT_API_MS, formatarInstante } from "./performance-contas.ts";

export type EstadoAvaliacoes = "dado" | "vazio_legitimo" | "sem_fonte" | "erro";

export interface AvaliacoesMarca {
  marca: string;
  estado: "dado" | "sem_fonte";
  motivo: string | null;
  itens: number | null;
  avaliacoes: number | null;
  com_nota: number | null;
  nota_media: number | null;
  pct_1a3: number | null;
  pct_respondidas: number | null;
  truncado: boolean;
  varrido_em: string | null;
}

export interface AvaliacoesProduto {
  marca: string;
  item_id: string;
  nome: string | null;
  avaliacoes: number;
  com_nota: number;
  nota_media: number | null;
  avaliacoes_1a3: number;
  pct_1a3: number | null;
  truncado: boolean;
}

export interface CxAvaliacoesResponse {
  gerado_em: string;
  estado: EstadoAvaliacoes;
  motivo_indisponivel: string | null;
  fonte: string;
  varrido_em: string | null;
  completa_em: string | null;
  aviso_frescor: string | null;
  minimo_avaliacoes: number;
  marcas: AvaliacoesMarca[];
  total: AvaliacoesMarca | null;
  produtos: AvaliacoesProduto[];
}

export type ResultadoAvaliacoes = { ok: true; dados: CxAvaliacoesResponse } | { ok: false; motivo: string };

export const ROTA_API_AVALIACOES = "/api/v1/cx/shopee/avaliacoes";
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export function urlAvaliacoes(base: string, f: Pick<FiltrosCx, "marca">): string {
  return f.marca ? `${base}${ROTA_API_AVALIACOES}?${new URLSearchParams({ brands: f.marca })}` : `${base}${ROTA_API_AVALIACOES}`;
}

export function problemaNoPayloadAvaliacoes(json: unknown): string | null {
  if (!json || typeof json !== "object") return "corpo vazio";
  const o = json as Record<string, unknown>;
  if (typeof o.estado !== "string") return "estado ausente";
  if (!Array.isArray(o.marcas) || !Array.isArray(o.produtos)) return "listas ausentes";
  return null;
}

/** Nunca lanca: qualquer falha volta como `{ ok: false }`. */
export async function carregarAvaliacoes(
  f: Pick<FiltrosCx, "marca">,
  fetchImpl: typeof fetch = fetch,
  base: string = API_URL,
  timeoutMs: number = TIMEOUT_API_MS,
): Promise<ResultadoAvaliacoes> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const res = await fetchImpl(urlAvaliacoes(base, f), { cache: "no-store", signal: controle.signal });
    if (!res.ok) return { ok: false, motivo: `A API respondeu ${res.status}.` };
    const json: unknown = await res.json();
    const problema = problemaNoPayloadAvaliacoes(json);
    if (problema) return { ok: false, motivo: `Resposta inválida da API (${problema}).` };
    return { ok: true, dados: json as CxAvaliacoesResponse };
  } catch {
    if (controle.signal.aborted) return { ok: false, motivo: MOTIVO_TIMEOUT };
    return { ok: false, motivo: "Não foi possível contatar a API." };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Formato e visao
// ---------------------------------------------------------------------------
const inteiro = new Intl.NumberFormat("pt-BR");

/** "12.345", ou "≥ 12.345" quando a contagem e' um piso; ausente = "—". */
export function contagem(n: number | null, truncado: boolean): string {
  if (n == null) return "—";
  return `${truncado ? "≥ " : ""}${inteiro.format(n)}`;
}

export const PISO = "a contagem é um piso: a Shopee entrega no máximo 1.000 avaliações por produto (e a coleta lê até 20 páginas)";

export interface LinhaAvaliacoes {
  chave: string;
  marca: string;
  nota: string;
  pct1a3: string;
  pctRespondidas: string;
  avaliacoes: string;
  /** Motivo da ausencia ou do piso, para o title e o sr-only. */
  nota_extra: string | null;
  ausente: boolean;
}

export function linhaAvaliacoes(m: AvaliacoesMarca, rotulo: string): LinhaAvaliacoes {
  const ausente = m.estado !== "dado";
  return {
    chave: m.marca,
    marca: rotulo,
    nota: nota(m.nota_media).replace(" ★", ""),
    pct1a3: pct(m.pct_1a3),
    pctRespondidas: pct(m.pct_respondidas),
    avaliacoes: contagem(m.avaliacoes, m.truncado),
    nota_extra: ausente ? m.motivo : m.truncado ? PISO : null,
    ausente,
  };
}

export type OrdemProdutos = "pior" | "1a3";

/** "pior": nota asc, desempate por avaliacoes 1–3 ★ desc. "1a3": avaliacoes 1–3 ★ desc. */
export function ordenarProdutos(itens: AvaliacoesProduto[], ordem: OrdemProdutos): AvaliacoesProduto[] {
  const notaOu = (p: AvaliacoesProduto) => p.nota_media ?? Number.POSITIVE_INFINITY;
  return [...itens].sort((a, b) =>
    ordem === "pior"
      ? notaOu(a) - notaOu(b) || b.avaliacoes_1a3 - a.avaliacoes_1a3
      : b.avaliacoes_1a3 - a.avaliacoes_1a3 || notaOu(a) - notaOu(b),
  );
}

export function nomeProduto(p: AvaliacoesProduto): string {
  return p.nome?.trim() || `Produto ${p.item_id}`;
}

/** Texto do ⓘ do titulo: frescor, regra da nota, minimo da lista e marcas sem dado. */
export function ajudaAvaliacoes(d: CxAvaliacoesResponse, rotulo: (m: string) => string): string {
  const varrido = formatarInstante(d.varrido_em);
  const completa = formatarInstante(d.completa_em);
  const fora = d.marcas.filter((m) => m.estado !== "dado").map((m) => `${rotulo(m.marca)}: ${m.motivo ?? "sem dado"}`);
  return [
    "Nota acumulada de todas as avaliações já lidas da Shopee; não segue o período da aba.",
    "Nota da marca = média ponderada pelas avaliações com nota de cada produto.",
    `Lista de produtos: só com ${d.minimo_avaliacoes} avaliações ou mais.`,
    varrido ? `Última varredura: ${varrido}${completa ? `; última leitura completa: ${completa}` : ""}.` : null,
    d.aviso_frescor,
    fora.length ? `Sem dado — ${fora.join("; ")}.` : null,
    `Fonte: ${d.fonte}.`,
  ]
    .filter(Boolean)
    .join(" ");
}
