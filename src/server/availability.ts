import { prisma } from "@/lib/db";
import { dayBounds, formatIntervalBR, reservationInterval } from "@/lib/datetime";
import type { Prisma } from "@/generated/prisma/client";
import type { KitStatus, KitType, NotebookStatus } from "@/generated/prisma/enums";
import {
  KIT_STATUS_LABEL,
  NOTEBOOK_STATUS_LABEL,
  kitIsReservable,
  kitKey,
  notebookIsReservable,
  notebookKey,
} from "./resources";
import { BLOCKING_STATUSES } from "./reservation-policy";

/**
 * Consulta de disponibilidade.
 *
 * Devolve, para cada recurso, o estado no período consultado e — quando
 * ocupado — quem está com ele. Os dados do ocupante são deliberadamente
 * enxutos: nome do docente, período, sala e finalidade, que é o que a
 * especificação considera apropriado no contexto institucional. Telefone,
 * e-mail e qualquer outro dado pessoal ficam de fora; a existência de contato
 * por WhatsApp aparece apenas como um booleano.
 */

export type Occupation = {
  reservationId: string;
  reservationCode: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  periodoFormatado: string;
  room: string | null;
  purpose: string | null;
  className: string | null;
  holder: {
    id: string;
    fullName: string;
    whatsappDisponivel: boolean;
  };
};

/** Estado de um recurso no período consultado. */
export type AvailabilityState =
  | "DISPONIVEL"
  | "RESERVADO"
  | "MANUTENCAO"
  | "INDISPONIVEL";

export type KitAvailability = {
  kind: "kit";
  id: string;
  code: string;
  name: string;
  type: KitType;
  capacity: number;
  notebookCount: number;
  location: string | null;
  status: KitStatus;
  statusLabel: string;
  state: AvailabilityState;
  chargerKit: {
    id: string;
    code: string;
    totalQuantity: number;
    availableQuantity: number;
    status: string;
    completo: boolean;
  } | null;
  occupations: Occupation[];
};

export type NotebookAvailability = {
  kind: "notebook";
  id: string;
  assetTag: string;
  nickname: string | null;
  brand: string | null;
  model: string | null;
  kitId: string | null;
  kitName: string | null;
  status: NotebookStatus;
  statusLabel: string;
  state: AvailabilityState;
  occupations: Occupation[];
};

export type AvailabilityResult = {
  periodo: {
    date: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    formatado: string;
  };
  kits: KitAvailability[];
  notebooks: NotebookAvailability[];
  resumo: {
    kitsDisponiveis: number;
    kitsReservados: number;
    kitsIndisponiveis: number;
    notebooksDisponiveis: number;
    notebooksReservados: number;
    notebooksIndisponiveis: number;
  };
};

export type AvailabilityQuery = {
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  /** Filtra por tipo de kit. Ausente = maletas e carrinhos. */
  kitType?: KitType;
  location?: string;
  minCapacity?: number;
  /** `true` inclui recursos em manutenção/desativados (visão da supervisão). */
  includeUnavailable?: boolean;
  /** `true` traz também notebooks avulsos (fora de kit) apenas. */
  onlyStandaloneNotebooks?: boolean;
  search?: string;
};

function mapOccupation(item: {
  reservation: {
    id: string;
    code: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    room: string | null;
    purpose: string | null;
    className: string | null;
    user: {
      id: string;
      fullName: string;
      phone: string | null;
      whatsappOptIn: boolean;
    };
  };
}): Occupation {
  const r = item.reservation;
  return {
    reservationId: r.id,
    reservationCode: r.code,
    startsAt: r.startsAt.toISOString(),
    endsAt: r.endsAt.toISOString(),
    allDay: r.allDay,
    periodoFormatado: formatIntervalBR(r.startsAt, r.endsAt, r.allDay),
    room: r.room,
    purpose: r.purpose,
    className: r.className,
    holder: {
      id: r.user.id,
      fullName: r.user.fullName,
      whatsappDisponivel: r.user.whatsappOptIn && Boolean(r.user.phone),
    },
  };
}

