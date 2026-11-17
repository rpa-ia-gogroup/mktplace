"use client";

/**
 * CX · Mercado Livre na Gerencial (16/11/2026): os mesmos cinco cartoes e o
 * mesmo layout do `CxResumo` (Shopee), com os numeros de `/api/v1/cx/mercadolivre`
 * (`resumoMl`, o mesmo calculo da aba CX · ML). No ML o contact rate e'
 * reclamacoes ÷ pedidos e a resposta e' a das perguntas de pre-venda.
 * O que o ML nao tem vira "Sem dado" (cinza), nunca zero. Clicar num cartao
 * abre a aba CX · Mercado Livre, onde mora o detalhe por marca.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Ban, MessageCircle, MessagesSquare, Repeat2, Undo2, type LucideIcon } from "lucide-react";

import InfoDica from "@/components/ui/InfoDica";
import KpiTile, { type IdentidadeKpi } from "@/components/ui/KpiTile";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { MOTIVO_REENVIO, ROTULO_INDICADOR, hrefCx, reais, type ComparacaoCard, type JanelaDias } from "@/lib/cx";
import { AJUDA_ML, ROTULO_ML, carregarCxMl, resumoMl, valorMl, type IndicadorTaxa, type ResultadoMl, type ResumoMl } from "@/lib/cx-ml";
import { torreFetch } from "@/lib/torre-fetch";

import { LinhaSemComparacao, pilula, type RodapeCard } from "./CxResumo";

const SEM_LINHA = <span aria-hidden="true">&nbsp;</span>;
const SPAN_TOPO = "sm:col-span-2 lg:col-span-1";
const SPAN_BASE = "sm:col-span-3 lg:col-span-1";

type CartaoMl = "contactRate" | "resposta" | "cancelamento" | "reembolso";

const IDENT: Record<CartaoMl, { identidade: IdentidadeKpi; icone: LucideIcon }> = {
  contactRate: { identidade: "atendimento", icone: MessagesSquare },
  resposta: { identidade: "ticket", icone: MessageCircle },
  cancelamento: { identidade: "ads", icone: Ban },
  reembolso: { identidade: "gmv", icone: Undo2 },
};

/** Rodape de comparacao: pilula + "antes" quando ha' anterior; senao a linha neutra da API; sem valor, nada. */
function rodape(valor: number | null, comp: ComparacaoCard | null, sem?: { texto: string; detalhe: string | null }): RodapeCard {
  if (valor == null) return {};
  const grafico = comp?.serie ? { serie: comp.serie, granularidade: comp.granularidade } : {};
  if (comp?.delta != null) return { delta: pilula(comp), antes: comp.antes ?? undefined, ...grafico };
  return { ...(sem ? { antes: <LinhaSemComparacao {...sem} /> } : {}), ...grafico };
}

export default function CxResumoMl({ brands, dias, subtitulo }: { brands: string[]; dias: JanelaDias; subtitulo: string }) {
  const router = useRouter();
  const marca = brands.length ? brands.join(",") : null;
  const [resultado, setResultado] = useState<ResultadoMl | null>(null);

  const carregar = useCallback(() => {
    let vivo = true;
    setResultado(null);
    carregarCxMl({ marca, dias }, torreFetch as typeof fetch).then((r) => {
      if (vivo) setResultado(r);
    });
    return () => {
      vivo = false;
    };
  }, [marca, dias]);

  useEffect(() => carregar(), [carregar]);

  const href = hrefCx({ marca: brands.length === 1 ? brands[0] : null, dias }, "ml");
  const r = resultado?.ok ? resumoMl(resultado.dados) : null;

  return (
    <Panel
      titulo="CX · Mercado Livre"
      icone={MessageCircle}
      descricao={subtitulo}
      aria-label="CX Mercado Livre"
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
        <StateBlock tipo="carregando" compacto titulo="Carregando CX do Mercado Livre" />
      ) : !resultado.ok || !r ? (
        <StateBlock
          tipo="erro"
          compacto
          titulo="CX do Mercado Livre indisponível nesta carga"
          descricao={resultado.ok ? undefined : resultado.motivo}
          acao={<RetryButton onClick={() => carregar()} />}
        />
      ) : (
        <TilesMl r={r} abrir={() => router.push(href)} />
      )}
    </Panel>
  );
}

function TilesMl({ r, abrir }: { r: ResumoMl; abrir: () => void }) {
  const card = (i: CartaoMl, span: string, rotulo: string, v: number | null, ajuda: string, linha: ReactNode, extra: RodapeCard) => (
    <div className={`min-w-0 ${span}`}>
      <KpiTile
        onAbrir={v == null ? undefined : abrir}
        variante="gerencial"
        identidade={IDENT[i].identidade}
        icone={IDENT[i].icone}
        delta={extra.delta}
        antes={extra.antes}
        serie={extra.serie}
        granularidade={extra.granularidade}
        rotulo={
          <span className="min-w-0 truncate" title={rotulo}>
            {rotulo}
          </span>
        }
        valor={valorMl(v)}
        tom={v == null ? "ausente" : "neutro"}
        comparacao={linha ?? (extra.delta || extra.antes ? undefined : SEM_LINHA)}
        ajuda={<InfoDica emControle={v != null} texto={v == null ? `${ajuda} Sem dado no Mercado Livre neste período; nunca aparece como zero.` : ajuda} />}
      />
    </div>
  );
  const taxa = (i: IndicadorTaxa) => rodape(r.taxa[i], r.comparacao[i], r.semAnterior[i]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-6 lg:grid-cols-5" data-testid="cx-resumo-ml">
      {card("contactRate", SPAN_TOPO, ROTULO_INDICADOR.contactRate, r.taxa.reclamacao, AJUDA_ML.reclamacao, null, taxa("reclamacao"))}
      {card("resposta", SPAN_TOPO, "Resposta pré-venda", r.resposta, `${ROTULO_ML.resposta} das perguntas de pré-venda. ${AJUDA_ML.resposta}`, null, rodape(r.resposta, r.respostaComparacao, r.semAnterior.resposta))}
      {card("cancelamento", SPAN_TOPO, ROTULO_INDICADOR.cancelamento, r.taxa.cancelamento, AJUDA_ML.cancelamento, null, taxa("cancelamento"))}
      {card(
        "reembolso",
        SPAN_BASE,
        ROTULO_INDICADOR.reembolso,
        r.taxa.reembolso,
        AJUDA_ML.reembolso,
        r.taxa.reembolso != null && r.valorReembolsado != null ? `${reais(r.valorReembolsado)} reembolsado` : null,
        taxa("reembolso"),
      )}
      <div className={`min-w-0 rounded-xl [&>div]:h-full [&>div]:justify-start ${SPAN_BASE}`}>
        <KpiTile
          variante="gerencial"
          identidade="ads"
          icone={Repeat2}
          rotulo="Reenvio"
          tom="ausente"
          valor="Sem fonte"
          comparacao={SEM_LINHA}
          ajuda={<InfoDica titulo="Reenvio" texto={`${MOTIVO_REENVIO[0].toUpperCase()}${MOTIVO_REENVIO.slice(1)}. Entra quando houver fonte; nunca aparece como zero.`} />}
        />
      </div>
    </div>
  );
}
