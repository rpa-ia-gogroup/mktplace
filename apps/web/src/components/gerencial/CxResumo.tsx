"use client";

/**
 * CX · Shopee na Gerencial (GERENCIAL-CX, 07/11/2026; v2 no mesmo dia).
 *
 * Mesma rota da /cx (`/api/v1/cx/shopee`), buscada pelo navegador. Sempre 30
 * dias fechados, escrito no cabecalho, sem casar com o periodo da Gerencial.
 * Marca segue o filtro global; a pagina so' monta isto com a Shopee no filtro.
 *
 * Comparacao so' onde ha historico de verdade: cancelamento (pedidos da Silver,
 * desde 01/2026). Devolucoes comecam em 05/10 e o chat e' fotografia desde
 * 04/11: esses tiles dizem "sem historico ainda", nunca um delta inventado.
 *
 * Hover/foco num tile (o padrao da rosca do MetaHero) troca a linha de marcas
 * embaixo para o valor de cada marca naquele indicador. Sem hover, a mesma
 * linha mostra o risco por marca.
 */
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { MessageCircle } from "lucide-react";

import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import KpiTile from "@/components/ui/KpiTile";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import {
  AJUDA_CX,
  AJUDA_RISCO,
  MOTIVO_REENVIO,
  ROTULO_INDICADOR,
  carregarCxShopee,
  hrefCx,
  pctCx,
  reais,
  resumoCxGerencial,
  type DeltaCx,
  type IndicadorCx,
  type MarcaCx,
  type ResultadoCx,
  type ResumoCx,
} from "@/lib/cx";
import { brandLabel } from "@/lib/filters/brands";
import { torreFetch } from "@/lib/torre-fetch";

const DIAS = 30;
const SEM_HISTORICO_CHAT = "sem histórico ainda (coleta desde 04/11)";
const SEM_HISTORICO_DEVOLUCAO = "sem histórico ainda (devoluções desde 05/10)";

/** Classes literais (o Tailwind so' gera o que encontra escrito). */
const COR_DELTA: Record<DeltaCx["sentido"], string> = {
  piorou: "font-semibold text-crit-ink",
  melhorou: "font-semibold text-ok-ink",
  estavel: "text-ink-muted",
};
const FALADO_DELTA: Record<DeltaCx["sentido"], string> = {
  piorou: "subiu (piorou)",
  melhorou: "caiu (melhorou)",
  estavel: "estável",
};

