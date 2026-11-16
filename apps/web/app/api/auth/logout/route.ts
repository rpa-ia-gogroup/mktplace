import { handleLogout } from "../../../../src/server/auth/handlers.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function currentEnv() {
  return {
    AUTH_GOOGLE_ID: process.env.AUTH_GOOGLE_ID,
    AUTH_SECRET: process.env.AUTH_SECRET,
    NODE_ENV: process.env.NODE_ENV,
  };
}

export async function POST(req: Request): Promise<Response> {
  return handleLogout(req, currentEnv());
}
