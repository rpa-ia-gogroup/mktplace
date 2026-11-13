"use client";

/**
 * T-0010 — o ESQUELETO comum da Expedicao, igual nos tres canais.
 *
 * Ordem fixa (o painel do TikTok e' a referencia visual):
 *
 *   1. cabecalho, frescor e filtros       (`cabecalho`)
 *   2. avisos da janela e qualidade do dado (`avisos`, `qualidade`)
 *   3. estado da carga                     (`estado`: carregando/erro/vazio/indisponivel)
 *   4. corpo, por profundidade:
 *        visao do gestor -> `CorpoGestor`: risco atual -> prazo e taxas ->
 *        jornada -> evolucao -> concentracao -> convite ao detalhe;
 *        detalhe operacional -> o que o canal tem de detalhe.
 *
 * O esqueleto NAO conhece canal nem metrica: cada painel entrega as secoes
 * que a SUA fonte sustenta. Secao sem fonte no canal vira
 * `SecaoIndisponivel` — uma linha com o "ⓘ" —, nunca um
 * buraco nem um numero inventado.
 */
import type { ReactNode } from "react";

import Note from "@/components/ui/Note";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import type { ChaveMetrica } from "@/lib/expedicao-definicoes";

import AjudaMetrica from "./AjudaMetrica";
import { SecaoGerencial } from "./SecoesExpedicao";

/**
 * Tabelas densas da Expedicao — UMA definicao (antes duplicada na fila e no
 * TikTok, com espacamentos diferentes). Referencia: o painel do TikTok.
 */
export const CLASSE_TABELA =
  "w-full text-[13px] [&_td]:py-1.5 [&_td]:px-3 [&_th]:py-1.5 [&_th]:px-3";
export const CLASSE_CABECALHO =
  "sticky top-0 z-10 bg-raised text-left text-xs uppercase tracking-wide text-ink-faint";

/**
 * Classe da RAIZ de cada painel. A raiz continua sendo um `div` do proprio
 * painel (com `aria-busy`), e nao deste componente: o `main` e' do
 * AppShell e o teste de landmarks ancora na raiz do componente do canal.
 */
export const CLASSE_RAIZ_EXPEDICAO = "w-full tc-entrada";

/**
 * QA T-0010 (M4): os MESMOS textos de estado nos tres canais.
 */
export const TEXTO_ESTADO = {
  carregando: "Carregando os dados do canal…",
  erro: "Não foi possível carregar os dados deste canal agora.",
  vazio: "Nenhum pedido aguardando expedição nesta publicação.",
} as const;

/** ALVO-GRADE: o que cada painel entrega a' moldura `Aba` (titulo e abas de canal sao da casca). */
export interface PartesDaAba {
  selo?: ReactNode;
  filtros?: ReactNode;
  direita?: ReactNode;
  children?: ReactNode;
}
export type Moldura = (partes: PartesDaAba) => ReactNode;

export default function LayoutExpedicao({
  moldura,
  cabecalho,
  destaque,
  avisos,
  qualidade,
  estado,
  children,
}: {
  /** A casca desenha o `<Aba>`; o painel so' preenche. */
  moldura: Moldura;
  /** `cabecalhoExpedicao(...)`: selo, filtros e profundidade. */
  cabecalho: Omit<PartesDaAba, "children">;
  /** CX-MKT-3: faixa de LDR logo abaixo do cabecalho, igual nos tres canais. */
  destaque?: ReactNode;
  avisos?: ReactNode;
  qualidade?: ReactNode;
  estado?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      {moldura({
        ...cabecalho,
        children: (
          <>
            {destaque}
            {avisos}
            {qualidade}
            {estado}
            {children}
          </>
        ),
      })}
    </>
  );
}

