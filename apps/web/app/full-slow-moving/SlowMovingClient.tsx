"use client";

/**
 * SLOW-MOVING — sub-aba "Slow Moving" do /full (paridade com o dash Mix Marketplace da Nath).
 *
 * Lista do Supply (Painel S&OE, canal Marketplace): curva B/C, descontinuado
 * ou brinde com mais de 120 dias de cobertura. A Torre nao recalcula a regra:
 * le' o Supply Intelligence (lista, estoque, custo e a venda diaria com kit ja'
 * aberto), entao o numero bate com o painel deles.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleDollarSign, Package, ShoppingBag, Snowflake, Timer, TrendingUp } from "lucide-react";

import Aba from "@/components/layout/Aba";
import { useVisoesFull } from "@/components/full/useVisoesFull";
import BrandFilter from "@/components/BrandFilter";
import InfoDica from "@/components/ui/InfoDica";
import KpiCardSkeleton from "@/components/ui/KpiCardSkeleton";
import KpiTile from "@/components/ui/KpiTile";
import Segmented from "@/components/ui/Segmented";
import SortHeader from "@/components/ui/SortHeader";
import Sparkline from "@/components/ui/Sparkline";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import TableScrollHint from "@/components/TableScrollHint";
import { brandLabel } from "@/lib/filters/brands";
import { fmtBrlCurto, fmtPctBr } from "@/lib/formatters";
import {
  COLUNAS_EXPORT, ROTULO_CANAL, faturamento15d, fetchSlowMoving, filtrar, linhaExport, mediaMovel7, passaTendencia,
  porMarca, ritmo, serieDaLista, serieDo, tendenciaDaLista, totais,
  type FiltroCanal, type FiltroTendencia, type SkuSlowMoving, type SlowMovingResponse,
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

function Tendencia({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-faint">—</span>;
  const tom = v > 0.5 ? "text-ok-ink" : v < -0.5 ? "text-crit-ink" : "text-ink-muted";
  return <span className={tom}>{v > 0.5 ? "▲ " : v < -0.5 ? "▼ " : ""}{fmtPctBr(v)}</span>;
}

const CANAIS: { valor: FiltroCanal; texto: string }[] = (["todos", "MKT", "TT"] as const).map((v) => ({ valor: v, texto: ROTULO_CANAL[v] }));
const TENDENCIAS: { valor: FiltroTendencia; texto: string }[] = [
  { valor: "todos", texto: "Todos" }, { valor: "melhorando", texto: "▲ Melhorando" }, { valor: "piorando", texto: "▼ Piorando" },
];
const COLUNAS: Record<string, SortColumnType> = {
  produto: "text", estoque: "numeric", valor: "numeric", venda: "numeric", anterior: "numeric",
  tendencia: "numeric", cobertura: "numeric", precisa: "numeric",
};

export default function SlowMovingClient() {
  const abas = useVisoesFull();
  const [dados, setDados] = useState<SlowMovingResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [canal, setCanal] = useState<FiltroCanal>("todos");
  const [tendencia, setTendencia] = useState<FiltroTendencia>("todos");
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
  const lista = useMemo(
    () => filtrar(daMarca, [], busca).filter((s) => !comVendas || passaTendencia(s, n, tendencia)),
    [daMarca, busca, tendencia, comVendas, n],
  );
  const t = totais(daMarca, meta);
  const valorDe = useCallback((s: SkuSlowMoving, c: string) => {
    if (c === "produto") return s.descricao;
    if (c === "valor") return s.valor_parado;
    if (c === "venda") return s.venda_dia;
    if (c === "anterior") return ritmo(s, n).m15p;
    if (c === "tendencia") return ritmo(s, n).tendencia;
    if (c === "cobertura") return s.cobertura_dias ?? Number.POSITIVE_INFINITY;
    return s.estoque;
  }, [n]);
  const { sort, toggleSort, sortedRows } = useSortableTable(lista, valorDe, COLUNAS);

  const pontos = useMemo(() => {
    if (!comVendas || !dados) return [];
    const v = serieDaLista(daMarca, n, canal);
    const m7 = mediaMovel7(v);
    return dados.dias.map((dia, i) => ({ dia, pecas: v[i], media7: m7[i] }));
  }, [comVendas, dados, daMarca, n, canal]);

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
      <label className="flex w-full items-center gap-2 text-sm text-ink-muted sm:w-auto">
        <span className="sr-only">Buscar por SKU, produto ou categoria</span>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar SKU ou produto"
          className="rounded-lg border border-line bg-surface text-ink placeholder:text-ink-faint min-h-11 px-3 text-sm w-full sm:w-64 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </label>
    </div>
  );

  return (
    <Aba
      {...abas}
      // O Supply publica so' o dia da fotografia (sem hora): o selo de horario mentiria.
      selo={dados?.atualizado_em ? <span className="text-xs text-ink-muted" title={dados.fonte}>Fotografia do Supply · {dataBr(dados.atualizado_em)}</span> : undefined}
      filtros={filtrosUI}
    >
      {carregando && (
        <div role="status" aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <span className="sr-only">Carregando slow moving…</span>
          {Array.from({ length: 6 }).map((_, i) => <KpiCardSkeleton key={i} anunciar={false} />)}
        </div>
      )}

      {!carregando && erro && (
        <StateBlock tipo="erro" titulo="Não foi possível carregar o slow moving" descricao={erro} acao={<RetryButton onClick={carregar} />} />
      )}

      {!carregando && !erro && dados && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <KpiTile variante="gerencial" identidade="ads" icone={Snowflake} rotulo="SKUs parados"
              ajuda={<InfoDica texto={`Regra do Supply (Painel S&OE): curva B/C, descontinuado ou brinde com mais de ${meta} dias de estoque no Marketplace.`} />}
              valor={int(t.skus)} comparacao={`${int(t.estoque)} peças no Marketplace`} />
            <KpiTile variante="gerencial" identidade="gmv" icone={CircleDollarSign} rotulo="Capital parado"
              ajuda={<InfoDica texto="Estoque do Marketplace a preço de custo." />}
              valor={fmtBrlCurto(t.valor)} />
            <KpiTile variante="gerencial" identidade="prazo" icone={Timer} rotulo="Cobertura"
              ajuda={<InfoDica texto="Σ estoque ÷ Σ venda média por dia dos últimos 15 dias, no Marketplace (com TikTok)." />}
              valor={dias(t.cobertura)} comparacao={`Meta: abaixo de ${meta} d`} />
            <KpiTile variante="gerencial" identidade="pedidos" icone={TrendingUp} rotulo="Venda média/dia (15d)"
              ajuda={<InfoDica texto="Peças por dia nos últimos 15 dias, avulso + dentro de kits, todos os canais do Marketplace." />}
              valor={`${int(t.vendaDia)} pç`}
              comparacao={comVendas ? <span><Tendencia v={tendenciaDaLista(daMarca, n)} /> vs 15 dias anteriores</span> : undefined} />
            {comVendas && (
              <KpiTile variante="gerencial" identidade="gmv" icone={ShoppingBag} rotulo="Faturamento 15d"
                ajuda={<InfoDica texto="Faturamento dos SKUs da lista nos últimos 15 dias, no canal escolhido." />}
                valor={fmtBrlCurto(faturamento15d(daMarca, canal))} comparacao={`Canal: ${ROTULO_CANAL[canal]}`} />
            )}
            <KpiTile variante="gerencial" identidade="pedidos" icone={Package} rotulo="Precisa vender por dia"
              ajuda={<InfoDica texto={`Peças por dia para o estoque cair para ${meta} dias.`} />}
              valor={`${int(t.precisaDia)} pç`} comparacao={`Hoje vende ${int(t.vendaDia)} pç/dia`} />
          </div>

          {daMarca.length === 0 ? (
            <StateBlock tipo="vazio" titulo="Nenhum SKU parado" descricao="Nenhum SKU desta seleção passa da meta no Marketplace." />
          ) : (
            <>
              {comVendas && (
                <section aria-labelledby="sm-grafico" className="flex flex-col gap-2">
                  <h2 id="sm-grafico" className="text-sm font-semibold text-ink">
                    Venda diária dos SKUs parados — peças ({ROTULO_CANAL[canal]})
                  </h2>
                  <div className="h-64 rounded-xl border border-line bg-surface p-3">
                    <Grafico pontos={pontos} />
                  </div>
                </section>
              )}

              {marcas.length !== 1 && (
                <section aria-labelledby="sm-marcas" className="flex flex-col gap-2">
                  <h2 id="sm-marcas" className="text-sm font-semibold text-ink">Por marca</h2>
                  <TableScrollHint>
                    <table className="min-w-full text-sm">
                      <thead className="text-xs uppercase tracking-wide text-ink-muted">
                        <tr className="border-b border-line">
                          <th scope="col" className="px-3 py-2 text-left">Marca</th>
                          <th scope="col" className="px-3 py-2 text-right">SKUs</th>
                          <th scope="col" className="px-3 py-2 text-right">Capital parado</th>
                          <th scope="col" className="px-3 py-2 text-right">Estoque</th>
                          <th scope="col" className="px-3 py-2 text-right">Venda/dia (15d)</th>
                          {comVendas && <th scope="col" className="px-3 py-2 text-right">Tendência</th>}
                          <th scope="col" className="px-3 py-2 text-right">Cobertura</th>
                          <th scope="col" className="px-3 py-2 text-right">Precisa vender/dia</th>
                        </tr>
                      </thead>
                      <tbody>
                        {porMarca(daMarca, meta).map(({ marca, t: m }) => (
                          <tr key={marca} className="border-b border-line last:border-0">
                            <td className="px-3 py-2 font-medium text-ink">
                              <button type="button" onClick={() => setMarcas([marca])} className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                                {brandLabel(marca)}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{int(m.skus)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtBrlCurto(m.valor)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{int(m.estoque)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{dec(m.vendaDia)}</td>
                            {comVendas && (
                              <td className="px-3 py-2 text-right tabular-nums">
                                <Tendencia v={tendenciaDaLista(daMarca.filter((s) => s.marca === marca), n)} />
                              </td>
                            )}
                            <td className="px-3 py-2 text-right tabular-nums">{dias(m.cobertura)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{int(m.precisaDia)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScrollHint>
                </section>
              )}

              <section aria-labelledby="sm-skus" className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 id="sm-skus" className="text-sm font-semibold text-ink">SKUs parados</h2>
                  <div className="flex flex-wrap items-center gap-2">
                    {comVendas && <Segmented rotulo="Tendência" opcoes={TENDENCIAS} valor={tendencia} aoEscolher={setTendencia} />}
                    <button
                      type="button"
                      onClick={exportar}
                      disabled={sortedRows.length === 0}
                      className="inline-flex min-h-11 items-center rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-raised disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      Exportar tabela (.csv)
                    </button>
                  </div>
                </div>
                {(busca.trim() || tendencia !== "todos") && <p className="text-xs text-ink-muted px-1">{int(lista.length)} no filtro</p>}
                <TableScrollHint>
                  <table className="min-w-full text-sm">
                    <thead className="text-xs text-ink-muted">
                      <tr className="border-b border-line">
                        <SortHeader rotulo="Produto" coluna="produto" sort={sort} aoOrdenar={toggleSort} alinhamento="left" />
                        <SortHeader rotulo="Estoque" coluna="estoque" sort={sort} aoOrdenar={toggleSort} />
                        <SortHeader rotulo="Venda/dia (15d)" coluna="venda" sort={sort} aoOrdenar={toggleSort} />
                        {comVendas && <SortHeader rotulo="15d anteriores" coluna="anterior" sort={sort} aoOrdenar={toggleSort} />}
                        {comVendas && <SortHeader rotulo="Tendência" coluna="tendencia" sort={sort} aoOrdenar={toggleSort} />}
                        <SortHeader rotulo="Cobertura" coluna="cobertura" sort={sort} aoOrdenar={toggleSort} />
                        <SortHeader rotulo="Precisa vender/dia" coluna="precisa" sort={sort} aoOrdenar={toggleSort} />
                        <SortHeader rotulo="Capital parado" coluna="valor" sort={sort} aoOrdenar={toggleSort} />
                        {comVendas && <th scope="col" className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Últimos 30 dias</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((s) => {
                        const r = comVendas ? ritmo(s, n) : null;
                        return (
                          <tr key={`${s.marca}|${s.sku}`} className="border-b border-line last:border-0 align-top">
                            <td className="px-3 py-2">
                              <div className="text-ink">{s.descricao}</div>
                              <div className="text-xs text-ink-muted">
                                {brandLabel(s.marca)} · {s.sku}{s.categoria ? ` · ${s.categoria}` : ""}
                                {s.curva ? ` · curva ${s.curva}` : ""}{s.status && s.status !== "Ativo" ? ` · ${s.status}` : ""}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.estoque == null ? "—" : int(s.estoque)}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{dec(s.venda_dia)}</td>
                            {r && <td className="px-3 py-2 text-right tabular-nums">{dec(r.m15p)}</td>}
                            {r && <td className="px-3 py-2 text-right tabular-nums"><Tendencia v={r.tendencia} /></td>}
                            <td className="px-3 py-2 text-right tabular-nums">{dias(s.cobertura_dias)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{s.estoque == null ? "—" : dec(s.estoque / meta)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtBrlCurto(s.valor_parado)}</td>
                            {comVendas && (
                              <td className="px-3 py-2">
                                <div className="ml-auto h-8 w-24 text-kpi-pedidos" aria-hidden="true">
                                  <Sparkline pontos={serieDo(s, n).slice(-30)} tinta="text-kpi-pedidos" />
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {sortedRows.length === 0 && (
                        <tr><td colSpan={9} className="px-3 py-6 text-center text-ink-muted">Nenhum SKU neste filtro.</td></tr>
                      )}
                    </tbody>
                  </table>
                </TableScrollHint>
              </section>
            </>
          )}
        </>
      )}
    </Aba>
  );
}
