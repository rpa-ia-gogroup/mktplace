/**
 * Marcas menores (Bling) DENTRO da Gerencial: somam no GMV do período, na rosca
 * (canais Shopee/TikTok delas) e no bloco de marcas, "sem meta". NÃO entram na
 * meta, na tendência do dia nem no corte por hora do Hoje (o Bling não traz a
 * hora do pedido). Ausência nunca vira 0: marca sem pedido não entra, e um total
 * com menores nunca é comparado com um anterior sem elas.
 */
import type { Marketplace } from "../mock-data.ts";
import type { OverviewData } from "../api-client.ts";
import { fmtBrlFull, fmtNumCurto } from "../formatters.ts";
import { deltaPct, type KpiDescriptor } from "./kpi-band.ts";
import {
  canaisSemBase,
  motivoSemBase,
  variacaoPct,
  type Consolidado,
  type DiaMarca,
  type MarcaMenor,
  type MarcasMenores,
} from "../marcas-menores.ts";

const CANAL: Record<string, Marketplace> = { SHOPEE: "shopee", TIKTOK: "tiktok" };

export interface MarcaMenorGerencial {
  brand: string;
  label: string;
  total: number;
  /** null = sem base no período anterior, ou canal do filtro sem base nele (ver `motivo`). */
  anterior: number | null;
  /** O anterior por canal (nos canais do filtro); null = marca sem base. Canal sem base fica ausente. */
  anteriorPorCanal: Partial<Record<Marketplace, number>> | null;
  porCanal: Partial<Record<Marketplace, number>>;
  /** "sem dado de Shopee no período anterior" (achado C1-03); null = nada a avisar. */
  motivo: string | null;
}

export interface MenoresOk {
  estado: "ok";
  total: number;
  porCanal: Partial<Record<Marketplace, number>>;
  /** null = alguma marca sem base (ou canal sem base): a variação fica sem elas (e o ⓘ diz). */
  anterior: number | null;
  /** Só os canais com base em todas as marcas; null = alguma marca sem base. */
  anteriorPorCanal: Partial<Record<Marketplace, number>> | null;
  /** Pedidos (nos canais do filtro); null = alguma marca sem pedidos informados (nunca 0). */
  pedidos: number | null;
  /** Pedidos do período anterior; null = alguma marca sem base (mesma regra do `anterior`). */
  pedidosAnterior: number | null;
  marcas: MarcaMenorGerencial[];
  aguardando: string[];
  /** Canal com receita agora e sem receita no anterior; null = nada a avisar. */
  motivo: string | null;
}

export type Menores = { estado: "fora" } | { estado: "carregando" } | { estado: "indisponivel" } | MenoresOk;

type PorCanal = Partial<Record<Marketplace, number>>;

function somaCanais(p: Record<string, number> | undefined, canais: readonly Marketplace[]): PorCanal {
  const por: PorCanal = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    const c = CANAL[k];
    if (c && canais.includes(c)) por[c] = (por[c] ?? 0) + v;
  }
  return por;
}

const soma = (p: PorCanal) => Object.values(p).reduce((a, v) => a + (v ?? 0), 0);

/** Pedidos nos canais do filtro. null só quando o dado não veio, ou há GMV e 0 pedidos; GMV 0 com 0 pedidos é 0 de verdade. */
function pedidosOuNull(p: Record<string, number> | undefined, canais: readonly Marketplace[], gmv: number): number | null {
  if (p == null) return null;
  const n = soma(somaCanais(p, canais));
  return n > 0 || gmv <= 0 ? n : null;
}

