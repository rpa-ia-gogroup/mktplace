import type { ReactNode } from "react";

/**
 * UX-TORRE-B2B-1 — composicao conhecida de UM canal, em linhas.
 *
 * Cada linha e' um componente que a fonte do canal ENTREGA (valor + % do GMV),
 * ou declara que nao entrega (`ausente`). A barra e' o percentual sobre o GMV
 * do proprio canal, em escala real (100% = trilho inteiro): nada e' somado e
 * nada e' normalizado, porque os componentes vem de fontes e denominadores
 * diferentes e somar fecharia uma "margem" que esta tela nao tem.
 *
 * Cor da barra = identidade do canal. Nao ha verde/vermelho aqui: o fato de
 * um custo existir nao e' bom nem ruim; as faixas de severidade ficam nas
 * tabelas, onde tem regra de negocio por tras.
 */
export interface LinhaCusto {
  rotulo: string;
  /** Valor monetario ja' formatado. */
  valor?: string | null;
  /** % do GMV do canal, numero bruto (a barra usa este valor). */
  pct?: number | null;
  /** Texto do percentual ja' formatado (preserva o formato da tela). */
  pctTexto?: string | null;
  /** Uma linha curta de contexto (ROAS, ACOS, "competencias podem divergir"). */
  detalhe?: ReactNode;
  /** A fonte do canal nao entrega este componente. */
  ausente?: string;
}

/**
 * A lista de componentes de UM canal, dentro do detalhe que o cartao de GMV abre
 * (antes era o corpo do painel por canal). `barra` e' a classe `bg-canal-*` do canal.
 */
export default function ListaDeCustos({ linhas, barra }: { linhas: LinhaCusto[]; barra: string }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {linhas.map((l) => (
        <li key={l.rotulo} className="flex flex-col gap-1.5 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-ink-muted">{l.rotulo}</span>
            {l.ausente ? (
              <span className="rounded border border-dashed border-line-strong px-1.5 py-0.5 text-xs text-ink-faint">{l.ausente}</span>
            ) : (
              <span className="flex items-baseline gap-2 tabular-nums">
                {/* Regra de produto: o percentual ANTES do valor absoluto ("29,9% · R$ 4,0 mi"). */}
                {l.pctTexto && <span className="text-sm font-semibold text-ink">{l.pctTexto}</span>}
                {l.pctTexto && l.valor && <span aria-hidden="true" className="text-ink-faint">·</span>}
                {l.valor && <span className="text-xs font-medium text-ink-muted">{l.valor}</span>}
              </span>
            )}
          </div>
          {!l.ausente && l.pct != null && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
              <div className={`tc-barra h-full rounded-full ${barra}`} style={{ width: `${Math.min(100, Math.max(0, l.pct))}%` }} />
            </div>
          )}
          {l.detalhe && <p className="text-xs leading-snug text-ink-faint">{l.detalhe}</p>}
        </li>
      ))}
    </ul>
  );
}
