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
 * ALVO-GRADE (12/11/2026): a grade unica das abas (`layout/Aba`).
 *   0. titulo + selo "Atualizado HH:MM"; os canais (Shopee | Mercado Livre) sao ABAS;
 *   1. filtros numa linha (marca e periodo);
 *   2. quatro cartoes iguais: Taxa de resposta (com o selo da meta oficial),
 *      Cancelamento, Devolucao e Reembolso; linha de tendencia so' com serie real;
 *   3. dois paineis: Pareto dos problemas | O que exige atencao (com a Saude da
 *      Conta por marca);
 *   4. tabela em largura total: problemas por marca, com barrinha;
 *   5. atendimento por loja (o Contact rate fica aqui, com o total);
 *   6. avaliacoes de produto da Shopee (bloco proprio, falha sozinho);
 *   7. Mais detalhes: fila do chat por espera e notas da coleta.
 * Um dialogo unico (`KpiDrilldownDialog`) para todos os detalhes.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Ban, MessageCircle, PackageX, Undo2 } from "lucide-react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import TableScrollHint from "@/components/TableScrollHint";
import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import CxDrilldownContent from "@/components/gerencial/CxDrilldown";
import { notasDoTile, rodapeComparacao } from "@/components/gerencial/CxResumo";
import Aba from "@/components/layout/Aba";
import CartaoIndicador, { type TomPilula } from "@/components/ui/CartaoIndicador";
import CelulaBarra from "@/components/ui/CelulaBarra";
import Chip from "@/components/ui/Chip";
import FilaAtencao, { type ItemAtencao } from "@/components/ui/FilaAtencao";
import InfoDica from "@/components/ui/InfoDica";
import MaisDetalhes from "@/components/ui/MaisDetalhes";
import NumeroAnimado from "@/components/ui/NumeroAnimado";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import StateBlock from "@/components/ui/StateBlock";
import {
  AJUDA_CX,
  AJUDA_RISCO,
  CANAIS_CX,
  ROTULO_INDICADOR,
  avisoColetaChat,
  carregarCxShopee,
  carregarPedidosMotivo,
  chipsCx,
  csvPedidosMotivo,
  heroiCx,
  hrefCx,
  itensAtencaoCx,
  montarAtendimentoCx,
  montarAvaliacaoLoja,
  montarPareto,
  montarPedidosMotivo,
  montarStatusMarcas,
  nomeDoCsvPedidos,
  resumoCxGerencial,
  tipoDoItem,
  type CanalCx,
  type CelulaMeta,
  type CxShopeeResponse,
  type DeltaCx,
  type FiltrosCx,
  type IndicadorCx,
  type ItemPareto,
  type LinhaFilaCx,
  type ResultadoCx,
  type ResultadoPedidos,
  type StatusMarca,
  type VisaoAtendimentoCx,
  type VisaoPareto,
} from "@/lib/cx";
import { brandLabel } from "@/lib/filters/brands";
import { fmtDelta } from "@/lib/formatters";
import type { DeltaTone } from "@/lib/gerencial/kpi-band";
import { textoJanela } from "@/lib/performance-contas-atendimento";
import { TITULO_SEGUNDA_TENTATIVA } from "@/lib/performance-contas";
import { torreFetch } from "@/lib/torre-fetch";

import AvaliacoesProduto from "./AvaliacoesProduto";
import FiltrosCxBarra from "./FiltrosCx";

// ---------------------------------------------------------------------------
// Moldura da aba (ALVO-GRADE): titulo + selo, os canais como ABAS, filtros, faixa
// ---------------------------------------------------------------------------
/** Os canais da CX viram as abas sob o titulo; a URL continua a mesma (`?canal=ml`). */
const VISOES_CX = CANAIS_CX.map((c) => ({ id: c.valor, rotulo: c.rotulo, ponto: c.ponto }));

/**
 * Cores de identidade dos quatro cartoes, na ordem do alvo aprovado (violeta,
 * rosa, ambar, azul), pelos tokens do tema; bom/ruim fica so' na pilula.
 */
