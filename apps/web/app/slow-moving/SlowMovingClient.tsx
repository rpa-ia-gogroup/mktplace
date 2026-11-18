"use client";

/**
 * SLOW-MOVING — sub-aba "Slow Moving" do /full (paridade com o dash Mix Marketplace da Nath).
 *
 * Lista, estoque, custo e cobertura: Supply Intelligence (regra do Painel S&OE:
 * curva B/C, descontinuado ou brinde com mais de 120 dias no Marketplace).
 * Venda diaria por canal (ML, Shopee, TikTok; Full ou normal): pedidos dos
 * marketplaces com kit aberto em pecas, a mesma conta do dash da Nath.
 *
 * Tela enxuta: 4 cartoes que abrem o detalhe (dialogo padrao), uma tabela, e o
 * clique no produto abre a ficha dele. Grafico e quebras ficam nos dialogos.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleDollarSign, Snowflake, Timer, TrendingUp, type LucideIcon } from "lucide-react";

import Aba from "@/components/layout/Aba";
import BrandFilter from "@/components/BrandFilter";
import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import InfoDica from "@/components/ui/InfoDica";
import KpiCardSkeleton from "@/components/ui/KpiCardSkeleton";
import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
import Segmented from "@/components/ui/Segmented";
import SortHeader from "@/components/ui/SortHeader";
import Sparkline from "@/components/ui/Sparkline";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import TableScrollHint from "@/components/TableScrollHint";
import { brandLabel } from "@/lib/filters/brands";
import { fmtBrlCurto, fmtPctBr } from "@/lib/formatters";
import {
  COLUNAS_EXPORT, MARKETPLACES, ROTULO_CANAL, ROTULO_ENVIO, faturamento15d, fetchSlowMoving, filtrar, linhaExport,
  mediaMovel7, passaTendencia, vendeNoCanal, pecas15dPorMarketplace, porMarca, ritmo, seriesPorMarketplace, serieDo,
  tendenciaDaLista, totais,
  type FiltroCanal, type FiltroEnvio, type FiltroTendencia, type Marketplace, type SkuSlowMoving, type SlowMovingResponse,
} from "@/lib/full-slow-moving";
import { buildProdutosCsvFile } from "@/lib/produtos-export";
import { useSortableTable, type SortColumnType } from "@/lib/use-sortable-table";

const Grafico = dynamic(() => import("./SlowMovingGrafico"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-raised motion-reduce:animate-none" />,
});

const MARCAS = ["apice", "barbours", "kokeshi", "lescent", "rituaria"];
const int = (n: number) => Math.round(n).toLocaleString("pt-BR");
const dec = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const dias = (n: number | null) => (n == null ? "sem venda" : `${int(n)} d`);
const ROTULO_MKT: Record<Marketplace, string> = { ML: "Mercado Livre", SP: "Shopee", TT: "TikTok Shop" };

function Tendencia({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-faint">—</span>;
  const tom = v > 0.5 ? "text-ok-ink" : v < -0.5 ? "text-crit-ink" : "text-ink-muted";
  return <span className={tom}>{v > 0.5 ? "▲ " : v < -0.5 ? "▼ " : ""}{fmtPctBr(v)}</span>;
}

/** Numero com rotulo, para a grade dos dialogos. */
function Metrica({ rotulo, valor, sub }: { rotulo: string; valor: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-raised/40 p-3">
      <div className="text-xs text-ink-muted">{rotulo}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{valor}</div>
      {sub && <div className="text-xs text-ink-muted">{sub}</div>}
    </div>
  );
}

