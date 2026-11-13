/**
 * Pagina de marca — cartoes de "Situacao da marca" no padrao da Gerencial.
 * Logica PURA (testada): valor, periodo anterior, variacao e serie diaria saem
 * do MESMO dado ja' carregado (`summarize` + linhas projetadas), entao o detalhe
 * nunca contradiz o cartao e nada novo e' buscado.
 *
 * Ausencia nunca vira zero: sem valor, o cartao mostra "—". Sem periodo anterior
 * REAL (comparacao desligada, janela vazia ou base zero) nao ha pilula nem "antes".
 */
import type { DailyRow } from "../mock-daily.ts";
import type { DailySummary } from "../brand-daily-summary.ts";
import { fmtBrlCurto, fmtBrlExato, fmtNumCurto } from "../formatters.ts";

export type ChaveSituacao = "gmv" | "pedidos" | "ticket" | "adspend";

export interface CartaoSituacao {
  chave: ChaveSituacao;
  /** `null` = sem dado (nunca zero fabricado). */
  valor: number | null;
  /** Periodo anterior REAL (> 0), ou `null`. */
  antes: number | null;
  /** Variacao % contra `antes`, ou `null`. */
  deltaPct: number | null;
  /** Um ponto por dia com dado, na ordem; o mini grafico so' aparece com >= 4. */
  serie: number[];
}

export const ROTULO_SITUACAO: Record<ChaveSituacao, string> = {
  gmv: "GMV",
  pedidos: "Pedidos",
  ticket: "Ticket médio",
  adspend: "Ad Spend",
};

const real = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);
const positivo = (n: number | null | undefined): n is number => real(n) && n > 0;

/** Ticket de 0 pedidos nao e' R$ 0: e' ausencia. */
function ticketDe(s: DailySummary): number | null {
  return s.orders != null && s.orders > 0 ? s.avgTicket : null;
}

function comparar(cur: number | null, prev: number | null, temAnterior: boolean): Pick<CartaoSituacao, "antes" | "deltaPct"> {
  if (!temAnterior || !real(cur) || !positivo(prev)) return { antes: null, deltaPct: null };
  return { antes: prev, deltaPct: ((cur - prev) / prev) * 100 };
}

export function cartoesSituacao(
  cur: DailySummary,
  prev: DailySummary,
  projetadas: readonly DailyRow[],
  temAnterior: boolean,
): CartaoSituacao[] {
  const pedidosOk = cur.orders != null;
  const adspend = positivo(cur.adSpend) ? cur.adSpend : null;
  return [
    { chave: "gmv", valor: cur.gmv, ...comparar(cur.gmv, prev.gmv, temAnterior), serie: cur.gmv != null ? projetadas.map((r) => r.total_gmv) : [] },
    {
      chave: "pedidos",
      valor: cur.orders,
      ...comparar(cur.orders, prev.orders, temAnterior),
      serie: pedidosOk ? projetadas.map((r) => r.orders) : [],
    },
    {
      chave: "ticket",
      valor: ticketDe(cur),
      ...comparar(ticketDe(cur), ticketDe(prev), temAnterior),
      serie: pedidosOk ? projetadas.map((r) => r.avg_ticket).filter(real) : [],
    },
    {
      chave: "adspend",
      valor: adspend,
      ...comparar(adspend, prev.adSpend, temAnterior),
      serie: adspend != null ? projetadas.map((r) => r.ad_spend).filter(real) : [],
    },
  ];
}

/**
 * T-0111: legenda do Ad Spend ausente, pelo CANAL SELECIONADO. Antes dizia
 * "N/D para TikTok Shop" ate' com so' o Mercado Livre na selecao.
 */
export function legendaAdsAusente(canais: readonly string[], semDado: boolean): string {
  if (semDado) return "Sem dado no recorte";
  const temMidia = canais.includes("ml") || canais.includes("shopee");
  if (!temMidia) return canais.includes("tiktok") ? "N/D para TikTok Shop" : "Sem canal com Ads";
  return "Sem Ads no período (ausência, não zero)";
}

const NUM = new Intl.NumberFormat("pt-BR");
const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Valor do cartao no formato da casa ("R$ 4,90 mi", "58,6 mil"). */
export function valorCurto(chave: ChaveSituacao, v: number): string {
  return chave === "pedidos" ? fmtNumCurto(v) : fmtBrlCurto(v);
}

/** Valor EXATO, para o topo do detalhe (o cartao mostra o curto). So' o ticket leva centavos, como nos outros detalhes. */
export function valorExato(chave: ChaveSituacao, v: number): string {
  if (chave === "pedidos") return NUM.format(v);
  return chave === "ticket" ? fmtBrlExato(v) : BRL0.format(v);
}

/** Metodologia do detalhe (vai no ⓘ, nao na tela). */
export const DICA_SITUACAO: Record<ChaveSituacao, string> = {
  gmv: "Soma do GMV dos canais selecionados no intervalo global.",
  pedidos: "Pedidos do intervalo global nos canais selecionados.",
  ticket: "GMV dividido pelos pedidos do intervalo global.",
  adspend: "Investimento em anúncios do intervalo global. O ROAS é o GMV dividido por este valor, aproximado.",
};
