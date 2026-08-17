import { z } from "zod";
import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireSupervisor,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { adminUpdateUserSchema } from "@/lib/validation";
import {
  adminGetUser,
  adminUpdateUser,
  somenteCamposEnviados,
} from "@/server/users";

export const dynamic = "force-dynamic";

/** Ver o comentário equivalente em `app/api/me/route.ts`. */
const corpoBrutoSchema = z.record(z.string(), z.unknown());

export const GET = handle(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireSupervisor();
    const { id } = await params;

    return json({ usuario: await adminGetUser(id, actor) });
  },
  "admin.usuarios.detalhe",
);

export const PATCH = handle(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const actor = await requireSupervisor();
    await assertSameOrigin();

    const { id } = await params;
    const bruto = await readJson(request, corpoBrutoSchema);
    const patch = somenteCamposEnviados(
      adminUpdateUserSchema.parse(bruto),
      bruto,
    );

    const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);
    const usuario = await adminUpdateUser(id, patch, actor, { ip, userAgent });

    return json({ usuario });
  },
  "admin.usuarios.atualizar",
);
