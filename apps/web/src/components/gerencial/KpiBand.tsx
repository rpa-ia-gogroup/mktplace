"use client";

/**
 * Faixa de indicadores da Gerencial — ALVO-GRADE (aprovado em 12/11/2026).
 *
 * Quatro cartoes IGUAIS (`CartaoIndicador`). Com `gmv`: GMV (com a meta
 * dentro), Pedidos, Ticket medio e Investimento em ads (ACOS por canal no
 * rodape). Com `acosProprio` (Gerencial: GMV e meta ficam no MetaHero, acima):
 * ACOS por canal, Pedidos, Ticket medio e Investimento em ads. A logica de disponibilidade e
 * comparacao continua em `lib/gerencial/kpi-band.ts`; aqui so' apresentacao.
 */
import { CircleDollarSign, Gauge, Megaphone, Receipt, ShoppingBag, type LucideIcon } from "lucide-react";
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
  /** Com meta: o selo do fechamento projetado ("No caminho") e a projecao, na linha da meta. */
  status?: { texto: string; tom: TomPilula } | null;
  projecao?: string | null;
  /** Contra o que a variacao compara, quando nao e' o periodo anterior ("vs ontem até 14h"). */
  referencia?: string | null;
  /** Dado incompleto: a legenda vira aviso. */
  aviso?: string | null;
  dica?: string;
  serie?: number[];
}

interface Props {
  kpis: KpiDescriptor[];
  /** Sem ele (so' marcas menores, onde o GMV e' o bloco principal), a faixa mostra so' os de apoio. */
  gmv?: GmvDoCartao;
  /** ACOS por canal vira o 1o cartao (no lugar do GMV, que esta' no heroi). */
  acosProprio?: boolean;
  loading: boolean;
  /** O bloco falha SOZINHO: `/overview` em erro nao apaga os demais blocos. */
  error: boolean;
  onOpen: (key: KpiKey) => void;
  onRetry: () => void;
  /** Tendencia dentro do periodo, so' para quem tem serie. */
  tendencias?: Partial<Record<KpiKey, TendenciaKpi | null>>;
}

const CARTAO: Record<KpiKey, { icone: LucideIcon; cor: string }> = {
  roas: { icone: Gauge, cor: "rgb(var(--tc-kpi-roas))" },
  gmv: { icone: CircleDollarSign, cor: "rgb(var(--tc-kpi-gmv))" },
  orders: { icone: ShoppingBag, cor: "rgb(var(--tc-kpi-pedidos))" },
  avg_ticket: { icone: Receipt, cor: "rgb(var(--tc-kpi-ticket))" },
  ad_spend: { icone: Megaphone, cor: "rgb(var(--tc-kpi-ads))" },
};
const DIRECAO = { up: "tende a subir", down: "tende a descer", flat: "estável" } as const;
const ORDEM_GMV = ["gmv", "orders", "avg_ticket", "ad_spend"] as const;
const ORDEM_ACOS = ["roas", "orders", "avg_ticket", "ad_spend"] as const;
const CANAL_CURTO: Record<string, string> = { tiktok: "TikTok", ml: "ML", shopee: "Shopee" };

function pilulaDe(pct: number | null, tom: KpiDescriptor["deltaTone"]): { texto: string; tom: TomPilula } | null {
  if (pct == null) return null;
  return { texto: fmtPctBr(pct), tom: tom === "neutral" ? "neutro" : (pct >= 0) !== (tom === "lower_is_better") ? "ok" : "crit" };
}

export default function KpiBand({ kpis, gmv, acosProprio, loading, error, onOpen, onRetry, tendencias }: Props) {
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
  const acos = de("roas")?.channelValues ?? [];
  const ORDEM: readonly KpiKey[] = acosProprio && !gmv ? ORDEM_ACOS : ORDEM_GMV;
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
              const eAcos = k === "roas";
              const legenda = eAcos ? (acos.some((c) => c.value) ? null : kpi.unavailableReason) : eGmv && gmv ? (
                gmv.aviso ? (
                  <span className="font-semibold text-warn-ink">{gmv.aviso}</span>
                ) : (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {gmv.legenda}
                    {gmv.status && (
                      <span className={`rounded-full px-2 py-0.5 font-semibold whitespace-nowrap ${gmv.status.tom === "ok" ? "bg-ok-soft text-ok-ink" : gmv.status.tom === "crit" ? "bg-crit-soft text-crit-ink" : gmv.status.tom === "warn" ? "bg-warn-soft text-warn-ink" : "bg-raised text-ink-muted"}`}>
                        {gmv.status.texto}
                      </span>
                    )}
                    {gmv.projecao && (
                      <span className="whitespace-nowrap">
                        projeção <b className="font-semibold text-ink">{gmv.projecao}</b>
                      </span>
                    )}
                  </span>
                )
              ) : !valor ? (
                kpi.unavailableReason
              ) : delta != null ? null : (
                kpi.comparisonNote
              );
              // A referencia vai DENTRO da pilula ("+42,4% vs anterior"): o numero nunca fica sem dizer contra o que.
              const ref = kpi.reference?.startsWith("vs") ? kpi.reference : "vs anterior";
              const p = valor ? pilulaDe(delta, kpi.deltaTone) : null;
              const t = tendencias?.[k];
              return (
                <CartaoIndicador
                  key={k}
                  rotulo={eGmv ? "GMV do período" : kpi.label}
                  icone={CARTAO[k].icone}
                  cor={CARTAO[k].cor}
                  valor={valor}
                  valores={eAcos ? acos.map((c) => ({ rotulo: CANAL_CURTO[c.channel] ?? c.label, valor: c.value })) : null}
                  pilula={p && { ...p, texto: `${p.texto} ${eGmv && gmv ? gmv.referencia ?? "vs anterior" : ref}` }}
                  rodape={
                    k === "ad_spend" && acos.length && !acosProprio ? (
                      <span className="grid gap-0.5 tabular-nums">
                        {acos.map((c) => (
                          <span key={c.channel} className="flex items-baseline justify-between gap-3">
                            <span>ACOS {CANAL_CURTO[c.channel] ?? c.label}</span>
                            <b className={c.value ? "font-semibold text-ink" : "font-normal text-ink-faint"}>{c.value ?? "—"}</b>
                          </span>
                        ))}
                      </span>
                    ) : null
                  }
                  progresso={eGmv ? gmv.progresso : null}
                  legenda={legenda}
                  serie={!valor ? null : eGmv ? gmv.serie : t ? suavizar(t.pontos) : null}
                  tendencia={t?.direcao ? `Tendência: ${DIRECAO[t.direcao]}${t.variacaoPct != null ? ` (${t.rotulo}: ${fmtPctBr(t.variacaoPct)})` : ""}` : null}
                  ajuda={dica ? <InfoDica emControle texto={dica} /> : null}
                  onAbrir={() => onOpen(k)}
                />
              );
            })}
      </div>
    </section>
  );
}
