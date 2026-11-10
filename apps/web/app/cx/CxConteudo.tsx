"use client";

/**
 * Aba CX — o corpo da pagina, buscado PELO NAVEGADOR.
 *
 * Desde o login Google (AUTH-GOOGLE, PR #172) a API e' chamada pela mesma
 * origem (`/torre-api/*`, `NEXT_PUBLIC_API_URL` relativa) para o cookie de
 * sessao chegar a ela. Um fetch no servidor nao resolve esse caminho relativo
 * (04/11/2026: "Não foi possível contatar a API"), por isso a busca e' aqui,
 * com `torreFetch`.
 *
 * CX-IDENTIDADE (08/11/2026, spec do Prumo): o esqueleto da Gerencial.
 *   0. cabecalho com chips (canal, janela, captura da Saude da Conta);
 *   1. heroi: taxa de resposta, selo da meta oficial, Saude da Conta por marca;
 *   2. faixa: contact rate, cancelamento, reembolso, reenvio (os do card CX
 *      da Gerencial, no periodo do filtro);
 *   3. "O que exige atencao agora";
 *   4. por que: Pareto dos problemas (7/12) | problemas por marca (5/12);
 *   5. atendimento por loja;
 *   6. avaliacoes de produto da Shopee (bloco proprio, falha sozinho);
 *      o CX do site (DTC) saiu da aba em 09/11, a pedido do usuario;
 *   7. Mais detalhes: fila do chat por espera e notas da coleta.
 * Um dialogo unico (`KpiDrilldownDialog`) para todos os detalhes.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Ban, MessageCircle, MessagesSquare, Undo2 } from "lucide-react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import TableScrollHint from "@/components/TableScrollHint";
import CxDrilldownContent from "@/components/gerencial/CxDrilldown";
import { LinhaSemComparacao, notasDoTile, pilula, rodapeComparacao, type RodapeCard } from "@/components/gerencial/CxResumo";
import PageHeader from "@/components/layout/PageHeader";
import Chip from "@/components/ui/Chip";
import FilaAtencao from "@/components/ui/FilaAtencao";
import Heroi from "@/components/ui/Heroi";
import InfoDica from "@/components/ui/InfoDica";
import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
import MaisDetalhes from "@/components/ui/MaisDetalhes";
import Panel from "@/components/ui/Panel";
import StateBlock from "@/components/ui/StateBlock";
import {
  AJUDA_CX,
  AJUDA_RISCO,
  ROTULO_INDICADOR,
  avisoColetaChat,
  carregarCxShopee,
  carregarPedidosMotivo,
  chipsCx,
  csvPedidosMotivo,
  heroiCx,
  itensAtencaoCx,
  montarAtendimentoCx,
  montarAvaliacaoLoja,
  montarPareto,
  montarPedidosMotivo,
  montarStatusMarcas,
  nomeDoCsvPedidos,
  resumoCxGerencial,
  tipoDoItem,
  type CelulaMeta,
  type CxShopeeResponse,
  type DeltaCx,
  type FiltrosCx,
  type IndicadorCx,
  type ItemPareto,
  type LinhaFilaCx,
  type ResultadoCx,
  type ResultadoPedidos,
  type ResumoCx,
  type StatusMarca,
  type VisaoAtendimentoCx,
  type VisaoPareto,
} from "@/lib/cx";
import { brandLabel } from "@/lib/filters/brands";
import { textoJanela } from "@/lib/performance-contas-atendimento";
import { TITULO_SEGUNDA_TENTATIVA } from "@/lib/performance-contas";
import { torreFetch } from "@/lib/torre-fetch";

import AvaliacoesProduto from "./AvaliacoesProduto";

export default function CxConteudo({ filtros, barra }: { filtros: FiltrosCx; barra: ReactNode }) {
  const { marca, dias } = filtros;
  const [resultado, setResultado] = useState<ResultadoCx | null>(null);
  const [repetindo, setRepetindo] = useState(false);

  const carregar = useCallback(() => {
    let vivo = true;
    setResultado(null);
    setRepetindo(false);
    const aoRepetir = () => vivo && setRepetindo(true);
    carregarCxShopee({ marca, dias }, torreFetch as typeof fetch, undefined, undefined, aoRepetir).then((r) => {
      if (vivo) setResultado(r);
    });
    return () => {
      vivo = false;
    };
  }, [marca, dias]);

  useEffect(() => carregar(), [carregar]);

  const chips = resultado?.ok ? chipsCx(resultado.dados) : null;
  // Avaliacoes de produto: busca propria, falha sozinha
  const avaliacoes = <AvaliacoesProduto filtros={filtros} />;

  return (
    <>
      <PageHeader
        title="CX"
        icon={MessageCircle}
        filters={barra}
        meta={
          <span className="flex flex-wrap items-center gap-1.5" data-testid="cx-escopo">
            {/* o canal (Shopee) mora na barra de filtros, como nas outras abas */}
            {/* um chip so': a captura da Saude da Conta vai no title; so' aparece escrita quando esta velha */}
            {chips && (
              <Chip title={chips.detalhe} tom={chips.saudeDesatualizada ? "atencao" : "neutro"}>
                {chips.janela}
                {chips.saudeDesatualizada && <span> · {chips.saudeDesatualizada}</span>}
                <span className="sr-only"> · {chips.detalhe}</span>
              </Chip>
            )}
          </span>
        }
      />
      {!resultado ? (
        <>
          <Heroi rotulo={ROTULO_INDICADOR.resposta} valor="—" carregando meio={null} />
          <StateBlock tipo="carregando" titulo={repetindo ? TITULO_SEGUNDA_TENTATIVA : "Carregando a aba CX"} />
          {avaliacoes}
        </>
      ) : !resultado.ok ? (
        <>
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
          {avaliacoes}
        </>
      ) : (
        <Corpo dados={resultado.dados} filtros={filtros} avaliacoes={avaliacoes} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Corpo: um dialogo unico para todos os detalhes
// ---------------------------------------------------------------------------
type Dialogo = { marca: string } | { indicador: IndicadorCx };

function Corpo({ dados, filtros, avaliacoes }: { dados: CxShopeeResponse; filtros: FiltrosCx; avaliacoes: ReactNode }) {
  const v = montarAtendimentoCx(dados, brandLabel);
  const r = resumoCxGerencial(dados, brandLabel);
  const status = montarStatusMarcas(dados, brandLabel);
  const pareto = montarPareto(dados, brandLabel);
  const heroi = heroiCx(v);
  const aviso = avisoColetaChat(dados);
  const atencao = itensAtencaoCx(dados, r, brandLabel);
  const janela = textoJanela(dados.janela);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  // trocar de filtro fecha o detalhe (ele seria de outro recorte)
  useEffect(() => setDialogo(null), [filtros.marca, filtros.dias]);

  const marcaAberta = dialogo && "marca" in dialogo ? status.find((s) => s.chave === dialogo.marca) ?? null : null;
  const titulo = !dialogo
    ? ""
    : "indicador" in dialogo
      ? `${ROTULO_INDICADOR[dialogo.indicador]} por marca · Shopee`
      : `${marcaAberta?.marca ?? brandLabel(dialogo.marca)} · Saúde da Conta`;

  return (
    <>
      <Heroi
        rotulo={ROTULO_INDICADOR.resposta}
        ajuda={<InfoDica titulo={ROTULO_INDICADOR.resposta} texto={notasDoTile(r, "resposta", filtros.dias).join(" ")} />}
        valor={r.resposta}
        tom={r.resposta === "—" ? "ausente" : "neutro"}
        // API-3: o heroi ganha so' a pilula (sem grafico)
        delta={r.comparacao.resposta ? pilula(r.comparacao.resposta) : undefined}
        contexto={
          // sem pilula, a linha neutra da API-3 ("comparação a partir de dd/mm"), como na Gerencial
          !r.comparacao.resposta?.delta && r.totais.resposta != null && r.semAnterior.resposta ? (
            <>
              {heroi.contexto && <span>{heroi.contexto}</span>}
              <LinhaSemComparacao {...r.semAnterior.resposta} />
            </>
          ) : (
            heroi.contexto
          )
        }
        aviso={aviso ? <Chip>{aviso}</Chip> : undefined}
        selo={heroi.selo ?? undefined}
        erro={v.estado === "erro" ? (v.motivo ?? "Atendimento indisponível nesta carga.") : undefined}
        meio={status.length ? <SaudePorMarca itens={status} abrir={(m) => setDialogo({ marca: m })} /> : undefined}
      />

      <Faixa r={r} dias={filtros.dias} abrir={(i) => setDialogo({ indicador: i })} />

      <FilaAtencao
        titulo={
          <span className="inline-flex items-center gap-1.5">
            O que exige atenção agora
            <InfoDica titulo="Fora da curva" texto={AJUDA_RISCO} />
          </span>
        }
        itens={atencao.map((x) => ({
          chave: x.chave,
          severidade: x.severidade,
          titulo: x.titulo,
          detalhe: x.detalhe ?? undefined,
          onAbrir: () => setDialogo(x.abre),
        }))}
        vazio="Nenhuma loja fora da meta nem conversa esperando há mais de 24 h."
      />

      {/* Por que: 7/12 (dominante) | 5/12 (ranking), como a 2a dobra da Gerencial */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">
          <Pareto v={pareto} filtros={filtros} />
        </div>
        <div className="min-w-0 lg:col-span-5">
          <ProblemasPorMarca v={pareto} />
        </div>
      </div>

      <AtendimentoPorLoja v={v} metaResposta={r.respostaMeta} metaNota={montarAvaliacaoLoja(dados, brandLabel)?.meta ?? null} />

      {avaliacoes}

      <MaisDetalhes resumo="fila do chat por tempo de espera e notas da coleta">
        {v.fila.length > 0 ? (
          <FilaChat linhas={v.fila} />
        ) : (
          <p className="text-xs text-ink-faint">Fila do chat: sem a leitura das faixas de espera nesta carga.</p>
        )}
        <Notas notas={[...new Set([...v.notas, ...pareto.notas])]} />
      </MaisDetalhes>

      <KpiDrilldownDialog open={dialogo != null} onClose={() => setDialogo(null)} title={titulo}>
        {dialogo && "indicador" in dialogo && (
          <CxDrilldownContent
            indicador={dialogo.indicador}
            resumo={r}
            notas={notasDoTile(r, dialogo.indicador, filtros.dias)}
            geradoEm={dados.gerado_em}
            periodo={janela}
            dias={filtros.dias}
          />
        )}
        {dialogo && "marca" in dialogo && (
          <DetalheMarca s={marcaAberta} fila={v.fila.find((f) => f.chave === dialogo.marca) ?? null} />
        )}
      </KpiDrilldownDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Pecas
// ---------------------------------------------------------------------------
function Notas({ notas }: { notas: string[] }) {
  if (!notas.length) return null;
  return (
    <ul className="flex flex-col gap-0.5 text-xs text-ink-faint" data-testid="cx-notas">
      {notas.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

/** Classes da tabela (DESIGN.md §5 Tables): cabeca em `raised`, numeros a direita. */
const THEAD = "bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint";
const TH = "whitespace-nowrap px-2 py-2 text-right";
const TH_MARCA = "px-2 py-2 text-left";
const TD = "whitespace-nowrap px-2 py-2 text-right tabular-nums text-ink-muted";
const TR = "border-t border-line hover:bg-raised/60";
const TR_TOTAL = "border-t-2 border-line-strong bg-raised font-semibold";

/** Cabecalho de coluna com "ⓘ" e/ou dica em title + sr-only. */
function ThAjuda({ children, ajuda, dica }: { children: string; ajuda?: string; dica?: string | null }) {
  return (
    <th scope="col" className={TH} title={dica ?? undefined}>
      <span className="inline-flex items-center justify-end gap-1">
        {children}
        {dica && <span className="sr-only"> ({dica})</span>}
        {ajuda && <InfoDica texto={ajuda} titulo={children} />}
      </span>
    </th>
  );
}

/** Um numero por celula; o detalhe fica no title e no texto so' para leitor de tela. */
function Celula({ valor, dica, children }: { valor: string; dica?: string | null; children?: ReactNode }) {
  return (
    <td className={TD} title={dica ?? undefined}>
      <span className={valor === "—" ? "text-ink-faint" : "text-ink"}>{valor}</span>
      {children}
      {dica && <span className="sr-only"> ({dica})</span>}
    </td>
  );
}

/** Valor oficial com a meta da Shopee; fora da meta em vermelho. */
function ComMeta({ c }: { c: CelulaMeta | null }) {
  if (!c) return <span className="text-ink-faint">—</span>;
  return (
    <span
      title={c.meta ?? undefined}
      className={c.fora ? "rounded-md bg-crit-soft px-1.5 py-0.5 font-bold text-crit-ink ring-1 ring-crit/30" : "text-ink"}
    >
      {c.valor}
      {c.fora && <span className="sr-only"> (fora da meta)</span>}
    </span>
  );
}

const COR_DELTA: Record<DeltaCx["sentido"], string> = {
  piorou: "font-semibold text-crit-ink",
  melhorou: "font-semibold text-ok-ink",
  estavel: "text-ink-faint",
};

/** "3 cancelamentos · Antes: 1,0%" — "—" nao entra (ausencia nunca vira texto de zero). */
function dica(...partes: (string | null | false)[]): string | null {
  const ok = partes.filter((p): p is string => !!p);
  return ok.length ? ok.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// 1. Heroi: Saude da Conta por marca (o "meio")
// ---------------------------------------------------------------------------
function SaudePorMarca({ itens, abrir }: { itens: StatusMarca[]; abrir: (marca: string) => void }) {
  return (
    <div data-testid="cx-status-marcas">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Saúde da Conta por marca
        <span className="inline-flex normal-case tracking-normal">
          <InfoDica texto={AJUDA_CX.status} titulo="Saúde da Conta" />
        </span>
      </p>
      <ul className="flex flex-wrap gap-x-1.5" aria-label="Saúde da Conta por marca, da pior para a melhor">
        {itens.map((s) => (
          <li key={s.chave}>
            <button
              type="button"
              onClick={() => abrir(s.chave)}
              aria-haspopup="dialog"
              title={s.alertas.join(" · ") || undefined}
              className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {/* borda em ink-faint: line-strong ficava abaixo de 3:1 no vidro (1,9 no escuro) */}
              {s.tom === "ausente" ? (
                <span className="inline-flex items-center whitespace-nowrap rounded-md border border-dashed border-ink-faint px-2 py-1 text-xs font-medium text-ink-faint hover:bg-raised">
                  {s.marca} · {s.rotulo}
                </span>
              ) : (
                <Chip tom={s.tom} ponto>
                  <span className="font-semibold">{s.marca}</span> · {s.rotulo}
                </Chip>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Detalhe da marca: o cartao do antigo "Status por marca", inteiro. */
function DetalheMarca({ s, fila }: { s: StatusMarca | null; fila: LinhaFilaCx | null }) {
  if (!s) return <p className="text-sm text-ink-faint">Sem dados desta loja no recorte.</p>;
  const numeros: [string, string][] = [
    ["Aguardando", s.aguardando],
    ["Cancel.", s.cancelamento],
    ["Devol.", s.devolucoes],
  ];
  if (fila) numeros.push(["Há mais de 24 h", fila.mais24h], ["Mais antiga", fila.maisAntiga]);
  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="cx-detalhe-marca">
      <div className="flex flex-wrap items-center gap-2">
        {s.tom === "ausente" ? <Chip tom="ausente">{s.rotulo}</Chip> : <Chip tom={s.tom} ponto>{s.rotulo}</Chip>}
      </div>
      {s.tom === "ausente" ? (
        <p className="text-sm text-ink-muted">{s.alertas[0] ?? "Sem fotografia da Saúde da Conta."}</p>
      ) : s.alertas.length ? (
        <ul className="flex flex-col gap-1 text-sm font-medium text-crit-ink">
          {s.alertas.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ok-ink">Todas as métricas na meta</p>
      )}
      <dl className="grid grid-cols-3 gap-3 border-t border-line pt-3">
        {numeros.map(([rot, val]) => (
          <div key={rot} className="min-w-0">
            <dt className="text-xs text-ink-faint">{rot}</dt>
            <dd className={`font-semibold tabular-nums ${val === "—" ? "text-ink-faint" : "text-ink"}`}>{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Faixa de KPIs: os do card CX da Gerencial, menos a resposta (heroi) e o
//    Reenvio sem fonte (cartao sem numero nao entra na 1a dobra; a nota esta'
//    em Mais detalhes)
// ---------------------------------------------------------------------------
function Faixa({ r, dias, abrir }: { r: ResumoCx; dias: number; abrir: (i: IndicadorCx) => void }) {
  const tile = (
    i: IndicadorCx,
    identidade: IdentidadeKpi,
    icone: typeof Ban,
    valor: string,
    comparacao: ReactNode,
    extra: RodapeCard = {},
  ) => (
    <KpiTile
      variante="gerencial"
      identidade={identidade}
      icone={icone}
      rotulo={ROTULO_INDICADOR[i]}
      valor={valor}
      tom={valor === "—" ? "ausente" : "neutro"}
      delta={extra.delta}
      antes={extra.antes}
      serie={extra.serie}
      granularidade={extra.granularidade}
      comparacao={comparacao}
      // dentro de botao: o ⓘ so' tem `title`; o detalhe aberto traz as mesmas ressalvas
      ajuda={<InfoDica emControle texto={notasDoTile(r, i, dias).join(" ")} />}
      onAbrir={() => abrir(i)}
    />
  );
  return (
    <section aria-label="Indicadores do período">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="cx-faixa">
        {/* cor de identidade (spec do Prumo, 09/11): a mesma do card CX da Gerencial */}
        {tile("contactRate", "atendimento", MessagesSquare, r.contactRate, dias > 30 ? "só em 7 e 30 dias" : null, dias > 30 ? {} : rodapeComparacao(r, "contactRate"))}
        {tile("cancelamento", "ads", Ban, r.cancelamento, null, rodapeComparacao(r, "cancelamento"))}
        {/* % antes do absoluto: a taxa no numero, o R$ realizado embaixo */}
        {tile("reembolso", "gmv", Undo2, r.reembolsoPct ?? "—", r.reembolsado !== "—" ? `${r.reembolsado} reembolsado` : null, rodapeComparacao(r, "reembolso"))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4a. Pareto dos problemas (7/12)
// ---------------------------------------------------------------------------
/** Classes LITERAIS: o Tailwind so' gera o que encontra escrito. */
const COR_TIPO: Record<string, string> = {
  "Devolução": "bg-canal-shopee",
  Cancelamento: "bg-accent",
};

function Pareto({ v, filtros }: { v: VisaoPareto; filtros: FiltrosCx }) {
  const [aberto, setAberto] = useState<ItemPareto | null>(null);
  // trocar de filtro fecha a lista (ela seria de outro recorte)
  useEffect(() => {
    setAberto(null);
  }, [filtros.marca, filtros.dias]);
  return (
    <Panel
      titulo="Pareto dos problemas"
      aria-label="Pareto dos problemas"
      className="h-full"
    >
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
              <li key={i.chave}>
                <button
                  type="button"
                  onClick={() => setAberto(aberto?.chave === i.chave ? null : i)}
                  aria-expanded={aberto?.chave === i.chave}
                  aria-controls="cx-pedidos-motivo"
                  title={`Acumulado ${i.acumulado} · ver os pedidos deste motivo`}
                  className={`flex min-h-11 w-full flex-col justify-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    aberto?.chave === i.chave ? "bg-raised ring-1 ring-line-strong" : ""
                  }`}
                >
                  <div className="flex w-full items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words text-ink">
                      {i.rotulo}
                      {!i.mapeado && <span className="ml-1.5 text-xs text-warn-ink">(sem tradução)</span>}
                      <span className="ml-1.5 text-xs text-ink-faint">{i.tipo} · {i.natureza}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-muted">
                      {i.pct} <span className="text-xs">· {i.quantidade}</span>
                      <span className="sr-only"> · acumulado {i.acumulado}</span>
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
                    <div className={`h-full rounded-full ${COR_TIPO[i.tipo] ?? "bg-accent"}`} style={{ width: `${i.largura}%` }} />
                  </div>
                </button>
              </li>
            ))}
            {v.resto && <li className="text-xs text-ink-faint">{v.resto}</li>}
          </ol>
        )}
        {aberto && <PedidosDoMotivo item={aberto} filtros={filtros} fechar={() => setAberto(null)} />}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 4b. Problemas por marca (5/12): um numero por celula, total em raised
// ---------------------------------------------------------------------------
function ProblemasPorMarca({ v }: { v: VisaoPareto }) {
  const t = v.total;
  return (
    <Panel titulo="Problemas por marca" aria-label="Problemas por marca" semPadding>
      {v.linhas.length === 0 ? (
        <div className="p-4">
          <StateBlock tipo="indisponivel" compacto titulo="Sem pedidos por marca nesta carga" />
        </div>
      ) : (
        <TableScrollHint>
          <table className="w-full min-w-[420px] border-collapse text-sm" data-testid="cx-problemas-marca">
            <caption className="sr-only">Problemas por marca</caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={TH_MARCA}>Marca</th>
                <th scope="col" className={TH}>Pedidos</th>
                <ThAjuda ajuda={AJUDA_CX.cancelamentosMarca}>Cancel.</ThAjuda>
                <ThAjuda ajuda={AJUDA_CX.devolucoesMarca}>Devol.</ThAjuda>
                <ThAjuda ajuda={AJUDA_CX.reembolsadoMarca}>Reembolsado</ThAjuda>
              </tr>
            </thead>
            <tbody>
              {v.linhas.map((l) => (
                <tr key={l.chave} className={TR}>
                  <th scope="row" className="px-2 py-2 text-left font-medium text-ink">{l.marca}</th>
                  <td className={TD}>{l.pedidos}</td>
                  <Celula
                    valor={l.cancelamentosPct}
                    dica={dica(l.cancelamentos !== "—" && `${l.cancelamentos} cancelamentos`, l.cancelamentoAntes && `Antes: ${l.cancelamentoAntes}`)}
                  >
                    {l.cancelamentoDelta && <span className={`ml-1 text-xs ${COR_DELTA[l.cancelamentoDelta.sentido]}`}>{l.cancelamentoDelta.texto}</span>}
                  </Celula>
                  <Celula valor={l.devolucoesPct} dica={dica(l.devolucoes !== "—" && `${l.devolucoes} devoluções`)} />
                  <Celula valor={l.reembolsado} dica={dica(l.reembolsoPct && `${l.reembolsoPct} aceitas/pedidos`)} />
                </tr>
              ))}
              <tr className={TR_TOTAL}>
                <th scope="row" className="px-2 py-2 text-left text-ink">Total</th>
                <td className={TD}>{t.pedidos}</td>
                <Celula
                  valor={t.cancelamentosPct}
                  dica={dica(v.totais.cancelamentos !== "—" && `${v.totais.cancelamentos} cancelamentos`, t.cancelamentoAntes && `Antes: ${t.cancelamentoAntes}`)}
                >
                  {t.cancelamentoDelta && <span className={`ml-1 text-xs ${COR_DELTA[t.cancelamentoDelta.sentido]}`}>{t.cancelamentoDelta.texto}</span>}
                </Celula>
                <Celula valor={t.devolucoesPct} dica={dica(t.devolucoes !== "—" && `${t.devolucoes} devoluções`)} />
                <Celula valor={t.reembolsado} dica={dica(t.reembolsoPct && `${t.reembolsoPct} aceitas/pedidos`)} />
              </tr>
            </tbody>
          </table>
        </TableScrollHint>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 5. Atendimento por loja: pior nota primeiro
// ---------------------------------------------------------------------------
function AtendimentoPorLoja({ v, metaResposta, metaNota }: { v: VisaoAtendimentoCx; metaResposta: string | null; metaNota: string | null }) {
  // A antiga "(pior)" da avaliacao virou a ordem: nota mais baixa primeiro, sem nota no fim.
  const linhas = [...v.linhas].sort((a, b) => (a.notaNum ?? Infinity) - (b.notaNum ?? Infinity));
  return (
    <Panel titulo="Atendimento por loja" aria-label="Atendimento por loja" semPadding>
      {v.estado !== "dado" ? (
        <div className="p-4">
          <StateBlock
            tipo={v.estado === "erro" ? "erro" : "indisponivel"}
            compacto
            titulo={v.estado === "erro" ? "Atendimento indisponível nesta carga" : "Sem dados de atendimento"}
            descricao={v.motivo ?? undefined}
          />
        </div>
      ) : (
        <TableScrollHint>
          <table className="w-full min-w-[760px] border-collapse text-sm" data-testid="cx-atendimento">
            <caption className="sr-only">Atendimento do chat por loja Shopee, da pior nota para a melhor</caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={TH_MARCA}>Marca</th>
                <ThAjuda ajuda={AJUDA_CX.conversas} dica={dica(v.rotuloConversas, v.linhas.some((l) => l.conversas.startsWith("≥")) && "“≥” = a coleta leu menos conversas do que a loja tem: o número é um piso")}>Conversas</ThAjuda>
                <ThAjuda ajuda={AJUDA_CX.aguardandoPct}>Aguardando</ThAjuda>
                <ThAjuda ajuda={AJUDA_CX.naoLidas}>Não lidas</ThAjuda>
                <ThAjuda dica={metaResposta}>{ROTULO_INDICADOR.resposta}</ThAjuda>
                <ThAjuda ajuda={AJUDA_CX.avaliacao} dica={metaNota}>Nota</ThAjuda>
                <ThAjuda ajuda={AJUDA_CX.tempoResposta}>Tempo resp.</ThAjuda>
                <ThAjuda ajuda={AJUDA_CX.contactRate}>Contact rate</ThAjuda>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.chave} className={TR}>
                  <th scope="row" className="px-2 py-2 text-left font-semibold text-ink">{l.marca}</th>
                  <td className={TD}>{l.conversas}</td>
                  <Celula valor={l.aguardandoPct} dica={dica(l.aguardando !== "—" && `${l.aguardando} aguardando`)} />
                  <td className={TD}>{l.naoLidas}</td>
                  <td className={TD}><ComMeta c={l.respondido} /></td>
                  <td className={TD}><ComMeta c={l.nota} /></td>
                  <Celula valor={l.tempoResposta} dica={l.tempoDetalhe} />
                  <td className={TD}>{l.contactRate}</td>
                </tr>
              ))}
              <tr className={TR_TOTAL}>
                <th scope="row" className="px-2 py-2 text-left text-ink">Total</th>
                <td className={TD}>{v.totais.conversas}</td>
                <Celula valor={v.totais.aguardandoPct} dica={dica(v.totais.aguardando !== "—" && `${v.totais.aguardando} aguardando`)} />
                <td className={TD}>{v.totais.naoLidas}</td>
                <td className={TD} colSpan={4} />
              </tr>
            </tbody>
          </table>
        </TableScrollHint>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// 7. Mais detalhes: fila do chat por tempo de espera
// ---------------------------------------------------------------------------
function FilaChat({ linhas }: { linhas: LinhaFilaCx[] }) {
  return (
    <section aria-labelledby="cx-fila-titulo" className="flex flex-col gap-2" data-testid="cx-fila">
      <h3 id="cx-fila-titulo" className="flex items-center gap-1 text-sm font-semibold text-ink">
        Fila do chat: há quanto tempo o comprador espera
        <InfoDica texto={AJUDA_CX.fila} titulo="Fila do chat" />
      </h3>
      <TableScrollHint>
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <caption className="sr-only">Conversas aguardando resposta por tempo de espera</caption>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className={TH_MARCA}>Marca</th>
              <th scope="col" className={TH}>Até 1 h</th>
              <th scope="col" className={TH}>1 a 4 h</th>
              <th scope="col" className={TH}>4 a 24 h</th>
              <th scope="col" className={TH}>Mais de 24 h</th>
              <th scope="col" className={TH}>Mais antiga</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className={TR}>
                <th scope="row" className="px-2 py-2 text-left font-semibold text-ink">{l.marca}</th>
                <td className={TD}>{l.ate1h}</td>
                <td className={TD}>{l.de1a4h}</td>
                <td className={TD}>{l.de4a24h}</td>
                <td className={`${TD} ${l.atrasada ? "font-semibold text-crit-ink" : ""}`}>{l.mais24h}</td>
                <td className={TD}>{l.maisAntiga}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollHint>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pedidos de um motivo (clique no Pareto)
// ---------------------------------------------------------------------------
function baixarCsv(conteudo: string, nome: string): void {
  let url: string | null = null;
  try {
    url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = nome;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

function PedidosDoMotivo({ item, filtros, fechar }: { item: ItemPareto; filtros: FiltrosCx; fechar: () => void }) {
  const tipo = tipoDoItem(item);
  const [r, setR] = useState<ResultadoPedidos | null>(null);
  const caixa = useRef<HTMLElement>(null);
  // a lista abre abaixo dos motivos: leva o olho ate' ela
  useEffect(() => {
    // chaves: o Chrome novo devolve uma Promise de scrollIntoView, e o React
    // trataria o retorno como funcao de limpeza
    caixa.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [item.chave]);
  useEffect(() => {
    let vivo = true;
    setR(null);
    carregarPedidosMotivo(filtros, tipo, item.codigo, torreFetch as typeof fetch).then((x) => {
      if (vivo) setR(x);
    });
    return () => {
      vivo = false;
    };
  }, [filtros, tipo, item.codigo]);

  const v = r?.ok && r.dados.estado !== "erro" ? montarPedidosMotivo(r.dados, brandLabel) : null;
  return (
    <section ref={caixa} id="cx-pedidos-motivo" aria-label={`Pedidos: ${item.rotulo}`} className="rounded-lg border border-line bg-surface p-3" data-testid="cx-pedidos-motivo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">
          {item.tipo} · {item.rotulo}
          {v && <span className="ml-2 text-xs font-normal text-ink-muted">{v.resumo}</span>}
        </h3>
        <div className="flex items-center gap-2">
          {v && v.linhas.length > 0 && r?.ok && (
            <button
              type="button"
              onClick={() => baixarCsv(csvPedidosMotivo(r.dados, item.rotulo), nomeDoCsvPedidos(tipo, item.codigo, filtros, new Date()))}
              className="min-h-11 rounded-md border border-line-strong px-3 text-xs font-semibold text-ink hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Baixar CSV
            </button>
          )}
          <button
            type="button"
            onClick={fechar}
            className="min-h-11 rounded-md px-3 text-xs font-semibold text-ink-muted hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Fechar
          </button>
        </div>
      </div>
      {!r ? (
        <StateBlock tipo="carregando" compacto titulo="Carregando os pedidos" />
      ) : !r.ok || !v ? (
        <StateBlock tipo="erro" compacto titulo="Não foi possível carregar os pedidos" descricao={r.ok ? r.dados.motivo_indisponivel ?? undefined : r.motivo} />
      ) : !v.linhas.length ? (
        <StateBlock tipo="vazio" compacto titulo={r.dados.motivo_indisponivel ?? "Nenhum pedido com este motivo no período."} />
      ) : (
        <div className="mt-2 max-h-96 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Pedidos com o motivo {item.rotulo}</caption>
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-left text-xs font-semibold text-ink-faint">
                <th scope="col" className="py-2 pr-3">Pedido</th>
                <th scope="col" className="px-2 py-2">Marca</th>
                <th scope="col" className="px-2 py-2">Dia</th>
                <th scope="col" className="px-2 py-2">Situação</th>
                {v.comValor && <th scope="col" className={TH}>Reembolsado</th>}
              </tr>
            </thead>
            <tbody>
              {v.linhas.map((l) => (
                <tr key={l.chave} className="border-b border-line last:border-b-0">
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs text-ink">{l.pedido}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink-muted">{l.marca}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-ink-muted">{l.dia}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-ink-muted">{l.situacao}</td>
                  {v.comValor && <td className={TD}>{l.valor}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {v && <Notas notas={v.avisos} />}
    </section>
  );
}
