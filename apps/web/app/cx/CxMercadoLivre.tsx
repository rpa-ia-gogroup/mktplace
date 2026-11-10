"use client";

/**
 * Aba CX · Mercado Livre (10/11/2026) — o mesmo esqueleto da CX da Shopee (e da
 * Gerencial), com os numeros do ML:
 *   0. cabecalho com chip (periodo, e dado velho quando e' o caso);
 *   1. heroi: taxa de reclamacao, com a taxa de cada marca no meio;
 *   2. faixa: cancelamentos, mediacoes, perguntas sem resposta;
 *   3. "O que exige atencao agora": prazos vencidos, perguntas e mensagens;
 *   4. por que: Pareto dos problemas (7/12) | problemas por marca (5/12);
 *   5. atendimento por loja: fila, prazo, perguntas, tempo de resposta;
 *   6. Mais detalhes: o que ainda falta (devolucoes) e a cobertura.
 * A metodologia mora nos ⓘ. Busca pelo navegador (`torreFetch`), como a Shopee.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Ban, MessageCircle, MessageCircleQuestion, ShieldAlert } from "lucide-react";

import TableScrollHint from "@/components/TableScrollHint";
import { LinhaSemComparacao, pilula } from "@/components/gerencial/CxResumo";
import PageHeader from "@/components/layout/PageHeader";
import Chip from "@/components/ui/Chip";
import FilaAtencao from "@/components/ui/FilaAtencao";
import Heroi from "@/components/ui/Heroi";
import InfoDica from "@/components/ui/InfoDica";
import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
import MaisDetalhes from "@/components/ui/MaisDetalhes";
import Panel from "@/components/ui/Panel";
import StateBlock from "@/components/ui/StateBlock";
import { inteiro, pctCx, type FiltrosCx } from "@/lib/cx";
import {
  AJUDA_ML,
  INDICADORES_ML,
  ROTULO_ML,
  carregarCxMl,
  itensAtencaoMl,
  montarAtendimentoMl,
  montarParetoMl,
  montarProblemasMl,
  resumoMl,
  type CelulaTaxa,
  type CxMlResponse,
  type IndicadorMl,
  type ResultadoMl,
  type ResumoMl,
} from "@/lib/cx-ml";
import { brandLabel } from "@/lib/filters/brands";
import { textoJanela } from "@/lib/performance-contas-atendimento";
import { TITULO_SEGUNDA_TENTATIVA } from "@/lib/performance-contas";
import { torreFetch } from "@/lib/torre-fetch";

import { COR_DELTA, Celula, Notas, TD, THEAD, TH, TH_MARCA, TR, TR_TOTAL, ThAjuda, dica } from "./CxConteudo";

export default function CxMercadoLivre({ filtros, barra }: { filtros: FiltrosCx; barra: ReactNode }) {
  const { marca, dias } = filtros;
  const [resultado, setResultado] = useState<ResultadoMl | null>(null);
  const [repetindo, setRepetindo] = useState(false);

  const carregar = useCallback(() => {
    let vivo = true;
    setResultado(null);
    setRepetindo(false);
    carregarCxMl({ marca, dias }, torreFetch as typeof fetch, undefined, undefined, () => vivo && setRepetindo(true)).then((r) => {
      if (vivo) setResultado(r);
    });
    return () => {
      vivo = false;
    };
  }, [marca, dias]);

  useEffect(() => carregar(), [carregar]);

  const dados = resultado?.ok ? resultado.dados : null;
  return (
    <>
      <PageHeader
        title="CX"
        icon={MessageCircle}
        filters={barra}
        meta={
          dados && (
            <span className="flex flex-wrap items-center gap-1.5" data-testid="cx-escopo">
              <Chip title={`Pedidos e reclamações por data de abertura · ${textoJanela(dados.janela)}`}>{textoJanela(dados.janela)}</Chip>
              {dados.aviso_frescor && (
                <Chip tom="atencao" title={dados.aviso_frescor}>
                  Coleta desatualizada
                </Chip>
              )}
            </span>
          )
        }
      />
      {!resultado ? (
        <>
          <Heroi rotulo={ROTULO_ML.reclamacao} valor="—" carregando meio={null} />
          <StateBlock tipo="carregando" titulo={repetindo ? TITULO_SEGUNDA_TENTATIVA : "Carregando a aba CX do Mercado Livre"} />
        </>
      ) : !resultado.ok ? (
        <StateBlock
          tipo="erro"
          titulo="Não foi possível carregar a aba CX"
          descricao={resultado.motivo}
          acao={
            <button
              type="button"
              onClick={() => carregar()}
              className="mt-1 inline-flex min-h-11 items-center rounded-lg border border-current/30 px-3 text-xs font-semibold hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Tentar novamente
            </button>
          }
        />
      ) : resultado.dados.cobertura.marcas.length === 0 ? (
        <StateBlock
          tipo="indisponivel"
          titulo="Sem conta no Mercado Livre"
          descricao={resultado.dados.cobertura.fora.map((f) => `${brandLabel(f.marca)}: ${f.motivo}`).join(" ")}
        />
      ) : (
        <Corpo dados={resultado.dados} dias={dias} />
      )}
    </>
  );
}

function Corpo({ dados, dias }: { dados: CxMlResponse; dias: number }) {
  const agora = Date.parse(dados.gerado_em);
  const r = resumoMl(dados);
  const prob = montarProblemasMl(dados, brandLabel);
  const atend = montarAtendimentoMl(dados, brandLabel, agora);
  const pareto = montarParetoMl(dados);
  const atencao = itensAtencaoMl(dados, brandLabel, agora);
  const semDiario = dados.diario_estado === "erro";
  const semRecl = dados.reclamacoes_estado === "erro";
  const sem = r.semAnterior.reclamacao;
  const comp = r.comparacao.reclamacao;
  const valor = pctCx(r.taxa.reclamacao);
  const porMarca = [...prob.linhas].filter((l) => l.celulas.reclamacao.pct !== "—");

  return (
    <>
      <Heroi
        rotulo={ROTULO_ML.reclamacao}
        ajuda={<InfoDica titulo={ROTULO_ML.reclamacao} texto={[AJUDA_ML.reclamacao, comp?.delta != null ? AJUDA_ML.comparacao(dias) : sem?.detalhe].filter(Boolean).join(" ")} />}
        valor={valor}
        tom={valor === "—" ? "ausente" : "neutro"}
        delta={comp ? pilula(comp) : undefined}
        contexto={
          <>
            {r.contagem.reclamacao != null && r.pedidos != null && (
              <span>
                {inteiro(r.contagem.reclamacao)} {r.contagem.reclamacao === 1 ? "reclamação" : "reclamações"} em {inteiro(r.pedidos)} pedidos
              </span>
            )}
            {!comp?.delta && r.taxa.reclamacao != null && sem && <LinhaSemComparacao {...sem} />}
          </>
        }
        erro={semDiario || semRecl ? (dados.motivo_indisponivel ?? "Fonte indisponível nesta carga.") : undefined}
        meio={porMarca.length ? <TaxaPorMarca linhas={porMarca} /> : undefined}
      />

      <Faixa r={r} dias={dias} esconderSem={!comp?.delta && r.taxa.reclamacao != null && !!sem ? sem.texto : null} />

      <FilaAtencao
        titulo={
          <span className="inline-flex items-center gap-1.5">
            O que exige atenção agora
            <InfoDica titulo="Fila" texto={`${AJUDA_ML.aguardando} ${AJUDA_ML.perguntas}`} />
          </span>
        }
        itens={atencao.map((x) => ({ chave: x.chave, severidade: x.severidade, titulo: x.titulo, detalhe: x.detalhe ?? undefined }))}
        vazio="Nenhuma reclamação com prazo vencido ou perto de vencer, nem pergunta sem resposta."
        erro={semRecl ? "A fila de reclamações está indisponível nesta carga." : undefined}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <Pareto v={pareto} />
        </div>
        <div className="min-w-0 lg:col-span-5">
          <ProblemasPorMarca linhas={prob.linhas} total={r} dias={dias} />
        </div>
      </div>

      <AtendimentoPorLoja v={atend} />

      <MaisDetalhes>
        <Notas
          notas={[
            ...(dados.pendencias ?? []).map((p) => `${p.titulo}: ${p.motivo}`),
            ...dados.cobertura.fora.map((f) => `${brandLabel(f.marca)} fica fora: ${f.motivo}`),
            `A coleta de reclamações cobre a partir de ${dados.coleta_desde.slice(8, 10)}/${dados.coleta_desde.slice(5, 7)}.`,
          ]}
        />
      </MaisDetalhes>
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. Heroi: taxa de reclamacao por marca (o "meio")
// ---------------------------------------------------------------------------
function TaxaPorMarca({ linhas }: { linhas: ReturnType<typeof montarProblemasMl>["linhas"] }) {
  return (
    <div data-testid="cx-ml-taxa-marcas">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Por marca, da maior para a menor</p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Taxa de reclamação por marca, da maior para a menor">
        {linhas.map((l) => (
          <li key={l.chave}>
            <Chip title={`${l.celulas.reclamacao.n} reclamações em ${l.pedidos} pedidos`}>
              <span className="font-semibold">{l.marca}</span> · {l.celulas.reclamacao.pct}
            </Chip>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Faixa de KPIs
// ---------------------------------------------------------------------------
function Faixa({ r, dias, esconderSem }: { r: ResumoMl; dias: number; esconderSem: string | null }) {
  // "comparação a partir de dd/mm" aparece UMA vez na tela (heroi ou 1o card); nos demais vira title
  const visto = new Set<string>(esconderSem ? [esconderSem] : []);
  const taxa = (i: IndicadorMl, identidade: IdentidadeKpi, icone: typeof Ban, comparacao: ReactNode) => {
    const c = r.comparacao[i];
    const sem = c?.delta == null && r.taxa[i] != null ? r.semAnterior[i] : undefined;
    let linha: ReactNode;
    let contexto: string | undefined;
    if (sem) {
      if (visto.has(sem.texto)) contexto = [sem.texto, sem.detalhe].filter(Boolean).join(" · ");
      else {
        visto.add(sem.texto);
        linha = <LinhaSemComparacao {...sem} />;
      }
    }
    return (
      <KpiTile
        variante="gerencial"
        identidade={identidade}
        icone={icone}
        rotulo={ROTULO_ML[i]}
        valor={pctCx(r.taxa[i])}
        tom={r.taxa[i] == null ? "ausente" : "neutro"}
        delta={c?.delta != null ? pilula(c) : undefined}
        antes={c?.delta != null ? c.antes : linha}
        serie={c?.serie ?? undefined}
        granularidade={c?.granularidade}
        comparacao={comparacao}
        ajuda={<InfoDica texto={[AJUDA_ML[i], c?.delta != null ? AJUDA_ML.comparacao(dias) : undefined].filter(Boolean).join(" ")} />}
        contexto={contexto}
      />
    );
  };
  const n = (i: IndicadorMl, um: string, varios: string) =>
    r.contagem[i] == null ? null : `${inteiro(r.contagem[i])} ${r.contagem[i] === 1 ? um : varios}`;
  return (
    <section aria-label="Indicadores do período">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="cx-faixa">
        {taxa("cancelamento", "ads", Ban, n("cancelamento", "pedido de cancelamento", "pedidos de cancelamento"))}
        {taxa("mediacao", "prazo", ShieldAlert, n("mediacao", "mediação", "mediações"))}
        <KpiTile
          variante="gerencial"
          identidade="atendimento"
          icone={MessageCircleQuestion}
          rotulo="Perguntas sem resposta"
          valor={inteiro(r.perguntasSemResposta)}
          tom={r.perguntasSemResposta == null ? "ausente" : "neutro"}
          comparacao={r.perguntas != null ? `${inteiro(r.perguntas)} perguntas no período` : null}
          ajuda={<InfoDica texto={AJUDA_ML.perguntas} />}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4a. Pareto dos problemas
// ---------------------------------------------------------------------------
/** Classes LITERAIS: o Tailwind so' gera o que encontra escrito. */
const COR_TIPO: Record<string, string> = {
  "Reclamação": "bg-canal-ml",
  Cancelamento: "bg-accent",
};

