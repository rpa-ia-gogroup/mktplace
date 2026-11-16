"use client";

/**
 * Tela "Full Mercado Livre" — Gate FULL-1D.
 *
 * MODALIDADE LOGISTICA, NAO ESTOQUE
 * ----------------------------------
 * Esta superficie mede por onde o pedido foi enviado, nao quanto ha em
 * estoque. Nao existe aqui disponibilidade, cobertura em dias nem ruptura, e
 * isso e' decisao medida: o gate FULL-0R provou que o campo de estoque
 * anunciado do ML nao se comporta como estoque fisico (correlacao de -0,006
 * entre a variacao diaria e as vendas). Misturar as duas coisas nesta tela
 * seria afirmar o que ninguem mediu.
 *
 * A tela NAO recalcula nada que a API entrega. Shares, taxas e medias vem
 * prontos. A unica divisao feita aqui e' o share DIARIO da serie, porque a API
 * entrega o share agregado do periodo, nao por dia -- e ela usa exatamente a
 * mesma regra do backend (denominador `full + non_full`, sem `unknown`).
 *
 * NUMERO PRIMEIRO: a ressalva que muda a leitura (carga manual, inicio da
 * serie, definicao de cada modalidade) fica num "i" ao lado do rotulo.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { janelaDaUrl, urlComJanela } from "@/lib/full-janela-url";
import PageContainer from "@/components/layout/PageContainer";
import Aba from "@/components/layout/Aba";
import { useVisoesFull } from "@/components/full/useVisoesFull";
import { Ban, CircleDollarSign, ShoppingBag, Truck } from "lucide-react";
import CartaoIndicador from "@/components/ui/CartaoIndicador";
import Segmented from "@/components/ui/Segmented";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import { AvisoTopo } from "@/components/full/CategoriasEstoque";
import { fmtBrlCurto } from "@/lib/formatters";
import KpiCardSkeleton from "@/components/ui/KpiCardSkeleton";
import StateBlock from "@/components/ui/StateBlock";
import MLFulfillmentTrend from "@/components/MLFulfillmentTrend";
import InfoDica from "@/components/ui/InfoDica";
import { fetchMLFulfillment, MLFulfillmentError } from "@/lib/api-client";
import {
  AVISO_COBERTURA,
  AVISO_MANUAL_SNAPSHOT,
  CLASS_DESCRICAO,
  CLASS_LABEL,
  FRESHNESS_LABEL,
  LOAD_MODE_LABEL,
  PERIOD_PRESETS,
  SEM_DADO,
  alertas,
  buildQuery,
  byClass,
  fmtCount,
  fmtGmv,
  fmtShare,
  fmtTempo,
  isVazioReal,
  parseGmv,
  presetRange,
  serieDiaria,
  validateRange,
  type FulfillmentClass,
  type MLFulfillmentResponse,
  type MetricaSerie,
} from "@/lib/ml-fulfillment";

const MARCAS = [
  { key: "", label: "Todas as marcas" },
  { key: "barbours", label: "Barbours" },
  { key: "kokeshi", label: "Kokeshi" },
  { key: "lescent", label: "Lescent" },
  { key: "rituaria", label: "Rituária" },
];

const METRICAS: { key: MetricaSerie; label: string }[] = [
  { key: "gmv", label: "GMV" },
  { key: "orders", label: "Pedidos" },
  { key: "units", label: "Unidades" },
];

/** Alvo minimo de toque e foco visivel — o mesmo contrato do Gate V3-1A.
 *  Sem cor: so' geometria, borda e anel de foco. */
const CONTROLE_BASE =
  "min-h-11 px-3 rounded-lg border text-sm " +
  "focus-visible:outline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Aparencia neutra do controle. NAO sobreponha outra cor de fundo ou de
 *  texto a esta constante: utilities do Tailwind competem pela ordem do
 *  stylesheet gerado, nao pela ordem no atributo `class`. Concatenar
 *  `bg-accent text-accent-on` aqui fazia `bg-surface` vencer e `text-accent-on`
 *  perder, rendendo branco-sobre-branco no botao selecionado. Para variar a
 *  cor, parta de `CONTROLE_BASE` e declare a paleta inteira em cada ramo. */
const CONTROLE = `${CONTROLE_BASE} border-line-strong bg-surface text-ink`;