/** `ativo` = filtros permitem (todas as marcas, algum canal Shopee/TikTok, não é demonstração). */
export function menoresNaGerencial(
  d: MarcasMenores | null | undefined,
  canais: readonly Marketplace[],
  ativo: boolean,
  /** So' estas marcas (filtro de marca); sem lista, todas. */
  selecionadas?: readonly string[],
): Menores {
  if (!ativo) return { estado: "fora" };
  if (d === undefined) return { estado: "carregando" };
  if (d === null || !d.disponivel) return { estado: "indisponivel" };
  const marcas: MarcaMenorGerencial[] = [];
  const aguardando: string[] = [];
  const anteriores: PorCanal[] = [];
  const semBase: string[] = [];
  const pedidosDasMarcas: (number | null)[] = [];
  const pedidosAnteriores: (number | null)[] = [];
  for (const m of d.marcas) {
    if (selecionadas && !selecionadas.includes(m.id) && m.status !== "aguardando_autorizacao") continue;
    if (m.status === "aguardando_autorizacao") {
      if (!selecionadas || selecionadas.includes(m.id)) aguardando.push(m.label);
      continue;
    }
    const porCanal = somaCanais(Object.fromEntries(m.por_plataforma.map((p) => [p.plataforma, p.faturamento])), canais);
    const total = soma(porCanal);
    if (m.total == null || total <= 0) continue; // sem pedido nos canais do filtro: sem dado, fora
    const ant = somaCanais(m.por_plataforma_anterior, canais);
    // Mesma regra da aba Demais marcas: canal do filtro com receita agora e sem receita no anterior tira o percentual.
    const doFiltro = m.por_plataforma.filter((p) => CANAL[p.plataforma] && canais.includes(CANAL[p.plataforma]));
    const semBaseDaMarca = m.total_anterior == null ? [] : canaisSemBase(doFiltro, m.por_plataforma_anterior);
    const motivo = motivoSemBase(semBaseDaMarca);
    semBase.push(...semBaseDaMarca);
    anteriores.push(ant);
    const anteriorDaMarca = m.total_anterior == null || motivo ? null : soma(ant);
    pedidosDasMarcas.push(pedidosOuNull(m.pedidos_por_plataforma, canais, total));
    pedidosAnteriores.push(anteriorDaMarca == null ? null : pedidosOuNull(m.pedidos_por_plataforma_anterior, canais, anteriorDaMarca));
    marcas.push({
      brand: m.id,
      label: m.label,
      total,
      anterior: anteriorDaMarca,
      anteriorPorCanal: m.total_anterior == null ? null : ant,
      porCanal,
      motivo,
    });
  }
  const porCanal: PorCanal = {};
  for (const m of marcas) for (const [c, v] of Object.entries(m.porCanal)) porCanal[c as Marketplace] = (porCanal[c as Marketplace] ?? 0) + (v ?? 0);
  // Conjunto igual nos dois lados: uma marca sem base derruba a base de todas.
  const comBase = marcas.length > 0 && marcas.every((m) => m.anteriorPorCanal != null);
  const motivo = comBase ? motivoSemBase(semBase) : null;
  // Por canal: um canal sem base em alguma marca sai do anterior (a variação dele fica sem as menores).
  const canaisSemBaseAqui = new Set(semBase.map((p) => CANAL[p]));
  const anteriorPorCanal: PorCanal = {};
  if (comBase)
    for (const ant of anteriores)
      for (const [c, v] of Object.entries(ant))
        if (!canaisSemBaseAqui.has(c as Marketplace)) anteriorPorCanal[c as Marketplace] = (anteriorPorCanal[c as Marketplace] ?? 0) + (v ?? 0);
  return {
    estado: "ok",
    total: marcas.reduce((a, m) => a + m.total, 0),
    porCanal,
    anterior: comBase && !motivo ? marcas.reduce((a, m) => a + (m.anterior ?? 0), 0) : null,
    anteriorPorCanal: comBase ? anteriorPorCanal : null,
    pedidos: marcas.length > 0 && pedidosDasMarcas.every((p) => p != null) ? soma2(pedidosDasMarcas as number[]) : null,
    pedidosAnterior: comBase && !motivo && pedidosAnteriores.every((p) => p != null) ? soma2(pedidosAnteriores as number[]) : null,
    marcas,
    aguardando,
    motivo,
  };
}

export interface GmvBase {
  gmv: number | null;
  prevGmv: number | null;
  momPct: number | null;
}

/**
 * GMV do topo com as menores. A variação só inclui as menores quando há base nos
 * DOIS períodos (`comparavel`: não é "Hoje", que compara até a mesma hora e o
 * Bling não tem hora); senão fica a base sem elas e `variacaoInclui` é false.
 */
