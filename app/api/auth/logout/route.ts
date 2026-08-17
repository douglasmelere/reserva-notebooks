import { cookies } from "next/headers";
import {
  assertSameOrigin,
  clearSessionCookie,
  getClientIp,
  getCurrentUser,
  getUserAgent,
} from "@/lib/auth";
import { handle, noContent } from "@/lib/http";
import { SESSION_COOKIE } from "@/lib/session";
import { logout } from "@/server/users";

export const dynamic = "force-dynamic";

/**
 * Encerra a sessão atual.
 *
 * Deliberadamente idempotente: sair sem estar logado, ou com um cookie já
 * expirado, devolve 204 e limpa o cookie do mesmo jeito — o usuário quer sair,
 * e um erro aqui só o deixaria preso a um cookie inútil.
 */
export const POST = handle(async () => {
  await assertSameOrigin();

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const [actor, ip, userAgent] = await Promise.all([
    getCurrentUser(),
    getClientIp(),
    getUserAgent(),
  ]);

  await logout(token, actor, { ip, userAgent });
  await clearSessionCookie();

  return noContent();
}, "auth.logout");