const CANAIS: { valor: FiltroCanal; texto: string }[] = (["todos", "ML", "SP", "TT"] as const).map((v) => ({ valor: v, texto: ROTULO_CANAL[v] }));
const ENVIOS: { valor: FiltroEnvio; texto: string }[] = (["todos", "F", "N"] as const).map((v) => ({ valor: v, texto: ROTULO_ENVIO[v] }));
const TENDENCIAS: { valor: FiltroTendencia; texto: string }[] = [
  { valor: "todos", texto: "Todos" }, { valor: "melhorando", texto: "▲ Melhorando" }, { valor: "piorando", texto: "▼ Piorando" },
];
const COLUNAS: Record<string, SortColumnType> = {
  produto: "text", estoque: "numeric", valor: "numeric", venda: "numeric", tendencia: "numeric", cobertura: "numeric",
};

type Dialogo =
  | { tipo: "skus" | "capital" | "cobertura" | "venda" }
  | { tipo: "produto"; sku: SkuSlowMoving };

const CARTOES: Record<"skus" | "capital" | "cobertura" | "venda", { titulo: string; icone: LucideIcon; identidade: IdentidadeKpi }> = {
  skus: { titulo: "SKUs parados por marca", icone: Snowflake, identidade: "ads" },
  capital: { titulo: "Onde está o capital parado", icone: CircleDollarSign, identidade: "gmv" },
  cobertura: { titulo: "Cobertura dos SKUs parados", icone: Timer, identidade: "prazo" },
  venda: { titulo: "Venda diária dos SKUs parados", icone: TrendingUp, identidade: "pedidos" },
};

/** Faixas de cobertura do dialogo de cobertura. */
const FAIXAS: { rotulo: string; passa: (s: SkuSlowMoving) => boolean }[] = [
  { rotulo: "120 a 180 dias", passa: (s) => s.cobertura_dias != null && s.cobertura_dias < 180 },
  { rotulo: "180 a 365 dias", passa: (s) => s.cobertura_dias != null && s.cobertura_dias >= 180 && s.cobertura_dias < 365 },
  { rotulo: "Mais de 1 ano", passa: (s) => s.cobertura_dias != null && s.cobertura_dias >= 365 },
  { rotulo: "Sem venda", passa: (s) => s.cobertura_dias == null },
];

