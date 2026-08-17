import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit, diffChanges } from "@/lib/audit";
import { formatIntervalBR } from "@/lib/datetime";
import { conflito, naoEncontrado, regraDeNegocio, semPermissao } from "@/lib/errors";
import type { SessionUser } from "@/lib/session";
import {
  bulkCreateNotebooksSchema,
  createNotebookSchema,
  notebookStatusSchema,
  paginationSchema,
  updateNotebookSchema,
} from "@/lib/validation";
import type { Prisma } from "@/generated/prisma/client";
import type {
  KitStatus,
  KitType,
  NotebookStatus,
  ReservationStatus,
} from "@/generated/prisma/enums";
import { NOTEBOOK_STATUS_LABEL, kitKey, notebookKey } from "./resources";
import { BLOCKING_STATUSES, RESERVATION_STATUS_LABEL } from "./reservation-policy";
import { assertKitCapacity } from "./kits";

/**
 * Serviço de notebooks individuais.
 *
 * Duas decisões atravessam o módulo inteiro:
 *
 *  1. O inventário é histórico. Um notebook que já apareceu em reservas e
 *     ocorrências nunca é apagado: ele vai para `DESATIVADO`. Apagar de verdade
 *     quebraria a trilha de auditoria e as reservas passadas que o referenciam
 *     (`onDelete: Restrict` no vínculo com `ReservationItem` deixa isso
 *     explícito no próprio banco).
 *
 *  2. Mudar o status de um notebook NUNCA mexe nas reservas. Marcar um
 *     equipamento como quebrado é um fato operacional; decidir o que fazer com
 *     as aulas já agendadas é uma decisão humana. Por isso toda mutação devolve
 *     `reservasFuturasAtivas` e um `aviso` — a supervisão vê o impacto e
 *     escolhe remanejar ou cancelar, em vez de descobrir depois que reservas
 *     sumiram sozinhas.
 */

// ---------------------------------------------------------------------------
// Tipos de entrada (derivados dos esquemas Zod para não haver divergência)
// ---------------------------------------------------------------------------

export type CreateNotebookInput = z.infer<typeof createNotebookSchema>;
export type UpdateNotebookInput = z.infer<typeof updateNotebookSchema>;
export type BulkCreateNotebooksInput = z.infer<typeof bulkCreateNotebooksSchema>;

/** Contexto de auditoria comum a todas as mutações. */
export type MutationContext = {
  ip?: string | null;
  userAgent?: string | null;
  /**
   * Sobrescreve a ação gravada na auditoria. Transferência e mudança de status
   * passam pelo mesmo caminho de escrita, mas precisam aparecer no histórico
   * com o nome do que de fato aconteceu.
   */
  action?: string;
  /** Motivo informado pela supervisão, quando houver. */
  reason?: string | null;
};

/** Filtros da listagem. */
export type NotebookFilters = {
  status?: NotebookStatus[];
  kitId?: string;
  /** `true` traz apenas notebooks avulsos (sem kit). */
  avulsos?: boolean;
  /** Busca por patrimônio, número de série ou apelido. */
  search?: string;
  page?: number;
  pageSize?: number;
};

/**
 * Esquema da query de listagem.
 *
 * Fica aqui, e não em `lib/validation.ts`, porque só a rota de notebooks a usa;
 * os esquemas de corpo (create/update/bulk) continuam sendo os compartilhados.
 */
export const listNotebooksQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(80).optional(),
  status: z
    .union([notebookStatusSchema, z.array(notebookStatusSchema)])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  kitId: z.string().trim().min(1).optional(),
  avulsos: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((v) => v === true || v === "true"),
});

// ---------------------------------------------------------------------------
// Formato das respostas
// ---------------------------------------------------------------------------

const notebookInclude = {
  kit: {
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      status: true,
      capacity: true,
      location: true,
    },
  },
  _count: { select: { incidents: true, reservationItems: true } },
} satisfies Prisma.NotebookInclude;

type NotebookRecord = Prisma.NotebookGetPayload<{ include: typeof notebookInclude }>;

