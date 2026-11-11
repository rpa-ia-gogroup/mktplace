/**
 * Qualidade — os cartoes por canal (padrao da Gerencial) e o detalhe "por marca"
 * que o clique abre. Logica PURA (testada): o valor do cartao e a linha de cada
 * marca saem da MESMA definicao, entao o detalhe nunca contradiz o cartao. Nada
 * novo e' buscado.
 *
 * Esta fonte NAO tem periodo anterior nem serie: sem pilula, sem "antes", sem
 * grafico. Ausencia nunca vira zero: sem valor, "—" (e "Sem dado" no detalhe); o
 * cancelamento e a devolucao do TikTok seguem como "N/D · Não disponível nesta
 * fonte" (ver `quality-availability.ts`).
 *
 * Formato da casa: "3,1%", "5,2 dias" (nunca "3.1%", "5.2d").
 */
import type { QualityBrandRow, QualityKpis } from "./api-client.ts";
import { fmtNumCurto, fmtPctSimples } from "./formatters.ts";

export type CanalQualidade = "tiktok" | "ml" | "shopee";

export type ChaveQualidade =
  | "tk_entrega"
  | "ml_cancelamento"
  | "ml_nao_entregue"
  | "ml_entrega"
  | "sh_cancelamento"
  | "sh_devolucao";

type Tipo = "pct" | "dias";
type Num = number | null | undefined;

interface Definicao {
  rotulo: string;
  canal: CanalQualidade;
  tipo: Tipo;
  valor: (f: QualityKpis | QualityBrandRow) => Num;
  /** Base do indicador na linha da marca ("68 de 2,2 mil pedidos"). */
  apoio?: (r: QualityBrandRow) => string | undefined;
  /** Ressalva que muda a leitura do numero: vai para o ⓘ (nunca uma linha no cartao). */
  dica?: string;
}

const dec1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "5,2 dias" (sem valor: "—"). */
export function fmtDias(v: number | null | undefined): string {
  if (v == null) return "—";
  const r = dec1.format(v);
  return `${r} ${r === "1,0" ? "dia" : "dias"}`;
}

const de = (parte: Num, total: Num, unidade: string) =>
  parte != null && total != null ? `${fmtNumCurto(parte)} de ${fmtNumCurto(total)} ${unidade}` : undefined;

export const DEF_QUALIDADE: Record<ChaveQualidade, Definicao> = {
  tk_entrega: { rotulo: "Entrega", canal: "tiktok", tipo: "dias", valor: (f) => f.tiktok_avg_delivery_days, dica: "Tempo médio de entrega · dados a partir de abr/26" },
  ml_cancelamento: {
    rotulo: "Cancelamento", canal: "ml", tipo: "pct", valor: (f) => f.ml_cancel_rate_pct,
    apoio: (r) => de(r.ml_cancelled_orders, r.ml_total_orders, "pedidos"),
  },
  ml_nao_entregue: {
    rotulo: "Não entregue", canal: "ml", tipo: "pct", valor: (f) => f.ml_not_delivered_rate_pct,
    apoio: (r) => (r.ml_not_delivered_shipments != null ? `${fmtNumCurto(r.ml_not_delivered_shipments)} envios` : undefined),
    dica: "Proxy: pagos − entregues",
  },
  ml_entrega: { rotulo: "Entrega", canal: "ml", tipo: "dias", valor: (f) => f.ml_avg_delivery_days, dica: "Tempo médio em dias" },
  sh_cancelamento: {
    rotulo: "Cancelamento", canal: "shopee", tipo: "pct", valor: (f) => f.shopee_cancel_rate_pct,
    apoio: (r) => de(r.shopee_canceled_orders, r.shopee_orders, "pedidos"),
  },
  sh_devolucao: {
    rotulo: "Devolução", canal: "shopee", tipo: "pct", valor: (f) => f.shopee_return_rate_pct,
    apoio: (r) => de(r.shopee_returned_orders, r.shopee_orders, "pedidos"),
  },
};

export const NOME_DO_CANAL: Record<CanalQualidade, string> = { tiktok: "TikTok Shop", ml: "Mercado Livre", shopee: "Shopee" };

/** Titulo do detalhe: "Cancelamento · Mercado Livre". */
export function tituloDoDetalhe(chave: ChaveQualidade): string {
  const d = DEF_QUALIDADE[chave];
  return `${d.rotulo} · ${NOME_DO_CANAL[d.canal]}`;
}

function formatar(tipo: Tipo, v: number): string {
  return tipo === "pct" ? fmtPctSimples(v) : fmtDias(v);
}

export interface TextoDoCartao {
  /** "—" quando nao ha' valor (nunca "0"). */
  valor: string;
  ausente: boolean;
}

export function textoDoCartao(chave: ChaveQualidade, kpis: QualityKpis | null | undefined): TextoDoCartao {
  const def = DEF_QUALIDADE[chave];
  const v = kpis ? def.valor(kpis) : null;
  return { valor: v != null ? formatar(def.tipo, v) : "—", ausente: v == null };
}

/** Quais cartoes cada canal mostra, na ordem. TikTok tem ainda 2 cartoes "N/D" (fora desta lista). */
export const CARTOES_DO_CANAL: Record<CanalQualidade, ChaveQualidade[]> = {
  tiktok: ["tk_entrega"],
  ml: ["ml_cancelamento", "ml_nao_entregue", "ml_entrega"],
  shopee: ["sh_cancelamento", "sh_devolucao"],
};

export interface LinhaMarca {
  brand: string;
  label: string;
  /** Texto da linha ("3,1% · 68 de 2,2 mil pedidos"); "Sem dado" quando ausente. */
  valor: string;
  ausente: boolean;
  /** 0–100 para a barra, relativa a maior marca; `null` quando nao ha' valor. */
  pct: number | null;
}

/**
 * Uma linha por marca, das que tem valor primeiro (maior -> menor) e as sem dado
 * depois. A barra e' relativa a maior marca (taxas e dias sao pequenos; pelo valor
 * cru a barra nao se veria).
 */
export function linhasPorMarca(chave: ChaveQualidade, marcas: QualityBrandRow[]): LinhaMarca[] {
  const def = DEF_QUALIDADE[chave];
  const lidas = marcas.map((m) => ({ m, v: def.valor(m) ?? null }));
  const maior = Math.max(0, ...lidas.map((l) => l.v ?? 0));
  const comValor = lidas
    .filter((l): l is { m: QualityBrandRow; v: number } => l.v != null)
    .sort((a, b) => b.v - a.v)
    .map(({ m, v }) => {
      const apoio = def.apoio?.(m);
      return {
        brand: m.brand,
        label: m.label,
        valor: apoio ? `${formatar(def.tipo, v)} · ${apoio}` : formatar(def.tipo, v),
        ausente: false,
        pct: maior > 0 ? (v / maior) * 100 : 0,
      };
    });
  const semValor = lidas.filter((l) => l.v == null).map(({ m }) => ({ brand: m.brand, label: m.label, valor: "Sem dado", ausente: true, pct: null }));
  return [...comValor, ...semValor];
}
