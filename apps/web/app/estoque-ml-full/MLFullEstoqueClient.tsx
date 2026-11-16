"use client";

/**
 * Tela "Estoque Full Mercado Livre" — ML-FULL-STOCK-API-1.
 *
 * PARA QUEM E' E QUE DECISAO SUSTENTA
 * ------------------------------------
 * Gestor de operacao decidindo REPOSICAO no Full do ML. Grao: INVENTARIO (o
 * estoque fisico), nunca anuncio. Ordem padrao operacional (vem da API):
 * ruptura, baixo e "sem leitura" no topo.
 *
 * AUSENCIA NUNCA VIRA ZERO
 * -------------------------
 *   - indisponivel        -> painel proprio, com causa e proximo passo;
 *   - zero medido         -> "0";
 *   - sem leitura / marca sem fotografia -> travessao, via `fmtOpcional`,
 *     e o total e' rotulado PARCIAL com os motivos da API;
 *   - marca "sem estoque Full" (T-0051: publicada com 0 inventarios) ->
 *     "Sem estoque Full" em tom neutro; conta 0 e NAO torna o total parcial;
 *   - marca com inventario e disponivel 0 -> "0" com "saldo disponível 0 ·
 *     N não disponível".
 *   - estado de marca desconhecido -> erro de contrato (`validarPayloadML`).
 *
 * A TELA NAO RECALCULA NADA: classificacao, cobertura, totais e parcialidade
 * chegam prontos da API.
 *
 * NUMERO PRIMEIRO: a ressalva que muda a leitura de uma coluna (grao por
 * inventario, travessao como ausencia, transferencia) fica num "i" ao lado do
 * rotulo, nunca em paragrafo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AlertCircle, Archive, EyeOff, PackageCheck, PackageX, Share2, TrendingDown } from "lucide-react";

import {
  AvisoTopo, ChipCategoria, FaixaCategorias, useCategoriaNaUrl, useRolarAteChip, type CardCategoria,
} from "@/components/full/CategoriasEstoque";
import TableScrollHint from "@/components/TableScrollHint";
import Aba from "@/components/layout/Aba";
import { useVisoesFull } from "@/components/full/useVisoesFull";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import { CelulaCurva, FiltroCurvaChips } from "@/components/full/CurvaEstoque";
import GradeCurvaMarca from "@/components/full/GradeCurvaMarca";
import { type ClasseGrade } from "@/lib/estoque-grade-curva";
import InfoDica from "@/components/ui/InfoDica";
import KpiCardSkeleton from "@/components/ui/KpiCardSkeleton";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { MLFullEstoqueError, fetchMLFullEstoque } from "@/lib/api-client";
import {
  avisoCoberturaCurva, avisoCurvaIndisponivel, curvaNaTela, ordenarPorCurva, passaCurva, resumoAcao,
  type OpcaoCurva,
} from "@/lib/estoque-curva";
import { abrirCategoria, CATEGORIAS_ML, categoriaPorChave, textoChip } from "@/lib/estoque-categorias";

const CHAVES_CATEGORIA = CATEGORIAS_ML.map((c) => c.chave);
import {
  AVISO_AUSENCIA_ML,
  AVISO_GRAO_ML,
  AVISO_TRANSFER_ML,
  CLASS_LABEL_ML,
  CLASS_TOM_ML,
  ContratoMLError,
  ERRO_DATA_FUTURA_ML,
  FILTROS_ML_VAZIOS,
  MARCAS_ML,
  PROXIMO_PASSO_ML,
  ROTULO_SEM_ESTOQUE_FULL_ML,
  TITULO_INDISPONIVEL_ML,
  buildQueryML,
  avisoTopoML,
  diagnosticoML,
  dataParaFiltroML,
  eDataHistorica,
  eErroDataFuturaML,
  estadoExibicaoMarcaML,
  marcasSemEstoqueFullML,
  fmtCobertura,
  fmtData,
  fmtDecimal,
  fmtInt,
  fmtOpcional,
  frescorLabelML,
  hojeSaoPauloML,
  identificacaoML,
  isIndisponivelML,
  mostrarAvisoVelhaML,
  motivoParcialLegivel,
  subtextoSaldoZeroML,
  seloAnunciosExtrasML,
  rotuloSituacao,
  subtituloTransferML,
  subvalorDisponivelTotalML,
  temFiltroAtivoML,
  textoVazioML,
  tituloMarca,
  todasSemEstoqueFullML,
  validarPayloadML,
  type ClassificacaoML,
  type FiltrosML,
  type InventarioML,
  type MarcaML,
  type MLFullEstoqueOk,
  type MLFullEstoqueResponse,
} from "@/lib/ml-full-estoque";

function Aviso({
  tom,
  children,
}: {
  tom: "info" | "alerta";
  children: React.ReactNode;
}) {
  const cor =
    tom === "alerta"
      ? "bg-warn-soft border-warn/30 text-warn-ink"
      : "bg-raised border-line text-ink-muted";
  return (
    <p className={`text-sm rounded-xl border px-4 py-3 ${cor}`}>{children}</p>
  );
}

/** Sem cartoes, sem tabela, sem numero: nada que pareca "tudo zerado". */
function PainelIndisponivel({
  titulo,
  motivo,
  passo,
}: {
  titulo: string;
  motivo: string;
  passo?: string;
}) {
  return (
    <StateBlock
      tipo="indisponivel"
      titulo={titulo}
      descricao={<>{motivo}{passo && <> <span className="font-semibold">Próximo passo:</span> {passo}</>} <span className="font-semibold text-ink">Isto não significa estoque zero.</span></>}
    />
  );
}

