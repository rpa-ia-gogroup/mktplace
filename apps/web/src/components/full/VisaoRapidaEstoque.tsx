import Link from "next/link";

import BarraItens, { LegendaBarra } from "@/components/full/BarraItens";
import Panel from "@/components/ui/Panel";
import { hrefAba } from "@/lib/full-abas";
import {
  fmtPct, fmtReais, marcaSemFoto, NOME_CANAL_LONGO, pctDestaque, perdaDestaque, rupturaPorMarca, SELO_CANAL,
  type Canal, type ImpactoRuptura, type LinhaMarca, type ResumoCanal, type ResumoOk,
} from "@/lib/full-visao-geral";
import { tituloMarca } from "@/lib/ml-full-estoque";

/**
 * VISAO RAPIDA do estoque Full por canal (primeiro bloco depois dos indicadores):
 * por marca, a barra dos itens, as contagens de ruptura e estoque baixo e, embaixo,
 * o impacto potencial DO CANAL (R$/dia e %). R$ nunca soma entre canais: cada canal
 * tem o seu quadro. O detalhe (curva, lista, excesso) fica na aba do canal.
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

/**
 * Segunda linha da marca: "Impacto R$ 13,3 mil/dia · 4,2%". Marca sem fotografia ou sem preco: "—"
 * (nunca R$ 0 por ausencia); Shopee com estoque do vendedor: diz o porque, nao "R$ 0".
 */
function Impacto({ canal, l }: { canal: Canal; l: LinhaMarca }) {
  const m = l.impacto[canal];
  if (!m) return null;
  const forte = "block text-xs text-ink-muted";
  if (marcaSemFoto(m)) return <span className={forte} title="sem fotografia no dia">Impacto potencial —</span>;
  if (canal === "shopee" && l.vendedorTemEstoque) {
    return <span className={forte} title={`${fmtReais(m.perda_dia)}/dia potencial no Full, sem contar o estoque do vendedor`}>Impacto potencial: sem perda (vendedor tem estoque)</span>;
  }
  const v = perdaDestaque(canal, m);
  if (v === null) return <span className={forte} title="sem preço">Impacto potencial —</span>;
  const p = pctDestaque(canal, m);
  const detalhe = `Impacto potencial${p !== null ? `: ${fmtPct(p)} do faturamento Full da marca no canal` : ""}`;
  return (
    <span className={`${forte} tabular-nums`} title={detalhe}>
      Impacto potencial {p !== null && <><span className="font-medium text-ink">{fmtPct(p)}</span> · </>}<span className={p === null ? "font-medium text-ink" : undefined}>{fmtReais(v)}/dia</span>
      <span className="sr-only"> ({detalhe})</span>
    </span>
  );
}

/** Quem mais pesa primeiro: maior impacto do canal, depois mais ruptura, depois mais baixo; sem leitura por ultimo. */
function ordenar(canal: Canal, linhas: LinhaMarca[]): LinhaMarca[] {
  const medida = (l: LinhaMarca) => l.celulas[canal]?.ruptura != null;
  const perda = (l: LinhaMarca) => (l.impacto[canal] ? perdaDestaque(canal, l.impacto[canal]!) ?? -1 : -1);
  return [...linhas].sort((a, b) =>
    Number(medida(b)) - Number(medida(a)) || perda(b) - perda(a)
    || (b.celulas[canal]?.ruptura ?? 0) - (a.celulas[canal]?.ruptura ?? 0) || (b.celulas[canal]?.baixo ?? 0) - (a.celulas[canal]?.baixo ?? 0));
}

function Canal({ c, linhas }: { c: ResumoCanal; linhas: LinhaMarca[] }) {
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
        {ordenar(c.canal, linhas).map((l) => {
          const m = l.celulas[c.canal]!;
          const medida = m.base !== null && m.ruptura !== null && m.baixo != null && m.excesso != null;
          const base = m.base ?? 0, ruptura = m.ruptura ?? 0, baixo = m.baixo ?? 0, excesso = m.excesso ?? 0;
          return (
            <li key={l.marca} className="border-t border-line py-2" title={medida ? undefined : m.motivo}>
              <div className={`grid ${COLUNAS} items-center`}>
                <span className="truncate text-sm font-medium text-ink">{tituloMarca(l.marca)}</span>
                {medida ? (
                  <>
                    <BarraItens excessoComoDemais c={{ itens: base, ruptura, baixo, excesso, demais: Math.max(0, base - ruptura - baixo - excesso) }} />
                    <Contagem n={m.ruptura} tom="bg-crit-soft text-crit-ink" />
                    <Contagem n={m.baixo} tom="bg-warn-soft text-warn-ink" />
                  </>
                ) : (
                  <span className="col-span-3 text-sm text-ink-faint">sem dado{m.motivo ? <span className="sr-only">: {m.motivo}</span> : null}</span>
                )}
              </div>
              {medida && <div className="mt-0.5"><Impacto canal={c.canal} l={l} /></div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function VisaoRapidaEstoque({ canais, impacto }: { canais: readonly ResumoCanal[]; impacto: ImpactoRuptura | null }) {
  const linhas = rupturaPorMarca([...canais], impacto);
  return (
    <Panel titulo="Estoque por marca" semPadding
      ajuda="Itens de cada marca no Full: ruptura, estoque baixo e, em cinza, os demais (suficiente, sem giro, excesso). Embaixo, o impacto potencial da marca no canal: o % é do faturamento Full da marca no canal e o R$ é por dia; os dois são medidos em cada canal e nunca somados entre canais. Ordenado do maior impacto para o menor. Curva, excesso e lista de itens: no detalhe do canal.">
      <LegendaBarra excessoComoDemais className="px-4 pt-2" />
      <div className="mt-2 grid divide-y divide-line border-t border-line xl:grid-cols-2 xl:divide-x xl:divide-y-0">
        {canais.map((c) => <Canal key={c.canal} c={c} linhas={linhas.filter((l) => l.celulas[c.canal])} />)}
      </div>
    </Panel>
  );
}