export type NotebookListItem = {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  nickname: string | null;
  brand: string | null;
  model: string | null;
  status: NotebookStatus;
  statusLabel: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  kit: {
    id: string;
    code: string;
    name: string;
    type: KitType;
    status: KitStatus;
    capacity: number;
    location: string | null;
  } | null;
  totalOcorrencias: number;
  totalReservas: number;
};

/** Reserva ativa que ocupa o notebook, direta ou pelo kit em que ele está. */
export type NotebookReservationSummary = {
  reservationId: string;
  code: string;
  status: ReservationStatus;
  statusLabel: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  periodoFormatado: string;
  room: string | null;
  /** `KIT` significa que a reserva é do kit inteiro, não deste notebook. */
  origem: "NOTEBOOK" | "KIT";
  /** Só nome e id: telefone e e-mail de terceiros nunca saem da API. */
  docente: { id: string; fullName: string };
};

export type NotebookIncidentSummary = {
  id: string;
  code: string;
  category: string;
  severity: string;
  status: string;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
  reportedBy: { id: string; fullName: string } | null;
};

export type NotebookDetail = NotebookListItem & {
  ocorrenciasRecentes: NotebookIncidentSummary[];
  reservasAtivas: NotebookReservationSummary[];
  /** Reservas do kit que contém o notebook — ele vai junto na maleta. */
  reservasDoKit: NotebookReservationSummary[];
  reservasFuturasAtivas: number;
};

/**
 * Resultado padrão de toda mutação.
 *
 * `reservasFuturasAtivas` e `aviso` existem para cumprir a regra de que mudar
 * status não cancela reserva: a resposta informa o impacto para a supervisão
 * decidir.
 */
export type NotebookMutationResult = {
  notebook: NotebookListItem;
  reservasFuturasAtivas: number;
  aviso: string | null;
};

function toListItem(record: NotebookRecord): NotebookListItem {
  return {
    id: record.id,
    assetTag: record.assetTag,
    serialNumber: record.serialNumber,
    nickname: record.nickname,
    brand: record.brand,
    model: record.model,
    status: record.status,
    statusLabel: NOTEBOOK_STATUS_LABEL[record.status],
    notes: record.notes,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    kit: record.kit
      ? {
          id: record.kit.id,
          code: record.kit.code,
          name: record.kit.name,
          type: record.kit.type,
          status: record.kit.status,
          capacity: record.kit.capacity,
          location: record.kit.location,
        }
      : null,
    totalOcorrencias: record._count.incidents,
    totalReservas: record._count.reservationItems,
  };
}

// ---------------------------------------------------------------------------
// Regras auxiliares
// ---------------------------------------------------------------------------

/**
 * Autorização redundante de propósito.
 *
 * As rotas já chamam `requireSupervisor()`, mas o serviço também é usado por
 * outros domínios (ocorrências bloqueiam um notebook, por exemplo). Repetir a
 * checagem aqui garante que nenhum caminho de chamada futuro escape dela.
 */
function assertSupervisor(actor: SessionUser): void {
  if (actor.role !== "SUPERVISOR") {
    throw semPermissao("Apenas a supervisão pode alterar o inventário.");
  }
}

/**
 * Status que tiram o notebook de circulação.
 * Entrar em um deles é exatamente quando a supervisão precisa saber quantas
 * reservas futuras dependem do equipamento.
 */
const STATUSES_QUE_IMPACTAM_RESERVAS: NotebookStatus[] = [
  "MANUTENCAO",
  "PERDIDO",
  "INDISPONIVEL",
  "DESATIVADO",
];

/**
 * Reservas ativas e futuras que ocupam um recurso.
 *
 * Conta reservas, não itens: uma reserva que use o mesmo recurso duas vezes
 * (impossível hoje pela chave única, mas barato de blindar) contaria dobrado.
 * Recebe a `resourceKey` — e não um id — para servir igualmente a kits,
 * notebooks e ao que mais vier a ser reservável.
 */
export async function countActiveFutureReservations(
  resourceKey: string,
  options: { now?: Date; client?: Prisma.TransactionClient } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const client = options.client ?? prisma;

  return client.reservation.count({
    where: {
      status: { in: BLOCKING_STATUSES },
      // "Futura" no sentido de ainda não terminada: uma reserva em curso
      // também é impactada por tirar o equipamento de circulação.
      endsAt: { gt: now },
      items: { some: { resourceKey, blocking: true } },
    },
  });
}