export const COR_CX = {
  resposta: "rgb(var(--tc-kpi-gmv))",
  cancelamento: "rgb(var(--tc-kpi-ads))",
  devolucao: "rgb(var(--tc-kpi-pedidos))",
  reembolso: "rgb(var(--tc-kpi-prazo))",
} as const;

export const GRADE_FAIXA = "grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4";

/** "13/10–11/11" da janela que a API devolveu (o intervalo real dos dias fechados). */
export const intervaloDaJanela = (j: { inicio: string; fim: string }): string =>
  `${j.inicio.slice(8, 10)}/${j.inicio.slice(5, 7)}–${j.fim.slice(8, 10)}/${j.fim.slice(5, 7)}`;

export function AbaCx({ canal, filtros, intervalo, selo, faixa, children }: { canal: CanalCx; filtros: FiltrosCx; intervalo?: string; selo?: ReactNode; faixa?: ReactNode; children?: ReactNode }) {
  const router = useRouter();
  return (
    <Aba
      titulo="CX"
      selo={selo}
      visoes={VISOES_CX}
      visao={canal}
      onVisao={(c) => c !== canal && router.push(hrefCx(filtros, c), { scroll: false })}
      filtros={<FiltrosCxBarra f={filtros} canal={canal} intervalo={intervalo} />}
      faixa={faixa}
    >
      {children}
    </Aba>
  );
}

/** Os quatro cartoes enquanto a resposta nao chega (o mesmo esqueleto da faixa da Gerencial). */
export function FaixaCarregando() {
  return (
    <div className={GRADE_FAIXA} aria-busy="true">
      {[0, 1, 2, 3].map((k) => (
        <div key={k} className="h-[150px] animate-pulse rounded-2xl border border-line bg-surface p-4" role="status">
          <span className="sr-only">Carregando indicador…</span>
          <div className="h-3 w-24 rounded bg-raised" />
          <div className="mt-3 h-8 w-36 rounded bg-raised" />
        </div>
      ))}
    </div>
  );
}

export function TentarNovamente({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 inline-flex min-h-11 items-center rounded-lg border border-current/30 px-3 text-xs font-semibold hover:bg-surface/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      Tentar novamente
    </button>
  );
}

/**
 * Pilula do cartao a partir de um delta da API-3. A mesma regra do `pilula` do
 * CxResumo: menos de 0,05 e' estavel, sem cor de juizo.
 */
export function pilulaCartao(c: { delta: number | null; unidade: "pp" | "pct" | "pts"; tone: DeltaTone } | null | undefined): { texto: string; tom: TomPilula } | null {
  if (c?.delta == null) return null;
  const estavel = Math.abs(c.delta) < 0.05;
  return {
    texto: `${fmtDelta(estavel ? 0 : c.delta, c.unidade)} vs anterior`,
    tom: estavel || c.tone === "neutral" ? "neutro" : (c.delta >= 0) !== (c.tone === "lower_is_better") ? "ok" : "crit",
  };
}

/** Selo da meta oficial (regra de negocio) como pilula do cartao. */
export const pilulaSelo = (s: { texto: string; tom: "ok" | "critico" } | null): { texto: string; tom: TomPilula } | null =>
  s ? { texto: s.texto, tom: s.tom === "ok" ? "ok" : "crit" } : null;

/** O selo da meta como legenda (quando a pilula e' a variacao): fora da meta continua em vermelho e escrito. */
export const legendaSelo = (s: { texto: string; tom: "ok" | "critico" } | null): ReactNode =>
  s ? <span className={s.tom === "ok" ? undefined : "font-semibold text-crit-ink"}>{s.texto}</span> : null;

/** "—" (ausencia) vira `null`: o cartao escreve "N/D", nunca zero. */
export const valorCartao = (v: string | null | undefined): string | null => (v && v !== "—" ? v : null);

