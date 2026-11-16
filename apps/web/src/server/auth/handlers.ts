/**
 * Handlers puros de /api/auth/* (login Google, logout, me).
 *
 * Recebem o ambiente por parametro (testavel sem mutar `process.env`). O
 * `credential` enviado pelo cliente nunca entra em corpo de resposta nem em log.
 */
import type { JWTVerifyGetKey } from "jose";

import {
  SESSION_COOKIE,
  authEnabled,
  createSessionToken,
  readCookie,
  sessionCookieHeader,
  verifyGoogleIdToken,
  verifySessionToken,
  type AuthEnv,
} from "./session.ts";

function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

const PERMITIDO_TIMEOUT_MS = 5000;

/**
 * A lista de dominios/e-mails vive so' na API (Render). `null` = nao deu para
 * perguntar (config ausente, rede, status ou corpo inesperado): nunca libera.
 */
async function emailPermitido(email: string, env: AuthEnv, fetchImpl: typeof fetch): Promise<boolean | null> {
  const origem = (env.TORRE_API_ORIGIN ?? "").trim();
  const chave = (env.TORRE_SERVICE_KEY || env.MCP_BACKEND_SERVICE_KEY || "").trim();
  if (!origem || !chave) return null;
  try {
    const url = new URL("/auth/permitido", origem);
    url.searchParams.set("email", email);
    const res = await fetchImpl(url, {
      headers: { "x-torre-service-key": chave },
      cache: "no-store",
      signal: AbortSignal.timeout(PERMITIDO_TIMEOUT_MS),
    });
    if (res.status !== 200) return null;
    const j = (await res.json()) as { permitido?: unknown };
    return typeof j.permitido === "boolean" ? j.permitido : null;
  } catch {
    return null;
  }
}

export async function handleGoogleLogin(
  req: Request,
  env: AuthEnv,
  keys?: JWTVerifyGetKey,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!authEnabled(env)) return json({ error: "auth_desligada" }, 404);

  // Anti login-CSRF: um form cross-site so consegue text/plain, nunca application/json.
  if (!/^application\/json\s*(;|$)/i.test(req.headers.get("content-type") ?? "")) {
    return json({ error: "content_type_invalido" }, 415);
  }

  const body: unknown = await req.json().catch(() => null);
  const credential =
    body && typeof body === "object" && typeof (body as { credential?: unknown }).credential === "string"
      ? (body as { credential: string }).credential.trim()
      : "";
  if (!credential) return json({ error: "credential_ausente" }, 400);

  let identity;
  try {
    identity = await verifyGoogleIdToken(credential, env, keys);
  } catch {
    return json({ error: "credencial_invalida" }, 401);
  }

  // Sem email (claim ausente) conta como nao verificado: nunca ganha cookie.
  if (!identity.email || !identity.emailVerified) {
    return json({ error: "email_nao_verificado" }, 403);
  }
  const permitido = await emailPermitido(identity.email, env, fetchImpl);
  if (permitido === null) {
    return json({ error: "verificacao_indisponivel", message: "Não deu para confirmar seu acesso. Tente de novo." }, 503);
  }
  if (!permitido) {
    // Sem listar dominios nem e-mails liberados.
    return json(
      { error: "dominio_nao_permitido", message: "Acesso restrito. Peça liberação a quem administra a Torre." },
      403,
    );
  }

  let token: string;
  try {
    token = await createSessionToken(
      { email: identity.email, name: identity.name, picture: identity.picture },
      env,
    );
  } catch {
    return json({ error: "sessao_indisponivel" }, 500);
  }

  console.info("auth_login email=%s", identity.email);
  return json(
    { ok: true, email: identity.email, name: identity.name, picture: identity.picture },
    200,
    { "set-cookie": sessionCookieHeader(token, env) },
  );
}

export async function handleLogout(_req: Request, env: AuthEnv): Promise<Response> {
  return json({ ok: true }, 200, { "set-cookie": sessionCookieHeader("", env, 0) });
}

export async function handleMe(req: Request, env: AuthEnv): Promise<Response> {
  if (!authEnabled(env)) return json({ authEnabled: false, email: "dev@local" }, 200);
  const session = await verifySessionToken(readCookie(req, SESSION_COOKIE), env);
  if (!session) {
    return json({ error: "nao_autenticado", clientId: (env.AUTH_GOOGLE_ID ?? "").trim() }, 401);
  }
  return json(
    { authEnabled: true, email: session.email, name: session.name, picture: session.picture },
    200,
  );
}
