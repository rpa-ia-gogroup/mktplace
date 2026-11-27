"use client";

/**
 * Marcas menores (Denavita, Yenzah, Auá, By Samia) — fonte: API do Bling v3. A
 * Denavita entra provisoriamente pelo TikTok via Data Mart (gold.tiktok_brand_daily);
 * a Shopee e os itens dela seguem pendentes (conta do Bling sem autorização). Só ML,
 * Shopee e TikTok. Fica SEPARADA: não entra no GMV total, na meta nem na rosca
 * da Gerencial, e não tem meta.
 */
import { useEffect, useMemo, useState } from "react";
import { Layers } from "lucide-react";

import BrandFilter from "@/components/BrandFilter";
import DateRangeFilter from "@/components/DateRangeFilter";
import Aba from "@/components/layout/Aba";
import Chip from "@/components/ui/Chip";
import InfoDica from "@/components/ui/InfoDica";
import { EsqueletoMarcasMenores, Marcas, Produtos, Topo } from "@/components/marcas-menores/Blocos";
import Segmented from "@/components/ui/Segmented";
import StateBlock from "@/components/ui/StateBlock";
import { filtrarMarcasMenores } from "@/lib/gerencial/marcas-menores-gerencial";
import { useGlobalFilters } from "@/hooks/useGlobalFilters";
import { fetchMarcasMenores } from "@/lib/api-client";
import { useProdutosMarcasMenores } from "@/hooks/useProdutosMarcasMenores";
import { fmtPeriodo } from "@/lib/filters/format";
import { toISODate } from "@/lib/filters/presets";
import type { MarcasMenores } from "@/lib/marcas-menores";

const FONTE =
  "Fonte: API do Bling (conta da Rituária), em tempo quase real: o dia de hoje conta. A marca vem do canal do pedido, só Shopee e TikTok; nenhuma tem Mercado Livre. Receita = total do pedido (produtos − descontos + frete), sem cancelados. A Denavita entra provisoriamente pelo TikTok via Data Mart (gold.tiktok_brand_daily; o GMV dessa fonte tem definição própria, 1,4% a 3,9% acima do mart da Torre): a Shopee e os itens dela seguem pendentes, porque a conta dela no Bling ainda não foi autorizada, e o total fica parcial. Estas marcas ficam fora do GMV total, da meta e da rosca da Gerencial e não têm meta.";

export default function MarcasMenoresPage() {
  const [filters, setFilters] = useGlobalFilters({ defaultPreset: "7d", defaultCompare: false });
  const [dados, setDados] = useState<MarcasMenores | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  useEffect(() => {
    let vivo = true;
    setEstado("carregando");
    fetchMarcasMenores(filters.dateFrom, filters.dateTo).then((d) => {
      if (!vivo) return;
      setDados(d);
      setEstado(d ? "ok" : "erro");
    });
    return () => {
      vivo = false;
    };
  }, [filters.dateFrom, filters.dateTo]);
  // Filtros da propria aba (pedido da Nath, 18/11): marca e canal; vazio/"todos" = sem recorte.
  const [marcasSel, setMarcasSel] = useState<string[]>([]);
  const [canal, setCanal] = useState<"todos" | "shopee" | "tiktok">("todos");
  const recortado = marcasSel.length > 0 || canal !== "todos";
  const vista = useMemo(() => {
    if (!dados?.disponivel || !recortado) return dados;
    const ids = marcasSel.length ? marcasSel : dados.marcas.map((m) => m.id);
    return filtrarMarcasMenores(dados, ids, canal === "todos" ? ["ml", "shopee", "tiktok"] : [canal], { comProvisoria: true });
  }, [dados, marcasSel, canal, recortado]);
  // Os produtos pedem JUNTO com as marcas (a API recorta o futuro) e falham sozinhos: nada espera nada.
  const { produtos, desistiu, tentar } = useProdutosMarcasMenores(filters.dateFrom, filters.dateTo, true, {
    canais: canal === "todos" ? [] : [canal],
    marcas: marcasSel,
  });

  // O dia de hoje ainda está andando: comparar com o período anterior inteiro enganaria. Sem variação.
  const emAndamento = !!dados?.periodo && dados.periodo.fim >= toISODate(new Date());
  const periodo = dados?.periodo ? fmtPeriodo(dados.periodo.inicio, dados.periodo.fim) : fmtPeriodo(filters.dateFrom, filters.dateTo);
  return (
    <Aba
      titulo="Demais marcas"
      selo={
          <>
            <Chip>{periodo}</Chip>
            <InfoDica texto={FONTE} />
          </>
        }
      filtros={
          <div className="flex min-w-0 flex-wrap items-center gap-2">
          <BrandFilter
            variante="menu"
            rotulo="Marca"
            opcoes={(dados?.marcas ?? []).map((m) => ({ value: m.id, label: m.label }))}
            value={marcasSel}
            onChange={setMarcasSel}
          />
          <Segmented
            rotulo="Canal"
            opcoes={[{ valor: "todos", texto: "Todos" }, { valor: "shopee", texto: "Shopee" }, { valor: "tiktok", texto: "TikTok" }]}
            valor={canal}
            aoEscolher={(v) => setCanal(v as typeof canal)}
          />
          <DateRangeFilter
            dateFrom={filters.dateFrom}
            dateTo={filters.dateTo}
            periodo={filters.periodo}
            compare={false}
            onChange={(v) => setFilters(v)}
            variante="menu"
            onCompareChange={() => {}}
            hideCompare
          />
          </div>
        }
    >
      {estado === "carregando" ? (
        <EsqueletoMarcasMenores />
      ) : estado === "erro" || !dados || !vista ? (
        <StateBlock tipo="erro" titulo="Não foi possível contatar a API" />
      ) : !dados.disponivel ? (
        <StateBlock tipo="indisponivel" titulo="Demais marcas indisponíveis" descricao={dados.motivo ?? undefined} />
      ) : (
        <>
          {vista.consolidado && <Topo c={vista.consolidado} marcas={vista.marcas} emAndamento={emAndamento} />}
          <Marcas marcas={vista.marcas} emAndamento={emAndamento} />
          <Produtos r={produtos} desistiu={desistiu} onTentar={tentar} ids={marcasSel.length ? marcasSel : undefined} />
        </>
      )}
    </Aba>
  );
}