export default function CxConteudo({ filtros }: { filtros: FiltrosCx }) {
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

  // Avaliacoes de produto: busca propria, falha sozinha
  const avaliacoes = <AvaliacoesProduto filtros={filtros} />;

  if (!resultado) {
    return (
      <AbaCx canal="shopee" filtros={filtros} selo={<SeloAtualizado em={null} carregando />} faixa={<FaixaCarregando />}>
        <StateBlock tipo="carregando" titulo={repetindo ? TITULO_SEGUNDA_TENTATIVA : "Carregando a aba CX"} />
        {avaliacoes}
      </AbaCx>
    );
  }
  if (!resultado.ok) {
    return (
      <AbaCx canal="shopee" filtros={filtros}>
        <StateBlock tipo="erro" titulo="Não foi possível carregar a aba CX" descricao={resultado.motivo} acao={<TentarNovamente onClick={() => carregar()} />} />
        {avaliacoes}
      </AbaCx>
    );
  }
  return <Corpo dados={resultado.dados} filtros={filtros} avaliacoes={avaliacoes} />;
}

// ---------------------------------------------------------------------------
// Corpo: um dialogo unico para todos os detalhes
// ---------------------------------------------------------------------------
type Dialogo = { marca: string } | { indicador: IndicadorCx } | { devolucao: true };

