/**
 * Sessao propria da Torre de Controle (login Google).
 *
 * Porta do session.ts do GoHunter. Fluxo: ID token do Google verificado com
 * `jose` -> cookie `torre_session` assinado por nos (HS256, AUTH_SECRET). O
 * FastAPI valida o MESMO JWT (apps/api/app/sessao.py): iss, aud, algoritmo e
 * piso do segredo precisam bater exatamente.
 *
 * Modulo puro: nao le `process.env`; quem chama injeta o ambiente. Nenhum
 * token, cookie ou segredo entra em mensagem de erro.
 */
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export const SESSION_COOKIE = "torre_session";
export const SESSION_ISSUER = "torre-mktplace";
export const SESSION_AUDIENCE = "torre-mktplace-api";
export const SESSION_TTL_SECONDS = 604800;

const MIN_SECRET_LENGTH = 32;
export interface AuthEnv {
  AUTH_GOOGLE_ID?: string;
  AUTH_SECRET?: string;
  NODE_ENV?: string;
  /** Origem da API (Render). O login pergunta a ela se o e-mail entra. */
  TORRE_API_ORIGIN?: string;
  /** Chave de servico da API; sem ela, cai em MCP_BACKEND_SERVICE_KEY (mesmo valor). */
  TORRE_SERVICE_KEY?: string;
  MCP_BACKEND_SERVICE_KEY?: string;
}

export interface SessionData {
  email: string;
  name?: string;
  picture?: string;
}

export interface GoogleIdentity {
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export function authEnabled(env: AuthEnv): boolean {
  return (env.AUTH_GOOGLE_ID ?? "").trim() !== "";
}

function sessionSecret(env: AuthEnv): Uint8Array {
  const s = (env.AUTH_SECRET ?? "").trim();
  if (s.length < MIN_SECRET_LENGTH) {
    throw new Error("AUTH_SECRET ausente ou curto demais para assinar a sessao");
  }
  return new TextEncoder().encode(s);
}

export async function createSessionToken(data: SessionData, env: AuthEnv): Promise<string> {
  const secret = sessionSecret(env);
  const claims: Record<string, string> = { email: data.email };
  if (data.name !== undefined) claims.name = data.name;
  if (data.picture !== undefined) claims.picture = data.picture;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret);
}

/**
 * Devolve a sessao ou null (ausente, invalida, expirada). Nunca lanca.
 * Nao checa dominio: a lista vive so' na API, que a confere em cada requisicao.
 */
export async function verifySessionToken(
  token: string | null | undefined,
  env: AuthEnv,
): Promise<SessionData | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(env), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email) return null;
    const out: SessionData = { email };
    if (typeof payload.name === "string") out.name = payload.name;
    if (typeof payload.picture === "string") out.picture = payload.picture;
    return out;
  } catch {
    return null;
  }
}

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** Valida o ID token do Google. Lanca se invalido; NAO checa dominio. */
export async function verifyGoogleIdToken(
  idToken: string,
  env: AuthEnv,
  keys: JWTVerifyGetKey = GOOGLE_JWKS,
): Promise<GoogleIdentity> {
  const clientId = (env.AUTH_GOOGLE_ID ?? "").trim();
  if (!clientId) throw new Error("AUTH_GOOGLE_ID ausente");
  const { payload } = await jwtVerify(idToken, keys, {
    issuer: GOOGLE_ISSUERS,
    audience: clientId,
  });
  const p = payload as JWTPayload & {
    email?: string;
    email_verified?: boolean | string;
    name?: string;
    picture?: string;
  };
  return {
    email: typeof p.email === "string" ? p.email.toLowerCase() : "",
    emailVerified: p.email_verified === true || p.email_verified === "true",
    name: typeof p.name === "string" ? p.name : undefined,
    picture: typeof p.picture === "string" ? p.picture : undefined,
  };
}

/** Valor do Set-Cookie. `maxAge` 0 apaga o cookie (logout). */
export function sessionCookieHeader(
  token: string,
  env: AuthEnv,
  maxAge: number = SESSION_TTL_SECONDS,
): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    `Max-Age=${maxAge}`,
    "Path=/",
    "SameSite=Lax",
    "HttpOnly",
  ];
  if (env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}
