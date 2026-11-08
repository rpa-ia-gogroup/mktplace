/**
 * CX do site (DTC) — `GET /api/v1/cx/site?brands=&dias=30|90`.
 *
 * Tres blocos do Data Mart, cada um com estado proprio (ausencia nunca e'
 * zero): NPS, reenvio/reembolso (taxa sobre o faturamento do site, por safra)
 * e reviews do Judge.me por produto. Funcoes puras testadas em node --test; o
 * componente `app/cx/CxSite.tsx` so' desenha.
 */
import type { FiltrosCx } from "./cx.ts";
import { fmtBrlCurto, fmtNumCurto } from "./formatters.ts";
import { MOTIVO_TIMEOUT, TIMEOUT_API_MS, formatarInstante } from "./performance-contas.ts";

export type EstadoBloco = "dado" | "vazio_legitimo" | "sem_fonte" | "erro";

interface BlocoBase {
  estado: EstadoBloco;
  fonte: string;
  atualizado_em?: string | null;
  aviso_frescor?: string | null;
  motivo_indisponivel?: string | null;
  fora?: { marca: string; motivo: string }[];
}

export interface NpsMarca {
  marca: string;
  respostas: number;
  nps: number;
  promotores_pct: number;
  detratores_pct: number;
}

export interface BlocoNps extends BlocoBase {
  respostas?: number | null;
  nps?: number | null;
  promotores_pct?: number | null;
  neutros_pct?: number | null;
  detratores_pct?: number | null;
  marcas: NpsMarca[];
}

export interface ReenvioMarca {
  marca: string;
  reenvios: number;
  reembolsos: number;
  valor_reenvio: number;
  valor_reembolso: number;
  sem_valor: number;
  faturamento: number | null;
  taxa_reenvio_pct: number | null;
  taxa_reembolso_pct: number | null;
}

export interface BlocoReenvio extends BlocoBase {
  safra_inicio: string;
  safra_fim: string;
  reenvios?: number | null;
  reembolsos?: number | null;
  valor_reenvio?: number | null;
  valor_reembolso?: number | null;
  sem_valor?: number | null;
  taxa_reenvio_pct?: number | null;
  taxa_reembolso_pct?: number | null;
  motivo_sem_taxa?: string | null;
  marcas: ReenvioMarca[];
}

export interface NotaAgregada {
  reviews: number;
  media: number;
  baixas_pct: number;
}

export interface ReviewsProduto extends NotaAgregada {
  marca: string;
  produto: string;
}

export interface BlocoReviews extends BlocoBase {
  ultima_review_em?: string | null;
  reviews?: number | null;
  media?: number | null;
  baixas_pct?: number | null;
  marcas: (NotaAgregada & { marca: string })[];
  minimo_reviews: number;
  piores: ReviewsProduto[];
  melhores: ReviewsProduto[];
}

export interface CxSiteResponse {
  gerado_em: string;
  janela: { inicio: string; fim: string; dias: number };
  nps: BlocoNps;
  reenvio_reembolso: BlocoReenvio;
  reviews: BlocoReviews;
}

export type ResultadoCxSite = { ok: true; dados: CxSiteResponse } | { ok: false; motivo: string };

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
export const ROTA_API_CX_SITE = "/api/v1/cx/site";

/** A rota aceita 30 ou 90: a janela de 7 dias da aba vira 30 (pouca resposta em 7 dias). */
export function diasSite(dias: number): 30 | 90 {
  return dias === 90 ? 90 : 30;
}

export function urlCxSite(base: string, f: FiltrosCx): string {
  const qs = new URLSearchParams();
  if (f.marca) qs.set("brands", f.marca);
  qs.set("dias", String(diasSite(f.dias)));
  return `${base}${ROTA_API_CX_SITE}?${qs.toString()}`;
}