function Corpo({ dados, filtros, avaliacoes }: { dados: CxShopeeResponse; filtros: FiltrosCx; avaliacoes: ReactNode }) {
  const v = montarAtendimentoCx(dados, brandLabel);
  const r = resumoCxGerencial(dados, brandLabel);
  const status = montarStatusMarcas(dados, brandLabel);
  const pareto = montarPareto(dados, brandLabel);
  const heroi = heroiCx(v);
  const aviso = avisoColetaChat(dados);
  const atencao = itensAtencaoCx(dados, r, brandLabel);
  const janela = textoJanela(dados.janela);
  const chips = chipsCx(dados);
  const { dias } = filtros;
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  // trocar de filtro fecha o detalhe (ele seria de outro recorte)
  useEffect(() => setDialogo(null), [filtros.marca, filtros.dias]);

  const marcaAberta = dialogo && "marca" in dialogo ? status.find((s) => s.chave === dialogo.marca) ?? null : null;
  const titulo = !dialogo
    ? ""
    : "devolucao" in dialogo
      ? "Devolução por marca · Shopee"
      : "indicador" in dialogo
        ? `${ROTULO_INDICADOR[dialogo.indicador]} por marca · Shopee`
        : `${marcaAberta?.marca ?? brandLabel(dialogo.marca)} · Saúde da Conta`;

  // Comparacao de cada cartao: as mesmas regras do card CX da Gerencial (`rodapeComparacao`), no formato do cartao novo.
  const rodape = { resposta: rodapeComparacao(r, "resposta"), cancelamento: rodapeComparacao(r, "cancelamento"), reembolso: rodapeComparacao(r, "reembolso") };
  const cancelamentoEstavel = r.cancelamentoDelta?.sentido === "estavel";
  const pilulas = {
    resposta: rodape.resposta.delta ? pilulaCartao(r.comparacao.resposta) : null,
    cancelamento: rodape.cancelamento.delta
      ? pilulaCartao({ delta: cancelamentoEstavel ? 0 : r.cancelamentoDeltaPp, unidade: "pp", tone: "lower_is_better" })
      : null,
    reembolso: rodape.reembolso.delta ? pilulaCartao(r.comparacao.reembolso) : null,
  };
  const selo = pilulaSelo(heroi.selo);
  // Devolucao por marca, da maior taxa para a menor: ocupa o lugar da linha (a API nao traz serie de devolucoes)
  const pesoDevolucao = pesosDaColuna(pareto.linhas.map((l) => l.devolucoesPct));
  const devolucaoPorMarca = pareto.linhas
    .map((l, k) => ({ l, peso: pesoDevolucao[k] }))
    .filter((x): x is { l: (typeof pareto.linhas)[number]; peso: number } => x.peso != null)
    .sort((a, b) => b.peso - a.peso)
    .slice(0, 3)
    .map((x) => `${x.l.marca} ${x.l.devolucoesPct}`)
    .join(" · ");
  const erroAtendimento = v.estado === "erro" ? (v.motivo ?? "Atendimento indisponível nesta carga.") : null;
  const ajuda = (i: IndicadorCx, extra?: string | null) => <InfoDica emControle texto={[...notasDoTile(r, i, dias), extra].filter(Boolean).join(" ")} />;
  const semDevolucao = pareto.total.devolucoesPct === "—";
  const parcial = pareto.total.marcasDevolucao.lidas < pareto.total.marcasDevolucao.total;

  return (
    <AbaCx
      canal="shopee"
      filtros={filtros}
      intervalo={intervaloDaJanela(dados.janela)}
      selo={
        <span className="flex flex-wrap items-center gap-1.5" data-testid="cx-escopo">
          {/* dado velho e aviso de coleta ficam ESCRITOS ao lado do selo, nunca so' no title */}
          {chips.saudeDesatualizada && (
            <Chip tom="atencao" title={chips.detalhe}>
              {chips.saudeDesatualizada}
            </Chip>
          )}
          {aviso && <Chip>{aviso}</Chip>}
          <SeloAtualizado em={dados.gerado_em} detalhe={`${chips.janela} · ${chips.detalhe}`} />
        </span>
      }
      faixa={
        <section aria-label="Indicadores do período">
          <div className={GRADE_FAIXA} data-testid="cx-faixa">
            {/* 1. Resposta do chat: a variacao e' a pilula (sem ela, o selo da meta oficial); a fila do chat ocupa o rodape */}
            <CartaoIndicador
              rotulo={ROTULO_INDICADOR.resposta}
              icone={MessageCircle}
              cor={COR_CX.resposta}
              valor={valorCartao(r.resposta)}
              pilula={pilulas.resposta ?? selo}
              legenda={erroAtendimento ?? (pilulas.resposta ? legendaSelo(heroi.selo) : rodape.resposta.serie ? heroi.contexto : null)}
              serie={rodape.resposta.serie}
              rodape={heroi.contexto}
              ajuda={ajuda("resposta", r.semAnterior.resposta?.texto)}
              onAbrir={() => setDialogo({ indicador: "resposta" })}
            />
            <CartaoIndicador
              rotulo={ROTULO_INDICADOR.cancelamento}
              icone={Ban}
              cor={COR_CX.cancelamento}
              valor={valorCartao(r.cancelamento)}
              pilula={pilulas.cancelamento}
              legenda={rodape.cancelamento.antes}
              serie={rodape.cancelamento.serie}
              ajuda={ajuda("cancelamento")}
              onAbrir={() => setDialogo({ indicador: "cancelamento" })}
            />
            {/* devolucoes (sem as que o comprador cancelou) ÷ pedidos: a mesma conta da coluna Devol. da tabela por marca; a API nao traz serie nem periodo anterior */}
            <CartaoIndicador
              rotulo="Devolução"
              icone={PackageX}
              cor={COR_CX.devolucao}
              valor={valorCartao(pareto.total.devolucoesPct)}
              legenda={
                pareto.total.devolucoes === "—"
                  ? "Sem leitura de devoluções"
                  : `${pareto.total.devolucoes} devoluções${parcial ? ` · ${pareto.total.marcasDevolucao.lidas} de ${pareto.total.marcasDevolucao.total} marcas` : ""}`
              }
              rodape={devolucaoPorMarca || undefined}
              ajuda={<InfoDica emControle={!semDevolucao} texto={AJUDA_DEVOLUCAO} />}
              onAbrir={semDevolucao ? undefined : () => setDialogo({ devolucao: true })}
            />
            {/* % antes do absoluto: a taxa no numero, o R$ realizado embaixo */}
            <CartaoIndicador
              rotulo={ROTULO_INDICADOR.reembolso}
              icone={Undo2}
              cor={COR_CX.reembolso}
              valor={valorCartao(r.reembolsoPct)}
              pilula={pilulas.reembolso}
              legenda={r.reembolsado !== "—" ? `${r.reembolsado} reembolsado` : rodape.reembolso.delta ? null : rodape.reembolso.antes}
              serie={rodape.reembolso.serie}
              ajuda={ajuda("reembolso", typeof rodape.reembolso.antes === "string" ? rodape.reembolso.antes : null)}
              onAbrir={() => setDialogo({ indicador: "reembolso" })}
            />
          </div>
        </section>
      }
    >
      {/* Dois paineis lado a lado: por que (Pareto) | o que exige atencao */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Pareto v={pareto} filtros={filtros} />
        <PainelAtencao
          ajuda={AJUDA_RISCO}
          saude={status.length ? <SaudePorMarca itens={status} abrir={(m) => setDialogo({ marca: m })} /> : null}
          itens={atencao.map((x) => ({
            chave: x.chave,
            severidade: x.severidade,
            titulo: x.titulo,
            detalhe: x.detalhe ?? undefined,
            onAbrir: () => setDialogo(x.abre),
          }))}
          vazio="Nenhuma loja fora da meta nem conversa esperando há mais de 24 h."
        />
      </div>

      <ProblemasPorMarca v={pareto} />

      <AtendimentoPorLoja v={v} metaResposta={r.respostaMeta} metaNota={montarAvaliacaoLoja(dados, brandLabel)?.meta ?? null} contactRate={r.contactRate} />

      {avaliacoes}

      <MaisDetalhes>
        {v.fila.length > 0 ? (
          <FilaChat linhas={v.fila} />
        ) : (
          <p className="text-xs text-ink-faint">Fila do chat: sem a leitura das faixas de espera nesta carga.</p>
        )}
        <Notas notas={[...new Set([...v.notas, ...pareto.notas])]} />
      </MaisDetalhes>

      <KpiDrilldownDialog open={dialogo != null} onClose={() => setDialogo(null)} title={titulo}>
        {dialogo && "devolucao" in dialogo && (
          <DetalheDevolucao v={pareto} periodo={janela} geradoEm={dados.gerado_em} />
        )}
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
    </AbaCx>
  );
}

// ---------------------------------------------------------------------------
// Painel "O que exige atenção": a fila + Saude da Conta por marca; "Ver todos" abre a lista inteira
// ---------------------------------------------------------------------------
const ATENCAO_NO_PAINEL = 6;

export function PainelAtencao({ ajuda, saude, itens, vazio, erro }: { ajuda: string; saude?: ReactNode; itens: ItemAtencao[]; vazio: string; erro?: string }) {
  const [todos, setTodos] = useState(false);
  return (
    <Panel
      titulo="O que exige atenção"
      aria-label="O que exige atenção"
      ajuda={ajuda}
      className="h-full"
      acao={
        itens.length > ATENCAO_NO_PAINEL ? (
          <button
            type="button"
            aria-haspopup="dialog"
            onClick={() => setTodos(true)}
            className="inline-flex min-h-11 items-center text-[13px] font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Ver todos ({itens.length}) →
          </button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3" data-testid="cx-atencao">
        {/* os alertas primeiro; a Saude da Conta (quase sempre verde) vem depois */}
        <FilaAtencao semMoldura itens={itens.slice(0, ATENCAO_NO_PAINEL)} vazio={vazio} erro={erro} />
        {saude}
      </div>
      <KpiDrilldownDialog open={todos} onClose={() => setTodos(false)} title="O que exige atenção">
        {/* abrir um item fecha a lista: um dialogo por vez */}
        <FilaAtencao
          semMoldura
          itens={itens.map((x) => (x.onAbrir ? { ...x, onAbrir: () => { setTodos(false); x.onAbrir?.(); } } : x))}
          vazio={vazio}
        />
      </KpiDrilldownDialog>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Pecas
// ---------------------------------------------------------------------------
export function Notas({ notas }: { notas: string[] }) {
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
export const THEAD = "bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint";
export const TH = "whitespace-nowrap px-2 py-2 text-right";
export const TH_MARCA = "px-2 py-2 text-left";
export const TD = "whitespace-nowrap px-2 py-2 text-right tabular-nums text-ink-muted";
export const TR = "border-t border-line hover:bg-raised/60";
export const TR_TOTAL = "border-t-2 border-line-strong bg-raised font-semibold";

/** Cabecalho de coluna com "ⓘ" e/ou dica em title + sr-only. */
export function ThAjuda({ children, ajuda, dica }: { children: string; ajuda?: string; dica?: string | null }) {
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
export function Celula({ valor, dica, barra, children }: { valor: string; dica?: string | null; barra?: { peso: number; cor: string } | null; children?: ReactNode }) {
  return (
    <td className={TD} title={dica ?? undefined}>
      {/* ALVO-GRADE: com peso, o numero ganha a barrinha na cor do indicador; ausencia continua "—", sem barra */}
      {barra && valor !== "—" ? (
        <CelulaBarra valor={<>{valor}{children}</>} peso={barra.peso} cor={barra.cor} />
      ) : (
        <>
          <span className={valor === "—" ? "text-ink-faint" : "text-ink"}>{valor}</span>
          {children}
        </>
      )}
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

export const COR_DELTA: Record<DeltaCx["sentido"], string> = {
  piorou: "font-semibold text-crit-ink",
  melhorou: "font-semibold text-ok-ink",
  estavel: "text-ink-faint",
};

/** "3 cancelamentos · Antes: 1,0%" — "—" nao entra (ausencia nunca vira texto de zero). */
export function dica(...partes: (string | null | false)[]): string | null {
  const ok = partes.filter((p): p is string => !!p);
  return ok.length ? ok.join(" · ") : null;
}

// ---------------------------------------------------------------------------
// 1. Heroi: Saude da Conta por marca (o "meio")
// ---------------------------------------------------------------------------
export function SaudePorMarca({ itens, abrir, ajuda = AJUDA_CX.status }: { itens: StatusMarca[]; abrir: (marca: string) => void; ajuda?: string }) {
  return (
    <div data-testid="cx-status-marcas">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Saúde da Conta por marca
        <span className="inline-flex normal-case tracking-normal">
          <InfoDica texto={ajuda} titulo="Saúde da Conta" />
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
export function DetalheMarca({ s, fila }: { s: StatusMarca | null; fila: LinhaFilaCx | null }) {
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

const AJUDA_DEVOLUCAO =
  "Pedidos que o comprador pediu para devolver no período ÷ pedidos do período, somando as marcas. Os que o próprio comprador cancelou ficam de fora. Cálculo da Torre.";

/** Detalhe do card Devolução: o valor exato e a taxa de cada loja (so' o que o payload ja' traz). */
function DetalheDevolucao({ v, periodo, geradoEm }: { v: VisaoPareto; periodo: string; geradoEm: string }) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
          <NumeroAnimado texto={v.total.devolucoesPct} className="text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums" />
          <span className="pb-0.5 text-xs text-ink-faint tabular-nums">{v.total.devolucoes === "—" ? "" : `${v.total.devolucoes} de ${v.total.pedidosDevolucao} pedidos`}</span>
        </div>
        <DrilldownContextLine leading="Shopee" periodLabel={periodo} refreshedAt={geradoEm} dica={<InfoDica texto={AJUDA_DEVOLUCAO} />} />
      </div>
      <DrilldownSecao titulo="Por marca">
        <ul className="flex flex-col list-none p-0 m-0">
          {v.linhas.map((l) => (
            <EvidenceRow key={l.chave} label={l.marca} value={l.devolucoesPct} reference={l.devolucoes === "—" ? undefined : `${l.devolucoes} de ${l.pedidos} pedidos`} />
          ))}
        </ul>
      </DrilldownSecao>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3a. Pareto dos problemas: painel com o seletor de tipo (Shopee e Mercado Livre)
// ---------------------------------------------------------------------------
/** Classes LITERAIS: o Tailwind so' gera o que encontra escrito. */
const COR_TIPO: Record<string, string> = {
  "Devolução": "bg-canal-shopee",
  Cancelamento: "bg-accent",
};

interface ItemBarra {
  chave: string;
  rotulo: string;
  tipo: string;
  natureza: string;
  quantidade: string;
  pct: string;
  acumulado?: string;
  largura: number;
  mapeado: boolean;
}

/**
 * O seletor so' FILTRA a lista na tela: percentuais e larguras continuam sobre
 * o total de problemas. `aoAbrir` torna cada motivo um botao (lista de pedidos).
 */
export function PainelPareto<I extends ItemBarra>({
  v,
  cores,
  semNome,
  aberta,
  aoAbrir,
  children,
}: {
  v: { estado: string; motivo: string | null; itens: I[]; resto: string | null };
  cores: Record<string, string>;
  semNome: string;
  aberta?: string | null;
  aoAbrir?: (item: I) => void;
  children?: ReactNode;
}) {
  const [tipo, setTipo] = useState("todos");
  const tipos = [...new Set(v.itens.map((i) => i.tipo))];
  // o tipo escolhido pode sumir ao trocar de filtro: volta a "Todos"
  const ativo = tipos.includes(tipo) ? tipo : "todos";
  const itens = ativo === "todos" ? v.itens : v.itens.filter((i) => i.tipo === ativo);
  return (
    <Panel
      titulo="Pareto dos problemas"
      aria-label="Pareto dos problemas"
      className="h-full"
      acao={
        v.estado === "dado" && tipos.length > 1 ? (
          <Segmented rotulo="Tipo de problema" opcoes={[{ valor: "todos", texto: "Todos" }, ...tipos.map((t) => ({ valor: t, texto: t }))]} valor={ativo} aoEscolher={setTipo} />
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4" data-testid="cx-pareto">
        {v.estado !== "dado" ? (
          <StateBlock
            tipo={v.estado === "erro" ? "erro" : v.estado === "vazio_legitimo" ? "vazio" : "indisponivel"}
            compacto
            titulo={v.motivo ?? "Sem dados"}
          />
        ) : (
          <ol className="flex min-w-0 flex-col gap-1.5" aria-label="Motivos, do maior para o menor">
            {itens.map((i) => {
              const linha = (
                <>
                  <div className="flex w-full items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 break-words text-ink">
                      {i.rotulo}
                      {!i.mapeado && <span className="ml-1.5 text-xs text-warn-ink">({semNome})</span>}
                      {/* tipo e responsavel (Comprador / Vendedor / Logistica) escritos: e' a parte acionavel; filtrado por tipo, so' o responsavel */}
                      <span className="ml-1.5 text-xs text-ink-faint">{ativo === "todos" ? `${i.tipo} · ${i.natureza}` : i.natureza}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-muted">
                      <span className="font-semibold text-ink">{i.pct}</span> <span className="text-xs">· {i.quantidade}</span>
                      {i.acumulado && <span className="sr-only"> · acumulado {i.acumulado}</span>}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
                    <div className={`tc-barra h-full rounded-full ${cores[i.tipo] ?? "bg-accent"}`} style={{ width: `${i.largura}%` }} />
                  </div>
                </>
              );
              const dica = [i.acumulado && `Acumulado ${i.acumulado}`, aoAbrir && "ver os pedidos deste motivo"].filter(Boolean).join(" · ") || undefined;
              return (
                <li key={i.chave} title={dica}>
                  {aoAbrir ? (
                    <button
                      type="button"
                      onClick={() => aoAbrir(i)}
                      aria-expanded={aberta === i.chave}
                      aria-controls="cx-pedidos-motivo"
                      className={`flex min-h-11 w-full flex-col justify-center gap-1 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                        aberta === i.chave ? "bg-raised ring-1 ring-line-strong" : ""
                      }`}
                    >
                      {linha}
                    </button>
                  ) : (
                    <div className="flex min-h-11 flex-col justify-center gap-1 px-1.5 py-1">{linha}</div>
                  )}
                </li>
              );
            })}
            {v.resto && ativo === "todos" && <li className="text-xs text-ink-faint">{v.resto}</li>}
          </ol>
        )}
        {children}
      </div>
    </Panel>
  );
}

function Pareto({ v, filtros }: { v: VisaoPareto; filtros: FiltrosCx }) {
  const [aberto, setAberto] = useState<ItemPareto | null>(null);
  // trocar de filtro fecha a lista (ela seria de outro recorte)
  useEffect(() => {
    setAberto(null);
  }, [filtros.marca, filtros.dias]);
  return (
    <PainelPareto v={v} cores={COR_TIPO} semNome="sem tradução" aberta={aberto?.chave} aoAbrir={(i) => setAberto(aberto?.chave === i.chave ? null : i)}>
      {aberto && <PedidosDoMotivo item={aberto} filtros={filtros} fechar={() => setAberto(null)} />}
    </PainelPareto>
  );
}

/** Peso 0..1 de uma taxa ja' formatada ("6,2%") na escala da coluna; so' desenha a barrinha, nao muda numero. */
export function pesosDaColuna(valores: string[]): (number | null)[] {
  const n = valores.map((s) => parseFloat(s.replace(/\./g, "").replace(",", ".")));
  const max = Math.max(0, ...n.filter(Number.isFinite));
  return n.map((x) => (Number.isFinite(x) && max > 0 ? x / max : null));
}
const barra = (peso: number | null, cor: string) => (peso == null ? null : { peso, cor });

// ---------------------------------------------------------------------------
// 3b. Problemas por marca (largura total): um numero por celula, com barrinha; total em raised
// ---------------------------------------------------------------------------
function ProblemasPorMarca({ v }: { v: VisaoPareto }) {
  const t = v.total;
  const pesoCancel = pesosDaColuna(v.linhas.map((l) => l.cancelamentosPct));
  const pesoDevol = pesosDaColuna(v.linhas.map((l) => l.devolucoesPct));
  return (
    <Panel titulo="Problemas por marca" aria-label="Problemas por marca" semPadding>
      {v.linhas.length === 0 ? (
        <div className="p-4">
          <StateBlock tipo="indisponivel" compacto titulo="Sem pedidos por marca nesta carga" />
        </div>
      ) : (
        <TableScrollHint>
          <table className="w-full min-w-[620px] border-collapse text-sm" data-testid="cx-problemas-marca">
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
              {v.linhas.map((l, k) => (
                <tr key={l.chave} className={TR}>
                  <th scope="row" className="px-2 py-2 text-left font-medium text-ink">{l.marca}</th>
                  <td className={TD}>{l.pedidos}</td>
                  <Celula
                    valor={l.cancelamentosPct}
                    barra={barra(pesoCancel[k], COR_CX.cancelamento)}
                    dica={dica(l.cancelamentos !== "—" && `${l.cancelamentos} cancelamentos`, l.cancelamentoAntes && `Antes: ${l.cancelamentoAntes}`)}
                  >
                    {l.cancelamentoDelta && <span className={`ml-1 text-xs ${COR_DELTA[l.cancelamentoDelta.sentido]}`}>{l.cancelamentoDelta.texto}</span>}
                  </Celula>
                  <Celula valor={l.devolucoesPct} barra={barra(pesoDevol[k], COR_CX.devolucao)} dica={dica(l.devolucoes !== "—" && `${l.devolucoes} devoluções`)} />
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
function AtendimentoPorLoja({ v, metaResposta, metaNota, contactRate }: { v: VisaoAtendimentoCx; metaResposta: string | null; metaNota: string | null; contactRate: string }) {
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
                <td className={TD} colSpan={3} />
                {/* o Contact rate saiu da faixa (4 cartoes): o total do periodo fica aqui, na propria coluna */}
                <td className={`${TD} ${contactRate === "—" ? "text-ink-faint" : "font-semibold text-ink"}`}>{contactRate}</td>
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
