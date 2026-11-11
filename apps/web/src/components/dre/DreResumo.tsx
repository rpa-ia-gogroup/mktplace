import { CircleDollarSign, Percent, ShieldCheck, TrendingUp } from "lucide-react";

import KpiTile from "@/components/ui/KpiTile";
import { AvisoMargem, ClassificacaoChip } from "@/components/dre/DreChips";
import type { ChaveDetalheDre } from "@/components/dre/DreDetalheConta";
import {
  ROTULO_MARGEM,
  STATUS_CHIP,
  TEXTO_NAO_CALCULAVEL_AGREGADO,
  avisoMargem,
  completudeExibida,
  custosAusentes,
  fmtReais,
  juntarNomes,
  rotuloAusentes,
  semMargem,
  textoMargem,
  textoMargemPct,
  type CelulaDRE,
} from "@/lib/dre";

/**
 * DRE-UX-1/2 — resumo da selecao: receita, margem de contribuicao conhecida, %
 * e classificacao.
 *
 * Margem ausente nao vira "R$ 0" nem travessao: os textos saem de
 * `textoMargem`/`textoMargemPct`, que devolvem o status. O resultado nunca e'
 * chamado de lucro nem de margem liquida.
 *
 * DRE-UX-2: agregado NAO CALCULAVEL nao mostra "0 de 6 custos" (a completude
 * do backend ali e' a intersecao entre celulas e leria "nenhum custo
 * conhecido"); diz "Não calculável — veja os canais" e nomeia os canais que
 * bloqueiam. Margem calculavel traz "Parcial" e o que falta no PROPRIO tile,
 * para o numero grande nunca parecer margem completa.
 *
 * T-0090: competencia imatura chega como PREVIA, com numero. O tile mostra a
 * margem com o selo "Prévia · fecha em DD/MM/AAAA" e, se a margem inclui custo
 * parcial, diz quais e o aviso do backend.
 */
export default function DreResumo({
  total,
  competencia,
  bloqueadores,
  onAbrir,
}: {
  total: CelulaDRE;
  competencia: string;
  /** Rotulos dos canais nao calculaveis que impedem o agregado. */
  bloqueadores: string[];
  /** Margem e Classificacao abrem o detalhe (o que falta na conta e por que e' parcial). */
  onAbrir?: (chave: ChaveDetalheDre) => void;
}) {
  const receita = total.componentes.receita;
  const sem = semMargem(total);
  const faltam = custosAusentes(total);
  const motivo = total.motivos_classificacao[0] ?? null;
  const completude = completudeExibida(total);
  const bloqueio = bloqueadores.length
    ? `Bloqueado por ${juntarNomes(bloqueadores)}`
    : motivo
      ? `Motivo: ${motivo}`
      : "Sem margem para esta seleção";

  const leituraMargem = sem ? (
    bloqueio
  ) : (
    <span className="flex flex-col items-start gap-1.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <ClassificacaoChip classificacao={total.classificacao} fechaEm={total.fecha_em} previa={total.previa} />
        <span>
          {faltam.length
            ? `${rotuloAusentes(total)}: ${faltam.join(", ")}`
            : "Todos os custos aplicáveis na conta"}
        </span>
      </span>
      <AvisoMargem aviso={avisoMargem(total)} />
    </span>
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        variante="gerencial"
        identidade="gmv"
        icone={CircleDollarSign}
        rotulo="Receita"
        valor={receita.valor !== null ? fmtReais(receita.valor) : STATUS_CHIP[receita.status]?.rotulo ?? "Sem valor"}
        tom={receita.valor === null ? "ausente" : "neutro"}
        comparacao={
          receita.status === "parcial" ? `Parcial: ${receita.motivo ?? "cobertura incompleta"}` : `Competência ${competencia}`
        }
      />
      <KpiTile
        variante="gerencial"
        identidade="roas"
        icone={TrendingUp}
        rotulo={ROTULO_MARGEM}
        valor={textoMargem(total)}
        tom={sem ? "ausente" : "neutro"}
        comparacao={leituraMargem}
        onAbrir={onAbrir ? () => onAbrir("margem") : undefined}
      />
      <KpiTile
        variante="gerencial"
        identidade="ticket"
        icone={Percent}
        rotulo="% da receita"
        valor={textoMargemPct(total)}
        tom={sem ? "ausente" : "neutro"}
        comparacao={sem ? "Depende da margem ao lado" : "Margem conhecida ÷ receita"}
      />
      <KpiTile
        variante="gerencial"
        identidade="atendimento"
        icone={ShieldCheck}
        onAbrir={onAbrir ? () => onAbrir("classificacao") : undefined}
        rotulo="Classificação"
        valor={
          <span className="flex flex-wrap items-center gap-2 text-base">
            <ClassificacaoChip
              classificacao={total.classificacao}
              completude={completude}
              fechaEm={total.fecha_em}
              previa={total.previa}
            />
            {completude === null ? (
              <span className="text-sm font-semibold text-ink-muted">{TEXTO_NAO_CALCULAVEL_AGREGADO.replace("Não calculável ", "")}</span>
            ) : (
              <span className="text-sm font-semibold text-ink-muted">{completude}</span>
            )}
          </span>
        }
        comparacao={
          completude === null
            ? bloqueio
            : faltam.length
              ? `${rotuloAusentes(total)}: ${faltam.join(", ")}`
              : "Todos os custos aplicáveis presentes"
        }
      />
    </div>
  );
}
