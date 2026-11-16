import { handleGoogleLogin } from "../../../../src/server/auth/handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function currentEnv() {
  return {
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_SECRET: process.env.AUTH_SECRET,
    TORRE_API_ORIGIN: process.env.TORRE_API_ORIGIN,
    TORRE_SERVICE_KEY: process.env.TORRE_SERVICE_KEY,
    MCP_BACKEND_SERVICE_KEY: process.env.MCP_BACKEND_SERVICE_KEY,
    NODE_ENV: process.env.NODE_ENV,
  };
}

export async function POST(req: Request): Promise<Response> {
  return handleGoogleLogin(req, currentEnv());
}
