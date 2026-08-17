import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { updateReservationSchema } from "@/lib/validation";
import { getReservation, updateReservation } from "@/server/reservations";
import { serializeReservation } from "@/server/whatsapp-contact";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

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

  const patch = await readJson(request, updateReservationSchema);
  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  // Quais campos o professor pode mexer (dados da aula) e quais são exclusivos
  // da supervisão (data, horário, equipamentos, status) é decisão do serviço.
  const updated = await updateReservation(id, patch, user, { ip, userAgent });
  return json(serializeReservation(updated));
}, "reservas.atualizar");
