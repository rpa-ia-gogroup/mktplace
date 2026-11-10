/**
 * Marcas menores (Bling) DENTRO da Gerencial: somam no GMV do período, na rosca
 * (canais Shopee/TikTok delas) e no bloco de marcas, "sem meta". NÃO entram na
 * meta, na tendência do dia nem no corte por hora do Hoje (o Bling não traz a
 * hora do pedido). Ausência nunca vira 0: marca sem pedido não entra, e um total
 * com menores nunca é comparado com um anterior sem elas.
 */
import type { Marketplace } from "../mock-data.ts";
import type { OverviewData } from "../api-client.ts";
import { variacaoPct, type Consolidado, type DiaMarca, type MarcaMenor, type MarcasMenores } from "../marcas-menores.ts";

const CANAL: Record<string, Marketplace> = { SHOPEE: "shopee", TIKTOK: "tiktok" };

export interface MarcaMenorGerencial {
  brand: string;
  label: string;
  total: number;
  /** null = sem base no período anterior. */
  anterior: number | null;
  /** O anterior por canal (nos canais do filtro); null junto com `anterior`. */
  anteriorPorCanal: Partial<Record<Marketplace, number>> | null;
  porCanal: Partial<Record<Marketplace, number>>;
}

export interface MenoresOk {
  estado: "ok";
  total: number;
  porCanal: Partial<Record<Marketplace, number>>;
  /** null = alguma marca sem base: a variação fica sem elas (e o ⓘ diz). */
  anterior: number | null;
  anteriorPorCanal: Partial<Record<Marketplace, number>> | null;
  marcas: MarcaMenorGerencial[];
  aguardando: string[];
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
    anteriores.push(ant);
    marcas.push({
      brand: m.id,
      label: m.label,
      total,
      anterior: m.total_anterior == null ? null : soma(ant),
      anteriorPorCanal: m.total_anterior == null ? null : ant,
      porCanal,
    });
  }
  const porCanal: PorCanal = {};
  for (const m of marcas) for (const [c, v] of Object.entries(m.porCanal)) porCanal[c as Marketplace] = (porCanal[c as Marketplace] ?? 0) + (v ?? 0);
  // Conjunto igual nos dois lados: uma marca sem base derruba a base de todas.
  const comBase = marcas.length > 0 && marcas.every((m) => m.anterior != null);
  const anteriorPorCanal: PorCanal = {};
  if (comBase) for (const ant of anteriores) for (const [c, v] of Object.entries(ant)) anteriorPorCanal[c as Marketplace] = (anteriorPorCanal[c as Marketplace] ?? 0) + (v ?? 0);
  return {
    estado: "ok",
    total: marcas.reduce((a, m) => a + m.total, 0),
    porCanal,
    anterior: comBase ? marcas.reduce((a, m) => a + (m.anterior ?? 0), 0) : null,
    anteriorPorCanal: comBase ? anteriorPorCanal : null,
    marcas,
    aguardando,
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
  if (!m || base.gmv == null || m.total <= 0) return { ...base, variacaoInclui: false };
  const gmv = base.gmv + m.total;
  if (comparavel && base.prevGmv != null && m.anterior != null) {
    const prev = base.prevGmv + m.anterior;
    return { gmv, prevGmv: prev, momPct: variacaoPct(gmv, prev), variacaoInclui: true };
  }
  // "antes R$ X" sem as menores ao lado de um total com elas enganaria: some, fica só o percentual da base.
  return { gmv, prevGmv: null, momPct: base.momPct, variacaoInclui: false };
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
  if (m.estado === "indisponivel") return "Marcas menores indisponíveis agora (Bling): o GMV mostrado não as inclui.";
  if (m.total <= 0) return null;
  const nomes = m.marcas.map((x) => x.label).join(", ");
  const ag = m.aguardando.length ? ` ${m.aguardando.join(", ")}: aguardando autorização do Bling.` : "";
  const variacao = hoje
    ? "A variação de hoje não as inclui (o Bling não traz a hora do pedido)."
    : variacaoInclui
      ? "A variação as inclui nos dois períodos."
      : "A variação não as inclui (sem base no período anterior).";
  return `Inclui as marcas menores pelo Bling (${nomes}): ${fmt(m.total)}. Sem meta: ficam fora da meta, da tendência do dia e do corte por hora.${ag} ${variacao}`;
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
  const comBase = comDado.length > 0 && comDado.every((m) => m.total_anterior != null);
  const agr = (pega: (m: MarcaMenor) => Record<string, number> | undefined) => {
    const out: Record<string, number> = {};
    for (const m of comDado) for (const [p, v] of Object.entries(pega(m) ?? {})) out[p] = (out[p] ?? 0) + v;
    return out;
  };
  const plat = agr((m) => Object.fromEntries(m.por_plataforma.map((p) => [p.plataforma, p.faturamento])));
  const consolidado: Consolidado = {
    total: comDado.length ? soma2(comDado.map((m) => m.total as number)) : null,
    total_anterior: comBase ? soma2(comDado.map((m) => m.total_anterior as number)) : null,
    por_plataforma_anterior: comBase ? agr((m) => m.por_plataforma_anterior) : {},
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
