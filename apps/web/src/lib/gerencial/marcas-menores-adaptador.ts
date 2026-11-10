/**
 * ADAPTADOR dos dados do Bling (marcas menores) para as props dos componentes da Gerencial das marcas grandes
 * (Evolução de GMV, bloco Marcas em linha, Mais vendidos por marca): a tela é a MESMA, só a fonte muda.
 * Campo que o Bling não tem fica vazio (null), nunca 0; dia/bucket sem pedido não existe na série.
 */
import type { BrandRow, TrendGranularity, TrendGranularityRequest, TrendPoint } from "../api-client.ts";
import type { Marketplace } from "../mock-data.ts";
import type { MarcaMenorGerencial } from "./marcas-menores-gerencial.ts";
import type { ChannelSeries } from "./trend-series.ts";
import type { CanalTop, MarcaTop, ProdutoTop, ResumoCanal, TopProdutosResponse } from "./top-produtos.ts";
import type { MarcasMenores, ProdutosMarcas } from "../marcas-menores.ts";

const PLATAFORMA: Record<Marketplace, string> = { shopee: "SHOPEE", tiktok: "TIKTOK", ml: "MELI" };
const CANAL_DA_PLATAFORMA: Record<string, CanalTop> = { SHOPEE: "shopee", TIKTOK: "tiktok", MELI: "ml" };
const MES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// ---------------------------------------------------------------------------
// Evolução de GMV: a série diária do Bling agregada em dia/semana/mês, como o `/trend` faz.

const DIA_MS = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const isoDe = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `auto`: diária até 92 dias, mensal acima (a mesma regra do servidor). */
export function granularidadeEfetiva(pedida: TrendGranularityRequest, dias: number): TrendGranularity {
  return pedida === "auto" ? (dias <= 92 ? "day" : "month") : pedida;
}

/** Início do bucket: o próprio dia; a segunda-feira (ISO) da semana; o dia 1 do mês. */
export function inicioDoBucket(iso: string, g: TrendGranularity): string {
  if (g === "day") return iso;
  if (g === "month") return `${iso.slice(0, 7)}-01`;
  const dow = (new Date(utc(iso)).getUTCDay() + 6) % 7;
  return isoDe(utc(iso) - dow * DIA_MS);
}

/** Mesmos rótulos do servidor: "10/11", "Sem. 03/11", "Nov/26". */
export function rotuloDoBucket(iso: string, g: TrendGranularity): string {
  const dd = `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  if (g === "day") return dd;
  if (g === "week") return `Sem. ${dd}`;
  return `${MES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
}

/**
 * Uma série por canal selecionado, no formato que `mergeChannelSeries` já entende. Canal onde as menores não
 * vendem (ML) volta com `points: []` (sem dado), nunca com barras de zero.
 */
export function seriesDeMenores(f: MarcasMenores, canais: readonly Marketplace[], pedida: TrendGranularityRequest): ChannelSeries[] {
  const p = f.periodo;
  const dias = p ? Math.round((utc(p.fim) - utc(p.inicio)) / DIA_MS) + 1 : 30;
  const g = granularidadeEfetiva(pedida, dias);
  return canais.map((canal) => {
    const plat = PLATAFORMA[canal];
    const buckets = new Map<string, { gmv: number; orders: number }>();
    for (const m of f.marcas) {
      for (const d of m.serie) {
        const gmv = d.por_plataforma[plat];
        if (gmv == null) continue;
        const k = inicioDoBucket(d.data, g);
        const b = buckets.get(k) ?? { gmv: 0, orders: 0 };
        b.gmv += gmv;
        b.orders += d.pedidos_por_plataforma?.[plat] ?? 0;
        buckets.set(k, b);
      }
    }
    // O Bling entrega a lista COMPLETA do periodo: dia sem pedido num canal que vendeu no periodo e' venda zero de
    // verdade, e o eixo precisa de todos os buckets para a serie fechar com o GMV. Canal sem NENHUM pedido no
    // periodo fica sem pontos (sem dado), nao uma linha de zeros.
    if (buckets.size > 0 && p) {
      for (let t = utc(p.inicio); t <= utc(p.fim); t += DIA_MS) {
        const k = inicioDoBucket(isoDe(t), g);
        if (!buckets.has(k)) buckets.set(k, { gmv: 0, orders: 0 });
      }
    }
    const points: TrendPoint[] = [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, b]) => ({ date, label: rotuloDoBucket(date, g), gmv: Math.round(b.gmv * 100) / 100, orders: b.orders }));
    return { channel: canal, status: "fresh", granularity: g, points };
  });
}

