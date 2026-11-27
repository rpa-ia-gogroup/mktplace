"use client";

/**
 * BLACK-TV — a receita de hoje em números grandes, para a TV do time (Nath, 27/11).
 *
 * Fonte: a MESMA do GMV de hoje da Gerencial (fato diária, com a hora em andamento):
 * `overview` de hoje por canal e `brands` de hoje por marca × canal; total = soma
 * dos canais. Meta pela regra da /black (`metaDe`). Ocupa a tela inteira por cima
 * do shell; Esc volta para /black.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { horaMinuto, type RespostaBlack } from "@/lib/black-hora";
import { canalDoOverview, marcasDoBrands, metaDe, type CanalHojeTv, type CanalTv, type MarcaHojeTv, type MarcaTvApi, type OverviewTv } from "@/lib/black-tv";
import { torreFetch } from "@/lib/torre-fetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
/** O dado anda a cada ~30 min; 2 min deixa a TV no máximo 2 min atrás da Torre. */
const RELER_MS = 2 * 60_000;

const CANAIS = {
  tiktok: { nome: "TikTok Shop", curto: "TikTok", cor: "#a78bfa" },
  ml: { nome: "Mercado Livre", curto: "Mercado Livre", cor: "#22d3ee" },
  shopee: { nome: "Shopee", curto: "Shopee", cor: "#fb923c" },
} as const;
const ORDEM_CANAIS = ["tiktok", "shopee", "ml"] as const;
const MARCA: Record<string, string> = {
  apice: "Ápice", barbours: "Barbour's", kokeshi: "Kokeshi", lescent: "Lescent", rituaria: "Rituária",
};

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const centavos = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0);

const tomMeta = (a: number | null) => (a === null ? "text-white/50" : a >= 1 ? "text-[#34d399]" : a >= 0.9 ? "text-[#fbbf24]" : "text-[#fb7185]");
const pct0 = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** Conta do valor anterior ao novo quando o dado chega (sem animação com reduced-motion). */
function useContagem(alvo: number, ms = 1600) {
  const [valor, setValor] = useState(alvo);
  const de = useRef(alvo);
  useEffect(() => {
    const reduzido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const inicio = de.current;
    if (reduzido || inicio === alvo) {
      de.current = alvo;
      setValor(alvo);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const passo = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const suave = 1 - Math.pow(1 - p, 4);
      setValor(inicio + (alvo - inicio) * suave);
      if (p < 1) raf = requestAnimationFrame(passo);
      else de.current = alvo;
    };
    raf = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(raf);
  }, [alvo, ms]);
  return valor;
}

