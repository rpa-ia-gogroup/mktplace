"use client";

/**
 * Aba CX · Mercado Livre — a mesma grade da CX da Shopee (ALVO-GRADE, 12/11/2026),
 * com os numeros do ML:
 *   0. titulo + selo; o canal e' a ABA; filtros numa linha;
 *   1. quatro cartoes: Taxa de resposta (perguntas respondidas ÷ perguntas, com o selo da
 *      reputacao), Cancelamento, Devolucao e Reembolso (÷ pedidos); tendencia so' com serie real;
 *   2. dois paineis: Pareto dos problemas | O que exige atencao (com a Saude da Conta por marca);
 *   3. tabela em largura total: problemas por marca (reclamacao = contact rate do ML fica aqui);
 *   4. atendimento por loja: fila, prazo, perguntas, tempo de resposta;
 *   5. Mais detalhes: pendencias de fonte e a cobertura.
 * A metodologia mora nos ⓘ. Busca pelo navegador (`torreFetch`), como a Shopee.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Ban, MessageCircle, PackageX, Undo2 } from "lucide-react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import NumeroAnimado from "@/components/ui/NumeroAnimado";
import TableScrollHint from "@/components/TableScrollHint";
import CartaoIndicador from "@/components/ui/CartaoIndicador";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import type { IdentidadeKpi } from "@/components/ui/KpiTile";
import MaisDetalhes from "@/components/ui/MaisDetalhes";
import Panel from "@/components/ui/Panel";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import StateBlock from "@/components/ui/StateBlock";
import { inteiro, pctCx, reais, type FiltrosCx } from "@/lib/cx";
import {
  AJUDA_ML,
  INDICADORES_ML,
  ROTULO_ML,
  carregarCxMl,
  heroiMl,
  itensAtencaoMl,
  montarAtendimentoMl,
  montarParetoMl,
  montarProblemasMl,
  montarStatusMarcasMl,
  resumoMl,
  type CelulaTaxa,
  type CxMlResponse,
  type IndicadorTaxa,
  type ResultadoMl,
  type ResumoMl,
} from "@/lib/cx-ml";
import { brandLabel } from "@/lib/filters/brands";
import { textoJanela } from "@/lib/performance-contas-atendimento";
import { TITULO_SEGUNDA_TENTATIVA } from "@/lib/performance-contas";
import { torreFetch } from "@/lib/torre-fetch";

import {
  AbaCx,
  COR_CX,
  COR_DELTA,
  Celula,
  DetalheMarca,
  FaixaCarregando,
  GRADE_FAIXA,
  intervaloDaJanela,
  legendaSelo,
  Notas,
  PainelAtencao,
  PainelPareto,
  SaudePorMarca,
  TD,
  TentarNovamente,
  THEAD,
  TH,
  TH_MARCA,
  TR,
  TR_TOTAL,
  ThAjuda,
  dica,
  pesosDaColuna,
  pilulaCartao,
  pilulaSelo,
} from "./CxConteudo";

export default function CxMercadoLivre({ filtros }: { filtros: FiltrosCx }) {
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

  if (!resultado) {
    return (
      <AbaCx canal="ml" filtros={filtros} selo={<SeloAtualizado em={null} carregando />} faixa={<FaixaCarregando />}>
        <StateBlock tipo="carregando" titulo={repetindo ? TITULO_SEGUNDA_TENTATIVA : "Carregando a aba CX do Mercado Livre"} />
      </AbaCx>
    );
  }
  if (!resultado.ok) {
    return (
      <AbaCx canal="ml" filtros={filtros}>
        <StateBlock tipo="erro" titulo="Não foi possível carregar a aba CX" descricao={resultado.motivo} acao={<TentarNovamente onClick={() => carregar()} />} />
      </AbaCx>
    );
  }
  const dados = resultado.dados;
  const selo = (
    <span className="flex flex-wrap items-center gap-1.5" data-testid="cx-escopo">
      {/* dado velho fica ESCRITO ao lado do selo, nunca so' no title */}
      {dados.aviso_frescor && (
        <Chip tom="atencao" title={dados.aviso_frescor}>
          Coleta desatualizada
        </Chip>
      )}
      <SeloAtualizado em={dados.gerado_em} detalhe={`Pedidos e reclamações por data de abertura · ${textoJanela(dados.janela)}`} />
    </span>
  );
  if (dados.cobertura.marcas.length === 0) {
    return (
      <AbaCx canal="ml" filtros={filtros} intervalo={intervaloDaJanela(dados.janela)} selo={selo}>
        <StateBlock tipo="indisponivel" titulo="Sem conta no Mercado Livre" descricao={dados.cobertura.fora.map((f) => `${brandLabel(f.marca)}: ${f.motivo}`).join(" ")} />
      </AbaCx>
    );
  }
  return <Corpo dados={dados} filtros={filtros} selo={selo} />;
}

