"use client";

/**
 * Clique na barra da "Evolução por dia de vencimento" no Mercado Livre e na
 * Shopee — o mesmo diálogo do TikTok (`PopupColetaPerdida`): total em
 * destaque, por marca, lista paginada (200) e CSV de TODAS as páginas.
 * Os pedidos são os do numerador da LDR do dia, pela mesma regra da taxa.
 */
import { useEffect, useState } from "react";

import KpiDrilldownDialog from "@/components/KpiDrilldownDialog";
import DrilldownSecao from "@/components/drilldown/DrilldownSecao";
import EvidenceRow from "@/components/drilldown/EvidenceRow";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { BotaoCsvCompleto, NavPaginas, baixarCsv } from "@/components/expedicao/TikTokColetaPerdida";
import {
  NOME_CANAL,
  csvDosAtrasados,
  queryAtrasadosDia,
  rotuloStatus,
  type CanalAtrasados,
  type RespostaAtrasadosDia,
} from "@/lib/expedicao-atrasados-dia";
import { buscarExpedicao } from "@/lib/expedicao-demo";
import { formatarInteiro } from "@/lib/expedicao-formato";
import { buscarTodasAsPaginas, diaCurto, faixaDaPagina, instanteCurto } from "@/lib/expedicao-tiktok-abertos";
import { brandLabel } from "@/lib/filters/brands";

const SO_TELA_LARGA = "hidden sm:table-cell";

type Carga =
  | { tipo: "carregando" }
  | { tipo: "erro" }
  | { tipo: "sem_fonte" }
  | { tipo: "ok"; dados: RespostaAtrasadosDia };

