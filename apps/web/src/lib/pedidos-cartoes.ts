/**
 * Pedidos — cartoes no padrao da Gerencial e o detalhe "por marca" que o clique
 * abre. Logica PURA (testada): o valor do cartao, a serie do mini grafico e a
 * linha de cada marca saem do MESMO dado ja' carregado na pagina, entao o detalhe
 * nunca contradiz o cartao. Nada novo e' buscado.
 *
 * Formatadores da casa (fmtNumCurto, fmtBrlCurto, fmtPctSimples): "39,4 mil",
 * "R$ 3,88 mi", "4,6%". Ausencia nunca vira zero: sem valor, "—"/"Sem dado".
 */
import type { PedidosBrandRow, PedidosDailyRow } from "./api-client.ts";
import { fmtBrlCurto, fmtNumCurto, fmtPctSimples } from "./formatters.ts";
import { ticketPorPonto } from "./gerencial/kpi-trend.ts";

/** Fonte so' cobre TikTok Shop e Mercado Livre (nunca Shopee). */
export interface Selecao {
  tiktok: boolean;
  ml: boolean;
}

export type ChaveDetalhe =
  | "total_pedidos"
  | "total_gmv"
  | "ticket"
  | "cancelamento"
  | "tk_pedidos"
  | "tk_cancelados"
  | "ml_pedidos"
  | "ml_cancelados"
  | "tk_gmv"
  | "ml_gmv";

export const TITULO_DETALHE: Record<ChaveDetalhe, string> = {
  total_pedidos: "Total de pedidos",
  total_gmv: "GMV total",
  ticket: "Ticket médio",
  cancelamento: "Taxa de cancelamento",
  tk_pedidos: "Pedidos · TikTok Shop",
  tk_cancelados: "Cancelados · TikTok Shop",
  ml_pedidos: "Pedidos · Mercado Livre",
  ml_cancelados: "Cancelados · Mercado Livre",
  tk_gmv: "GMV · TikTok Shop",
  ml_gmv: "GMV · Mercado Livre",
};

/** Cancelamento: a regra de negocio que ja' existia (<2% ok, <5% atencao, senao critico). */
export function tomDoCancelamento(v: number | null): "ausente" | "bom" | "atencao" | "critico" {
  if (v == null) return "ausente";
  if (v < 2) return "bom";
  if (v < 5) return "atencao";
  return "critico";
}

const NUM = new Intl.NumberFormat("pt-BR");
const BRL2 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BRL0 = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** Valor EXATO para o topo do detalhe (o cartao mostra o curto). */
export function valorExato(chave: ChaveDetalhe, d: Dados): string {
  const c = d.kpis;
  switch (chave) {
    case "total_pedidos": return c ? NUM.format(c.total_orders) : "—";
    case "total_gmv": return c ? BRL0.format(c.total_gmv) : "—";
    case "ticket": return c ? BRL2.format(c.avg_ticket) : "—";
    case "cancelamento": return c?.cancel_rate_pct != null ? fmtPctSimples(c.cancel_rate_pct) : "—";
    case "tk_pedidos": return d.tk ? NUM.format(d.tk.orders) : "—";
    case "ml_pedidos": return d.ml ? NUM.format(d.ml.orders) : "—";
    case "tk_cancelados": return d.tk ? NUM.format(d.tk.canceled) : "—";
    case "ml_cancelados": return d.ml ? NUM.format(d.ml.canceled) : "—";
    case "tk_gmv": return d.tk ? BRL0.format(d.tk.gmv) : "—";
    case "ml_gmv": return d.ml ? BRL0.format(d.ml.gmv) : "—";
  }
}

export interface Dados {
  kpis: { total_orders: number; total_gmv: number; avg_ticket: number; cancel_rate_pct: number | null } | null | undefined;
  tk: { orders: number; canceled: number; gmv: number; cancel_rate_pct: number | null; delivered: number | null } | null | undefined;
  ml: { orders: number; canceled: number; gmv: number; cancel_rate_pct: number | null; delivered: number | null } | null | undefined;
}

// ---------------------------------------------------------------------------
// Series (mini grafico). Reais, do `daily` da propria resposta; o Data Mart chega
// com D-1, entao a cauda sem pedido e' cortada antes (senao o "hoje" zerado puxa a
// tendencia para baixo). Ticket e taxa sao razoes ponto a ponto, como na Gerencial.
// ---------------------------------------------------------------------------

