"use client";

import { CircleDollarSign, Handshake, Music2, ShoppingBag, type LucideIcon } from "lucide-react";

import CartaoIndicador from "@/components/ui/CartaoIndicador";
import InfoDica from "@/components/ui/InfoDica";
import { fmtBrlCurto, fmtNumCurto, fmtPctSimples } from "@/lib/formatters";
import type { CanalId, ColunaCanal } from "./ChannelOverview";

/**
 * A faixa de Canais na grade unica (ALVO-GRADE): sempre QUATRO cartoes iguais,
 * o GMV somado e um por canal, na cor do canal. Nada e' calculado de novo: sao
 * as MESMAS colunas do "Canais lado a lado" (`colunasCanal`). Participacao e'
 * a fatia entre os canais selecionados COM dado; canal sem linha no recorte e'
 * "N/D" com motivo, nunca R$ 0. Linha de tendencia so' no cartao da soma, e so'
 * quando a serie confere com o numero (`serieQueConfere`).
 */
export const GRADE_CANAIS = "grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4";

const CANAIS: { canal: CanalId; titulo: string; icone: LucideIcon }[] = [
  { canal: "tiktok", titulo: "TikTok Shop", icone: Music2 },
  { canal: "ml", titulo: "Mercado Livre", icone: Handshake },
  { canal: "shopee", titulo: "Shopee", icone: ShoppingBag },
];

export default function FaixaCanais({
  colunas,
  serieTotal,
  notaVendas,
}: {
  /** Uma por canal SELECIONADO no filtro. */
  colunas: ColunaCanal[];
  /** GMV por dia do recorte inteiro, ja' conferido com a soma. */
  serieTotal: number[] | null;
  /** O que GMV e pedidos contam (pagos ou realizados): ⓘ do cartao da soma. */
  notaVendas: string;
}) {
  const comGmv = colunas.filter((c) => c.gmv != null);
  const total = comGmv.length > 0 ? comGmv.reduce((s, c) => s + (c.gmv ?? 0), 0) : null;
  return (
    <div className={GRADE_CANAIS}>
      <CartaoIndicador
        rotulo={colunas.length > 1 ? `GMV dos ${colunas.length} canais` : "GMV do período"}
        icone={CircleDollarSign}
        cor="rgb(var(--tc-kpi-gmv))"
        valor={total != null ? fmtBrlCurto(total) : null}
        legenda={total != null ? undefined : "Sem dado no período"}
        serie={serieTotal}
        ajuda={<InfoDica texto={`GMV e pedidos — ${notaVendas}`} />}
      />
      {CANAIS.map(({ canal, titulo, icone }) => {
        const c = colunas.find((x) => x.canal === canal);
        const linhas: [string, string, boolean][] = c
          ? [
              ["Pedidos", c.pedidos != null ? fmtNumCurto(c.pedidos) : "Sem dado", c.pedidos != null],
              ["Conversão", c.conversao, c.conversao !== "N/D" && c.conversao !== "—"],
            ]
          : [];
        return (
          <CartaoIndicador
            key={canal}
            rotulo={titulo}
            icone={icone}
            cor={`rgb(var(--tc-canal-${canal}))`}
            valor={c?.gmv != null ? fmtBrlCurto(c.gmv) : null}
            pilula={c?.gmv != null && total ? { texto: `${fmtPctSimples((c.gmv / total) * 100)} do GMV`, tom: "neutro" } : null}
            legenda={!c ? "Fora do filtro" : c.gmv == null ? "Sem dado no período" : undefined}
            rodape={
              c?.gmv != null ? (
                <span className="grid gap-0.5 tabular-nums">
                  {linhas.map(([rotulo, valor, tem]) => (
                    <span key={rotulo} className="flex items-baseline justify-between gap-3">
                      <span>{rotulo}</span>
                      <b className={tem ? "font-semibold text-ink" : "font-normal text-ink-faint"}>{valor}</b>
                    </span>
                  ))}
                </span>
              ) : null
            }
          />
        );
      })}
    </div>
  );
}
