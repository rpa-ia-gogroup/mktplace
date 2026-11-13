"use client";

/**
 * GRADE-CURVA: curva ABC (linhas) x marca (colunas) nas abas Estoque ML e
 * Estoque Shopee. AA/A aberta; B, C e "sem curva" recolhidas numa linha de
 * resumo (um clique abre). Regra em `lib/estoque-grade-curva.ts`.
 */
import { useState } from "react";
import { ChevronDown, Grid3x3 } from "lucide-react";

import TableScrollHint from "@/components/TableScrollHint";
import CelulaBarra from "@/components/ui/CelulaBarra";
import Panel from "@/components/ui/Panel";
import {
  AJUDA_GRADE, fmtPermanencia, LINHAS_CURVA, TOTAL, type CelulaGrade, type Grade, type LinhaCurva,
} from "@/lib/estoque-grade-curva";

const fmt = (n: number) => n.toLocaleString("pt-BR");
/** Ruptura/baixo/excesso contam itens; o disponivel e' em unidades. */
const itens = (n: number) => `${fmt(n)} ${n === 1 ? "item" : "itens"}`;
/** Celula sem nenhum item: nao e' "sem dado". */
const SemItens = () => <span className="text-xs text-ink-faint">sem itens</span>;

const PILULAS: { chave: "ruptura" | "baixo" | "excesso"; rotulo: string; tom: string }[] = [
  { chave: "ruptura", rotulo: "Ruptura", tom: "bg-crit-soft text-crit-ink" },
  { chave: "baixo", rotulo: "Estoque baixo", tom: "bg-warn-soft text-warn-ink" },
  { chave: "excesso", rotulo: "Excesso", tom: "bg-accent-soft text-accent-ink" },
];

function Pilula({ rotulo, valor, tom }: { rotulo: string; valor: string; tom: string }) {
  return (
    <span className={`flex items-center justify-between gap-3 rounded-md px-2 py-1 text-xs ${tom}`}>
      <span>{rotulo}</span>
      <span className="font-semibold tabular-nums">{valor}</span>
    </span>
  );
}

/** Barra do disponivel na cor de identidade (ALVO-GRADE: nunca mapa de calor). */
const COR_DISPONIVEL = "rgb(var(--tc-kpi-gmv))";

function CelulaAberta({ c, maximo }: { c: CelulaGrade; maximo: number }) {
  if (c.itens === 0) return <SemItens />;
  return (
    <div className="flex w-[220px] flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Disponível Full</span>
        {c.disponivel === null
          ? <span className="text-sm font-medium text-ink-faint">—</span>
          : <CelulaBarra valor={fmt(c.disponivel)} peso={maximo > 0 ? c.disponivel / maximo : 0} cor={COR_DISPONIVEL} />}
      </div>
      {PILULAS.map((p) => <Pilula key={p.chave} rotulo={p.rotulo} valor={itens(c[p.chave])} tom={c[p.chave] > 0 ? p.tom : "bg-raised text-ink-faint"} />)}
      <Pilula rotulo="Permanência" valor={fmtPermanencia(c.permanencia)} tom="bg-raised text-ink-muted" />
    </div>
  );
}

/** Linha recolhida e total: tudo numa linha, mesma ordem das pilulas. */
function CelulaResumo({ c, forte = false }: { c: CelulaGrade; forte?: boolean }) {
  if (c.itens === 0) return <SemItens />;
  const partes = [
    { n: c.ruptura, txt: "em ruptura", tom: "text-crit-ink" },
    { n: c.baixo, txt: "com estoque baixo", tom: "text-warn-ink" },
    { n: c.excesso, txt: "em excesso", tom: "text-accent-ink" },
  ].filter((x) => x.n > 0);
  return (
    <div className="flex w-[220px] flex-col gap-0.5">
      <span className={`tabular-nums ${forte ? "text-base font-semibold text-ink" : "text-sm font-medium text-ink"}`}>
        {c.disponivel === null ? "—" : fmt(c.disponivel)} <span className="text-xs font-normal text-ink-faint">un.</span>
      </span>
      <span className="text-xs tabular-nums text-ink-muted">
        {partes.map((x) => <span key={x.txt}><span className={x.tom}>{fmt(x.n)} {x.txt}</span> · </span>)}
        {c.permanencia === null ? "sem venda para medir permanência" : `${fmtPermanencia(c.permanencia)} de permanência`}
      </span>
    </div>
  );
}