function Corpo({ dados, filtros, selo }: { dados: CxMlResponse; filtros: FiltrosCx; selo: ReactNode }) {
  const { dias } = filtros;
  const agora = Date.parse(dados.gerado_em);
  const r = resumoMl(dados);
  const prob = montarProblemasMl(dados, brandLabel);
  const atend = montarAtendimentoMl(dados, brandLabel, agora);
  const pareto = montarParetoMl(dados);
  const atencao = itensAtencaoMl(dados, brandLabel, agora);
  const status = montarStatusMarcasMl(dados, brandLabel);
  const heroi = heroiMl(dados, r);
  const semDiario = dados.diario_estado === "erro";
  const semRecl = dados.reclamacoes_estado === "erro";
  const sem = r.semAnterior.resposta;
  const comp = r.respostaComparacao;
  const [marcaAberta, setMarcaAberta] = useState<string | null>(null);
  // Cartao de taxa aberto no detalhe por marca (um dialogo por vez: o da marca fica fechado enquanto este abre).
  const [taxaAberta, setTaxaAberta] = useState<TaxaDoCartao | null>(null);
  const aberta = status.find((x) => x.chave === marcaAberta) ?? null;
  // a marca fora (Apice) nao e' problema: so' no ⓘ do heroi
  const fora = dados.cobertura.fora.map((f) => brandLabel(f.marca)).join(", ");

  return (
    <AbaCx
      canal="ml"
      filtros={filtros}
      intervalo={intervaloDaJanela(dados.janela)}
      selo={selo}
      faixa={
        <Faixa
          r={r}
          dias={dias}
          selo={heroi.selo}
          fila={heroi.contexto}
          erro={semDiario ? (dados.motivo_indisponivel ?? "Fonte indisponível nesta carga.") : null}
          ajudaResposta={[
            AJUDA_ML.resposta,
            comp?.delta != null ? AJUDA_ML.comparacaoAlta(dias) : sem ? [sem.texto, sem.detalhe].filter(Boolean).join(" · ") : undefined,
            fora ? `${fora}: sem conta no Mercado Livre, fica fora dos números.` : undefined,
          ]
            .filter(Boolean)
            .join(" ")}
          abrir={setTaxaAberta}
        />
      }
    >
      {/* Dois paineis lado a lado: por que (Pareto) | o que exige atencao */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <PainelPareto v={pareto} cores={COR_TIPO} semNome="motivo sem nome" />
        <PainelAtencao
          ajuda={`${AJUDA_ML.aguardando} ${AJUDA_ML.perguntas}`}
          saude={status.length ? <SaudePorMarca itens={status} abrir={setMarcaAberta} ajuda={AJUDA_ML.status} /> : null}
          itens={atencao.map((x) => ({ chave: x.chave, severidade: x.severidade, titulo: x.titulo, detalhe: x.detalhe ?? undefined }))}
          vazio="Nenhuma loja fora do limite, reclamação com prazo vencido ou pergunta sem resposta."
          erro={semRecl ? "A fila de reclamações está indisponível nesta carga." : undefined}
        />
      </div>

      <ProblemasPorMarca linhas={prob.linhas} total={r} dias={dias} />

      <AtendimentoPorLoja v={atend} />

      <MaisDetalhes>
        <Notas
          notas={[
            ...(dados.pendencias ?? []).map((p) => `${p.titulo}: ${p.motivo}`),
            `A coleta de reclamações cobre a partir de ${dados.coleta_desde.slice(8, 10)}/${dados.coleta_desde.slice(5, 7)}.`,
          ]}
        />
      </MaisDetalhes>

      <KpiDrilldownDialog
        open={taxaAberta != null}
        onClose={() => setTaxaAberta(null)}
        title={taxaAberta ? `${ROTULO_ML[taxaAberta]} · por marca` : ""}
        icone={taxaAberta ? VISUAL_TAXA[taxaAberta].icone : undefined}
        identidade={taxaAberta ? VISUAL_TAXA[taxaAberta].identidade : undefined}
      >
        {taxaAberta && <DetalheTaxa i={taxaAberta} r={r} linhas={prob.linhas} periodo={textoJanela(dados.janela)} geradoEm={dados.gerado_em} />}
      </KpiDrilldownDialog>

      <KpiDrilldownDialog open={aberta != null} onClose={() => setMarcaAberta(null)} title={aberta ? `${aberta.marca} · Saúde da Conta` : ""}>
        <DetalheMarca s={aberta} fila={null} />
      </KpiDrilldownDialog>
    </AbaCx>
  );
}

/** Cor e icone de cada taxa: o detalhe herda os do cartao que o abriu. */
/** As taxas que tem cartao na faixa (Reclamacao e Mediacoes ficam so' na tabela por marca). */
type TaxaDoCartao = "cancelamento" | "devolucao" | "reembolso";
const VISUAL_TAXA: Record<TaxaDoCartao, { identidade: IdentidadeKpi; icone: typeof Ban }> = {
  cancelamento: { identidade: "ads", icone: Ban },
  devolucao: { identidade: "pedidos", icone: PackageX },
  // azul, como o cartao (COR_CX.reembolso)
  reembolso: { identidade: "prazo", icone: Undo2 },
};

const ROTULO_CURTO: Record<IndicadorTaxa, string> = { reclamacao: "Reclam.", cancelamento: "Cancel.", mediacao: "Mediações", devolucao: "Devol.", reembolso: "Reemb." };

/** Detalhe de um cartao de taxa: o valor exato e a taxa de cada marca (so' dados que a resposta ja' traz). */
function DetalheTaxa({ i, r, linhas, periodo, geradoEm }: { i: TaxaDoCartao; r: ResumoMl; linhas: ReturnType<typeof montarProblemasMl>["linhas"]; periodo: string; geradoEm: string }) {
  const n = r.contagem[i];
  const valor = i === "reembolso" && r.valorReembolsado != null ? ` · ${reais(r.valorReembolsado)} reembolsados` : "";
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
          <NumeroAnimado texto={pctCx(r.taxa[i])} className="text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums" />
          <span className="pb-0.5 text-xs text-ink-faint tabular-nums">{n == null ? "" : `${inteiro(n)} de ${inteiro(r.pedidosBase[i])} pedidos${valor}`}</span>
        </div>
        <DrilldownContextLine leading="Mercado Livre" periodLabel={periodo} refreshedAt={geradoEm} dica={<InfoDica texto={AJUDA_ML[i]} />} />
      </div>
      <DrilldownSecao titulo="Por marca">
        <ul className="flex flex-col list-none p-0 m-0">
          {linhas.map((l) => {
            const c = l.celulas[i];
            return <EvidenceRow key={l.chave} label={l.marca} value={c.pct} reference={[`${c.n} de ${l.pedidos} pedidos`, c.valor, c.antes ? `antes ${c.antes}` : null].filter(Boolean).join(" · ")} />;
          })}
        </ul>
      </DrilldownSecao>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Faixa: quatro cartoes iguais — Taxa de resposta, Cancelamento, Devolução e Reembolso
// ---------------------------------------------------------------------------
function Faixa({
  r,
  dias,
  selo,
  fila,
  erro,
  ajudaResposta,
  abrir,
}: {
  r: ResumoMl;
  dias: number;
  selo: { texto: string; tom: "ok" | "critico" } | null;
  /** "25 perguntas aguardando · 24 há mais de 24 h · tempo de resposta 1 d 17 h" */
  fila: string | null;
  erro: string | null;
  ajudaResposta: string;
  abrir: (i: TaxaDoCartao) => void;
}) {
  const taxa = (i: TaxaDoCartao, cor: string, icone: typeof Ban, contagem: string | null) => {
    const c = r.comparacao[i];
    const sem = c?.delta == null && r.taxa[i] != null ? r.semAnterior[i] : undefined;
    return (
      <CartaoIndicador
        rotulo={ROTULO_ML[i]}
        icone={icone}
        cor={cor}
        valor={r.taxa[i] == null ? null : pctCx(r.taxa[i])}
        pilula={pilulaCartao(c)}
        // cobertura parcial e contagem ficam no cartao; sem periodo anterior, o motivo da API vai para o ⓘ
        legenda={contagem}
        serie={c?.serie}
        ajuda={
          <InfoDica
            emControle={r.taxa[i] != null}
            texto={[AJUDA_ML[i], c?.delta != null ? `${AJUDA_ML.comparacao(dias)} ${c.antes ?? ""}` : sem ? [sem.texto, sem.detalhe].filter(Boolean).join(" · ") : undefined].filter(Boolean).join(" ")}
          />
        }
        onAbrir={r.taxa[i] != null ? () => abrir(i) : undefined}
      />
    );
  };
  const n = (i: IndicadorTaxa, um: string, varios: string) => {
    if (r.contagem[i] == null) return i === "devolucao" ? "Coleta incompleta no período" : null;
    const { lidas, total } = r.marcasNaTaxa[i];
    // cobertura parcial aparece no card, nunca so' no ⓘ
    return `${inteiro(r.contagem[i])} ${r.contagem[i] === 1 ? um : varios}${lidas < total ? ` · ${lidas} de ${total} marcas` : ""}`;
  };
  const pilulaResposta = pilulaCartao(r.respostaComparacao);
  return (
    <section aria-label="Indicadores do período">
      <div className={GRADE_FAIXA} data-testid="cx-faixa">
        {/* a variacao e' a pilula (sem ela, o selo da reputacao). A API nao traz serie da resposta: a fila de perguntas ocupa o rodape */}
        <CartaoIndicador
          rotulo={ROTULO_ML.resposta}
          icone={MessageCircle}
          cor={COR_CX.resposta}
          valor={r.resposta == null ? null : pctCx(r.resposta)}
          pilula={pilulaResposta ?? pilulaSelo(selo)}
          legenda={erro ?? (pilulaResposta ? legendaSelo(selo) : null)}
          rodape={fila}
          ajuda={<InfoDica texto={ajudaResposta} />}
        />
        {taxa("cancelamento", COR_CX.cancelamento, Ban, n("cancelamento", "pedido cancelado", "pedidos cancelados"))}
        {taxa("devolucao", COR_CX.devolucao, PackageX, n("devolucao", "devolução", "devoluções"))}
        {taxa("reembolso", COR_CX.reembolso, Undo2, n("reembolso", "reembolso", "reembolsos"))}
      </div>
    </section>
  );
}

/** Classes LITERAIS: o Tailwind so' gera o que encontra escrito. */
const COR_TIPO: Record<string, string> = {
  "Reclamação": "bg-canal-ml",
  Cancelamento: "bg-accent",
};

// ---------------------------------------------------------------------------
// 3. Problemas por marca (largura total): um numero por celula (a taxa), com barrinha; a contagem no title
// ---------------------------------------------------------------------------
function CelulaTx({ c, total, barra }: { c: CelulaTaxa; total?: boolean; barra?: { peso: number; cor: string } | null }) {
  return (
    <Celula valor={c.pct} barra={barra} dica={dica(c.n !== "—" && `${c.n} ${total ? "no total" : "casos"}`, c.antes && `Antes: ${c.antes}`)}>
      {c.delta && <span className={`ml-1 text-xs ${COR_DELTA[c.delta.sentido]}`}>{c.delta.texto}</span>}
    </Celula>
  );
}

/** Colunas com barrinha (as do alvo): a cor e' a do cartao do mesmo indicador. */
const COR_COLUNA: Partial<Record<IndicadorTaxa, string>> = { cancelamento: COR_CX.cancelamento, devolucao: COR_CX.devolucao };

function ProblemasPorMarca({ linhas, total, dias }: { linhas: ReturnType<typeof montarProblemasMl>["linhas"]; total: ResumoMl; dias: number }) {
  const pesos = Object.fromEntries(INDICADORES_ML.map((i) => [i, pesosDaColuna(linhas.map((l) => l.celulas[i].pct))]));
  return (
    <Panel titulo="Problemas por marca" aria-label="Problemas por marca" semPadding>
      <TableScrollHint>
        <table className="w-full min-w-[760px] border-collapse text-sm" data-testid="cx-problemas-marca">
          <caption className="sr-only">Problemas por marca, em % dos pedidos</caption>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className={TH_MARCA}>Marca</th>
              <th scope="col" className={TH}>Pedidos</th>
              {INDICADORES_ML.map((i) => (
                <ThAjuda key={i} ajuda={`${AJUDA_ML[i]} ${AJUDA_ML.comparacao(dias)}`}>{ROTULO_CURTO[i]}</ThAjuda>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, k) => (
              <tr key={l.chave} className={TR}>
                <th scope="row" className="px-2 py-2 text-left font-medium text-ink">{l.marca}</th>
                <td className={TD}>{l.pedidos}</td>
                {INDICADORES_ML.map((i) => {
                  const peso = pesos[i][k];
                  const cor = COR_COLUNA[i];
                  return <CelulaTx key={i} c={l.celulas[i]} barra={cor && peso != null ? { peso, cor } : null} />;
                })}
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
              <ThAjuda ajuda={AJUDA_ML.mensagens}>Mensagens não lidas</ThAjuda>
              <ThAjuda ajuda={AJUDA_ML.primeiraResposta}>1ª resposta nossa</ThAjuda>
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
              <td className={TD}>—</td>
              <td className={TD}>{v.total.perguntasSemResposta}</td>
              <td className={TD}>—</td>
              <td className={TD}>{v.total.mensagens}</td>
              <td className={TD}>—</td>
            </tr>
          </tbody>
        </table>
      </TableScrollHint>
    </Panel>
  );
}