export function problemaNoPayloadSite(json: unknown): string | null {
  if (!json || typeof json !== "object") return "corpo vazio";
  const o = json as Record<string, unknown>;
  for (const bloco of ["nps", "reenvio_reembolso", "reviews"]) {
    const b = o[bloco] as Record<string, unknown> | undefined;
    if (!b || typeof b !== "object" || typeof b.estado !== "string") return `${bloco} ausente`;
  }
  const j = o.janela as Record<string, unknown> | undefined;
  if (!j || typeof j.inicio !== "string" || typeof j.fim !== "string") return "janela ausente";
  return null;
}

/** Nunca lanca: qualquer falha volta como `{ ok: false }`. */
export async function carregarCxSite(
  f: FiltrosCx,
  fetchImpl: typeof fetch = fetch,
  base: string = API_URL,
  timeoutMs: number = TIMEOUT_API_MS,
): Promise<ResultadoCxSite> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const res = await fetchImpl(urlCxSite(base, f), { cache: "no-store", signal: controle.signal });
    if (!res.ok) return { ok: false, motivo: `A API respondeu ${res.status}.` };
    const json: unknown = await res.json();
    const problema = problemaNoPayloadSite(json);
    if (problema) return { ok: false, motivo: `Resposta inválida da API (${problema}).` };
    return { ok: true, dados: json as CxSiteResponse };
  } catch {
    if (controle.signal.aborted) return { ok: false, motivo: MOTIVO_TIMEOUT };
    return { ok: false, motivo: "Não foi possível contatar a API." };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------
const dec = (n: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: n, maximumFractionDigits: n });

