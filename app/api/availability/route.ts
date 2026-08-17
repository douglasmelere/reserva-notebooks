import { requireUser } from "@/lib/auth";
import { diffDays } from "@/lib/datetime";
import { dadosInvalidos } from "@/lib/errors";
import { handle, json, readQuery } from "@/lib/http";
import { availabilityQuerySchema, dateSchema } from "@/lib/validation";
import { getAvailability, getOccupancyByDay } from "@/server/availability";

export const dynamic = "force-dynamic";

/** Teto da faixa do calendário: evita varrer anos de reservas por engano. */
const MAX_OCCUPANCY_RANGE_DAYS = 366;

/**
 * `from`/`to` são opcionais e independentes do período consultado: servem para
 * a grade semanal/mensal, que precisa da ocupação de vários dias de uma vez em
 * vez de uma chamada de disponibilidade por dia.
 */
const availabilityRouteQuerySchema = availabilityQuerySchema.extend({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

export const GET = handle(async (request: Request) => {
  const user = await requireUser();
  const query = readQuery(request, availabilityRouteQuerySchema);
  const isSupervisor = user.role === "SUPERVISOR";

  const availability = await getAvailability({
    date: query.date,
    startTime: query.startTime,
    endTime: query.endTime,
    kitType: query.kitType,
    location: query.location,
    minCapacity: query.minCapacity,
    onlyStandaloneNotebooks: query.onlyStandaloneNotebooks,
    search: query.search,
    // Equipamento desativado ou em manutenção é assunto da supervisão. Para o
    // professor ele simplesmente não existe na tela de reserva — mostrar o que
    // ele não pode reservar só gera pedido no balcão.
    includeUnavailable: isSupervisor && query.includeUnavailable,
  });

  // Informar só uma das pontas é entendido como faixa de um dia só, em vez de
  // recusar a consulta por um detalhe que dá para deduzir.
  const from = query.from ?? query.to;
  const to = query.to ?? query.from;
  if (!from || !to) return json(availability);

  const span = diffDays(from, to);
  if (span < 0) {
    throw dadosInvalidos("A data final deve ser igual ou posterior à inicial.", {
      to: ["A data final deve ser igual ou posterior à inicial."],
    });
  }
  if (span > MAX_OCCUPANCY_RANGE_DAYS) {
    throw dadosInvalidos(
      `Consulte no máximo ${MAX_OCCUPANCY_RANGE_DAYS} dias de ocupação por vez.`,
      { to: [`Período muito longo (máximo ${MAX_OCCUPANCY_RANGE_DAYS} dias).`] },
    );
  }

  const ocupacaoPorDia = await getOccupancyByDay(from, to);
  return json({ ...availability, ocupacaoPorDia });
}, "disponibilidade.consultar");
