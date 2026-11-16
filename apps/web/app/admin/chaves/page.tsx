"use client";

/**
 * CHAVES-PESSOAIS — admin das chaves `torre_pat_...` (MCP e API REST).
 *
 * Fora do menu. Quem nao esta em TORRE_ADMIN_EMAILS recebe 403 da API e ve
 * "Acesso restrito". A chave aparece UMA vez, logo apos criar; a lista nunca a tem.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

import Aba from "@/components/layout/Aba";
import Panel from "@/components/ui/Panel";
import StateBlock, { RetryButton } from "@/components/ui/StateBlock";
import { torreFetch } from "@/lib/torre-fetch";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const BASE = `${API_URL}/api/v1/chaves`;

type Chave = {
  id: number;
  nome: string;
  dono_email: string;
  criada_por: string;
  criada_em: string;
  expira_em: string;
  revogada_em: string | null;
  ultimo_uso_em: string | null;
};
type Carga = { chaves: Chave[] } | { erro: "restrito" | "falha" } | null;

const BOTAO =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";
const CAMPO =
  "min-h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

const data = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

function situacao(c: Chave): { rotulo: string; classe: string } {
  if (c.revogada_em) return { rotulo: "Revogada", classe: "text-ink-muted" };
  if (new Date(c.expira_em) <= new Date()) return { rotulo: "Vencida", classe: "text-warn-ink" };
  return { rotulo: "Ativa", classe: "text-ok-ink" };
}

export default function ChavesPage() {
  const [carga, setCarga] = useState<Carga>(null);
  const [nova, setNova] = useState<{ nome: string; chave: string } | null>(null);
  const [copiada, setCopiada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [revogando, setRevogando] = useState<number | null>(null);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [erroCopia, setErroCopia] = useState(false);

  const carregar = useCallback(async () => {
    setCarga(null);
    try {
      const res = await torreFetch(BASE);
      if (res.status === 401 || res.status === 403) return setCarga({ erro: "restrito" });
      if (!res.ok) return setCarga({ erro: "falha" });
      setCarga((await res.json()) as { chaves: Chave[] });
    } catch {
      setCarga({ erro: "falha" });
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setEnviando(true);
    setErroForm(null);
    try {
      const res = await torreFetch(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nome: f.get("nome"), dono_email: f.get("dono"), dias: Number(f.get("dias")) }),
      });
      if (!res.ok) {
        setErroForm(
          res.status === 422 ? "Confira o nome, o e-mail (da empresa) e o prazo (1 a 365 dias)." : "Não deu para criar a chave.",
        );
        return;
      }
      const criada = (await res.json()) as { nome: string; chave: string };
      setNova({ nome: criada.nome, chave: criada.chave });
      setCopiada(false);
      setErroCopia(false);
      (e.target as HTMLFormElement).reset();
      void carregar();
    } catch {
      setErroForm("Não deu para criar a chave.");
    } finally {
      setEnviando(false);
    }
  }

  async function revogar(c: Chave) {
    if (!window.confirm(`Revogar a chave "${c.nome}" de ${c.dono_email}? Quem a usa perde o acesso na hora.`)) return;
    setRevogando(c.id);
    setErroLista(null);
    const res = await torreFetch(`${BASE}/${c.id}/revogar`, { method: "POST" }).catch(() => null);
    setRevogando(null);
    if (!res?.ok) return setErroLista(`Não deu para revogar a chave “${c.nome}”. Tente de novo.`);
    void carregar();
  }

  async function copiar() {
    if (!nova) return;
    try {
      await navigator.clipboard.writeText(nova.chave);
      setCopiada(true);
      setErroCopia(false);
    } catch {
      setCopiada(false);
      setErroCopia(true);
    }
  }

  if (carga && "erro" in carga) {
    return (
      <Aba titulo="Chaves pessoais">
        {carga.erro === "restrito" ? (
          <StateBlock tipo="indisponivel" titulo="Acesso restrito" descricao="Só administradores da Torre gerenciam chaves." />
        ) : (
          <StateBlock tipo="erro" titulo="Não deu para carregar as chaves" acao={<RetryButton onClick={carregar} />} />
        )}
      </Aba>
    );
  }

  return (
    <Aba titulo="Chaves pessoais">
      <Panel titulo="Nova chave" icone={KeyRound} ajuda="Vale no MCP e na API da Torre (Authorization: Bearer). Vence no prazo escolhido.">
        <form onSubmit={criar} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs font-medium text-ink-muted">
            Nome
            <input name="nome" required maxLength={80} placeholder="Ex.: Planilha de metas" className={CAMPO} />
          </label>
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-medium text-ink-muted">
            E-mail do dono
            <input name="dono" type="email" required maxLength={254} placeholder="nome@gocase.com" className={CAMPO} />
          </label>
          <label className="flex w-28 flex-col gap-1 text-xs font-medium text-ink-muted">
            Prazo (dias)
            <input name="dias" type="number" required min={1} max={365} defaultValue={90} className={CAMPO} />
          </label>
          <button type="submit" disabled={enviando} className={`${BOTAO} bg-accent text-accent-on hover:opacity-90`}>
            {enviando ? "Criando…" : "Criar chave"}
          </button>
        </form>
        {erroForm && (
          <p role="alert" className="mt-3 text-sm text-crit-ink">
            {erroForm}
          </p>
        )}
        {nova && (
          <div role="status" className="mt-4 rounded-lg bg-warn-soft p-3 text-sm text-ink">
            <p className="font-semibold">Chave “{nova.nome}” criada. Copie agora: ela não aparece de novo.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 break-all rounded bg-surface px-2 py-1.5 font-mono text-xs">{nova.chave}</code>
              <button type="button" onClick={copiar} className={`${BOTAO} border border-line-strong bg-surface text-ink hover:bg-raised`}>
                {copiada ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                {copiada ? "Copiada" : "Copiar"}
              </button>
            </div>
            {erroCopia && (
              <p role="alert" className="mt-2 text-crit-ink">
                Não deu para copiar. Selecione a chave e copie com Ctrl+C.
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel titulo="Chaves" semPadding>
        {erroLista && (
          <p role="alert" className="px-4 pt-3 text-sm text-crit-ink">
            {erroLista}
          </p>
        )}
        {carga === null ? (
          <StateBlock tipo="carregando" titulo="Carregando chaves" compacto />
        ) : carga.chaves.length === 0 ? (
          <StateBlock tipo="vazio" titulo="Nenhuma chave criada" compacto />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-left text-xs text-ink-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-medium">Nome</th>
                  <th scope="col" className="px-4 py-2 font-medium">Dono</th>
                  <th scope="col" className="px-4 py-2 font-medium">Vence</th>
                  <th scope="col" className="px-4 py-2 font-medium">Último uso</th>
                  <th scope="col" className="px-4 py-2 font-medium">Situação</th>
                  <th scope="col" className="px-4 py-2"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {carga.chaves.map((c) => {
                  const s = situacao(c);
                  return (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium text-ink">
                        {c.nome}
                        <span className="block text-xs font-normal text-ink-muted">
                          criada {data(c.criada_em)} por {c.criada_por}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-ink">{c.dono_email}</td>
                      <td className="px-4 py-2 tabular-nums text-ink">{data(c.expira_em)}</td>
                      <td className="px-4 py-2 tabular-nums text-ink">{c.ultimo_uso_em ? data(c.ultimo_uso_em) : "Nunca usada"}</td>
                      <td className={`px-4 py-2 font-medium ${s.classe}`}>{s.rotulo}</td>
                      <td className="px-4 py-2 text-right">
                        {s.rotulo === "Ativa" && (
                          <button
                            type="button"
                            onClick={() => revogar(c)}
                            disabled={revogando === c.id}
                            aria-label={`Revogar a chave ${c.nome}`}
                            className={`${BOTAO} border border-crit/35 text-crit-ink hover:bg-crit-soft`}
                          >
                            {revogando === c.id ? "Revogando…" : "Revogar"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </Aba>
  );
}
