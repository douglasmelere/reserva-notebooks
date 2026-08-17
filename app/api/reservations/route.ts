import { z } from "zod";
import {
  assertSameOrigin,
  getClientIp,
  getUserAgent,
  requireUser,
} from "@/lib/auth";
import { handle, json, readJson, readQuery } from "@/lib/http";
import {
  createReservationSchema,
  listQuerySchema,
  reservationStatusSchema,
} from "@/lib/validation";
import { createReservation, listReservations } from "@/server/reservations";
import { serializeReservation } from "@/server/whatsapp-contact";

export const dynamic = "force-dynamic";

/**
 * Filtros da listagem.
 *
 * `status` pode vir repetido na query (`?status=CONFIRMADA&status=RETIRADA`),
 * que é como a interface monta o filtro por múltiplos estados; normalizamos
 * para array para o serviço não precisar saber disso.
 */
const listReservationsQuerySchema = listQuerySchema.extend({
  status: z
    .union([reservationStatusSchema, z.array(reservationStatusSchema).min(1)])
    .optional()
    .transform((value) =>
      value === undefined ? undefined : Array.isArray(value) ? value : [value],
    ),
  kitId: z.string().trim().min(1).optional(),
  notebookId: z.string().trim().min(1).optional(),
  /** Reservas de outro docente: só a supervisão enxerga. */
  userId: z.string().trim().min(1).optional(),
});

export const GET = handle(async (request: Request) => {
  const user = await requireUser();
  const filters = readQuery(request, listReservationsQuerySchema);

  // O serviço já força o escopo do professor; descartar `userId` aqui deixa
  // explícito que o filtro é da supervisão e evita depender de uma única
  // camada para uma regra de privacidade.
  const userId = user.role === "SUPERVISOR" ? filters.userId : undefined;

  const result = await listReservations(
    {
      userId,
      status: filters.status,
      from: filters.from,
      to: filters.to,
      kitId: filters.kitId,
      notebookId: filters.notebookId,
      search: filters.search,
      page: filters.page,
      pageSize: filters.pageSize,
    },
    user,
  );

  return json({
    items: result.items.map(serializeReservation),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
  });
}, "reservas.listar");

export const POST = handle(async (request: Request) => {
  const user = await requireUser();
  await assertSameOrigin();

  const body = await readJson(request, createReservationSchema);
  const [ip, userAgent] = await Promise.all([getClientIp(), getUserAgent()]);

  // Reservar para outro docente e abrir a reserva em outro status são decisões
  // do serviço: ele confere o perfil e ignora os campos quando quem chama é
  // professor. A rota não repete a checagem para não haver duas versões dela.
  const created = await createReservation({
    actor: user,
    ...body,
    ip,
    userAgent,
  });

  // Conflito de recurso sobe como AppError CONFLITO_RESERVA, com a lista de
  // reservas conflitantes em `detalhes.conflitos` — é o que a tela usa para
  // oferecer o contato por WhatsApp. `handle` devolve isso como 409.
  return json(serializeReservation(created), { status: 201 });
}, "reservas.criar");
