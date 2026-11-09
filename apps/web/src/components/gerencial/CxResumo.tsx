"use client";

/**
 * CX · Shopee na Gerencial (GERENCIAL-CX, 07/11/2026; v4 com drill-down).
 *
 * Mesma rota da /cx (`/api/v1/cx/shopee`), buscada pelo navegador. Sempre 30
 * dias fechados, escrito no cabecalho, sem casar com o periodo da Gerencial.
 * Marca segue o filtro global; a pagina so' monta isto com a Shopee no filtro.
 *
 * Card = rotulo, valor e no maximo UMA linha (reservada em todos, para a
 * mesma altura). Clicar abre o dialogo unico da pagina com o valor de cada
 * marca (`CxDrilldownContent`), como os outros cards da Gerencial; as
 * ressalvas do card vao junto. Comparacao so' onde ha historico de verdade
 * (cancelamento); sem historico, nao ha delta — nunca inventado.
 *
 * Embaixo, uma linha: "Atencao" com ate' 2 marcas fora da curva (regra da
 * mediana no ⓘ).
 */
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Ban, MessageCircle, MessagesSquare, Repeat2, Undo2, type LucideIcon } from "lucide-react";

import InfoDica from "@/components/ui/InfoDica";
import DeltaBadge from "@/components/ui/DeltaBadge";
import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
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
  resumoCxGerencial,
  type IndicadorCx,
  type ResultadoCx,
  type ResumoCx,
} from "@/lib/cx";
import { brandLabel } from "@/lib/filters/brands";
import { torreFetch } from "@/lib/torre-fetch";

const DIAS = 30;
const SEM_HISTORICO_CHAT = "Sem comparação ainda: a coleta do chat começou em 04/11.";
const SEM_HISTORICO_DEVOLUCAO = "Sem comparação ainda: as devoluções são coletadas desde 05/10.";

/** Classes literais (o Tailwind so' gera o que encontra escrito). */
const PONTO_TOM = { atencao: "bg-warn", critico: "bg-crit" } as const;
const TINTA_TOM = { atencao: "text-warn-ink", critico: "text-crit-ink" } as const;

/**
 * Pilula do cancelamento (p.p., subir e' pior; estavel sem cor de juizo) e o
 * "antes X%" da janela anterior (ou "sem MARCA", quando a seta exclui marcas
 * sem historico). Sem historico nenhum, nada: nunca inventado.
 */
export function deltaCancelamento(r: ResumoCx): { delta?: ReactNode; antes?: ReactNode } {
  if (r.cancelamentoDeltaPp == null || !r.cancelamentoAntes) return {};
  const estavel = r.cancelamentoDelta?.sentido === "estavel";
  return {
    delta: <DeltaBadge pct={estavel ? 0 : r.cancelamentoDeltaPp} unidade="pp" tone={estavel ? "neutral" : "lower_is_better"} />,
    // base sem as marcas sem historico: "antes X" ao lado do valor de todas as marcas enganaria; a conta fica no ⓘ
    antes: r.cancelamentoBase ? `sem ${r.semHistoricoCancelamento.join(", ")}` : `antes ${r.cancelamentoAntes}`,
  };
}

/**
 * As ressalvas de cada card: o ⓘ do card e o rodape do detalhe dizem o mesmo.
 * `dias`: janela da comparacao (a Gerencial usa sempre 30; a aba CX, o filtro).
 */
export function notasDoTile(r: ResumoCx, i: IndicadorCx, dias = DIAS): string[] {
  if (i === "contactRate") {
    return [
      `${AJUDA_CX.contactRate} Conversas ÷ pedidos.`,
      r.semChat.length ? `Sem dado de chat, fora da conta: ${r.semChat.join(", ")}.` : "",
      SEM_HISTORICO_CHAT,
    ].filter(Boolean);
  }
  if (i === "resposta") {
    return [
      "Taxa de resposta do chat da Saúde da Conta da Shopee (a mesma coluna \"% respondido\" da aba CX), na janela que a própria Shopee usa, da fotografia diária mais recente de cada loja.",
      r.respostaMedia === "ponderada"
        ? "O card é a média das lojas ponderada pelas conversas de 30 dias da coleta."
        : r.respostaMedia === "simples"
          ? "O card é a média simples das lojas: nem toda loja tem as conversas medidas para ponderar."
          : "",
      r.respostaMeta ? `Na Saúde da Conta, ${r.respostaMeta} (meta da própria Shopee).` : "",
      "Aqui cair é pior. Sem comparação ainda com o período anterior.",
    ].filter(Boolean);
  }
  if (i === "cancelamento") {
    return [
      `${AJUDA_CX.cancelamentos} Cancelamentos ÷ pedidos.`,
      `A seta compara com os ${dias} dias anteriores, em pontos percentuais; subir é pior.`,
      r.cancelamentoBase
        ? `A seta compara sem ${r.semHistoricoCancelamento.join(", ")} (sem histórico): ${r.cancelamentoBase.anterior} → ${r.cancelamentoBase.atual}.`
        : "",
    ].filter(Boolean);
  }
  return [
    "Valor reembolsado nas devoluções aceitas do período. A taxa é devoluções aceitas ÷ pedidos.",
    SEM_HISTORICO_DEVOLUCAO,
  ];
}

