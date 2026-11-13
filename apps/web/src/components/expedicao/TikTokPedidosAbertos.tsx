"use client";

/**
 * EXPEDICAO-TIKTOK-ABERTOS — "quais pedidos do TikTok estao em aberto agora?"
 *
 * O mesmo modelo do "Risco atual" da Shopee e do Mercado Livre: vencidos em
 * destaque e, ao lado, vence hoje, vence no proximo dia util e acima de 48 h,
 * todos clicaveis (lista dos pedidos, quebra por marca e etapa, CSV). A tabela
 * por marca vira o "Backlog por marca", como nos outros canais
 * (EXPEDICAO-TIKTOK-PADRAO).
 *
 * Fonte: `/api/v1/expedicao/tiktok/abertos` (Data Mart ao vivo). O prazo e'
 * RECONSTRUIDO da politica (despacho 1 dia util, coleta 2 dias uteis), como
 * na LDR do TikTok — dito na descricao da secao e no rodape do popup.
 */
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, Clock, Hourglass } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import TikTokColetaPerdida, { BotaoCsvCompleto, baixarCsv } from "@/components/expedicao/TikTokColetaPerdida";
import { EstadoSecao } from "@/components/expedicao/LayoutExpedicao";
import type { ItemAtencao as ItemFila } from "@/components/ui/FilaAtencao";
import EvolucaoPorMarca from "@/components/expedicao/EvolucaoPorMarca";
import CartaoIndicador from "@/components/ui/CartaoIndicador";
import type { IdentidadeKpi } from "@/components/ui/KpiTile";
import InfoDica from "@/components/ui/InfoDica";
import ConsolidadoEtapas from "./ConsolidadoEtapas";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { formatarHoras } from "@/lib/expedicao-contract";
import { buscarExpedicao } from "@/lib/expedicao-demo";
import { formatarDecimal, formatarInteiro } from "@/lib/expedicao-formato";
import { diasDeBacklog, mediaDaMarca, textoDoPace } from "@/lib/expedicao-pace";
import { usePaceDespachados } from "@/components/expedicao/usePaceDespachados";
import {
  CONFIG_LISTA,
  ROTULO_ETAPA,
  buscarTodasAsPaginas,
  csvDosAbertos,
  diaCurto,
  etapasDaLista,
  valorDaLista,
  faixaDaPagina,
  instanteCurto,
  nomeDoCsvAbertos,
  ondeAgirNosAbertos,
  queryAbertos,
  type ListaAbertos,
  type RespostaAbertos,
} from "@/lib/expedicao-tiktok-abertos";
import { percentualDaFila } from "@/lib/expedicao-travados";
import { brandLabel } from "@/lib/filters/brands";

type Carga = { tipo: "carregando" } | { tipo: "erro" } | { tipo: "ok"; dados: RespostaAbertos };