async function buscarPagina(api: string, canal: CanalAtrasados, vencimento: string, marca: string | null, pagina: number) {
  const r = await buscarExpedicao(`${api}${queryAtrasadosDia(canal, vencimento, marca, pagina)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as RespostaAtrasadosDia;
}

async function buscarDisponivel(...args: Parameters<typeof buscarPagina>) {
  const dados = await buscarPagina(...args);
  if (dados.availability !== "available") throw new Error("indisponivel");
  return dados;
}

export default function PopupAtrasadosDoDia({
  api,
  canal,
  marca,
  vencimento,
  aoFechar,
}: {
  api: string;
  canal: CanalAtrasados;
  marca: string | null;
  vencimento: string;
  aoFechar: () => void;
}) {
  const [pagina, setPagina] = useState(1);
  const [carga, setCarga] = useState<Carga>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  // A marca começa na da tela; o CSV baixa SÓ o filtrado.
  const [marcaSel, setMarcaSel] = useState<string | null>(marca);
  const [marcas, setMarcas] = useState<string[]>([]);

  useEffect(() => setMarcaSel(marca), [marca]);
  useEffect(() => setPagina(1), [vencimento, marcaSel]);
  useEffect(() => {
    let vivo = true;
    setCarga({ tipo: "carregando" });
    buscarPagina(api, canal, vencimento, marcaSel, pagina)
      .then((dados) => {
        if (!vivo) return;
        // Marca sem fonte no canal: sem lista — "nenhum pedido" afirmaria uma medição que não houve.
        if (dados.availability !== "available") {
          setCarga(dados.unavailable_reason === "brand_without_source" ? { tipo: "sem_fonte" } : { tipo: "erro" });
          return;
        }
        setCarga({ tipo: "ok", dados });
        setMarcas(dados.all_brands);
      })
      .catch(() => vivo && setCarga({ tipo: "erro" }));
    return () => {
      vivo = false;
    };
  }, [api, canal, vencimento, marcaSel, pagina, tentativa]);

  const dados = carga.tipo === "ok" ? carga.dados : null;
  const pedidos = dados?.orders ?? [];
  const total = dados?.list_total ?? 0;
  const variasMarcas = !marcaSel && (dados?.brands.length ?? 0) > 1;
  const titulo = `Atrasados — prazo ${diaCurto(vencimento)} (${NOME_CANAL[canal]})`;

  return (
    <KpiDrilldownDialog open onClose={aoFechar} title={titulo} largura="larga" focusResetKey={vencimento}>
      <div className="flex flex-col gap-4 text-sm" data-testid="exp-atrasados-dia-popup">
        {marcas.length ? (
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            Marca
            <select
              value={marcaSel ?? ""}
              onChange={(e) => setMarcaSel(e.target.value || null)}
              className="min-h-9 rounded-md border border-line bg-raised px-2 text-sm text-ink"
            >
              <option value="">Todas</option>
              {marcas.map((m) => (
                <option key={m} value={m}>
                  {brandLabel(m)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {carga.tipo === "carregando" && !dados ? (
          <StateBlock compacto tipo="carregando" titulo="Carregando pedidos…" />
        ) : carga.tipo === "erro" ? (
          <StateBlock
            compacto
            tipo="erro"
            titulo="Não foi possível carregar os pedidos."
            acao={<RetryButton onClick={() => setTentativa((n) => n + 1)} />}
          />
        ) : carga.tipo === "sem_fonte" ? (
          <StateBlock compacto tipo="vazio" titulo={`Sem lista de pedidos desta marca no ${NOME_CANAL[canal]}.`} />
        ) : dados && total === 0 ? (
          <StateBlock compacto tipo="vazio" titulo={`Nenhum pedido atrasou no prazo de ${diaCurto(vencimento)}.`} />
        ) : dados ? (
          <>
            <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
              <span className="text-[32px] font-bold leading-none tracking-tight tabular-nums text-crit-ink">
                {formatarInteiro(total)}
              </span>
              <span className="pb-0.5 text-xs text-ink-faint">
                {formatarInteiro(total - dados.still_waiting)} coletados com atraso · {formatarInteiro(dados.still_waiting)} ainda
                sem coleta · {marcaSel ? brandLabel(marcaSel) : "todas as marcas"}
              </span>
            </div>
            {variasMarcas ? (
              <DrilldownSecao titulo="Por marca">
                <ul className="flex flex-col">
                  {dados.brands.map((b) => (
                    <EvidenceRow
                      key={b.brand}
                      label={brandLabel(b.brand)}
                      pct={(b.missed / total) * 100}
                      barra="bg-crit"
                      value={`${formatarInteiro(b.missed)} ${b.missed === 1 ? "atrasado" : "atrasados"} · ${formatarInteiro(b.still_waiting)} sem coleta`}
                    />
                  ))}
                </ul>
              </DrilldownSecao>
            ) : null}
            <DrilldownSecao
              titulo="Pedidos"
              acao={
                <>
                  <span className="tabular-nums">{faixaDaPagina(pagina, dados.page_size, pedidos.length, total)}</span>
                  <BotaoCsvCompleto
                    total={total}
                    testId="exp-atrasados-dia-csv"
                    baixar={async (aoAvancar) => {
                      const todos = await buscarTodasAsPaginas(
                        (p) => buscarDisponivel(api, canal, vencimento, marcaSel, p),
                        aoAvancar,
                      );
                      baixarCsv(
                        csvDosAtrasados(canal, todos, vencimento),
                        `${canal}-atrasados-${vencimento}${marcaSel ? `-${marcaSel}` : ""}.csv`,
                      );
                    }}
                  />
                </>
              }
            >
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-line" aria-busy={carga.tipo === "carregando"}>
                <table className="w-full text-sm [&_td]:px-3 [&_td]:py-1.5 [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-1.5">
                  <caption className="sr-only">{titulo}</caption>
                  <thead className="sticky top-0 bg-raised text-left text-xs uppercase tracking-wide text-ink-faint">
                    <tr>
                      <th scope="col">{canal === "mercadolivre" ? "Venda" : "Pedido"}</th>
                      {/* No celular: numero e coleta ("ainda sem coleta" e' o que importa); o dia do prazo esta' no titulo. */}
                      {variasMarcas ? <th scope="col" className={SO_TELA_LARGA}>Marca</th> : null}
                      <th scope="col" className={SO_TELA_LARGA}>Situação hoje</th>
                      <th scope="col" className={SO_TELA_LARGA}>Prazo</th>
                      <th scope="col">Coleta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.map((p, i) => (
                      <tr key={`${p.order_id ?? "sem-numero"}-${i}`} className="border-t border-line">
                        <td className="whitespace-nowrap font-mono text-xs text-ink">{p.order_id ?? "—"}</td>
                        {variasMarcas ? <td className={`whitespace-nowrap text-ink ${SO_TELA_LARGA}`}>{brandLabel(p.brand)}</td> : null}
                        <td className={`whitespace-nowrap text-ink-muted ${SO_TELA_LARGA}`}>{rotuloStatus(canal, p.status)}</td>
                        <td className={`whitespace-nowrap tabular-nums text-ink-muted ${SO_TELA_LARGA}`}>{instanteCurto(p.deadline_at)}</td>
                        <td className={`whitespace-nowrap tabular-nums ${p.collected_at ? "text-warn-ink" : "font-semibold text-crit-ink"}`}>
                          {p.collected_at ? `coletado ${instanteCurto(p.collected_at)}` : "ainda sem coleta"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <NavPaginas
                pagina={pagina}
                total={total}
                tamanho={dados.page_size}
                temMais={dados.has_more}
                ocupado={carga.tipo === "carregando"}
                aoMudar={setPagina}
              />
            </DrilldownSecao>
          </>
        ) : null}
      </div>
    </KpiDrilldownDialog>
  );
}
