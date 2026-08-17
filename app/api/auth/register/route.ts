import { assertSameOrigin, getClientIp, getUserAgent } from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { registerSchema } from "@/lib/validation";
import { registerUser } from "@/server/users";

export const dynamic = "force-dynamic";

/**
 * Cadastro público de professor.
 *
 * Não abre sessão automaticamente: o login é o único ponto que aplica limite
 * de tentativas e registra o acesso, e concentrar isso ali evita dois caminhos
 * distintos criando sessão.
 */
export const POST = handle(async (request: Request) => {
  await assertSameOrigin();

  const body = await readJson(request, registerSchema);
  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  const usuario = await registerUser(body, { ip, userAgent });

  return json(
    {
      usuario,
      mensagem: "Cadastro concluído. Entre com o seu usuário e senha.",
    },
    { status: 201 },
  );
}, "auth.cadastrar");