/**
 * Porta de entrada para vincular notebooks a um kit.
 *
 * A conta de capacidade em si é de `src/server/kits.ts` — deixá-la lá evita
 * duas implementações da mesma regra divergindo com o tempo. O que é próprio
 * do domínio de notebooks fica aqui: um kit desativado não recebe equipamento
 * novo, nem mesmo com confirmação de excesso, porque o problema não é o número
 * de vagas e sim o kit ter saído de operação.
 */
async function assertKitCanReceive(
  kitId: string,
  novosNotebooks: number,
  confirmou: boolean,
): Promise<void> {
  const kit = await prisma.kit.findUnique({
    where: { id: kitId },
    select: { id: true, name: true, status: true },
  });
  if (!kit) throw naoEncontrado("Kit não encontrado.");
  if (kit.status === "DESATIVADO") {
    throw regraDeNegocio(
      `O kit "${kit.name}" está desativado e não pode receber notebooks. Reative-o ou escolha outro kit.`,
    );
  }

  await assertKitCapacity(kitId, novosNotebooks, confirmou);
}

/** Recusa patrimônio/série já usados por outro notebook, com mensagem útil. */
async function assertIdentifiersFree(
  assetTag: string | undefined,
  serialNumber: string | null | undefined,
  ignoreId: string | null,
  client: Prisma.TransactionClient,
): Promise<void> {
  if (assetTag) {
    const existing = await client.notebook.findFirst({
      where: { assetTag, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
      select: { id: true, assetTag: true, status: true },
    });
    if (existing) {
      throw conflito(
        `Já existe um notebook com o patrimônio ${assetTag}${
          existing.status === "DESATIVADO" ? " (desativado)" : ""
        }.`,
        { campo: "assetTag", notebookId: existing.id },
      );
    }
  }

  if (serialNumber) {
    const existing = await client.notebook.findFirst({
      where: { serialNumber, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
      select: { id: true, assetTag: true },
    });
    if (existing) {
      throw conflito(
        `O número de série ${serialNumber} já está cadastrado no notebook ${existing.assetTag}.`,
        { campo: "serialNumber", notebookId: existing.id },
      );
    }
  }
}

/** Mensagem de impacto quando o notebook sai de circulação com reservas em pé. */
function buildAviso(status: NotebookStatus, reservas: number): string | null {
  if (reservas === 0) return null;
  if (!STATUSES_QUE_IMPACTAM_RESERVAS.includes(status)) return null;

  return (
    `Este notebook está em ${reservas} reserva(s) ativa(s) que ainda não terminaram. ` +
    `Elas NÃO foram canceladas: avalie com a supervisão se é preciso remanejar o equipamento ou cancelar as reservas.`
  );
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export async function listNotebooks(
  filters: NotebookFilters,
  actor: SessionUser,
): Promise<{
  items: NotebookListItem[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const isSupervisor = actor.role === "SUPERVISOR";

  // Notebook desativado é registro de inventário, não equipamento: some da
  // lista do professor mesmo que ele peça o filtro na mão. Quando o professor
  // pede exatamente `DESATIVADO`, a lista resultante fica vazia — que é a
  // resposta correta, e não "sem filtro".
  const statusFilter = isSupervisor
    ? filters.status
    : (filters.status ?? []).length > 0
      ? filters.status!.filter((s) => s !== "DESATIVADO")
      : (Object.keys(NOTEBOOK_STATUS_LABEL) as NotebookStatus[]).filter(
          (s) => s !== "DESATIVADO",
        );

  const where: Prisma.NotebookWhereInput = {
    ...(statusFilter ? { status: { in: statusFilter } } : {}),
    ...(filters.avulsos ? { kitId: null } : filters.kitId ? { kitId: filters.kitId } : {}),
    ...(filters.search
      ? {
          OR: [
            { assetTag: { contains: filters.search, mode: "insensitive" } },
            { serialNumber: { contains: filters.search, mode: "insensitive" } },
            { nickname: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [records, total] = await Promise.all([
    prisma.notebook.findMany({
      where,
      include: notebookInclude,
      orderBy: { assetTag: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.notebook.count({ where }),
  ]);

  return { items: records.map(toListItem), total, page, pageSize };
}

/**
 * Detalhe do notebook: kit, ocorrências recentes e reservas que o ocupam.
 *
 * `actor` é opcional para permitir uso interno (jobs, outros serviços); quando
 * informado, aplica a mesma regra da listagem — professor não enxerga
 * desativado, e recebe 404 em vez de 403 para não confirmar a existência.
 */
export async function getNotebook(
  id: string,
  actor?: SessionUser,
): Promise<NotebookDetail> {
  const record = await prisma.notebook.findUnique({
    where: { id },
    include: {
      ...notebookInclude,
      incidents: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          code: true,
          category: true,
          severity: true,
          status: true,
          description: true,
          createdAt: true,
          resolvedAt: true,
          reportedBy: { select: { id: true, fullName: true } },
        },
      },
    },
  });

  if (!record) throw naoEncontrado("Notebook não encontrado.");
  if (actor && actor.role !== "SUPERVISOR" && record.status === "DESATIVADO") {
    throw naoEncontrado("Notebook não encontrado.");
  }

  const now = new Date();
  const ownKey = notebookKey(record.id);
  const containerKey = record.kitId ? kitKey(record.kitId) : null;

  const items = await prisma.reservationItem.findMany({
    where: {
      resourceKey: { in: containerKey ? [ownKey, containerKey] : [ownKey] },
      blocking: true,
      endsAt: { gt: now },
      reservation: { status: { in: BLOCKING_STATUSES } },
    },
    select: {
      resourceKey: true,
      reservation: {
        select: {
          id: true,
          code: true,
          status: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          room: true,
          user: { select: { id: true, fullName: true } },
        },
      },
    },
    orderBy: { startsAt: "asc" },
    take: 50,
  });

  const reservas = items.map<NotebookReservationSummary>((item) => {
    const r = item.reservation;
    return {
      reservationId: r.id,
      code: r.code,
      status: r.status,
      statusLabel: RESERVATION_STATUS_LABEL[r.status],
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      allDay: r.allDay,
      periodoFormatado: formatIntervalBR(r.startsAt, r.endsAt, r.allDay),
      room: r.room,
      origem: item.resourceKey === ownKey ? "NOTEBOOK" : "KIT",
      docente: { id: r.user.id, fullName: r.user.fullName },
    };
  });

  const reservasAtivas = reservas.filter((r) => r.origem === "NOTEBOOK");

  return {
    ...toListItem(record),
    ocorrenciasRecentes: record.incidents.map((incident) => ({
      id: incident.id,
      code: incident.code,
      category: incident.category,
      severity: incident.severity,
      status: incident.status,
      description: incident.description,
      createdAt: incident.createdAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      reportedBy: incident.reportedBy
        ? { id: incident.reportedBy.id, fullName: incident.reportedBy.fullName }
        : null,
    })),
    reservasAtivas,
    reservasDoKit: reservas.filter((r) => r.origem === "KIT"),
    reservasFuturasAtivas: reservasAtivas.length,
  };
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

export async function createNotebook(
  input: CreateNotebookInput,
  actor: SessionUser,
  context: MutationContext = {},
): Promise<NotebookListItem> {
  assertSupervisor(actor);

  if (input.kitId) {
    await assertKitCanReceive(input.kitId, 1, input.confirmCapacityOverflow === true);
  }

  const created = await prisma.$transaction(async (tx) => {
    await assertIdentifiersFree(input.assetTag, input.serialNumber, null, tx);

    const notebook = await tx.notebook.create({
      data: {
        assetTag: input.assetTag,
        serialNumber: input.serialNumber,
        nickname: input.nickname,
        brand: input.brand,
        model: input.model,
        kitId: input.kitId ?? null,
        status: input.status,
        notes: input.notes,
      },
      include: notebookInclude,
    });

    await audit(
      {
        actorId: actor.id,
        action: "notebook.criar",
        entity: "Notebook",
        entityId: notebook.id,
        summary: `Notebook ${notebook.assetTag} cadastrado${
          notebook.kit ? ` no kit "${notebook.kit.name}"` : " como avulso"
        }`,
        after: {
          assetTag: notebook.assetTag,
          serialNumber: notebook.serialNumber,
          nickname: notebook.nickname,
          brand: notebook.brand,
          model: notebook.model,
          kitId: notebook.kitId,
          status: notebook.status,
        },
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );

    return notebook;
  });

  return toListItem(created);
}

// ---------------------------------------------------------------------------
// Alteração
// ---------------------------------------------------------------------------

/**
 * Alteração genérica de um notebook.
 *
 * É o único ponto de escrita: `setNotebookStatus`, `transferToKit` e
 * `deactivateNotebook` delegam para cá mudando apenas a ação registrada na
 * auditoria. Assim a validação de capacidade, a checagem de identificadores
 * únicos e o cálculo do impacto em reservas existem em um lugar só.
 */
export async function updateNotebook(
  id: string,
  patch: UpdateNotebookInput,
  actor: SessionUser,
  context: MutationContext = {},
): Promise<NotebookMutationResult> {
  assertSupervisor(actor);

  const existing = await prisma.notebook.findUnique({
    where: { id },
    include: { kit: { select: { id: true, name: true, code: true } } },
  });
  if (!existing) throw naoEncontrado("Notebook não encontrado.");

  const kitChanged = patch.kitId !== undefined && (patch.kitId ?? null) !== existing.kitId;
  const nextKitId = kitChanged ? (patch.kitId ?? null) : existing.kitId;

  // Só consome vaga quem está entrando agora em um kit; ao sair, a capacidade
  // do kit de origem apenas sobra.
  if (kitChanged && nextKitId) {
    await assertKitCanReceive(nextKitId, 1, patch.confirmCapacityOverflow === true);
  }

  const nextStatus = patch.status ?? existing.status;

  // Desativar é exclusão lógica, e a regra vale por qualquer caminho de
  // chamada — PATCH cru com `status`, `setNotebookStatus` ou
  // `deactivateNotebook`. Por isso a checagem mora aqui, no único ponto de
  // escrita, e não só na função de desativar.
  if (nextStatus === "DESATIVADO" && existing.status !== "DESATIVADO") {
    const proprias = await countActiveFutureReservations(notebookKey(id));
    if (proprias > 0) {
      throw regraDeNegocio(
        `O notebook ${existing.assetTag} está em ${proprias} reserva(s) ativa(s) que ainda não terminaram. ` +
          `Cancele ou remaneje essas reservas antes de desativá-lo. ` +
          `Se o equipamento apenas saiu de circulação, use o status "Em manutenção" ou "Indisponível".`,
        { reservasFuturasAtivas: proprias },
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await assertIdentifiersFree(
      patch.assetTag !== undefined && patch.assetTag !== existing.assetTag
        ? patch.assetTag
        : undefined,
      patch.serialNumber !== undefined && patch.serialNumber !== existing.serialNumber
        ? patch.serialNumber
        : undefined,
      id,
      tx,
    );

    const notebook = await tx.notebook.update({
      where: { id },
      data: {
        ...(patch.assetTag !== undefined ? { assetTag: patch.assetTag } : {}),
        ...(patch.serialNumber !== undefined ? { serialNumber: patch.serialNumber } : {}),
        ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
        ...(patch.brand !== undefined ? { brand: patch.brand } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(kitChanged ? { kitId: nextKitId } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      },
      include: notebookInclude,
    });

    const changes = diffChanges(
      {
        assetTag: existing.assetTag,
        serialNumber: existing.serialNumber,
        nickname: existing.nickname,
        brand: existing.brand,
        model: existing.model,
        kitId: existing.kitId,
        status: existing.status,
        notes: existing.notes,
      },
      {
        assetTag: notebook.assetTag,
        serialNumber: notebook.serialNumber,
        nickname: notebook.nickname,
        brand: notebook.brand,
        model: notebook.model,
        kitId: notebook.kitId,
        status: notebook.status,
        notes: notebook.notes,
      },
    );

    // A transferência precisa ser legível no histórico sem consultar o kit
    // depois: gravamos nome e código dos dois lados, não só os ids.
    const kitTrail = kitChanged
      ? {
          before: {
            kitOrigem: existing.kit
              ? { id: existing.kit.id, code: existing.kit.code, name: existing.kit.name }
              : null,
          },
          after: {
            kitDestino: notebook.kit
              ? { id: notebook.kit.id, code: notebook.kit.code, name: notebook.kit.name }
              : null,
          },
        }
      : { before: {}, after: {} };

    const partes: string[] = [];
    if (kitChanged) {
      partes.push(
        `movido de ${existing.kit ? `"${existing.kit.name}"` : "avulso"} para ${
          notebook.kit ? `"${notebook.kit.name}"` : "avulso"
        }`,
      );
    }
    if (patch.status !== undefined && patch.status !== existing.status) {
      partes.push(
        `status ${NOTEBOOK_STATUS_LABEL[existing.status]} → ${NOTEBOOK_STATUS_LABEL[notebook.status]}`,
      );
    }
    const outrosCampos = changes.changedKeys.filter(
      (k) => k !== "kitId" && k !== "status",
    );
    if (outrosCampos.length > 0) partes.push(`alterado: ${outrosCampos.join(", ")}`);

    await audit(
      {
        actorId: actor.id,
        action: context.action ?? "notebook.atualizar",
        entity: "Notebook",
        entityId: id,
        summary:
          context.reason ??
          `Notebook ${notebook.assetTag}${partes.length > 0 ? ` — ${partes.join("; ")}` : " atualizado"}`,
        before: { ...changes.before, ...kitTrail.before },
        after: { ...changes.after, ...kitTrail.after },
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );

    return notebook;
  });

  const reservasFuturasAtivas = await countActiveFutureReservations(notebookKey(id));

  return {
    notebook: toListItem(updated),
    reservasFuturasAtivas,
    aviso: buildAviso(nextStatus, reservasFuturasAtivas),
  };
}

/**
 * Muda apenas o status.
 *
 * Não toca em reserva nenhuma — nem cancela, nem libera. Devolve quantas
 * reservas futuras ativas dependem do notebook para a supervisão decidir.
 */
export async function setNotebookStatus(
  id: string,
  status: NotebookStatus,
  actor: SessionUser,
  context: MutationContext = {},
): Promise<NotebookMutationResult> {
  return updateNotebook(id, { status }, actor, {
    ...context,
    action: context.action ?? "notebook.status",
  });
}

/**
 * Move o notebook para outro kit, ou o torna avulso (`kitId = null`).
 * A auditoria registra kit de origem e de destino.
 */
export async function transferToKit(
  id: string,
  kitId: string | null,
  actor: SessionUser,
  context: MutationContext & { confirmCapacityOverflow?: boolean } = {},
): Promise<NotebookMutationResult> {
  return updateNotebook(
    id,
    { kitId, confirmCapacityOverflow: context.confirmCapacityOverflow },
    actor,
    { ...context, action: context.action ?? "notebook.transferir" },
  );
}

/**
 * Desativação lógica.
 *
 * Nunca apagamos: o notebook aparece em reservas e ocorrências antigas, e o
 * banco impede a exclusão física justamente por isso (`onDelete: Restrict`).
 * A recusa por reserva ativa própria fica em `updateNotebook`, que é o único
 * ponto de escrita. Reserva herdada do kit não impede — o notebook nem é o
 * item reservado —, mas vira aviso: o que precisa ser revisto nesse caso é a
 * composição do kit antes da próxima retirada.
 */
export async function deactivateNotebook(
  id: string,
  actor: SessionUser,
  context: MutationContext = {},
): Promise<NotebookMutationResult> {
  assertSupervisor(actor);

  const existing = await prisma.notebook.findUnique({
    where: { id },
    select: { id: true, assetTag: true, status: true, kitId: true },
  });
  if (!existing) throw naoEncontrado("Notebook não encontrado.");
  if (existing.status === "DESATIVADO") {
    throw regraDeNegocio(`O notebook ${existing.assetTag} já está desativado.`);
  }

  const result = await updateNotebook(id, { status: "DESATIVADO" }, actor, {
    ...context,
    action: "notebook.desativar",
  });

  if (existing.kitId) {
    const doKit = await countActiveFutureReservations(kitKey(existing.kitId));
    if (doKit > 0) {
      return {
        ...result,
        aviso:
          `O kit deste notebook tem ${doKit} reserva(s) ativa(s). O notebook foi desativado, ` +
          `mas continua vinculado ao kit por histórico — confira a composição do kit antes da próxima retirada.`,
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cadastro em lote
// ---------------------------------------------------------------------------

export type BulkCreateResult = {
  criados: NotebookListItem[];
  total: number;
  patrimonios: string[];
};

/** Patrimônio gerado: prefixo + número sequencial com zeros à esquerda. */
function buildAssetTag(prefix: string, numero: number, padding: number): string {
  return `${prefix}${String(numero).padStart(padding, "0")}`;
}

/**
 * Cadastro em lote a partir de prefixo + numeração sequencial.
 *
 * Tudo ou nada: uma única transação. A checagem de colisão acontece dentro
 * dela e ANTES de qualquer inserção, para que o erro liste todos os
 * patrimônios já em uso de uma vez — o operador corrige a faixa e repete, em
 * vez de descobrir um conflito por tentativa.
 */
export async function bulkCreateNotebooks(
  input: BulkCreateNotebooksInput,
  actor: SessionUser,
  context: MutationContext = {},
): Promise<BulkCreateResult> {
  assertSupervisor(actor);

  const patrimonios = Array.from({ length: input.quantity }, (_, i) =>
    buildAssetTag(input.prefix, input.startNumber + i, input.padding),
  );

  if (input.kitId) {
    await assertKitCanReceive(
      input.kitId,
      input.quantity,
      input.confirmCapacityOverflow === true,
    );
  }

  // O tempo padrão de transação interativa do Prisma (5s) é curto para até
  // 100 inserções somadas às linhas de auditoria; ampliamos com folga.
  const criados = await prisma.$transaction(
    async (tx) => {
      const colisoes = await tx.notebook.findMany({
        where: { assetTag: { in: patrimonios } },
        select: { assetTag: true },
        orderBy: { assetTag: "asc" },
      });

      if (colisoes.length > 0) {
        const lista = colisoes.map((c) => c.assetTag);
        throw conflito(
          `${lista.length} patrimônio(s) da faixa gerada já existem: ${lista.slice(0, 10).join(", ")}` +
            `${lista.length > 10 ? ` e mais ${lista.length - 10}` : ""}. ` +
            `Nenhum notebook foi cadastrado. Ajuste o prefixo ou o número inicial.`,
          { patrimoniosEmUso: lista },
        );
      }

      await tx.notebook.createMany({
        data: patrimonios.map((assetTag) => ({
          assetTag,
          brand: input.brand,
          model: input.model,
          kitId: input.kitId ?? null,
          status: input.status,
        })),
      });

      const registros = await tx.notebook.findMany({
        where: { assetTag: { in: patrimonios } },
        include: notebookInclude,
        orderBy: { assetTag: "asc" },
      });

      // Uma linha de auditoria por notebook, e não uma do lote: assim o
      // histórico individual (`entityHistory("Notebook", id)`) mostra a
      // criação, que é onde a supervisão vai procurar.
      for (const registro of registros) {
        await audit(
          {
            actorId: actor.id,
            action: "notebook.criar",
            entity: "Notebook",
            entityId: registro.id,
            summary: `Notebook ${registro.assetTag} cadastrado em lote (${input.quantity} unidade(s), prefixo "${input.prefix}")`,
            after: {
              assetTag: registro.assetTag,
              brand: registro.brand,
              model: registro.model,
              kitId: registro.kitId,
              status: registro.status,
              lote: {
                prefixo: input.prefix,
                inicio: input.startNumber,
                quantidade: input.quantity,
              },
            },
            ip: context.ip,
            userAgent: context.userAgent,
          },
          tx,
        );
      }

      return registros;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  return {
    criados: criados.map(toListItem),
    total: criados.length,
    patrimonios,
  };
}
