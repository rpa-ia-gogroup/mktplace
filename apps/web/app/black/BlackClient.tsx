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
import { Clock, Target, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import Aba from "@/components/layout/Aba";
import BrandFilter from "@/components/BrandFilter";
import CartaoIndicador, { type TomPilula } from "@/components/ui/CartaoIndicador";
import Heroi, { type TomSelo } from "@/components/ui/Heroi";
import InfoDica from "@/components/ui/InfoDica";
import Panel from "@/components/ui/Panel";
import SeloAtualizado from "@/components/ui/SeloAtualizado";
import Segmented from "@/components/ui/Segmented";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { brandLabel } from "@/lib/filters/brands";
import { fmtBrlCurto } from "@/lib/formatters";
import { torreFetch } from "@/lib/torre-fetch";
import {
  filtrarBlack, horaAHora, NOME_CANAL_BLACK, quadroMarcaCanal, resumoBlack, rotuloHora, tomDesvio, ultimaHoraDoCanal,
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
const SELO: Record<"ok" | "warn" | "crit", TomSelo> = { ok: "ok", warn: "atencao", crit: "critico" };
const PILULA: Record<"ok" | "warn" | "crit", TomPilula> = { ok: "ok", warn: "warn", crit: "crit" };
const MARCAS_BLACK = ["apice", "barbours", "kokeshi", "lescent", "rituaria"];
const DICA_META =
  "Meta da planilha 'Meta diária Marketplace — nov/26', aba 'Meta hora Black' (definida pela Nath; sem TikTok). " +
  "Cada canal compara com a meta até a SUA última hora fechada. Realizado: vendas pagas por hora (o mesmo do Hoje da Gerencial).";

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

  const filtros = (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <BrandFilter variante="menu" opcoes={MARCAS_BLACK.map((m) => ({ value: m, label: brandLabel(m) }))} value={marcas} onChange={setMarcas} />
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
      opcoes={[{ valor: "todos", texto: "Todos" }, { valor: "shopee", texto: "Shopee" }, { valor: "ml", texto: "Meli" }]}
      valor={canal}
      aoEscolher={(c) => setCanal(c as FiltroCanalBlack)}
      className="whitespace-nowrap"
    />
  );
  const selo = <SeloAtualizado em={lidoEm} carregando={!dados && !erro} detalhe={dados?.meta.fonte} />;

  if (erro && !dados) {
    return (
      <Aba titulo="Black Friday" selo={selo} filtros={filtros} direita={direita}>
        <StateBlock tipo="erro" titulo="Black Friday sem dado agora" descricao={erro} acao={<RetryButton onClick={recarregar} />} />
      </Aba>
    );
  }
  if (!dados) {
    return (
      <Aba titulo="Black Friday" selo={selo} filtros={filtros} direita={direita}>
        <StateBlock tipo="carregando" titulo="Carregando a meta e as vendas por hora" />
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

  return (
    <Aba
      titulo="Black Friday"
      selo={selo}
      filtros={filtros}
      direita={direita}
      atencao={!dados.meta.disponivel ? <p role="status" className="text-sm text-warn-ink">{dados.meta.motivo ?? "Meta indisponível agora."} O realizado segue na tela.</p> : undefined}
      faixa={
        <>
          <Heroi
            rotulo={`Realizado até ${ate ?? "a 1ª hora fechada"} x meta`}
            ajuda={<InfoDica emControle texto={DICA_META} />}
            valor={fmtBrlCurto(r.realizado)}
            tom={tom === "ok" ? "bom" : tom === "warn" ? "atencao" : tom === "crit" ? "critico" : "neutro"}
            contexto={r.metaAteAgora !== null ? <>{pct(r.pct)} da meta acumulada ({reais(r.metaAteAgora)})</> : "sem meta para comparar"}
            selo={tom ? { texto: tom === "ok" ? "No ritmo" : tom === "warn" ? "Perto da meta" : "Abaixo da meta", tom: SELO[tom] } : undefined}
          />
          <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
            <CartaoIndicador
              rotulo="Projeção do dia"
              icone={TrendingUp}
              cor="rgb(var(--tc-kpi-gmv))"
              valor={r.projecao === null ? null : fmtBrlCurto(r.projecao)}
              pilula={r.projecao !== null && r.metaDia ? { texto: pct(r.projecao / r.metaDia), tom: PILULA[tomDesvio(r.projecao / r.metaDia)!] } : null}
              legenda={r.projecao === null ? "sem hora fechada ou sem meta" : "no ritmo da curva da meta"}
              ajuda={<InfoDica emControle texto="Realizado até agora ÷ fração da meta que já devia ter saído pela curva hora a hora da planilha." />}
            />
            <CartaoIndicador
              rotulo="Meta do dia"
              icone={Target}
              cor="rgb(var(--tc-kpi-ticket))"
              valor={r.metaDia === null ? null : fmtBrlCurto(r.metaDia)}
              legenda={r.metaDia === null ? "meta indisponível" : `falta ${reais(Math.max(0, r.metaDia - r.realizado))}`}
            />
            {(["shopee", "ml"] as CanalBlack[]).map((c) => {
              const u = canais.includes(c) ? ultimaHoraDoCanal(linhas, c) : null;
              const t = u && u.meta ? tomDesvio(u.realizado / u.meta) : null;
              return (
                <CartaoIndicador
                  key={c}
                  rotulo={`Última hora · ${NOME_CANAL_BLACK[c]}`}
                  icone={Clock}
                  cor={`rgb(var(--tc-canal-${c}))`}
                  valor={u ? fmtBrlCurto(u.realizado) : null}
                  pilula={t && u?.meta ? { texto: pct(u.realizado / u.meta), tom: PILULA[t] } : null}
                  legenda={!canais.includes(c) ? "fora do filtro" : u ? `${rotuloHora(u.hora)} · meta ${reais(u.meta)}` : "nenhuma hora fechada"}
                />
              );
            })}
          </div>
        </>
      }
    >
      <Panel titulo="Acumulado do dia: realizado x meta" descricao={`${dia.split("-").reverse().join("/")} · por hora`}>
        <div className="h-64 sm:h-72">
          <Grafico horas={horas} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Panel titulo="Hora a hora" className="xl:col-span-7" semPadding>
          <div className="relative max-h-[32rem] overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Meta, realizado, diferença e % acumulado por hora</caption>
              <thead className="sticky top-0 bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left sm:px-4">Hora</th>
                  <th scope="col" className="px-2 py-2 text-right">Meta</th>
                  <th scope="col" className="px-2 py-2 text-right">Realizado</th>
                  <th scope="col" className="px-2 py-2 text-right">Diferença</th>
                  <th scope="col" className="px-3 py-2 text-right sm:px-4">% acum.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line tabular-nums">
                {horas.map((h) => {
                  const t = tomDesvio(h.pctAcum);
                  return (
                    <tr key={h.hora} className={h.realizado === null ? "text-ink-faint" : undefined}>
                      <th scope="row" className="px-3 py-1.5 text-left font-medium sm:px-4">{rotuloHora(h.hora)}</th>
                      <td className="px-2 py-1.5 text-right">{reais(h.meta)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold text-ink">{h.realizado === null ? <span className="font-normal text-ink-faint" title="hora ainda não fechada">—</span> : fmtBrlCurto(h.realizado)}</td>
                      <td className={`px-2 py-1.5 text-right ${h.diferenca === null ? "" : h.diferenca >= 0 ? "text-ok-ink" : "text-crit-ink"}`}>
                        {h.diferenca === null ? "—" : `${h.diferenca >= 0 ? "+" : "−"}${fmtBrlCurto(Math.abs(h.diferenca))}`}
                      </td>
                      <td className="px-3 py-1 text-right sm:px-4">
                        {t ? <span className={`rounded-md px-1.5 py-0.5 font-semibold ${FUNDO[t]} ${TINTA[t]}`}>{pct(h.pctAcum)}</span> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel titulo="Marca × canal" descricao="Realizado até agora, meta do dia e % do dia; a cor é o ritmo até a última hora fechada" className="xl:col-span-5 xl:self-start" semPadding>
          <table className="w-full text-sm">
            <caption className="sr-only">Meta do dia, realizado e % por marca e canal</caption>
            <thead className="bg-raised text-xs font-semibold uppercase tracking-wide text-ink-faint">
              <tr>
                <th scope="col" className="px-3 py-2 text-left sm:px-4">Marca</th>
                {quadro.canais.map((c) => <th key={c} scope="col" className="px-3 py-2 text-right sm:px-4">{NOME_CANAL_BLACK[c]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {quadro.marcas.map((m) => (
                <tr key={m}>
                  <th scope="row" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink sm:px-4">{brandLabel(m)}</th>
                  {quadro.canais.map((c) => {
                    const x = quadro.celula(m, c);
                    if (!x) return <td key={c} className="px-3 py-2 text-right text-xs text-ink-faint sm:px-4">sem meta</td>;
                    const t = tomDesvio(x.ritmo);
                    return (
                      <td key={c} className="px-3 py-2 text-right sm:px-4">
                        <span className="block font-semibold text-ink">{fmtBrlCurto(x.realizado)}</span>
                        <span className="block text-xs text-ink-muted">
                          de {reais(x.metaDia)}{x.pct !== null && <> · <span className={t ? TINTA[t] : undefined}>{pct(x.pct)}</span></>}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </Aba>
  );
}
