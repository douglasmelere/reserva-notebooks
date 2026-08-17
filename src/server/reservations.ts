import { prisma } from "@/lib/db";
import { audit, diffChanges } from "@/lib/audit";
import { reservationCode, uniqueCode } from "@/lib/codes";
import {
  formatIntervalBR,
  reservationInterval,
  toLocalDateString,
  toLocalTimeString,
} from "@/lib/datetime";
import { naoEncontrado, regraDeNegocio, semPermissao } from "@/lib/errors";
import { getSettings } from "@/lib/settings";
import type { SessionUser } from "@/lib/session";
import type { Prisma } from "@/generated/prisma/client";
import type { ReservationStatus } from "@/generated/prisma/enums";
import {
  advisoryLockKey,
  kitIsReservable,
  kitKey,
  notebookIsReservable,
  notebookKey,
} from "./resources";
import {
  assertCancellationAllowed,
  assertResourceCount,
  assertSchedulingAllowed,
  assertTransition,
  assertWithinActiveLimit,
  BLOCKING_STATUSES,
  conflitoDeReserva,
  isClosed,
  statusBlocks,
} from "./reservation-policy";

/**
 * Serviço de reservas.
 *
 * Concentra as garantias que não podem ficar na interface: autorização,
 * políticas configuráveis e — principalmente — a ausência de conflito entre
 * reservas. A prevenção de conflito é feita em três camadas, deliberadamente
 * redundantes:
 *
 *  1. consulta de disponibilidade (boa experiência, sem garantia nenhuma);
 *  2. lock consultivo por recurso + reconsulta dentro da transação, que
 *     serializa requisições simultâneas e produz uma mensagem clara;
 *  3. restrição EXCLUDE no PostgreSQL, que recusa a gravação mesmo se as duas
 *     camadas acima falharem.
 *
 * Sem a camada 3, duas requisições simultâneas em processos diferentes ainda
 * poderiam gravar a mesma faixa; sem a camada 2, o usuário receberia um erro
 * de banco em vez de uma explicação.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ConflictInfo = {
  resourceKey: string;
  resourceLabel: string;
  reservationId: string;
  reservationCode: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  periodoFormatado: string;
  room: string | null;
  purpose: string | null;
  holder: {
    id: string;
    fullName: string;
    /** Se há telefone autorizado — o número em si nunca sai daqui. */
    whatsappDisponivel: boolean;
  };
};

