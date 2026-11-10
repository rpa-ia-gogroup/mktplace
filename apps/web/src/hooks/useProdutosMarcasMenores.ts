"use client";

import { useEffect, useState } from "react";

import { fetchProdutosMarcasMenores } from "@/lib/api-client";
import type { ProdutosMarcas } from "@/lib/marcas-menores";

/**
 * Produtos das marcas menores (itens dos pedidos do Bling). Cada pedido custa uma chamada, entao a API
 * le uma parte por vez e devolve `completo=false`: aqui a consulta se repete a cada 2 s (ate 2 min) e a
 * tabela se completa sozinha. Falha passageira no meio da leitura mantem a tabela parcial. Bloco proprio:
 * nao depende nem atrasa mais nada.
 */
export function useProdutosMarcasMenores(inicio: string | undefined, fim: string | undefined, ativo = true) {
  const [produtos, setProdutos] = useState<ProdutosMarcas | null | undefined>(undefined);
  const [desistiu, setDesistiu] = useState(false);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    setProdutos(undefined);
    setDesistiu(false);
    if (!ativo || !inicio || !fim) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const busca = (n: number) =>
      fetchProdutosMarcasMenores(inicio, fim).then((r) => {
        if (!vivo) return;
        setProdutos((antes) => (r === null && antes ? antes : r));
        if (r?.disponivel && !r.completo) {
          if (n < 60) timer = setTimeout(() => busca(n + 1), 2000);
          else setDesistiu(true);
        }
      });
    busca(0);
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
    };
  }, [inicio, fim, ativo, recarga]);

  return { produtos, desistiu, tentar: () => setRecarga((n) => n + 1) };
}