function Pareto({ v }: { v: ReturnType<typeof montarParetoMl> }) {
  return (
    <Panel titulo="Pareto dos problemas" aria-label="Pareto dos problemas" className="h-full">
      <div className="flex flex-col gap-4" data-testid="cx-pareto">
        {v.estado !== "dado" ? (
          <StateBlock
            tipo={v.estado === "erro" ? "erro" : v.estado === "vazio_legitimo" ? "vazio" : "indisponivel"}
            compacto
            titulo={v.motivo ?? "Sem dados"}
          />
        ) : (
          <ol className="flex min-w-0 flex-col gap-2.5" aria-label="Motivos, do maior para o menor">
            {v.itens.map((i) => (
              <li key={i.chave} className="flex min-h-11 flex-col justify-center gap-1 px-1.5 py-1">
                <div className="flex w-full items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words text-ink">
                    {i.rotulo}
                    {!i.mapeado && <span className="ml-1.5 text-xs text-warn-ink">(sem tradução)</span>}
                    <span className="ml-1.5 text-xs text-ink-faint">{i.tipo} · {i.natureza}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-muted">
                    {i.pct} <span className="text-xs">· {i.quantidade}</span>
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
                  <div className={`h-full rounded-full ${COR_TIPO[i.tipo] ?? "bg-accent"}`} style={{ width: `${i.largura}%` }} />
                </div>
              </li>
            ))}
            {v.resto && <li className="text-xs text-ink-faint">{v.resto}</li>}
          </ol>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 4b. Problemas por marca: um numero por celula (a taxa), a contagem no title
// ---------------------------------------------------------------------------
function CelulaTx({ c, total }: { c: CelulaTaxa; total?: boolean }) {
  return (
    <Celula valor={c.pct} dica={dica(c.n !== "—" && `${c.n} ${total ? "no total" : "casos"}`, c.antes && `Antes: ${c.antes}`)}>
      {c.delta && <span className={`ml-1 text-xs ${COR_DELTA[c.delta.sentido]}`}>{c.delta.texto}</span>}
    </Celula>
  );
}

function ProblemasPorMarca({ linhas, total, dias }: { linhas: ReturnType<typeof montarProblemasMl>["linhas"]; total: ResumoMl; dias: number }) {
  return (
    <Panel titulo="Problemas por marca" aria-label="Problemas por marca" semPadding>
      <TableScrollHint>
        <table className="w-full min-w-[460px] border-collapse text-sm" data-testid="cx-problemas-marca">
          <caption className="sr-only">Problemas por marca, em % dos pedidos</caption>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className={TH_MARCA}>Marca</th>
              <th scope="col" className={TH}>Pedidos</th>
              {INDICADORES_ML.map((i) => (
                <ThAjuda key={i} ajuda={`${AJUDA_ML[i]} ${AJUDA_ML.comparacao(dias)}`}>{i === "reclamacao" ? "Reclam." : i === "cancelamento" ? "Cancel." : "Mediações"}</ThAjuda>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className={TR}>
                <th scope="row" className="px-2 py-2 text-left font-medium text-ink">{l.marca}</th>
                <td className={TD}>{l.pedidos}</td>
                {INDICADORES_ML.map((i) => (
                  <CelulaTx key={i} c={l.celulas[i]} />
                ))}
              </tr>
            ))}
            <tr className={TR_TOTAL}>
              <th scope="row" className="px-2 py-2 text-left text-ink">Total</th>
              <td className={TD}>{inteiro(total.pedidos)}</td>
              {INDICADORES_ML.map((i) => (
                <Celula
                  key={i}
                  valor={pctCx(total.taxa[i])}
                  dica={dica(total.contagem[i] != null && `${inteiro(total.contagem[i])} casos`, total.comparacao[i]?.antes ?? null)}
                />
              ))}
            </tr>
          </tbody>
        </table>
      </TableScrollHint>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 5. Atendimento por loja: o que esta' esperando por nos
// ---------------------------------------------------------------------------
function AtendimentoPorLoja({ v }: { v: ReturnType<typeof montarAtendimentoMl> }) {
  return (
    <Panel titulo="Atendimento por loja" aria-label="Atendimento por loja" semPadding>
      <TableScrollHint>
        <table className="w-full min-w-[760px] border-collapse text-sm" data-testid="cx-atendimento">
          <caption className="sr-only">Atendimento do Mercado Livre por loja, da fila mais urgente para a menos</caption>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className={TH_MARCA}>Marca</th>
              <ThAjuda ajuda={AJUDA_ML.aguardando}>Aguardam nós</ThAjuda>
              <ThAjuda ajuda={AJUDA_ML.prazo}>Prazo</ThAjuda>
              <ThAjuda ajuda={AJUDA_ML.perguntas}>Perguntas s/ resp.</ThAjuda>
              <ThAjuda ajuda={AJUDA_ML.tempoResposta}>Tempo resp.</ThAjuda>
              <ThAjuda ajuda={AJUDA_ML.mensagens}>Msgs não lidas</ThAjuda>
              <ThAjuda ajuda={AJUDA_ML.primeiraResposta}>1ª ação nossa</ThAjuda>
            </tr>
          </thead>
          <tbody>
            {v.linhas.map((l) => (
              <tr key={l.chave} className={TR}>
                <th scope="row" className="px-2 py-2 text-left font-semibold text-ink">{l.marca}</th>
                <Celula valor={l.aguardando} dica={l.aguardandoDica}>
                  {l.vencidas > 0 && <span className="sr-only"> (com prazo vencido)</span>}
                </Celula>
                <td className={`${TD} ${l.prazo?.vencido ? "font-semibold text-crit-ink" : ""}`}>{l.prazo?.texto ?? "—"}</td>
                <td className={TD}>{l.perguntasSemResposta}</td>
                <td className={TD}>{l.tempoResposta}</td>
                <td className={TD}>{l.mensagens}</td>
                <Celula valor={l.primeiraResposta} dica={l.primeiraRespostaDica} />
              </tr>
            ))}
            <tr className={TR_TOTAL}>
              <th scope="row" className="px-2 py-2 text-left text-ink">Total</th>
              <td className={TD}>{v.total.aguardando}</td>
              <td className={TD} />
              <td className={TD}>{v.total.perguntasSemResposta}</td>
              <td className={TD} />
              <td className={TD}>{v.total.mensagens}</td>
              <td className={TD} />
            </tr>
          </tbody>
        </table>
      </TableScrollHint>
    </Panel>
  );
}
