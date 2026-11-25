"use client";

/**
 * BLACK-HORA — Black Friday (27/11) hora a hora (pedido da Nath, 24/11).
 *
 * Esqueleto da Gerencial: herói (realizado x meta até a última hora fechada),
 * faixa de KPIs (projeção, meta do dia, última hora de cada canal), gráfico do
 * acumulado, tabela hora a hora e o quadro marca × canal. Filtros de marca e
 * canal valem para a página toda. Sem TikTok: a meta não tem.
 * Regras em `src/lib/black-hora.ts`.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Aba from "@/components/layout/Aba";
import BrandFilter from "@/components/BrandFilter";
import Heroi from "@/components/ui/Heroi";
import InfoDica from "@/components/ui/InfoDica";
import Panel from "@/components/ui/Panel";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import Segmented from "@/components/ui/Segmented";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { brandLabel } from "@/lib/filters/brands";
import { fmtBrlCurto } from "@/lib/formatters";
import { torreFetch } from "@/lib/torre-fetch";
import {
  filtrarBlack, horaAHora, NOME_CANAL_BLACK, quadroMarcaCanal, resumoBlack, intervaloHora, rotuloHora, tomDesvio, ultimaHoraDoCanal,
  type CanalBlack, type FiltroCanalBlack, type RespostaBlack,
} from "@/lib/black-hora";

const Grafico = dynamic(() => import("./BlackGrafico"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse rounded-lg bg-raised motion-reduce:animate-none" />,
});

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const DIA_DA_BLACK = "2026-11-27";
/** No dia, o dado anda de hora em hora: relê a cada 5 min. */
const RELER_MS = 5 * 60_000;
const hojeBrt = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`);
const reais = (v: number | null) => (v === null ? "—" : fmtBrlCurto(v));
const TINTA = { ok: "text-ok-ink", warn: "text-warn-ink", crit: "text-crit-ink" } as const;
const FUNDO = { ok: "bg-ok-soft", warn: "bg-warn-soft", crit: "bg-crit-soft" } as const;
const TOM_HEROI = { ok: "bom", warn: "atencao", crit: "critico", neutro: "neutro" } as const;
const TOTAL = "__total";
const PONTO: Record<CanalBlack, string> = { shopee: "bg-canal-shopee", ml: "bg-canal-ml" };
const MARCAS_BLACK = ["apice", "barbours", "kokeshi", "lescent", "rituaria"];
const DICA_META =
  "Meta da planilha 'Meta diária Marketplace — nov/26', aba 'Meta hora Black' (sem TikTok). " +
  "Cada canal compara com a meta até a sua última hora fechada. Realizado: vendas pagas por hora.";

export default function BlackClient() {
  const [dia, setDia] = useState(hojeBrt);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [canal, setCanal] = useState<FiltroCanalBlack>("todos");
  const [dados, setDados] = useState<RespostaBlack | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lidoEm, setLidoEm] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    const ler = () =>
      torreFetch(`${API_URL}/api/v1/performance/black-hora?dia=${dia}`, { signal: ctrl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error("A API da Black não respondeu.");
          setDados((await r.json()) as RespostaBlack);
          setErro(null);
          setLidoEm(new Date().toISOString());
        })
        .catch((e) => { if (!ctrl.signal.aborted) setErro(e instanceof Error ? e.message : "Falha ao carregar."); });
    void ler();
    const t = setInterval(ler, RELER_MS);
    return () => { ctrl.abort(); clearInterval(t); };
  }, [dia, tentativa]);

  const linhas = useMemo(() => (dados ? filtrarBlack(dados.linhas, marcas, canal) : []), [dados, marcas, canal]);
  const r = useMemo(() => resumoBlack(linhas), [linhas]);
  const horas = useMemo(() => horaAHora(linhas), [linhas]);
  const quadro = useMemo(() => quadroMarcaCanal(linhas), [linhas]);
  const tom = tomDesvio(r.pct);
  // A tabela e' longa: abre rolada ate' a ultima hora fechada (destacada).
  const rolagemHoras = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const caixa = rolagemHoras.current;
    const linha = caixa?.querySelector<HTMLElement>('tr[aria-current="true"]');
    if (caixa && linha) caixa.scrollTop = Math.max(0, linha.offsetTop - caixa.clientHeight / 2);
  }, [r.ultimaHora, dados]);

  const filtros = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <BrandFilter variante="menu" rotulo="Marca" opcoes={MARCAS_BLACK.map((m) => ({ value: m, label: brandLabel(m) }))} value={marcas} onChange={setMarcas} />
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        Dia
        <input
          type="date"
          value={dia}
          onChange={(e) => e.target.value && setDia(e.target.value)}
          className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </label>
      {dia !== DIA_DA_BLACK && (
        <button type="button" onClick={() => setDia(DIA_DA_BLACK)} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
          Ir para 27/11
        </button>
      )}
    </div>
  );
  const direita = (
    <Segmented
      rotulo="Canal"
      opcoes={[{ valor: "todos", texto: "Todos" }, { valor: "shopee", texto: "Shopee" }, { valor: "ml", texto: "Mercado Livre" }]}
      valor={canal}
      aoEscolher={(c) => setCanal(c as FiltroCanalBlack)}
      className="whitespace-nowrap"
    />
  );
  const selo = <SeloAtualizado em={lidoEm} carregando={!dados && !erro} detalhe={dados?.meta.fonte} />;

  if (erro && !dados) {
    return (
      <Aba titulo="Black Friday" selo={selo} filtros={filtros} direita={direita}>
        <StateBlock tipo="erro" titulo="Sem dado agora" descricao={erro} acao={<RetryButton onClick={recarregar} />} />
      </Aba>
    );
  }
  if (!dados) {
    return (
      <Aba titulo="Black Friday" selo={selo} filtros={filtros} direita={direita}>
        <StateBlock tipo="carregando" titulo="Carregando" />
      </Aba>
    );
  }
  if (!dados.disponivel) {
    return (
      <Aba titulo="Black Friday" selo={selo} filtros={filtros} direita={direita}>
        <StateBlock tipo="indisponivel" titulo="Vendas por hora indisponíveis" descricao={dados.motivo ?? undefined} />
      </Aba>
    );
  }

  const ate = r.ultimaHora >= 0 ? rotuloHora(r.ultimaHora + 1) : null;
  const canais = (["shopee", "ml"] as CanalBlack[]).filter((c) => canal === "todos" || c === canal);
  const pctProj = r.projecao !== null && r.metaDia ? r.projecao / r.metaDia : null;
  const tProj = tomDesvio(pctProj);

  return (
    <Aba
      titulo="Black Friday"
      selo={selo}
      filtros={filtros}
      direita={direita}
      atencao={!dados.meta.disponivel ? (
        <p role="status" className="inline-flex items-center gap-1 text-sm text-warn-ink">Meta indisponível<InfoDica texto={dados.meta.motivo ?? "A planilha da meta não respondeu."} /></p>
      ) : undefined}
      faixa={
        <Heroi
          rotulo={ate ? `% da meta até ${ate}` : "% da meta"}
          ajuda={<InfoDica emControle texto={DICA_META} />}
          valor={r.pct !== null ? pct(r.pct) : fmtBrlCurto(r.realizado)}
          tom={TOM_HEROI[tom ?? "neutro"]}
          contexto={
            <span className="text-sm">
              <span className="font-semibold text-ink">{fmtBrlCurto(r.realizado)}</span>
              {r.metaAteAgora !== null && <span className="text-ink-muted"> de {reais(r.metaAteAgora)}</span>}
            </span>
          }
          meio={
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {canais.map((c) => {
                const rc = resumoBlack(linhas.filter((l) => l.canal === c));
                const tc = tomDesvio(rc.pct);
                const u = ultimaHoraDoCanal(linhas, c);
                const tu = u?.meta ? tomDesvio(u.realizado / u.meta) : null;
                return (
                  <div key={c} className="min-w-0 rounded-lg bg-raised/60 px-3 py-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${PONTO[c]}`} />{NOME_CANAL_BLACK[c]}
                    </p>
                    <p className={`mt-0.5 text-xl font-bold tabular-nums ${tc ? TINTA[tc] : "text-ink"}`}>{rc.pct !== null ? pct(rc.pct) : fmtBrlCurto(rc.realizado)}</p>
                    <p className="truncate text-xs tabular-nums text-ink-muted">{fmtBrlCurto(rc.realizado)}{rc.metaAteAgora !== null && ` de ${reais(rc.metaAteAgora)}`}</p>
                    {u && u.meta !== null && (
                      <p className="mt-0.5 text-xs tabular-nums text-ink-faint">
                        {intervaloHora(u.hora)} <span className={`font-semibold ${tu ? TINTA[tu] : ""}`}>{pct(u.realizado / u.meta)}</span>
                      </p>
                    )}
                  </div>
                );
              })}
              <div className="min-w-0 rounded-lg bg-raised/60 px-3 py-2">
                <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Projeção<InfoDica texto="No ritmo da curva da meta: realizado ÷ a parte da meta que já devia ter saído." />
                </p>
                <p className={`mt-0.5 text-xl font-bold tabular-nums ${tProj ? TINTA[tProj] : "text-ink"}`}>{reais(r.projecao)}</p>
                <p className="truncate text-xs tabular-nums text-ink-muted">de {reais(r.metaDia)}</p>
              </div>
            </div>
          }
        />
      }
    >
      <Panel
        titulo="Acumulado do dia"
        descricao={dia.split("-").reverse().slice(0, 2).join("/")}
        acao={
          <span aria-hidden="true" className="flex items-center gap-3 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-accent" />Realizado</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-ink-faint" />Meta</span>
          </span>
        }
      >
        <div className="h-64 sm:h-80">
          <Grafico horas={horas} ultimaHora={r.ultimaHora} />
        </div>
      </Panel>

      <Panel titulo="Marca × canal" ajuda="% da meta acumulada até a última hora fechada (a mesma conta do topo). Embaixo, o realizado; a meta fica no hover." semPadding>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">% da meta acumulada e realizado por marca e canal</caption>
            <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-3 py-2 text-left sm:px-4">Marca</th>
                {quadro.canais.map((c) => <th key={c} scope="col" className="px-3 py-2 text-right sm:px-4">{NOME_CANAL_BLACK[c]}</th>)}
                {quadro.canais.length > 1 && <th scope="col" className="hidden px-3 py-2 text-right sm:table-cell sm:px-4">Total</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {[...quadro.marcas, TOTAL].map((m) => (
                <tr key={m} className={m === TOTAL ? "border-t-2 border-line-strong bg-raised" : undefined}>
                  <th scope="row" className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink sm:px-4">{m === TOTAL ? "Total" : brandLabel(m)}</th>
                  {[...quadro.canais, ...(quadro.canais.length > 1 ? [TOTAL] : [])].map((c) => {
                    const sel = linhas.filter((l) => (m === TOTAL || l.marca === m) && (c === TOTAL || l.canal === c));
                    // 390: a coluna Total sai (a linha Total fica); a tabela cabe sem rolar.
                    const soLargo = c === TOTAL ? "hidden sm:table-cell" : "";
                    if (!sel.length) return <td key={c} className={`px-3 py-2.5 text-right text-xs text-ink-faint sm:px-4 ${soLargo}`}>—</td>;
                    const x = resumoBlack(sel);
                    const t = tomDesvio(x.pct);
                    const dica = `${fmtBrlCurto(x.realizado)} de ${reais(x.metaAteAgora)} até ${ate ?? "agora"} · meta do dia ${reais(x.metaDia)}`;
                    return (
                      <td key={c} className={`px-3 py-2.5 text-right sm:px-4 ${soLargo}`} title={dica}>
                        <span className={`block font-semibold ${t ? TINTA[t] : "text-ink"}`}>{x.pct !== null ? pct(x.pct) : "—"}</span>
                        <span className="block whitespace-nowrap text-xs text-ink-muted">{fmtBrlCurto(x.realizado)}</span>
                        <span className="sr-only"> ({dica})</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel titulo="Hora a hora" ajuda="Cor e diferença de cada hora: realizado contra a meta daquela hora. Acum.: desde 00h." semPadding>
        <div ref={rolagemHoras} className="relative max-h-[28rem] overflow-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Meta, realizado, diferença e % acumulado por hora</caption>
            <thead className="sticky top-0 z-10 bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-3 py-2 text-left sm:px-4">Hora</th>
                <th scope="col" className="px-2 py-2 text-right">Meta</th>
                <th scope="col" className="px-2 py-2 text-right">Realizado</th>
                <th scope="col" className="hidden px-2 py-2 text-right sm:table-cell">Diferença</th>
                <th scope="col" className="px-3 py-2 text-right sm:px-4">Acum.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line whitespace-nowrap tabular-nums">
              {horas.map((h) => {
                const th = h.meta && h.realizado !== null ? tomDesvio(h.realizado / h.meta) : null;
                const ta = tomDesvio(h.pctAcum);
                const atual = h.hora === r.ultimaHora;
                return (
                  <tr key={h.hora} aria-current={atual ? "true" : undefined} className={atual ? "bg-accent-soft/60" : h.realizado === null ? "text-ink-faint" : undefined}>
                    <th scope="row" className="px-3 py-1.5 text-left font-medium sm:px-4">{rotuloHora(h.hora)}</th>
                    <td className="px-2 py-1.5 text-right text-ink-muted">{reais(h.meta)}</td>
                    <td className={`px-2 py-1.5 text-right font-semibold ${th ? TINTA[th] : "text-ink"}`}>{h.realizado === null ? <span className="font-normal text-ink-faint">—</span> : fmtBrlCurto(h.realizado)}</td>
                    <td className={`hidden px-2 py-1.5 text-right sm:table-cell ${th ? TINTA[th] : ""}`}>
                      {h.diferenca === null ? "—" : `${h.diferenca >= 0 ? "+" : "−"}${fmtBrlCurto(Math.abs(h.diferenca))}`}
                    </td>
                    <td className="px-3 py-1 text-right sm:px-4">
                      {ta ? <span className={`rounded-md px-1.5 py-0.5 font-semibold ${FUNDO[ta]} ${TINTA[ta]}`}>{pct(h.pctAcum)}</span> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </Aba>
  );
}
