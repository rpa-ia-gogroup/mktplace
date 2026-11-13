"use client";

import { CircleDollarSign, Handshake, Music2, ShoppingBag, type LucideIcon } from "lucide-react";

import CartaoIndicador, { type TomPilula } from "@/components/ui/CartaoIndicador";
import InfoDica from "@/components/ui/InfoDica";
import { fmtBrlCurto } from "@/lib/formatters";
import type { LinhaCusto } from "./ChannelCostPanel";

/**
 * A faixa do Financeiro na grade unica (ALVO-GRADE): sempre QUATRO cartoes
 * iguais, a receita somada e um por canal. A cor do cartao e' identidade (GMV
 * ou canal); bom/ruim fica so' na pilula da taxa, com os limiares de sempre.
 * O clique no canal abre os componentes de custo CONHECIDOS. Custos nunca sao
 * somados; so' o GMV. Linha de tendencia so' com serie real que confere com o
 * numero do cartao (`serieQueConfere`).
 */
export interface PainelCanal {
  canal: "tiktok" | "ml" | "shopee";
  titulo: string;
  /** Classe `bg-canal-*` do ponto de identidade (e da barra do detalhe). */
  ponto: string;
  gmv: number | null;
  linhas: LinhaCusto[];
  /** Taxa do canal sobre o GMV, ja' formatada, com o tom da regra de negocio. */
  pilula?: { texto: string; tom: TomPilula } | null;
  /** Ressalva que muda a leitura (ex.: tarifa parcial por marcas sem dado): vai para o ⓘ do cartao. */
  aviso?: string;
}

export const GRADE_FINANCEIRO = "grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4";

const CANAIS: { canal: PainelCanal["canal"]; titulo: string; icone: LucideIcon }[] = [
  { canal: "tiktok", titulo: "TikTok Shop", icone: Music2 },
  { canal: "ml", titulo: "Mercado Livre", icone: Handshake },
  { canal: "shopee", titulo: "Shopee", icone: ShoppingBag },
];

export default function FaixaFinanceiro({
  paineis,
  total,
  serieTotal,
  foraDaConta,
  onAbrir,
}: {
  /** Um por canal SELECIONADO no filtro. */
  paineis: PainelCanal[];
  /** Soma do GMV dos canais selecionados; `null` = nenhum com dado. */
  total: number | null;
  serieTotal: number[] | null;
  /** O que nao entra na conta (margem nao fechada): ⓘ do cartao da soma. */
  foraDaConta: string;
  onAbrir: (canal: PainelCanal["canal"]) => void;
}) {
  return (
    <div className={GRADE_FINANCEIRO}>
      <CartaoIndicador
        rotulo={paineis.length > 1 ? `Receita dos ${paineis.length} canais` : "Receita (GMV)"}
        icone={CircleDollarSign}
        cor="rgb(var(--tc-kpi-gmv))"
        valor={total != null ? fmtBrlCurto(total) : null}
        pilula={total != null && paineis.length > 1 ? { texto: "soma", tom: "neutro" } : null}
        legenda={total != null ? "margem não fechada" : "Sem dado no período"}
        serie={serieTotal}
        ajuda={<InfoDica texto={foraDaConta} />}
      />
      {CANAIS.map(({ canal, titulo, icone }) => {
        const p = paineis.find((x) => x.canal === canal);
        return (
          <CartaoIndicador
            key={canal}
            rotulo={titulo}
            icone={icone}
            cor={`rgb(var(--tc-canal-${canal}))`}
            valor={p?.gmv != null ? fmtBrlCurto(p.gmv) : null}
            pilula={p?.gmv != null ? p.pilula : null}
            legenda={!p ? "Fora do filtro" : p.gmv != null ? "Ver custos conhecidos" : "Sem dado no período"}
            ajuda={p?.aviso ? <InfoDica emControle texto={p.aviso} /> : null}
            onAbrir={p ? () => onAbrir(canal) : undefined}
          />
        );
      })}
    </div>
  );
}
