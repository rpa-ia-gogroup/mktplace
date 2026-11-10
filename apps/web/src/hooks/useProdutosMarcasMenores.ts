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
export function useProdutosMarcasMenores(
  inicio: string | undefined,
  fim: string | undefined,
  ativo = true,
  /** Mesmos filtros do GMV: so' estes canais e marcas (vazio = todos). */
  filtro: { canais?: readonly string[]; marcas?: readonly string[] } = {},
) {
  const filtroKey = `${(filtro.canais ?? []).join(",")}|${(filtro.marcas ?? []).join(",")}`;
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
      fetchProdutosMarcasMenores(inicio, fim, filtro).then((r) => {
        if (!vivo) return;
        setProdutos((antes) => (r === null && antes ? antes : r));
        if (r?.disponivel && !r.completo) {
          if (n < 150) timer = setTimeout(() => busca(n + 1), 2000); // a rotina preenche o resto; cada consulta so le o banco
          else setDesistiu(true);
        }
      });
    busca(0);
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filtroKey cobre o conteudo do filtro
  }, [inicio, fim, ativo, recarga, filtroKey]);

  return { produtos, desistiu, tentar: () => setRecarga((n) => n + 1) };
}
