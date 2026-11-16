"use client";

/**
 * ESTOQUE POR CURVA E MARCA: uma linha por marca, com barra empilhada dos itens
 * (ruptura / baixo / demais / excesso) e os numeros ao lado. Quem mais precisa
 * de acao vem primeiro; ruptura, baixo e excesso abrem a lista (pop-up). A curva
 * e' filtro (botao no topo do painel, pedido da Nathalia em 13/11) e "Todas"
 * ocupa o lugar da antiga linha "Total marca". Regra em `lib/estoque-grade-curva.ts`.
 */
import { useMemo, useState } from "react";
import { Grid3x3 } from "lucide-react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";

import BarraItens from "@/components/full/BarraItens";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import {
  AJUDA_GRADE, fmtPermanencia, itensDaCelula, montarGrade, OPCOES_CURVA, ordenarPorAcao, TOTAL,
  type CelulaGrade, type FiltroCurvaGrade, type ItemGrade,
} from "@/lib/estoque-grade-curva";

const fmt = (n: number) => n.toLocaleString("pt-BR");
/** Cobertura do item na lista: "3 d de cobertura" / "sem venda medida". */
const fmtCobertura = (v: ItemGrade["cobertura"]) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? "sem venda medida" : `${fmtPermanencia(n)} de cobertura`;
};
/** Ruptura/baixo/excesso contam itens; o disponivel e' em unidades. */
const itens = (n: number) => `${fmt(n)} ${n === 1 ? "item" : "itens"}`;

type Classe = "ruptura" | "baixo" | "excesso";
/** `curto` e' o rotulo dentro do chip no celular (no desktop quem rotula e' o cabecalho). */
const CLASSES: { chave: Classe; rotulo: string; curto: string; tom: string }[] = [
  { chave: "ruptura", rotulo: "Ruptura", curto: "Ruptura", tom: "bg-crit-soft text-crit-ink" },
  { chave: "baixo", rotulo: "Estoque baixo", curto: "Baixo", tom: "bg-warn-soft text-warn-ink" },
  { chave: "excesso", rotulo: "Excesso", curto: "Excesso", tom: "bg-accent-soft text-accent-ink" },
];

/** Colunas no desktop: marca | barra | ruptura | baixo | excesso | disponivel | permanencia. */
const COLUNAS = "lg:grid-cols-[minmax(7rem,1fr)_minmax(10rem,2.2fr)_5.25rem_5.25rem_5.25rem_6.5rem_5.5rem]";
const CHIP = "flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-sm lg:min-h-9";

function Chip({ c, n, aberta, aoClicar, nome }: {
  c: (typeof CLASSES)[number]; n: number; aberta: boolean; aoClicar: () => void; nome: string;
}) {
  const corpo = (
    <>
      <span className="text-xs lg:hidden">{c.curto}</span>
      <span className="font-semibold tabular-nums">{fmt(n)}</span>
    </>
  );
  if (n === 0) {
    return <span className={`${CHIP} text-ink-faint`} aria-label={`${nome}: ${c.rotulo}, nenhum item`}>{corpo}</span>;
  }
  // Abre o pop-up com a lista (padrao das outras abas: KpiDrilldownDialog).
  return (
    <button type="button" aria-haspopup="dialog" aria-label={`${nome}: ${c.rotulo}, ${itens(n)}. Abrir a lista`} onClick={aoClicar}
      className={`${CHIP} ${c.tom} cursor-pointer transition-shadow hover:ring-1 hover:ring-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${aberta ? "ring-2 ring-current" : ""}`}>
      {corpo}
    </button>
  );
}

/** Numero com rotulo so' no celular (no desktop o cabecalho da coluna rotula). */
function Numero({ rotulo, children, forte = false }: { rotulo: string; children: React.ReactNode; forte?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5 tabular-nums lg:justify-end">
      <span className="text-xs text-ink-faint lg:sr-only">{rotulo}</span>
      <span className={forte ? "text-sm font-semibold text-ink" : "text-sm text-ink-muted"}>{children}</span>
    </span>
  );
}

function Linha({ nome, nota, c, aberta, aoAbrir, total = false }: {
  nome: string; nota?: string | null; c: CelulaGrade; aberta: Classe | null; aoAbrir: (k: Classe) => void; total?: boolean;
}) {
  return (
    <li className={`grid grid-cols-2 gap-x-3 gap-y-2.5 px-4 py-3 lg:items-center lg:gap-y-0 ${COLUNAS} ${total ? "border-t-2 border-line-strong bg-raised" : "border-t border-line first:border-t-0"}`}>
      <div className="col-span-2 flex items-baseline justify-between gap-3 lg:col-span-1 lg:block">
        <span className={`text-sm text-ink ${total ? "font-semibold uppercase tracking-wide text-ink-muted" : "font-semibold"}`}>{nome}</span>
        <span className="block text-xs text-ink-faint">{c.itens > 0 ? itens(c.itens) : "sem itens nesta curva"}</span>
        {nota && <span className="block text-[11px] text-warn-ink">{nota}</span>}
      </div>
      {c.itens > 0 && (
        <>
          <div className="col-span-2 lg:col-span-1"><BarraItens c={c} /></div>
          <div className="col-span-2 grid grid-cols-3 gap-2 lg:contents">
            {CLASSES.map((k) => (
              <Chip key={k.chave} c={k} n={c[k.chave]} nome={nome} aberta={aberta === k.chave} aoClicar={() => aoAbrir(k.chave)} />
            ))}
          </div>
          <Numero rotulo="Disponível" forte>
            {c.disponivel === null ? "—" : <>{fmt(c.disponivel)} <span className="text-xs font-normal text-ink-faint">un.</span></>}
          </Numero>
          <Numero rotulo="Permanência">{fmtPermanencia(c.permanencia)}</Numero>
        </>
      )}
    </li>
  );
}

