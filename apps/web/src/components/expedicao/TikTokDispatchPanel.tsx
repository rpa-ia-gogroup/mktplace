"use client";

/**
 * Gate EXP-TK-OPS-1/2 — painel da LDR do TikTok Shop.
 * Retematizado no UX-TORRE-1.
 *
 * Componente PROPRIO, e nao um ramo dentro do `ExpedicaoClient`. Aquele serve
 * dois canais ja em producao e tem 43 KB; o TikTok tem outra forma de dado
 * (coorte por prazo, nao fila paginada), outros estados e outra pergunta. Um
 * `if (canal === "tiktokshop")` espalhado por ele poria Shopee e Mercado Livre
 * em risco a cada ajuste aqui.
 *
 * A tela responde, nesta ordem:
 *   1. estamos dentro da regua do TikTok?  -> cartao da LDR contra a meta de 4%
 *   2. quando o atraso comecou?            -> faixa do incidente + grafico
 *   3. quantos pedidos afetados?           -> cartoes de contagem
 *   4. quais lojas concentram?             -> tabela por marca
 *   5. quantos ainda da' para tratar?      -> cartao "ainda no prazo"
 *
 * As duas leituras aparecem SEPARADAS e NOMEADAS: a LDR (denominador = quem
 * vence no periodo) e o fluxo por data de pagamento (denominador = quem pagou
 * no dia). A segunda e' a visao que a gestao usa; usa-la como se fosse a LDR
 * inflaria a taxa toda vez que um feriado empurrasse tres dias de pagamento
 * para o mesmo vencimento.
 *
 * UX-TORRE-1 — O `dark:` ORFAO
 * ----------------------------
 * Este arquivo era o UNICO da Torre com classes `dark:*`, numa aplicacao sem
 * tema escuro global: quando o sistema operacional pedia escuro, so' este
 * painel ficava preto dentro de uma tela clara. Isso nunca foi significado de
 * negocio — era inconsistencia visual. Os pares `x dark:y` foram trocados pelo
 * token semantico correspondente, que ja' muda de valor com o tema. Nenhuma
 * severidade mudou de cor: `critico` continua sendo o papel critico.
 *
 * EXPEDICAO-UX-UNIFICADA-1 — A MESMA HIERARQUIA DA FILA
 * ----------------------------------------------------
 * Cabecalho, fotografia e barra de qualidade sao os componentes da fila
 * (`CabecalhoExpedicao`, `BarraDeQualidade`, `FilaAtencao`). O CORPO continua
 * sendo deste painel: nao existe fila do TikTok e nenhuma foi inventada.
 *
 *   visao do gestor   (IDENTIDADE-GERENCIAL) heroi (vencidos dos abertos) ->
 *                     faixa (vence hoje/proximo dia util/+48 h/LDR) -> fila de
 *                     atencao -> backlog por marca -> evolucao 7/12 | lojas
 *                     5/12 -> LDR 7 dias -> "Mais detalhes" (janela da LDR,
 *                     jornada, nota oficial)
 *   detalhe           LDR -> coortes por vencimento -> lojas -> fluxo por
 *                     data de pagamento (visao auxiliar, NUNCA a LDR)
 *
 * O que mudou de lugar, e por que:
 *   - o aviso de prazo reconstruido e os alertas eram uma PILHA de banners
 *     antes do primeiro numero. O aviso entrou na barra de qualidade (e segue
 *     colado ao periodo, ao lado da LDR); os alertas viraram as linhas de
 *     "O que exige atenção agora", com o texto da API, sem reescrita;
 *   - sem nenhum vencimento fechado (o caso da serie vencida), o grafico vira
 *     uma linha: um retangulo de 224 px sem barra nao informa nada;
 *   - o fluxo por pagamento desceu para o detalhe. Lado a lado com a LDR na
 *     primeira dobra, os dois denominadores competiam pela mesma leitura.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import BarraDeQualidade from "@/components/expedicao/BarraDeQualidade";
import cabecalhoExpedicao, { SeletorMarca, SeletorPeriodo } from "@/components/expedicao/CabecalhoExpedicao";
import JanelaPersonalizada from "@/components/expedicao/JanelaPersonalizada";
import JornadaPedidos, { useJornada } from "@/components/expedicao/JornadaPedidos";
import {
  BacklogPorMarcaTikTok,
  PainelEtapasTikTok,
  cartoesDosAbertos,
  ondeAgirTikTok,
  useTikTokAbertos,
} from "@/components/expedicao/TikTokPedidosAbertos";
import { PopupColetaPerdida } from "@/components/expedicao/TikTokColetaPerdida";
import { diaDentroDaJanelaDaLista } from "@/lib/expedicao-tiktok-abertos";
import LayoutExpedicao, {
  type Moldura,
  CLASSE_CABECALHO,
  CLASSE_RAIZ_EXPEDICAO,
  CLASSE_TABELA,
  CorpoGestor,
  TEXTO_ESTADO,
} from "@/components/expedicao/LayoutExpedicao";
import DeltaBadge from "@/components/ui/DeltaBadge";
import { Ajuda, KpiComAjuda, TaxaComBase } from "@/components/expedicao/KpiComAjuda";
import PainelAtencao from "@/components/expedicao/PainelAtencao";
import EvolucaoPorVencimento, { TEXTO_SEVERIDADE } from "@/components/expedicao/EvolucaoPorVencimento";
import { FaixaKpis, SecaoGerencial } from "@/components/expedicao/SecoesExpedicao";
import Chip from "@/components/ui/Chip";
import FilaAtencao, { type ItemAtencao as ItemFila } from "@/components/ui/FilaAtencao";
import MaisDetalhes from "@/components/ui/MaisDetalhes";
import { Gauge } from "lucide-react";
import InfoDica from "@/components/ui/InfoDica";
import Note from "@/components/ui/Note";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import SortHeaderComAjuda from "@/components/expedicao/SortHeaderComAjuda";
import SortHeader from "@/components/ui/SortHeader";
import KpiCardSkeleton from "@/components/ui/KpiCardSkeleton";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import type { Visao } from "@/lib/expedicao-ux";
import { useSortableTable, type SortColumnType } from "@/lib/use-sortable-table";

import {
  DEFINICAO_TIKTOK,
  EVENTOS,
  EVENTO_PADRAO,
  EXPLICACAO_META,
  META_TIKTOK_LDR,
  ROTULO_EVENTO_CURTO,
  ROTULO_META,
  ROTULO_SEVERIDADE,
  TITULO_FLUXO,
  VALOR_SEM_TAXA,
  explicarIndisponivelComMarca,
  deltaDaLdr,
  formatarDiaCurto,
  formatarDiaLongo,
  serieDaLdr,
  formatarInteiro,
  formatarTaxa,
  fotografiaDoTikTok,
  marcasForaDaMeta,
  alertasNaFila,
  montarAtencaoDoTikTok,
  montarBarraDeQualidadeTikTok,
  queryDoTikTok,
  severidadeDoDia,
  type Evento,
  type TikTokMarca,
  type TikTokPayload,
} from "@/lib/expedicao-tiktok-contract";
import { buscarExpedicao } from "@/lib/expedicao-demo";
import {
  OPCAO_PERSONALIZADA,
  REGRA_JANELA,
  lerDiasDaUrl,
  opcoesDoSeletor,
  urlComDias,
  valorDoSeletor,
} from "@/lib/expedicao-janela";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/** Janela do TikTok: dias, de 1 a 90, que e' a unidade da propria API. */
const REGRA = REGRA_JANELA.tiktok;

