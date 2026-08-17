import { AppError, regraDeNegocio } from "@/lib/errors";
import {
  diffDays,
  parseTimeOfDay,
  todayLocal,
  toLocalTimeString,
} from "@/lib/datetime";
import type { Settings } from "@/lib/settings";
import type { ReservationStatus } from "@/generated/prisma/enums";

/**
 * Regras de negócio das reservas, isoladas de banco e de HTTP.
 *
 * Ficam separadas de propósito: são as regras que a supervisão mais ajusta, e
 * poder testá-las sem subir banco nem servidor torna barato mexer nelas.
 */

/**
 * Status em que a reserva ainda ocupa o recurso.
 * É o que alimenta a coluna `blocking` dos itens e, por consequência, a
 * restrição de sobreposição no banco.
 */
export const BLOCKING_STATUSES: ReservationStatus[] = [
  "SOLICITADA",
  "CONFIRMADA",
  "RETIRADA",
  "EM_USO",
];

/** Status finais: a reserva não ocupa mais nada. */
export const CLOSED_STATUSES: ReservationStatus[] = [
  "DEVOLVIDA",
  "ENCERRADA",
  "CANCELADA",
  "NAO_COMPARECEU",
];

export function statusBlocks(status: ReservationStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}

export function isClosed(status: ReservationStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  SOLICITADA: "Solicitada",
  CONFIRMADA: "Confirmada",
  RETIRADA: "Retirada",
  EM_USO: "Em uso",
  DEVOLVIDA: "Devolvida",
  ENCERRADA: "Encerrada",
  CANCELADA: "Cancelada",
  NAO_COMPARECEU: "Não comparecimento",
};

/**
 * Transições de status permitidas.
 *
 * Impede saltos incoerentes — reabrir uma reserva cancelada, por exemplo —
 * mesmo que alguém chame a API diretamente.
 */
const ALLOWED_TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  SOLICITADA: ["CONFIRMADA", "CANCELADA", "NAO_COMPARECEU"],
  CONFIRMADA: ["RETIRADA", "EM_USO", "CANCELADA", "NAO_COMPARECEU", "ENCERRADA"],
  RETIRADA: ["EM_USO", "DEVOLVIDA", "ENCERRADA"],
  EM_USO: ["DEVOLVIDA", "ENCERRADA"],
  DEVOLVIDA: ["ENCERRADA"],
  ENCERRADA: [],
  CANCELADA: [],
  NAO_COMPARECEU: ["ENCERRADA"],
};

export function canTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): void {
  if (!canTransition(from, to)) {
    throw regraDeNegocio(
      `Não é possível mudar o status de "${RESERVATION_STATUS_LABEL[from]}" para "${RESERVATION_STATUS_LABEL[to]}".`,
    );
  }
}

// ---------------------------------------------------------------------------
// Validação de agendamento
// ---------------------------------------------------------------------------

export type SchedulingCheckInput = {
  settings: Settings;
  dateStr: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** Supervisores podem contornar as políticas de antecedência. */
  bypassPolicies: boolean;
  now?: Date;
};

/**
 * Aplica as políticas de agendamento configuradas pela supervisão.
 *
 * A supervisão pode contornar limites de antecedência (`bypassPolicies`), já
 * que ela precisa conseguir remendar a agenda no balcão. Regras de coerência,
 * como horário final depois do inicial, valem para todo mundo.
 */
export function assertSchedulingAllowed(input: SchedulingCheckInput): void {
  const { settings, dateStr, startsAt, endsAt, allDay, bypassPolicies } = input;
  const now = input.now ?? new Date();

  if (endsAt.getTime() <= startsAt.getTime()) {
    throw regraDeNegocio("O horário final deve ser depois do horário inicial.");
  }

  if (settings.requireTimeRange && allDay && !bypassPolicies) {
    throw regraDeNegocio(
      "Informe o horário inicial e o horário final da reserva.",
    );
  }

  if (bypassPolicies) return;

  const today = todayLocal();
  const daysAhead = diffDays(today, dateStr);

  if (daysAhead < 0) {
    throw regraDeNegocio("Não é possível reservar para uma data passada.");
  }

  if (daysAhead === 0 && !settings.allowSameDay) {
    throw regraDeNegocio(
      "Reservas para o mesmo dia não estão liberadas. Escolha uma data futura.",
    );
  }

  if (daysAhead > settings.maxAdvanceDays) {
    throw regraDeNegocio(
      `As reservas podem ser feitas com no máximo ${settings.maxAdvanceDays} dia(s) de antecedência.`,
    );
  }

  if (startsAt.getTime() <= now.getTime()) {
    throw regraDeNegocio(
      "O período escolhido já começou. Selecione um horário futuro.",
    );
  }

  const hoursAhead = (startsAt.getTime() - now.getTime()) / 3_600_000;
  if (settings.minAdvanceHours > 0 && hoursAhead < settings.minAdvanceHours) {
    throw regraDeNegocio(
      `A reserva precisa ser feita com pelo menos ${settings.minAdvanceHours} hora(s) de antecedência.`,
    );
  }

  if (!allDay) {
    assertWithinBusinessHours(settings, startsAt, endsAt);
  }
}