export default function GradeCurvaMarca({
  itens: lista, marcas, rotuloMarca, notaMarca, item = "itens", ressalva, comCurva = true,
}: {
  /** Itens ja' no recorte dos cartoes; a grade e a lista do clique saem daqui. */
  itens: readonly ItemGrade[];
  marcas: readonly string[];
  rotuloMarca: (m: string) => string;
  /** Estado da marca ao lado do nome (sem fotografia, sem estoque Full...): ausencia dita, nunca zero. */
  notaMarca?: (m: string) => string | null;
  /** "inventários" (ML) ou "produtos" (Shopee), para o leitor de tela. */
  item?: string;
  /** Chip curto quando o recorte muda a leitura (lista truncada, filtro). */
  ressalva?: string | null;
  /** Curva nao lida: so' "Todas" (o estado das marcas continua ao lado do nome). */
  comCurva?: boolean;
}) {
  const [escolhida, setCurvaBruta] = useState<FiltroCurvaGrade>("aa_a");
  const [aberta, setAberta] = useState<{ marca: string; classe: Classe } | null>(null);
  const curva: FiltroCurvaGrade = comCurva ? escolhida : "todas";
  const setCurva = (c: FiltroCurvaGrade) => { setCurvaBruta(c); setAberta(null); };
  const grade = useMemo(() => montarGrade(lista, marcas), [lista, marcas]);
  const celulas = curva === "todas" ? grade.totalMarca : grade.celulas[curva];
  const ordem = useMemo(() => ordenarPorAcao(marcas, celulas), [marcas, celulas]);
  const daLista = aberta ? itensDaCelula(lista, marcas, aberta.marca, curva, aberta.classe) : [];
  const rotuloCurva = OPCOES_CURVA.find((l) => l.chave === curva)!.rotulo;
  const aoAbrir = (marca: string) => (classe: Classe) => setAberta({ marca, classe });

  return (
    <Panel
      titulo={comCurva ? "Estoque por curva e marca" : "Estoque por marca"}
      icone={Grid3x3}
      ajuda={AJUDA_GRADE}
      acao={
        <>
          {ressalva && <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-xs text-warn-ink">{ressalva}</span>}
          {comCurva && (
            // 390: cinco opcoes nao cabem em 358 px; a trilha rola sozinha em vez de quebrar "Sem curva" em duas linhas.
            <div className="max-w-full overflow-x-auto">
              <Segmented rotulo="Curva" opcoes={OPCOES_CURVA.map((l) => ({ valor: l.chave, texto: l.rotulo }))} valor={curva} aoEscolher={setCurva} className="whitespace-nowrap" />
            </div>
          )}
        </>
      }
      semPadding
    >
      <div className="mt-3 border-t border-line">
        <div aria-hidden="true" className={`hidden gap-x-3 bg-raised px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-muted lg:grid ${COLUNAS}`}>
          <span>Marca</span>
          <span>Itens</span>
          <span className="text-center">Ruptura</span>
          <span className="text-center">Baixo</span>
          <span className="text-center">Excesso</span>
          <span className="text-right">Disponível</span>
          <span className="text-right">Permanência</span>
        </div>
        <ul aria-label={`Curva ${rotuloCurva}: ruptura, estoque baixo, excesso, disponível Full e permanência por marca, em ${item}`}>
          {ordem.map((m) => (
            <Linha key={m} nome={rotuloMarca(m)} nota={notaMarca?.(m) ?? null} c={celulas[m]}
              aberta={aberta?.marca === m ? aberta.classe : null} aoAbrir={aoAbrir(m)} />
          ))}
          <Linha nome="Total" c={celulas[TOTAL]} aberta={aberta?.marca === TOTAL ? aberta.classe : null} aoAbrir={aoAbrir(TOTAL)} total />
        </ul>
      </div>
      <KpiDrilldownDialog
        open={!!aberta && comCurva}
        onClose={() => setAberta(null)}
        title={aberta ? `${CLASSES.find((p) => p.chave === aberta.classe)!.rotulo} · ${aberta.marca === TOTAL ? "todas as marcas" : rotuloMarca(aberta.marca)} · ${curva === "todas" ? "todas as curvas" : `curva ${rotuloCurva}`}` : ""}
      >
        {aberta && (
          <>
            <p className="mb-2 text-sm text-ink-muted">{itens(daLista.length)}</p>
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
          </>
        )}
      </KpiDrilldownDialog>
    </Panel>
  );
}
