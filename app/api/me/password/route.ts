import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
  setSessionCookie,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { changePasswordSchema } from "@/lib/validation";
import { changeOwnPassword } from "@/server/users";

export const dynamic = "force-dynamic";

/**
 * Troca da própria senha.
 *
 * O serviço encerra todas as sessões e emite uma nova para este dispositivo;
 * por isso o cookie é reescrito aqui — sem isso, quem acabou de trocar a senha
 * seria deslogado junto com os demais aparelhos.
 */
export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  await assertSameOrigin();

  const { currentPassword, newPassword } = await readJson(
    request,
    changePasswordSchema,
  );
  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  const resultado = await changeOwnPassword(
    user.id,
    currentPassword,
    newPassword,
    { ip, userAgent },
  );

  await setSessionCookie(resultado.token, resultado.expiresAt);

  return json({
    usuario: resultado.user,
    sessaoExpiraEm: resultado.expiresAt.toISOString(),
    mensagem:
      "Senha alterada com sucesso. As sessões abertas em outros dispositivos foram encerradas.",
  });
}, "me.trocar-senha");
