import Link from "next/link";

import BarraItens from "@/components/full/BarraItens";
import Panel from "@/components/ui/Panel";
import { hrefAba } from "@/lib/full-abas";
import { NOME_CANAL_LONGO, SELO_CANAL, type ResumoCanal, type ResumoOk } from "@/lib/full-visao-geral";
import { tituloMarca } from "@/lib/ml-full-estoque";

/**
 * VISAO RAPIDA do estoque Full por canal: por marca, a barra dos itens e as
 * contagens de ruptura e estoque baixo; o detalhe (curva, lista, excesso) fica
 * na aba do canal. So' contagens de itens: R$ nunca soma entre canais.
 */
const fmt = (n: number) => n.toLocaleString("pt-BR");
/** No celular a barra precisa de espaco: nome e contagens mais justos. */
const COLUNAS = "grid-cols-[minmax(4.5rem,5.25rem)_minmax(0,1fr)_3rem_3rem] gap-x-2 sm:grid-cols-[minmax(4.5rem,7rem)_minmax(0,1fr)_3.25rem_3.25rem] sm:gap-x-3";

const ABA: Record<ResumoOk["canal"], "estoque-ml" | "estoque-shopee"> = { ml: "estoque-ml", shopee: "estoque-shopee" };

function Contagem({ n, tom }: { n: number | null | undefined; tom: string }) {
  if (n === null || n === undefined) return <span className="text-center text-sm text-ink-faint">—</span>;
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-center text-sm tabular-nums ${n > 0 ? `${tom} font-semibold` : "text-ink-faint"}`}>{fmt(n)}</span>
  );
}

function Canal({ c }: { c: ResumoCanal }) {
  const nome = NOME_CANAL_LONGO[c.canal];
  const cab = (
    <div className="flex items-center justify-between gap-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${SELO_CANAL[c.canal].ponto}`} />
        {nome}
      </h4>
      {c.status === "ok" && (
        <Link href={hrefAba(ABA[c.canal])} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">
          Ver detalhe <span aria-hidden="true">&nbsp;›</span><span className="sr-only"> do estoque {nome}</span>
        </Link>
      )}
    </div>
  );
  if (c.status !== "ok") {
    return <div className="px-4 py-3">{cab}<p className="mt-1 text-sm text-ink-faint" title={c.motivo}>Sem dado agora</p></div>;
  }
  // Quem mais precisa de acao primeiro; marca sem leitura por ultimo.
  const marcas = [...c.marcas].sort((a, b) =>
    (b.ruptura === null ? 0 : 1) - (a.ruptura === null ? 0 : 1) || (b.ruptura ?? 0) - (a.ruptura ?? 0) || (b.baixo ?? 0) - (a.baixo ?? 0));
  return (
    <div className="px-4 py-3">
      {cab}
      <p className="text-xs text-ink-muted">
        <span className="font-semibold text-crit-ink">{fmt(c.ruptura)}</span> em ruptura · <span className="font-semibold text-warn-ink">{fmt(c.baixo)}</span> com estoque baixo
      </p>
      <ul className="mt-2" aria-label={`${nome}: itens por marca`}>
        <li aria-hidden="true" className={`grid ${COLUNAS} items-center pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint`}>
          <span>Marca</span><span>Itens</span><span className="text-center">Ruptura</span><span className="text-center">Baixo</span>
        </li>
        {marcas.map((m) => {
          const medida = m.base !== null && m.ruptura !== null && m.baixo != null && m.excesso != null;
          const base = m.base ?? 0, ruptura = m.ruptura ?? 0, baixo = m.baixo ?? 0, excesso = m.excesso ?? 0;
          return (
            <li key={m.marca} className={`grid ${COLUNAS} items-center border-t border-line py-2`} title={medida ? undefined : m.motivo}>
              <span className="truncate text-sm font-medium text-ink">{tituloMarca(m.marca)}</span>
              {medida ? (
                <>
                  <BarraItens c={{ itens: base, ruptura, baixo, excesso, demais: Math.max(0, base - ruptura - baixo - excesso) }} />
                  <Contagem n={m.ruptura} tom="bg-crit-soft text-crit-ink" />
                  <Contagem n={m.baixo} tom="bg-warn-soft text-warn-ink" />
                </>
              ) : (
                <span className="col-span-3 text-sm text-ink-faint">sem dado{m.motivo ? <span className="sr-only">: {m.motivo}</span> : null}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function VisaoRapidaEstoque({ canais }: { canais: readonly ResumoCanal[] }) {
  return (
    <Panel titulo="Estoque por marca" semPadding
      ajuda="Itens de cada marca no Full: ruptura, estoque baixo, excesso e, em cinza, os demais. Quem mais precisa de ação vem primeiro. Contagem de itens, sem R$. Curva e lista de itens: no detalhe do canal.">
      <div className="mt-2 grid divide-y divide-line border-t border-line xl:grid-cols-2 xl:divide-x xl:divide-y-0">
        {canais.map((c) => <Canal key={c.canal} c={c} />)}
      </div>
    </Panel>
  );
}
