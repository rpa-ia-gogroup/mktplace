"use client";

/**
 * Faixa de cinco KPIs da Gerencial V2 (Gate V2-1, Task D).
 *
 * Componente NOVO em vez de estender `KpiCard`: aquele e' consumido por sete
 * outras rotas e este gate nao pode alterar a aparencia delas. A logica de
 * disponibilidade/comparacao vive em `lib/gerencial/kpi-band.ts` (pura e
 * testada); aqui so' existe apresentacao.
 *
 * Alturas iguais por construcao: cada card e' `h-full flex flex-col` dentro de
 * uma grade de uma linha, e o rodape (`mt-auto`) empurra a nota para a base.
 */
import {
  CircleDollarSign,
  Gauge,
  Megaphone,
  Receipt,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import type { KpiDescriptor, KpiKey } from "@/lib/gerencial/kpi-band";
import type { TendenciaKpi } from "@/lib/gerencial/kpi-trend";
import DeltaBadge from "@/components/ui/DeltaBadge";
import InfoDica from "@/components/ui/InfoDica";
import NumeroAnimado from "@/components/ui/NumeroAnimado";
import { LinhaDeTendencia } from "@/components/ui/Sparkline";

interface Props {
  kpis: KpiDescriptor[];
  loading: boolean;
  /** Task A — o bloco falha SOZINHO: `/overview` em erro nao apaga a evolucao,
   * o Pulso, a matriz, os movimentos nem a fila, que tem fontes proprias. */
  error: boolean;
  onOpen: (key: KpiKey) => void;
  onRetry: () => void;
  /** KPIS-COMPARACAO-1 — tendencia dentro do periodo, so' para quem tem serie. */
  tendencias?: Partial<Record<KpiKey, TendenciaKpi | null>>;
  /** GERENCIAL-METAS-1 — o GMV ja' e' o numero do bloco principal; a faixa
   * mostra so' os quatro de apoio, sem repetir. */
  semGmv?: boolean;
}

/**
 * UX-TORRE-B2B-1 — um icone por INDICADOR (nao por estado).
 * VISUAL-PALETA-1 — cada KPI tem a PROPRIA cor de identidade (token
 * `kpi-*`): borda do card, ladrilho do icone e mini grafico, como na Torre do
 * Atacado. Ajuda a achar o numero de relance sem acrescentar significado de
 * bom/ruim — a variacao continua em ok/crit.
 */
const ICONE_KPI: Record<KpiKey, { Icone: LucideIcon; tinta: string; borda: string; ladrilho: string }> = {
  gmv: { Icone: CircleDollarSign, tinta: "text-kpi-gmv", borda: "border-kpi-gmv/30", ladrilho: "bg-kpi-gmv/10" },
  orders: { Icone: ShoppingBag, tinta: "text-kpi-pedidos", borda: "border-kpi-pedidos/35", ladrilho: "bg-kpi-pedidos/10" },
  avg_ticket: { Icone: Receipt, tinta: "text-kpi-ticket", borda: "border-kpi-ticket/30", ladrilho: "bg-kpi-ticket/10" },
  ad_spend: { Icone: Megaphone, tinta: "text-kpi-ads", borda: "border-kpi-ads/30", ladrilho: "bg-kpi-ads/10" },
  roas: { Icone: Gauge, tinta: "text-kpi-roas", borda: "border-kpi-roas/35", ladrilho: "bg-kpi-roas/10" },
};

/**
 * UX-TORRE-B2B-1 — ocupacao da grade por posicao (0 = GMV, 4 = ROAS).
 *
 * Medido: um GMV de oito digitos com centavos ("R$ 00.000.000,0") precisa de
 * ~180px, e o cartao tinha 107px
 * em 1024 e 131px no mobile — o numero era CORTADO em producao. Agora:
 *   mobile (2 col)  GMV ocupa a linha inteira; Ads e ROAS dividem a ultima.
 *   md/lg (3 col)   GMV, Pedidos, Ticket / Ads, ROAS (duas colunas).
 *   xl (5 col)      uma linha so'.
 * O tamanho do numero acompanha a largura real do cartao em cada faixa.
 */
const SPAN_DO_KPI: Record<number, string | undefined> = {
  0: "col-span-2 md:col-span-1",
  4: "md:col-span-2 xl:col-span-1",
};

function KpiCardSkeleton() {
  return (
    <div
      className="h-full bg-surface border border-line rounded-xl p-4 flex flex-col gap-3 animate-pulse"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Carregando indicador…</span>
      <div className="h-3 w-20 bg-raised rounded" />
      <div className="h-7 w-32 bg-raised rounded" />
      <div className="h-3 w-24 bg-raised rounded mt-auto" />
    </div>
  );
}

const SETA: Record<"up" | "down" | "flat", string> = { up: "▲", down: "▼", flat: "=" };

function KpiCard({
  kpi,
  onOpen,
  tendencia,
}: {
  kpi: KpiDescriptor;
  onOpen: (key: KpiKey) => void;
  tendencia?: TendenciaKpi | null;
}) {
  const hasChannelList = kpi.channelValues != null && kpi.channelValues.length > 0;
  const { Icone, tinta, borda, ladrilho } = ICONE_KPI[kpi.key];
  // Menos texto no card: compradores, cobertura de Ads, "antes X" e a nota da comparacao moram no (i).
  const dica = [kpi.subvalue, kpi.coverageNote, kpi.reference, kpi.comparisonNote].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpen(kpi.key)}
      aria-haspopup="dialog"
      // `w-full min-w-0`: sem eles o <button> se dimensiona pelo conteudo e
      // estoura a trilha da grade — era a origem de 5px de overflow horizontal
      // no mobile (390px), medido no QA.
      className={`card-hover group w-full min-w-0 h-full min-h-11 text-left bg-surface border rounded-xl p-3.5 flex flex-col gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${borda}`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {kpi.label}
          {/* VISUAL-PALETA-1: compradores e cobertura de Ads saem do corpo do
              card para o "i" — o numero fala primeiro. */}
          {dica && <InfoDica emControle texto={dica} />}
          {/* KPIS-COMPARACAO-1: sem `aria-label` no botao, o nome acessivel e'
              o proprio conteudo (valor, variacao, tendencia); a acao vai aqui. */}
          <span className="sr-only"> (abrir decomposição)</span>
        </span>
        <span
          aria-hidden="true"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${ladrilho} ${tinta}`}
        >
          <Icone className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </span>

      {/* ROAS nunca tem valor unico: renderiza a lista por canal. */}
      {hasChannelList ? (
        <span className="flex flex-col gap-0.5 mt-0.5">
          {kpi.channelValues!.map((cv) => {
            const highlighted = kpi.highlightChannel === cv.channel;
            return (
              <span key={cv.channel} className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-ink-faint truncate">{cv.label}</span>
                {cv.value ? (
                  <span className="flex shrink-0 items-baseline gap-1.5">
                    {cv.direction && cv.previous && (
                      <span
                        className={`text-xs font-semibold tabular-nums ${
                          cv.direction === "flat"
                            ? "text-ink-muted"
                            : (cv.direction === "up") !== (kpi.deltaTone === "lower_is_better")
                              ? "text-ok-ink"
                              : "text-crit-ink"
                        }`}
                      >
                        {SETA[cv.direction]} de {cv.previous}
                      </span>
                    )}
                    <span
                      className={`tabular-nums ${
                        highlighted ? "text-xl font-bold text-ink" : "text-sm font-semibold text-ink"
                      }`}
                    >
                      {cv.value}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-ink-faint shrink-0">N/D</span>
                )}
              </span>
            );
          })}
        </span>
      ) : kpi.value ? (
        <span className="text-lg md:text-xl lg:text-2xl xl:text-lg min-[1440px]:text-2xl font-semibold tracking-tight text-ink tabular-nums leading-tight">
          <NumeroAnimado texto={kpi.value} />
        </span>
      ) : (
        <span className="text-lg md:text-xl lg:text-2xl xl:text-lg min-[1440px]:text-2xl font-semibold tracking-tight text-ink-faint tabular-nums leading-tight">N/D</span>
      )}

      {/* UX-VIDRO-3 (print aprovado): rodape em duas colunas — variacao e
          nota a' esquerda, mini grafico a' direita, alinhados pela base. */}
      <span className="mt-auto flex items-end justify-between gap-3 pt-1">
        <span className="flex min-w-0 flex-col gap-1">
          {kpi.deltaPct != null && kpi.value && <DeltaBadge pct={kpi.deltaPct} tone={kpi.deltaTone} />}
          {kpi.unavailableReason && (
            <span className="text-xs text-ink-faint leading-snug">{kpi.unavailableReason}</span>
          )}
        </span>
        {tendencia && tendencia.pontos.length >= 4 && kpi.value && (
          <LinhaDeTendencia t={tendencia} tinta={ICONE_KPI[kpi.key].tinta} />
        )}
      </span>
    </button>
  );
}

export default function KpiBand({ kpis: todos, loading, error, onOpen, onRetry, semGmv = false, tendencias }: Props) {
  const kpis = semGmv ? todos.filter((k) => k.key !== "gmv") : todos;
  // Com quatro cards a grade fecha sem celula vazia em 2 e 4 colunas, entao os
  // spans da fileira de cinco nao se aplicam.
  const span = (i: number) => (semGmv ? undefined : SPAN_DO_KPI[i]);
  if (error) {
    return (
      <section
        aria-label="Indicadores do período"
        className="bg-raised border border-line rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap"
      >
        <div>
          <h2 className="text-sm font-semibold text-ink-muted">Indicadores do período</h2>
          <p className="text-xs text-ink-faint">
            O agregado do período não respondeu nesta carga — GMV, Pedidos, Ticket, Investimento e ACOS ficam
            indisponíveis. Os demais blocos abaixo seguem com as próprias fontes.
          </p>
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

  return (
    <section aria-label="Indicadores do período">
      <h2 className="sr-only">Indicadores do período</h2>
      {/* 2 / 3 / 5 colunas. O ROAS (indice 4) ocupa duas colunas fora do
          desktop para que a fileira de cinco nunca deixe celula vazia — e ele
          e' justamente o card que precisa de mais largura, por listar canais. */}
      <div
        className={semGmv ? "grid grid-cols-2 xl:grid-cols-4 gap-3" : "grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3"}
        aria-busy={loading}
      >
        {loading
          ? Array.from({ length: semGmv ? 4 : 5 }, (_, i) => (
              // O ROAS ocupa duas colunas no tablet para nao deixar celula
              // vazia na fileira (grade de 5 em 2 colunas no mobile).
              <div key={i} className={span(i)}>
                <KpiCardSkeleton />
              </div>
            ))
          : kpis.map((kpi, i) => (
              <div key={kpi.key} className={span(i)}>
                <KpiCard kpi={kpi} onOpen={onOpen} tendencia={tendencias?.[kpi.key]} />
              </div>
            ))}
      </div>
    </section>
  );
}
