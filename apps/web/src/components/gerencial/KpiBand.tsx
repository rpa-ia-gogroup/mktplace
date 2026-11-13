"use client";

/**
 * Faixa de indicadores da Gerencial — ALVO-GRADE (aprovado em 12/11/2026).
 *
 * Quatro cartoes IGUAIS (`CartaoIndicador`): GMV (com a meta dentro: barra de
 * progresso e "N% da meta de R$ X"), Pedidos, Ticket medio e Investimento em
 * ads (com o ACOS por canal na legenda). A logica de disponibilidade e
 * comparacao continua em `lib/gerencial/kpi-band.ts`; aqui so' apresentacao.
 */
import { CircleDollarSign, Megaphone, Receipt, ShoppingBag, type LucideIcon } from "lucide-react";
import type { KpiDescriptor, KpiKey } from "@/lib/gerencial/kpi-band";
import { suavizar, type TendenciaKpi } from "@/lib/gerencial/kpi-trend";
import { fmtPctBr } from "@/lib/formatters";
import CartaoIndicador, { type TomPilula } from "@/components/ui/CartaoIndicador";
import InfoDica from "@/components/ui/InfoDica";

/** O que o cartao de GMV mostra alem do descritor: o numero do topo (com as demais marcas) e a meta. */
export interface GmvDoCartao {
  valor: string | null;
  deltaPct: number | null;
  /** Atingimento da meta (0..1); `null` = recorte sem meta. */
  progresso: number | null;
  legenda: string;
  /** Dado incompleto: a legenda vira aviso. */
  aviso?: string | null;
  dica?: string;
  serie?: number[];
}

interface Props {
  kpis: KpiDescriptor[];
  /** Sem ele (so' marcas menores, onde o GMV e' o bloco principal), a faixa mostra so' os de apoio. */
  gmv?: GmvDoCartao;
  loading: boolean;
  /** O bloco falha SOZINHO: `/overview` em erro nao apaga os demais blocos. */
  error: boolean;
  onOpen: (key: KpiKey) => void;
  onRetry: () => void;
  /** Tendencia dentro do periodo, so' para quem tem serie. */
  tendencias?: Partial<Record<KpiKey, TendenciaKpi | null>>;
}

const CARTAO: Record<Exclude<KpiKey, "roas">, { icone: LucideIcon; cor: string }> = {
  gmv: { icone: CircleDollarSign, cor: "#8b5cf6" },
  orders: { icone: ShoppingBag, cor: "#f59e0b" },
  avg_ticket: { icone: Receipt, cor: "#3b82f6" },
  ad_spend: { icone: Megaphone, cor: "#ec4899" },
};
const ORDEM = ["gmv", "orders", "avg_ticket", "ad_spend"] as const;
const CANAL_CURTO: Record<string, string> = { tiktok: "TikTok", ml: "ML", shopee: "Shopee" };

function pilulaDe(pct: number | null, tom: KpiDescriptor["deltaTone"]): { texto: string; tom: TomPilula } | null {
  if (pct == null) return null;
  return { texto: fmtPctBr(pct), tom: tom === "neutral" ? "neutro" : (pct >= 0) !== (tom === "lower_is_better") ? "ok" : "crit" };
}

export default function KpiBand({ kpis, gmv, loading, error, onOpen, onRetry, tendencias }: Props) {
  if (error) {
    return (
      <section aria-label="Indicadores do período" className="bg-raised border border-line rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-ink-muted">Indicadores do período</h2>
          <p className="text-xs text-ink-faint">O agregado do período não respondeu nesta carga. Os demais blocos seguem com as próprias fontes.</p>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-semibold text-ink-muted border border-line-strong rounded-lg px-3 min-h-11 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Tentar novamente
        </button>
      </section>
    );
  }
  const de = (k: KpiKey) => kpis.find((x) => x.key === k);
  const acos = (de("roas")?.channelValues ?? []).filter((c) => c.value).map((c) => `${CANAL_CURTO[c.channel] ?? c.label} ${c.value}`);
  return (
    <section aria-label="Indicadores do período">
      <h2 className="sr-only">Indicadores do período</h2>
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4" aria-busy={loading}>
        {loading
          ? ORDEM.filter((k) => gmv || k !== "gmv").map((k) => (
              <div key={k} className="h-[150px] animate-pulse rounded-2xl border border-line bg-surface p-4" role="status" aria-busy="true">
                <span className="sr-only">Carregando indicador…</span>
                <div className="h-3 w-24 rounded bg-raised" />
                <div className="mt-3 h-8 w-36 rounded bg-raised" />
              </div>
            ))
          : ORDEM.map((k) => {
              const kpi = de(k);
              if (!kpi || (k === "gmv" && !gmv)) return null;
              const eGmv = k === "gmv" && gmv != null;
              const dica = eGmv ? gmv.dica : [kpi.subvalue, kpi.coverageNote, kpi.reference, kpi.comparisonNote].filter(Boolean).join(" · ");
              const valor = eGmv ? gmv.valor : kpi.value;
              const delta = eGmv ? gmv.deltaPct : kpi.deltaPct;
              const legenda = eGmv && gmv ? (
                gmv.aviso ? <span className="font-semibold text-warn-ink">{gmv.aviso}</span> : gmv.legenda
              ) : !valor ? (
                kpi.unavailableReason
              ) : k === "ad_spend" && acos.length ? (
                `ACOS ${acos.join(" · ")}`
              ) : delta != null ? (
                kpi.reference?.startsWith("vs") ? kpi.reference : "vs anterior"
              ) : (
                kpi.comparisonNote
              );
              const t = tendencias?.[k];
              return (
                <CartaoIndicador
                  key={k}
                  rotulo={eGmv ? "GMV do período" : kpi.label}
                  icone={CARTAO[k].icone}
                  cor={CARTAO[k].cor}
                  valor={valor}
                  pilula={valor ? pilulaDe(delta, kpi.deltaTone) : null}
                  progresso={eGmv ? gmv.progresso : null}
                  legenda={legenda}
                  serie={eGmv ? gmv.serie : t ? suavizar(t.pontos) : null}
                  ajuda={dica ? <InfoDica emControle texto={dica} /> : null}
                  onAbrir={() => onOpen(k)}
                />
              );
            })}
      </div>
    </section>
  );
}