function Relogio() {
  const [agora, setAgora] = useState<Date | null>(null);
  useEffect(() => {
    setAgora(new Date());
    const t = setInterval(() => setAgora(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return <span className="tv-num">{agora ? hhmm(agora) : "--:--"}</span>;
}

function Reais({ valor, className = "" }: { valor: number; className?: string }) {
  return (
    <span className={`tv-num whitespace-nowrap ${className}`}>
      <span className="mr-[0.18em] text-[0.42em] font-semibold align-[0.62em] text-white/55">R$</span>
      {inteiro.format(Math.round(valor))}
    </span>
  );
}

export default function TvClient() {
  const router = useRouter();
  const [dados, setDados] = useState<{ canais: CanalHojeTv[]; marcas: MarcaHojeTv[]; disponivel: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lidoEm, setLidoEm] = useState<Date | null>(null);
  const [black, setBlack] = useState<RespostaBlack | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const lerMeta = () =>
      torreFetch(`${API_URL}/api/v1/performance/black-hora`, { signal: ctrl.signal })
        .then(async (r) => { if (r.ok) setBlack((await r.json()) as RespostaBlack); })
        .catch(() => {}); // sem meta, a TV segue com o realizado
    // O GMV de hoje da Gerencial: overview de hoje por canal + brands de hoje (a mesma fato diária).
    const json = async <T,>(url: string) => {
      const r = await torreFetch(`${API_URL}${url}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error("A Torre não respondeu.");
      return (await r.json()) as T;
    };
    const ler = () => {
      void lerMeta();
      const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
      const dia = `date_from=${hoje}&date_to=${hoje}`;
      const ids: CanalTv[] = ["tiktok", "ml", "shopee"];
      return Promise.all([
        ...ids.map((id) => json<OverviewTv>(`/api/v1/performance/overview?${dia}&marketplace=${id}`)),
        json<{ brands: MarcaTvApi[] }>(`/api/v1/performance/brands?${dia}&marketplace=tiktok,ml,shopee`),
      ])
        .then((rs) => {
          const canais = ids.map((id, i) => canalDoOverview(id, rs[i] as OverviewTv));
          setDados({ canais, marcas: marcasDoBrands((rs[3] as { brands: MarcaTvApi[] }).brands), disponivel: canais.some((x) => x.gmv !== null) });
          setErro(canais.some((x) => x.gmv !== null) ? null : "Vendas de hoje indisponíveis.");
          setLidoEm(new Date());
        })
        .catch((e) => { if (!ctrl.signal.aborted) setErro(e instanceof Error ? e.message : "Falha ao carregar."); });
    };
    void ler();
    const t = setInterval(ler, RELER_MS);
    return () => { ctrl.abort(); clearInterval(t); };
  }, []);

  // TV não pode apagar a tela; Esc volta para a Black.
  useEffect(() => {
    let trava: { release: () => Promise<void> } | null = null;
    const pedir = () => {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      wl?.request("screen").then((l) => { trava = l; }).catch(() => {});
    };
    pedir();
    const visivel = () => { if (document.visibilityState === "visible") pedir(); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.fullscreenElement) router.push("/black"); };
    document.addEventListener("visibilitychange", visivel);
    window.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("visibilitychange", visivel);
      window.removeEventListener("keydown", tecla);
      void trava?.release().catch(() => {});
    };
  }, [router]);

  // Padrão: só Shopee + Mercado Livre (pedido do usuário). `?tiktok=1` inclui o TikTok e fica na URL da TV.
  const [comTiktok, setComTiktok] = useState(false);
  useEffect(() => { setComTiktok(new URLSearchParams(window.location.search).get("tiktok") === "1"); }, []);
  const alternarTiktok = () => {
    const novo = !comTiktok;
    setComTiktok(novo);
    const url = new URL(window.location.href);
    if (novo) url.searchParams.set("tiktok", "1"); else url.searchParams.delete("tiktok");
    window.history.replaceState(null, "", url);
  };
  const visiveis = ORDEM_CANAIS.filter((id) => comTiktok || id !== "tiktok");

  const canais = visiveis.map((id) => {
    const v = dados?.canais.find((c) => c.id === id);
    return { id, ...CANAIS[id], gmv: v?.gmv ?? null, pedidos: v?.pedidos ?? 0, ate: v?.ate ?? null };
  });
  // Total, pedidos e ticket só dos canais visíveis (a soma dos canais é o total da API).
  const total = canais.reduce((s, c) => s + (c.gmv ?? 0), 0);
  const pedidos = canais.reduce((s, c) => s + c.pedidos, 0);
  const ticket = pedidos > 0 ? total / pedidos : null;
  const animado = useContagem(total);
  const parteDaMarca = (m: MarcaHojeTv, id: CanalTv) => m.porCanal[id] ?? 0;
  const marcas = (dados?.marcas ?? [])
    .map((m) => ({ ...m, valor: visiveis.reduce((s, id) => s + parteDaMarca(m, id), 0) }))
    .sort((a, b) => b.valor - a.valor);
  const maiorMarca = marcas[0]?.valor ?? 0;
  const metaTotal = metaDe(black);
  // Última atualização dos dados = o canal visível mais atrasado (todos têm dado até essa hora).
  const fontes = canais
    .map((c) => c.ate)
    .filter((f): f is string => !!f)
    .map((f) => new Date(f).getTime())
    .filter((t) => Number.isFinite(t));
  const dadosAte = fontes.length ? new Date(Math.min(...fontes)) : null;

  // TV fica dias aberta: recarrega a página a cada 30 min para pegar versões novas da tela.
  useEffect(() => {
    const t = setTimeout(() => window.location.reload(), 30 * 60_000);
    return () => clearTimeout(t);
  }, []);

  // Portal no <body>: a moldura do shell cria um bloco de contencao e prenderia o `fixed`.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;

  return createPortal(
    <div className="tv fixed inset-0 z-[70] overflow-hidden text-white" role="main" aria-label="Black Friday — receita de hoje">
      <style>{CSS}</style>
      <div aria-hidden className="tv-fundo" />
      <div aria-hidden className="tv-grade" />
      <div aria-hidden className="tv-grao" />

      <div className="relative flex h-full flex-col px-[3.2vw] pb-[2.4vw] pt-[2.2vw]">
        {/* Topo */}
        <header className="tv-in flex items-center justify-between" style={{ animationDelay: "0ms" }}>
          <div className="flex items-baseline gap-[1.2vw]">
            <span className="tv-marca text-[2.1vw] font-extrabold uppercase tracking-[0.32em]">Black Friday</span>
            <span className="text-[1.05vw] font-medium tracking-[0.18em] text-white/45">27 · 11 · 2026</span>
          </div>
          {dadosAte && (
            <span className="text-[1.15vw] font-medium text-white/60">
              Última atualização dos dados às <span className="tv-num font-bold text-white">{hhmm(dadosAte)}</span>
            </span>
          )}
          <div className="flex items-center gap-[2vw]">
            <button
              type="button"
              onClick={alternarTiktok}
              aria-pressed={comTiktok}
              className={`flex items-center gap-[0.5vw] rounded-full border px-[1vw] py-[0.45vw] text-[0.95vw] font-semibold transition ${comTiktok ? "border-[#a78bfa]/70 bg-[#a78bfa]/15 text-white" : "border-white/15 bg-white/[0.04] text-white/60 hover:border-white/35 hover:text-white"}`}
            >
              <span className="h-[0.6vw] w-[0.6vw] rounded-full" style={{ background: comTiktok ? "#a78bfa" : "transparent", boxShadow: "inset 0 0 0 2px #a78bfa" }} />
              {comTiktok ? "Com TikTok" : "+ TikTok"}
            </button>
            <span className="flex items-center gap-[0.6vw] rounded-full border border-white/15 bg-white/[0.04] px-[1vw] py-[0.45vw] text-[0.95vw] font-semibold uppercase tracking-[0.22em] text-white/80">
              <span className="tv-pulso relative inline-block h-[0.7vw] w-[0.7vw] rounded-full bg-[#f43f5e]" />
              Ao vivo
            </span>
            <span className="text-[2.6vw] font-bold leading-none text-white/90"><Relogio /></span>
          </div>
        </header>

        {erro && !dados ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-[1vw] text-center">
            <p className="text-[2.4vw] font-semibold">Sem dado agora</p>
            <p className="text-[1.2vw] text-white/60">{erro} Tentando de novo a cada 2 minutos.</p>
          </div>
        ) : !dados ? (
          <div className="flex flex-1 items-center justify-center">
            <span className="tv-pulso-lento text-[1.4vw] tracking-[0.3em] text-white/50 uppercase">Carregando</span>
          </div>
        ) : (
          <>
            {/* Herói + canais */}
            <section className="mt-[2vw] grid flex-1 grid-cols-[1.45fr_1fr] items-center gap-[3.5vw]">
              <div className="tv-in" style={{ animationDelay: "120ms" }}>
                <p className="text-[1.15vw] font-semibold uppercase tracking-[0.34em] text-white/55">
                  Receita de hoje <span className="text-white/35">· {canais.map((c) => c.curto).join(" + ")}</span>
                </p>
                <p className="tv-heroi mt-[0.4vw] font-extrabold leading-[0.92] tracking-[-0.035em]">
                  <Reais valor={animado} />
                </p>
                <div className="mt-[2.2vw] flex gap-[3.2vw]">
                  <Mini rotulo="Pedidos" valor={inteiro.format(pedidos)} />
                  <Mini rotulo="Ticket médio" valor={ticket !== null ? `R$ ${centavos.format(ticket)}` : "—"} />
                  <Mini rotulo="Dados até" valor={dadosAte ? horaMinuto(dadosAte.toISOString()) : "—"} />
                </div>
                {metaTotal && (
                  <div className="mt-[2vw] max-w-[44vw]">
                    <div className="flex items-baseline justify-between text-[1.05vw]">
                      <span className="font-semibold uppercase tracking-[0.22em] text-white/50">Meta Black · Shopee + ML</span>
                      <span className="tv-num font-bold text-white/85">R$ {inteiro.format(Math.round(metaTotal.dia / 1000) * 1000)}</span>
                    </div>
                    <div className="relative mt-[0.6vw] h-[0.7vw] overflow-hidden rounded-full bg-white/[0.08]">
                      <div className="tv-barra h-full rounded-full bg-gradient-to-r from-[#7c3aed] via-[#f0abfc] to-[#fb923c]" style={{ width: `${Math.min(100, (metaTotal.doDia ?? 0) * 100)}%` }} />
                    </div>
                    <p className="mt-[0.5vw] text-[1.05vw] text-white/55">
                      <span className="tv-num font-bold text-white/85">{pct0(metaTotal.doDia)}</span> da meta do dia ·{" "}
                      <span className={`tv-num font-bold ${tomMeta(metaTotal.atingido)}`}>{pct0(metaTotal.atingido)}</span> da meta até {metaTotal.rotulo ?? "a última hora fechada"}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-[1.6vw]">
                {canais.map((c, i) => (
                  <div key={c.id} className="tv-in tv-cartao rounded-[1.2vw] px-[1.8vw] py-[1.3vw]" style={{ animationDelay: `${260 + i * 110}ms`, ["--cor" as string]: c.cor }}>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-[0.7vw] text-[1.25vw] font-semibold text-white/85">
                        <span className="h-[0.8vw] w-[0.8vw] rounded-full" style={{ background: c.cor, boxShadow: `0 0 1vw ${c.cor}` }} />
                        {c.nome}
                      </span>
                      <span className="text-[0.95vw] font-medium text-white/45">
                        {c.ate ? `até ${horaMinuto(c.ate)}` : "sem dado"} · {pct(c.gmv ?? 0, total)}%
                      </span>
                    </div>
                    <p className="mt-[0.3vw] text-[3.6vw] font-bold leading-tight tracking-[-0.02em]">
                      {c.gmv === null ? <span className="text-white/40">sem dado</span> : <Reais valor={c.gmv} />}
                    </p>
                    <div className="mt-[0.6vw] h-[0.42vw] overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="tv-barra h-full rounded-full" style={{ width: `${pct(c.gmv ?? 0, total)}%`, background: `linear-gradient(90deg, ${c.cor}55, ${c.cor})` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Marcas */}
            <section className="mt-[2vw]">
              <p className="tv-in mb-[1vw] text-[1vw] font-semibold uppercase tracking-[0.34em] text-white/45" style={{ animationDelay: "600ms" }}>Por marca</p>
              <div className="grid grid-cols-5 gap-[1.2vw]">
                {marcas.map((m, i) => (
                  <div key={m.brand} className="tv-in tv-cartao rounded-[1vw] px-[1.4vw] py-[1.1vw]" style={{ animationDelay: `${680 + i * 80}ms`, ["--cor" as string]: "#c4b5fd" }}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[1.15vw] font-semibold text-white/85">{MARCA[m.brand] ?? m.brand}</span>
                      {(() => {
                        const mm = metaDe(black, m.brand);
                        return mm ? (
                          <span className={`tv-num text-[1vw] font-bold ${tomMeta(mm.atingido)}`} title="Realizado ÷ meta até agora, com a hora em andamento pró-rata (Shopee + ML)">
                            {pct0(mm.atingido)} da meta
                          </span>
                        ) : (
                          <span className="tv-num text-[0.9vw] font-semibold text-white/35">#{i + 1}</span>
                        );
                      })()}
                    </div>
                    <p className="mt-[0.2vw] text-[2.3vw] font-bold leading-tight tracking-[-0.02em]"><Reais valor={m.valor} /></p>
                    {/* Marca x canal: barra empilhada (largura relativa a' maior marca) + valor de cada canal. */}
                    <div className="mt-[0.6vw] h-[0.42vw] overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="tv-barra flex h-full" style={{ width: `${maiorMarca > 0 ? (m.valor / maiorMarca) * 100 : 0}%` }}>
                        {visiveis.map((id) => {
                          const v = parteDaMarca(m, id);
                          return v > 0 ? <div key={id} style={{ width: `${pct(v, m.valor)}%`, background: CANAIS[id].cor }} /> : null;
                        })}
                      </div>
                    </div>
                    <ul className="mt-[0.7vw] space-y-[0.25vw]">
                      {visiveis.map((id) => {
                        const parte = m.porCanal[id];
                        return (
                          <li key={id} className="flex items-center justify-between text-[0.95vw]">
                            <span className="flex items-center gap-[0.45vw] text-white/60">
                              <span className="h-[0.5vw] w-[0.5vw] rounded-full" style={{ background: CANAIS[id].cor }} />
                              {CANAIS[id].curto}
                            </span>
                            <span className="tv-num font-semibold text-white/90">
                              {parte != null ? `R$ ${inteiro.format(Math.round(parte))}` : "—"}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {(() => {
                      const mm = metaDe(black, m.brand);
                      return mm ? (
                        <p className="mt-[0.6vw] flex justify-between border-t border-white/[0.07] pt-[0.5vw] text-[0.9vw] text-white/45">
                          <span>Meta do dia</span>
                          <span className="tv-num font-semibold text-white/70">R$ {inteiro.format(Math.round(mm.dia))} · {pct0(mm.doDia)}</span>
                        </p>
                      ) : null;
                    })()}
                  </div>
                ))}
              </div>
            </section>

            <footer className="tv-in mt-[1.4vw] flex items-center justify-between text-[0.85vw] text-white/35" style={{ animationDelay: "1000ms" }}>
              {/* Só o aviso de falha (pedido do usuário); sem legenda de método. */}
              <span className="text-[#fbbf24]/80">{erro && dados ? "sem conexão, mostrando a última leitura" : ""}</span>
              <span className="flex items-center gap-[1.4vw]">
                <button type="button" onClick={() => void document.documentElement.requestFullscreen?.().catch(() => {})} className="rounded-full border border-white/15 px-[0.9vw] py-[0.3vw] text-white/60 transition hover:border-white/40 hover:text-white">
                  Tela cheia
                </button>
                <Link href="/black" className="text-white/50 underline-offset-4 hover:text-white hover:underline">Sair (Esc)</Link>
              </span>
            </footer>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Mini({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="text-[0.95vw] font-semibold uppercase tracking-[0.26em] text-white/45">{rotulo}</p>
      <p className="tv-num mt-[0.2vw] text-[2.6vw] font-bold leading-none text-white/90">{valor}</p>
    </div>
  );
}

const CSS = `
.tv { background: #07061a; font-family: var(--font-sans), system-ui, sans-serif; }
/* Inter: algarismos tabulares, o numero que muda nao "danca" na TV. */
.tv-num { font-family: var(--font-num), var(--font-sans), sans-serif; font-variant-numeric: tabular-nums; font-feature-settings: "tnum" 1, "cv11" 1; }
.tv-heroi { font-size: clamp(5rem, 10.2vw, 14rem); background: linear-gradient(180deg, #ffffff 30%, #d8ccff 100%); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0.6vw 2.4vw rgba(139, 92, 246, 0.35)); }
.tv-heroi .tv-num > span { -webkit-text-fill-color: rgba(255,255,255,0.55); }
.tv-marca { background: linear-gradient(90deg, #fff 0%, #f0abfc 45%, #fb923c 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.tv-fundo { position: absolute; inset: -20%; background:
  radial-gradient(38% 42% at 18% 22%, rgba(124, 58, 237, 0.42), transparent 70%),
  radial-gradient(30% 36% at 88% 78%, rgba(249, 115, 22, 0.22), transparent 70%),
  radial-gradient(26% 30% at 78% 12%, rgba(34, 211, 238, 0.14), transparent 70%),
  radial-gradient(40% 40% at 40% 110%, rgba(192, 38, 211, 0.22), transparent 70%);
  animation: tv-deriva 38s ease-in-out infinite alternate; }
.tv-grade { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px); background-size: 4.2vw 4.2vw; mask-image: radial-gradient(70% 70% at 50% 45%, #000 30%, transparent 100%); }
.tv-grao { position: absolute; inset: 0; opacity: 0.07; mix-blend-mode: overlay; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
.tv-cartao { position: relative; background: linear-gradient(160deg, rgba(255,255,255,0.075), rgba(255,255,255,0.02)); border: 1px solid rgba(255,255,255,0.09); box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 1.2vw 3vw -1.5vw rgba(0,0,0,0.6); backdrop-filter: blur(6px); }
.tv-cartao::before { content: ""; position: absolute; left: 0; top: 18%; bottom: 18%; width: 3px; border-radius: 3px; background: var(--cor); box-shadow: 0 0 1.2vw var(--cor); }
.tv-barra { transition: width 1.4s cubic-bezier(0.22, 1, 0.36, 1); }
.tv-in { opacity: 0; transform: translateY(1.2vw); animation: tv-entra 0.9s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
.tv-pulso::after { content: ""; position: absolute; inset: 0; border-radius: 9999px; background: #f43f5e; animation: tv-onda 1.8s ease-out infinite; }
.tv-pulso-lento { animation: tv-respira 1.6s ease-in-out infinite; }
@keyframes tv-entra { to { opacity: 1; transform: none; } }
@keyframes tv-onda { from { transform: scale(1); opacity: 0.7; } to { transform: scale(2.8); opacity: 0; } }
@keyframes tv-respira { 50% { opacity: 0.35; } }
@keyframes tv-deriva { to { transform: translate3d(3%, -2%, 0) scale(1.06); } }
@media (prefers-reduced-motion: reduce) {
  .tv-in { animation: none; opacity: 1; transform: none; }
  .tv-fundo, .tv-pulso::after, .tv-pulso-lento { animation: none; }
  .tv-barra { transition: none; }
}
`;