function pct(n: number, base: number): string {
  return base > 0
    ? `${((n / base) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
    : "—";
}

// ---------------------------------------------------------------------------
// Popup com a lista
// ---------------------------------------------------------------------------
/** IDENTIDADE-GERENCIAL: o popup herda o ladrilho e a cor do cartao que o abriu. */
const VISUAL_DA_LISTA: Partial<Record<ListaAbertos, { icone: typeof Clock; identidade: IdentidadeKpi }>> = {
  due_today: { icone: Clock, identidade: "pedidos" },
  due_next_day: { icone: CalendarClock, identidade: "gmv" },
  due_soon: { icone: Clock, identidade: "prazo" },
  over_48h: { icone: Hourglass, identidade: "prazo" },
};

function PopupAbertos({
  api,
  marca,
  lista,
  total,
  aoFechar,
}: {
  api: string;
  marca: string | null;
  lista: ListaAbertos | null;
  total: number;
  aoFechar: () => void;
}) {
  const [carga, setCarga] = useState<Carga>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const [pagina, setPagina] = useState(1);

  // Outra lista ou outra marca recomeca da primeira pagina.
  useEffect(() => setPagina(1), [marca, lista]);

  useEffect(() => {
    if (!lista) return;
    let vivo = true;
    setCarga({ tipo: "carregando" });
    buscarExpedicao(`${api}${queryAbertos(marca, lista, pagina)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const dados = (await r.json()) as RespostaAbertos;
        if (vivo) setCarga(dados.orders_unavailable ? { tipo: "erro" } : { tipo: "ok", dados });
      })
      .catch(() => vivo && setCarga({ tipo: "erro" }));
    return () => {
      vivo = false;
    };
  }, [api, marca, lista, pagina, tentativa]);

  const cfg = lista ? CONFIG_LISTA[lista] : null;
  const pedidos = carga.tipo === "ok" ? carga.dados.orders : [];
  const dados = carga.tipo === "ok" ? carga.dados : null;
  const variasMarcas = !marca && (dados?.brands.length ?? 0) > 1;
  // Quebras EXATAS, do resumo que vem em toda pagina — nunca so' da pagina.
  const totalLista = dados && lista ? dados.list_total : total;
  const porMarca =
    dados && lista
      ? dados.brands
          .map((b) => ({ rotulo: brandLabel(b.brand), n: valorDaLista(lista, b) }))
          .filter((b) => b.n > 0)
          .sort((a, b) => b.n - a.n)
      : [];
  const porEtapa = dados && lista ? etapasDaLista(lista, dados.totals, totalLista) : [];
  const temMaisDeUmaPagina = Boolean(dados && (dados.has_more || pagina > 1));

  return (
    <KpiDrilldownDialog open={Boolean(lista)} onClose={aoFechar} title={cfg?.titulo ?? ""} largura="larga" focusResetKey={lista ?? ""}
      icone={lista ? VISUAL_DA_LISTA[lista]?.icone : undefined}
      identidade={lista ? VISUAL_DA_LISTA[lista]?.identidade : undefined}
    >
      {lista && cfg ? (
        <div className="flex flex-col gap-4 text-sm" data-testid="exp-tiktok-abertos-popup">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
            <span className={`text-[32px] font-bold leading-none tracking-tight tabular-nums ${lista === "overdue" ? "text-crit-ink" : "text-ink"}`}>
              {formatarInteiro(total)}
            </span>
            <span className="pb-0.5 text-xs text-ink-faint">{marca ? brandLabel(marca) : "todas as marcas"}</span>
          </div>
          {/* EXPEDICAO-POPUP-ETAPAS: % de cada etapa sobre a lista INTEIRA, logo
              abaixo do total -- inclusive quando e' 100% numa etapa so'. */}
          <ConsolidadoEtapas itens={porEtapa} total={totalLista} />

          {carga.tipo === "carregando" ? (
            <StateBlock compacto tipo="carregando" titulo="Carregando pedidos…" />
          ) : carga.tipo === "erro" ? (
            <StateBlock
              compacto
              tipo="erro"
              titulo="Não foi possível carregar os pedidos."
              acao={<RetryButton onClick={() => setTentativa((n) => n + 1)} />}
            />
          ) : pedidos.length === 0 ? (
            <StateBlock compacto tipo="vazio" titulo={cfg.vazio} />
          ) : (
            <>
              {porMarca.length > 1 ? (
                <DrilldownSecao titulo="Por marca">
                  <ul className="flex flex-col">
                    {porMarca.map((i) => (
                      <EvidenceRow key={i.rotulo} label={i.rotulo} pct={(i.n / totalLista) * 100} barra="bg-warn"
                        value={`${formatarInteiro(i.n)} · ${pct(i.n, totalLista)}`} />
                    ))}
                  </ul>
                </DrilldownSecao>
              ) : null}
              <DrilldownSecao
                titulo="Pedidos"
                acao={
                  <>
                    <span className="tabular-nums">
                      {dados
                        ? `${faixaDaPagina(pagina, dados.page_size, pedidos.length, totalLista)} · prazo mais antigo primeiro`
                        : "prazo mais antigo primeiro"}
                    </span>
                    <BotaoCsvCompleto
                      total={totalLista}
                      testId="exp-tiktok-abertos-csv"
                      baixar={async (aoAvancar) => {
                        const todos = await buscarTodasAsPaginas(async (p) => {
                          const r = await buscarExpedicao(`${api}${queryAbertos(marca, lista, p)}`, { cache: "no-store" });
                          if (!r.ok) throw new Error(String(r.status));
                          const d = (await r.json()) as RespostaAbertos;
                          if (d.availability !== "available" || d.orders_unavailable) throw new Error("indisponivel");
                          return d;
                        }, aoAvancar);
                        baixarCsv(csvDosAbertos(todos), nomeDoCsvAbertos(lista, marca, new Date()));
                      }}
                    />
                  </>
                }
              >
                <div className="max-h-[50vh] overflow-auto rounded-lg border border-line">
                  <table className="w-full text-sm [&_td]:px-3 [&_td]:py-1.5 [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-1.5">
                    <caption className="sr-only">{cfg.titulo}, prazo mais antigo primeiro</caption>
                    <thead className="sticky top-0 bg-raised text-left text-xs uppercase tracking-wide text-ink-faint">
                      <tr>
                        <th scope="col">Pedido</th>
                        {variasMarcas ? <th scope="col">Marca</th> : null}
                        <th scope="col">Etapa</th>
                        <th scope="col">Pago em</th>
                        <th scope="col">Prazo</th>
                        <th scope="col" className="text-right">Aberto há</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pedidos.map((p) => (
                        <tr key={p.order_id} className="border-t border-line">
                          <td className="whitespace-nowrap font-mono text-xs text-ink">{p.order_id}</td>
                          {variasMarcas ? <td className="whitespace-nowrap text-ink">{brandLabel(p.brand)}</td> : null}
                          <td className="whitespace-nowrap font-medium text-ink">{ROTULO_ETAPA[p.stage] ?? p.stage}</td>
                          <td className="whitespace-nowrap tabular-nums text-ink-muted">{instanteCurto(p.paid_at)}</td>
                          <td className={`whitespace-nowrap tabular-nums ${p.situation === "overdue" ? "font-semibold text-crit-ink" : "text-ink-muted"}`}>
                            {diaCurto(p.deadline)}
                          </td>
                          <td className="whitespace-nowrap text-right font-semibold tabular-nums text-ink">{formatarHoras(p.hours_open)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {temMaisDeUmaPagina && dados ? (
                  <nav aria-label="Páginas da lista" className="mt-2 flex items-center justify-between gap-3" data-testid="exp-tiktok-abertos-paginas">
                    <button
                      type="button"
                      onClick={() => setPagina((n) => Math.max(1, n - 1))}
                      disabled={pagina <= 1}
                      className="inline-flex min-h-11 items-center gap-1 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink hover:border-line-strong disabled:cursor-default disabled:opacity-40"
                    >
                      <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                      Anterior
                    </button>
                    <span className="text-xs tabular-nums text-ink-muted" aria-live="polite">
                      Página {formatarInteiro(pagina)} de {formatarInteiro(Math.max(pagina, Math.ceil(totalLista / dados.page_size)))}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPagina((n) => n + 1)}
                      disabled={!dados.has_more}
                      className="inline-flex min-h-11 items-center gap-1 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink hover:border-line-strong disabled:cursor-default disabled:opacity-40"
                    >
                      Próxima
                      <ChevronRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </nav>
                ) : null}
              </DrilldownSecao>
            </>
          )}
          {/* EXPEDICAO-SEM-TEXTAO: a ressalva do prazo ja' esta' no chip da pagina. */}
        </div>
      ) : null}
    </KpiDrilldownDialog>
  );
}

// ---------------------------------------------------------------------------
// Dados (uma busca, duas secoes)
// ---------------------------------------------------------------------------
export type AbertosTikTok = {
  carga: Carga;
  carregar: () => void;
  abrir: (lista: ListaAbertos, total: number, marca?: string | null) => void;
  /** O popup da lista, montado UMA vez pelo painel. */
  popup: ReactNode;
};

/**
 * EXPEDICAO-TIKTOK-PADRAO — os pedidos em aberto alimentam DUAS secoes do
 * esqueleto comum: o "Risco atual" (cartoes) e o "Backlog por marca"
 * (tabela). Uma busca so', um popup so'.
 */
export function useTikTokAbertos(api: string, marca: string | null): AbertosTikTok {
  const [carga, setCarga] = useState<Carga>({ tipo: "carregando" });
  const [aberta, setAberta] = useState<{ lista: ListaAbertos; total: number; marca: string | null } | null>(null);

  const carregar = useCallback(async () => {
    setCarga({ tipo: "carregando" });
    try {
      const r = await buscarExpedicao(`${api}${queryAbertos(marca)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setCarga({ tipo: "ok", dados: (await r.json()) as RespostaAbertos });
    } catch {
      setCarga({ tipo: "erro" });
    }
  }, [api, marca]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return {
    carga,
    carregar: () => void carregar(),
    abrir: (lista, total, m = marca) => setAberta({ lista, total, marca: m }),
    popup: (
      <PopupAbertos
        api={api}
        marca={aberta?.marca ?? null}
        lista={aberta?.lista ?? null}
        total={aberta?.total ?? 0}
        aoFechar={() => setAberta(null)}
      />
    ),
  };
}

const DICA_ABERTOS =
  "Pedidos pagos nos últimos 30 dias que ainda não saíram: aguardando envio (sem NF-e, na mesa de embalo) ou " +
  "aguardando coleta (embalado, com NF-e). Prazo reconstruído pela política do TikTok: envio até 1 dia útil e " +
  "coleta até 2 dias úteis após o pagamento.";

function EstadoAbertos({ abertos }: { abertos: AbertosTikTok }) {
  const carregando = abertos.carga.tipo === "carregando";
  return (
    <EstadoSecao
      tipo={carregando ? "carregando" : "erro"}
      titulo={carregando ? "Carregando os pedidos em aberto…" : "Não foi possível carregar os pedidos em aberto do TikTok."}
      aoTentarDeNovo={carregando ? undefined : abertos.carregar}
    />
  );
}

function prontos(abertos: AbertosTikTok): RespostaAbertos | null {
  return abertos.carga.tipo === "ok" && abertos.carga.dados.availability === "available" ? abertos.carga.dados : null;
}

// ---------------------------------------------------------------------------
// Heroi, faixa e "onde agir" — IDENTIDADE-GERENCIAL (spec do Prumo, 08/11/2026)
// ---------------------------------------------------------------------------
/** Vencidos por etapa: duas faixas do MESMO vencido (tom unico, tons de crit). */
function BarraDasEtapas({ coleta, envio }: { coleta: number; envio: number }) {
  const total = coleta + envio;
  const larg = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0%");
  const texto = `${formatarInteiro(coleta)} aguardando coleta · ${formatarInteiro(envio)} aguardando envio`;
  return (
    <div data-testid="exp-tiktok-etapas">
      <div className="flex h-3.5 overflow-hidden rounded-full bg-raised" role="img" aria-label={texto}>
        <div className="tc-barra bg-crit" style={{ width: larg(coleta) }} />
        <div className="tc-barra bg-crit/45" style={{ width: larg(envio) }} />
      </div>
      <ul className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-ink-muted tabular-nums" aria-hidden="true">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-crit" />
          <b className="font-semibold text-ink">{formatarInteiro(coleta)}</b> aguardando coleta
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-crit/45" />
          <b className="font-semibold text-ink">{formatarInteiro(envio)}</b> aguardando envio
        </li>
      </ul>
    </div>
  );
}

/**
 * ALVO-GRADE: o antigo meio do heroi, agora o painel ao lado de "O que exige
 * atenção": os vencidos de AGORA por etapa (aguardando coleta x envio).
 */
export function PainelEtapasTikTok({ abertos }: { abertos: AbertosTikTok }) {
  const t = prontos(abertos)?.totals ?? null;
  return (
    <div data-testid="exp-tiktok-abertos" className="contents">
      <Panel titulo="Vencidos por etapa">
        {t ? <BarraDasEtapas coleta={t.overdue_collection} envio={t.overdue_shipment} /> : <EstadoAbertos abertos={abertos} />}
      </Panel>
    </div>
  );
}

/**
 * Os QUATRO cartoes dos abertos (ALVO-GRADE): Vencidos (o antigo heroi), vence
 * hoje, vence no proximo dia util e acima de 48 h. Sem serie nem periodo
 * anterior para os abertos: sem linha de tendencia; a barra mostra a fracao
 * medida. Sem a carga, "N/D" com o motivo: ausencia nunca vira 0.
 */
export function cartoesDosAbertos(abertos: AbertosTikTok): ReactNode {
  const d = prontos(abertos);
  const t = d?.totals ?? null;
  const motivo = abertos.carga.tipo === "carregando" ? "Carregando os pedidos em aberto." : "Pedidos em aberto indisponíveis agora.";
  const proximo = d ? diaCurto(d.next_business_day) : "próximo dia útil";
  const cartao = (
    lista: ListaAbertos,
    rotulo: string,
    n: number | undefined,
    icone: typeof Clock,
    alerta: boolean,
    // Cor de identidade (a mesma da Shopee/ML); estado so' na pilula.
    cor: string,
  ) => {
    const medido = t && n !== undefined;
    return (
      <CartaoIndicador
        key={lista}
        icone={icone}
        cor={cor}
        rotulo={rotulo}
        valor={medido ? pct(n, t.open) : null}
        pilula={
          !medido
            ? null
            : lista === "overdue"
              ? n > 0
                ? { texto: "Com atraso", tom: "crit" }
                : { texto: "Em dia", tom: "ok" }
              : { texto: `${formatarInteiro(n)} pedidos`, tom: alerta && n > 0 ? "warn" : "neutro" }
        }
        progresso={medido && t.open > 0 ? n / t.open : null}
        legenda={!medido ? motivo : undefined}
        // Sem serie, o "x de y" ocupa o lugar da linha: a barra fica inteira na linha de apoio.
        rodape={medido && lista === "overdue" ? `${formatarInteiro(n)} de ${formatarInteiro(t.open)} em aberto` : undefined}
        ajuda={lista === "overdue" ? <InfoDica texto={DICA_ABERTOS} emControle={Boolean(medido && n)} /> : undefined}
        onAbrir={medido && n ? () => abertos.abrir(lista, n) : undefined}
      />
    );
  };
  return (
    <>
      {cartao("overdue", "Vencidos", t?.overdue, AlertTriangle, true, "rgb(var(--tc-crit))")}
      {cartao("due_today", "Vence hoje", t?.due_today, Clock, true, "rgb(var(--tc-kpi-pedidos))")}
      {cartao("due_next_day", `Vence ${proximo}`, t?.due_next_day, CalendarClock, false, "rgb(var(--tc-kpi-gmv))")}
      {cartao("over_48h", "Acima de 48 h", t?.over_48h, Hourglass, true, "rgb(var(--tc-kpi-prazo))")}
    </>
  );
}

/** "Onde agir": a marca que concentra os vencidos — 1º item da fila. */
export function ondeAgirTikTok(abertos: AbertosTikTok): ItemFila | null {
  const d = prontos(abertos);
  const o = d ? ondeAgirNosAbertos(d.totals, d.brands, brandLabel) : null;
  return o ? { chave: `onde-agir-${o.chave}`, severidade: o.tom, titulo: o.texto } : null;
}

// ---------------------------------------------------------------------------
// Backlog por marca — o MESMO titulo e o mesmo painel da Shopee e do ML
// ---------------------------------------------------------------------------
const DICAS_DA_TABELA = {
  vencidos: <InfoDica texto="Passaram do prazo reconstruído (envio até 1 dia útil, coleta até 2 dias úteis após o pagamento)." />,
  pertoDeVencer: <InfoDica texto="Vencem hoje ou no próximo dia útil, pelo prazo reconstruído." />,
  acima48h: <InfoDica texto="Pagos há mais de 48 h e ainda em aberto." />,
};

export function BacklogPorMarcaTikTok({
  abertos,
  api,
  marca,
}: {
  abertos: AbertosTikTok;
  api: string;
  marca: string | null;
}) {
  const pace = usePaceDespachados(api, "tiktok", true);
  const d = prontos(abertos);
  if (!d) {
    return (
      <Panel titulo="Backlog por marca">
        <EstadoAbertos abertos={abertos} />
      </Panel>
    );
  }
  const t = d.totals;
  const proximo = diaCurto(d.next_business_day);
  return (
    <Panel
      semPadding
      titulo="Backlog por marca"
      acao={<InfoDica texto={`${DICA_ABERTOS} Sem tendência nem travados: o TikTok não informa o histórico da fila.`} />}
      descricao={`${formatarInteiro(t.open)} em aberto`}
      // EXPEDICAO-TIKTOK-COLETA-PERDIDA: por dia de prazo, inclusive os ja' coletados depois.
      rodape={
        <div className="flex flex-col gap-2">
          <TikTokColetaPerdida api={api} marca={marca} embutida />
        </div>
      }
    >
      {d.brands.length ? (
        // EXPEDICAO-TIKTOK-PADRAO: a MESMA tabela da Shopee e do ML. Travados e
        // Tendencia ficam fora: o TikTok nao fotografa a fila por etapa nem
        // tem serie por hora (ver o ⓘ do titulo).
        <div className="px-4 py-3">
          <EvolucaoPorMarca
            resposta={null}
            semTendencia
            semBarra
            ajudas={DICAS_DA_TABELA}
            corBacklog="rgb(var(--tc-canal-tiktok))"
            ajudaPace={<InfoDica texto={textoDoPace("tiktok", pace)} />}
            fila={d.brands.map((b) => {
              const perto = b.due_today + b.due_next_day;
              const media = mediaDaMarca(pace, "tiktok", b.brand);
              return {
                conta: b.brand,
                titulo: brandLabel(b.brand),
                apelido: null,
                backlog: b.open,
                diasDeBacklog: formatarDecimal(diasDeBacklog(b.open, media), 1),
                ritmo: formatarDecimal(media, 0),
                vencidos: b.overdue,
                pctVencidos: percentualDaFila(b.overdue, b.open),
                aoVerVencidos: b.overdue > 0 ? () => abertos.abrir("overdue", b.overdue, b.brand) : undefined,
                pertoDeVencer: perto,
                pctPertoDeVencer: percentualDaFila(perto, b.open),
                aoVerPertoDeVencer: perto > 0 ? () => abertos.abrir("due_soon", perto, b.brand) : undefined,
                aoVerBacklog: b.open > 0 ? () => abertos.abrir("all", b.open, b.brand) : undefined,
                acima48h: b.over_48h,
                aoVerAcima48h: b.over_48h > 0 ? () => abertos.abrir("over_48h", b.over_48h, b.brand) : undefined,
                travados: null,
              };
            })}
          />
        </div>
      ) : (
        <p role="status" className="px-4 py-3 text-sm text-ink-muted">
          Nenhum pedido do TikTok em aberto neste recorte.
        </p>
      )}
    </Panel>
  );
}
