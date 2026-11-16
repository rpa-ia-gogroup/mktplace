/**
 * Pedidos — cartoes no padrao da Gerencial e o detalhe "por marca" que o clique
 * abre. Logica PURA (testada): o valor do cartao, a serie do mini grafico e a
 * linha de cada marca saem do MESMO dado ja' carregado na pagina, entao o detalhe
 * nunca contradiz o cartao. Nada novo e' buscado.
 *
 * Formatadores da casa (fmtNumCurto, fmtBrlCurto, fmtPctSimples): "39,4 mil",
 * "R$ 3,88 mi", "4,6%". Ausencia nunca vira zero: sem valor, "—"/"Sem dado".
 */
import type { PedidosBrandRow, PedidosCanalKpis, PedidosDailyRow, PedidosKpis } from "./api-client.ts";
import { fmtBrlCurto, fmtNumCurto, fmtPctSimples } from "./formatters.ts";
import { ticketPorPonto } from "./gerencial/kpi-trend.ts";

/** Canais selecionados no filtro. T-0116: a Shopee entra (opcional para nao quebrar quem so' passa TK/ML). */
export interface Selecao {
  tiktok: boolean;
  ml: boolean;
  shopee?: boolean;
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
  | "sh_pedidos"
  | "sh_cancelados"
  | "tk_gmv"
  | "ml_gmv"
  | "sh_gmv";

export const TITULO_DETALHE: Record<ChaveDetalhe, string> = {
  total_pedidos: "Pedidos (sem cancelados)",
  total_gmv: "GMV total",
  ticket: "Ticket médio",
  cancelamento: "Taxa de cancelamento",
  tk_pedidos: "Pedidos · TikTok Shop",
  tk_cancelados: "Cancelados · TikTok Shop",
  ml_pedidos: "Pedidos · Mercado Livre",
  ml_cancelados: "Cancelados · Mercado Livre",
  sh_pedidos: "Pedidos · Shopee",
  sh_cancelados: "Cancelados · Shopee",
  tk_gmv: "GMV · TikTok Shop",
  ml_gmv: "GMV · Mercado Livre",
  sh_gmv: "GMV · Shopee",
};

/** Rotulo dos canais, na ordem canonica. */
export const ROTULO_CANAL = { tiktok: "TikTok Shop", ml: "Mercado Livre", shopee: "Shopee" } as const;
export type CanalPedidos = keyof typeof ROTULO_CANAL;

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
    case "ticket": return c?.avg_ticket != null ? BRL2.format(c.avg_ticket) : "—";
    case "cancelamento": return c?.cancel_rate_pct != null ? fmtPctSimples(c.cancel_rate_pct) : "—";
    case "tk_pedidos": return d.tk ? NUM.format(d.tk.orders) : "—";
    case "ml_pedidos": return d.ml ? NUM.format(d.ml.orders) : "—";
    case "sh_pedidos": return d.sh ? NUM.format(d.sh.orders) : "—";
    case "tk_cancelados": return d.tk ? NUM.format(d.tk.canceled) : "—";
    case "ml_cancelados": return d.ml ? NUM.format(d.ml.canceled) : "—";
    case "sh_cancelados": return d.sh ? NUM.format(d.sh.canceled) : "—";
    case "tk_gmv": return d.tk ? BRL0.format(d.tk.gmv) : "—";
    case "ml_gmv": return d.ml ? BRL0.format(d.ml.gmv) : "—";
    case "sh_gmv": return d.sh ? BRL0.format(d.sh.gmv) : "—";
  }
}

export interface CanalDados { orders: number; canceled: number; gmv: number; cancel_rate_pct: number | null; delivered: number | null }

export interface Dados {
  /** `avg_ticket` null: sem pedido pago (ticket sem base nunca e' R$ 0,00). */
  kpis: { total_orders: number; total_gmv: number; avg_ticket: number | null; cancel_rate_pct: number | null } | null | undefined;
  tk: CanalDados | null | undefined;
  ml: CanalDados | null | undefined;
  sh?: CanalDados | null | undefined;
}

// ---------------------------------------------------------------------------
// Sem dado != 0 (T-0116 / B1-10). A API manda o canal sem linha na fonte com os
// campos null e os totais null quando nenhum canal tem linha. Aqui isso vira
// `null` (o canal/total inteiro ausente), que o cartao ja' mostra como "—".
// ---------------------------------------------------------------------------

/** Canal da API -> dado do cartao; `null` quando o canal nao tem linha na fonte. */
export function canalOuNulo(c: PedidosCanalKpis | null | undefined): CanalDados | null {
  if (!c || c.orders == null || c.canceled == null || c.gmv == null) return null;
  return { orders: c.orders, canceled: c.canceled, gmv: c.gmv, cancel_rate_pct: c.cancel_rate_pct ?? null, delivered: c.delivered ?? null };
}

