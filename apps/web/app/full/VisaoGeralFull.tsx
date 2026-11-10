"use client";

/**
 * FULL-UNIFICADO-1 — "Visão geral" do Full, no esqueleto da Gerencial
 * (IDENTIDADE-GERENCIAL): herói (% sem estoque, um canal por linha com a
 * foto) → faixa de KPIs (impacto potencial por canal com drilldown por
 * marca; quem para a venda na Shopee) → o que exige atenção agora → ruptura
 * por marca → mais detalhes (recolhido). Sem bloco de evolução: o Full não
 * tem série. Cada célula: 1 número + no máximo 1 secundário; o resto
 * (denominador, SKU, R$ bruto) em title + sr-only.
 *
 * Usa as duas rotas de estoque que ja' existem; as regras moram em
 * `src/lib/full-visao-geral.ts`. Ausencia nunca vira zero: canal fora,
 * marca sem foto ou lista truncada aparecem como "—" com o motivo.
 */

import Link from "next/link";
import { Boxes, PackageX, TrendingDown, TriangleAlert, Warehouse } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import PageContainer from "@/components/layout/PageContainer";
import PageHeader from "@/components/layout/PageHeader";
import Chip from "@/components/ui/Chip";
import Heroi from "@/components/ui/Heroi";
import InfoDica from "@/components/ui/InfoDica";
import DeltaBadge from "@/components/ui/DeltaBadge";
import KpiTile from "@/components/ui/KpiTile";
import MaisDetalhes from "@/components/ui/MaisDetalhes";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import ChipCurva from "@/components/full/ChipCurva";
import SeloCanal from "@/components/full/SeloCanal";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { fetchCurvaAbc, fetchEstoqueFull, fetchImpactoRuptura, fetchMLFullEstoque } from "@/lib/api-client";
import { fmtDecimal, fmtInt } from "@/lib/estoque-full";
import { doCanal, noCanal } from "@/lib/canal-preposicao";
import { hrefAba } from "@/lib/full-abas";
import {
  NOME_CANAL,
  QUERY_ML,
  QUERY_SHOPEE,
  fmtPct,
  fmtReais,
  colunasMarca,
  descricaoTop,
  dicaImpacto,
  fracao,
  subtituloRuptura,
  impactosOk,
  antesHeroi,
  antesImpacto,
  antesParamVenda,
  semComparacao,
  contarFiltros,
  curvaDe,
  dicaCurva,
  impactoPorCurva,
  fmtFatia,
  rankingRupturas,
  avisoCanal,
  AVISO_LISTA_INCOMPLETA,
  RESUMO_BLOCO_FORA,
  blocosForaDaFila,
  celulaEstoque,
  celulaImpacto,
  contarCanais,
  filtrarCanal,
  filtroDoBloco,
  filtrosNaUrl,
  fotosHeroi,
  lerFiltrosUrl,
  passaFiltro,
  DICA_IMPACTO_FILA,
  NOME_CANAL_LONGO,
  SELO_CANAL,
  type BlocoCanal,
  type FiltroCanal,
  type ItemRuptura,
  heroiCurva,
  DICA_HEROI_PARCIAL,
  contarGrupos,
  grupoDe,
  rotuloGrupo,
  filaPorGrupo,
  POR_GRUPO,
  type GrupoCurva,
  DICA_ORDEM_FILA,
  type CurvaAbc,
  type Curva,
  type FiltroCurva,
  heroiRuptura,
  impactoPorMarca,
  kpiImpacto,
  kpiParamVenda,
  pctDestaque,
  perdaDestaque,
  mediana,
  oks,
  resumoML,
  resumoShopee,
  rupturaPorMarca,
  total,
  type Canal,
  type MarcaCanal,
  type ImpactoRuptura,
  type ResumoCanal,
  type ResumoOk,
  type Antes,
} from "@/lib/full-visao-geral";
import { tituloMarca, validarPayloadML } from "@/lib/ml-full-estoque";

const DICA_RUPTURA =
  "Sem estoque no Full com demanda: venda nos últimos 28 dias e saldo Full disponível igual a 0. " +
  "Grão: no ML conta inventário (vários anúncios podem dividir um inventário); na Shopee conta item. " +
  "Fora do total: kits da Shopee (não conciliados), a Kokeshi na Shopee (sem conta na esteira de estoque) e a Ápice no ML.";
const NOTA_VENDEDOR =
  "Ruptura no Full não quer dizer venda parada: na Shopee o vendedor pode ter estoque próprio e seguir vendendo fora do Full.";
const NOTA_IMPACTO =
  "No ML, anúncios do mesmo inventário fora do Full podem seguir vendendo. Item sem preço fica fora da soma.";
const DICA_COBERTURA =
  "Mediana da cobertura em dias dos itens com venda nos 28 dias, como a API calcula item a item. Itens sem venda ficam fora.";

const CANAIS: Canal[] = ["ml", "shopee"];

function motivoErro(e: unknown): string {
  return e instanceof Error ? e.message : "Falha ao carregar.";
}

/** "—" com o motivo legivel por leitor de tela e no hover. */
function Ausente({ motivo }: { motivo?: string }) {
  return (
    <span title={motivo}>
      —{motivo && <span className="sr-only"> ({motivo})</span>}
    </span>
  );
}

/** Um numero na vista; o detalhe (denominador, SKU, R$ bruto) vai para title + sr-only, nao so' hover. */
function Escondido({ texto, detalhe, className }: { texto: string; detalhe?: string | null; className?: string }) {
  return (
    <span title={detalhe ?? undefined} className={className}>
      {texto}{detalhe && <span className="sr-only"> ({detalhe})</span>}
    </span>
  );
}