export type CreateReservationInput = {
  actor: SessionUser;
  /** Dono da reserva. Só a supervisão pode informar outro usuário. */
  userId?: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  kitIds?: string[];
  notebookIds?: string[];
  purpose?: string | null;
  className?: string | null;
  subject?: string | null;
  room?: string | null;
  requestedNotebooks?: number | null;
  teacherNotes?: string | null;
  supervisorNotes?: string | null;
  status?: ReservationStatus;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Projeção interna de uma reserva.
 *
 * Inclui o telefone do docente porque a camada de serviço precisa dele para
 * decidir se há contato disponível. Ele NUNCA sai daqui: as rotas devolvem o
 * resultado por `serializeReservation` (src/server/whatsapp-contact.ts), que
 * remove o número e o substitui por um booleano. Sem essa serialização,
 * listar reservas viraria um jeito indireto de baixar a agenda telefônica
 * do corpo docente.
 */
const reservationInclude = {
  user: {
    select: {
      id: true,
      fullName: true,
      username: true,
      email: true,
      department: true,
      phone: true,
      whatsappOptIn: true,
    },
  },
  createdBy: { select: { id: true, fullName: true, username: true } },
  items: {
    include: {
      kit: {
        select: { id: true, code: true, name: true, type: true, status: true, capacity: true },
      },
      notebook: {
        select: { id: true, assetTag: true, nickname: true, status: true, kitId: true },
      },
    },
  },
} satisfies Prisma.ReservationInclude;

export type ReservationWithRelations = Prisma.ReservationGetPayload<{
  include: typeof reservationInclude;
}>;

// ---------------------------------------------------------------------------
// Consulta de conflitos
// ---------------------------------------------------------------------------

/**
 * Reservas ativas que ocupam algum dos recursos no intervalo informado.
 *
 * `excludeReservationId` permite editar uma reserva sem que ela conflite
 * consigo mesma.
 */
export async function findConflicts(
  resourceKeys: string[],
  startsAt: Date,
  endsAt: Date,
  options: {
    excludeReservationId?: string;
    client?: Prisma.TransactionClient;
  } = {},
): Promise<ConflictInfo[]> {
  if (resourceKeys.length === 0) return [];
  const client = options.client ?? prisma;

  const items = await client.reservationItem.findMany({
    where: {
      resourceKey: { in: resourceKeys },
      blocking: true,
      // Sobreposição de [início, fim): começa antes do nosso fim e termina
      // depois do nosso início. Encostar não é sobrepor.
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(options.excludeReservationId
        ? { reservationId: { not: options.excludeReservationId } }
        : {}),
      reservation: { status: { in: BLOCKING_STATUSES } },
    },
    include: {
      kit: { select: { name: true, code: true } },
      notebook: { select: { assetTag: true, nickname: true } },
      reservation: {
        select: {
          id: true,
          code: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          room: true,
          purpose: true,
          user: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              whatsappOptIn: true,
            },
          },
        },
      },
    },
    orderBy: { startsAt: "asc" },
  });

  return items.map((item) => ({
    resourceKey: item.resourceKey,
    resourceLabel: item.kit
      ? `${item.kit.name} (${item.kit.code})`
      : item.notebook
        ? `Notebook ${item.notebook.assetTag}${item.notebook.nickname ? ` — ${item.notebook.nickname}` : ""}`
        : item.resourceKey,
    reservationId: item.reservation.id,
    reservationCode: item.reservation.code,
    startsAt: item.reservation.startsAt.toISOString(),
    endsAt: item.reservation.endsAt.toISOString(),
    allDay: item.reservation.allDay,
    periodoFormatado: formatIntervalBR(
      item.reservation.startsAt,
      item.reservation.endsAt,
      item.reservation.allDay,
    ),
    room: item.reservation.room,
    purpose: item.reservation.purpose,
    holder: {
      id: item.reservation.user.id,
      fullName: item.reservation.user.fullName,
      whatsappDisponivel:
        item.reservation.user.whatsappOptIn &&
        Boolean(item.reservation.user.phone),
    },
  }));
}

/**
 * Trava os recursos até o fim da transação.
 *
 * Ordenar as chaves antes de travar evita deadlock: duas transações que
 * disputem os mesmos recursos os adquirem sempre na mesma ordem.
 */
