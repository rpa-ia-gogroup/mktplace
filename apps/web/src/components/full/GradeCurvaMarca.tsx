"use client";

/**
 * GRADE-CURVA: marcas nas colunas, UMA curva por vez (botao no topo do
 * painel, pedido da Nathalia em 13/11) + linha "Total marca". Regra em
 * `lib/estoque-grade-curva.ts`.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Grid3x3, X } from "lucide-react";

import TableScrollHint from "@/components/TableScrollHint";
import CelulaBarra from "@/components/ui/CelulaBarra";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import {
  AJUDA_GRADE, fmtPermanencia, itensDaCelula, LINHAS_CURVA, montarGrade, TOTAL,
  type CelulaGrade, type ItemGrade, type LinhaCurva,
} from "@/lib/estoque-grade-curva";

const fmt = (n: number) => n.toLocaleString("pt-BR");
/** Cobertura do item na lista: "3 d de cobertura" / "sem venda medida". */
const fmtCobertura = (v: ItemGrade["cobertura"]) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? "sem venda medida" : `${fmtPermanencia(n)} de cobertura`;
};
/** Ruptura/baixo/excesso contam itens; o disponivel e' em unidades. */
const itens = (n: number) => `${fmt(n)} ${n === 1 ? "item" : "itens"}`;
/** Celula sem nenhum item: nao e' "sem dado". */
const SemItens = () => <span className="text-xs text-ink-faint">sem itens</span>;

type Classe = "ruptura" | "baixo" | "excesso";
const PILULAS: { chave: Classe; rotulo: string; tom: string }[] = [
  { chave: "ruptura", rotulo: "Ruptura", tom: "bg-crit-soft text-crit-ink" },
  { chave: "baixo", rotulo: "Estoque baixo", tom: "bg-warn-soft text-warn-ink" },
  { chave: "excesso", rotulo: "Excesso", tom: "bg-accent-soft text-accent-ink" },
];

const PILULA = "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-xs";

function Pilula({ rotulo, valor, tom }: { rotulo: string; valor: string; tom: string }) {
  return (
    <span className={`${PILULA} ${tom}`}>
      <span>{rotulo}</span>
      <span className="font-semibold tabular-nums">{valor}</span>
    </span>
  );
}

/** Pilula com itens: clica e abre a lista embaixo da grade (pedido da Nathalia). */
function PilulaBotao({ rotulo, valor, tom, ativa, controla, aoClicar }: {
  rotulo: string; valor: string; tom: string; ativa: boolean; controla: string; aoClicar: (b: HTMLButtonElement) => void;
}) {
  // Disclosure: abre a lista embaixo da grade (aria-expanded + aria-controls).
  return (
    <button type="button" aria-expanded={ativa} aria-controls={controla} onClick={(e) => aoClicar(e.currentTarget)}
      className={`${PILULA} ${tom} cursor-pointer text-left transition-shadow hover:ring-1 hover:ring-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${ativa ? "ring-2 ring-current" : ""}`}>
      <span>{rotulo}</span>
      <span className="font-semibold tabular-nums">{valor} <span aria-hidden="true">›</span></span>
    </button>
  );
}

/** Barra do disponivel na cor de identidade (ALVO-GRADE: nunca mapa de calor). */
const COR_DISPONIVEL = "rgb(var(--tc-kpi-gmv))";

