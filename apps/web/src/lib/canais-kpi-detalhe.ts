/**
 * Canais — os 15 cartoes de indicador (TikTok, Mercado Livre, Shopee) e o detalhe
 * "por marca" que o clique abre. Logica PURA: o valor do cartao e a linha de cada
 * marca saem da MESMA definicao, entao o detalhe nunca contradiz o cartao.
 *
 * Os formatadores sao os da casa (`fmtBrlCurto`, `fmtNumCurto`,
 * `formatContentPctBr`): "35,5 mil", "12,5%", nunca "35.5K". Ausencia nunca vira
 * zero: sem valor, "—" (e o detalhe diz "Sem dado").
 */
import type { CanaisBrandRow, CanaisKpis } from "./api-client.ts";
import { fmtBrlCurto, fmtNumCurto } from "./formatters.ts";
import { formatContentPctBr } from "./tiktok-content-mix.ts";

export type KpiCanalChave =
  | "tiktok_video"
  | "tiktok_live"
  | "tiktok_card"
  | "tiktok_conversao"
  | "ml_novos"
  | "ml_recompra"
  | "ml_gmv_comprador"
  | "shopee_novos"
  | "shopee_recompra"
  | "shopee_gmv_comprador"
  | "shopee_visitantes"
  | "shopee_conversao";

export type CanalDoKpi = "tiktok" | "ml" | "shopee";
type Fonte = CanaisKpis | CanaisBrandRow;
type Num = number | null | undefined;
type Tipo = "pct" | "brl" | "num";

interface Definicao {
  rotulo: string;
  canal: CanalDoKpi;
  tipo: Tipo;
  valor: (f: Fonte) => Num;
  /** Segunda linha do cartao (e sufixo da linha da marca): base do indicador. */
  apoio?: (f: Fonte) => string | undefined;
  /** Texto fixo quando nao ha' base numerica (ex.: "Visitas ao perfil no mês"). */
  apoioFixo?: string;
  /** Ressalva que muda a leitura do numero: vai para o ⓘ do detalhe. */
  dica?: string;
}

const DICA_MIX = "% da base de conteúdo (vídeo + live + card/vitrine). Não representa participação nas vendas totais.";

const n = (v: Num, sufixo: string) => (v != null ? `${fmtNumCurto(v)} ${sufixo}` : undefined);
const brl = (v: Num) => (v != null ? fmtBrlCurto(v) : undefined);

export const KPI_CANAL: Record<KpiCanalChave, Definicao> = {
  tiktok_video: { rotulo: "Vídeo — % da base de conteúdo", canal: "tiktok", tipo: "pct", valor: (f) => f.tiktok_video_pct, apoio: (f) => brl(f.tiktok_gmv_video), dica: DICA_MIX },
  tiktok_live: { rotulo: "Live — % da base de conteúdo", canal: "tiktok", tipo: "pct", valor: (f) => f.tiktok_live_pct, apoio: (f) => brl(f.tiktok_gmv_live), dica: DICA_MIX },
  tiktok_card: { rotulo: "Card/vitrine — % da base de conteúdo", canal: "tiktok", tipo: "pct", valor: (f) => f.tiktok_card_pct, apoio: (f) => brl(f.tiktok_gmv_card), dica: DICA_MIX },
  tiktok_conversao: {
    rotulo: "Conversão TikTok",
    canal: "tiktok",
    tipo: "pct",
    valor: (f) => f.tiktok_conversion_rate,
    apoio: (f) => n(f.tiktok_customers, "compradores (soma diária)"),
  },
  ml_novos: { rotulo: "Novos Compradores ML", canal: "ml", tipo: "pct", valor: (f) => f.ml_new_buyer_pct, apoio: (f) => n(f.ml_new_buyers, "novos") },
  ml_recompra: { rotulo: "Recompra ML", canal: "ml", tipo: "pct", valor: (f) => f.ml_repeat_buyer_rate_pct, apoio: (f) => n(f.ml_repeat_buyers, "recorrentes") },
  ml_gmv_comprador: {
    rotulo: "GMV por Comprador ML",
    canal: "ml",
    tipo: "brl",
    valor: (f) => f.ml_gmv_per_buyer,
    apoio: (f) => n(f.ml_unique_buyers, "compradores (soma diária)"),
  },
  shopee_novos: { rotulo: "Novos Compradores Shopee", canal: "shopee", tipo: "pct", valor: (f) => f.shopee_new_buyer_pct, apoio: (f) => n(f.shopee_new_buyers, "novos") },
  shopee_recompra: {
    rotulo: "Recompra Shopee",
    canal: "shopee",
    tipo: "pct",
    valor: (f) => f.shopee_repeat_buyer_rate_pct,
    apoio: (f) => n(f.shopee_repeat_buyers, "recorrentes"),
  },
  shopee_gmv_comprador: {
    rotulo: "GMV / Comprador Shopee",
    canal: "shopee",
    tipo: "brl",
    valor: (f) => f.shopee_gmv_per_buyer,
    apoio: (f) => n(f.shopee_unique_buyers, "compradores (soma diária)"),
  },
  shopee_visitantes: { rotulo: "Visitantes Shopee", canal: "shopee", tipo: "num", valor: (f) => f.shopee_visitors, apoioFixo: "Visitas ao perfil no mês" },
  shopee_conversao: { rotulo: "Conversão Shopee", canal: "shopee", tipo: "pct", valor: (f) => f.shopee_conversion_rate, apoioFixo: "Compradores / Visitantes" },
};

