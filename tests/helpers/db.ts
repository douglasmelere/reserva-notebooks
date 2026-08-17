import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { invalidateSettingsCache } from "@/lib/settings";
import { reservationInterval } from "@/lib/datetime";
import { kitKey, notebookKey } from "@/server/resources";
import type { SessionUser } from "@/lib/session";
import type { Role } from "@/generated/prisma/enums";

/**
 * Auxiliares dos testes de integração.
 *
 * Os testes rodam contra um PostgreSQL de verdade, e não contra um banco
 * simulado, por um motivo específico: a garantia central do sistema — duas
 * pessoas não conseguirem reservar o mesmo recurso ao mesmo tempo — depende de
 * uma restrição EXCLUDE e de transações. Um mock devolveria "passou" para o
 * caso que mais importa testar.
 */

/**
 * Limpa todas as tabelas preservando o schema.
 *
 * Usa DELETE em ordem de dependência, e não TRUNCATE: o TRUNCATE precisa de
 * ACCESS EXCLUSIVE em todas as tabelas de uma vez e entra em deadlock com
 * qualquer conexão do pool que ainda esteja finalizando a transação do teste
 * anterior. O DELETE pega locks por linha e convive com isso.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.whatsappContactLog.deleteMany(),
    prisma.incidentAttachment.deleteMany(),
    prisma.incident.deleteMany(),
    prisma.reservationItem.deleteMany(),
    prisma.reservation.deleteMany(),
    prisma.auditLog.deleteMany(),
    prisma.loginAttempt.deleteMany(),
    prisma.session.deleteMany(),
    prisma.notebook.deleteMany(),
    prisma.chargerKit.deleteMany(),
    prisma.kit.deleteMany(),
    prisma.systemSetting.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  invalidateSettingsCache();
}

let userCounter = 0;

export async function createTestUser(
  overrides: Partial<{
    username: string;
    fullName: string;
    role: Role;
    active: boolean;
    phone: string | null;
    whatsappOptIn: boolean;
    password: string;
  }> = {},
) {
  userCounter += 1;
  const username = overrides.username ?? `usuario${userCounter}`;
  const password = overrides.password ?? "senha-de-teste-123";

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: await hashPassword(password),
      fullName: overrides.fullName ?? `Professor ${userCounter}`,
      role: overrides.role ?? "PROFESSOR",
      active: overrides.active ?? true,
      phone: overrides.phone === undefined ? null : overrides.phone,
      whatsappOptIn: overrides.whatsappOptIn ?? false,
    },
  });

  return { user, password };
}

/** Converte um registro de usuário no formato que os serviços recebem. */
export function toSessionUser(user: {
  id: string;
  username: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  whatsappOptIn?: boolean;
  department?: string | null;
  role: Role;
  active?: boolean;
  mustChangePassword?: boolean;
}): SessionUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email ?? null,
    phone: user.phone ?? null,
    whatsappOptIn: user.whatsappOptIn ?? false,
    department: user.department ?? null,
    role: user.role,
    active: user.active ?? true,
    mustChangePassword: user.mustChangePassword ?? false,
  };
}

let kitCounter = 0;

export async function createTestKit(
  overrides: Partial<{
    code: string;
    name: string;
    type: "MALETA" | "CARRINHO";
    capacity: number;
    status: "DISPONIVEL" | "MANUTENCAO" | "INDISPONIVEL" | "DESATIVADO";
    location: string | null;
  }> = {},
) {
  kitCounter += 1;
  return prisma.kit.create({
    data: {
      code: overrides.code ?? `KIT-${kitCounter}`,
      name: overrides.name ?? `Kit de teste ${kitCounter}`,
      type: overrides.type ?? "MALETA",
      capacity: overrides.capacity ?? 10,
      status: overrides.status ?? "DISPONIVEL",
      location: overrides.location ?? "Sala de testes",
    },
  });
}

let notebookCounter = 0;

export async function createTestNotebook(
  overrides: Partial<{
    assetTag: string;
    kitId: string | null;
    status:
      | "DISPONIVEL"
      | "RESERVADO"
      | "EM_USO"
      | "MANUTENCAO"
      | "PERDIDO"
      | "INDISPONIVEL"
      | "DESATIVADO";
  }> = {},
) {
  notebookCounter += 1;
  return prisma.notebook.create({
    data: {
      assetTag: overrides.assetTag ?? `NB-TESTE-${notebookCounter}`,
      kitId: overrides.kitId ?? null,
      status: overrides.status ?? "DISPONIVEL",
    },
  });
}

export async function createTestChargerKit(
  kitId: string,
  overrides: Partial<{ total: number; available: number }> = {},
) {
  const total = overrides.total ?? 10;
  const available = overrides.available ?? total;
  return prisma.chargerKit.create({
    data: {
      code: `CARG-${kitId.slice(0, 8)}`,
      kitId,
      totalQuantity: total,
      availableQuantity: available,
      status: available >= total ? "COMPLETO" : "INCOMPLETO",
    },
  });
}

/**
 * Cria uma reserva direto no banco, sem passar pelas regras de negócio.
 * Útil para montar o estado inicial de um cenário — por exemplo, "já existe uma
 * reserva neste horário" — sem depender das políticas configuradas.
 */
export async function seedReservation(input: {
  userId: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  kitIds?: string[];
  notebookIds?: string[];
  status?: "CONFIRMADA" | "CANCELADA" | "ENCERRADA" | "EM_USO";
  code?: string;
}) {
  const { startsAt, endsAt, allDay, date } = reservationInterval(
    input.date,
    input.startTime,
    input.endTime,
  );
  const status = input.status ?? "CONFIRMADA";
  const blocking = status === "CONFIRMADA" || status === "EM_USO";

  return prisma.reservation.create({
    data: {
      code: input.code ?? `RS-T${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      userId: input.userId,
      date,
      startsAt,
      endsAt,
      allDay,
      status,
      items: {
        create: [
          ...(input.kitIds ?? []).map((kitId) => ({
            type: "KIT" as const,
            kitId,
            resourceKey: kitKey(kitId),
            startsAt,
            endsAt,
            blocking,
          })),
          ...(input.notebookIds ?? []).map((notebookId) => ({
            type: "NOTEBOOK" as const,
            notebookId,
            resourceKey: notebookKey(notebookId),
            startsAt,
            endsAt,
            blocking,
          })),
        ],
      },
    },
    include: { items: true },
  });
}

/** Data futura em "AAAA-MM-DD", a N dias de hoje. */
export function futureDate(daysAhead = 7): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return d.toISOString().slice(0, 10);
}