export function gmvComMenores(base: GmvBase, m: MenoresOk | null, comparavel: boolean): GmvBase & { variacaoInclui: boolean } {
  if (!m || m.total <= 0) return { ...base, variacaoInclui: false };
  // T-0111: as marcas grandes sem linha no recorte nao zeram o topo nem apagam as menores; sem base, sem variacao.
  if (base.gmv == null) return { gmv: m.total, prevGmv: null, momPct: null, variacaoInclui: false };
  const gmv = base.gmv + m.total;
  if (comparavel && base.prevGmv != null && m.anterior != null) {
    const prev = base.prevGmv + m.anterior;
    return { gmv, prevGmv: prev, momPct: variacaoPct(gmv, prev), variacaoInclui: true };
  }
  // "antes R$ X" sem as menores ao lado de um total com elas enganaria: some, fica só o percentual da base.
  return { gmv, prevGmv: null, momPct: base.momPct, variacaoInclui: false };
}

/**
 * Pedidos e Ticket da faixa de KPIs com as menores, como o GMV do topo: Pedidos = grandes + menores, Ticket = GMV
 * do topo (já com as menores) / Pedidos. A variação só inclui as menores com base nos DOIS períodos (a mesma
 * condição do GMV, `variacaoInclui`, mais os pedidos anteriores delas); senão fica o percentual das grandes e o
 * "antes X" some. Menor sem pedidos informados: a faixa fica como está (grandes) e o card diz isso.
 */
export function pedidosTicketComMenores(
  kpis: readonly KpiDescriptor[],
  overview: OverviewData | null | undefined,
  topo: GmvBase & { variacaoInclui: boolean },
  m: MenoresOk | null,
): KpiDescriptor[] {
  if (!m || !overview || topo.gmv == null || m.total <= 0) return [...kpis];
  // T-0111: grandes sem linha no recorte entram como ausentes; os pedidos sao so' os das menores.
  const pedidosGrandes = overview.orders ?? 0;
  if (m.pedidos == null) {
    const aviso = "Só marcas grandes: pedidos das menores não vieram";
    return kpis.map((k) => (k.key === "orders" || k.key === "avg_ticket" ? { ...k, subvalue: aviso } : k));
  }
  const pedidos = pedidosGrandes + m.pedidos;
  const ticket = topo.gmv / pedidos;
  const prevPedidos = topo.variacaoInclui && topo.prevGmv != null && m.pedidosAnterior != null && overview.prev_orders != null ? overview.prev_orders + m.pedidosAnterior : null;
  const pedidosPct = prevPedidos != null ? deltaPct(pedidos, prevPedidos) : null;
  const ticketPct = prevPedidos != null ? deltaPct(ticket, topo.prevGmv! / prevPedidos) : null;
  return kpis.map((k) => {
    if (k.key === "orders")
      return {
        ...k,
        value: fmtNumCurto(pedidos),
        exactValue: pedidos.toLocaleString("pt-BR"),
        // Sem as duas bases, o percentual é o das grandes e o "antes" (sem as menores) some.
        // O "compradores" vem do overview: só das grandes (as menores não trazem compradores).
        subvalue: k.subvalue?.replace(/ compradores .*$/, " compradores nas marcas grandes (soma diária)") ?? null,
        deltaPct: prevPedidos != null ? pedidosPct : k.deltaPct,
        reference: prevPedidos != null && pedidosPct != null ? `antes ${fmtNumCurto(prevPedidos)}` : null,
      };
    if (k.key === "avg_ticket")
      return {
        ...k,
        value: fmtBrlFull(ticket),
        exactValue: fmtBrlFull(ticket),
        unavailableReason: null,
        deltaPct: prevPedidos != null ? ticketPct : k.deltaPct,
        reference: prevPedidos != null && ticketPct != null ? `antes ${fmtBrlFull(topo.prevGmv! / prevPedidos)}` : null,
      };
    return k;
  });
}

/** GMV de um canal com as menores e a variação dele (só inclui as menores com base no canal). */
export function canalComMenores(
  canal: Marketplace,
  atual: number | null | undefined,
  antes: number | null | undefined,
  baseVar: number | null,
  m: MenoresOk | null,
  comparavel: boolean,
): { gmv: number | null; variacao: number | null } {
  const mAtual = m?.porCanal[canal] ?? 0;
  if (atual == null || mAtual <= 0) return { gmv: atual ?? null, variacao: baseVar };
  const mAnt = m?.anteriorPorCanal?.[canal];
  if (comparavel && antes != null && mAnt != null) return { gmv: atual + mAtual, variacao: variacaoPct(atual + mAtual, antes + mAnt) };
  return { gmv: atual + mAtual, variacao: baseVar };
}

