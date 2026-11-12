"use client";

import { useEffect, useState } from "react";

import { buscarExpedicao } from "@/lib/expedicao-demo";
import { urlPace, type CanalPace, type RespostaPace } from "@/lib/expedicao-pace";

/**
 * Despachados/dia (2 dias uteis) do canal, todas as marcas numa chamada. Falha
 * ou canal desligado = `null`: as colunas mostram "—", a tela nao quebra.
 */
export function usePaceDespachados(api: string, canal: CanalPace, ligada: boolean): RespostaPace | null {
  const [resposta, setResposta] = useState<{ canal: CanalPace; r: RespostaPace } | null>(null);

  useEffect(() => {
    if (!ligada) return;
    let vivo = true;
    buscarExpedicao(urlPace(api, canal), { headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) throw new Error("http");
        return (await r.json()) as RespostaPace;
      })
      .then((json) => vivo && setResposta({ canal, r: json }))
      .catch(() => vivo && setResposta(null));
    return () => {
      vivo = false;
    };
  }, [api, canal, ligada]);

  // Resposta de outro canal nunca aparece (troca Shopee -> ML).
  return resposta && resposta.canal === canal ? resposta.r : null;
}