export interface Series {
  pedidos: number[];
  gmv: number[];
  ticket: number[];
  cancelamento: number[];
  tkPedidos: number[];
  mlPedidos: number[];
  tkCancelados: number[];
  mlCancelados: number[];
}

const soloNumeros = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x != null && Number.isFinite(x));

export function seriesDoPeriodo(daily: PedidosDailyRow[], sel: Selecao): Series {
  let fim = daily.length;
  while (fim > 0 && !(daily[fim - 1].total_orders > 0)) fim--;
  const d = daily.slice(0, fim);
  const pedidos = d.map((r) => r.total_orders);
  const gmv = d.map((r) => r.total_gmv);
  const cancelamento = d.map((r) => {
    const ped = (sel.tiktok ? r.tiktok_orders : 0) + (sel.ml ? r.ml_orders : 0);
    const can = (sel.tiktok ? r.tiktok_canceled : 0) + (sel.ml ? r.ml_canceled : 0);
    return ped > 0 ? (can / ped) * 100 : null;
  });
  return {
    pedidos,
    gmv,
    ticket: soloNumeros(ticketPorPonto(gmv, pedidos)),
    cancelamento: soloNumeros(cancelamento),
    tkPedidos: d.map((r) => r.tiktok_orders),
    mlPedidos: d.map((r) => r.ml_orders),
    tkCancelados: d.map((r) => r.tiktok_canceled),
    mlCancelados: d.map((r) => r.ml_canceled),
  };
}

/** Serie de cada detalhe (so' os que tem). */
export function serieDoDetalhe(chave: ChaveDetalhe, s: Series): number[] {
  switch (chave) {
    case "total_pedidos": return s.pedidos;
    case "total_gmv": return s.gmv;
    case "ticket": return s.ticket;
    case "cancelamento": return s.cancelamento;
    case "tk_pedidos": return s.tkPedidos;
    case "ml_pedidos": return s.mlPedidos;
    case "tk_cancelados": return s.tkCancelados;
    case "ml_cancelados": return s.mlCancelados;
    // A API nao traz o GMV por canal por dia: sem serie, sem tendencia (nada inventado).
    case "tk_gmv":
    case "ml_gmv": return [];
  }
}

/**
 * Variacao de uma TAXA entre o trecho recente e o anterior, em PONTOS PERCENTUAIS
 * (media dos ultimos N contra a dos N anteriores, mesma janela da tendencia).
 * "−0,5%" ao lado de uma taxa de 3,8% seria lido como pontos; a conta e' a diferenca.
 */
export function variacaoEmPp(pontos: number[]): number | null {
  if (pontos.length < 4) return null;
  const janela = pontos.length >= 14 ? 7 : Math.floor(pontos.length / 2);
  const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const pp = Math.round((media(pontos.slice(-janela)) - media(pontos.slice(-2 * janela, -janela))) * 10) / 10;
  // 1 casa, como sera' escrito: -0,04 vira 0 (nunca "−0,0 p.p.", um sinal sobre um valor que arredonda para zero).
  return pp === 0 ? 0 : pp;
}

// ---------------------------------------------------------------------------
// Detalhe por marca
// ---------------------------------------------------------------------------

export interface LinhaMarca {
  brand: string;
  label: string;
  /** Texto da linha ("12,3 mil · 4,6% canc."); "Sem dado" quando ausente. */
  valor: string;
  ausente: boolean;
  /** 0–100 para a barra, relativa a maior marca; `null` quando nao ha' valor. */
  pct: number | null;
}

type Num = number | null | undefined;
const soma = (...v: Num[]): number | null => {
  const ok = v.filter((x): x is number => x != null);
  return ok.length ? ok.reduce((a, b) => a + b, 0) : null;
};

interface DefMarca {
  num: (r: PedidosBrandRow, s: Selecao) => number | null;
  fmt: (v: number) => string;
  apoio?: (r: PedidosBrandRow, s: Selecao) => string | undefined;
}

const taxa = (can: Num, ped: Num): number | null => (can != null && ped != null && ped > 0 ? (can / ped) * 100 : null);
const cancelados = (n: Num) => (n != null ? `${fmtNumCurto(n)} cancelados` : undefined);