/** So' o %; "x de y" no title + sr-only. */
function Fracao({ parte, base, motivo }: { parte: number | null; base: number | null; motivo?: string }) {
  const f = fracao(parte, base);
  if (!f) return <Ausente motivo={motivo ?? (base === 0 ? "sem itens no Full" : undefined)} />;
  return <Escondido texto={f.texto} detalhe={f.detalhe} className="font-semibold text-ink" />;
}

/** Segunda linha da celula de marca: so' o R$/dia; % do Full da marca e "sem preço" no title + sr-only. */
function ImpactoMarca({ canal, m, vendedorTemEstoque }: { canal: Canal; vendedorTemEstoque: boolean; m: { perda_dia: number | null; perda_dia_sem_vendedor: number | null; pct_gmv_full: number | null; pct_gmv_full_sem_vendedor: number | null; sem_preco: number } }) {
  // R$ 0 porque o vendedor cobre as rupturas: diz o porque, nao "R$ 0/dia".
  if (vendedorTemEstoque) {
    return <Escondido texto="vendedor tem estoque" detalhe={`${fmtReais(m.perda_dia)}/dia potencial no Full, sem contar o estoque do vendedor`} className="block text-xs text-ink-muted" />;
  }
  const v = perdaDestaque(canal, m);
  if (v === null) return <span className="block text-xs text-ink-muted"><Ausente motivo="sem preço" /></span>;
  const p = pctDestaque(canal, m);
  const detalhe = [p !== null ? `${fmtPct(p)} do Full da marca` : null, m.sem_preco > 0 ? `${fmtInt(m.sem_preco)} sem preço` : null].filter(Boolean).join(" · ");
  return <Escondido texto={`${fmtReais(v)}/dia`} detalhe={detalhe || null} className="block whitespace-nowrap text-xs text-ink-muted" />;
}

/**
 * FULL-CARINHO -- bloco de um canal no heroi (mini-cartao): nome com o ponto do
 * canal, "6 AA/A" e UMA linha de apoio. O aviso so' aparece com problema (foto
 * velha ou marca faltando); o frescor em dia fica no title e no ⓘ do heroi.
 * O bloco e' botao: leva a fila filtrada naquele canal (e AA/A).
 */
