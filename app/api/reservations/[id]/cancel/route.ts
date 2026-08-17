import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson } from "@/lib/http";
import { cancelReservationSchema } from "@/lib/validation";
import { cancelReservation } from "@/server/reservations";
import { serializeReservation } from "@/server/whatsapp-contact";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Cancelamento é POST, e não DELETE, porque a reserva não some: ela vira
 * CANCELADA, libera o recurso e permanece no histórico da sala e do docente.
 */
export const POST = handle(async (request: Request, { params }: RouteContext) => {
  const user = await requireUser();
  await assertSameOrigin();
  const { id } = await params;

  const { reason } = await readJson(request, cancelReservationSchema);
  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  // Prazo de cancelamento e "já começou" são políticas configuráveis aplicadas
  // no serviço, que também deixa a supervisão contorná-las no balcão.
  const cancelled = await cancelReservation(id, reason, user, { ip, userAgent });
  return json(serializeReservation(cancelled));
}, "reservas.cancelar");
