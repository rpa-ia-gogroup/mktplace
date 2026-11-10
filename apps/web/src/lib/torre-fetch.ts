/**
 * AUTH-GOOGLE-5 — `fetch` das chamadas a API feitas pelo navegador.
 * Manda o cookie de sessao e, se a API disser que a sessao acabou
 * (401 + `X-Torre-Auth: sessao-ausente`), avisa a tela por evento.
 * 401 sem esse header (B2B/Auth0) nao e' sessao expirada.
 */
import { urlSemMarcasMenores } from "./filters/brands.ts";

export const EVENTO_SESSAO_EXPIRADA = "torre:sessao-expirada";

export async function torreFetch(input: string, init?: RequestInit): Promise<Response> {
  // As marcas menores (Bling) vivem no filtro global, mas as APIs do Data Mart so conhecem as grandes.
  const res = await globalThis.fetch(urlSemMarcasMenores(input), { credentials: "same-origin", ...init });
  if (
    res.status === 401 &&
    res.headers.get("X-Torre-Auth") === "sessao-ausente" &&
    typeof window !== "undefined"
  ) {
    window.dispatchEvent(new Event(EVENTO_SESSAO_EXPIRADA));
  }
  return res;
}