function Etiqueta({ classe }: { classe: ClassificacaoML }) {
  return (
    <span
      className={`inline-block text-xs font-semibold border rounded-full px-2 py-0.5 whitespace-nowrap ${CLASS_TOM_ML[classe]}`}
    >
      {CLASS_LABEL_ML[classe]}
    </span>
  );
}

/**
 * Alvo de foco por teclado da tabela larga. Fica DENTRO do container rolavel
 * do `TableScrollHint` (compartilhado, sem props de foco): com o foco aqui,
 * as setas rolam o ancestral rolavel e o leitor de tela anuncia a regiao.
 */
function RegiaoRolavel({
  rotulo,
  children,
}: {
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div
      tabIndex={0}
      role="region"
      aria-label={rotulo}
      className="min-w-max rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      {children}
    </div>
  );
}

/**
 * Estado da marca no cabecalho da grade (a tabela por marca saiu, pedido da
 * Nathalia 13/11): sem fotografia = ausencia; sem estoque Full = zero medido.
 */
function notaMarcaML(m: MarcaML): string | null {
  if (estadoExibicaoMarcaML(m) === "sem_fotografia") {
    return `Sem fotografia no dia${m.ultima_fotografia ? ` (última: ${fmtData(m.ultima_fotografia)})` : " (nunca publicada)"}`;
  }
  if (estadoExibicaoMarcaML(m) === "sem_estoque_full") return ROTULO_SEM_ESTOQUE_FULL_ML;
  // Leitura parcial: o disponivel soma menos; dito no cabecalho, nunca calado.
  const semLeitura = m.leitura && m.leitura.inventarios_sem_leitura > 0 ? `${fmtInt(m.leitura.inventarios_sem_leitura)} sem leitura` : null;
  return [semLeitura, subtextoSaldoZeroML(m)].filter(Boolean).join(" · ") || null;
}

/** Classe da grade curva x marca: as mesmas dos cartoes Ruptura, Estoque baixo e Excesso. */
const CLASSE_GRADE_ML: Partial<Record<InventarioML["classificacao_torre"], ClasseGrade>> = {
  RUPTURA_CANDIDATA: "ruptura", BAIXO_CANDIDATO: "baixo", EXCESSO_CANDIDATO: "excesso",
};

/** Ruptura + estoque baixo: o mesmo recorte do cartao "Exigem ação". */
const exigeAcaoML = (i: InventarioML) =>
  i.classificacao_torre === "RUPTURA_CANDIDATA" || i.classificacao_torre === "BAIXO_CANDIDATO";