export function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${dec(1).format(v)}%`;
}

export function nota(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : `${dec(2).format(v)} ★`;
}

export function npsTexto(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : dec(1).format(v);
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "safra out/26" ou "safras ago a out/26". */
export function textoSafra(inicio: string, fim: string): string {
  const m = (iso: string) => MESES[Number(iso.slice(5, 7)) - 1];
  const ano = fim.slice(2, 4);
  return inicio.slice(0, 7) === fim.slice(0, 7) ? `safra ${m(fim)}/${ano}` : `safras ${m(inicio)} a ${m(fim)}/${ano}`;
}

/** Selo de frescor de um bloco: carga parada vira tom critico, nunca some. */
export function seloFrescor(nome: string, b: BlocoBase): { texto: string; tom: "neutro" | "critico"; title: string } {
  const quando = formatarInstante(b.atualizado_em ?? null);
  if (b.aviso_frescor) return { texto: `${nome}: carga parada`, tom: "critico", title: `${b.aviso_frescor} Fonte: ${b.fonte}` };
  return { texto: quando ? `${nome}: ${quando}` : `${nome}: sem data de carga`, tom: "neutro", title: `Fonte: ${b.fonte}` };
}

// ---------------------------------------------------------------------------
// Visao
// ---------------------------------------------------------------------------
export const AJUDA_SITE = {
  nps:
    "NPS do site = % promotores (nota 9–10) − % detratores (0–6), respostas da pesquisa de NPS do CX " +
    "(cx_nps) no período. Cálculo Torre.",
  reenvio:
    "Valor da NF dos pedidos com reenvio ÷ faturamento do e-commerce da marca, pela safra (mês do pedido " +
    "original). Realizado bruto: não aplica a regra oficial do Vision e não bate com o Vision CX. Safra " +
    "recente ainda recebe reenvios. Linhas sem valor contam na quantidade, não na taxa.",
  reembolso:
    "Valor da NF dos pedidos com reembolso ÷ faturamento do e-commerce da marca, pela safra (mês do pedido " +
    "original). Realizado bruto: não aplica a regra oficial do Vision e não bate com o Vision CX.",
  reviews:
    "Reviews do Judge.me criadas no período (sem as marcadas como spam), publicadas ou não. A Rituária usa " +
    "Konfidency e fica fora.",
  produtos: "Só produtos com o mínimo de reviews no período. Nota média e % de reviews com 1 a 3 estrelas.",
} as const;

export interface TileSite {
  rotulo: string;
  valor: string;
  comparacao: string;
  ajuda: string;
  ausente: boolean;
}

function motivo(b: BlocoBase, padrao: string): string {
  return b.motivo_indisponivel ?? padrao;
}

export function montarTilesSite(d: CxSiteResponse): TileSite[] {
  const { nps, reenvio_reembolso: rr, reviews: rv } = d;
  const safra = textoSafra(rr.safra_inicio, rr.safra_fim);
  const taxa = (rotulo: string, v: number | null | undefined, valor: number | null | undefined,
                qtd: number | null | undefined, ajuda: string): TileSite => {
    if (rr.estado !== "dado") return { rotulo, valor: "—", comparacao: motivo(rr, "Sem dado."), ajuda, ausente: true };
    const base = `${fmtBrlCurto(valor ?? 0)} em ${fmtNumCurto(qtd ?? 0)} pedidos · ${safra}`;
    if (v == null) return { rotulo, valor: "—", comparacao: rr.motivo_sem_taxa ?? base, ajuda, ausente: true };
    return { rotulo, valor: pct(v), comparacao: base, ajuda, ausente: false };
  };
  return [
    nps.estado === "dado"
      ? {
          rotulo: "NPS do site", valor: npsTexto(nps.nps), ajuda: AJUDA_SITE.nps, ausente: false,
          comparacao: `${pct(nps.promotores_pct)} promotores · ${pct(nps.detratores_pct)} detratores · ${fmtNumCurto(nps.respostas ?? 0)} respostas`,
        }
      : { rotulo: "NPS do site", valor: "—", comparacao: motivo(nps, "Sem dado."), ajuda: AJUDA_SITE.nps, ausente: true },
    taxa("Taxa de reenvio", rr.taxa_reenvio_pct, rr.valor_reenvio, rr.reenvios, AJUDA_SITE.reenvio),
    taxa("Taxa de reembolso", rr.taxa_reembolso_pct, rr.valor_reembolso, rr.reembolsos, AJUDA_SITE.reembolso),
    rv.estado === "dado"
      ? {
          rotulo: "Reviews 1–3 ★", valor: pct(rv.baixas_pct), ajuda: AJUDA_SITE.reviews, ausente: false,
          comparacao: `nota média ${nota(rv.media)} · ${fmtNumCurto(rv.reviews ?? 0)} reviews`,
        }
      : { rotulo: "Reviews 1–3 ★", valor: "—", comparacao: motivo(rv, "Sem dado."), ajuda: AJUDA_SITE.reviews, ausente: true },
  ];
}

export interface LinhaMarcaSite {
  chave: string;
  marca: string;
  nps: string;
  detratores: string;
  reenvio: string;
  reembolso: string;
  media: string;
  baixas: string;
}

/** Uma linha por marca com qualquer dado; celula sem fonte = "—" (nunca 0). */
export function montarMarcasSite(d: CxSiteResponse, rotulo: (m: string) => string): LinhaMarcaSite[] {
  const nps = new Map(d.nps.marcas.map((m) => [m.marca, m]));
  const rr = new Map(d.reenvio_reembolso.marcas.map((m) => [m.marca, m]));
  const rv = new Map(d.reviews.marcas.map((m) => [m.marca, m]));
  const chaves = [...new Set([...nps.keys(), ...rr.keys(), ...rv.keys()])].sort();
  return chaves.map((k) => ({
    chave: k,
    marca: rotulo(k),
    nps: npsTexto(nps.get(k)?.nps),
    detratores: pct(nps.get(k)?.detratores_pct),
    reenvio: pct(rr.get(k)?.taxa_reenvio_pct),
    reembolso: pct(rr.get(k)?.taxa_reembolso_pct),
    media: nota(rv.get(k)?.media),
    baixas: pct(rv.get(k)?.baixas_pct),
  }));
}

/** Marcas fora de cada fonte, numa frase por marca/fonte (vai para o ⓘ da tabela). */
export function foraDasFontes(d: CxSiteResponse, rotulo: (m: string) => string): string[] {
  return [d.nps, d.reenvio_reembolso, d.reviews].flatMap((b) => (b.fora ?? []).map((f) => `${rotulo(f.marca)}: ${f.motivo}`));
}
