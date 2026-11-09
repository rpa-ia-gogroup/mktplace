import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { tendencia } from "@/lib/gerencial/kpi-trend";
import NumeroAnimado from "./NumeroAnimado";
import { LinhaDeTendencia } from "./Sparkline";
import { TOM_PONTO, TOM_SUPERFICIE, TOM_TINTA, type Tom } from "./tone";

/**
 * Cor de IDENTIDADE do KPI (token `kpi-*`), a mesma do card da Gerencial:
 * borda (que acende o brilho em degrade do globals.css), ladrilho do icone e
 * mini grafico. Nao e' cor de estado: o bom/ruim fica no DeltaBadge e na
 * tinta do valor. Classes literais para o Tailwind enxergar.
 */
export type IdentidadeKpi = "gmv" | "pedidos" | "ticket" | "ads" | "roas" | "prazo" | "atendimento";

const IDENTIDADE: Record<IdentidadeKpi, { tinta: string; borda: string; ladrilho: string }> = {
  gmv: { tinta: "text-kpi-gmv", borda: "border-kpi-gmv/30", ladrilho: "bg-kpi-gmv/10" },
  pedidos: { tinta: "text-kpi-pedidos", borda: "border-kpi-pedidos/35", ladrilho: "bg-kpi-pedidos/10" },
  ticket: { tinta: "text-kpi-ticket", borda: "border-kpi-ticket/30", ladrilho: "bg-kpi-ticket/10" },
  ads: { tinta: "text-kpi-ads", borda: "border-kpi-ads/30", ladrilho: "bg-kpi-ads/10" },
  roas: { tinta: "text-kpi-roas", borda: "border-kpi-roas/35", ladrilho: "bg-kpi-roas/10" },
  prazo: { tinta: "text-kpi-prazo", borda: "border-kpi-prazo/30", ladrilho: "bg-kpi-prazo/10" },
  atendimento: { tinta: "text-kpi-atendimento", borda: "border-kpi-atendimento/35", ladrilho: "bg-kpi-atendimento/10" },
};

/**
 * UX-TORRE-1 — celula da faixa de KPIs.
 *
 * Quatro campos, sempre na mesma ordem: rotulo curto, valor, comparacao/meta,
 * estado. A explicacao longa vai para `contexto`, que vira `title` — o texto
 * continua existindo, mas para de ocupar a primeira dobra.
 *
 * `destaque` muda SO' a escala do numero. Duas escalas de destaque na mesma
 * faixa fariam o operador procurar a hierarquia em vez de ler o numero.
 *
 * IDENTIDADE-GERENCIAL: `variante="gerencial"` e' o cartao das abas
 * principais (vidro neutro, ladrilho de icone, valor text-2xl, tom so' no
 * ponto e na tinta do valor; com `onAbrir` vira botao do drilldown). Sem
 * `variante`, o render e' o mesmo de antes -- a Gerencial (CxResumo), a DRE
 * e a Expedicao usam a faixa padrao.
 */