// ---------------------------------------------------------------------------
// Bloco Marcas em linha (MarcasMeta): uma linha por marca menor, "sem meta".

export function linhasDeMarcasMenores(marcas: readonly MarcaMenorGerencial[], comparar: boolean): BrandRow[] {
  return marcas.map((m) => ({
    brand: m.brand,
    label: m.label,
    tiktok_gmv: m.porCanal.tiktok ?? null,
    ml_gmv: null,
    shopee_gmv: m.porCanal.shopee ?? null,
    total_gmv: m.total,
    orders: 0,
    avg_ticket: null,
    tiktok_avg_ticket: null,
    ml_avg_ticket: null,
    tiktok_gmv_prev: m.anteriorPorCanal?.tiktok ?? null,
    ml_gmv_prev: null,
    shopee_gmv_prev: m.anteriorPorCanal?.shopee ?? null,
    total_gmv_prev: m.anterior ?? 0,
    mom_pct: comparar && m.anterior != null && m.anterior > 0 ? ((m.total - m.anterior) / m.anterior) * 100 : null,
    cos_pct: null,
    gpm: null,
    ml_roas: null,
    ml_cancel_rate_pct: null,
  }));
}

// ---------------------------------------------------------------------------
// Mais vendidos por marca (TopProdutosMarca): ranking, receita, peças, preço médio e % da marca.

/**
 * `null`/`undefined` voltam como estão (falha / carregando). Sem período anterior de produto no Bling, as
 * colunas "vs período" não existem (`comparacao_inicio: null`), e peças sem quantidade ficam vazias.
 */
export function topProdutosDeMenores(
  r: ProdutosMarcas | null | undefined,
  canais: readonly Marketplace[],
  marcas: readonly string[],
  periodo: { inicio: string; fim: string },
): TopProdutosResponse | null | undefined {
  if (r === undefined) return undefined;
  if (r === null || !r.disponivel) return null;
  const out: MarcaTop[] = [];
  for (const m of r.marcas) {
    if (m.status === "aguardando_autorizacao" || !marcas.includes(m.id)) continue;
    const linhas = (m.itens_por_canal ?? [])
      .map((p) => ({ p, canal: CANAL_DA_PLATAFORMA[p.plataforma ?? ""] }))
      .filter((x) => x.canal && canais.includes(x.canal) && (x.p.receita ?? 0) > 0);
    if (linhas.length === 0) continue;
    const receitaMarca = linhas.reduce((a, x) => a + (x.p.receita as number), 0);
    const produtos: ProdutoTop[] = linhas
      .sort((a, b) => (b.p.receita as number) - (a.p.receita as number) || a.p.sku.localeCompare(b.p.sku))
      .map(({ p, canal }, i) => ({
        posicao: i + 1,
        canal,
        sku: p.sku,
        produto: p.produto,
        kit: false,
        pecas: p.quantidade as number, // sem quantidade no Bling: vazio ("—" na tabela), nunca 0
        receita: p.receita as number,
        preco_medio: p.quantidade != null && p.quantidade > 0 ? (p.receita as number) / p.quantidade : null,
        share_marca: (p.receita as number) / receitaMarca,
        pecas_ant: null,
        receita_ant: null,
      }));
    const porCanal = new Map<CanalTop, number>();
    for (const x of linhas) porCanal.set(x.canal, (porCanal.get(x.canal) ?? 0) + (x.p.receita as number));
    const resumo: ResumoCanal[] = [...porCanal.entries()].map(([canal, receita]) => ({ canal, receita, extras: [], aviso_extras: null }));
    out.push({ marca: m.id, receita_marca: receitaMarca, receita_marca_ant: null, produtos, canais: resumo });
  }
  return {
    inicio: periodo.inicio,
    fim: periodo.fim,
    comparacao_inicio: null,
    comparacao_fim: null,
    canais: canais.map((c) => c as CanalTop),
    marcas: out,
  };
}

