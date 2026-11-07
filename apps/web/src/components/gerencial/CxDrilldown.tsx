"use client";

/**
 * Detalhe de um tile da secao CX · Shopee (GERENCIAL-CX v4), dentro do
 * dialogo UNICO da Gerencial (`KpiDrilldownDialog`), com as mesmas pecas dos
 * outros detalhes: contexto em selos, secao "Por marca" com barras e a saida
 * para a aba completa.
 *
 * Marcas da pior para a melhor no sentido do indicador (na taxa de resposta,
 * a menor primeiro). Marca sem medida vem no fim com "—" e o motivo.
 * Tudo derivado do payload ja' carregado: zero fetch novo.
 */
import DrilldownContextLine from "@/components/drilldown/DrilldownContextLine";
import DrilldownCta from "@/components/drilldown/DrilldownCta";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import { linhasDrilldownCx, pctCx, type IndicadorCx, type ResumoCx } from "@/lib/cx";

/** Valor grande do topo: o mesmo do tile. */
function valorDoTile(r: ResumoCx, i: IndicadorCx): string {
  if (i === "contactRate") return r.contactRate;
  if (i === "resposta") return r.resposta;
  if (i === "cancelamento") return r.cancelamento;
  return r.reembolsoPct ?? "—";
}

export default function CxDrilldownContent({
  indicador,
  resumo: r,
  notas,
  geradoEm,
  cxHref,
}: {
  indicador: IndicadorCx;
  resumo: ResumoCx;
  /** Ressalvas do tile (as mesmas do ⓘ), uma por linha. */
  notas: string[];
  geradoEm: string | null;
  cxHref: string;
}) {
  const linhas = linhasDrilldownCx(r, indicador);
  const mediana = r.medianas[indicador];
  const medidas = linhas.filter((l) => l.motivo == null).length;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
          <span className="text-[32px] font-bold leading-none tracking-tight tabular-nums text-ink">
            {valorDoTile(r, indicador)}
          </span>
          {indicador === "reembolso" && r.reembolsado !== "—" && (
            <span className="pb-0.5 text-sm font-semibold tabular-nums text-ink-muted">{r.reembolsado}</span>
          )}
          {indicador === "cancelamento" && r.cancelamentoDelta && (
            <span className="pb-0.5 text-sm text-ink-muted">{r.cancelamentoDelta.texto} vs 30 dias antes</span>
          )}
        </div>
        <DrilldownContextLine leading="Shopee" periodLabel="Últimos 30 dias até ontem" refreshedAt={geradoEm} />
        <p className="text-xs text-ink-muted">
          Mediana das marcas: <span className="font-semibold tabular-nums text-ink">{mediana == null ? "—" : pctCx(mediana)}</span>
          {mediana == null && " (menos de 3 marcas medidas)"}
        </p>
      </div>

      <DrilldownSecao titulo="Por marca" acao={<span className="tabular-nums">{medidas}</span>}>
        <ul className="flex flex-col">
          {linhas.map((l) =>
            l.motivo ? (
              <EvidenceRow key={l.chave} label={l.marca} value="—" tone="muted" mutedLabel reference={l.motivo} />
            ) : (
              <EvidenceRow
                key={l.chave}
                label={l.marca}
                value={l.antes ? `${l.valor} · antes ${l.antes}` : l.valor}
                pct={l.largura}
                barra={l.fora ? "bg-crit" : "bg-accent"}
                title={l.fora ? "Fora da curva (regra no ⓘ da linha Atenção)" : undefined}
                reference={l.detalhe}
              />
            ),
          )}
        </ul>
      </DrilldownSecao>

      {notas.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line pt-3 text-xs text-ink-faint">
          {notas.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <DrilldownCta href={cxHref}>Abrir CX completo →</DrilldownCta>
    </div>
  );
}