function hojeIsoBrt(): string {
  // `sv-SE` devolve YYYY-MM-DD; o fuso e' explicito porque o dia operacional da
  // Torre e' America/Sao_Paulo, nao o do navegador.
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

/** R$ curto ("R$ 4,48 mi"), como nas outras abas; o valor cheio, com centavo, fica no title. */
function Reais({ v }: { v: string | number | null | undefined }) {
  const n = typeof v === "string" ? parseGmv(v) : v;
  if (n === null || n === undefined || !Number.isFinite(n)) return <>{SEM_DADO}</>;
  return <span title={fmtGmv(n)}>{fmtBrlCurto(n)}</span>;
}

/** "2026-11-12" -> "12/11". */
const dm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : SEM_DADO);

/** Participacao diaria do Full, so' dias medidos (dia sem venda classificada nao vira 0%). */
const serieShare = (pontos: { share_full: number | null }[]) =>
  pontos.map((p) => p.share_full).filter((v): v is number => v !== null);

function FullMLPageInner() {
  const abas = useVisoesFull();
  const hoje = useMemo(hojeIsoBrt, []);
  // B2-02: a janela vem da URL (`date_from`/`date_to`); sem ela, ou invalida, 30 dias.
  const busca = useSearchParams();
  const inicial = useMemo(
    () => janelaDaUrl(busca.toString(), presetRange(30, hoje), (f, t) => validateRange(f, t, hoje)),
    [hoje], // eslint-disable-line react-hooks/exhaustive-deps -- so' no mount; depois a tela escreve na URL
  );

  const [from, setFrom] = useState(inicial.from);
  const [to, setTo] = useState(inicial.to);
  const [marca, setMarca] = useState("");
  const [metrica, setMetrica] = useState<MetricaSerie>("gmv");

  const [dados, setDados] = useState<MLFulfillmentResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Validacao ANTES da requisicao: o 422 do backend ecoa o valor recebido, e
  // esse corpo tecnico nao deve chegar a tela.
  const erroJanela = useMemo(
    () => validateRange(from, to, hoje),
    [from, to, hoje],
  );

  useEffect(() => {
    if (erroJanela) {
      setCarregando(false);
      return;
    }
    const ctrl = new AbortController();
    setCarregando(true);
    setErro(null);
    const query = buildQuery({ from, to, brands: marca ? [marca] : undefined });
    fetchMLFulfillment(query, ctrl.signal)
      .then((d) => {
        setDados(d);
        setCarregando(false);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setDados(null);
        setErro(
          e instanceof MLFulfillmentError
            ? e.message
            : "Nao foi possivel carregar a superficie Full.",
        );
        setCarregando(false);
      });
    return () => ctrl.abort();
  }, [from, to, marca, erroJanela]);

  // B2-02: a janela valida vai para a URL (replaceState: preserva `?aba=` e nao
  // re-renderiza a rota do servidor), para o reload e o link manterem o recorte.
  useEffect(() => {
    if (erroJanela) return;
    window.history.replaceState(null, "", urlComJanela(window.location.href, { from, to }));
  }, [from, to, erroJanela]);

  const aplicarPreset = useCallback(
    (dias: number) => {
      const r = presetRange(dias, hoje);
      setFrom(r.from);
      setTo(r.to);
    },
    [hoje],
  );

  const limpar = useCallback(() => {
    const r = presetRange(30, hoje);
    setFrom(r.from);
    setTo(r.to);
    setMarca("");
    setMetrica("gmv");
  }, [hoje]);

  const full = byClass(dados, "full");
  const naoFull = byClass(dados, "non_full");
  const serie = useMemo(() => serieDiaria(dados, metrica), [dados, metrica]);
  const listaAlertas = useMemo(() => alertas(dados), [dados]);
  const vazio = isVazioReal(dados);

  const frescor = dados?.freshness;
  const selo = (
    <>
      <span className="inline-flex items-center gap-1 text-xs text-ink-muted tabular-nums">
        {dm(from)} a {dm(to)}
        {frescor?.source_max_date && <> · fonte até {dm(frescor.source_max_date)}</>}
        <InfoDica texto={`${AVISO_COBERTURA} ${AVISO_MANUAL_SNAPSHOT}`} />
      </span>
      <SeloAtualizado
        em={frescor?.refreshed_at ?? null}
        carregando={carregando}
        atrasado={!!frescor && frescor.freshness_status !== "fresh"}
        detalhe={frescor ? `${FRESHNESS_LABEL[frescor.freshness_status]} · ${LOAD_MODE_LABEL[frescor.load_mode]}` : undefined}
      />
    </>
  );
  const presetAtivo = PERIOD_PRESETS.find((p) => {
    const r = presetRange(p.days, hoje);
    return r.from === from && r.to === to;
  });
  const serieGmv = useMemo(() => serieShare(serieDiaria(dados, "gmv")), [dados]);
  const seriePedidos = useMemo(() => serieShare(serieDiaria(dados, "orders")), [dados]);

  const filtros = (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Segmented
        rotulo="Marca"
        opcoes={MARCAS.map((m) => ({ valor: m.key || "todas", texto: m.key ? m.label : "Todas" }))}
        valor={marca || "todas"}
        aoEscolher={(v) => setMarca(v === "todas" ? "" : v)}
        className="max-w-full overflow-x-auto overflow-y-hidden whitespace-nowrap"
      />
      <Segmented
        rotulo="Período"
        opcoes={PERIOD_PRESETS.map((p) => ({ valor: String(p.days), texto: p.label }))}
        valor={presetAtivo ? String(presetAtivo.days) : ""}
        aoEscolher={(v) => aplicarPreset(Number(v))}
        className="whitespace-nowrap"
      />
      <label className="sr-only" htmlFor="full-ml-de">De</label>
      <input id="full-ml-de" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={CONTROLE} />
      <span aria-hidden="true" className="text-xs text-ink-muted">a</span>
      <label className="sr-only" htmlFor="full-ml-ate">Até</label>
      <input id="full-ml-ate" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={CONTROLE} />
      <button type="button" onClick={limpar} className={`${CONTROLE_BASE} inline-flex items-center border-transparent font-semibold text-accent-ink hover:underline`}>
        Limpar
      </button>
    </div>
  );

  return (
    <Aba
      {...abas}
      selo={selo}
      filtros={filtros}
    >

      {/* --- Alertas do payload (frescor, completude, unknown) ----------- */}
      {listaAlertas.length > 0 && (
        <div className="flex flex-col gap-1">
          {listaAlertas.map((a) => {
            const curto = a.split(/[.:;]/)[0];
            return <AvisoTopo key={a} texto={curto} ajuda={curto === a ? undefined : a} />;
          })}
        </div>
      )}

      {/* --- Estados ----------------------------------------------------- */}
      {erroJanela && <StateBlock tipo="indisponivel" titulo={erroJanela} />}

      {!erroJanela && erro && <StateBlock tipo="erro" titulo={erro} />}

      {!erroJanela && !erro && carregando && (
        <div role="status" aria-busy="true" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <span className="sr-only">Carregando indicadores de Full do Mercado Livre.</span>
          {Array.from({ length: 8 }).map((_, i) => <KpiCardSkeleton key={i} anunciar={false} />)}
        </div>
      )}

      {!erroJanela && !erro && !carregando && vazio && (
        <StateBlock tipo="vazio" titulo="Nenhum pedido no período e filtro selecionados." descricao="É ausência de venda, não falha de carga." />
      )}

      {/* --- Conteudo ---------------------------------------------------- */}
      {!erroJanela && !erro && !carregando && dados && !vazio && (
        <>
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
            <CartaoIndicador
              rotulo="Participação no GMV"
              icone={CircleDollarSign}
              cor="rgb(var(--tc-kpi-gmv))"
              valor={dados.share_full_gmv === null ? null : fmtShare(dados.share_full_gmv)}
              progresso={dados.share_full_gmv}
              legenda={<>Full <Reais v={full?.paid_gmv} /> de <Reais v={dados.paid_gmv_total} /></>}
              serie={serieGmv}
              tendencia="Participação diária do Full no GMV, no período"
            />
            <CartaoIndicador
              rotulo="Participação nos pedidos"
              icone={ShoppingBag}
              cor="rgb(var(--tc-kpi-pedidos))"
              valor={dados.share_full_orders === null ? null : fmtShare(dados.share_full_orders)}
              progresso={dados.share_full_orders}
              legenda={`Full ${fmtCount(full?.paid_orders ?? null)} de ${fmtCount(dados.paid_orders_total)}`}
              serie={seriePedidos}
              tendencia="Participação diária do Full nos pedidos, no período"
              ajuda={<InfoDica emControle texto={`Share de unidades Full: ${fmtShare(dados.share_full_units ?? null)} (Full ${fmtCount(full?.paid_units ?? null)} de ${fmtCount(dados.paid_units_total)} unidades).`} />}
            />
            <CartaoIndicador
              rotulo="Cancelamento Full"
              icone={Ban}
              cor="rgb(var(--tc-kpi-ads))"
              valor={full?.cancellation_rate == null ? null : fmtShare(full.cancellation_rate)}
              progresso={full?.cancellation_rate ?? null}
              legenda={`Não-Full: ${fmtShare(naoFull?.cancellation_rate ?? null)}`}
            />
            <CartaoIndicador
              rotulo="Entrega Full"
              icone={Truck}
              cor="rgb(var(--tc-kpi-prazo))"
              valor={full?.delivery ? fmtTempo(full.delivery) : null}
              legenda={`Não-Full: ${fmtTempo(naoFull?.delivery ?? null)}`}
            />
          </div>

          {/* --- Tendencia ------------------------------------------------ */}
          <section
            aria-labelledby="full-ml-trend"
            className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="full-ml-trend" className="text-sm font-semibold text-ink">
                Participação diária do Full
              </h2>
              <Segmented
                rotulo="Métrica da série"
                opcoes={METRICAS.map((m) => ({ valor: m.key, texto: m.label }))}
                valor={metrica}
                aoEscolher={setMetrica}
              />
            </div>
            <MLFulfillmentTrend pontos={serie} metrica={metrica} />
          </section>

          {/* --- Decomposicao por classe ---------------------------------- */}
          <section
            aria-labelledby="full-ml-classes"
            className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3"
          >
            <h2 id="full-ml-classes" className="text-sm font-semibold text-ink">
              Decomposição por modalidade
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <caption className="sr-only">
                  GMV, pedidos, unidades e cancelamento por modalidade logística
                </caption>
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="text-left py-2 pr-3 font-semibold text-ink-muted">Modalidade</th>
                    <th scope="col" className="text-right py-2 px-3 font-semibold text-ink-muted">GMV pago</th>
                    <th scope="col" className="text-right py-2 px-3 font-semibold text-ink-muted">Pedidos</th>
                    <th scope="col" className="text-right py-2 px-3 font-semibold text-ink-muted">Unidades</th>
                    <th scope="col" className="text-right py-2 px-3 font-semibold text-ink-muted">Elegíveis</th>
                    <th scope="col" className="text-right py-2 px-3 font-semibold text-ink-muted">Cancelados</th>
                    <th scope="col" className="text-right py-2 px-3 font-semibold text-ink-muted">Taxa cancel.</th>
                    <th scope="col" className="text-right py-2 px-3 font-semibold text-ink-muted">Handling</th>
                    <th scope="col" className="text-right py-2 pl-3 font-semibold text-ink-muted">Entrega</th>
                  </tr>
                </thead>
                <tbody>
                  {(["full", "non_full", "unknown"] as FulfillmentClass[]).map((c) => {
                    const linha = byClass(dados, c);
                    if (!linha) return null;
                    return (
                      <tr key={c} className="border-b border-line">
                        <th scope="row" className="text-left py-2 pr-3 font-medium text-ink">
                          <span className="inline-flex items-center gap-1">
                            {CLASS_LABEL[c]}
                            <InfoDica texto={CLASS_DESCRICAO[c]} />
                          </span>
                        </th>
                        <td className="text-right py-2 px-3 tabular-nums"><Reais v={linha.paid_gmv} /></td>
                        <td className="text-right py-2 px-3 tabular-nums">{fmtCount(linha.paid_orders)}</td>
                        <td className="text-right py-2 px-3 tabular-nums">{fmtCount(linha.paid_units)}</td>
                        <td className="text-right py-2 px-3 tabular-nums text-ink-muted">{fmtCount(linha.eligible_orders)}</td>
                        <td className="text-right py-2 px-3 tabular-nums text-ink-muted">{fmtCount(linha.cancelled_orders)}</td>
                        <td className="text-right py-2 px-3 tabular-nums">{fmtShare(linha.cancellation_rate)}</td>
                        <td className="text-right py-2 px-3 tabular-nums text-ink-muted">{fmtTempo(linha.handling)}</td>
                        <td className="text-right py-2 pl-3 tabular-nums text-ink-muted">{fmtTempo(linha.delivery)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* --- Composicao por tipo logistico bruto ---------------------- */}
          {dados.by_logistic_type.length > 0 && (
            <section
              aria-labelledby="full-ml-tipos"
              className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3"
            >
              <h2 id="full-ml-tipos" className="text-sm font-semibold text-ink">
                Composição por tipo logístico registrado
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <caption className="sr-only">GMV por tipo logístico registrado</caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="text-left py-2 pr-3 font-semibold text-ink-muted">Tipo</th>
                      <th scope="col" className="text-left py-2 px-3 font-semibold text-ink-muted">Classe</th>
                      <th scope="col" className="text-right py-2 px-3 font-semibold text-ink-muted">GMV pago</th>
                      <th scope="col" className="text-right py-2 pl-3 font-semibold text-ink-muted">Pedidos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.by_logistic_type.map((t) => (
                      <tr key={`${t.logistic_type_original}-${t.fulfillment_class}`} className="border-b border-line">
                        <td className="py-2 pr-3 font-mono text-xs text-ink">{t.logistic_type_original}</td>
                        <td className="py-2 px-3 text-ink-muted">{CLASS_LABEL[t.fulfillment_class]}</td>
                        <td className="text-right py-2 px-3 tabular-nums"><Reais v={t.paid_gmv} /></td>
                        <td className="text-right py-2 pl-3 tabular-nums">{fmtCount(t.paid_orders)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* --- Anuncios -------------------------------------------------- */}
          <section
            aria-labelledby="full-ml-anuncios"
            className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-3"
          >
            <h2 id="full-ml-anuncios" className="text-sm font-semibold text-ink">
              Anúncios por comportamento
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="border border-line rounded-lg p-3">
                <p className="text-xs font-semibold text-ink-muted uppercase">Somente Full</p>
                <p className="text-2xl font-bold tabular-nums text-ink">{fmtCount(dados.listings.full_only)}</p>
              </div>
              <div className="border border-warn/40 bg-warn-soft/40 rounded-lg p-3">
                <p className="text-xs font-semibold text-warn-ink uppercase">Mistos</p>
                <p className="text-2xl font-bold tabular-nums text-ink">{fmtCount(dados.listings.mixed)}</p>
                <p className="text-xs text-ink-muted mt-1">Full e não-Full na janela</p>
              </div>
              <div className="border border-line rounded-lg p-3">
                <p className="text-xs font-semibold text-ink-muted uppercase">Somente não-Full</p>
                <p className="text-2xl font-bold tabular-nums text-ink">{fmtCount(dados.listings.non_full_only)}</p>
              </div>
            </div>

            {dados.migration_opportunities.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-ink-muted mt-1">
                  Maior GMV fora do Full ({dados.migration_opportunities.length} anúncios)
                </h3>
                <div className="max-h-96 overflow-y-auto overflow-x-auto border border-line rounded-lg">
                  <table className="w-full text-sm min-w-[560px]">
                    <caption className="sr-only">Anúncios com GMV fora do Full</caption>
                    <thead className="bg-raised sticky top-0">
                      <tr>
                        <th scope="col" className="text-left px-3 py-2 font-semibold text-ink-muted">Anúncio</th>
                        <th scope="col" className="text-left px-3 py-2 font-semibold text-ink-muted">Marca</th>
                        <th scope="col" className="text-left px-3 py-2 font-semibold text-ink-muted">Comportamento</th>
                        <th scope="col" className="text-right px-3 py-2 font-semibold text-ink-muted">GMV não-Full</th>
                        <th scope="col" className="text-right px-3 py-2 font-semibold text-ink-muted">GMV Full</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.migration_opportunities.map((o) => (
                        <tr key={`${o.brand}-${o.item_id}`} className="border-t border-line">
                          <td className="px-3 py-2 font-mono text-xs text-ink">{o.item_id}</td>
                          <td className="px-3 py-2 text-ink-muted">{o.brand}</td>
                          <td className="px-3 py-2 text-ink-muted">
                            {o.listing_class === "mixed" ? "Misto" : "Somente não-Full"}
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums font-medium"><Reais v={o.non_full_gmv} /></td>
                          <td className="text-right px-3 py-2 tabular-nums text-ink-muted"><Reais v={o.full_gmv} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {/* --- Qualidade ------------------------------------------------- */}
          <section
            aria-labelledby="full-ml-qualidade"
            className="bg-surface border border-line rounded-xl p-4 flex flex-col gap-2"
          >
            <h2 id="full-ml-qualidade" className="text-sm font-semibold text-ink">
              Qualidade
            </h2>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <dt className="text-xs text-ink-muted">Pedidos sem envio</dt>
                <dd className="font-semibold tabular-nums">{fmtCount(dados.quality.unknown_logistic_type_orders)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Envios sem itens</dt>
                <dd className="font-semibold tabular-nums">{fmtCount(dados.quality.missing_shipping_items)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Janela completa</dt>
                <dd className="font-semibold">{dados.quality.is_complete ? "Sim" : "Não"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Última carga</dt>
                <dd className="font-semibold text-xs">
                  {dados.freshness.refreshed_at ? `${dm(dados.freshness.refreshed_at)} ${dados.freshness.refreshed_at.slice(11, 16)}` : SEM_DADO}
                </dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </Aba>
  );
}

export default function FullMLClient() {
  return (
    <Suspense fallback={<PageContainer><div className="h-64" /></PageContainer>}>
      <FullMLPageInner />
    </Suspense>
  );
}
