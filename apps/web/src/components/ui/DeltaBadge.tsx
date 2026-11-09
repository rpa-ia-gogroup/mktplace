import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import type { DeltaTone } from "@/lib/gerencial/kpi-band";
import { fmtPctBr } from "@/lib/formatters";

/**
 * Pilula de variacao do card de KPI (extraida da KpiBand da Gerencial, mesmo
 * markup). ↗/↘ em verde ou vermelho conforme o `tone`; `neutral` mostra a
 * variacao sem cor de juizo (gastar mais nao e' bom nem ruim por si).
 *
 * `unidade="pp"` escreve pontos percentuais ("+0,6 p.p.") para variacao de
 * uma taxa; o padrao "pct" e' o da Gerencial.
 */
export default function DeltaBadge({
  pct,
  tone = "higher_is_better",
  unidade = "pct",
}: {
  pct: number;
  tone?: DeltaTone;
  unidade?: "pct" | "pp";
}) {
  const up = pct >= 0;
  const Seta = up ? ArrowUpRight : ArrowDownRight;
  const pele =
    tone === "neutral"
      ? "bg-raised text-ink-muted"
      : up !== (tone === "lower_is_better")
        ? "bg-ok-soft text-ok-ink"
        : "bg-crit-soft text-crit-ink";
  return (
    <span
      className={`inline-flex w-fit items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${pele}`}
    >
      <Seta aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.25} />
      {unidade === "pp" ? fmtPctBr(pct).replace("%", " p.p.") : fmtPctBr(pct)}
    </span>
  );
}
