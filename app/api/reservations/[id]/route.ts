import { z } from "zod";
import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { updateReservationSchema } from "@/lib/validation";
import { getReservation, updateReservation } from "@/server/reservations";
import { somenteCamposEnviados } from "@/server/users";
import { serializeReservation } from "@/server/whatsapp-contact";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * O corpo é lido cru antes de validar para sabermos quais campos o cliente
 * realmente enviou — mesma necessidade de `PATCH /api/me`.
 */
const corpoBrutoSchema = z.record(z.string(), z.unknown());

export const GET = handle(async (_request: Request, { params }: RouteContext) => {
  const user = await requireUser();
  const { id } = await params;

  // Reserva de outro professor responde 404, não 403: quem chuta identificador
  // não descobre nem que a reserva existe.
  const reservation = await getReservation(id, user);
  return json(serializeReservation(reservation));
}, "reservas.detalhe");

export const PATCH = handle(async (request: Request, { params }: RouteContext) => {
  const user = await requireUser();
  await assertSameOrigin();
  const { id } = await params;

  // `updateReservationSchema` normaliza todo texto opcional ausente para
  // `null`, então o resultado do parse traz finalidade, turma, disciplina,
  // sala e observações mesmo quando o cliente não as enviou. Filtrar pelas
  // chaves do corpo original preserva a semântica de PATCH e evita dois erros:
  // apagar em silêncio os dados da aula a cada edição, e fazer o serviço ler
  // `supervisorNotes: null` como tentativa do professor de mexer em campo
  // restrito — o que recusava toda edição dele com um 403 enganoso.
  const bruto = await readJson(request, corpoBrutoSchema);
  // `parse` lança `ZodError`, que o `handle` converte em 422 com erros por campo.
  const patch = somenteCamposEnviados(updateReservationSchema.parse(bruto), bruto);

  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  // Quais campos o professor pode mexer (dados da aula) e quais são exclusivos
  // da supervisão (data, horário, equipamentos, status) é decisão do serviço.
  const updated = await updateReservation(id, patch, user, { ip, userAgent });
  return json(serializeReservation(updated));
}, "reservas.atualizar");