function toMinutes(time: string): number {
  const { hour, minute } = parseTimeOfDay(time);
  return hour * 60 + minute;
}

function assertWithinBusinessHours(
  settings: Settings,
  startsAt: Date,
  endsAt: Date,
): void {
  const opening = toMinutes(settings.openingTime);
  const closing = toMinutes(settings.closingTime);

  const startMinutes = toMinutes(toLocalTimeString(startsAt));
  // Uma reserva que termina exatamente à meia-noite representa o fim do dia.
  const endLocal = toLocalTimeString(endsAt);
  const endMinutes = endLocal === "00:00" ? 24 * 60 : toMinutes(endLocal);

  if (startMinutes < opening || endMinutes > closing) {
    throw regraDeNegocio(
      `As reservas só podem ocorrer entre ${settings.openingTime} e ${settings.closingTime}.`,
    );
  }
}

/** Limite de reservas ativas simultâneas por professor. */
export function assertWithinActiveLimit(
  settings: Settings,
  activeCount: number,
  bypassPolicies: boolean,
): void {
  if (bypassPolicies) return;
  if (settings.maxActiveReservationsPerUser === 0) return;
  if (activeCount >= settings.maxActiveReservationsPerUser) {
    throw regraDeNegocio(
      `Você já possui ${activeCount} reserva(s) ativa(s), o limite configurado. ` +
        "Cancele ou encerre uma reserva antes de criar outra.",
    );
  }
}

/** Quantidade de recursos em uma única reserva. */
export function assertResourceCount(
  settings: Settings,
  kitCount: number,
  notebookCount: number,
  bypassPolicies: boolean,
): void {
  const total = kitCount + notebookCount;

  if (total === 0) {
    throw regraDeNegocio("Selecione ao menos um kit ou notebook.");
  }

  if (
    !settings.allowMixedResourceReservation &&
    kitCount > 0 &&
    notebookCount > 0
  ) {
    throw regraDeNegocio(
      "Não é permitido combinar kits e notebooks avulsos na mesma reserva. Faça reservas separadas.",
    );
  }

  if (bypassPolicies) return;

  if (total > settings.maxResourcesPerReservation) {
    throw regraDeNegocio(
      `Uma reserva pode ter no máximo ${settings.maxResourcesPerReservation} recurso(s).`,
    );
  }
}

/**
 * Regras de cancelamento pelo professor.
 * A supervisão cancela sempre — precisa poder resolver imprevistos.
 */
export function assertCancellationAllowed(
  settings: Settings,
  reservation: { startsAt: Date; status: ReservationStatus },
  bypassPolicies: boolean,
  now = new Date(),
): void {
  if (isClosed(reservation.status)) {
    throw regraDeNegocio(
      `Esta reserva está "${RESERVATION_STATUS_LABEL[reservation.status]}" e não pode ser cancelada.`,
    );
  }

  if (bypassPolicies) return;

  const started = reservation.startsAt.getTime() <= now.getTime();
  if (started && !settings.allowCancelAfterStart) {
    throw regraDeNegocio(
      "A reserva já começou. Procure a supervisão para registrar a devolução ou o cancelamento.",
    );
  }

  if (settings.cancellationDeadlineHours > 0) {
    const hoursLeft = (reservation.startsAt.getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft < settings.cancellationDeadlineHours) {
      throw regraDeNegocio(
        `O cancelamento deve ser feito com pelo menos ${settings.cancellationDeadlineHours} hora(s) de antecedência. Procure a supervisão.`,
      );
    }
  }
}

/** Erro padronizado de conflito, com os dados que a interface usa. */
export function conflitoDeReserva(
  conflicts: unknown[],
  message = "Um ou mais recursos já estão reservados neste período.",
): AppError {
  return new AppError("CONFLITO_RESERVA", message, {
    details: { conflitos: conflicts },
  });
}