/** Texto do ⓘ do GMV do período; `null` quando as menores não se aplicam aos filtros. */
export function notaMenores(m: Menores, variacaoInclui: boolean, hoje: boolean, fmt: (v: number) => string): string | null {
  if (m.estado === "fora" || m.estado === "carregando") return null;
  if (m.estado === "indisponivel") return "Demais marcas indisponíveis agora (Bling): o GMV mostrado não as inclui.";
  if (m.total <= 0) return null;
  const nomes = m.marcas.map((x) => x.label).join(", ");
  const ag = m.aguardando.length ? ` ${m.aguardando.join(", ")}: aguardando autorização do Bling.` : "";
  const variacao = hoje
    ? "A variação de hoje não as inclui (o Bling não traz a hora do pedido)."
    : variacaoInclui
      ? "A variação as inclui nos dois períodos."
      : `A variação não as inclui (${m.motivo ?? "sem base no período anterior"}).`;
  return `Inclui as demais marcas pelo Bling (${nomes}): ${fmt(m.total)}. Sem meta: ficam fora da meta, da tendência do dia e do corte por hora.${ag} ${variacao}`;
}

// ---------------------------------------------------------------------------
// So' marcas menores selecionadas: a Gerencial inteira sai do Bling.

const CANAL_DA_PLATAFORMA: Record<string, Marketplace> = { MELI: "ml", SHOPEE: "shopee", TIKTOK: "tiktok" };
const ORDEM = ["MELI", "SHOPEE", "TIKTOK"];

const soma2 = (v: Iterable<number>) => [...v].reduce((a, n) => a + n, 0);
const filtrarDict = <T,>(d: Record<string, T> | undefined, canais: readonly Marketplace[]): Record<string, T> =>
  Object.fromEntries(Object.entries(d ?? {}).filter(([p]) => canais.includes(CANAL_DA_PLATAFORMA[p])));

/**
 * `/marcas-menores` recortado pelo filtro: so' as marcas escolhidas e so' os canais escolhidos, com totais,
 * serie, pedidos e consolidado refeitos. Sem dado no recorte = null, nunca 0; o anterior so' vale com base
 * em todas as marcas somadas (o mesmo conjunto nos dois lados).
 */
export function filtrarMarcasMenores(d: MarcasMenores, ids: readonly string[], canais: readonly Marketplace[]): MarcasMenores {
  const marcas: MarcaMenor[] = [];
  for (const m of d.marcas) {
    if (!ids.includes(m.id) || m.status === "aguardando_autorizacao") continue;
    const por = m.por_plataforma.filter((p) => canais.includes(CANAL_DA_PLATAFORMA[p.plataforma]));
    const ant = filtrarDict(m.por_plataforma_anterior, canais);
    const ped = filtrarDict(m.pedidos_por_plataforma, canais);
    const serie: DiaMarca[] = [];
    for (const dia of m.serie) {
      const pp = filtrarDict(dia.por_plataforma, canais);
      if (Object.keys(pp).length) {
        // os pedidos do dia acompanham o recorte de canal (a serie de Pedidos da Evolucao depende deles)
        serie.push({ data: dia.data, faturamento: soma2(Object.values(pp)), por_plataforma: pp, pedidos_por_plataforma: filtrarDict(dia.pedidos_por_plataforma, canais) });
      }
    }
    marcas.push({
      ...m,
      total: por.length && m.total != null ? soma2(por.map((p) => p.faturamento)) : null,
      total_anterior: m.total_anterior == null || !Object.keys(ant).length ? null : soma2(Object.values(ant)),
      por_plataforma: por,
      por_plataforma_anterior: ant,
      pedidos: Object.keys(ped).length ? soma2(Object.values(ped)) : null,
      pedidos_por_plataforma: ped,
      pedidos_por_plataforma_anterior: filtrarDict(m.pedidos_por_plataforma_anterior, canais),
      serie,
    });
  }
  const comDado = marcas.filter((m) => m.total != null);
  const { comBase, semBase, motivo } = baseDoRecorte(marcas);
  const agr = (pega: (m: MarcaMenor) => Record<string, number> | undefined) => {
    const out: Record<string, number> = {};
    for (const m of comDado) for (const [p, v] of Object.entries(pega(m) ?? {})) out[p] = (out[p] ?? 0) + v;
    return out;
  };
  const plat = agr((m) => Object.fromEntries(m.por_plataforma.map((p) => [p.plataforma, p.faturamento])));
  // Canal sem base em alguma marca sai do anterior por canal: a variação dele não soma um canal inteiro como crescimento.
  const comBaseNoCanal = (d: Record<string, number> | undefined) => Object.fromEntries(Object.entries(d ?? {}).filter(([p]) => !semBase.includes(p)));
  const consolidado: Consolidado = {
    total: comDado.length ? soma2(comDado.map((m) => m.total as number)) : null,
    total_anterior: comBase && !motivo ? soma2(comDado.map((m) => m.total_anterior as number)) : null,
    por_plataforma_anterior: comBase ? agr((m) => comBaseNoCanal(m.por_plataforma_anterior)) : {},
    pedidos: comDado.some((m) => m.pedidos != null) ? soma2(comDado.map((m) => m.pedidos ?? 0)) : null,
    pedidos_por_plataforma: agr((m) => m.pedidos_por_plataforma),
    pedidos_por_plataforma_anterior: comBase ? agr((m) => m.pedidos_por_plataforma_anterior) : {},
    por_plataforma: Object.keys(plat)
      .sort((a, b) => ORDEM.indexOf(a) - ORDEM.indexOf(b))
      .map((p) => ({ plataforma: p, faturamento: plat[p] })),
  };
  return { ...d, consolidado, marcas };
}