export default function CxResumo({
  brands,
  onOpen,
}: {
  brands: string[];
  /** Abre o dialogo unico da Gerencial com o detalhe por marca do card. */
  onOpen: (indicador: IndicadorCx, resumo: ResumoCx, geradoEm: string) => void;
}) {
  const marca = brands.length ? brands.join(",") : null;
  const [resultado, setResultado] = useState<ResultadoCx | null>(null);

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
          <Tiles r={r} abrir={(i) => onOpen(i, r, resultado.dados.gerado_em)} />
          <LinhaAtencao r={r} />
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Tiles: rotulo, valor e uma linha (reservada) — clicaveis, como a KpiBand
// ---------------------------------------------------------------------------
/** 2 colunas no celular, 3 + 2 de 640 a 1024 px (grade de 6), 5 em linha acima. */
const SPAN_TOPO = "sm:col-span-2 lg:col-span-1";
const SPAN_BASE = "sm:col-span-3 lg:col-span-1";
/** Conteudo no topo do card: o valor fica na mesma altura com ou sem linha. */
const CARD = "min-w-0 rounded-xl [&>div]:h-full [&>div]:justify-start";
/** Sem linha de comparacao: reserva a altura dela (todos os cards iguais). */
const SEM_LINHA = <span aria-hidden="true">&nbsp;</span>;

const IDENT: Record<IndicadorCx, { identidade: IdentidadeKpi; icone: LucideIcon }> = {
  contactRate: { identidade: "atendimento", icone: MessagesSquare },
  resposta: { identidade: "ticket", icone: MessageCircle },
  cancelamento: { identidade: "ads", icone: Ban },
  reembolso: { identidade: "gmv", icone: Undo2 },
};

function Tiles({ r, abrir }: { r: ResumoCx; abrir: (i: IndicadorCx) => void }) {
  // CARDS-KPI (09/11): a cor de identidade da /cx; a resposta em kpi-ticket para nao repetir o contact rate ao lado

  const card = (i: IndicadorCx, span: string, valor: string, linha: ReactNode, extra: { delta?: ReactNode; antes?: ReactNode } = {}) => (
    <button
      type="button"
      onClick={() => abrir(i)}
      aria-haspopup="dialog"
      aria-label={`${ROTULO_INDICADOR[i]}: ${valor}. Ver por marca`}
      className={`${CARD} card-hover w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${span}`}
    >
      <KpiTile
        variante="gerencial"
        identidade={IDENT[i].identidade}
        icone={IDENT[i].icone}
        delta={extra.delta}
        antes={extra.antes}
        // Rotulo em UMA linha (truncate): um nome que quebre empurraria o valor
        // para baixo dos vizinhos. O nome inteiro fica no title, no aria-label
        // do botao e no ⓘ.
        rotulo={
          <span className="min-w-0 truncate" title={ROTULO_INDICADOR[i]}>
            {i === "resposta" ? (
              <>
                <span className="sm:hidden">Resposta</span>
                <span className="hidden sm:inline">Resposta do chat</span>
              </>
            ) : (
              ROTULO_INDICADOR[i]
            )}
          </span>
        }
        valor={valor}
        tom={valor === "—" ? "ausente" : "neutro"}
        comparacao={linha ?? (extra.delta ? undefined : SEM_LINHA)}
        // dentro de botao: o ⓘ so' tem `title`; o detalhe aberto traz as mesmas ressalvas
        ajuda={
          <InfoDica
            emControle
            texto={[i === "resposta" ? `${ROTULO_INDICADOR[i]}.` : null, ...notasDoTile(r, i)].filter(Boolean).join(" ")}
          />
        }
      />
    </button>
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-6 lg:grid-cols-5" data-testid="cx-resumo">
      {card("contactRate", SPAN_TOPO, r.contactRate, null)}
      {card("resposta", SPAN_TOPO, r.resposta, null)}
      {card("cancelamento", SPAN_TOPO, r.cancelamento, null, deltaCancelamento(r))}
      {card("reembolso", SPAN_BASE, r.reembolsado, r.reembolsoPct ? <span className="whitespace-nowrap">{r.reembolsoPct} dos pedidos</span> : null)}
      <div className={`col-span-2 ${CARD} ${SPAN_BASE}`}>
        <KpiTile
          variante="gerencial"
          identidade="ads"
          icone={Repeat2}
          rotulo="Reenvio"
          tom="ausente"
          valor="Sem fonte"
          comparacao={SEM_LINHA}
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
// Uma linha: "Atencao" com ate' 2 marcas fora da curva
// ---------------------------------------------------------------------------
function LinhaAtencao({ r }: { r: ResumoCx }) {
  // Com menos de 3 marcas nao ha mediana justa: nem alerta, nem "nenhuma fora da curva".
  if (r.marcas.length < MIN_MARCAS_RISCO) return null;
  return (
    <p
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-line pt-3 text-xs text-ink-muted"
      data-testid="cx-marcas"
    >
      {r.alertas.length ? (
        <>
          <span className="font-semibold text-ink">Atenção:</span>
          {r.alertas.map((a, idx) => (
            <span key={a.chave} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${PONTO_TOM[a.tom]}`} />
              <span className={`font-semibold ${TINTA_TOM[a.tom]}`}>{a.marca}</span>
              <span className="tabular-nums">
                {ROTULO_CURTO[a.indicador]} {a.valor} <span className="text-ink-faint">{a.referencia}</span>
              </span>
              {/* O "·" fecha o item ANTERIOR: na quebra (390 px) a linha nova
                  comeca pelo ponto da marca, nunca por um separador solto. */}
              {idx < r.alertas.length - 1 && <span aria-hidden="true" className="text-ink-faint">·</span>}
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