async function lockResources(
  client: Prisma.TransactionClient,
  resourceKeys: string[],
): Promise<void> {
  for (const key of [...resourceKeys].sort()) {
    const lockId = advisoryLockKey(key).toString();
    // `pg_advisory_xact_lock` devolve `void`, tipo que o Prisma não sabe
    // desserializar em `$queryRaw`. Chamá-la no FROM e projetar um literal
    // adquire o lock do mesmo jeito e devolve uma coluna que o client entende.
    await client.$queryRaw`SELECT 1 AS travado FROM pg_advisory_xact_lock(${lockId}::bigint)`;
  }
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

export async function createReservation(
  input: CreateReservationInput,
): Promise<ReservationWithRelations> {
  const settings = await getSettings();
  const isSupervisor = input.actor.role === "SUPERVISOR";

  const ownerId = input.userId ?? input.actor.id;
  if (ownerId !== input.actor.id && !isSupervisor) {
    throw semPermissao("Você só pode criar reservas para você mesmo.");
  }

  const kitIds = [...new Set(input.kitIds ?? [])];
  const notebookIds = [...new Set(input.notebookIds ?? [])];

  assertResourceCount(settings, kitIds.length, notebookIds.length, isSupervisor);

  const { startsAt, endsAt, allDay, date } = reservationInterval(
    input.date,
    input.startTime,
    input.endTime,
  );

  assertSchedulingAllowed({
    settings,
    dateStr: input.date,
    startsAt,
    endsAt,
    allDay,
    bypassPolicies: isSupervisor,
  });

  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, active: true, fullName: true },
  });
  if (!owner) throw naoEncontrado("Professor não encontrado.");
  if (!owner.active) {
    throw regraDeNegocio("Não é possível reservar para uma conta desativada.");
  }

  const activeCount = await prisma.reservation.count({
    where: { userId: ownerId, status: { in: BLOCKING_STATUSES } },
  });
  assertWithinActiveLimit(settings, activeCount, isSupervisor);

  // --- Recursos: existem e estão em condição de serem reservados? ---------
  const [kits, notebooks] = await Promise.all([
    kitIds.length
      ? prisma.kit.findMany({
          where: { id: { in: kitIds } },
          include: { chargerKit: true },
        })
      : Promise.resolve([]),
    notebookIds.length
      ? prisma.notebook.findMany({ where: { id: { in: notebookIds } } })
      : Promise.resolve([]),
  ]);

  if (kits.length !== kitIds.length) {
    throw naoEncontrado("Um dos kits selecionados não existe mais.");
  }
  if (notebooks.length !== notebookIds.length) {
    throw naoEncontrado("Um dos notebooks selecionados não existe mais.");
  }

  for (const kit of kits) {
    if (!kitIsReservable(kit.status)) {
      throw regraDeNegocio(
        `"${kit.name}" não está disponível para reserva (${kit.status.toLowerCase()}).`,
      );
    }
    if (settings.requireCompleteChargerKit) {
      const charger = kit.chargerKit;
      if (!charger || charger.status !== "COMPLETO") {
        throw regraDeNegocio(
          `"${kit.name}" está com o kit de carregadores incompleto e a configuração atual exige kit completo. Procure a supervisão.`,
        );
      }
    }
  }

  for (const notebook of notebooks) {
    if (!notebookIsReservable(notebook.status)) {
      throw regraDeNegocio(
        `O notebook ${notebook.assetTag} não está disponível para reserva (${notebook.status.toLowerCase()}).`,
      );
    }
  }

  const resourceKeys = [
    ...kits.map((k) => kitKey(k.id)),
    ...notebooks.map((n) => notebookKey(n.id)),
  ];

  // O professor sempre cria já confirmada — não há fila de aprovação. Só a
  // supervisão pode abrir a reserva em outro status.
  const status: ReservationStatus =
    isSupervisor && input.status ? input.status : "CONFIRMADA";

  const code = await uniqueCode(reservationCode, async (candidate) =>
    Boolean(await prisma.reservation.findUnique({ where: { code: candidate } })),
  );

  return prisma.$transaction(async (tx) => {
    await lockResources(tx, resourceKeys);

    const conflicts = await findConflicts(resourceKeys, startsAt, endsAt, {
      client: tx,
    });
    if (conflicts.length > 0) throw conflitoDeReserva(conflicts);

    const blocking = statusBlocks(status);

    const created = await tx.reservation.create({
      data: {
        code,
        userId: ownerId,
        date,
        startsAt,
        endsAt,
        allDay,
        purpose: input.purpose ?? null,
        className: input.className ?? null,
        subject: input.subject ?? null,
        room: input.room ?? null,
        requestedNotebooks: input.requestedNotebooks ?? null,
        status,
        teacherNotes: input.teacherNotes ?? null,
        supervisorNotes: isSupervisor ? (input.supervisorNotes ?? null) : null,
        createdById: input.actor.id,
        items: {
          create: [
            ...kits.map((kit) => ({
              type: "KIT" as const,
              kitId: kit.id,
              resourceKey: kitKey(kit.id),
              startsAt,
              endsAt,
              blocking,
              quantity: input.requestedNotebooks ?? null,
            })),
            ...notebooks.map((notebook) => ({
              type: "NOTEBOOK" as const,
              notebookId: notebook.id,
              resourceKey: notebookKey(notebook.id),
              startsAt,
              endsAt,
              blocking,
            })),
          ],
        },
      },
      include: reservationInclude,
    });

    await audit(
      {
        actorId: input.actor.id,
        action: "reserva.criar",
        entity: "Reservation",
        entityId: created.id,
        summary: `Reserva ${created.code} criada para ${owner.fullName} — ${formatIntervalBR(startsAt, endsAt, allDay)}`,
        after: {
          code: created.code,
          status: created.status,
          startsAt,
          endsAt,
          allDay,
          recursos: resourceKeys,
        },
        ip: input.ip,
        userAgent: input.userAgent,
      },
      tx,
    );

    return created;
  });
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export type ReservationFilters = {
  userId?: string;
  status?: ReservationStatus[];
  from?: string;
  to?: string;
  kitId?: string;
  notebookId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export async function listReservations(
  filters: ReservationFilters,
  actor: SessionUser,
): Promise<{
  items: ReservationWithRelations[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  // Um professor nunca enxerga a lista completa, mesmo chamando a API direto.
  const scopedUserId =
    actor.role === "SUPERVISOR" ? filters.userId : actor.id;

  const where: Prisma.ReservationWhereInput = {
    ...(scopedUserId ? { userId: scopedUserId } : {}),
    ...(filters.status?.length ? { status: { in: filters.status } } : {}),
    ...(filters.from || filters.to
      ? {
          date: {
            ...(filters.from ? { gte: new Date(`${filters.from}T00:00:00Z`) } : {}),
            ...(filters.to ? { lte: new Date(`${filters.to}T00:00:00Z`) } : {}),
          },
        }
      : {}),
    ...(filters.kitId ? { items: { some: { kitId: filters.kitId } } } : {}),
    ...(filters.notebookId
      ? { items: { some: { notebookId: filters.notebookId } } }
      : {}),
    ...(filters.search
      ? {
          OR: [
            { code: { contains: filters.search, mode: "insensitive" } },
            { room: { contains: filters.search, mode: "insensitive" } },
            { purpose: { contains: filters.search, mode: "insensitive" } },
            { className: { contains: filters.search, mode: "insensitive" } },
            {
              user: {
                fullName: { contains: filters.search, mode: "insensitive" },
              },
            },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      include: reservationInclude,
      orderBy: [{ date: "desc" }, { startsAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.reservation.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getReservation(
  id: string,
  actor: SessionUser,
): Promise<ReservationWithRelations> {
  const reservation = await prisma.reservation.findUnique({
    where: { id },
    include: reservationInclude,
  });
  if (!reservation) throw naoEncontrado("Reserva não encontrada.");

  if (actor.role !== "SUPERVISOR" && reservation.userId !== actor.id) {
    // Mesma resposta de "não existe": não confirmamos a existência de uma
    // reserva de outro professor para quem tenta adivinhar identificadores.
    throw naoEncontrado("Reserva não encontrada.");
  }

  return reservation;
}

// ---------------------------------------------------------------------------
// Alteração
// ---------------------------------------------------------------------------

export type UpdateReservationInput = {
  date?: string;
  startTime?: string | null;
  endTime?: string | null;
  kitIds?: string[];
  notebookIds?: string[];
  purpose?: string | null;
  className?: string | null;
  subject?: string | null;
  room?: string | null;
  requestedNotebooks?: number | null;
  teacherNotes?: string | null;
  supervisorNotes?: string | null;
  status?: ReservationStatus;
  changeReason?: string | null;
};

export async function updateReservation(
  id: string,
  patch: UpdateReservationInput,
  actor: SessionUser,
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ReservationWithRelations> {
  const settings = await getSettings();
  const isSupervisor = actor.role === "SUPERVISOR";

  const existing = await prisma.reservation.findUnique({
    where: { id },
    include: reservationInclude,
  });
  if (!existing) throw naoEncontrado("Reserva não encontrada.");

  if (!isSupervisor) {
    if (existing.userId !== actor.id) {
      throw naoEncontrado("Reserva não encontrada.");
    }
    // O professor ajusta os dados da aula; mudar recurso ou período exige
    // recriar a reserva, para não driblar as regras de disponibilidade.
    const restricted = (
      ["date", "startTime", "endTime", "kitIds", "notebookIds", "status", "supervisorNotes"] as const
    ).filter((k) => patch[k] !== undefined);
    if (restricted.length > 0) {
      throw semPermissao(
        "Para mudar data, horário ou equipamentos, cancele esta reserva e crie uma nova.",
      );
    }
    if (isClosed(existing.status)) {
      throw regraDeNegocio("Esta reserva já foi encerrada e não pode ser alterada.");
    }
  }

  const nextStatus = patch.status ?? existing.status;
  if (patch.status) assertTransition(existing.status, patch.status);

  // --- Período -------------------------------------------------------------
  const dateChanged =
    patch.date !== undefined ||
    patch.startTime !== undefined ||
    patch.endTime !== undefined;

  let startsAt = existing.startsAt;
  let endsAt = existing.endsAt;
  let allDay = existing.allDay;
  let date = existing.date;

  if (dateChanged) {
    const dateStr = patch.date ?? toLocalDateString(existing.startsAt);
    // Ao trocar só a data, os horários vigentes são reaproveitados — por isso
    // são reconvertidos para "HH:MM" no fuso da instituição.
    const interval = reservationInterval(
      dateStr,
      patch.startTime !== undefined
        ? patch.startTime
        : existing.allDay
          ? null
          : toLocalTimeString(existing.startsAt),
      patch.endTime !== undefined
        ? patch.endTime
        : existing.allDay
          ? null
          : toLocalTimeString(existing.endsAt),
    );
    ({ startsAt, endsAt, allDay, date } = interval);

    assertSchedulingAllowed({
      settings,
      dateStr,
      startsAt,
      endsAt,
      allDay,
      bypassPolicies: isSupervisor,
    });
  }

  // --- Recursos ------------------------------------------------------------
  const resourcesChanged =
    patch.kitIds !== undefined || patch.notebookIds !== undefined;

  const currentKitIds = existing.items
    .filter((i) => i.kitId)
    .map((i) => i.kitId!);
  const currentNotebookIds = existing.items
    .filter((i) => i.notebookId)
    .map((i) => i.notebookId!);

  const kitIds = [...new Set(patch.kitIds ?? currentKitIds)];
  const notebookIds = [...new Set(patch.notebookIds ?? currentNotebookIds)];

  if (resourcesChanged) {
    assertResourceCount(settings, kitIds.length, notebookIds.length, isSupervisor);
  }

  const resourceKeys = [
    ...kitIds.map(kitKey),
    ...notebookIds.map(notebookKey),
  ];
  const blocking = statusBlocks(nextStatus);

  return prisma.$transaction(async (tx) => {
    if ((dateChanged || resourcesChanged) && blocking) {
      await lockResources(tx, resourceKeys);
      const conflicts = await findConflicts(resourceKeys, startsAt, endsAt, {
        excludeReservationId: id,
        client: tx,
      });
      if (conflicts.length > 0) throw conflitoDeReserva(conflicts);
    }

    if (resourcesChanged) {
      const [kits, notebooks] = await Promise.all([
        kitIds.length
          ? tx.kit.findMany({ where: { id: { in: kitIds } } })
          : Promise.resolve([]),
        notebookIds.length
          ? tx.notebook.findMany({ where: { id: { in: notebookIds } } })
          : Promise.resolve([]),
      ]);
      if (kits.length !== kitIds.length || notebooks.length !== notebookIds.length) {
        throw naoEncontrado("Um dos recursos selecionados não existe mais.");
      }

      await tx.reservationItem.deleteMany({ where: { reservationId: id } });
      await tx.reservationItem.createMany({
        data: [
          ...kits.map((kit) => ({
            reservationId: id,
            type: "KIT" as const,
            kitId: kit.id,
            resourceKey: kitKey(kit.id),
            startsAt,
            endsAt,
            blocking,
          })),
          ...notebooks.map((notebook) => ({
            reservationId: id,
            type: "NOTEBOOK" as const,
            notebookId: notebook.id,
            resourceKey: notebookKey(notebook.id),
            startsAt,
            endsAt,
            blocking,
          })),
        ],
      });
    } else if (dateChanged || patch.status) {
      // Os itens carregam cópia do período e do bloqueio; se mudou um dos
      // dois, eles precisam acompanhar — é isso que a restrição do banco lê.
      await tx.reservationItem.updateMany({
        where: { reservationId: id },
        data: { startsAt, endsAt, blocking },
      });
    }

    const data: Prisma.ReservationUpdateInput = {
      ...(dateChanged ? { date, startsAt, endsAt, allDay } : {}),
      ...(patch.purpose !== undefined ? { purpose: patch.purpose } : {}),
      ...(patch.className !== undefined ? { className: patch.className } : {}),
      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      ...(patch.room !== undefined ? { room: patch.room } : {}),
      ...(patch.requestedNotebooks !== undefined
        ? { requestedNotebooks: patch.requestedNotebooks }
        : {}),
      ...(patch.teacherNotes !== undefined
        ? { teacherNotes: patch.teacherNotes }
        : {}),
      ...(isSupervisor && patch.supervisorNotes !== undefined
        ? { supervisorNotes: patch.supervisorNotes }
        : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.status === "RETIRADA" && !existing.pickedUpAt
        ? { pickedUpAt: new Date() }
        : {}),
      ...(patch.status === "DEVOLVIDA" && !existing.returnedAt
        ? { returnedAt: new Date() }
        : {}),
    };

    const updated = await tx.reservation.update({
      where: { id },
      data,
      include: reservationInclude,
    });

    const changes = diffChanges(
      {
        status: existing.status,
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        room: existing.room,
        purpose: existing.purpose,
        className: existing.className,
        subject: existing.subject,
      },
      {
        status: updated.status,
        startsAt: updated.startsAt,
        endsAt: updated.endsAt,
        room: updated.room,
        purpose: updated.purpose,
        className: updated.className,
        subject: updated.subject,
      },
    );

    await audit(
      {
        actorId: actor.id,
        action: "reserva.atualizar",
        entity: "Reservation",
        entityId: id,
        summary:
          patch.changeReason ??
          (changes.changedKeys.length > 0
            ? `Alterado: ${changes.changedKeys.join(", ")}`
            : "Reserva atualizada"),
        before: { ...changes.before, ...(resourcesChanged ? { recursos: existing.items.map((i) => i.resourceKey) } : {}) },
        after: { ...changes.after, ...(resourcesChanged ? { recursos: resourceKeys } : {}) },
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Cancelamento e encerramento
// ---------------------------------------------------------------------------

export async function cancelReservation(
  id: string,
  reason: string | null,
  actor: SessionUser,
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ReservationWithRelations> {
  const settings = await getSettings();
  const isSupervisor = actor.role === "SUPERVISOR";

  const existing = await prisma.reservation.findUnique({ where: { id } });
  if (!existing) throw naoEncontrado("Reserva não encontrada.");
  if (!isSupervisor && existing.userId !== actor.id) {
    throw naoEncontrado("Reserva não encontrada.");
  }

  assertCancellationAllowed(settings, existing, isSupervisor);

  return prisma.$transaction(async (tx) => {
    // Liberar os itens é o que devolve o recurso à disponibilidade.
    await tx.reservationItem.updateMany({
      where: { reservationId: id },
      data: { blocking: false },
    });

    const updated = await tx.reservation.update({
      where: { id },
      data: {
        status: "CANCELADA",
        cancelledAt: new Date(),
        cancelReason: reason,
      },
      include: reservationInclude,
    });

    await audit(
      {
        actorId: actor.id,
        action: "reserva.cancelar",
        entity: "Reservation",
        entityId: id,
        summary: reason
          ? `Reserva ${updated.code} cancelada: ${reason}`
          : `Reserva ${updated.code} cancelada`,
        before: { status: existing.status },
        after: { status: "CANCELADA", motivo: reason },
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );

    return updated;
  });
}

export type CloseReservationInput = {
  /** `true` quando o professor confirma que ocorreu tudo bem. */
  allGood: boolean;
  notes?: string | null;
  status?: Extract<ReservationStatus, "DEVOLVIDA" | "ENCERRADA" | "NAO_COMPARECEU">;
};

export async function closeReservation(
  id: string,
  input: CloseReservationInput,
  actor: SessionUser,
  context: { ip?: string | null; userAgent?: string | null } = {},
): Promise<ReservationWithRelations> {
  const isSupervisor = actor.role === "SUPERVISOR";

  const existing = await prisma.reservation.findUnique({ where: { id } });
  if (!existing) throw naoEncontrado("Reserva não encontrada.");
  if (!isSupervisor && existing.userId !== actor.id) {
    throw naoEncontrado("Reserva não encontrada.");
  }
  if (isClosed(existing.status)) {
    throw regraDeNegocio("Esta reserva já foi encerrada.");
  }

  const status = input.status ?? "ENCERRADA";
  assertTransition(existing.status, status);

  return prisma.$transaction(async (tx) => {
    await tx.reservationItem.updateMany({
      where: { reservationId: id },
      data: { blocking: false },
    });

    const updated = await tx.reservation.update({
      where: { id },
      data: {
        status,
        closedAt: new Date(),
        returnedAt: existing.returnedAt ?? new Date(),
        ...(input.notes
          ? isSupervisor
            ? { supervisorNotes: input.notes }
            : { teacherNotes: input.notes }
          : {}),
      },
      include: reservationInclude,
    });

    await audit(
      {
        actorId: actor.id,
        action: "reserva.encerrar",
        entity: "Reservation",
        entityId: id,
        summary: input.allGood
          ? `Reserva ${updated.code} encerrada sem problemas`
          : `Reserva ${updated.code} encerrada com ocorrência registrada`,
        before: { status: existing.status },
        after: { status, semProblemas: input.allGood },
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );

    return updated;
  });
}

/** Reservas do professor que ainda estão em aberto. */
export async function myActiveReservations(userId: string) {
  return prisma.reservation.findMany({
    where: { userId, status: { in: BLOCKING_STATUSES } },
    include: reservationInclude,
    orderBy: [{ startsAt: "asc" }],
  });
}