/** A linha com mais disponivel abre por padrao (no ML e' "sem curva", com ~3/4 do estoque). */
function linhaMaiorFatia(grade: Grade): LinhaCurva {
  return LINHAS_CURVA.reduce((a, l) =>
    (grade.celulas[l.chave][TOTAL].disponivel ?? 0) > (grade.celulas[a.chave][TOTAL].disponivel ?? 0) ? l : a).chave;
}

export default function GradeCurvaMarca({
  grade, marcas, rotuloMarca, item = "itens", ressalva,
}: {
  grade: Grade;
  marcas: readonly string[];
  rotuloMarca: (m: string) => string;
  /** "inventários" (ML) ou "produtos" (Shopee), para o leitor de tela. */
  item?: string;
  /** Chip curto quando o recorte muda a leitura (lista truncada, filtro). */
  ressalva?: string | null;
}) {
  const [abertas, setAbertas] = useState<Set<LinhaCurva>>(
    () => new Set([...LINHAS_CURVA.filter((l) => l.aberta).map((l) => l.chave), linhaMaiorFatia(grade)]),
  );
  const alternar = (l: LinhaCurva) =>
    setAbertas((s) => { const n = new Set(s); if (n.has(l)) n.delete(l); else n.add(l); return n; });
  const colunas = [...marcas, TOTAL];
  // Escala da barra: a maior celula de marca (o total de curva teria sempre a barra cheia).
  const maximo = Math.max(0, ...LINHAS_CURVA.flatMap((l) => marcas.map((m) => grade.celulas[l.chave][m].disponivel ?? 0)));
  const maximoTotal = Math.max(0, ...LINHAS_CURVA.map((l) => grade.celulas[l.chave][TOTAL].disponivel ?? 0));

  return (
    <Panel
      titulo="Estoque por curva e marca"
      icone={Grid3x3}
      ajuda={AJUDA_GRADE}
      acao={ressalva ? <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs text-warn-ink">{ressalva}</span> : undefined}
      semPadding
    >
      <TableScrollHint>
        <div tabIndex={0} role="region" aria-label="Estoque por curva e marca (role na horizontal para ver todas as marcas)"
          className="min-w-max focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
          <table className="w-full text-sm">
            <caption className="sr-only">Disponível Full, ruptura, estoque baixo, excesso e permanência por curva e marca, em {item}</caption>
            <thead>
              <tr className="border-b border-line bg-raised text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <th scope="col" className="sticky left-0 z-10 bg-raised px-4 py-3">Curva</th>
                {colunas.map((m) => (
                  <th key={m} scope="col" className={`px-4 py-3 ${m === TOTAL ? "text-ink" : ""}`}>
                    {m === TOTAL ? "Total curva" : rotuloMarca(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LINHAS_CURVA.map((l) => {
                const aberta = abertas.has(l.chave);
                return (
                  <tr key={l.chave} className="border-b border-line align-top hover:bg-raised/40">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left">
                      <button type="button" aria-expanded={aberta} onClick={() => alternar(l.chave)}
                        className="inline-flex min-h-11 items-center gap-2 rounded font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-0">
                        <ChevronDown aria-hidden="true" className={`h-4 w-4 text-ink-faint transition-transform ${aberta ? "" : "-rotate-90"}`} />
                        {l.rotulo}
                      </button>
                    </th>
                    {colunas.map((m) => (
                      <td key={m} className={`px-4 py-3 ${m === TOTAL ? "bg-raised/50" : ""}`}>
                        {aberta ? <CelulaAberta c={grade.celulas[l.chave][m]} maximo={m === TOTAL ? maximoTotal : maximo} /> : <CelulaResumo c={grade.celulas[l.chave][m]} />}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr className="border-t-2 border-line-strong bg-raised align-top">
                <th scope="row" className="sticky left-0 z-10 bg-raised px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">Total marca</th>
                {colunas.map((m) => (
                  <td key={m} className="px-4 py-3"><CelulaResumo c={grade.totalMarca[m]} forte /></td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </TableScrollHint>
    </Panel>
  );
}
