"use client";

/**
 * BLACK-TV — a receita de hoje em números grandes, para a TV do time (Nath, 27/11).
 *
 * Fonte: `GET /performance/hoje-por-hora` (o mesmo "Hoje" da Gerencial): cada canal
 * até a sua última hora fechada, total = soma dos canais. Só o atual, sem meta nem
 * comparativo. Ocupa a tela inteira por cima do shell; Esc volta para /black.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { HojePorHora } from "@/lib/gerencial/hoje-por-hora";
import { torreFetch } from "@/lib/torre-fetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
/** O dado anda a cada ~30 min; 2 min deixa a TV no máximo 2 min atrás da Torre. */
const RELER_MS = 2 * 60_000;

const CANAIS = {
  tiktok: { nome: "TikTok Shop", cor: "#a78bfa" },
  ml: { nome: "Mercado Livre", cor: "#22d3ee" },
  shopee: { nome: "Shopee", cor: "#fb923c" },
} as const;
const ORDEM_CANAIS = ["tiktok", "shopee", "ml"] as const;
const MARCA: Record<string, string> = {
  apice: "Ápice", barbours: "Barbour's", kokeshi: "Kokeshi", lescent: "Lescent", rituaria: "Rituária",
};

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const centavos = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hhmm = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0);

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
  const [dados, setDados] = useState<HojePorHora | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lidoEm, setLidoEm] = useState<Date | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const ler = () =>
      torreFetch(`${API_URL}/api/v1/performance/hoje-por-hora`, { signal: ctrl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error("A Torre não respondeu.");
          const d = (await r.json()) as HojePorHora;
          setDados(d);
          setErro(d.disponivel ? null : d.motivo ?? "Vendas de hoje indisponíveis.");
          setLidoEm(new Date());
        })
        .catch((e) => { if (!ctrl.signal.aborted) setErro(e instanceof Error ? e.message : "Falha ao carregar."); });
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

  const total = dados?.hoje?.gmv ?? 0;
  const animado = useContagem(total);
  const canais = ORDEM_CANAIS.map((id) => {
    const v = dados?.por_canal.find((c) => c.channel === id);
    const fonte = dados?.canais.find((c) => c.channel === id);
    return { id, ...CANAIS[id], gmv: v?.hoje.gmv ?? null, pedidos: v?.hoje.pedidos ?? 0, corte: fonte?.corte_hora ?? fonte?.horas_fechadas_hoje ?? null };
  });
  const marcas = [...(dados?.por_marca ?? [])].sort((a, b) => b.hoje - a.hoje);
  const maiorMarca = marcas[0]?.hoje ?? 0;
  const cortes = canais.map((c) => c.corte).filter((c): c is number => c !== null && c > 0);
  const corteMin = cortes.length ? Math.min(...cortes) : null;

  return (
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
          <div className="flex items-center gap-[2vw]">
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
            <section className="grid flex-1 grid-cols-[1.45fr_1fr] items-center gap-[3.5vw]">
              <div className="tv-in" style={{ animationDelay: "120ms" }}>
                <p className="text-[1.15vw] font-semibold uppercase tracking-[0.34em] text-white/55">Receita de hoje</p>
                <p className="tv-heroi mt-[0.4vw] font-extrabold leading-[0.92] tracking-[-0.035em]">
                  <Reais valor={animado} />
                </p>
                <div className="mt-[2.2vw] flex gap-[3.2vw]">
                  <Mini rotulo="Pedidos" valor={inteiro.format(dados.hoje?.pedidos ?? 0)} />
                  <Mini rotulo="Ticket médio" valor={dados.hoje?.ticket != null ? `R$ ${centavos.format(dados.hoje.ticket)}` : "—"} />
                  <Mini rotulo="Dados até" valor={corteMin !== null ? `${corteMin}h` : "—"} />
                </div>
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
                        {c.corte ? `até ${c.corte}h` : "sem hora fechada"} · {pct(c.gmv ?? 0, total)}%
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
                      <span className="tv-num text-[0.9vw] font-semibold text-white/35">#{i + 1}</span>
                    </div>
                    <p className="mt-[0.2vw] text-[2.3vw] font-bold leading-tight tracking-[-0.02em]"><Reais valor={m.hoje} /></p>
                    <div className="mt-[0.5vw] h-[0.3vw] overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="tv-barra h-full rounded-full bg-gradient-to-r from-[#7c3aed] to-[#f0abfc]" style={{ width: `${maiorMarca > 0 ? (m.hoje / maiorMarca) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <footer className="tv-in mt-[1.4vw] flex items-center justify-between text-[0.85vw] text-white/35" style={{ animationDelay: "1000ms" }}>
              <span>Vendas pagas · cada canal até a sua última hora fechada · atualiza a cada 2 min{lidoEm ? ` · lido às ${hhmm(lidoEm)}` : ""}{erro ? " · última leitura falhou, mostrando a anterior" : ""}</span>
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
    </div>
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
.tv-heroi { font-size: clamp(5rem, 11.5vw, 15rem); background: linear-gradient(180deg, #ffffff 30%, #d8ccff 100%); -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 0.6vw 2.4vw rgba(139, 92, 246, 0.35)); }
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