/** Totais da API -> dado do cartao; `null` quando nenhum canal pedido tem linha. */
export function kpisOuNulo(k: PedidosKpis | null | undefined): Dados["kpis"] {
  if (!k || k.total_orders == null || k.total_gmv == null) return null;
  return { total_orders: k.total_orders, total_gmv: k.total_gmv, avg_ticket: k.avg_ticket ?? null, cancel_rate_pct: k.cancel_rate_pct ?? null };
}

/**
 * Canais SELECIONADOS sem linha na fonte. Usa `canais_sem_dado` da API; em
 * resposta antiga (sem o campo), deduz pelo bloco do canal com `orders` null.
 */
export function canaisSemDado(
  data: { tiktok?: PedidosCanalKpis | null; ml?: PedidosCanalKpis | null; shopee?: PedidosCanalKpis | null; canais_sem_dado?: string[] } | null | undefined,
  sel: Selecao,
): CanalPedidos[] {
  if (!data) return [];
  const pedidos: CanalPedidos[] = (["tiktok", "ml", "shopee"] as const).filter((c) => (c === "shopee" ? !!sel.shopee : sel[c]));
  if (data.canais_sem_dado) return pedidos.filter((c) => data.canais_sem_dado!.includes(c));
  return pedidos.filter((c) => data[c]?.orders == null);
}

/** Aviso de total parcial (padrao `sem_dado:` da T-0111, escrito para a tela); `null` sem aviso. */
export function avisoParcial(semDado: CanalPedidos[], sel: Selecao): string | null {
  if (semDado.length === 0) return null;
  const selecionados: CanalPedidos[] = (["tiktok", "ml", "shopee"] as const).filter((c) => (c === "shopee" ? !!sel.shopee : sel[c]));
  const presentes = selecionados.filter((c) => !semDado.includes(c));
  const ausentes = semDado.map((c) => ROTULO_CANAL[c]).join(" e ");
  if (presentes.length === 0) return `${ausentes} sem dado no período (ausência de dado, não zero)`;
  return `${ausentes} sem dado no período · total parcial, só de ${presentes.map((c) => ROTULO_CANAL[c]).join(" e ")}`;
}

/** "Consolidado (TikTok Shop + Mercado Livre + Shopee)" — os canais do filtro. */
export function rotuloConsolidado(sel: Selecao): string {
  const canais = (["tiktok", "ml", "shopee"] as const).filter((c) => (c === "shopee" ? !!sel.shopee : sel[c]));
  return `Consolidado (${canais.map((c) => ROTULO_CANAL[c]).join(" + ")})`;
}

// ---------------------------------------------------------------------------
// Pedidos LIQUIDOS (B1-04, QA 2026-11-11). Decisao: "pedido" na tela e' o liquido,
// sem cancelados -- o mesmo do grafico diario e do denominador do ticket medio. A
// API (performance_service.get_pedidos) mistura os conceitos: kpis.total_orders e
// ml.orders sao BRUTOS (pagos + cancelados), tiktok.orders e shopee.orders ja' sao
// LIQUIDOS, e by_brand.total_orders = tiktok_orders + ml_orders + ml_canceled +
// shopee_orders. Os cancelados continuam a parte, nunca somados ao total.
// ---------------------------------------------------------------------------

/** Os mesmos dados com "pedidos" liquidos no total e no Mercado Livre. */
export function paraPedidosLiquidos(d: Dados): Dados {
  const canc = (d.tk?.canceled ?? 0) + (d.ml?.canceled ?? 0) + (d.sh?.canceled ?? 0);
  return {
    kpis: d.kpis ? { ...d.kpis, total_orders: d.kpis.total_orders - canc } : d.kpis,
    tk: d.tk,
    ml: d.ml ? { ...d.ml, orders: d.ml.orders - d.ml.canceled } : d.ml,
    ...(d.sh !== undefined ? { sh: d.sh } : {}),
  };
}

/** Pedidos liquidos de uma marca: o total da API sem os cancelados do ML. */
export function pedidosLiquidosDaMarca(r: PedidosBrandRow): number {
  return r.total_orders - (r.ml_canceled ?? 0);
}

// ---------------------------------------------------------------------------
// Series (mini grafico). Reais, do `daily` da propria resposta; o Data Mart chega
// com D-1, entao a cauda sem pedido e' cortada antes (senao o "hoje" zerado puxa a
// tendencia para baixo). Ticket e taxa sao razoes ponto a ponto, como na Gerencial.
// Canal sem linha no dia (null) nao vira ponto 0: fica fora da serie dele.
// ---------------------------------------------------------------------------

export interface Series {
  pedidos: number[];
  gmv: number[];
  ticket: number[];
  cancelamento: number[];
  tkPedidos: number[];
  mlPedidos: number[];
  shPedidos: number[];
  tkCancelados: number[];
  mlCancelados: number[];
  shCancelados: number[];
}

const soloNumeros = (xs: (number | null | undefined)[]): number[] => xs.filter((x): x is number => x != null && Number.isFinite(x));