/**
 * Base do recorte: todas as marcas com dado precisam de anterior (o mesmo conjunto nos dois lados) e, como na
 * aba Demais marcas, todo canal com receita agora precisa ter receita no anterior (achado C1-03).
 */
function baseDoRecorte(marcas: readonly MarcaMenor[]): { comBase: boolean; semBase: string[]; motivo: string | null } {
  const comDado = marcas.filter((m) => m.total != null);
  const comBase = comDado.length > 0 && comDado.every((m) => m.total_anterior != null);
  const semBase = comBase ? comDado.flatMap((m) => canaisSemBase(m.por_plataforma, m.por_plataforma_anterior)) : [];
  return { comBase, semBase, motivo: motivoSemBase(semBase) };
}

/** Por que o recorte (já filtrado) não tem variação mesmo havendo anterior; null = nada a avisar. */
export const motivoSemBaseDoRecorte = (f: MarcasMenores): string | null => baseDoRecorte(f.marcas).motivo;

/**
 * O `OverviewData` das menores, para a faixa de KPIs da Gerencial (a mesma de sempre): GMV e pedidos do
 * Bling, ticket = GMV / pedidos, e Ads e ACOS "sem dado" (null, nunca 0). Sem GMV no recorte, null.
 */
export function overviewDeMenores(f: MarcasMenores, canais: readonly Marketplace[]): OverviewData | null {
  const c = f.consolidado;
  if (!f.disponivel || !c || c.total == null) return null;
  const gmv = c.total;
  const orders = c.pedidos ?? 0;
  const porCanal = (c2: Marketplace) => {
    if (!canais.includes(c2)) return null;
    const v = c.por_plataforma.find((p) => CANAL_DA_PLATAFORMA[p.plataforma] === c2)?.faturamento;
    return v ?? null;
  };
  const prevOrders = c.pedidos_por_plataforma_anterior ? soma2(Object.values(c.pedidos_por_plataforma_anterior)) : null;
  const prevGmv = c.total_anterior;
  return {
    gmv,
    tiktok_gmv: porCanal("tiktok"),
    ml_gmv: porCanal("ml"),
    shopee_gmv: porCanal("shopee"),
    orders,
    avg_ticket: orders > 0 ? gmv / orders : NaN,
    ad_spend: null,
    ml_roas: null,
    ml_cancel_rate_pct: null,
    shopee_roas: null,
    tiktok_customers: null,
    ml_unique_buyers: null,
    shopee_unique_buyers: null,
    gmv_mom_pct: variacaoPct(gmv, prevGmv),
    prev_gmv: prevGmv ?? 0,
    prev_orders: prevGmv != null && prevOrders ? prevOrders : null,
    prev_avg_ticket: prevGmv != null && prevOrders ? prevGmv / prevOrders : null,
  };
}
