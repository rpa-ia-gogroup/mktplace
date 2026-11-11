"use client";

import { AvisoMargem, ClassificacaoChip } from "@/components/dre/DreChips";
import DataQualityNote from "@/components/drilldown/DataQualityNote";
import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import InfoDica from "@/components/ui/InfoDica";
import NumeroAnimado from "@/components/ui/NumeroAnimado";
import {
  ROTULO_COMPONENTE,
  ROTULO_MARGEM,
  STATUS_CHIP,
  avisoMargem,
  completudeExibida,
  custosAusentes,
  juntarNomes,
  rotuloAusentes,
  textoMargem,
  textoMargemPct,
  type CelulaDRE,
  type NomeComponente,
} from "@/lib/dre";

export type ChaveDetalheDre = "margem" | "classificacao";

export const TITULO_DETALHE_DRE: Record<ChaveDetalheDre, string> = {
  margem: ROTULO_MARGEM,
  classificacao: "Classificação",
};

/**
 * Detalhe dos cartoes Margem e Classificacao da DRE Conhecida: POR QUE a margem e'
 * "Parcial" e o que falta na conta. So' os dados que a resposta ja' traz
 * (`componentes_ausentes`, `motivos_classificacao`, `avisos_qualidade`); a DRE
 * vertical, logo abaixo na pagina, segue sendo o lugar da conta linha a linha e nao
 * e' repetida aqui. O resultado nunca e' chamado de lucro nem de margem liquida;
 * ausencia mostra o status, nunca "R$ 0".
 */
export default function DreDetalheConta({
  chave, total, competencia, bloqueadores,
}: {
  chave: ChaveDetalheDre;
  total: CelulaDRE;
  competencia: string;
  /** Rotulos dos canais nao calculaveis que impedem o agregado. */
  bloqueadores: string[];
}) {
  const faltam = custosAusentes(total);
  const completude = completudeExibida(total);
  const valor = textoMargem(total);
  const pct = textoMargemPct(total);
  const motivos = total.motivos_classificacao;
  const avisos = total.avisos_qualidade;
  const nenhum = !total.componentes_ausentes.length && !motivos.length && !avisos.length && !bloqueadores.length;
  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        {chave === "margem" ? (
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
            <NumeroAnimado texto={valor} className="text-[32px] font-bold leading-none tracking-tight text-ink tabular-nums" />
            <span className="pb-0.5 text-xs text-ink-faint tabular-nums">{pct === "Não calculável" ? "" : `${pct} da receita`}</span>
            <AvisoMargem aviso={avisoMargem(total)} />
          </div>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <ClassificacaoChip classificacao={total.classificacao} completude={completude} fechaEm={total.fecha_em} previa={total.previa} />
          </span>
        )}
        <DrilldownContextLine
          leading="Conhecida"
          periodLabel={`Competência ${competencia}`}
          refreshedAt={total.data_maxima.mart_carregado_em ?? null}
          dica={chave === "margem" ? <InfoDica texto="Não é lucro nem margem líquida. Impostos e devoluções ainda não têm fonte." /> : undefined}
        />
      </div>

      {bloqueadores.length > 0 && <DataQualityNote note={`Total não calculável: ${juntarNomes(bloqueadores)}.`} />}

      {total.componentes_ausentes.length > 0 && (
        <DrilldownSecao titulo={faltam.length ? rotuloAusentes(total) : "O que falta na conta"} acao={<span className="tabular-nums">{total.componentes_ausentes.length}</span>}>
          <ul className="flex flex-col">
            {total.componentes_ausentes.map((a) => (
              <EvidenceRow
                key={a.componente}
                label={ROTULO_COMPONENTE[a.componente as NomeComponente] ?? a.componente}
                value={STATUS_CHIP[a.status]?.rotulo ?? a.status}
                tone="muted"
                reference={a.motivo}
              />
            ))}
          </ul>
        </DrilldownSecao>
      )}

      {motivos.length > 0 && (
        <DrilldownSecao titulo="Motivos da classificação">
          <div className="flex flex-col gap-1.5">
            {motivos.map((m) => (
              <DataQualityNote key={m} note={m} />
            ))}
          </div>
        </DrilldownSecao>
      )}

      {avisos.length > 0 && (
        <DrilldownSecao titulo="Avisos de qualidade">
          <div className="flex flex-col gap-1.5">
            {avisos.map((m) => (
              <DataQualityNote key={m} note={m} />
            ))}
          </div>
        </DrilldownSecao>
      )}

      {nenhum && <p className="text-xs text-ink-faint">Todos os custos aplicáveis na conta, sem motivos nem avisos.</p>}
    </div>
  );
}