/**
 * Disponibilidade de todos os recursos em um período.
 *
 * Faz três consultas (kits, notebooks, ocupações) e cruza em memória, em vez
 * de uma consulta por recurso. O inventário de uma escola é da ordem de
 * centenas de itens; carregar tudo de uma vez é mais rápido e mantém o código
 * simples.
 */
export async function getAvailability(
  query: AvailabilityQuery,
): Promise<AvailabilityResult> {
  const { startsAt, endsAt, allDay } = reservationInterval(
    query.date,
    query.startTime,
    query.endTime,
  );

  const kitWhere: Prisma.KitWhereInput = {
    ...(query.kitType ? { type: query.kitType } : {}),
    ...(query.location
      ? { location: { contains: query.location, mode: "insensitive" } }
      : {}),
    ...(query.minCapacity ? { capacity: { gte: query.minCapacity } } : {}),
    ...(query.includeUnavailable
      ? {}
      : { status: { notIn: ["DESATIVADO"] satisfies KitStatus[] } }),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { code: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const notebookWhere: Prisma.NotebookWhereInput = {
    ...(query.includeUnavailable
      ? {}
      : { status: { notIn: ["DESATIVADO"] satisfies NotebookStatus[] } }),
    ...(query.onlyStandaloneNotebooks ? { kitId: null } : {}),
    ...(query.location
      ? { kit: { location: { contains: query.location, mode: "insensitive" } } }
      : {}),
    ...(query.search
      ? {
          OR: [
            { assetTag: { contains: query.search, mode: "insensitive" } },
            { nickname: { contains: query.search, mode: "insensitive" } },
            { serialNumber: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [kits, notebooks, occupiedItems] = await Promise.all([
    prisma.kit.findMany({
      where: kitWhere,
      include: {
        chargerKit: true,
        _count: { select: { notebooks: true } },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
    prisma.notebook.findMany({
      where: notebookWhere,
      include: { kit: { select: { id: true, name: true } } },
      orderBy: { assetTag: "asc" },
    }),
    prisma.reservationItem.findMany({
      where: {
        blocking: true,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
        reservation: { status: { in: BLOCKING_STATUSES } },
      },
      select: {
        resourceKey: true,
        reservation: {
          select: {
            id: true,
            code: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            room: true,
            purpose: true,
            className: true,
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
    }),
  ]);

  const occupationsByResource = new Map<string, Occupation[]>();
  for (const item of occupiedItems) {
    const list = occupationsByResource.get(item.resourceKey) ?? [];
    list.push(mapOccupation(item));
    occupationsByResource.set(item.resourceKey, list);
  }

  const kitResults: KitAvailability[] = kits.map((kit) => {
    const occupations = occupationsByResource.get(kitKey(kit.id)) ?? [];
    const state: AvailabilityState = !kitIsReservable(kit.status)
      ? kit.status === "MANUTENCAO"
        ? "MANUTENCAO"
        : "INDISPONIVEL"
      : occupations.length > 0
        ? "RESERVADO"
        : "DISPONIVEL";

    return {
      kind: "kit",
      id: kit.id,
      code: kit.code,
      name: kit.name,
      type: kit.type,
      capacity: kit.capacity,
      notebookCount: kit._count.notebooks,
      location: kit.location,
      status: kit.status,
      statusLabel: KIT_STATUS_LABEL[kit.status],
      state,
      chargerKit: kit.chargerKit
        ? {
            id: kit.chargerKit.id,
            code: kit.chargerKit.code,
            totalQuantity: kit.chargerKit.totalQuantity,
            availableQuantity: kit.chargerKit.availableQuantity,
            status: kit.chargerKit.status,
            completo: kit.chargerKit.status === "COMPLETO",
          }
        : null,
      occupations,
    };
  });

  const notebookResults: NotebookAvailability[] = notebooks.map((notebook) => {
    const occupations = occupationsByResource.get(notebookKey(notebook.id)) ?? [];

    // Um notebook dentro de um kit reservado também está ocupado, mesmo sem
    // reserva própria: quem levou a maleta levou o notebook junto.
    const kitOccupations = notebook.kitId
      ? (occupationsByResource.get(kitKey(notebook.kitId)) ?? [])
      : [];
    const allOccupations = [...occupations, ...kitOccupations];

    const state: AvailabilityState = !notebookIsReservable(notebook.status)
      ? notebook.status === "MANUTENCAO"
        ? "MANUTENCAO"
        : "INDISPONIVEL"
      : allOccupations.length > 0
        ? "RESERVADO"
        : "DISPONIVEL";

    return {
      kind: "notebook",
      id: notebook.id,
      assetTag: notebook.assetTag,
      nickname: notebook.nickname,
      brand: notebook.brand,
      model: notebook.model,
      kitId: notebook.kitId,
      kitName: notebook.kit?.name ?? null,
      status: notebook.status,
      statusLabel: NOTEBOOK_STATUS_LABEL[notebook.status],
      state,
      occupations: allOccupations,
    };
  });

  const count = <T extends { state: AvailabilityState }>(
    list: T[],
    state: AvailabilityState | "INDISPONIVEL_TOTAL",
  ) =>
    state === "INDISPONIVEL_TOTAL"
      ? list.filter((r) => r.state === "MANUTENCAO" || r.state === "INDISPONIVEL")
          .length
      : list.filter((r) => r.state === state).length;

  return {
    periodo: {
      date: query.date,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      allDay,
      formatado: formatIntervalBR(startsAt, endsAt, allDay),
    },
    kits: kitResults,
    notebooks: notebookResults,
    resumo: {
      kitsDisponiveis: count(kitResults, "DISPONIVEL"),
      kitsReservados: count(kitResults, "RESERVADO"),
      kitsIndisponiveis: count(kitResults, "INDISPONIVEL_TOTAL"),
      notebooksDisponiveis: count(notebookResults, "DISPONIVEL"),
      notebooksReservados: count(notebookResults, "RESERVADO"),
      notebooksIndisponiveis: count(notebookResults, "INDISPONIVEL_TOTAL"),
    },
  };
}

/**
 * Ocupação agregada por dia, para as visões semanal e mensal do calendário.
 * Evita uma chamada de disponibilidade por dia da grade.
 */
export type DayOccupancy = {
  date: string;
  totalReservas: number;
  kitsOcupados: number;
  notebooksOcupados: number;
};

export async function getOccupancyByDay(
  fromDate: string,
  toDate: string,
): Promise<DayOccupancy[]> {
  const { start } = dayBounds(fromDate);
  const { end } = dayBounds(toDate);

  const items = await prisma.reservationItem.findMany({
    where: {
      blocking: true,
      startsAt: { lt: end },
      endsAt: { gt: start },
      reservation: { status: { in: BLOCKING_STATUSES } },
    },
    select: {
      type: true,
      reservationId: true,
      reservation: { select: { date: true } },
    },
  });

  const byDate = new Map<
    string,
    { reservas: Set<string>; kits: number; notebooks: number }
  >();

  for (const item of items) {
    const key = item.reservation.date.toISOString().slice(0, 10);
    const entry = byDate.get(key) ?? {
      reservas: new Set<string>(),
      kits: 0,
      notebooks: 0,
    };
    entry.reservas.add(item.reservationId);
    if (item.type === "KIT") entry.kits += 1;
    else entry.notebooks += 1;
    byDate.set(key, entry);
  }

  return [...byDate.entries()]
    .map(([date, entry]) => ({
      date,
      totalReservas: entry.reservas.size,
      kitsOcupados: entry.kits,
      notebooksOcupados: entry.notebooks,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
