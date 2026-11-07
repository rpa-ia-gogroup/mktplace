"use client";

/**
 * CX · Shopee na Gerencial (GERENCIAL-CX, 07/11/2026) — resumo de uma linha
 * com os numeros que a aba CX ja' tem. Mesma rota (`/api/v1/cx/shopee`),
 * buscada pelo navegador como na /cx. A /cx so' aceita 7/30/90 dias fechados:
 * aqui e' sempre 30, escrito no cabecalho, sem tentar casar com o periodo da
 * Gerencial. Marca segue o filtro global; a pagina so' monta isto com a
 * Shopee no filtro de canal.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";

import InfoDica from "@/components/ui/InfoDica";
import KpiTile from "@/components/ui/KpiTile";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { AJUDA_CX, MOTIVO_REENVIO, carregarCxShopee, hrefCx, resumoCxGerencial, type ResultadoCx } from "@/lib/cx";
import { brandLabel } from "@/lib/filters/brands";
import { torreFetch } from "@/lib/torre-fetch";

const DIAS = 30;

export default function CxResumo({ brands }: { brands: string[] }) {
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-testid="cx-resumo">
          <KpiTile
            rotulo="Contact rate"
            valor={r.contactRate}
            ajuda={
              <InfoDica
                titulo="Contact rate"
                texto={AJUDA_CX.contactRate}
                nota={r.semChat.length ? `Sem dado de chat, fora da conta: ${r.semChat.join(", ")}.` : undefined}
              />
            }
          />
          <KpiTile
            rotulo="Aguardando resposta"
            valor={r.aguardando}
            comparacao="das conversas"
            ajuda={
              <InfoDica
                titulo="Aguardando resposta"
                texto={AJUDA_CX.aguardando}
                nota="Inclui conversas antigas paradas, não só as do período."
              />
            }
          />
          <KpiTile
            rotulo="Cancelamento"
            valor={r.cancelamento}
            comparacao="dos pedidos"
            ajuda={<InfoDica titulo="Cancelamento" texto={AJUDA_CX.cancelamentos} />}
          />
          <KpiTile
            rotulo="Reembolso"
            valor={r.reembolsado}
            comparacao={r.reembolsoPct ? `${r.reembolsoPct} dos pedidos` : undefined}
            ajuda={
              <InfoDica
                titulo="Reembolso"
                texto="Valor reembolsado nas devoluções aceitas do período. A taxa é devoluções aceitas ÷ pedidos."
              />
            }
          />
          <KpiTile rotulo="Reenvio" valor={<span className="text-ink-faint">Sem fonte</span>} comparacao={`${MOTIVO_REENVIO[0].toUpperCase()}${MOTIVO_REENVIO.slice(1)}.`} />
        </div>
      )}
    </Panel>
  );
}
