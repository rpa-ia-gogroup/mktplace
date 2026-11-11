import { Award, Layers, Medal, Trophy, type LucideIcon } from "lucide-react";

import type { ParetoSummaryBucket } from "@/lib/api-client";
import { fmtBrlCurto, fmtPctSimples } from "@/lib/formatters";
import { toggleBucketSelection } from "@/lib/produtos-tab-transition";
import FaixaCarregando from "@/components/ui/FaixaCarregando";
import InfoDica from "@/components/ui/InfoDica";
import KpiTile from "@/components/ui/KpiTile";
import StateBlock from "@/components/ui/StateBlock";

interface Props {
  buckets: ParetoSummaryBucket[] | null;
  loading: boolean;
  activeBucket: string | null;
  onSelectBucket: (bucket: string | null) => void;
  /** Linha curta sob os cards (atualizacao, parcial, sem GMV, preco medio). */
  scopeNote?: string;
  /** Metodologia do Pareto — fica num ⓘ ao lado da linha, fora do caminho do olho. */
  dica?: string;
  /**
   * Preenchido quando o escopo NAO tem valor confiavel (nada carregado, ou so
   * GMV zero). Os cards viram uma mensagem de ausencia em vez de "R$ 0K":
   * ausencia de dado nunca e desenhada como venda zero.
   */
  unavailableReason?: string | null;
}

/**
 * Icone de cada faixa da curva (identidade `gmv` para as quatro: e' a composicao
 * do GMV; a cor nao diz bom nem ruim, o que muda e' a letra e o icone). O
 * `description` ("Top 50% GMV") vai para o ⓘ.
 */
const ICONE_DA_CURVA: Record<string, LucideIcon> = { A_top50: Trophy, B_next30: Medal, C_next15: Award, D_tail: Layers };

const GRADE = "grid grid-cols-2 sm:grid-cols-4 gap-3";

/**
 * Cards A/B/C/D compartilhados pelas 3 abas de Produtos, no padrao da Gerencial
 * (`KpiTile` gerencial). Cada card e um filtro clicavel (toggle): clicar de novo no
 * bucket ja ativo remove o filtro (equivalente a "Todos"); por isso e' botao de
 * alternar (`aria-pressed`, anel quando ativo) e NAO abre dialogo. Os percentuais
 * reais podem variar em torno de 50/30/15/5 por causa do produto que cruza a
 * fronteira — isso e esperado, nao um bug. Sem periodo anterior nem serie: sem
 * pilula e sem grafico. O PERCENTUAL abre o cartao e o R$ vem depois (regra de produto:
 * % antes do absoluto).
 */
function ScopeLine({ scopeNote, dica, className }: { scopeNote?: string; dica?: string; className: string }) {
  if (!scopeNote && !dica) return null;
  return (
    <p className={`flex items-center gap-1.5 text-xs text-ink-faint ${className}`}>
      {scopeNote && <span className="tabular-nums">{scopeNote}</span>}
      {dica && <InfoDica texto={dica} />}
    </p>
  );
}

export default function ProductParetoSummary({ buckets, loading, activeBucket, onSelectBucket, scopeNote, dica, unavailableReason }: Props) {
  if (loading && !buckets) {
    return (
      <div className="border-b border-line px-6 py-4">
        <FaixaCarregando cartoes={4} className={GRADE} />
      </div>
    );
  }

  if (unavailableReason) {
    return (
      <div className="border-b border-line px-6 py-4" data-testid="pareto-unavailable">
        <StateBlock compacto tipo="indisponivel" titulo={unavailableReason} />
        <ScopeLine scopeNote={scopeNote} dica={dica} className="pt-2" />
      </div>
    );
  }

  if (!buckets || buckets.length === 0) return null;

  return (
    <div className="border-b border-line">
      <div className={`${GRADE} px-6 py-4`}>
        {buckets.map((b) => (
          <KpiTile
            key={b.bucket}
            variante="gerencial"
            identidade="gmv"
            icone={ICONE_DA_CURVA[b.bucket] ?? Layers}
            rotulo={`Curva ${b.label}`}
            ajuda={<InfoDica emControle texto={b.description} />}
            valor={fmtPctSimples(b.gmv_pct)}
            comparacao={`${fmtBrlCurto(b.gmv)} · ${b.count} produtos`}
            ativo={activeBucket === b.bucket}
            acaoFalada="filtrar a tabela"
            onAbrir={() => onSelectBucket(toggleBucketSelection(activeBucket, b.bucket))}
          />
        ))}
      </div>
      <ScopeLine scopeNote={scopeNote} dica={dica} className="px-6 pb-3" />
    </div>
  );
}