export default function CxResumo({ brands }: { brands: string[] }) {
  const marca = brands.length ? brands.join(",") : null;
  const [resultado, setResultado] = useState<ResultadoCx | null>(null);
  // Tile sob o mouse (ou com foco): a linha de marcas mostra esse indicador.
  const [ativo, setAtivo] = useState<IndicadorCx | null>(null);

  const carregar = useCallback(() => {
    let vivo = true;
    setResultado(null);
    carregarCxShopee({ marca, dias: DIAS }, torreFetch as typeof fetch).then((r) => {
      if (vivo) setResultado(r);
    });
    return () => {
      vivo = false;
    };
  }, [marca]);

  useEffect(() => carregar(), [carregar]);

  // A /cx so' le' uma marca na URL; com varias, abre em "Todas".
  const href = hrefCx({ marca: brands.length === 1 ? brands[0] : null, dias: DIAS });
  const r = resultado?.ok ? resumoCxGerencial(resultado.dados, brandLabel) : null;

  return (
    <Panel
      titulo={
        <span className="inline-flex flex-wrap items-center gap-2">
          CX
          <span className="inline-flex items-center gap-1.5 font-normal text-ink-muted">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-canal-shopee" />
            Shopee
          </span>
          <Chip>Só Shopee por enquanto</Chip>
        </span>
      }
      icone={MessageCircle}
      descricao="Shopee · últimos 30 dias até ontem"
      aria-label="CX Shopee"
      acao={
        <Link
          href={href}
          className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Ver CX completo →
        </Link>
      }
      rodape="ML e TikTok entram quando a coleta de CX desses canais existir."
    >
      {!resultado ? (
        <StateBlock tipo="carregando" compacto titulo="Carregando CX da Shopee" />
      ) : !resultado.ok || !r ? (
        <StateBlock
          tipo="erro"
          compacto
          titulo="CX indisponível nesta carga"
          descricao={resultado.ok ? undefined : resultado.motivo}
          acao={<RetryButton onClick={() => carregar()} />}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Tiles r={r} ativo={ativo} setAtivo={setAtivo} />
          <LinhaMarcas r={r} ativo={ativo} />
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------
/** Duas linhas sempre (definicao + historico): os valores ficam na mesma altura. */
function Comparacao({ definicao, historico }: { definicao: ReactNode; historico: ReactNode }) {
  return (
    <>
      <span className="block">{definicao}</span>
      <span className="block text-ink-faint">{historico}</span>
    </>
  );
}

/** 2 colunas no celular, 3 + 2 de 640 a 1024 px (grade de 6), 5 em linha acima. */
const SPAN_TOPO = "sm:col-span-2 lg:col-span-1";
const SPAN_BASE = "sm:col-span-3 lg:col-span-1";

function Tiles({
  r,
  ativo,
  setAtivo,
}: {
  r: ResumoCx;
  ativo: IndicadorCx | null;
  setAtivo: (i: IndicadorCx | null) => void;
}) {
  const comMarcas = r.marcas.length > 1;
  const hover = (i: IndicadorCx, span: string) => ({
    className: `min-w-0 rounded-xl transition-shadow duration-150 [&>div]:h-full [&>div]:justify-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${span} ${
      ativo === i ? "ring-1 ring-accent/50" : ""
    }`,
    ...(comMarcas && {
      tabIndex: 0,
      "aria-label": `${ROTULO_INDICADOR[i]}: ver por marca`,
      onMouseEnter: () => setAtivo(i),
      onMouseLeave: () => setAtivo(null),
      onFocus: () => setAtivo(i),
      onBlur: () => setAtivo(null),
    }),
  });
  const delta = r.cancelamentoDelta;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-6 lg:grid-cols-5" data-testid="cx-resumo">
      <div {...hover("contactRate", SPAN_TOPO)}>
        <KpiTile
          rotulo="Contact rate"
          valor={r.contactRate}
          comparacao={<Comparacao definicao="conversas ÷ pedidos" historico={SEM_HISTORICO_CHAT} />}
          ajuda={
            <InfoDica
              titulo="Contact rate"
              texto={AJUDA_CX.contactRate}
              nota={r.semChat.length ? `Sem dado de chat, fora da conta: ${r.semChat.join(", ")}.` : undefined}
            />
          }
        />
      </div>
      <div {...hover("aguardando", SPAN_TOPO)}>
        <KpiTile
          rotulo="Aguardando"
          valor={r.aguardando}
          comparacao={<Comparacao definicao="das conversas" historico={SEM_HISTORICO_CHAT} />}
          ajuda={
            <InfoDica
              titulo="Aguardando resposta"
              texto={AJUDA_CX.aguardando}
              nota="Inclui conversas antigas paradas, não só as do período."
            />
          }
        />
      </div>
      <div {...hover("cancelamento", SPAN_TOPO)}>
        <KpiTile
          rotulo="Cancelamento"
          valor={r.cancelamento}
          comparacao={
            <Comparacao
              definicao="dos pedidos"
              historico={
                delta ? (
                  <span className={COR_DELTA[delta.sentido]}>
                    <span aria-hidden="true">{delta.texto}</span>
                    <span className="sr-only">{FALADO_DELTA[delta.sentido]} {delta.texto.replace(/^[▲▼=]\s*/, "")}</span>
                    <span className="font-normal text-ink-faint"> vs 30 dias antes</span>
                  </span>
                ) : (
                  "sem histórico ainda"
                )
              }
            />
          }
          ajuda={
            <InfoDica
              titulo="Cancelamento"
              texto={`${AJUDA_CX.cancelamentos} A comparação é com os 30 dias anteriores, em pontos percentuais; subir é pior.`}
              nota={
                r.semHistoricoCancelamento.length
                  ? `Fora da comparação (sem histórico de pedidos na janela anterior): ${r.semHistoricoCancelamento.join(", ")}.`
                  : undefined
              }
            />
          }
        />
      </div>
      <div {...hover("reembolso", SPAN_BASE)}>
        <KpiTile
          rotulo="Reembolso"
          valor={r.reembolsado}
          comparacao={
            <Comparacao
              definicao={r.reembolsoPct ? `${r.reembolsoPct} dos pedidos` : "devoluções aceitas"}
              historico={SEM_HISTORICO_DEVOLUCAO}
            />
          }
          ajuda={
            <InfoDica
              titulo="Reembolso"
              texto="Valor reembolsado nas devoluções aceitas do período. A taxa é devoluções aceitas ÷ pedidos."
            />
          }
        />
      </div>
      <div className={`col-span-2 min-w-0 [&>div]:h-full [&>div]:justify-start ${SPAN_BASE}`}>
        <KpiTile
          rotulo="Reenvio"
          tom="ausente"
          valor="Sem fonte"
          comparacao={
            <Comparacao
              definicao={`${MOTIVO_REENVIO[0].toUpperCase()}${MOTIVO_REENVIO.slice(1)}.`}
              historico="Nunca mostrado como zero."
            />
          }
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha de marcas: risco (padrao) ou o indicador do tile ativo
// ---------------------------------------------------------------------------
function valorDaMarca(m: MarcaCx, i: IndicadorCx): string {
  const v = pctCx(m.valores[i]);
  if (i === "cancelamento" && m.cancelamentoAnterior != null) return `${v} (antes ${pctCx(m.cancelamentoAnterior)})`;
  if (i === "reembolso" && m.reembolsado != null) return `${reais(m.reembolsado)} · ${v}`;
  return v;
}

function LinhaMarcas({ r, ativo }: { r: ResumoCx; ativo: IndicadorCx | null }) {
  // Com uma marca so', a "media da Shopee" e' ela mesma: nada a comparar.
  if (r.marcas.length < 2) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3" aria-live="polite" data-testid="cx-marcas">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {ativo ? (
          <>
            {ROTULO_INDICADOR[ativo]} por marca
            <span className="font-normal normal-case tracking-normal">
              · Shopee {pctCx(r.totais[ativo])}
            </span>
          </>
        ) : (
          <>
            Risco por marca
            <InfoDica titulo="Risco por marca" texto={AJUDA_RISCO} />
          </>
        )}
      </p>
      <ul className="flex flex-wrap gap-2">
        {r.marcas.map((m) => {
          if (ativo) {
            const semMedida = m.valores[ativo] == null;
            const tom = semMedida ? "ausente" : m.acima.includes(ativo) ? "critico" : "neutro";
            return (
              <li key={m.chave}>
                <Chip tom={tom} ponto={tom === "critico"}>
                  <span className="font-semibold">{m.marca}</span>
                  <span className="tabular-nums">{valorDaMarca(m, ativo)}</span>
                </Chip>
              </li>
            );
          }
          return (
            <li key={m.chave}>
              <Chip tom={m.tom} ponto>
                <span className="font-semibold">{m.marca}</span>
                <span className="tabular-nums">
                  {m.acima.length
                    ? m.acima.map((i) => `${ROTULO_INDICADOR[i].toLowerCase()} ${pctCx(m.valores[i])}`).join(" · ")
                    : "dentro da média"}
                </span>
              </Chip>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