function CelulaAberta({ c, maximo, ativa, controla, aoAbrir }: {
  c: CelulaGrade; maximo: number; ativa: Classe | null; controla: string; aoAbrir: (k: Classe, b: HTMLButtonElement) => void;
}) {
  if (c.itens === 0) return <SemItens />;
  return (
    <div className="flex w-[220px] flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Disponível Full</span>
        {c.disponivel === null
          ? <span className="text-sm font-medium text-ink-faint">—</span>
          : <CelulaBarra valor={fmt(c.disponivel)} peso={maximo > 0 ? c.disponivel / maximo : 0} cor={COR_DISPONIVEL} />}
      </div>
      {PILULAS.map((p) => c[p.chave] > 0
        ? <PilulaBotao key={p.chave} rotulo={p.rotulo} valor={itens(c[p.chave])} tom={p.tom} ativa={ativa === p.chave} controla={controla} aoClicar={(b) => aoAbrir(p.chave, b)} />
        : <Pilula key={p.chave} rotulo={p.rotulo} valor={itens(0)} tom="bg-raised text-ink-faint" />)}
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

export default function GradeCurvaMarca({
  itens: lista, marcas, rotuloMarca, notaMarca, item = "itens", ressalva, comCurva = true,
}: {
  /** Itens ja' no recorte dos cartoes; a grade e a lista do clique saem daqui. */
  itens: readonly ItemGrade[];
  marcas: readonly string[];
  rotuloMarca: (m: string) => string;
  /** Estado da marca no cabecalho (sem fotografia, sem estoque Full...): ausencia dita, nunca zero. */
  notaMarca?: (m: string) => string | null;
  /** "inventários" (ML) ou "produtos" (Shopee), para o leitor de tela. */
  item?: string;
  /** Chip curto quando o recorte muda a leitura (lista truncada, filtro). */
  ressalva?: string | null;
  /** Curva nao lida: so' a linha Total marca (o estado das marcas continua no cabecalho). */
  comCurva?: boolean;
}) {
  const [curva, setCurvaBruta] = useState<LinhaCurva>("aa_a");
  const [aberta, setAberta] = useState<{ marca: string; classe: Classe } | null>(null);
  const setCurva = (c: LinhaCurva) => { setCurvaBruta(c); setAberta(null); };
  const grade = useMemo(() => montarGrade(lista, marcas), [lista, marcas]);
  const idLista = useId();
  const listaRef = useRef<HTMLDivElement | null>(null);
  const origemRef = useRef<HTMLButtonElement | null>(null);
  const alternar = (marca: string, classe: Classe, b: HTMLButtonElement) => {
    origemRef.current = b;
    setAberta((a) => (a && a.marca === marca && a.classe === classe ? null : { marca, classe }));
  };
  const fechar = () => { setAberta(null); origemRef.current?.focus(); };
  // No celular a lista nasce no pe' da tela: traz para a vista ao abrir.
  useEffect(() => { if (aberta) listaRef.current?.scrollIntoView({ block: "nearest" }); }, [aberta]);
  const daLista = aberta ? itensDaCelula(lista, marcas, aberta.marca, curva, aberta.classe) : [];
  const colunas = [...marcas, TOTAL];
  const celulas = grade.celulas[curva];
  // Escala da barra: a maior marca na curva escolhida; o total tem a propria (seria sempre cheio).
  const maximo = Math.max(0, ...marcas.map((m) => celulas[m].disponivel ?? 0));
  const rotuloCurva = LINHAS_CURVA.find((l) => l.chave === curva)!.rotulo;

  return (
    <Panel
      titulo={comCurva ? "Estoque por curva e marca" : "Estoque por marca"}
      icone={Grid3x3}
      ajuda={AJUDA_GRADE}
      acao={
        <>
          {ressalva && <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs text-warn-ink">{ressalva}</span>}
          {comCurva && <Segmented rotulo="Curva" opcoes={LINHAS_CURVA.map((l) => ({ valor: l.chave, texto: l.rotulo }))} valor={curva} aoEscolher={setCurva} />}
        </>
      }
      semPadding
    >
      <TableScrollHint>
        <div tabIndex={0} role="region" aria-label="Estoque por curva e marca (role na horizontal para ver todas as marcas)"
          className="min-w-max focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent">
          <table className="w-full text-sm">
            <caption className="sr-only">Curva {rotuloCurva}: disponível Full, ruptura, estoque baixo, excesso e permanência por marca, em {item}</caption>
            <thead>
              <tr className="border-b border-line bg-raised text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                <th scope="col" className="sticky left-0 z-10 bg-raised px-4 py-3">Curva</th>
                {colunas.map((m) => {
                  const nota = m === TOTAL ? null : notaMarca?.(m) ?? null;
                  return (
                    <th key={m} scope="col" className={`px-4 py-3 align-top ${m === TOTAL ? "text-ink" : ""}`}>
                      {m === TOTAL ? "Total" : rotuloMarca(m)}
                      {nota && <span className="mt-0.5 block text-[11px] font-normal normal-case tracking-normal text-warn-ink">{nota}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {comCurva && <tr className="border-b border-line align-top">
                <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left font-semibold text-ink">{rotuloCurva}</th>
                {colunas.map((m) => (
                  <td key={m} className={`px-4 py-3 ${m === TOTAL ? "bg-raised/50" : ""}`}>
                    <CelulaAberta c={celulas[m]} maximo={m === TOTAL ? celulas[TOTAL].disponivel ?? 0 : maximo}
                      ativa={aberta?.marca === m ? aberta.classe : null} controla={idLista} aoAbrir={(k, b) => alternar(m, k, b)} />
                  </td>
                ))}
              </tr>}
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
      {aberta && comCurva && (
        <div id={idLista} ref={listaRef} role="region" aria-label="Produtos da célula escolhida" className="border-t border-line px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              {PILULAS.find((p) => p.chave === aberta.classe)!.rotulo} · {aberta.marca === TOTAL ? "todas as marcas" : rotuloMarca(aberta.marca)} · curva {rotuloCurva}
              <span className="ml-2 font-normal text-ink-muted">{itens(daLista.length)}</span>
            </p>
            <button type="button" onClick={fechar} aria-label="Fechar lista"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded text-ink-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-8 sm:min-w-8">
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <ul className="divide-y divide-line text-sm">
            {daLista.map((i, n) => (
              <li key={n} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                <span className="min-w-0 flex-1 text-ink">
                  {aberta.marca === TOTAL && <span className="mr-2 text-xs font-semibold uppercase text-ink-faint">{rotuloMarca(i.brand)}</span>}
                  {i.rotulo ?? "sem identificação"}
                </span>
                {/* Ruptura: "0 un. · 0 d" repetiria o obvio; basta o produto. */}
                {aberta.classe !== "ruptura" && (
                  <span className="whitespace-nowrap text-xs tabular-nums text-ink-muted">
                    {i.disponivel === null ? "—" : fmt(i.disponivel)} un. · {fmtCobertura(i.cobertura)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
