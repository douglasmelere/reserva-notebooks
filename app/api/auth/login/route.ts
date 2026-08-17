import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  setSessionCookie,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { loginSchema } from "@/lib/validation";
import { authenticate } from "@/server/users";

export const dynamic = "force-dynamic";

export const POST = handle(async (request: Request) => {
  await assertSameOrigin();

  const { username, password } = await readJson(request, loginSchema);
  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  const { user, token, expiresAt } = await authenticate(username, password, {
    ip,
    userAgent,
  });

  await setSessionCookie(token, expiresAt);

  // `mustChangePassword` vem junto para a interface poder mandar o docente
  // direto para a troca de senha antes de qualquer outra tela.
  return json({ usuario: user, sessaoExpiraEm: expiresAt.toISOString() });
}, "auth.login");