export default function SlowMovingClient() {
  const [dados, setDados] = useState<SlowMovingResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [canal, setCanal] = useState<FiltroCanal>("todos");
  const [envio, setEnvio] = useState<FiltroEnvio>("todos");
  const [tendencia, setTendencia] = useState<FiltroTendencia>("todos");
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const carregar = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setCarregando(true);
    setErro(null);
    try {
      setDados(await fetchSlowMoving(ctrl.signal));
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setDados(null);
      setErro(e instanceof Error ? e.message : "Falha inesperada ao carregar o slow moving.");
    } finally {
      if (!ctrl.signal.aborted) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
    return () => abortRef.current?.abort();
  }, [carregar]);

  const meta = dados?.meta_dias ?? 120;
  const n = dados?.dias.length ?? 0;
  const comVendas = !!dados?.vendas_disponivel && n >= 30;
  const daMarca = useMemo(() => filtrar(dados?.skus ?? [], marcas, ""), [dados, marcas]);
  // Canal e envio recortam a lista (so' quem vendeu ali em 60 dias) e a venda/tendencia/serie de cada SKU.
  const recortado = comVendas && (canal !== "todos" || envio !== "todos");
  const lista = useMemo(
    () => filtrar(daMarca, [], busca).filter((s) => !comVendas || (vendeNoCanal(s, n, canal, envio) && passaTendencia(s, n, tendencia, canal, envio))),
    [daMarca, busca, tendencia, comVendas, n, canal, envio],
  );
  const vendaDia = useCallback((s: SkuSlowMoving) => (recortado ? ritmo(s, n, canal, envio).m15 : s.venda_dia), [recortado, n, canal, envio]);
  const t = totais(daMarca, meta);
  // Com canal/envio escolhido, a venda/dia do topo e' a daquele recorte (pedidos dos canais), nao a do Supply.
  const vendaDiaTopo = recortado ? daMarca.reduce((a, s) => a + ritmo(s, n, canal, envio).m15, 0) : t.vendaDia;
  const valorDe = useCallback((s: SkuSlowMoving, c: string) => {
    if (c === "produto") return s.descricao;
    if (c === "valor") return s.valor_parado;
    if (c === "venda") return vendaDia(s);
    if (c === "tendencia") return ritmo(s, n, canal, envio).tendencia;
    if (c === "cobertura") return s.cobertura_dias ?? Number.POSITIVE_INFINITY;
    return s.estoque;
  }, [n, canal, envio, vendaDia]);
  const { sort, toggleSort, sortedRows } = useSortableTable(lista, valorDe, COLUNAS);

  /** Pontos do grafico: uma barra por marketplace dentro do filtro + media de 7 dias. */
  const pontosDe = useCallback((skus: readonly SkuSlowMoving[]) => {
    if (!dados || !comVendas) return [];
    const s = seriesPorMarketplace(skus, n, canal, envio);
    const m7 = mediaMovel7(s.ML.map((v, i) => v + s.SP[i] + s.TT[i]));
    return dados.dias.map((dia, i) => ({ dia, ML: s.ML[i], SP: s.SP[i], TT: s.TT[i], media7: m7[i] }));
  }, [dados, comVendas, n, canal, envio]);
  const canaisGrafico: Marketplace[] = canal === "todos" ? MARKETPLACES : [canal];
  const recorte = `${ROTULO_CANAL[canal]}${envio === "todos" ? "" : ` · ${ROTULO_ENVIO[envio]}`}`;

  const exportar = () => {
    const linhas = sortedRows.map((s) => linhaExport(s, n, meta, brandLabel(s.marca)));
    const blob = new Blob([buildProdutosCsvFile(COLUNAS_EXPORT, linhas)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `slow_moving_marketplace_${marcas.length === 1 ? marcas[0] : "consolidado"}_${dados?.atualizado_em ?? ""}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const filtrosUI = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 w-full">
      <BrandFilter
        variante="menu"
        rotulo="Marca"
        opcoes={MARCAS.map((m) => ({ value: m, label: brandLabel(m) }))}
        value={marcas}
        onChange={setMarcas}
      />
      {comVendas && <Segmented rotulo="Canal das vendas" opcoes={CANAIS} valor={canal} aoEscolher={setCanal} />}
      {comVendas && <Segmented rotulo="Envio" opcoes={ENVIOS} valor={envio} aoEscolher={setEnvio} />}
      <label className="flex w-full items-center gap-2 text-sm text-ink-muted sm:w-auto">
        <span className="sr-only">Buscar por nome do produto ou SKU</span>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou SKU"
          className="rounded-lg border border-line bg-surface text-ink placeholder:text-ink-faint min-h-11 px-3 text-sm w-full sm:w-64 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </label>
    </div>
  );

  const abrirProduto = (s: SkuSlowMoving) => setDialogo({ tipo: "produto", sku: s });
  const grafico = (skus: readonly SkuSlowMoving[]) => (
    <div className="h-56 w-full">
      <Grafico pontos={pontosDe(skus)} canais={canaisGrafico} />
    </div>
  );

  return (
    <Aba
      titulo="Slow Moving"
      // O Supply publica so' o dia da fotografia (sem hora): o selo de horario mentiria.
      selo={dados?.atualizado_em ? <span className="text-xs text-ink-muted" title={dados.fonte}>Fotografia do Supply · {dataBr(dados.atualizado_em)}</span> : undefined}
      filtros={filtrosUI}
    >
      {carregando && (
        <div role="status" aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <span className="sr-only">Carregando slow moving…</span>
          {Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} anunciar={false} />)}
        </div>
      )}

      {!carregando && erro && (
        <StateBlock tipo="erro" titulo="Não foi possível carregar o slow moving" descricao={erro} acao={<RetryButton onClick={carregar} />} />
      )}

      {!carregando && !erro && dados && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiTile variante="gerencial" identidade="ads" icone={Snowflake} rotulo="SKUs parados"
              ajuda={<InfoDica emControle texto={`Regra do Supply (Painel S&OE): curva B/C, descontinuado ou brinde com mais de ${meta} dias de estoque no Marketplace.`} />}
              valor={int(t.skus)} comparacao={`${int(t.estoque)} peças no Marketplace`}
              onAbrir={() => setDialogo({ tipo: "skus" })} />
            <KpiTile variante="gerencial" identidade="gmv" icone={CircleDollarSign} rotulo="Capital parado"
              ajuda={<InfoDica emControle texto="Estoque do Marketplace a preço de custo." />}
              valor={fmtBrlCurto(t.valor)} comparacao="a preço de custo"
              onAbrir={() => setDialogo({ tipo: "capital" })} />
            <KpiTile variante="gerencial" identidade="prazo" icone={Timer} rotulo="Cobertura"
              ajuda={<InfoDica emControle texto="Σ estoque ÷ Σ venda média por dia dos últimos 15 dias, no Marketplace." />}
              valor={dias(t.cobertura)} comparacao={`Meta: abaixo de ${meta} d`}
              onAbrir={() => setDialogo({ tipo: "cobertura" })} />
            <KpiTile variante="gerencial" identidade="pedidos" icone={TrendingUp} rotulo="Venda média/dia (15d)"
              ajuda={<InfoDica emControle texto="Peças por dia nos últimos 15 dias, avulso + dentro de kits, todos os canais do Marketplace." />}
              valor={`${int(vendaDiaTopo)} pç`}
              comparacao={comVendas ? <span><Tendencia v={tendenciaDaLista(daMarca, n, canal, envio)} /> vs 15 dias antes</span> : undefined}
              onAbrir={() => setDialogo({ tipo: "venda" })} />
          </div>

          {daMarca.length === 0 ? (
            <StateBlock tipo="vazio" titulo="Nenhum SKU parado" descricao="Nenhum SKU desta seleção passa da meta no Marketplace." />
          ) : (
            <section aria-labelledby="sm-skus" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="sm-skus" className="text-sm font-semibold text-ink">
                  SKUs parados <span className="font-normal text-ink-muted">· {int(lista.length)}{lista.length !== daMarca.length ? ` de ${int(daMarca.length)}` : ""}</span>
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {comVendas && <Segmented rotulo="Tendência" opcoes={TENDENCIAS} valor={tendencia} aoEscolher={setTendencia} />}
                  <button
                    type="button"
                    onClick={exportar}
                    disabled={sortedRows.length === 0}
                    className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-raised disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Exportar (.csv)
                  </button>
                </div>
              </div>
              <TableScrollHint>
                <table className="min-w-full text-sm">
                  <thead className="text-xs text-ink-muted">
                    <tr className="border-b border-line">
                      <SortHeader rotulo="Produto" coluna="produto" sort={sort} aoOrdenar={toggleSort} alinhamento="left" />
                      <SortHeader rotulo="Estoque" coluna="estoque" sort={sort} aoOrdenar={toggleSort} />
                      <SortHeader rotulo="Venda/dia" coluna="venda" sort={sort} aoOrdenar={toggleSort} />
                      {comVendas && <SortHeader rotulo="Tendência" coluna="tendencia" sort={sort} aoOrdenar={toggleSort} />}
                      <SortHeader rotulo="Cobertura" coluna="cobertura" sort={sort} aoOrdenar={toggleSort} />
                      <SortHeader rotulo="Capital parado" coluna="valor" sort={sort} aoOrdenar={toggleSort} />
                      {comVendas && <th scope="col" className="hidden px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide md:table-cell">30 dias</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((s) => (
                      <tr key={`${s.marca}|${s.sku}`} className="border-b border-line last:border-0 hover:bg-raised/60">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => abrirProduto(s)}
                            aria-haspopup="dialog"
                            className="text-left rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                          >
                            <span className="block text-ink hover:underline">{s.descricao}</span>
                            <span className="block text-xs text-ink-muted">{brandLabel(s.marca)} · {s.sku}</span>
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.estoque == null ? "—" : int(s.estoque)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{dec(vendaDia(s))}</td>
                        {comVendas && <td className="px-3 py-2 text-right tabular-nums"><Tendencia v={ritmo(s, n, canal, envio).tendencia} /></td>}
                        <td className="px-3 py-2 text-right tabular-nums">{dias(s.cobertura_dias)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtBrlCurto(s.valor_parado)}</td>
                        {comVendas && (
                          <td className="hidden px-3 py-2 md:table-cell">
                            <div className="ml-auto h-8 w-24 text-kpi-pedidos" aria-hidden="true">
                              <Sparkline pontos={serieDo(s, n, canal, envio).slice(-30)} tinta="text-kpi-pedidos" />
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                    {sortedRows.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">Nenhum SKU nesta busca.</td></tr>
                    )}
                  </tbody>
                </table>
              </TableScrollHint>
            </section>
          )}

          <KpiDrilldownDialog
            open={dialogo != null}
            onClose={() => setDialogo(null)}
            title={dialogo == null ? "" : dialogo.tipo === "produto" ? dialogo.sku.descricao : CARTOES[dialogo.tipo].titulo}
            focusResetKey={dialogo?.tipo === "produto" ? dialogo.sku.sku : dialogo?.tipo}
            largura="larga"
            icone={dialogo && dialogo.tipo !== "produto" ? CARTOES[dialogo.tipo].icone : undefined}
            identidade={dialogo && dialogo.tipo !== "produto" ? CARTOES[dialogo.tipo].identidade : undefined}
          >
            {dialogo?.tipo === "produto" && (() => {
              const s = dialogo.sku;
              const r = ritmo(s, n);
              const p15 = pecas15dPorMarketplace(s, n);
              const total15 = p15.ML + p15.SP + p15.TT;
              return (
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-ink-muted">
                    {[brandLabel(s.marca), `SKU ${s.sku}`, s.categoria, s.curva && `curva ${s.curva}`, s.status].filter(Boolean).join(" · ")}
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <Metrica rotulo="Estoque no Marketplace" valor={s.estoque == null ? "—" : `${int(s.estoque)} pç`} sub={s.custo_unitario ? `custo ${fmtBrlCurto(s.custo_unitario)}/pç` : undefined} />
                    <Metrica rotulo="Capital parado" valor={fmtBrlCurto(s.valor_parado)} />
                    <Metrica rotulo="Cobertura" valor={dias(s.cobertura_dias)} sub={`meta: abaixo de ${meta} d`} />
                    <Metrica rotulo="Venda/dia (15d)" valor={`${dec(s.venda_dia)} pç`} sub={comVendas ? <>15d antes: {dec(r.m15p)} · <Tendencia v={r.tendencia} /></> : undefined} />
                    <Metrica rotulo="Precisa vender/dia" valor={s.estoque == null ? "—" : `${dec(s.estoque / meta)} pç`} sub={`para ficar em ${meta} d`} />
                    {comVendas && <Metrica rotulo="Faturamento 15d" valor={fmtBrlCurto(faturamento15d([s]))} />}
                  </div>
                  {comVendas && (
                    <>
                      <DrilldownSecao titulo="Peças nos últimos 15 dias, por canal">
                        <div className="grid grid-cols-3 gap-2">
                          {MARKETPLACES.map((m) => (
                            <Metrica key={m} rotulo={ROTULO_MKT[m]} valor={int(p15[m])} sub={total15 ? `${Math.round((p15[m] / total15) * 100)}%` : undefined} />
                          ))}
                        </div>
                      </DrilldownSecao>
                      <DrilldownSecao titulo={`Venda diária, 60 dias (${recorte})`}>{grafico([s])}</DrilldownSecao>
                    </>
                  )}
                </div>
              );
            })()}

            {dialogo?.tipo === "skus" && (
              <TableScrollHint>
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-ink-muted">
                    <tr className="border-b border-line">
                      <th scope="col" className="px-3 py-2 text-left">Marca</th>
                      <th scope="col" className="px-3 py-2 text-right">SKUs</th>
                      <th scope="col" className="px-3 py-2 text-right">Capital parado</th>
                      <th scope="col" className="px-3 py-2 text-right">Venda/dia</th>
                      {comVendas && <th scope="col" className="px-3 py-2 text-right">Tendência</th>}
                      <th scope="col" className="px-3 py-2 text-right">Cobertura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {porMarca(daMarca, meta).map(({ marca, t: m }) => (
                      <tr key={marca} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 font-medium text-ink">
                          <button type="button" onClick={() => { setMarcas([marca]); setDialogo(null); }} className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                            {brandLabel(marca)}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{int(m.skus)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtBrlCurto(m.valor)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{dec(m.vendaDia)}</td>
                        {comVendas && <td className="px-3 py-2 text-right tabular-nums"><Tendencia v={tendenciaDaLista(daMarca.filter((s) => s.marca === marca), n)} /></td>}
                        <td className="px-3 py-2 text-right tabular-nums">{dias(m.cobertura)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-ink-muted">Clique na marca para ver só ela.</p>
              </TableScrollHint>
            )}

            {dialogo?.tipo === "capital" && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-ink-muted">{fmtBrlCurto(t.valor)} a preço de custo · os 10 SKUs com mais capital parado:</p>
                <ol className="flex flex-col divide-y divide-line">
                  {[...daMarca].sort((a, b) => b.valor_parado - a.valor_parado).slice(0, 10).map((s) => (
                    <li key={`${s.marca}|${s.sku}`}>
                      <button type="button" onClick={() => abrirProduto(s)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">
                        <span className="min-w-0">
                          <span className="block truncate text-ink">{s.descricao}</span>
                          <span className="block text-xs text-ink-muted">{brandLabel(s.marca)} · {s.sku} · {dias(s.cobertura_dias)}</span>
                        </span>
                        <span className="shrink-0 tabular-nums font-semibold">{fmtBrlCurto(s.valor_parado)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {dialogo?.tipo === "cobertura" && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {FAIXAS.map((f) => {
                    const l = daMarca.filter(f.passa);
                    return <Metrica key={f.rotulo} rotulo={f.rotulo} valor={`${int(l.length)} SKUs`} sub={fmtBrlCurto(l.reduce((a, s) => a + s.valor_parado, 0))} />;
                  })}
                </div>
                <DrilldownSecao titulo="Para chegar na meta">
                  <p className="text-sm text-ink">
                    Precisa vender <b>{int(t.precisaDia)} pç/dia</b> para o estoque cair para {meta} dias. Hoje vende {int(t.vendaDia)} pç/dia.
                  </p>
                </DrilldownSecao>
              </div>
            )}

            {dialogo?.tipo === "venda" && (
              <div className="flex flex-col gap-3">
                {comVendas ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Metrica rotulo="Venda/dia (15d)" valor={`${int(vendaDiaTopo)} pç`} sub={<><Tendencia v={tendenciaDaLista(daMarca, n, canal, envio)} /> vs 15 dias antes</>} />
                      <Metrica rotulo={`Faturamento 15d · ${recorte}`} valor={fmtBrlCurto(faturamento15d(daMarca, canal, envio))} />
                    </div>
                    <DrilldownSecao titulo={`Peças por dia, 60 dias (${recorte})`}>{grafico(daMarca)}</DrilldownSecao>
                    <p className="text-xs text-ink-muted">Pedidos de Mercado Livre, Shopee e TikTok com os kits abertos em peças. Canal e envio seguem os filtros do topo.</p>
                  </>
                ) : (
                  <p className="text-sm text-ink-muted">A venda diária por canal está indisponível agora; a média de 15 dias vem do Supply.</p>
                )}
              </div>
            )}
          </KpiDrilldownDialog>
        </>
      )}
    </Aba>
  );
}
