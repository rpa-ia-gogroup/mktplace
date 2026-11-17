"use client";

/**
 * SLOW-MOVING-1 — sub-aba "Slow Moving" do /full.
 *
 * Lista do Supply (Painel S&OE, canal Marketplace): curva B/C, descontinuado
 * ou brinde com mais de 120 dias de cobertura. A Torre nao recalcula a regra:
 * le' o Supply Intelligence, entao o numero bate com o painel deles.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleDollarSign, Package, Snowflake, Timer } from "lucide-react";

import Aba from "@/components/layout/Aba";
import { useVisoesFull } from "@/components/full/useVisoesFull";
import BrandFilter from "@/components/BrandFilter";
import InfoDica from "@/components/ui/InfoDica";
import KpiCardSkeleton from "@/components/ui/KpiCardSkeleton";
import KpiTile from "@/components/ui/KpiTile";
import SortHeader from "@/components/ui/SortHeader";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import TableScrollHint from "@/components/TableScrollHint";
import { brandLabel } from "@/lib/filters/brands";
import { fmtBrlCurto } from "@/lib/formatters";
import { fetchSlowMoving, filtrar, porMarca, totais, type SkuSlowMoving, type SlowMovingResponse } from "@/lib/full-slow-moving";
import { useSortableTable, type SortColumnType } from "@/lib/use-sortable-table";

const MARCAS = ["apice", "barbours", "kokeshi", "lescent", "rituaria"];
const int = (n: number) => Math.round(n).toLocaleString("pt-BR");
const dec = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const dias = (n: number | null) => (n == null ? "sem venda" : `${int(n)} d`);

const COLUNAS: Record<string, SortColumnType> = {
  produto: "text", estoque: "numeric", valor: "numeric", venda: "numeric", cobertura: "numeric", precisa: "numeric",
};
const valorDe = (s: SkuSlowMoving, c: string) =>
  c === "produto" ? s.descricao
  : c === "estoque" ? s.estoque
  : c === "valor" ? s.valor_parado
  : c === "venda" ? s.venda_dia
  : c === "cobertura" ? (s.cobertura_dias ?? Number.POSITIVE_INFINITY)
  : s.estoque;

export default function SlowMovingClient() {
  const abas = useVisoesFull();
  const [dados, setDados] = useState<SlowMovingResponse | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
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
  const daMarca = useMemo(() => filtrar(dados?.skus ?? [], marcas, ""), [dados, marcas]);
  const lista = useMemo(() => filtrar(daMarca, [], busca), [daMarca, busca]);
  const t = totais(daMarca, meta);
  const { sort, toggleSort, sortedRows } = useSortableTable(lista, valorDe, COLUNAS);

  const filtrosUI = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 w-full">
      <BrandFilter
        variante="menu"
        rotulo="Marca"
        opcoes={MARCAS.map((m) => ({ value: m, label: brandLabel(m) }))}
        value={marcas}
        onChange={setMarcas}
      />
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
              ajuda={<InfoDica texto={`Regra do Supply (Painel S&OE): curva B/C, descontinuado ou brinde com mais de ${meta} dias de estoque no Marketplace.`} />}
              valor={int(t.skus)} comparacao={`${int(t.estoque)} peças no Marketplace`} />
            <KpiTile variante="gerencial" identidade="gmv" icone={CircleDollarSign} rotulo="Capital parado"
              ajuda={<InfoDica texto="Estoque do Marketplace a preço de custo." />}
              valor={fmtBrlCurto(t.valor)} />
            <KpiTile variante="gerencial" identidade="prazo" icone={Timer} rotulo="Cobertura"
              ajuda={<InfoDica texto="Estoque ÷ venda média por dia dos últimos 15 dias, no Marketplace." />}
              valor={dias(t.cobertura)} comparacao={`Meta: abaixo de ${meta} d`} />
            <KpiTile variante="gerencial" identidade="pedidos" icone={Package} rotulo="Precisa vender por dia"
              ajuda={<InfoDica texto={`Peças por dia para o estoque cair para ${meta} dias.`} />}
              valor={`${int(t.precisaDia)} pç`} comparacao={`Hoje vende ${int(t.vendaDia)} pç/dia`} />
          </div>

          {daMarca.length === 0 ? (
            <StateBlock tipo="vazio" titulo="Nenhum SKU parado" descricao="Nenhum SKU desta seleção passa da meta no Marketplace." />
          ) : (
            <>
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
                          <th scope="col" className="px-3 py-2 text-right">Venda/dia</th>
                          <th scope="col" className="px-3 py-2 text-right">Cobertura</th>
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
                            <td className="px-3 py-2 text-right tabular-nums">{dias(m.cobertura)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScrollHint>
                </section>
              )}

              <section aria-labelledby="sm-skus" className="flex flex-col gap-2">
                <h2 id="sm-skus" className="text-sm font-semibold text-ink">SKUs parados</h2>
                {busca.trim() && <p className="text-xs text-ink-muted px-1">{int(lista.length)} na busca</p>}
                <TableScrollHint>
                  <table className="min-w-full text-sm">
                    <thead className="text-xs text-ink-muted">
                      <tr className="border-b border-line">
                        <SortHeader rotulo="Produto" coluna="produto" sort={sort} aoOrdenar={toggleSort} alinhamento="left" />
                        <SortHeader rotulo="Estoque" coluna="estoque" sort={sort} aoOrdenar={toggleSort} />
                        <SortHeader rotulo="Capital parado" coluna="valor" sort={sort} aoOrdenar={toggleSort} />
                        <SortHeader rotulo="Venda/dia (15d)" coluna="venda" sort={sort} aoOrdenar={toggleSort} />
                        <SortHeader rotulo="Cobertura" coluna="cobertura" sort={sort} aoOrdenar={toggleSort} />
                        <SortHeader rotulo="Precisa vender/dia" coluna="precisa" sort={sort} aoOrdenar={toggleSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((s) => (
                        <tr key={`${s.marca}|${s.sku}`} className="border-b border-line last:border-0 align-top">
                          <td className="px-3 py-2">
                            <div className="text-ink">{s.descricao}</div>
                            <div className="text-xs text-ink-muted">
                              {brandLabel(s.marca)} · {s.sku}{s.categoria ? ` · ${s.categoria}` : ""}
                              {s.curva ? ` · curva ${s.curva}` : ""}{s.status && s.status !== "Ativo" ? ` · ${s.status}` : ""}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.estoque == null ? "—" : int(s.estoque)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtBrlCurto(s.valor_parado)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{dec(s.venda_dia)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{dias(s.cobertura_dias)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.estoque == null ? "—" : dec(s.estoque / meta)}</td>
                        </tr>
                      ))}
                      {sortedRows.length === 0 && (
                        <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-muted">Nenhum SKU nesta busca.</td></tr>
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
