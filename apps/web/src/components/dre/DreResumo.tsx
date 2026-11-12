import { CircleDollarSign, Percent, ShieldCheck, TrendingUp } from "lucide-react";

import KpiTile from "@/components/ui/KpiTile";
import { AvisoMargem, ClassificacaoChip, MargemSuspensaChip } from "@/components/dre/DreChips";
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
  margemPrincipal,
  margemSuspensa,
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
 *
 * T-0090 (supervisor, 11/11): na PREVIA com cenario estimado, a margem
 * ESTIMADA e' o numero principal (`margemPrincipal`); a conhecida desce para
 * a linha "Conhecida: X% (sem impostos, devoluções e parte do CMV)", com o
 * aviso. Mes maduro e PREVIA sem cenario: a conhecida segue no destaque.
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
  const principal = margemPrincipal(total);
  const estimada = principal.tipo === "estimada" ? principal : null;
  const bloqueio = bloqueadores.length
    ? `Bloqueado por ${juntarNomes(bloqueadores)}`
    : motivo
      ? `Motivo: ${motivo}`
      : "Sem margem para esta seleção";

  // T-0101: insumo vencido/ausente suspende a margem; o motivo vem com o selo.
  const suspensa = margemSuspensa(total);
  const leituraMargem = suspensa ? (
    <span className="flex flex-wrap items-center gap-1.5">
      <MargemSuspensaChip />
      <span>{total.margem_contribuicao_conhecida.motivo_suspensao ?? bloqueio}</span>
    </span>
  ) : sem ? (
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
      {estimada && <span className="text-xs font-semibold text-ink-muted">{estimada.secundaria}</span>}
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
        rotulo={estimada ? estimada.rotulo : ROTULO_MARGEM}
        valor={estimada ? estimada.valor : textoMargem(total)}
        tom={sem ? "ausente" : "neutro"}
        comparacao={leituraMargem}
        onAbrir={onAbrir ? () => onAbrir("margem") : undefined}
      />
      <KpiTile
        variante="gerencial"
        identidade="ticket"
        icone={Percent}
        rotulo="% da receita"
        valor={estimada ? estimada.pct : textoMargemPct(total)}
        tom={sem ? "ausente" : "neutro"}
        comparacao={
          estimada
            ? "Margem estimada ÷ receita"
            : suspensa
              ? "Suspensa até a republicação do insumo"
              : sem
                ? "Depende da margem ao lado"
                : "Margem conhecida ÷ receita"
        }
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
