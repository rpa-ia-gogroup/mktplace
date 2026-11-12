"use client";

import { useEffect, useState } from "react";

import { buscarExpedicao } from "@/lib/expedicao-demo";
import { urlPace, type CanalPace, type RespostaPace } from "@/lib/expedicao-pace";

/** Espera antes de cada nova tentativa: o Data Mart vai pelo Metabase em fila e falha de vez em quando. */
export const ESPERAS_PACE_MS = [4000, 12000, 30000];

/**
 * Despachados/dia (2 dias uteis) do canal, todas as marcas numa chamada. Falha
 * ou resposta "unavailable" tenta de novo (ESPERAS_PACE_MS); esgotou = `null`:
 * as colunas mostram "—", a tela nao quebra.
 */
export function usePaceDespachados(api: string, canal: CanalPace, ligada: boolean): RespostaPace | null {
  const [resposta, setResposta] = useState<{ canal: CanalPace; r: RespostaPace } | null>(null);

  useEffect(() => {
    if (!ligada) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tentar = (n: number) => {
      buscarExpedicao(urlPace(api, canal), { headers: { Accept: "application/json" } })
        .then(async (r) => {
          if (!r.ok) throw new Error("http");
          const json = (await r.json()) as RespostaPace;
          if (json.availability !== "available") throw new Error(json.availability);
          if (vivo) setResposta({ canal, r: json });
        })
        .catch(() => {
          if (vivo && n < ESPERAS_PACE_MS.length) timer = setTimeout(() => tentar(n + 1), ESPERAS_PACE_MS[n]);
        });
    };
    tentar(0);
    return () => {
      vivo = false;
      clearTimeout(timer);
    };
  }, [api, canal, ligada]);

  // Resposta de outro canal nunca aparece (troca Shopee -> ML).
  return resposta && resposta.canal === canal ? resposta.r : null;
}
