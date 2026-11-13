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
          : // ALVO-GRADE: a faixa dos 4 cartoes, a mesma grade da Gerencial.
            "grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4";
  return (
    <section aria-label={rotulo} className={grade}>
      {children}
    </section>
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