export default function KpiTile({
  rotulo,
  valor,
  comparacao,
  contexto,
  tom = "neutro",
  destaque = false,
  ajuda,
  variante = "faixa",
  icone,
  delta,
  onAbrir,
  identidade,
  antes,
  serie,
  granularidade = "day",
  ativo,
  acaoFalada,
  folgaRodape,
}: {
  rotulo: ReactNode;
  valor: ReactNode;
  /** Meta, delta ou denominador. Uma linha. */
  comparacao?: ReactNode;
  /** Metodologia/ressalva — vai para o tooltip, nao para a tela. */
  contexto?: string;
  tom?: Tom;
  destaque?: boolean;
  /**
   * O "ⓘ" do rotulo, colado nele (EXPEDICAO-VENCE-AMANHA): quem le' o nome da
   * classificacao acha a explicacao ali, e nao no rodape do cartao.
   */
  ajuda?: ReactNode;
  /** "faixa" (padrao, igual a antes) ou "gerencial" (identidade das abas principais). */
  variante?: "faixa" | "gerencial";
  /** So' na variante "gerencial": ladrilho no canto superior direito. */
  icone?: LucideIcon;
  /** So' na variante "gerencial": pilula de variacao antes da comparacao. */
  delta?: ReactNode;
  /**
   * So' na variante "gerencial": o cartao vira <button> que abre o drilldown
   * (aria-haspopup="dialog"). Com ele, a `ajuda` deve ser `InfoDica emControle`
   * (nada interativo dentro de botao) e a ressalva vai no proprio dialogo.
   */
  onAbrir?: () => void;
  /**
   * So' na variante "gerencial": a cor de identidade do KPI. Com ela, o cartao
   * e' o card da faixa da Gerencial (KpiBand): borda e brilho na cor, ladrilho
   * h-8, valor na escala da faixa e rodape delta + "antes" | mini grafico.
   * Sem ela, o render "gerencial" de antes.
   */
  identidade?: IdentidadeKpi;
  /** Com `identidade`: o valor do periodo anterior ("antes R$ 70,51"). So' com periodo anterior REAL. */
  antes?: ReactNode;
  /** Com `identidade`: a serie do periodo, na ordem. Mini grafico so' com >= 4 pontos reais. */
  serie?: number[];
  /** Unidade de cada ponto da `serie`, para o texto da tendencia ("últimos 7 dias…"). */
  granularidade?: "hour" | "day" | "week" | "month";
  /**
   * Com `identidade` e `onAbrir`: o cartao FILTRA a tela em vez de abrir um
   * dialogo (abas de estoque do /full). Vira botao de alternar: `aria-pressed`
   * e anel quando ativo. Sem a prop, nada muda.
   */
  ativo?: boolean;
  /**
   * Com `identidade` + `onAbrir`: o que o clique faz, para o leitor de tela.
   * Padrao "abrir detalhe" (abre dialogo, aria-haspopup). Outro texto (ex.:
   * "ver na fila") = acao na propria pagina, sem aria-haspopup.
   */
  acaoFalada?: string;
  /** Reserva uma linha no rodape para um link posto por fora do botao (ex.: "por marca ->"). */
  folgaRodape?: boolean;
}) {
  if (variante === "gerencial" && identidade) {
    return (
      <KpiCardIdentidade
        rotulo={rotulo} valor={valor} comparacao={comparacao} contexto={contexto} tom={tom} ajuda={ajuda}
        icone={icone} delta={delta} onAbrir={onAbrir} identidade={identidade} antes={antes} serie={serie} granularidade={granularidade} folgaRodape={folgaRodape}
        acaoFalada={acaoFalada}
        ativo={ativo}
      />
    );
  }
  if (variante === "gerencial") {
    return (
      <KpiGerencial rotulo={rotulo} valor={valor} comparacao={comparacao} contexto={contexto} tom={tom} ajuda={ajuda} icone={icone} delta={delta} onAbrir={onAbrir} />
    );
  }
  return (
    <div
      title={contexto}
      className={`flex min-w-0 flex-col justify-between rounded-xl border px-3.5 py-3 ${TOM_SUPERFICIE[tom]}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {rotulo}
          {ajuda}
        </p>
        {tom !== "neutro" && (
          <span
            aria-hidden="true"
            className={`mt-1 h-2 w-2 shrink-0 rounded-full ${TOM_PONTO[tom]}`}
          />
        )}
      </div>
      <p
        className={`mt-1.5 font-semibold leading-none tabular-nums ${
          destaque ? "text-[28px]" : "text-xl"
        } ${TOM_TINTA[tom]}`}
      >
        {valor}
      </p>
      {comparacao && (
        <p className="mt-1.5 text-xs leading-snug text-ink-muted">{comparacao}</p>
      )}
    </div>
  );
}

function KpiGerencial({
  rotulo, valor, comparacao, contexto, tom, ajuda, icone: Icone, delta, onAbrir,
}: {
  rotulo: ReactNode; valor: ReactNode; comparacao?: ReactNode; contexto?: string; tom: Tom;
  ajuda?: ReactNode; icone?: LucideIcon; delta?: ReactNode; onAbrir?: () => void;
}) {
  const corpo = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {rotulo}
          {ajuda}
          {onAbrir && <span className="sr-only"> (abrir detalhe)</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {tom !== "neutro" && <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TOM_PONTO[tom]}`} />}
          {Icone && (
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/10 text-accent transition-transform duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            >
              <Icone className="h-4 w-4" strokeWidth={1.75} />
            </span>
          )}
        </span>
      </span>
      <span className={`block text-2xl font-semibold leading-tight tracking-tight tabular-nums ${TOM_TINTA[tom]}`}>{valor}</span>
      {(delta || comparacao) && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-snug text-ink-muted">
          {delta}
          {comparacao}
        </span>
      )}
    </>
  );
  const base = "flex h-full w-full min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface p-3.5 text-left";
  if (onAbrir) {
    return (
      <button
        type="button"
        onClick={onAbrir}
        aria-haspopup="dialog"
        title={contexto}
        className={`card-hover group min-h-11 ${base} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
      >
        {corpo}
      </button>
    );
  }
  return <div title={contexto} className={base}>{corpo}</div>;
}

/**
 * O card da faixa da Gerencial (KpiCard da KpiBand), com as mesmas classes:
 * cabecalho (rotulo + ⓘ | ladrilho h-8), valor na escala responsiva da faixa,
 * rodape `mt-auto` com delta + "antes" a' esquerda e o mini grafico a' direita.
 * Sem periodo anterior real nao ha' delta nem "antes"; sem serie real, sem
 * grafico. Nada inventado.
 */
function KpiCardIdentidade({
  rotulo, valor, comparacao, contexto, tom, ajuda, icone: Icone, delta, onAbrir, identidade, antes, serie, granularidade,
  ativo,
  acaoFalada = "abrir detalhe",
  folgaRodape = false,
}: {
  rotulo: ReactNode; valor: ReactNode; comparacao?: ReactNode; contexto?: string; tom: Tom; ajuda?: ReactNode;
  icone?: LucideIcon; delta?: ReactNode; onAbrir?: () => void; identidade: IdentidadeKpi; antes?: ReactNode;
  serie?: number[]; granularidade: "hour" | "day" | "week" | "month"; acaoFalada?: string; folgaRodape?: boolean; ativo?: boolean;
}) {
  const filtra = ativo !== undefined;
  const { tinta, borda, ladrilho } = IDENTIDADE[identidade];
  const t = serie ? tendencia(serie, granularidade) : null;
  const corpo = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {rotulo}
          {ajuda}
          {onAbrir && <span className="sr-only">{filtra ? " (mostrar na tabela)" : ` (${acaoFalada})`}</span>}
        </span>
        {Icone && (
          <span
            aria-hidden="true"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 ease-out group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${ladrilho} ${tinta}`}
          >
            <Icone className="h-4 w-4" strokeWidth={1.75} />
          </span>
        )}
      </span>
      <span className={`text-lg md:text-xl lg:text-2xl xl:text-lg min-[1440px]:text-2xl font-semibold tracking-tight tabular-nums leading-tight ${TOM_TINTA[tom]}`}>
        {typeof valor === "string" ? <NumeroAnimado texto={valor} /> : valor}
      </span>
      <span className="mt-auto flex items-end justify-between gap-3 pt-1">
        <span className="flex min-w-0 flex-col gap-1">
          {(delta || antes) && (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {delta}
              {antes && <span className="text-xs text-ink-faint tabular-nums">{antes}</span>}
            </span>
          )}
          {comparacao && <span className="text-xs text-ink-faint leading-snug">{comparacao}</span>}
        </span>
        {t && t.pontos.length >= 4 && <LinhaDeTendencia t={t} tinta={tinta} />}
      </span>
    </>
  );
  const base = `w-full min-w-0 h-full text-left bg-surface border rounded-xl p-3.5 ${folgaRodape ? "pb-11" : ""} flex flex-col gap-1 ${borda}`;
  if (onAbrir) {
    return (
      <button
        type="button"
        onClick={onAbrir}
        aria-haspopup={!filtra && acaoFalada === "abrir detalhe" ? "dialog" : undefined}
        aria-pressed={filtra ? ativo : undefined}
        title={contexto}
        className={`card-hover group min-h-11 ${base} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${ativo ? "ring-2 ring-accent" : ""}`}
      >
        {corpo}
      </button>
    );
  }
  return <div title={contexto} className={`group ${base}`}>{corpo}</div>;
}