/**
 * A casca so' monta este painel DEPOIS de ler a URL no cliente, entao ler
 * `window` aqui nao diverge de HTML de servidor nenhum — e evita disparar a
 * janela padrao antes da janela do link. A guarda cobre um render fora do
 * navegador.
 */
function janelaInicial(): { dias: number; descartado: boolean } {
  if (typeof window === "undefined") return { dias: REGRA.padrao, descartado: false };
  return lerDiasDaUrl(window.location.search, REGRA);
}

// T-0010: CLASSE_TABELA e CLASSE_CABECALHO vem do esqueleto comum.

const COLUNAS_MARCA: Record<string, SortColumnType> = {
  loja: "text",
  base: "numeric",
  late: "numeric",
  rate: "numeric",
};

function valorDaMarca(m: TikTokMarca, coluna: string): string | number | null {
  if (coluna === "loja") return m.shop_name ?? m.brand;
  if (coluna === "base") return m.base;
  if (coluna === "late") return m.late;
  return m.rate;
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
export default function TikTokDispatchPanel({
  moldura,
  visao = "gestor",
  aoTrocarVisao,
  marca = null,
  aoTrocarMarca,
  faixaTopo,
  performance,
  itensOficiais = [],
}: {
  /** ALVO-GRADE: a moldura `Aba` da casca (titulo + abas de canal). */
  moldura: Moldura;
  visao?: Visao;
  aoTrocarVisao?: (v: Visao) => void;
  /** EXPEDICAO-UX-3: marca da casca; vai para a API como `brands`. */
  marca?: string | null;
  aoTrocarMarca?: (m: string | null) => void;
  /** CX-MKT-3: faixa de LDR da casca (LdrTopo), repassada ao esqueleto. */
  faixaTopo?: ReactNode;
  /** CX-MKT-2: Performance oficial, dentro de "Mais detalhes" no gestor. */
  performance?: ReactNode;
  /** Metricas oficiais fora do limite: sobem para "O que exige atenção agora". */
  itensOficiais?: ItemFila[];
}) {
  const [evento, setEvento] = useState<Evento>(EVENTO_PADRAO);
  const [inicial] = useState(janelaInicial);
  const [dias, setDias] = useState<number>(inicial.dias);
  const [personalizado, setPersonalizado] = useState(false);
  const [janelaDescartada, setJanelaDescartada] = useState(inicial.descartado);
  const [dados, setDados] = useState<TikTokPayload | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [erro, setErro] = useState<string>("");
  // EXPEDICAO-TIKTOK-COLETA-PERDIDA: dia clicado na evolucao (popup dos vencidos).
  const [diaVencido, setDiaVencido] = useState<string | null>(null);

  const url = useMemo(() => `${BASE}${queryDoTikTok(evento, dias, marca)}`, [evento, dias, marca]);
  // Com o campo livre a janela troca mais rapido: a resposta de uma janela
  // antiga que chega por ultimo NAO pode sobrescrever a atual.
  const urlVigente = useRef(url);
  urlVigente.current = url;

  const carregar = useCallback(async () => {
    setEstado("carregando");
    try {
      const r = await buscarExpedicao(url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as TikTokPayload;
      if (urlVigente.current !== url) return;
      setDados(json);
      setEstado("ok");
    } catch (e) {
      if (urlVigente.current !== url) return;
      setErro(e instanceof Error ? e.message : "falha de rede");
      setEstado("erro");
    }
  }, [url]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // `?dias=` invalido no link: usa o padrao e tira o lixo da URL.
  useEffect(() => {
    if (inicial.descartado) {
      window.history.replaceState(null, "", urlComDias(window.location.href, inicial.dias, REGRA));
    }
  }, [inicial]);

  // Voltar/avancar do navegador pode trocar a janela sem remontar o painel.
  useEffect(() => {
    const aoVoltar = () => {
      const lida = lerDiasDaUrl(window.location.search, REGRA);
      setDias(lida.dias);
      setPersonalizado(false);
      setJanelaDescartada(lida.descartado);
    };
    window.addEventListener("popstate", aoVoltar);
    return () => window.removeEventListener("popstate", aoVoltar);
  }, []);

  const aplicarJanela = useCallback((novo: number) => {
    setDias(novo);
    setJanelaDescartada(false);
    window.history.replaceState(null, "", urlComDias(window.location.href, novo, REGRA));
  }, []);

  const escolherJanela = useCallback(
    (valor: string) => {
      if (valor === OPCAO_PERSONALIZADA) {
        setPersonalizado(true);
        return;
      }
      setPersonalizado(false);
      aplicarJanela(Number(valor));
    },
    [aplicarJanela],
  );
  const seletor = valorDoSeletor(dias, REGRA, personalizado);

  // T-0010: a jornada usa a mesma janela e o mesmo evento do painel.
  const jornada = useJornada(BASE, "tiktok", marca, { dias, evento });

  const ldr = dados?.ldr ?? null;
  const fluxo = dados?.payment_flow ?? [];
  const piores = marcasForaDaMeta(dados?.brands ?? []);
  const fotografia = fotografiaDoTikTok(dados);
  const barra = montarBarraDeQualidadeTikTok(dados);
  const atencao = montarAtencaoDoTikTok(dados);
  const semVencimentoFechado = ldr ? ldr.mature_due_days === 0 : false;
  const publicadaEm = dados?.snapshot
    ? new Date(dados.snapshot.effective_at).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : null;
  // Ordenacao client-side sobre `brands`, que vem INTEIRO no payload. Nao ha
  // paginacao aqui, entao ordenar nao esconde linha nenhuma nem recalcula
  // metrica: as taxas continuam sendo as que a API publicou.
  const { sort, toggleSort, sortedRows } = useSortableTable<TikTokMarca>(
    dados?.brands ?? [],
    valorDaMarca,
    COLUNAS_MARCA,
  );

  // EXPEDICAO-TIKTOK-PADRAO: cada controle e' um item da MESMA faixa de
  // Profundidade e Marca (antes os dois iam juntos e quebravam numa segunda
  // linha), e a janela se chama "Período", como na Shopee e no ML.
  const controles = (
    <>
      <SeletorPeriodo
        opcoes={opcoesDoSeletor(REGRA)}
        valor={seletor}
        dias={dias}
        aoEscolher={escolherJanela}
        personalizado={<JanelaPersonalizada max={REGRA.max} diasAplicados={dias} aoAplicar={aplicarJanela} />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span id="tk-evento" className="text-xs text-ink-faint">
          Evento
        </span>
        <Segmented
          rotulo="Evento"
          rotuladoPor="tk-evento"
          opcoes={EVENTOS.map((e) => ({ valor: e, texto: ROTULO_EVENTO_CURTO[e] }))}
          valor={evento}
          aoEscolher={setEvento}
        />
      </div>
    </>
  );

  // IDENTIDADE-GERENCIAL — 1a dobra: heroi (vencidos dos abertos de AGORA),
  // faixa (vence hoje, proximo dia util, +48 h e a LDR da janela) e a fila.
  const abertos = useTikTokAbertos(BASE, marca);

  // A LDR da janela sobe da secao "Prazo" para a faixa.
  const deltaLdr = ldr ? deltaDaLdr(ldr) : null;
  const cartaoLdr = ldr ? (
    <KpiComAjuda
      ajuda="tiktok.ldr"
      variante="gerencial"
      icone={Gauge}
      // CARDS-KPIBAND: sparkline dos vencimentos FECHADOS; delta em p.p. contra
      // a janela anterior do mesmo tamanho (API-2), so' com as duas taxas.
      identidade="ticket"
      serie={serieDaLdr(ldr.daily)}
      granularidade="day"
      delta={deltaLdr ? <DeltaBadge pct={deltaLdr.pp} unidade="pp" tone={Math.abs(deltaLdr.pp) < 0.05 ? "neutral" : "lower_is_better"} /> : undefined}
      antes={
        deltaLdr && ldr.previous
          ? `antes ${formatarTaxa(deltaLdr.antes / 100, 1)} · ${formatarDiaCurto(ldr.previous.from)}–${formatarDiaCurto(ldr.previous.to)}`
          : undefined
      }
      rotulo="LDR da janela"
      // A taxa PUBLICADA pela API, com 1 casa como os outros cartoes; a base
      // ("6.883 de 56.970") em title + sr-only. "Medição interna" fica no ⓘ.
      valor={
        ldr.rate === null ? (
          "—"
        ) : (
          <span className="relative" title={`${formatarInteiro(ldr.late)} de ${formatarInteiro(ldr.base)}`}>
            {formatarTaxa(ldr.rate, 1)}
            <span className="sr-only">
              {" "}· {formatarInteiro(ldr.late)} de {formatarInteiro(ldr.base)}
            </span>
          </span>
        )
      }
      comparacao={
        ldr.rate === null
          ? "Sem vencimento maduro na janela."
          : // "acima/dentro da meta" ja' esta' na tinta do valor e no ⓘ: 1 linha a menos.
            `meta ${formatarTaxa(META_TIKTOK_LDR, 0)}`
      }
      // Sem taxa nao ha veredito: verde aqui leria ausencia como acerto.
      tom={ldr.rate === null ? "ausente" : ldr.above_target ? "critico" : "bom"}
    />
  ) : null;

  // ALVO-GRADE: sempre quatro cartoes (os abertos de agora). A LDR da janela
  // fica em "Mais detalhes" (Prazo) e no "LDR · últimos 7 dias".
  const faixa = <FaixaKpis rotulo="Pedidos em aberto">{cartoesDosAbertos(abertos)}</FaixaKpis>;

  // Alertas da API, sem reescrita, como itens da fila; "onde agir" primeiro.
  const ondeAgir = ondeAgirTikTok(abertos);
  const itensFila: ItemFila[] = [
    ...(ondeAgir ? [ondeAgir] : []),
    ...alertasNaFila(atencao),
    ...itensOficiais,
  ];
  const fila = <PainelAtencao itens={itensFila} vazio="Nenhum alerta publicado para este recorte." />;

  // "Prazo": a janela da LDR, que so' o TikTok sustenta. Coleta e despacho
  // continuam sendo eventos separados, escolhidos no cabecalho. No gestor a
  // LDR esta' na faixa; aqui ficam os pendentes DA JANELA (outra base que a
  // fila ao vivo, por isso o rotulo diz "janela da LDR").
  // "Lojas acima da meta" saiu como cartao: e' o chip da Concentracao.
  const secaoPrazo = (comLdr: boolean) =>
    ldr ? (
      <SecaoGerencial
        titulo="Prazo"
        // A meta e' de referencia e o prazo e' reconstruido: sem isso o numero
        // vira "o TikTok nos penalizou".
        dica={EXPLICACAO_META}
      >
        {/* Periodo da RESPOSTA (`ldr.from`, `ldr.to`, `ldr.days`), nao do
            seletor. O prazo reconstruido fica colado a ele. */}
        <p className="text-xs text-ink-muted" data-testid="tk-periodo-consultado">
          <span className="font-medium text-ink">
            Vencimentos de {formatarDiaLongo(ldr.from)} a {formatarDiaLongo(ldr.to)}
          </span>{" "}
          ({ldr.days} {ldr.days === 1 ? "dia" : "dias"} + hoje)
        </p>
        <FaixaKpis rotulo="Indicadores da janela" colunas={comLdr ? 3 : 4}>
          {comLdr ? cartaoLdr : null}
          {/* `base` e `late` da LDR somam SO' vencimentos fechados. Sem nenhum
              fechado (o caso da serie vencida) eles valem zero por construcao,
              nao por medicao: a tela mostra ausencia, nao "0 venciam". */}
          <KpiComAjuda
            ajuda="tiktok.venciam"
            variante="gerencial"
            rotulo="Venciam no período"
            valor={semVencimentoFechado ? VALOR_SEM_TAXA : formatarInteiro(ldr.base)}
            tom={semVencimentoFechado ? "ausente" : "neutro"}
          />
          <KpiComAjuda
            ajuda="tiktok.atrasaram"
            variante="gerencial"
            rotulo="Já atrasaram"
            valor={semVencimentoFechado ? VALOR_SEM_TAXA : formatarInteiro(ldr.late)}
            comparacao={`${formatarInteiro(ldr.pending_overdue)} venceram e ainda não saíram.`}
            tom={semVencimentoFechado ? "ausente" : ldr.late > 0 ? "critico" : "bom"}
          />
          <KpiComAjuda
            ajuda="tiktok.vence_hoje_amanha"
            variante="gerencial"
            rotulo="Vencem hoje ou amanhã (janela da LDR)"
            valor={formatarInteiro(ldr.pending_at_risk)}
            tom={ldr.pending_at_risk > 0 ? "atencao" : "neutro"}
          />
          <KpiComAjuda
            ajuda="tiktok.pendente_no_prazo"
            variante="gerencial"
            rotulo="Pendentes no prazo"
            valor={formatarInteiro(ldr.pending_on_time)}
          />
        </FaixaKpis>
      </SecaoGerencial>
    ) : null;

  // 6. EVOLUCAO — quando comecou. Sem nenhum vencimento fechado o grafico
  // seria um retangulo sem barra: a tela diz por que nao ha o que desenhar.
  const painelEvolucao = ldr ? (
    <EvolucaoPorVencimento
      dias={ldr.daily}
      severidade={severidadeDoDia}
      linha={{ valor: META_TIKTOK_LDR, rotulo: ROTULO_META }}
      // So' a coleta tem a lista por pedido; o despacho segue so' no grafico.
      aoClicar={evento === "coleta" ? setDiaVencido : undefined}
      clicavel={diaDentroDaJanelaDaLista}
      vazio={
        fotografia?.desatualizada
          ? ` A série está desatualizada${publicadaEm ? ` (publicada em ${publicadaEm})` : ""}.`
          : ldr.partial_due_days > 0
            ? ` ${ldr.partial_due_days} dia(s) seguem no prazo (parcial).`
            : null
      }
    />
  ) : null;

  // 7. CONCENTRACAO — lojas, nas duas profundidades.
  const painelLojas = (classe: string) => (
    <Panel
      className={classe}
      semPadding
      titulo={
        <span className="flex items-center gap-2">
          Concentração por marca
          {/* Antes tambem era o cartao "Lojas acima da meta"; a base vai no `title`. */}
          {dados?.brands.length ? (
            <Chip
              tom={piores.length ? "critico" : "neutro"}
              ponto
              title={`De ${formatarInteiro(dados.brands.length)} com base suficiente.`}
            >
              {piores.length} acima da meta
              <span className="sr-only"> de {formatarInteiro(dados.brands.length)} lojas com base suficiente</span>
            </Chip>
          ) : null}
        </span>
      }
      acao={<InfoDica texto="Só lojas com base suficiente; vencimentos no prazo ficam fora." />}
    >
      {/* Sem loja elegivel, um cabecalho de tabela sem linha nenhuma so'
          ocuparia espaco: a tela diz que nao ha loja a ranquear. */}
      {sortedRows.length === 0 ? (
        <p role="status" className="px-4 py-3 text-sm text-ink-muted">
          Nenhuma loja com base suficiente de vencimentos fechados no período.
        </p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className={CLASSE_TABELA}>
            <caption className="sr-only">LDR por loja no período</caption>
            <thead className={CLASSE_CABECALHO}>
              <tr>
                <SortHeader
                  rotulo="Loja"
                  coluna="loja"
                  sort={sort}
                  aoOrdenar={toggleSort}
                  alinhamento="left"
                />
                {/* O "ⓘ" fica FORA do botao de ordenar. */}
                <SortHeaderComAjuda
                  rotulo="Venciam"
                  coluna="base"
                  sort={sort}
                  aoOrdenar={toggleSort}
                  ajuda="tiktok.venciam"
                />
                <SortHeaderComAjuda
                  rotulo="Atrasados"
                  coluna="late"
                  sort={sort}
                  aoOrdenar={toggleSort}
                  ajuda="tiktok.atrasaram"
                />
                <SortHeaderComAjuda
                  rotulo="LDR"
                  coluna="rate"
                  sort={sort}
                  aoOrdenar={toggleSort}
                  ajuda="tiktok.ldr"
                />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((m) => (
                <tr key={m.brand} className="border-t border-line">
                  <th scope="row" className="text-left font-medium text-ink">
                    {m.shop_name ?? m.brand}
                  </th>
                  <td className="text-right tabular-nums text-ink">{formatarInteiro(m.base)}</td>
                  <td className="text-right tabular-nums text-ink">{formatarInteiro(m.late)}</td>
                  <td
                    className={`text-right font-semibold tabular-nums ${
                      m.above_target ? "text-crit-ink" : "text-ok-ink"
                    }`}
                  >
                    <TaxaComBase numerador={m.late} base={m.base} taxa={m.rate} linha />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );

  // 8. DETALHE — as coortes que compoem a LDR, linha a linha. Sao os mesmos
  // campos de `ldr.daily` que o grafico desenha, agora legiveis por leitor de
  // tela. Coorte parcial NUNCA mostra taxa fechada: ela ainda vai mudar.
  const painelCoortes = ldr ? (
    <Panel semPadding titulo="Coortes por dia de vencimento">
      {ldr.daily.length ? (
        <div className="max-h-96 overflow-auto">
          <table className={CLASSE_TABELA}>
            <caption className="sr-only">
              Coortes por dia de vencimento — o denominador da LDR
            </caption>
            <thead className={CLASSE_CABECALHO}>
              <tr>
                <th scope="col" className="font-semibold">Vencimento</th>
                <th scope="col" className="text-right font-semibold">Venciam</th>
                <th scope="col" className="text-right font-semibold">Atrasados</th>
                <th scope="col" className="text-right font-semibold">… ainda sem envio</th>
                <th scope="col" className="text-right font-semibold">No prazo s/ envio</th>
                <th scope="col" className="text-right font-semibold">
                  Taxa <Ajuda chave="tiktok.ldr" />
                </th>
                <th scope="col" className="font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {ldr.daily.map((d) => {
                const sev = severidadeDoDia(d);
                return (
                  <tr key={d.due_date} className="border-t border-line">
                    <th scope="row" className="whitespace-nowrap text-left font-medium text-ink">
                      {formatarDiaLongo(d.due_date)}
                    </th>
                    <td className="text-right tabular-nums text-ink">{formatarInteiro(d.base)}</td>
                    <td className="text-right tabular-nums text-ink">{formatarInteiro(d.late)}</td>
                    <td className="text-right tabular-nums text-ink">
                      {formatarInteiro(d.pending_overdue)}
                    </td>
                    <td className="text-right tabular-nums text-ink">
                      {formatarInteiro(d.pending_on_time)}
                    </td>
                    <td
                      className={`text-right font-semibold tabular-nums ${TEXTO_SEVERIDADE[sev]}`}
                    >
                      {d.is_mature ? (
                        <TaxaComBase numerador={d.late} base={d.base} taxa={d.rate} linha />
                      ) : (
                        VALOR_SEM_TAXA
                      )}
                    </td>
                    <td className="whitespace-nowrap text-ink-muted">{ROTULO_SEVERIDADE[sev]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p role="status" className="px-4 py-3 text-sm text-ink-muted">
          Nenhum pedido vence na janela consultada.
        </p>
      )}
    </Panel>
  ) : null;

  const painelFluxo = (classe: string) => (
    <Panel
      className={classe}
      semPadding
      titulo={
        <span className="flex flex-wrap items-center gap-2">
          {TITULO_FLUXO}
          {/* Nomeado como VISAO AUXILIAR na propria etiqueta: quem le
              de relance nao pode confundir este denominador com o da
              LDR. */}
          <Chip>visão auxiliar · não é a LDR</Chip>
        </span>
      }
    >
      {/* QA T-0010 (M6): sem dia de pagamento na janela, estado de vazio. */}
      {fluxo.length === 0 ? (
        <p role="status" className="px-4 py-3 text-sm text-ink-muted">
          Nenhum dia de pagamento na janela consultada.
        </p>
      ) : (
      <div className="max-h-96 overflow-auto">
        <table className={CLASSE_TABELA}>
          <caption className="sr-only">
            Fluxo por data de pagamento — denominador diferente do da LDR
          </caption>
          <thead className={CLASSE_CABECALHO}>
            <tr>
              <th scope="col" className="font-semibold">Pago em</th>
              <th scope="col" className="text-right font-semibold">Pagos</th>
              <th scope="col" className="text-right font-semibold">No prazo</th>
              <th scope="col" className="text-right font-semibold">Atrasados</th>
              <th scope="col" className="text-right font-semibold">Vencidos s/ envio</th>
              <th scope="col" className="text-right font-semibold">No prazo s/ envio</th>
              <th scope="col" className="text-right font-semibold">
                  Taxa <Ajuda chave="tiktok.fluxo_pagamento" />
                </th>
            </tr>
          </thead>
          <tbody>
            {fluxo.map((f) => (
              <tr key={f.paid_date} className="border-t border-line">
                <th scope="row" className="whitespace-nowrap text-left font-medium text-ink">
                  {formatarDiaLongo(f.paid_date)}
                  {!f.is_mature ? (
                    <span className="ml-1.5 rounded bg-raised px-1.5 py-0.5 text-xs text-ink-faint ring-1 ring-inset ring-line">
                      parcial
                    </span>
                  ) : null}
                </th>
                <td className="text-right tabular-nums text-ink">
                  {formatarInteiro(f.paid_orders)}
                </td>
                <td className="text-right tabular-nums text-ink">
                  {formatarInteiro(f.shipped_on_time)}
                </td>
                <td className="text-right tabular-nums text-ink">
                  {formatarInteiro(f.shipped_late)}
                </td>
                <td className="text-right tabular-nums text-ink">
                  {formatarInteiro(f.pending_overdue)}
                </td>
                <td className="text-right tabular-nums text-ink">
                  {formatarInteiro(f.pending_on_time)}
                </td>
                <td
                  className={`text-right font-semibold tabular-nums ${
                    !f.is_mature
                      ? "text-ink-faint"
                      : (f.rate ?? 0) > META_TIKTOK_LDR
                        ? "text-crit-ink"
                        : "text-ok-ink"
                  }`}
                >
                  {/* Coorte parcial NUNCA mostra a taxa fechada: ela
                      ainda vai mudar. */}
                  {f.is_mature ? (
                    <TaxaComBase numerador={f.late} base={f.base} taxa={f.rate} linha />
                  ) : (
                    VALOR_SEM_TAXA
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </Panel>
  );

  const popupVencidos = diaVencido ? (
    <PopupColetaPerdida
      api={BASE}
      marca={marca}
      vencimento={diaVencido}
      escopo="todos"
      aberto
      aoFechar={() => setDiaVencido(null)}
    />
  ) : null;

  return (
    // `div`, nao `main`: o landmark `main` e' do AppShell (um por pagina).
    <div className={CLASSE_RAIZ_EXPEDICAO} aria-busy={estado === "carregando"}>
    <LayoutExpedicao
      // 1-2. CABECALHO, FOTOGRAFIA, FRESCOR E FILTROS (compartilhado)
      moldura={moldura}
      cabecalho={cabecalhoExpedicao({
        fotografia,
        visao,
        aoTrocarVisao,
        controles,
        definicao: DEFINICAO_TIKTOK,
        filtroMarca: aoTrocarMarca ? (
          <SeletorMarca
            marca={marca}
            marcasPresentes={(dados?.brands ?? []).map((b) => b.brand)}
            aoTrocar={aoTrocarMarca}
          />
        ) : undefined,
      })}
      avisos={
        <>
          {janelaDescartada ? (
            <Note tom="atencao" papel="status">
              Janela do link inválida; usando a padrão.
            </Note>
          ) : null}
        </>
      }
      // 3. QUALIDADE DO DADO, CONSOLIDADA (compartilhada)
      qualidade={<BarraDeQualidade barra={barra} />}
      // Erro, ausencia e serie vencida sao estados DIFERENTES: erro e' a carga
      // que falhou agora (com nova tentativa); ausencia e' nao haver serie
      // nenhuma (nunca 0%); serie vencida e' dado que existe, velho, e aparece
      // no selo do cabecalho e na barra de qualidade.
      estado={
        <>
          {estado === "carregando" ? (
            <div role="status" aria-busy="true" className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
              <span className="sr-only">{TEXTO_ESTADO.carregando}</span>
              {Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} anunciar={false} />)}
            </div>
          ) : null}
          {estado === "erro" ? (
            <StateBlock
              tipo="erro"
              titulo={TEXTO_ESTADO.erro}
              descricao={erro ? `Falha: ${erro}.` : undefined}
              acao={<RetryButton onClick={() => void carregar()} />}
            />
          ) : null}
          {estado === "ok" && dados?.availability === "unavailable" ? (
            <StateBlock
              tipo="indisponivel"
              titulo={explicarIndisponivelComMarca(dados.unavailable_reason, marca)}
            />
          ) : null}
        </>
      }
    >
      {estado === "ok" && dados?.availability === "available" && ldr ? (
        visao === "gestor" ? (
          // RISCO ATUAL -> PRAZO (LDR) -> JORNADA -> EVOLUCAO -> CONCENTRACAO:
          // a ordem e' do esqueleto, a mesma dos tres canais.
          <CorpoGestor
            faixa={faixa}
            prazo={<PainelEtapasTikTok abertos={abertos} />}
            atencao={fila}
            // EXPEDICAO-TIKTOK-PADRAO: "Backlog por marca" no lugar e no
            // formato da Shopee/ML; evolucao (7/12) e lojas (5/12) a seguir.
            backlog={<BacklogPorMarcaTikTok abertos={abertos} api={BASE} marca={marca} />}
            evolucao={painelEvolucao}
            concentracao={painelLojas("h-full")}
            ldr={faixaTopo}
            maisDetalhes={
              <MaisDetalhes resumo="janela da LDR, jornada e nota oficial">
                {secaoPrazo(true)}
                <JornadaPedidos carga={jornada.carga} aoTentarDeNovo={jornada.tentarDeNovo} marca={marca} compacta />
                {performance}
              </MaisDetalhes>
            }
          />
        ) : (
          <>
            {faixa}
            <BacklogPorMarcaTikTok abertos={abertos} api={BASE} marca={marca} />
            {secaoPrazo(true)}
            {/* DETALHE: coorte, loja e fluxo */}
            {painelCoortes}
            <div className="grid gap-3 lg:grid-cols-5">
              {painelLojas("lg:col-span-2")}
              {painelFluxo("lg:col-span-3")}
            </div>
          </>
        )
      ) : null}
    </LayoutExpedicao>
    {popupVencidos}
    {abertos.popup}
    </div>
  );
}
