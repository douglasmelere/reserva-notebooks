import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { resetPasswordSchema } from "@/lib/validation";
import { adminResetPassword } from "@/server/users";

export const dynamic = "force-dynamic";

export const POST = handle(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireSupervisor();
    await assertSameOrigin();

    const { id } = await params;
    const { newPassword, mustChangePassword } = await readJson(
      request,
      resetPasswordSchema,
    );
    const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

    const usuario = await adminResetPassword(
      id,
      newPassword,
      actor,
      { ip, userAgent },
      { mustChangePassword },
    );

    return json({
      usuario,
      mensagem:
        "Senha redefinida. Todas as sessões do docente foram encerradas; entregue a senha provisória pessoalmente.",
    });
  },
  "admin.usuarios.redefinir-senha",
);