/**
 * A visao do gestor, na MESMA ordem nos tres canais. A ordem e' do
 * esqueleto, nao de quem chama: trocar as props de lugar nao muda a tela.
 *
 * ALVO-GRADE (aprovado em 12/11/2026) — a grade unica das abas:
 *   faixa de 4 cartoes -> fila por situacao de prazo | "O que exige atenção"
 *   (lado a lado) -> backlog por marca (largura total) -> evolucao |
 *   concentracao (7/12 | 5/12, so' o TikTok) -> LDR 7 dias -> "Mais detalhes".
 * O heroi virou o 1o cartao; o convite ao detalhe saiu (o seletor da barra ja' leva la').
 */
export function CorpoGestor({
  faixa,
  prazo,
  atencao,
  backlog,
  evolucao,
  concentracao,
  ldr,
  maisDetalhes,
}: {
  faixa: ReactNode;
  /** Painel da fila por situacao de prazo (o antigo meio do heroi). */
  prazo?: ReactNode;
  atencao: ReactNode;
  backlog: ReactNode;
  /** TikTok: evolucao por dia de vencimento (7/12). */
  evolucao?: ReactNode;
  /** TikTok: concentracao por marca (5/12). */
  concentracao?: ReactNode;
  /** CX-MKT-3: LDR de 7 dias por marca (LdrTopo), o unico da visao do gestor. */
  ldr?: ReactNode;
  /** `MaisDetalhes` com o que nao responde a pergunta da dobra. */
  maisDetalhes?: ReactNode;
}) {
  return (
    <>
      {faixa}
      <div className={`grid grid-cols-1 gap-3 ${prazo ? "lg:grid-cols-2" : ""}`}>
        {prazo}
        {atencao}
      </div>
      {backlog}
      {evolucao || concentracao ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          {evolucao ? <div className="min-w-0 lg:col-span-7">{evolucao}</div> : null}
          {concentracao ? <div className="min-w-0 lg:col-span-5">{concentracao}</div> : null}
        </div>
      ) : null}
      {ldr}
      {maisDetalhes}
    </>
  );
}

/** Secao que a fonte do canal nao sustenta: dito em uma linha, com o "ⓘ". */
export function SecaoIndisponivel({
  titulo,
  motivo,
  ajuda,
}: {
  titulo: string;
  motivo: string;
  ajuda?: ChaveMetrica;
}) {
  return (
    <SecaoGerencial titulo={titulo}>
      <p
        role="status"
        className="flex flex-wrap items-center gap-x-1 rounded-xl border border-dashed border-line-strong bg-surface px-4 py-3 text-sm text-ink-muted"
      >
        <span>Indisponível neste canal: {motivo}</span>
        {ajuda ? <AjudaMetrica chave={ajuda} /> : null}
      </p>
    </SecaoGerencial>
  );
}

export type TipoEstadoSecao = "carregando" | "erro" | "vazio" | "indisponivel" | "parcial" | "desatualizado";

/**
 * Estado de UMA secao, igual em todas as secoes dos tres canais.
 * Carregando, erro (com nova tentativa), vazio e indisponivel usam o
 * `StateBlock` compacto; parcial e desatualizado sao ressalvas sobre um
 * numero que continua na tela, entao viram `Note`.
 */
export function EstadoSecao({
  tipo,
  titulo,
  descricao,
  aoTentarDeNovo,
}: {
  tipo: TipoEstadoSecao;
  titulo: string;
  descricao?: ReactNode;
  aoTentarDeNovo?: () => void;
}) {
  if (tipo === "parcial" || tipo === "desatualizado") {
    return (
      <Note tom="atencao" papel="status">
        <span className="font-semibold">{tipo === "parcial" ? "Parcial" : "Desatualizada"}:</span> {titulo}
        {descricao ? <> {descricao}</> : null}
      </Note>
    );
  }
  return (
    <StateBlock
      tipo={tipo}
      titulo={titulo}
      descricao={descricao}
      compacto
      acao={aoTentarDeNovo ? <RetryButton onClick={aoTentarDeNovo} /> : undefined}
    />
  );
}