function TabelaInventarios({ inventarios, comCurva }: { inventarios: InventarioML[]; comCurva: boolean }) {
  return (
    <div className="bg-surface rounded-2xl border border-line overflow-hidden">
      <TableScrollHint>
        <RegiaoRolavel rotulo="Inventários (role na horizontal para ver todas as colunas)">
          <table className="w-full text-sm">
            <caption className="sr-only">
              {comCurva
                ? "Estoque Full por inventário: AA, depois A, depois os demais; dentro de cada grupo, menos dias de cobertura primeiro"
                : "Estoque Full por inventário, ordenado por urgência de reposição"}
            </caption>
            <thead>
              <tr className="text-left text-xs font-semibold text-ink-muted uppercase tracking-wide border-b border-line">
                <th scope="col" className="px-4 py-3">Marca</th>
                <th scope="col" className="px-4 py-3">Identificação</th>
                {comCurva && <th scope="col" className="hidden px-4 py-3 sm:table-cell">Curva</th>}
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="inline-flex items-center gap-1">
                    Disponível
                    <InfoDica texto={AVISO_AUSENCIA_ML} />
                  </span>
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="inline-flex items-center gap-1">
                    Não disponível
                    <InfoDica texto={AVISO_TRANSFER_ML} />
                  </span>
                </th>
                <th scope="col" className="px-4 py-3 text-right">Demanda 28d</th>
                <th scope="col" className="px-4 py-3 text-right">Cobertura da Torre</th>
                <th scope="col" className="px-4 py-3">Classificação</th>
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="inline-flex items-center gap-1">
                    Anúncios
                    <InfoDica texto={AVISO_GRAO_ML} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {/* key = ordinal da resposta: o ID do inventario nao sai na API publica. */}
              {inventarios.map((i) => {
                const ident = identificacaoML(i);
                const selo = seloAnunciosExtrasML(i.anuncios_extras);
                return (
                <tr
                  key={i.posicao}
                  className="border-b border-line last:border-0 align-top"
                >
                  <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{tituloMarca(i.brand)}</td>
                  <td className="px-4 py-3 min-w-[14rem] max-w-xs">
                    {/* Rotulo do anuncio-ancora: atributo da linha, nunca soma estoque. */}
                    {/* Celular: a curva na 1a dobra, antes do texto (a coluna fica escondida). */}
                    {ident.identificado ? (
                      <span className="block text-ink break-words">
                        {comCurva && <span className="mr-1.5 inline-flex align-middle sm:hidden"><CelulaCurva item={i} /></span>}
                        {ident.texto}
                      </span>
                    ) : (
                      <span className="block text-ink-muted italic">
                        {comCurva && <span className="mr-1.5 inline-flex align-middle not-italic sm:hidden"><CelulaCurva item={i} /></span>}
                        {ident.texto}
                      </span>
                    )}
                    {ident.avisoVariacao && (
                      <span className="block text-xs text-ink-muted">{ident.avisoVariacao}</span>
                    )}
                    {rotuloSituacao(i.situacao) && (
                      <span className="mr-1 mt-1 inline-block rounded-full border border-line bg-raised px-2 py-0.5 text-xs text-ink-muted">{rotuloSituacao(i.situacao)}</span>
                    )}
                    {selo && (
                      <span className="mt-1 inline-block rounded-full border border-line bg-raised px-2 py-0.5 text-xs text-ink-muted">
                        {selo}
                      </span>
                    )}
                  </td>
                  {comCurva && (
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <CelulaCurva item={i} />
                    </td>
                  )}
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-ink">
                    {/* `null` = sem leitura: travessao, nunca 0. */}
                    {fmtOpcional(i.disponivel)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {fmtOpcional(i.nao_disponivel)}
                    {i.transfer !== null && i.transfer > 0 && (
                      <span className="block text-xs text-ink-faint">
                        {fmtInt(i.transfer)} em transferência
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {fmtInt(i.unidades_28d)}
                    <span className="block text-xs text-ink-faint">
                      {fmtDecimal(i.media_diaria_28d)}/dia
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {fmtCobertura(i.cobertura_torre_dias)}
                  </td>
                  <td className="px-4 py-3">
                    <Etiqueta classe={i.classificacao_torre} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {/* ASSOCIACAO, nao estoque: nunca multiplica o disponivel. */}
                    {fmtInt(i.anuncios)}
                    {i.compartilhado && (
                      <span className="block text-xs text-ink-faint">compartilhado</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </RegiaoRolavel>
      </TableScrollHint>
    </div>
  );
}

interface ErroML {
  texto: string;
  /** 422 por data futura: repetir a mesma data daria o mesmo erro. */
  dataFutura: boolean;
}

export default function MLFullEstoqueClient() {
  const abas = useVisoesFull();
  const [filtros, setFiltros] = useState<FiltrosML>(FILTROS_ML_VAZIOS);
  const [payload, setPayload] = useState<MLFullEstoqueResponse | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<ErroML | null>(null);
  // CURVA-ABC: filtro so' na tela (a API ja' manda a curva de cada inventario).
  const [curvas, setCurvas] = useState<OpcaoCurva[]>([]);
  // Qual busca o payload responde: "Compartilhados"/"Sem leitura" refazem a busca
  // (com os fora do Full) e o foco so' vai ao chip depois dela.
  const [queryCarregada, setQueryCarregada] = useState<string | null>(null);
  const primeiroChipRef = useRef<HTMLButtonElement | null>(null);
  const dataRef = useRef<HTMLInputElement | null>(null);
  // O que esta no campo de data. So' vira filtro quando completo (ver
  // `dataParaFiltroML`): digitar o ano nao dispara busca com "0002-12-01".
  const [dataDigitada, setDataDigitada] = useState("");
  // Hoje em America/Sao_Paulo (o mesmo relogio da API), uma vez por montagem.
  const hoje = useMemo(() => hojeSaoPauloML(), []);

  // CARDS-CLICAVEIS: a categoria do card vive na URL e corta a tabela da aba.
  const [chaveCategoria, setCategoria] = useCategoriaNaUrl(CHAVES_CATEGORIA);
  const categoria = categoriaPorChave(CATEGORIAS_ML, chaveCategoria);
  // "Compartilhados" e "Sem leitura" contam tambem os fora do Full: a lista vem com eles.
  const comForaDoFull = filtros.incluirForaDoFull || !!categoria?.foraDoFull;
  const query = useMemo(
    () => buildQueryML({ ...filtros, incluirForaDoFull: comForaDoFull }),
    [filtros, comForaDoFull],
  );
  const refDate = filtros.refDate;
  const abortRef = useRef<AbortController | null>(null);

  const carregar = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setCarregando(true);
    setErro(null);
    try {
      // Estado de marca desconhecido e' erro de contrato, nunca zero.
      setPayload(validarPayloadML(await fetchMLFullEstoque(query, ctrl.signal)));
      setQueryCarregada(query);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Numero velho nunca convive com mensagem de falha.
      setPayload(null);
      if (e instanceof ContratoMLError) {
        setErro({ texto: e.message, dataFutura: false });
      } else if (e instanceof MLFullEstoqueError) {
        const dataFutura = eErroDataFuturaML(e.status, refDate);
        setErro({ texto: dataFutura ? ERRO_DATA_FUTURA_ML : e.message, dataFutura });
      } else {
        setErro({ texto: "Falha inesperada ao carregar o estoque.", dataFutura: false });
      }
    } finally {
      if (!ctrl.signal.aborted) setCarregando(false);
    }
    // `refDate` ja esta contido em `query`; entra so' para classificar o 422.
  }, [query, refDate]);

  useEffect(() => {
    carregar();
    return () => abortRef.current?.abort();
  }, [carregar]);

  const alternarMarca = (m: string) =>
    setFiltros((f) => ({
      ...f,
      brands: f.brands.includes(m)
        ? f.brands.filter((x) => x !== m)
        : [...f.brands, m],
    }));

  const chipRef = useRef<HTMLButtonElement | null>(null);
  const pedidoRolagem = useRolarAteChip(chipRef, chaveCategoria, !carregando && !!payload && queryCarregada === query);

  /** Card: aplica a categoria (contagem = lista: o filtro de curva sai); de novo, limpa. */
  const escolherCategoria = (chave: string) => {
    if (chave === chaveCategoria) return setCategoria(null);
    setCurvas([]);
    pedidoRolagem.current = true;
    setCategoria(chave);
  };

  const limpar = () => {
    setFiltros(FILTROS_ML_VAZIOS);
    setDataDigitada("");
    setCurvas([]);
    if (chaveCategoria) setCategoria(null);
    // O botao "Limpar filtros" some ao limpar: o foco vai para o primeiro
    // chip de marca, que esta sempre na tela, em vez de cair no <body>.
    primeiroChipRef.current?.focus();
  };

  const voltarParaUltima = () => {
    setFiltros((f) => ({ ...f, refDate: "" }));
    setDataDigitada("");
    // O botao some com o erro: o foco vai para o campo de data, que esta
    // sempre na tela, em vez de cair no <body>.
    dataRef.current?.focus();
  };

  /** Digitando: aplica so' data completa ou vazio; parcial fica so' no campo. */
  const digitarData = (valor: string) => {
    setDataDigitada(valor);
    const aplicar = dataParaFiltroML(valor);
    if (aplicar !== null) setFiltros((f) => ({ ...f, refDate: aplicar }));
  };

  /** Blur/Enter: parcial nao vira filtro -- o campo volta ao filtro vigente. */
  const confirmarData = (valor: string) => {
    const aplicar = dataParaFiltroML(valor);
    if (aplicar === null) setDataDigitada(filtros.refDate);
    else setFiltros((f) => ({ ...f, refDate: aplicar }));
  };

  // CURVA-ABC: coluna, filtro e ordem por grupos so' com a curva lida.
  const metaCurva = payload && !isIndisponivelML(payload) ? payload.curva_meta : null;
  const comCurva = curvaNaTela(metaCurva);
  const filtroCurva = comCurva ? curvas : [];
  const naCurva = payload && !isIndisponivelML(payload)
    ? payload.inventarios.filter((i) => passaCurva(i.curva, filtroCurva))
    : [];
  // Sem categoria, os fora do Full so' aparecem se a pessoa pediu (a busca pode te-los trazido).
  const lista = categoria
    ? abrirCategoria(naCurva, categoria)
    : (() => {
        const base = filtros.incluirForaDoFull ? naCurva : naCurva.filter((i) => i.eh_full);
        return comCurva ? ordenarPorCurva(base, (i) => i.cobertura_torre_dias) : base;
      })();
  const algumFiltro = temFiltroAtivoML(filtros) || filtroCurva.length > 0 || !!categoria;

  const fotoEmUso = payload && !isIndisponivelML(payload) ? payload.frescor.ref_date : "";
  const filtrosUI = (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink-faint uppercase tracking-wide">
          Marca
        </span>
        {MARCAS_ML.map((m, idx) => (
          <button
            key={m}
            ref={idx === 0 ? primeiroChipRef : undefined}
            type="button"
            aria-pressed={filtros.brands.includes(m)}
            onClick={() => alternarMarca(m)}
            className={`inline-flex items-center justify-center min-h-11 min-w-11 text-sm rounded-full border px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              filtros.brands.includes(m)
                ? "bg-accent border-accent text-accent-on font-semibold"
                : "bg-surface border-line text-ink-muted hover:border-accent/40"
            }`}
          >
            {tituloMarca(m)}
          </button>
        ))}
      </div>
      {comCurva && <FiltroCurvaChips valor={curvas} aoMudar={setCurvas} ajuda={avisoCoberturaCurva(metaCurva)} />}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Data da fotografia
          <input
            type="date"
            max={hoje}
            ref={dataRef}
            // Sem data escolhida, o campo mostra a foto em uso (nao "dd/mm/aaaa"); so' vira filtro se a pessoa mudar.
            value={dataDigitada || fotoEmUso}
            onChange={(e) => digitarData(e.target.value)}
            onBlur={(e) => { if (dataDigitada || e.target.value !== fotoEmUso) confirmarData(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (dataDigitada || e.currentTarget.value !== fotoEmUso)) confirmarData(e.currentTarget.value);
            }}
            className="rounded-lg border border-line bg-surface text-ink px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={filtros.incluirForaDoFull}
            onChange={(e) =>
              setFiltros((f) => ({ ...f, incluirForaDoFull: e.target.checked }))
            }
            className="rounded border-line-strong"
          />
          Listar também inventários fora do Full
        </label>
        {algumFiltro && (
          <button
            type="button"
            onClick={limpar}
            className="inline-flex items-center min-h-11 px-2 text-sm font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  );

  const escopo =
    payload && !isIndisponivelML(payload)
      ? `${payload.scope_label} · ${frescorLabelML(payload.frescor)}`
      : "Estoque Full Mercado Livre — por inventário";

  const parcial =
    payload !== null && !isIndisponivelML(payload) && payload.indicadores.total_parcial;

  return (
    <Aba
      {...abas}
      selo={
        <>
          <SeloAtualizado em={payload && !isIndisponivelML(payload) ? payload.frescor.published_at : null} carregando={carregando} detalhe={escopo} />
          {payload && !isIndisponivelML(payload) && <InfoDica texto={diagnosticoML(payload.cobertura, marcasSemEstoqueFullML(payload.marcas))} />}
        </>
      }
      filtros={filtrosUI}
    >

      {carregando && (
        <div role="status" aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <span className="sr-only">Carregando estoque…</span>
          {Array.from({ length: 8 }).map((_, i) => <KpiCardSkeleton key={i} anunciar={false} />)}
        </div>
      )}

      {!carregando && erro && (
        <StateBlock
          tipo="erro"
          titulo="Não foi possível carregar o estoque"
          descricao={erro.texto}
          acao={erro.dataFutura ? (
            <button
              type="button"
              onClick={voltarParaUltima}
              className="inline-flex items-center min-h-11 text-sm font-semibold rounded-lg bg-accent text-accent-on px-4 py-2 hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Ver a última fotografia
            </button>
          ) : <RetryButton onClick={carregar} />}
        />
      )}

      {!carregando && !erro && payload && isIndisponivelML(payload) && (
        <PainelIndisponivel
          titulo={TITULO_INDISPONIVEL_ML[payload.motivo_tecnico]}
          motivo={payload.unavailable_reason}
          passo={PROXIMO_PASSO_ML[payload.motivo_tecnico]}
        />
      )}

      {!carregando && !erro && payload && !isIndisponivelML(payload) && (
        <>
          {/* Data historica escolhida de proposito ja tem aviso proprio. */}
          {mostrarAvisoVelhaML(payload.frescor) && (
            <Aviso tom="alerta">Desatualizado · {frescorLabelML(payload.frescor)}</Aviso>
          )}
          {eDataHistorica(payload.frescor) && (
            <Aviso tom="info">
              Data histórica · última fotografia em{" "}
              {fmtData(payload.frescor.ultima_fotografia_disponivel)}
            </Aviso>
          )}

          {/* AVISOS-TOPO: UM aviso, so' com problema real (o diagnostico esta' no ⓘ do cabecalho). */}
          {avisoTopoML(payload.cobertura, payload.indicadores.total_parcial) && (
            <AvisoTopo
              texto={avisoTopoML(payload.cobertura, payload.indicadores.total_parcial)!}
              ajuda={[
                "Ausência de dado, não zero.",
                ...payload.indicadores.motivos_total_parcial.map(motivoParcialLegivel),
              ].join(" ")}
            />
          )}

          {/* O aviso acima e' o UNICO; nos cards so' title + leitor de tela. */}
          <FaixaCategorias
            cards={cardsML(payload)}
            faixa={["exigem-acao", "ruptura", "baixo", "excesso"]}
            ativa={chaveCategoria}
            aoEscolher={escolherCategoria}
            parcial={!!parcial}
          />

          {(
            <GradeCurvaMarca
              itens={payload.inventarios.filter((i) => i.eh_full && !i.situacao).map((i) => ({
                brand: i.brand, curva: i.curva, disponivel: i.disponivel,
                mediaDiaria: i.media_diaria_28d, classe: CLASSE_GRADE_ML[i.classificacao_torre] ?? null,
                rotulo: identificacaoML(i).texto, cobertura: i.cobertura_torre_dias,
              }))}
              marcas={payload.marcas.map((m) => m.brand)}
              rotuloMarca={tituloMarca}
              notaMarca={(b) => { const m = payload.marcas.find((x) => x.brand === b); return m ? notaMarcaML(m) : null; }}
              item="inventários"
              comCurva={comCurva}
              ressalva={payload.truncado ? "Lista truncada: grade parcial" : null}
            />
          )}

          {avisoCurvaIndisponivel(metaCurva) && (
            <Aviso tom="info">{avisoCurvaIndisponivel(metaCurva)}</Aviso>
          )}

          {payload.total_no_filtro === 0 || lista.length === 0 ? (
            <section
              role="status"
              className="bg-surface rounded-2xl border border-line p-8 flex flex-col gap-3"
            >
              <h3 className="text-base font-semibold text-ink">
                Nenhum inventário neste filtro
              </h3>
              {categoria && (
                <ChipCategoria ref={chipRef} texto={textoChip(categoria, lista)} aoLimpar={() => setCategoria(null)} />
              )}
              <p className="text-sm text-ink-muted">
                {textoVazioML({
                  refDate: payload.frescor.ref_date,
                  inventarios: payload.indicadores.inventarios,
                  filtroAtivo: algumFiltro,
                  semEstoqueFull: todasSemEstoqueFullML(payload.marcas),
                })}
              </p>
            </section>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
                {comCurva && (
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-medium text-ink">{/* Panorama: sem o filtro de curva. */}{resumoAcao(payload.inventarios.filter((i) => i.eh_full && !i.situacao), exigeAcaoML)}</p>
                  </div>
                )}
                {categoria && (
                  <ChipCategoria ref={chipRef} texto={textoChip(categoria, lista)} aoLimpar={() => setCategoria(null)} />
                )}
              </div>
              {/* "N de M inventarios" so' com a lista truncada (senao e' a lista toda); recortes ativos seguem. */}
              {(categoria || filtroCurva.length > 0 || payload.truncado) && (
                <p className="text-xs text-ink-muted px-1">
                  {categoria
                    ? `${fmtInt(lista.length)} na categoria`
                    : filtroCurva.length > 0 && `${fmtInt(lista.length)} na curva escolhida`}
                  {(categoria || filtroCurva.length > 0) && payload.truncado && " · "}
                  {payload.truncado && `${fmtInt(payload.inventarios.length)} de ${fmtInt(payload.total_no_filtro)} inventários · lista truncada; indicadores cobrem tudo`}
                </p>
              )}
              <TabelaInventarios inventarios={lista} comCurva={comCurva} />
            </>
          )}
        </>
      )}
    </Aba>
  );
}


/** Os 8 cards da aba, na ordem de antes. Cor = familia (identidade), nao status. */
function cardsML(payload: MLFullEstoqueOk): CardCategoria[] {
  const i = payload.indicadores;
  const l = payload.limites;
  return [
    { chave: "disponivel", rotulo: "Disponível Full", valor: fmtOpcional(i.disponivel_full),
      comparacao: subvalorDisponivelTotalML({ parcial: false, marcas: payload.marcas, inventariosFullLidos: i.inventarios_full_lidos }),
      identidade: "gmv", icone: PackageCheck },
    { chave: "exigem-acao", rotulo: "Exigem ação", valor: fmtInt(i.inventarios_exigem_acao), comparacao: "Ruptura + estoque baixo",
      identidade: "ads", icone: AlertCircle, tom: i.inventarios_exigem_acao > 0 ? "critico" : "neutro" },
    { chave: "sem-leitura", rotulo: "Sem leitura", valor: fmtInt(i.inventarios_sem_leitura),
      comparacao: "Inventários sem quantidade medida", identidade: "ticket", icone: EyeOff },
    { chave: "compartilhados", rotulo: "Compartilhados", valor: fmtInt(i.inventarios_compartilhados),
      comparacao: "Inventários com 2+ anúncios (contados uma vez)", identidade: "ticket", icone: Share2 },
    { chave: "ruptura", rotulo: "Ruptura", valor: fmtInt(i.inventarios_ruptura), comparacao: "Sem disponível, com venda na janela",
      identidade: "ads", icone: PackageX, tom: i.inventarios_ruptura > 0 ? "critico" : "neutro" },
    { chave: "baixo", rotulo: "Estoque baixo", valor: fmtInt(i.inventarios_baixo),
      comparacao: `Abaixo de ${l.cobertura_baixa_dias} dias de cobertura`, identidade: "ads", icone: TrendingDown },
    { chave: "excesso", rotulo: "Excesso", valor: fmtInt(i.inventarios_excesso),
      comparacao: `A partir de ${l.cobertura_excesso_dias} dias de cobertura`, identidade: "prazo", icone: Archive },
    { chave: "nao-disponivel", rotulo: "Não disponível Full", valor: fmtOpcional(i.nao_disponivel_full),
      comparacao: subtituloTransferML(i.transfer_full), identidade: "gmv", icone: PackageX },
  ];
}