export function seriesDoPeriodo(daily: PedidosDailyRow[], sel: Selecao): Series {
  let fim = daily.length;
  while (fim > 0 && !(daily[fim - 1].total_orders > 0)) fim--;
  const d = daily.slice(0, fim);
  const pedidos = d.map((r) => r.total_orders);
  const gmv = d.map((r) => r.total_gmv);
  const cancelamento = d.map((r) => {
    const ped = (sel.tiktok ? r.tiktok_orders ?? 0 : 0) + (sel.ml ? r.ml_orders ?? 0 : 0) + (sel.shopee ? r.shopee_orders ?? 0 : 0);
    const can = (sel.tiktok ? r.tiktok_canceled ?? 0 : 0) + (sel.ml ? r.ml_canceled ?? 0 : 0) + (sel.shopee ? r.shopee_canceled ?? 0 : 0);
    return ped > 0 ? (can / ped) * 100 : null;
  });
  return {
    pedidos,
    gmv,
    ticket: soloNumeros(ticketPorPonto(gmv, pedidos)),
    cancelamento: soloNumeros(cancelamento),
    tkPedidos: soloNumeros(d.map((r) => r.tiktok_orders)),
    mlPedidos: soloNumeros(d.map((r) => r.ml_orders)),
    shPedidos: soloNumeros(d.map((r) => r.shopee_orders)),
    tkCancelados: soloNumeros(d.map((r) => r.tiktok_canceled)),
    mlCancelados: soloNumeros(d.map((r) => r.ml_canceled)),
    shCancelados: soloNumeros(d.map((r) => r.shopee_canceled)),
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
    case "sh_pedidos": return s.shPedidos;
    case "tk_cancelados": return s.tkCancelados;
    case "ml_cancelados": return s.mlCancelados;
    case "sh_cancelados": return s.shCancelados;
    // A API nao traz o GMV por canal por dia: sem serie, sem tendencia (nada inventado).
    case "tk_gmv":
    case "ml_gmv":
    case "sh_gmv": return [];
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
const canceladosSel = (r: PedidosBrandRow, s: Selecao) =>
  soma(s.tiktok ? r.tiktok_canceled : null, s.ml ? r.ml_canceled : null, s.shopee ? r.shopee_canceled : null);
const pedidosSel = (r: PedidosBrandRow, s: Selecao) =>
  soma(s.tiktok ? r.tiktok_orders : null, s.ml ? r.ml_orders : null, s.shopee ? r.shopee_orders : null);

const DEF_MARCA: Record<ChaveDetalhe, DefMarca> = {
  total_pedidos: { num: (r) => pedidosLiquidosDaMarca(r), fmt: fmtNumCurto },
  total_gmv: { num: (r) => r.total_gmv, fmt: fmtBrlCurto },
  ticket: {
    num: (r) => {
      const p = pedidosLiquidosDaMarca(r);
      return p > 0 ? r.total_gmv / p : null;
    },
    fmt: fmtBrlCurto,
  },
  cancelamento: {
    num: (r, s) => taxa(canceladosSel(r, s), pedidosSel(r, s)),
    fmt: fmtPctSimples,
    apoio: (r, s) => cancelados(canceladosSel(r, s)),
  },
  tk_pedidos: { num: (r) => r.tiktok_orders ?? null, fmt: fmtNumCurto },
  ml_pedidos: { num: (r) => r.ml_orders ?? null, fmt: fmtNumCurto },
  sh_pedidos: { num: (r) => r.shopee_orders ?? null, fmt: fmtNumCurto },
  tk_cancelados: { num: (r) => r.tiktok_cancel_rate_pct ?? null, fmt: fmtPctSimples, apoio: (r) => cancelados(r.tiktok_canceled) },
  ml_cancelados: { num: (r) => r.ml_cancel_rate_pct ?? null, fmt: fmtPctSimples, apoio: (r) => cancelados(r.ml_canceled) },
  sh_cancelados: { num: (r) => r.shopee_cancel_rate_pct ?? null, fmt: fmtPctSimples, apoio: (r) => cancelados(r.shopee_canceled) },
  tk_gmv: { num: (r) => r.tiktok_gmv ?? null, fmt: fmtBrlCurto },
  ml_gmv: { num: (r) => r.ml_gmv ?? null, fmt: fmtBrlCurto },
  sh_gmv: { num: (r) => r.shopee_gmv ?? null, fmt: fmtBrlCurto },
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
  canal: CanalPedidos;
  label: string;
  valor: string;
  ausente: boolean;
  pct: number | null;
}

/** Quebra por canal dos 4 totais, so' com os canais selecionados. */
export function linhasPorCanal(chave: ChaveDetalhe, d: Dados, sel: Selecao): LinhaCanal[] {
  if (!(chave === "total_pedidos" || chave === "total_gmv" || chave === "ticket" || chave === "cancelamento")) return [];
  const canais = [
    { canal: "tiktok" as const, label: ROTULO_CANAL.tiktok, c: d.tk, on: sel.tiktok },
    { canal: "ml" as const, label: ROTULO_CANAL.ml, c: d.ml, on: sel.ml },
    { canal: "shopee" as const, label: ROTULO_CANAL.shopee, c: d.sh, on: !!sel.shopee },
  ].filter((x) => x.on);
  const num = (c: CanalDados): number | null => {
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
