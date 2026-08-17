import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
} from "@/lib/auth";
import { handle, json, readJson, readQuery } from "@/lib/http";
import { adminCreateUserSchema } from "@/lib/validation";
import { adminCreateUser, listUsers, listUsersQuerySchema } from "@/server/users";

export const dynamic = "force-dynamic";

export const GET = handle(async (request: Request) => {
  const actor = await requireSupervisor();

  const filtros = readQuery(request, listUsersQuerySchema);
  return json(await listUsers(filtros, actor));
}, "admin.usuarios.listar");

export const POST = handle(async (request: Request) => {
  const actor = await requireSupervisor();
  await assertSameOrigin();

  const body = await readJson(request, adminCreateUserSchema);
  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  const usuario = await adminCreateUser(body, actor, { ip, userAgent });

  return json(
    {
      usuario,
      mensagem:
        "Conta criada. Informe a senha provisória ao docente — ele terá de trocá-la no primeiro acesso.",
    },
    { status: 201 },
  );
}, "admin.usuarios.criar");
