"use client";

/**
 * Faixa de confianca no dado (Gate V2-1, Task C; semantica corrigida na rodada
 * consolidada, Task F).
 *
 * Decisao do V2-0: confianca **NAO e' KPI**. Desde 13/11 e' um selo pequeno
 * ao lado do "Atualizado" no topo, clicavel, que abre o drill-down.
 *
 * O que a faixa afirma agora e' **disponibilidade de serie**, derivada dos
 * estados das series por canal ja carregadas — nao "cobertura" inferida de
 * `gmv != null`. Um canal com serie de valores zero e' *disponivel*; um canal
 * sem nenhuma linha e' *sem registros*; um canal cuja fonte falhou e'
 * *indisponivel*. Os tres estados sao distintos e nomeados.
 *
 * Falha do executive-summary NAO transforma a faixa inteira em erro: a
 * disponibilidade das series continua valendo, e apenas defasagem/avisos passam
 * a constar como "não verificados".
 */
import type { ConfidenceStripData } from "@/lib/gerencial/attention";

interface Props {
  data: ConfidenceStripData;
  /** Nenhuma serie concluiu ainda — a faixa nao exibe numero anterior algum. */
  loading: boolean;
  onOpen: () => void;
}

// Selo do topo (13/11): mesma altura e anel do SeloAtualizado, ao lado dele.
const SELO =
  "inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium ring-1 ring-inset";

export default function ConfidenceStrip({ data, loading, onOpen }: Props) {
  if (loading) {
    return (
      <span role="status" aria-busy="true" className={`${SELO} bg-raised text-ink-faint ring-line`}>
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-line animate-pulse" />
        Verificando dados…
      </span>
    );
  }

  const { selectedCount, availableCount, noRecordsCount, unavailableCount } = data;
  const allAvailable = availableCount === selectedCount && selectedCount > 0;
  const alerta = unavailableCount > 0 || (data.warningsChecked && data.warningCount > 0);
  const dotTone = unavailableCount > 0 ? "bg-warn" : allAvailable ? "bg-ok" : "bg-ink-faint";
  // O resto do que a faixa escrevia (sem registros, defasagem, nao verificado) vai no title e no detalhe.
  const detalhe = [
    `Série disponível em ${availableCount} de ${selectedCount} ${selectedCount === 1 ? "canal" : "canais"}`,
    noRecordsCount > 0 ? `${noRecordsCount} sem registros no período` : null,
    unavailableCount > 0 ? `${unavailableCount} ${unavailableCount === 1 ? "indisponível" : "indisponíveis"}` : null,
    data.warningsChecked
      ? [
          data.maxStalenessDays != null ? `defasagem máxima ${data.maxStalenessDays}d` : null,
          data.warningCount > 0 ? `${data.warningCount} aviso${data.warningCount > 1 ? "s" : ""} de dado` : "sem avisos de dado",
        ].filter(Boolean).join(" · ")
      : "defasagem e avisos não verificados",
  ].filter(Boolean).join(" · ");

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      title={detalhe}
      aria-label={`Confiança no dado: ${detalhe}. Abrir detalhe`}
      className={`${SELO} ${alerta ? "bg-warn-soft text-warn-ink ring-warn/30" : "bg-surface text-ink-muted ring-line"} hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-colors`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotTone}`} />
      {/* Frase de gestor; contagem de series e defasagem ficam no title e no detalhe. */}
      {unavailableCount > 0 ? (
        <span className="tabular-nums">
          {unavailableCount} {unavailableCount === 1 ? "canal sem dado" : "canais sem dado"}
        </span>
      ) : data.warningsChecked && data.warningCount > 0 ? (
        <span className="tabular-nums">
          {data.warningCount} {data.warningCount === 1 ? "aviso" : "avisos"} no dado
        </span>
      ) : data.warningsChecked && allAvailable ? (
        "Dado ok"
      ) : (
        "Dado não verificado"
      )}
    </button>
  );
}
