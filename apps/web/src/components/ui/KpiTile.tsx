import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { TOM_PONTO, TOM_SUPERFICIE, TOM_TINTA, type Tom } from "./tone";

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
}) {
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