function BlocoCanalHeroi({ c, bloco, aoClicar, recarregar }: { c: ResumoCanal; bloco?: BlocoCanal; aoClicar: () => void; recarregar: () => void }) {
  const nome = NOME_CANAL_LONGO[c.canal];
  const cabeca = (
    <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${SELO_CANAL[c.canal].ponto}`} />
      {nome}
    </span>
  );
  if (c.status !== "ok") {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-line bg-raised/40 p-3">
        {cabeca}
        <Chip tom="ausente">sem dado agora</Chip>
        {c.motivo && <span className="text-xs text-ink-muted">{c.motivo}</span>}
        {c.status === "erro" && <div><RetryButton onClick={recarregar} /></div>}
      </div>
    );
  }
  const aviso = avisoCanal(c);
  const f = fracao(c.ruptura, c.base);
  const falado = bloco
    ? `${bloco.n} AA/A${bloco.apoio || bloco.detalhe ? `, ${bloco.apoio ?? bloco.detalhe}` : ""}`
    : `${f?.texto ?? "—"} sem estoque`;
  return (
    <button
      type="button"
      onClick={aoClicar}
      title={[c.frescor, bloco?.detalhe].filter(Boolean).join(' · ')}
      aria-label={`Ver rupturas ${doCanal(c.canal, nome)}: ${falado}${aviso ? `. ${aviso}` : ""}`}
      className="card-hover group flex min-h-11 w-full flex-col gap-1 rounded-lg border border-line bg-raised/40 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {cabeca}
      {bloco ? (
        <span className="flex items-baseline gap-1">
          <span className={`text-2xl font-bold tabular-nums ${bloco.n > 0 ? "text-crit-ink" : "text-ink"}`}>{fmtInt(bloco.n)}</span>
          <span className="text-sm text-ink-muted">AA/A</span>
        </span>
      ) : (
        <span className="flex items-baseline gap-1">
          <span className="text-2xl font-bold tabular-nums text-ink">{f?.texto ?? "—"}</span>
          <span className="text-sm text-ink-muted">sem estoque</span>
        </span>
      )}
      {bloco?.apoio && (
        <span className={`flex items-center gap-1 text-xs ${bloco.poucaCobertura ? "text-ink-faint" : "text-ink-muted"}`}>
          {bloco.apoio}
          {bloco.poucaCobertura && (
            <InfoDica emControle texto={`A curva da planilha cobre poucos itens ${doCanal(c.canal, NOME_CANAL[c.canal])}: os demais não entram no ${fmtInt(bloco.n)}.`} />
          )}
        </span>
      )}
      {aviso && (
        <span className="flex items-center gap-1 text-xs text-warn-ink">
          <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-warn" />
          {aviso}
        </span>
      )}
    </button>
  );
}

/** Celula de impacto da fila: R$ potencial; Shopee com estoque do vendedor = "R$ 0" medido e explicado. */
function CelulaImpacto({ t }: { t: ItemRuptura }) {
  const c = celulaImpacto(t);
  if (c.ausente) return <Ausente motivo={c.ausente} />;
  return (
    <span className="flex flex-col items-end" title={c.titulo}>
      <span className={c.zeroMedido ? "text-ink-faint" : "text-ink"}>{c.texto}</span>
      {c.apoio && <span className="text-xs font-normal text-ink-muted max-w-36 lg:max-w-none lg:whitespace-nowrap">{c.apoio}</span>}
      {c.titulo && <span className="sr-only"> ({c.titulo})</span>}
    </span>
  );
}

/** Celula "Estoque" da fila: Full + onde esta' o resto; ausencia leva o motivo no title. */
function CelulaEstoque({ t, alinhar = "start" }: { t: ItemRuptura; alinhar?: "start" | "end" }) {
  const c = celulaEstoque(t);
  return (
    <span className={`flex flex-col ${alinhar === "end" ? "items-end" : "items-start"}`} title={c.ausente}>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-crit" />
        <span className="text-sm font-semibold text-crit-ink">{c.texto}</span>
        <span className="text-xs font-normal text-ink-muted">no Full</span>
      </span>
      {c.apoio && <span className="text-xs font-normal text-ink-muted">{c.apoio}</span>}
      {c.ausente && <span className="sr-only"> ({c.ausente})</span>}
    </span>
  );
}

/** Brindes/descontinuados sem estoque no Full: recolhido, sem R$, sem cor de alerta (nao e' perda de venda). */
function BlocosForaDaFila({ canais }: { canais: ResumoCanal[] }) {
  return (
    <>
      {blocosForaDaFila(canais).map((b) => (
        <MaisDetalhes key={b.situacao} titulo={b.titulo} resumo={RESUMO_BLOCO_FORA}>
          {b.aviso && <p className="-mt-1 text-xs text-ink-muted">{b.aviso}</p>}
          <ul className="-m-4 divide-y divide-line">
            {b.itens.map((t, i) => {
              const apoio = celulaEstoque(t);
              return (
                <li key={`${t.canal}-${i}`} className="flex flex-col gap-1 px-4 py-2.5 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <span className="min-w-0 line-clamp-2 text-ink" title={t.sku ? `${t.nome} · código ${t.sku}` : t.nome}>
                    {t.nome}{t.sku && <span className="sr-only"> (código {t.sku})</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <SeloCanal canal={t.canal} />
                    <span className="font-semibold uppercase tracking-wide">{tituloMarca(t.marca)}</span>
                    <span className="tabular-nums" title={apoio.ausente}>0 no Full{apoio.apoio && ` · ${apoio.apoio}`}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </MaisDetalhes>
      ))}
    </>
  );
}

/** Cabecalho de grupo da fila: o chip (AA/A) ou "Demais (B, C, sem curva)" + total + "ver todos". */
function CabecaGrupo({ g, total, aberto, alternar }: { g: GrupoCurva; total: number; aberto: boolean; alternar: () => void }) {
  return (
    <span className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-xs font-semibold text-ink-faint">
        {g === "demais" ? <span className="uppercase tracking-wide">Demais (B, C, sem curva)</span> : <ChipCurva curva={g} />}
      </span>
      {total > POR_GRUPO && (
        <button type="button" onClick={alternar} aria-expanded={aberto}
          className="inline-flex min-h-11 items-center text-xs font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {aberto ? "ver menos" : `ver todos (${fmtInt(total)})`}
        </button>
      )}
    </span>
  );
}


/**
 * CURVA-ABC: impacto potencial por curva no canal. % primeiro, com barra
 * proporcional (cor do canal); R$/dia depois; "sem curva" apagada (nao e' C);
 * total separado e sem barra. R$ nunca soma entre canais; ausencia fica "—".
 */
function DetalheCurva({ canal, impacto, abc }: { canal: Canal; impacto: ImpactoRuptura | null; abc: CurvaAbc | null }) {
  const t = impactoPorCurva(canal, impacto, abc);
  if (!t) return <p className="text-sm text-ink-muted">Curva ABC {abc?.status === "ok" ? "sem impacto potencial do canal agora" : "sem leitura agora"}.</p>;
  const linha = (l: (typeof t.linhas)[number]) => {
    const sem = l.curva === "sem";
    return (
      <tr key={l.curva} className={sem ? "text-ink-muted" : undefined}>
        <th scope="row" className="py-2.5 pr-1 text-left font-medium">
          {sem ? <span className="whitespace-nowrap text-xs text-ink-muted">Sem curva</span> : <ChipCurva curva={l.curva as Curva} />}
        </th>
        <td className="px-2 py-2.5">
          {l.pct === null ? (
            <Ausente motivo="sem impacto potencial medido" />
          ) : (
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-raised">
                <span className={`block h-full rounded-full ${SELO_CANAL[canal].ponto} ${sem ? "opacity-40" : ""}`} style={{ width: `${l.pct > 0 ? Math.max(l.pct * 100, 2) : 0}%` }} />
              </span>
              <span className={`w-12 shrink-0 text-right tabular-nums ${sem ? "" : "font-semibold text-ink"}`}>{fmtFatia(l.pct)}</span>
            </span>
          )}
        </td>
        <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">
          {l.perda === null ? <Ausente motivo="sem preço nas rupturas" /> : <Escondido texto={fmtReais(l.perda)} detalhe={l.vendedorCobre ? "vendedor tem estoque: a venda segue fora do Full" : null} />}
        </td>
        <td className="py-2.5 pl-2 text-right tabular-nums text-ink-muted">{fmtInt(l.rupturas)}</td>
      </tr>
    );
  };
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup><col className="w-[4.25rem]" /><col /><col className="w-[5.5rem]" /><col className="w-[4.5rem]" /></colgroup>
      <caption className="sr-only">Impacto potencial por curva ABC {noCanal(canal, NOME_CANAL[canal])}</caption>
      <thead className="text-xs font-medium text-ink-faint">
        <tr>
          <th scope="col" className="py-1 pr-2 text-left font-medium"><span className="sr-only">Curva</span></th>
          <th scope="col" className="px-2 py-1 text-left font-medium">Impacto</th>
          <th scope="col" className="px-2 py-1 text-right font-medium">R$/dia</th>
          <th scope="col" className="py-1 pl-2 text-right font-medium">Rupturas</th>
        </tr>
      </thead>
      <tbody>{t.linhas.map((l) => linha(l))}</tbody>
      <tfoot>
        <tr className="border-t-2 border-line-strong bg-raised font-semibold">
          <th scope="row" className="rounded-l-md py-2.5 pl-2 pr-2 text-left">Total</th>
          <td className="px-2 py-2.5" />
          <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums">{fmtReais(t.total.perda)}</td>
          <td className="rounded-r-md py-2.5 pl-2 pr-2 text-right tabular-nums">{fmtInt(t.total.rupturas)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function DetalheImpacto({ canal, impacto }: { canal: Canal; impacto: ImpactoRuptura | null }) {
  const linhas = impactoPorMarca(canal, impacto);
  return (
    <div className="flex flex-col gap-3 text-sm">
      {linhas === null ? (
        <p className="text-ink-muted">Impacto potencial indisponível agora.</p>
      ) : (
        <table className="w-full">
          <caption className="sr-only">Impacto potencial por marca {noCanal(canal, NOME_CANAL[canal])}, da maior perda para a menor</caption>
          <thead className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            <tr>
              <th scope="col" className="py-2 pr-2 text-left">Marca</th>
              <th scope="col" className="px-2 py-2 text-right">% do Full da marca</th>
              <th scope="col" className="py-2 pl-2 text-right">R$/dia potencial</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {linhas.map((l) => (
              <tr key={l.marca}>
                <th scope="row" className="py-2 pr-2 text-left font-medium text-ink">{tituloMarca(l.marca)}</th>
                <td className="px-2 py-2 text-right tabular-nums">{l.vendedorTemEstoque ? "—" : l.pct === null ? <Ausente motivo="faturamento Full de 28 dias incompleto" /> : fmtPct(l.pct)}</td>
                <td className="py-2 pl-2 text-right tabular-nums">
                  {l.vendedorTemEstoque ? <span className="text-xs text-ink-muted">vendedor tem estoque</span>
                    : l.perda === null ? <Ausente motivo="sem preço" /> : `${fmtReais(l.perda)}/dia`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="border-t border-line pt-3 text-xs leading-snug text-ink-muted">
        {dicaImpacto(canal, impacto)} {canal === "ml" ? NOTA_IMPACTO : NOTA_VENDEDOR}
      </p>
    </div>
  );
}

export default function VisaoGeralFull() {
  const [canais, setCanais] = useState<ResumoCanal[] | null>(null);
  // `null` = impacto nao carregou: a tela segue sem R$, nunca com R$ 0.
  const [impacto, setImpacto] = useState<ImpactoRuptura | null>(null);
  const [tentativa, setTentativa] = useState(0);
  // API-4: o "antes" chega DEPOIS do primeiro desenho (2a chamada, mais lenta).
  // `null` enquanto carrega ou se falhar: o card fica sem pilula, nunca "0".
  const [antes, setAntes] = useState<FotoAnterior | null>(null);
  // CURVA-ABC: `null` enquanto carrega; falha vira "unavailable" com motivo (sem curva, nunca "C").
  const [abc, setAbc] = useState<CurvaAbc | null>(null);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setCanais(null);
    setImpacto(null);
    setAntes(null);
    setAbc(null);
    fetchCurvaAbc(ctrl.signal)
      .then((r) => { if (!ctrl.signal.aborted) setAbc(r); })
      .catch(() => { if (!ctrl.signal.aborted) setAbc({ status: "unavailable", motivo: "a curva ABC não respondeu", fonte: "", duplicadas: [], curva_por_sku: {} }); });
    Promise.allSettled([
      fetchMLFullEstoque(QUERY_ML, ctrl.signal).then((r) => resumoML(validarPayloadML(r))),
      fetchEstoqueFull(QUERY_SHOPEE, ctrl.signal).then(resumoShopee),
      fetchImpactoRuptura(ctrl.signal),
    ]).then(([ml, shopee, imp]) => {
      if (ctrl.signal.aborted) return;
      setCanais([ml, shopee].map((r, i) =>
        r.status === "fulfilled" ? r.value : { canal: CANAIS[i], status: "erro" as const, motivo: motivoErro(r.reason) }));
      setImpacto(imp.status === "fulfilled" ? imp.value : null);
      if (imp.status === "fulfilled") void buscarAnterior(ctrl.signal).then((a) => { if (!ctrl.signal.aborted) setAntes(a); });
    });
    return () => ctrl.abort();
  }, [tentativa]);

  return (
    <PageContainer>
      <PageHeader title="Visão geral do Full" icon={Warehouse} />
      {canais === null ? (
        <StateBlock tipo="carregando" titulo="Carregando o estoque Full do ML e da Shopee" />
      ) : (
        <Conteudo canais={canais} impacto={impacto} antes={antes} abc={abc} recarregar={recarregar} />
      )}
    </PageContainer>
  );
}

/** API-4: a 2a chamada (impacto com a foto anterior) e os estoques NAQUELES dias. */
interface FotoAnterior {
  impacto: ImpactoRuptura;
  shopee: ResumoCanal | null;
  ml: ResumoCanal | null;
}

/**
 * Busca o "antes" depois do primeiro desenho. O estoque da Shopee na foto
 * anterior alimenta o "Param a venda"; o do ML so' e' buscado com os DOIS
 * canais com foto anterior (o heroi so' compara o total dos dois). Falha =
 * `null`: sem pilula.
 */
async function buscarAnterior(signal: AbortSignal): Promise<FotoAnterior | null> {
  const impacto = await fetchImpactoRuptura(signal, true).catch(() => null);
  if (!impacto) return null;
  const ant = (c: ImpactoRuptura["ml"]) => (c.status === "ok" ? c.anterior ?? null : null);
  const sh = ant(impacto.shopee), ml = ant(impacto.ml);
  const [shopee, mlResumo] = await Promise.all([
    sh ? fetchEstoqueFull(`${QUERY_SHOPEE}&ref_date=${sh.ref_date}`, signal).then(resumoShopee).catch(() => null) : null,
    sh && ml ? fetchMLFullEstoque(`${QUERY_ML}&ref_date=${ml.ref_date}`, signal).then((r) => resumoML(validarPayloadML(r))).catch(() => null) : null,
  ]);
  return { impacto, shopee, ml: mlResumo };
}

/** Pilula + "antes X% · foto de dd/mm". Risco subindo e' ruim: lower_is_better, em p.p. */
function Pilula({ a }: { a: Antes | null }) {
  return a ? <DeltaBadge pct={a.pp} tone="lower_is_better" unidade="pp" /> : null;
}

const OPCOES_FILTRO: { valor: FiltroCurva; texto: string }[] = [
  { valor: "todas", texto: "Todas" }, { valor: "aa_a", texto: "AA/A" }, { valor: "b", texto: "B" },
  { valor: "c", texto: "C" }, { valor: "sem", texto: "Sem curva" },
];

function Conteudo({ canais, impacto, antes, abc, recarregar }: { canais: ResumoCanal[]; impacto: ImpactoRuptura | null; antes: FotoAnterior | null; abc: CurvaAbc | null; recarregar: () => void }) {
  // Um so' dialogo na pagina para os drilldowns (identidade Gerencial).
  const [drill, setDrill] = useState<Canal | "curva" | null>(null);
  // FULL-CARINHO: filtros da fila na URL (?canal=ml&curva=aa_a): compartilhar e o "voltar" funcionam.
  const busca = useSearchParams();
  const router = useRouter();
  const caminho = usePathname();
  const url = lerFiltrosUrl(busca);
  const aplicar = (canal: FiltroCanal, curva: FiltroCurva, rolar = false) => {
    router.push(`${caminho}${filtrosNaUrl(busca.toString(), canal, curva)}`, { scroll: false });
    if (rolar) document.getElementById("fila-full")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [abertos, setAbertos] = useState<ReadonlySet<GrupoCurva>>(new Set());
  const alternarGrupo = (g: GrupoCurva) => setAbertos((a) => { const n = new Set(a); if (n.has(g)) n.delete(g); else n.add(g); return n; });
  const ok = oks(canais);
  const heroi = heroiRuptura(canais);
  const aHeroi = antesHeroi(canais, antes);
  const curvaH = heroiCurva(canais, impacto, abc);
  // Sem pilula depois da 2a chamada: o motivo vai para title + sr-only (sem texto na tela).
  const motivoHeroi = antes && !aHeroi
    ? semComparacao("ml", antes.impacto) ?? semComparacao("shopee", antes.impacto) ?? "sem comparação: falta a foto anterior de um dos canais"
    : null;
  const shopee = canais.find((c) => c.canal === "shopee");
  const semVendedor = shopee?.status === "ok" ? shopee.semVendedor : null;
  const tot = total(canais);
  const marcas = rupturaPorMarca(canais, impacto);
  const pior = marcas[0]?.maiorPerda || marcas[0]?.taxa ? marcas[0] : null;
  const comCurva = abc?.status === "ok";
  // Com a leitura em falha o filtro some e a lista fica como antes.
  const filtroAtivo: FiltroCurva = comCurva ? url.curva : "todas";
  const filtroCanal = url.canal;
  const ranking = rankingRupturas(canais, impacto, abc);
  // Canal x curva combinados: cada contagem reflete o OUTRO filtro aplicado.
  const doCanalEscolhido = filtrarCanal(ranking, filtroCanal);
  const contagem = contarFiltros(doCanalEscolhido, abc);
  const contagemCanal = contarCanais(ranking, abc, filtroAtivo);
  // Cabecalho de grupo (AA, A, Demais) so' com a curva "Todas"; a contagem e' do ranking (no canal).
  const grupos = comCurva && filtroAtivo === "todas" ? contarGrupos(doCanalEscolhido, abc) : null;
  // "Todas" com curva: ate' 5 por grupo, os 3 grupos sempre visiveis; senao, o top 10 do filtro.
  const lista = grupos
    ? filaPorGrupo(doCanalEscolhido, abc, abertos).flatMap((g) => g.itens)
    : doCanalEscolhido.filter((t) => passaFiltro(curvaDe(t, abc), filtroAtivo)).slice(0, 10);
  const comFiltro = filtroCanal !== "todos" || filtroAtivo !== "todas";
  // No celular cada filtro rola na propria trilha: a opcao escolhida tem de ficar a' vista.
  useEffect(() => {
    document.querySelectorAll<HTMLElement>("[data-trilha]").forEach((t) => {
      const a = t.querySelector<HTMLElement>('[aria-checked="true"]');
      if (a) t.scrollLeft = Math.max(0, a.offsetLeft - (t.clientWidth - a.offsetWidth) / 2);
    });
  }, [filtroCanal, filtroAtivo]);
  const comImpacto = impactosOk(impacto).length > 0;
  const colunas = colunasMarca(canais, marcas);
  const algumaIncompleta = ok.some((c) => !c.rupturasCompletas);
  const falhou = canais.some((c) => c.status === "erro");

  if (!ok.length || !heroi) {
    return (
      <StateBlock
        tipo={falhou ? "erro" : "indisponivel"}
        titulo="Estoque Full sem dado agora"
        descricao={canais.map((c) => `${NOME_CANAL[c.canal]}: ${c.status === "ok" ? "" : c.motivo}`).join(" · ")}
        acao={falhou ? <RetryButton onClick={recarregar} /> : undefined}
      />
    );
  }

  return (
    <>
      {/* 1. Heroi: quantos produtos-chave (AA/A) estao sem estoque; uma linha por canal com a foto */}
      <Heroi
        rotulo="Produtos-chave (AA/A) sem estoque no Full"
        ajuda={<InfoDica texto={DICA_RUPTURA} nota={[curvaH?.parcial ? DICA_HEROI_PARCIAL : null, fotosHeroi(canais), NOTA_VENDEDOR].filter(Boolean).join(" ")} />}
        valor={curvaH ? <Escondido texto={curvaH.valor} detalhe={curvaH.titulo} /> : "—"}
        tom={curvaH?.critico ? "critico" : "neutro"}
        contexto={curvaH?.contexto ? <Escondido texto={curvaH.contexto} detalhe={curvaH.titulo} /> : undefined}
        acao={comCurva && (
          <button type="button" onClick={() => setDrill("curva")} aria-haspopup="dialog"
            className="inline-flex min-h-11 items-center text-xs font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
            Ver por curva →
          </button>
        )}
        meio={
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {canais.map((c) => (
              <BlocoCanalHeroi
                key={c.canal}
                c={c}
                bloco={curvaH?.blocos[c.canal]}
                recarregar={recarregar}
                aoClicar={() => {
                  const f = curvaH?.blocos[c.canal] ? filtroDoBloco(c.canal) : { canal: c.canal as FiltroCanal, curva: "todas" as FiltroCurva };
                  aplicar(f.canal, f.curva, true);
                }}
              />
            ))}
          </div>
        }
      />

      {/* 2. Faixa de KPIs: quanto custa (por canal, R$ nunca somado) e quem para a venda */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          variante="gerencial"
          identidade="pedidos"
          icone={Boxes}
          rotulo="Sem estoque com demanda"
          ajuda={<InfoDica texto={DICA_RUPTURA} nota={NOTA_VENDEDOR} />}
          valor={<Escondido texto={heroi.valor} detalhe={["do sortimento no Full", heroi.detalhe].filter(Boolean).join(" · ")} />}
          tom={heroi.critico ? "critico" : "neutro"}
          comparacao={motivoHeroi ? <Escondido texto={motivoHeroi} detalhe={heroi.detalhe} /> : undefined}
          delta={aHeroi && <Pilula a={aHeroi} />}
          antes={aHeroi?.texto}
        />
        {CANAIS.map((canal) => {
          const k = kpiImpacto(canal, impacto, canal === "shopee" ? semVendedor : null);
          const a = antesImpacto(canal, impacto, antes?.impacto ?? null);
          const motivo = antes && !a ? semComparacao(canal, antes.impacto) : null;
          return (
            <div key={canal} className="relative h-full">
              <KpiTile
                variante="gerencial"
                identidade="gmv"
                icone={TrendingDown}
                rotulo={`Impacto potencial · ${NOME_CANAL[canal]}`}
                ajuda={<InfoDica emControle texto={dicaImpacto(canal, impacto)} />}
                valor={k.valor}
                comparacao={<Escondido texto={k.comparacao} detalhe={[k.detalhe, motivo].filter(Boolean).join(" · ") || null} />}
                delta={a && <Pilula a={a} />}
                antes={a?.texto}
                onAbrir={() => aplicar(canal, "todas", true)}
                folgaRodape
                acaoFalada={`ver as rupturas ${doCanal(canal, NOME_CANAL_LONGO[canal])} na fila`}
              />
            </div>
          );
        })}
        {(() => {
          const k = kpiParamVenda(shopee);
          const a = antesParamVenda(shopee, antes?.shopee ?? null);
          const motivo = antes && !a
            ? semComparacao("shopee", antes.impacto) ?? (antes.shopee?.status === "ok" ? null : "sem comparação: sem o estoque da Shopee na foto anterior")
            : null;
          return (
            <KpiTile
              variante="gerencial"
              identidade="pedidos"
              icone={PackageX}
              rotulo="Param a venda · Shopee"
              ajuda={<InfoDica texto={NOTA_VENDEDOR} />}
              valor={<Escondido texto={k.valor} detalhe={k.detalhe} />}
              comparacao={<Escondido texto={k.comparacao} detalhe={motivo} />}
              delta={a && <Pilula a={a} />}
              antes={a?.texto}
            />
          );
        })()}
      </div>
      <KpiDrilldownDialog
        open={drill !== null}
        onClose={() => setDrill(null)}
        title={drill === "curva" ? "Impacto potencial por curva ABC" : `Impacto potencial · ${drill ? NOME_CANAL[drill] : ""}`}
      >
        {drill === "curva" ? (
          <div className="flex flex-col gap-4">
            {/* A metodologia (fonte, hora, cobertura, "sem curva") vive no ⓘ, nao em rodape de 4 frases. */}
            {abc?.status === "ok" && <div className="-mb-2 flex justify-end"><InfoDica texto={dicaCurva(abc, impacto)} /></div>}
            {CANAIS.map((c) => (
              <section key={c} className="flex flex-col gap-2">
                <h3 className="m-0"><SeloCanal canal={c} /></h3>
                <DetalheCurva canal={c} impacto={impacto} abc={abc} />
              </section>
            ))}
          </div>
        ) : drill && (
          <div className="flex flex-col gap-4">
            {comCurva && <DetalheCurva canal={drill} impacto={impacto} abc={abc} />}
            <DetalheImpacto canal={drill} impacto={impacto} />
          </div>
        )}
      </KpiDrilldownDialog>

      {/* 3. O que exige atencao agora: 2 colunas (marca, canal e venda na linha 2 do produto) */}
      <div id="fila-full" className="scroll-mt-20" />
      <Panel
        titulo="O que exige atenção agora"
        descricao={descricaoTop(lista, comImpacto, algumaIncompleta, comCurva)}
        acao={
          <span className="flex flex-wrap gap-3 text-sm">
            {ok.map((c) => (
              <Link key={c.canal} href={hrefAba(c.canal === "ml" ? "estoque-ml" : "estoque-shopee")} className="inline-flex min-h-11 items-center font-medium text-accent hover:underline">
                Estoque {NOME_CANAL[c.canal]} →
              </Link>
            ))}
          </span>
        }
        semPadding
      >
        <div className="flex flex-col gap-2 px-3 pb-2 sm:px-4 lg:flex-row lg:flex-wrap lg:items-center">
          <div data-trilha className="flex min-w-0 items-center gap-2 overflow-x-auto">
            <Segmented
              rotulo="Filtrar por canal"
              opcoes={(["todos", ...CANAIS] as FiltroCanal[]).map((c) => ({
                valor: c,
                texto: `${c === "todos" ? "Todos" : NOME_CANAL_LONGO[c]} · ${fmtInt(contagemCanal[c])}`,
                icone: c === "todos" ? undefined : <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${SELO_CANAL[c].ponto}`} />,
              }))}
              valor={filtroCanal}
              aoEscolher={(c) => aplicar(c, filtroAtivo)}
              className="shrink-0 whitespace-nowrap"
            />
          </div>
          {comCurva && (
            <div data-trilha className="flex min-w-0 items-center gap-2 overflow-x-auto">
              <Segmented
                rotulo="Filtrar por curva ABC"
                opcoes={OPCOES_FILTRO.map((o) => ({ valor: o.valor, texto: `${o.texto} · ${fmtInt(contagem[o.valor])}` }))}
                valor={filtroAtivo}
                aoEscolher={(cv) => aplicar(filtroCanal, cv)}
                className="shrink-0 whitespace-nowrap"
              />
              <InfoDica texto={DICA_ORDEM_FILA} nota={dicaCurva(abc, impacto)} className="shrink-0" />
            </div>
          )}
          {comFiltro && (
            <button type="button" onClick={() => aplicar("todos", "todas")}
              className="inline-flex min-h-11 items-center self-start text-xs font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent lg:self-auto">
              Limpar filtros
            </button>
          )}
        </div>
        {lista.length === 0 ? (
          <StateBlock tipo="vazio" titulo={comFiltro ? "Nenhuma ruptura com estes filtros" : "Nenhuma ruptura no Full"} compacto />
        ) : (
          <>
            {/* lg+: tabela com colunas alinhadas */}
            <table className="hidden w-full table-fixed text-sm lg:table">
              <caption className="sr-only">Rupturas no Full, produtos-chave primeiro e depois pelo impacto potencial em R$ por dia</caption>
              <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
                <tr>
                  <th scope="col" className="w-24 px-2 py-2 text-center">Curva</th>
                  <th scope="col" className="px-3 py-2 text-left">Produto</th>
                  <th scope="col" className="w-36 px-3 py-2 text-left">Canal</th>
                  <th scope="col" className="w-24 px-3 py-2 text-right">Venda/dia</th>
                  <th scope="col" className="w-56 px-3 py-2 text-left">Estoque</th>
                  <th scope="col" className="w-60 whitespace-nowrap px-4 py-2 text-right">
                    <span className="inline-flex items-center justify-end gap-1">Impacto potencial/dia <InfoDica texto={DICA_IMPACTO_FILA} /></span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {lista.map((t, i) => {
                  const cv = curvaDe(t, abc);
                  const g = grupoDe(cv);
                  const abreGrupo = grupos && (i === 0 || grupoDe(curvaDe(lista[i - 1], abc)) !== g);
                  return (
                    <Fragment key={`${t.canal}-${i}`}>
                      {abreGrupo && (
                        <tr className="bg-raised">
                          <th scope="colgroup" colSpan={6} className="px-4 py-0.5 text-left font-normal">
                            <CabecaGrupo g={g} total={grupos[g]} aberto={abertos.has(g)} alternar={() => alternarGrupo(g)} />
                          </th>
                        </tr>
                      )}
                      <tr className="hover:bg-raised/60">
                        <td className="whitespace-nowrap px-2 py-3 text-center align-top">{comCurva && <ChipCurva curva={cv} />}</td>
                        <th scope="row" className="px-3 py-3 text-left align-top font-normal">
                          <span className="line-clamp-2 text-sm font-medium text-ink" title={t.sku ? `${t.nome} · código ${t.sku}` : t.nome}>
                            {t.nome}{t.sku && <span className="sr-only"> (código {t.sku})</span>}
                          </span>
                          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">{tituloMarca(t.marca)}</span>
                        </th>
                        <td className="px-3 py-3 align-top"><SeloCanal canal={t.canal} /></td>
                        <td className="px-3 py-3 text-right align-top tabular-nums text-ink-muted">{fmtDecimal(t.mediaDiaria)}</td>
                        <td className="px-3 py-3 align-top tabular-nums"><CelulaEstoque t={t} /></td>
                        <td className="px-4 py-3 text-right align-top text-sm font-semibold tabular-nums"><CelulaImpacto t={t} /></td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {/* abaixo de lg: cartao de 2 linhas, sem rolagem lateral */}
            <ul className="divide-y divide-line lg:hidden">
              {lista.map((t, i) => {
                const cv = curvaDe(t, abc);
                const g = grupoDe(cv);
                const abreGrupo = grupos && (i === 0 || grupoDe(curvaDe(lista[i - 1], abc)) !== g);
                return (
                  <Fragment key={`${t.canal}-${i}`}>
                    {abreGrupo && (
                      <li className="bg-raised px-3 py-0.5">
                        <CabecaGrupo g={g} total={grupos[g]} aberto={abertos.has(g)} alternar={() => alternarGrupo(g)} />
                      </li>
                    )}
                    <li className="flex flex-col gap-1.5 px-3 py-3">
                      <span className="flex items-start justify-between gap-3">
                        <span className="flex min-w-0 items-start gap-1.5">
                          {comCurva && <ChipCurva curva={cv} className="mt-0.5" />}
                          <span className="line-clamp-2 text-sm font-medium text-ink" title={t.sku ? `${t.nome} · código ${t.sku}` : t.nome}>
                            {t.nome}{t.sku && <span className="sr-only"> (código {t.sku})</span>}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-sm font-semibold tabular-nums"><CelulaImpacto t={t} /></span>
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                        <SeloCanal canal={t.canal} />
                        <span className="font-semibold uppercase tracking-wide">{tituloMarca(t.marca)}</span>
                        <span className="tabular-nums">{fmtDecimal(t.mediaDiaria)}/dia</span>
                      </span>
                      <CelulaEstoque t={t} />
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          </>
        )}
      </Panel>

      {/* 4. Onde: ruptura por marca, so' os canais medidos (sem coluna Total: vai no title da marca) */}
      <Panel
        titulo="Ruptura por marca"
        acao={marcas.some((l) => l.maiorPerda !== null) ? <InfoDica texto="Ordenado do maior impacto potencial por dia para o menor. R$ não é somado entre canais." /> : undefined}
        semPadding
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Percentual sem estoque e impacto potencial por marca e canal</caption>
          <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
            <tr>
              <th scope="col" className="px-3 py-2 sm:px-4 text-left">Marca</th>
              {colunas.map((c) => <th key={c} scope="col" className="px-3 py-2 sm:px-4 text-right">{NOME_CANAL[c]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {marcas.map((l) => {
              const ehPior = l === pior;
              const ft = colunas.length > 1 && colunas.every((c) => l.celulas[c]?.ruptura != null) ? fracao(l.ruptura, l.base) : null;
              return (
                <tr key={l.marca} className={ehPior ? "bg-crit-soft" : undefined} title={ehPior ? (l.maiorPerda !== null ? "Maior impacto" : "Pior taxa") : undefined}>
                  <th scope="row" className="px-3 py-2 sm:px-4 text-left font-medium text-ink">
                    <Escondido texto={tituloMarca(l.marca)} detalhe={ft ? `Total: ${ft.texto} (${ft.detalhe})` : null} />
                    {/* A linha vermelha nao pode ser o unico sinal: leitor de tela ouve "pior". */}
                    {ehPior && <span className="sr-only"> ({l.maiorPerda !== null ? "maior impacto" : "pior"})</span>}
                  </th>
                  {colunas.map((canal) => {
                    const cel: MarcaCanal | undefined = l.celulas[canal];
                    return (
                      <td key={canal} className="px-3 py-2 sm:px-4 text-right tabular-nums">
                        {cel ? <Fracao parte={cel.ruptura} base={cel.base} motivo={cel.motivo} /> : <Ausente motivo="marca fora deste canal" />}
                        {cel && l.impacto[canal] && <ImpactoMarca canal={canal} m={l.impacto[canal]!} vendedorTemEstoque={canal === "shopee" && l.vendedorTemEstoque} />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      {/* 4b. Brindes e descontinuados: fora da fila e dos numeros, recolhidos */}
      <BlocosForaDaFila canais={canais} />

      {/* 5. Mais detalhes (fechado): o denominador continua visivel em "Itens no Full" */}
      <MaisDetalhes>
        <div className="-m-4">
        <table className="w-full text-sm">
          <caption className="sr-only">Outros indicadores do estoque Full por canal</caption>
          <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
            <tr>
              <th scope="col" className="px-3 py-2 sm:px-4 text-left">Indicador</th>
              <th scope="col" className="px-3 py-2 sm:px-4 text-right">ML</th>
              <th scope="col" className="px-3 py-2 sm:px-4 text-right">Shopee</th>
              <th scope="col" className="px-3 py-2 sm:px-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {([
              ["Estoque baixo", "baixo"],
              ["Excesso", "excesso"],
            ] as const).map(([rotulo, k]) => (
              <tr key={k}>
                <th scope="row" className="px-3 py-2 sm:px-4 text-left font-medium text-ink">{rotulo}</th>
                {[...canais.map((c) => (c.status === "ok" ? c : null)), tot].map((d, i) => (
                  <td key={i} className="px-3 py-2 sm:px-4 text-right tabular-nums">
                    {d ? <Fracao parte={d[k]} base={d.base} /> : <Ausente motivo={i < 2 ? (canais[i] as { motivo?: string }).motivo : "falta um canal"} />}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="px-3 py-2 sm:px-4 text-left font-medium text-ink">
                <span className="inline-flex items-center gap-1.5">Itens no Full <InfoDica texto="ML: inventários Full lidos. Shopee: itens sem os kits não conciliados." /></span>
              </th>
              {[...canais.map((c) => (c.status === "ok" ? c : null)), tot].map((d, i) => (
                <td key={i} className="px-3 py-2 sm:px-4 text-right tabular-nums">{d ? fmtInt(d.base) : <Ausente />}</td>
              ))}
            </tr>
            <tr>
              <th scope="row" className="px-3 py-2 sm:px-4 text-left font-medium text-ink">
                <span className="inline-flex items-center gap-1.5">Cobertura mediana <InfoDica texto={DICA_COBERTURA} /></span>
              </th>
              {[...canais.map((c) => (c.status === "ok" ? c : null)), tot].map((d, i) => {
                const v = d ? mediana(d.coberturas) : null;
                return (
                  <td key={i} className="px-3 py-2 sm:px-4 text-right tabular-nums">
                    {v === null ? <Ausente motivo={d && !d.coberturas ? "a API devolveu a lista truncada" : undefined} /> : `${fmtDecimal(v)} dias`}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
        </div>
      </MaisDetalhes>
    </>
  );
}
