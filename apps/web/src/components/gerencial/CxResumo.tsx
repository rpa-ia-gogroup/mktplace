"use client";

/**
 * CX · Shopee na Gerencial (GERENCIAL-CX, 07/11/2026; v3 enxuta no mesmo dia).
 *
 * Mesma rota da /cx (`/api/v1/cx/shopee`), buscada pelo navegador. Sempre 30
 * dias fechados, escrito no cabecalho, sem casar com o periodo da Gerencial.
 * Marca segue o filtro global; a pagina so' monta isto com a Shopee no filtro.
 *
 * Card = rotulo, valor e no maximo UMA linha. Definicao, unidade, falta de
 * historico e base da seta vao para o ⓘ. Comparacao so' onde ha historico de
 * verdade (cancelamento); sem historico, nao ha delta — nunca inventado.
 *
 * Embaixo, uma linha: "Atencao" com ate' 2 marcas fora da curva (regra da
 * mediana no ⓘ). Hover/foco num tile (o padrao da rosca do MetaHero) troca a
 * linha pelo valor de cada marca naquele indicador.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

import InfoDica from "@/components/ui/InfoDica";
import KpiTile from "@/components/ui/KpiTile";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import {
  AJUDA_CX,
  AJUDA_RISCO,
  MIN_MARCAS_RISCO,
  MOTIVO_REENVIO,
  ROTULO_CURTO,
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
const SEM_HISTORICO_CHAT = "Sem comparação ainda: a coleta do chat começou em 04/11.";
const SEM_HISTORICO_DEVOLUCAO = "Sem comparação ainda: as devoluções são coletadas desde 05/10.";

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
const PONTO_TOM = { atencao: "bg-warn", critico: "bg-crit" } as const;
const TINTA_TOM = { atencao: "text-warn-ink", critico: "text-crit-ink" } as const;

export default function CxResumo({ brands }: { brands: string[] }) {
  const marca = brands.length ? brands.join(",") : null;
  const [resultado, setResultado] = useState<ResultadoCx | null>(null);
  // Tile sob o mouse (ou com foco): a linha de baixo mostra esse indicador por marca.
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
      titulo="CX · Shopee"
      icone={MessageCircle}
      descricao="Últimos 30 dias até ontem"
      aria-label="CX Shopee"
      acao={
        <Link
          href={href}
          className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Ver CX completo →
        </Link>
      }
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
          <LinhaDeBaixo r={r} ativo={ativo} />
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Tiles: rotulo, valor e no maximo uma linha
// ---------------------------------------------------------------------------
/** 2 colunas no celular, 3 + 2 de 640 a 1024 px (grade de 6), 5 em linha acima. */
const SPAN_TOPO = "sm:col-span-2 lg:col-span-1";
const SPAN_BASE = "sm:col-span-3 lg:col-span-1";
/** Conteudo no topo do card: o valor fica na mesma altura com ou sem linha embaixo. */
const CARD = "min-w-0 rounded-xl [&>div]:h-full [&>div]:justify-start";

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
    className: `${CARD} transition-shadow duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${span} ${
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
  // A seta so' compara as marcas com historico: a base vai para o ⓘ e o hover da linha.
  const baseDaSeta = r.cancelamentoBase
    ? `A seta compara sem ${r.semHistoricoCancelamento.join(", ")} (sem histórico): ${r.cancelamentoBase.anterior} → ${r.cancelamentoBase.atual}.`
    : undefined;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-6 lg:grid-cols-5" data-testid="cx-resumo">
      <div {...hover("contactRate", SPAN_TOPO)}>
        <KpiTile
          rotulo="Contact rate"
          valor={r.contactRate}
          ajuda={
            <InfoDica
              titulo="Contact rate"
              texto={`${AJUDA_CX.contactRate} ${SEM_HISTORICO_CHAT}`}
              nota={r.semChat.length ? `Sem dado de chat, fora da conta: ${r.semChat.join(", ")}.` : undefined}
            />
          }
        />
      </div>
      <div {...hover("aguardando", SPAN_TOPO)}>
        <KpiTile
          rotulo="Aguardando"
          valor={r.aguardando}
          ajuda={
            <InfoDica
              titulo="Aguardando resposta"
              texto={`${AJUDA_CX.aguardando} Taxa sobre as conversas do período. ${SEM_HISTORICO_CHAT}`}
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
            delta ? (
              <span className={COR_DELTA[delta.sentido]} title={baseDaSeta}>
                <span aria-hidden="true">{delta.texto}</span>
                <span className="sr-only">
                  {FALADO_DELTA[delta.sentido]} {delta.texto.replace(/^[▲▼=]\s*/, "")}
                </span>
                <span className="font-normal text-ink-faint"> vs 30 dias antes</span>
              </span>
            ) : undefined
          }
          ajuda={
            <InfoDica
              titulo="Cancelamento"
              texto={`${AJUDA_CX.cancelamentos} Taxa sobre os pedidos. A seta compara com os 30 dias anteriores, em pontos percentuais; subir é pior.`}
              nota={baseDaSeta}
            />
          }
        />
      </div>
      <div {...hover("reembolso", SPAN_BASE)}>
        <KpiTile
          rotulo="Reembolso"
          valor={r.reembolsado}
          comparacao={r.reembolsoPct ? `${r.reembolsoPct} dos pedidos` : undefined}
          ajuda={
            <InfoDica
              titulo="Reembolso"
              texto={`Valor reembolsado nas devoluções aceitas do período. A taxa é devoluções aceitas ÷ pedidos. ${SEM_HISTORICO_DEVOLUCAO}`}
            />
          }
        />
      </div>
      <div className={`col-span-2 ${CARD} ${SPAN_BASE}`}>
        <KpiTile
          rotulo="Reenvio"
          tom="ausente"
          valor="Sem fonte"
          ajuda={
            <InfoDica
              titulo="Reenvio"
              texto={`${MOTIVO_REENVIO[0].toUpperCase()}${MOTIVO_REENVIO.slice(1)}. Entra quando houver fonte; nunca aparece como zero.`}
            />
          }
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uma linha: "Atencao" (padrao) ou o indicador do tile ativo, por marca
// ---------------------------------------------------------------------------
function valorDaMarca(m: MarcaCx, i: IndicadorCx): string {
  const v = pctCx(m.valores[i]);
  if (i === "cancelamento" && m.cancelamentoAnterior != null) return `${v} (antes ${pctCx(m.cancelamentoAnterior)})`;
  if (i === "reembolso" && m.reembolsado != null) return `${reais(m.reembolsado)} · ${v}`;
  return v;
}

const LINHA = "flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line pt-3 text-xs text-ink-muted";

function LinhaDeBaixo({ r, ativo }: { r: ResumoCx; ativo: IndicadorCx | null }) {
  // Com menos de 3 marcas nao ha mediana justa: nem alerta, nem "nenhuma fora da curva".
  if (r.marcas.length < MIN_MARCAS_RISCO) return null;

  if (ativo) {
    const med = r.medianas[ativo];
    return (
      <p className={LINHA} aria-live="polite" data-testid="cx-marcas">
        <span className="font-semibold text-ink">
          {ROTULO_INDICADOR[ativo]}
          {med != null && <span className="font-normal text-ink-faint"> (mediana {pctCx(med)})</span>}:
        </span>
        {r.marcas.map((m, idx) => (
          <span key={m.chave} className={m.acima.includes(ativo) ? "text-crit-ink" : undefined}>
            {idx > 0 && <span aria-hidden="true" className="mr-1.5 text-ink-faint">·</span>}
            <span className="font-semibold">{m.marca}</span> <span className="tabular-nums">{valorDaMarca(m, ativo)}</span>
          </span>
        ))}
      </p>
    );
  }

  return (
    <p className={LINHA} aria-live="polite" data-testid="cx-marcas">
      {r.alertas.length ? (
        <>
          <span className="font-semibold text-ink">Atenção:</span>
          {r.alertas.map((a, idx) => (
            <span key={a.chave} className="inline-flex items-center gap-1.5">
              {idx > 0 && <span aria-hidden="true" className="text-ink-faint">·</span>}
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${PONTO_TOM[a.tom]}`} />
              <span className={`font-semibold ${TINTA_TOM[a.tom]}`}>{a.marca}</span>
              <span className="tabular-nums">
                {ROTULO_CURTO[a.indicador]} {a.valor}{" "}
                <span className="text-ink-faint">(mediana {a.mediana})</span>
              </span>
            </span>
          ))}
        </>
      ) : (
        <span>Nenhuma marca fora da curva</span>
      )}
      <InfoDica titulo="Atenção" texto={AJUDA_RISCO} />
    </p>
  );
}
