"use client";

/**
 * Gate EXPEDICAO-UX-UNIFICADA-1 — as secoes que os tres canais compartilham.
 *
 * So' a ESTRUTURA e' comum: titulo, densidade, ordem e o vocabulario de
 * severidade. O conteudo de cada uma vem do contrato do canal — os itens de
 * atencao da fila sao contagens da API; os do TikTok sao os alertas que a API
 * ja' escreveu. Nenhuma destas pecas conhece canal.
 */
import { useId, type ReactNode } from "react";

import InfoDica from "@/components/ui/InfoDica";

import { ID_FAIXA_DE_CONTROLES } from "./CabecalhoExpedicao";

/**
 * Faixa de KPIs: quatro em destaque, seis (o "Risco atual" da Shopee) ou a
 * faixa secundaria densa.
 */
export function FaixaKpis({
  rotulo,
  secundaria = false,
  colunas = 4,
  children,
}: {
  rotulo: string;
  secundaria?: boolean;
  colunas?: 2 | 3 | 4 | 6;
  children: ReactNode;
}) {
  // IDENTIDADE-GERENCIAL: 1 coluna no celular (rotulo sem quebrar em 3
  // linhas), como no Full e na CX; a grade de antes a partir de `sm`.
  const grade = secundaria
    ? "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
    : colunas === 6
      ? "grid grid-cols-1 gap-2 sm:grid-cols-3 xl:grid-cols-6"
      : colunas === 3
        ? "grid grid-cols-1 gap-2 sm:grid-cols-3"
        : colunas === 2
          ? "grid grid-cols-1 gap-2 sm:grid-cols-2"
          : "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4";
  return (
    <section aria-label={rotulo} className={grade}>
      {children}
    </section>
  );
}

/**
 * Fim da visao do gestor: o que existe no detalhe e o caminho ate' ele.
 *
 * Ao abrir, o foco vai para o seletor de profundidade, que agora diz
 * "Detalhe operacional": quem usa teclado ou leitor de tela fica no controle
 * que acabou de mudar, e a pagina rola ate' o topo do conteudo novo.
 */
export function ConviteAoDetalhe({
  conteudo,
  aoAbrir,
}: {
  /** O que o detalhe tem NESTE canal. */
  conteudo: string;
  aoAbrir: () => void;
}) {
  const abrir = () => {
    aoAbrir();
    requestAnimationFrame(() => {
      const faixa = document.getElementById(ID_FAIXA_DE_CONTROLES);
      faixa?.scrollIntoView({ block: "start" });
      faixa
        ?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')
        ?.focus({ preventScroll: true });
    });
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 rounded-xl border border-dashed border-line-strong px-4 py-3">
      <button
        type="button"
        onClick={abrir}
        title={conteudo}
        className="inline-flex min-h-11 items-center rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink hover:border-line-strong"
      >
        Abrir detalhe operacional
      </button>
    </div>
  );
}

/**
 * EXPEDICAO-UX-3 — a unidade da hierarquia comum: "Risco atual", "Prazo",
 * "Evolução", "Concentração". O MESMO titulo e a mesma ordem nos tres canais;
 * o conteudo e' do contrato de cada um.
 */
export function SecaoGerencial({
  titulo,
  descricao,
  dica,
  selo,
  acao,
  children,
}: {
  titulo: string;
  /** Uma linha: o que esta secao mede neste canal. */
  descricao?: ReactNode;
  /** UI-EXPEDICAO-1: a explicacao vira um "ⓘ" ao lado do titulo. */
  dica?: string;
  /** Selo curto ao lado do titulo ("agora", "inclui FBS"). */
  selo?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          {/* O "ⓘ" e o selo ficam FORA do h3: o nome da secao continua so' o titulo. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 id={id} className="text-sm font-semibold text-ink">
              {titulo}
            </h3>
            {dica ? <InfoDica texto={dica} /> : null}
            {selo}
          </div>
          {descricao ? <p className="text-xs leading-snug text-ink-muted">{descricao}</p> : null}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}