const DEF_MARCA: Record<ChaveDetalhe, DefMarca> = {
  total_pedidos: { num: (r) => r.total_orders, fmt: fmtNumCurto },
  total_gmv: { num: (r) => r.total_gmv, fmt: fmtBrlCurto },
  ticket: { num: (r) => (r.total_orders > 0 ? r.total_gmv / r.total_orders : null), fmt: fmtBrlCurto },
  cancelamento: {
    num: (r, s) => taxa(soma(s.tiktok ? r.tiktok_canceled : null, s.ml ? r.ml_canceled : null), soma(s.tiktok ? r.tiktok_orders : null, s.ml ? r.ml_orders : null)),
    fmt: fmtPctSimples,
    apoio: (r, s) => cancelados(soma(s.tiktok ? r.tiktok_canceled : null, s.ml ? r.ml_canceled : null)),
  },
  tk_pedidos: { num: (r) => r.tiktok_orders ?? null, fmt: fmtNumCurto },
  ml_pedidos: { num: (r) => r.ml_orders ?? null, fmt: fmtNumCurto },
  tk_cancelados: { num: (r) => r.tiktok_cancel_rate_pct ?? null, fmt: fmtPctSimples, apoio: (r) => cancelados(r.tiktok_canceled) },
  ml_cancelados: { num: (r) => r.ml_cancel_rate_pct ?? null, fmt: fmtPctSimples, apoio: (r) => cancelados(r.ml_canceled) },
  tk_gmv: { num: (r) => r.tiktok_gmv ?? null, fmt: fmtBrlCurto },
  ml_gmv: { num: (r) => r.ml_gmv ?? null, fmt: fmtBrlCurto },
};

/**
 * Uma linha por marca, das que tem valor primeiro (maior -> menor) e as sem dado
 * depois. A barra e' relativa a maior marca (taxas de cancelamento sao pequenas;
 * pelo valor cru a barra nao se veria).
 */
export function linhasPorMarca(chave: ChaveDetalhe, marcas: PedidosBrandRow[], sel: Selecao): LinhaMarca[] {
  const def = DEF_MARCA[chave];
  const lidas = marcas.map((m) => ({ m, v: def.num(m, sel) }));
  const maior = Math.max(0, ...lidas.map((l) => l.v ?? 0));
  const comValor = lidas
    .filter((l): l is { m: PedidosBrandRow; v: number } => l.v != null)
    .sort((a, b) => b.v - a.v)
    .map(({ m, v }) => {
      const apoio = def.apoio?.(m, sel);
      return {
        brand: m.brand,
        label: m.label,
        valor: apoio ? `${def.fmt(v)} · ${apoio}` : def.fmt(v),
        ausente: false,
        pct: maior > 0 ? (v / maior) * 100 : 0,
      };
    });
  const semValor = lidas.filter((l) => l.v == null).map(({ m }) => ({ brand: m.brand, label: m.label, valor: "Sem dado", ausente: true, pct: null }));
  return [...comValor, ...semValor];
}

export interface LinhaCanal {
  canal: "tiktok" | "ml";
  label: string;
  valor: string;
  ausente: boolean;
  pct: number | null;
}

/** Quebra por canal dos 4 totais, so' com os canais selecionados. */
export function linhasPorCanal(chave: ChaveDetalhe, d: Dados, sel: Selecao): LinhaCanal[] {
  if (!(chave === "total_pedidos" || chave === "total_gmv" || chave === "ticket" || chave === "cancelamento")) return [];
  const canais = [
    { canal: "tiktok" as const, label: "TikTok Shop", c: d.tk, on: sel.tiktok },
    { canal: "ml" as const, label: "Mercado Livre", c: d.ml, on: sel.ml },
  ].filter((x) => x.on);
  const num = (c: NonNullable<Dados["tk"]>): number | null => {
    if (chave === "total_pedidos") return c.orders;
    if (chave === "total_gmv") return c.gmv;
    if (chave === "ticket") return c.orders > 0 ? c.gmv / c.orders : null;
    return c.cancel_rate_pct;
  };
  const fmt = chave === "total_pedidos" ? fmtNumCurto : chave === "cancelamento" ? fmtPctSimples : fmtBrlCurto;
  const vals = canais.map((x) => (x.c ? num(x.c) : null));
  const maior = Math.max(0, ...vals.map((v) => v ?? 0));
  return canais.map((x, i) => {
    const v = vals[i];
    return {
      canal: x.canal,
      label: x.label,
      valor: v != null ? fmt(v) : "Sem dado",
      ausente: v == null,
      pct: v != null && maior > 0 ? (v / maior) * 100 : null,
    };
  });
}
