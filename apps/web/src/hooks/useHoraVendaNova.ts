"use client";
import { useEffect, useState } from "react";

import { comHoraDoDadoNovo } from "@/lib/black-tv";
import type { ChannelSeries } from "@/lib/gerencial/trend-series";

/**
 * Hora da última VENDA NOVA por canal (o GMV do canal no período subiu desde a leitura anterior).
 * Carga sem venda nova mantém a hora; sem leitura anterior o canal fica sem hora. Guardado no navegador
 * por canal + período. Mesma regra da TV (pedido 27/11: "última att só conta se entrou venda nova").
 */
export function useHoraVendaNova(series: readonly ChannelSeries[]): Record<string, string | null> {
  const [horas, setHoras] = useState<Record<string, string | null>>({});
  const assinatura = series.map((s) => `${s.channel}:${s.refreshedAt ?? ""}:${s.points.reduce((t, p) => t + p.gmv, 0)}`).join("|");
  useEffect(() => {
    const out: Record<string, string | null> = {};
    for (const s of series) {
      if (!s.refreshedAt || !s.points.length) continue;
      const gmv = s.points.reduce((t, p) => t + p.gmv, 0);
      const chave = `torre-venda-nova-${s.channel}-${s.points[0].date}-${s.points[s.points.length - 1].date}`;
      let ant: { gmv: number | null; ate: string | null; vendaNova?: string | null } | undefined;
      try { ant = JSON.parse(localStorage.getItem(chave) ?? "null") ?? undefined; } catch { /* sem histórico */ }
      const r = comHoraDoDadoNovo(ant, { gmv, ate: s.refreshedAt as string | null, vendaNova: null as string | null });
      try { localStorage.setItem(chave, JSON.stringify({ gmv, ate: r.ate, vendaNova: r.vendaNova ?? null })); } catch { /* ok */ }
      out[s.channel] = r.vendaNova ?? null;
    }
    setHoras(out);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `assinatura` resume as séries
  }, [assinatura]);
  return horas;
}