/** Ponto de identidade do canal (so' identidade, nunca estado): classe `bg-canal-*`. */
export const PONTO_DO_CANAL: Record<CanalDoKpi, string> = {
  tiktok: "bg-canal-tiktok",
  ml: "bg-canal-ml",
  shopee: "bg-canal-shopee",
};

function formatar(tipo: Tipo, v: number): string {
  if (tipo === "pct") return formatContentPctBr(v);
  if (tipo === "brl") return fmtBrlCurto(v);
  return fmtNumCurto(v);
}

export interface TextoDoCartao {
  /** "—" quando nao ha' valor (nunca "0"). */
  valor: string;
  ausente: boolean;
  /** Segunda linha: base do indicador, so' quando existe. */
  comparacao?: string;
}

/** O que o cartao mostra, a partir dos KPIs do filtro atual. */
export function textoDoCartao(chave: KpiCanalChave, kpis: CanaisKpis | null): TextoDoCartao {
  const def = KPI_CANAL[chave];
  const v = kpis ? def.valor(kpis) : null;
  return {
    valor: v != null ? formatar(def.tipo, v) : "—",
    ausente: v == null,
    comparacao: (kpis && def.apoio?.(kpis)) || def.apoioFixo,
  };
}

export interface LinhaPorMarca {
  brand: string;
  label: string;
  /** Texto da linha ("12,5% · 1,2 mil novos"); "Sem dado" quando ausente. */
  valor: string;
  ausente: boolean;
  /** 0–100 para a barra; `null` quando nao ha' valor. */
  pct: number | null;
}

/**
 * Uma linha por marca, das que tem valor primeiro (maior -> menor) e as sem dado
 * depois. Percentual desenha a barra pelo proprio valor (0–100); reais e
 * contagem, relativa ao maior.
 */
export function linhasPorMarca(chave: KpiCanalChave, marcas: CanaisBrandRow[]): LinhaPorMarca[] {
  const def = KPI_CANAL[chave];
  const lidas = marcas.map((m) => ({ m, v: def.valor(m) ?? null }));
  const maior = Math.max(0, ...lidas.map((l) => l.v ?? 0));
  const comValor = lidas
    .filter((l): l is { m: CanaisBrandRow; v: number } => l.v != null)
    .sort((a, b) => b.v - a.v)
    .map(({ m, v }) => {
      const apoio = def.apoio?.(m);
      return {
        brand: m.brand,
        label: m.label,
        valor: apoio ? `${formatar(def.tipo, v)} · ${apoio}` : formatar(def.tipo, v),
        ausente: false,
        pct: def.tipo === "pct" ? Math.max(0, Math.min(100, v)) : maior > 0 ? (v / maior) * 100 : 0,
      };
    });
  const semValor = lidas
    .filter((l) => l.v == null)
    .map(({ m }) => ({ brand: m.brand, label: m.label, valor: "Sem dado", ausente: true, pct: null }));
  return [...comValor, ...semValor];
}
