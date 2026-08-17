import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit, diffChanges } from "@/lib/audit";
import { formatIntervalBR } from "@/lib/datetime";
import {
  conflito,
  naoEncontrado,
  regraDeNegocio,
  semPermissao,
} from "@/lib/errors";
import type { SessionUser } from "@/lib/session";
import {
  kitStatusSchema,
  kitTypeSchema,
  paginationSchema,
  updateKitSchema,
} from "@/lib/validation";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ChargerKitStatus,
  KitStatus,
  KitType,
  NotebookStatus,
  ReservationStatus,
} from "@/generated/prisma/enums";
import {
  KIT_STATUS_LABEL,
  NOTEBOOK_STATUS_LABEL,
  kitIsReservable,
} from "./resources";
// Só o rótulo: `chargers.ts` importa daqui apenas `MutationContext`, e como é
// `import type` ele some na compilação — não há ciclo em tempo de execução.
import { CHARGER_KIT_STATUS_LABEL } from "./chargers";
import {
  BLOCKING_STATUSES,
  RESERVATION_STATUS_LABEL,
} from "./reservation-policy";

/**
 * Serviço de kits (maletas e carrinhos).
 *
 * Maleta e carrinho são o mesmo recurso com tipos diferentes: as duas variam
 * só na etiqueta e no formato físico, então um único serviço atende as duas e
 * evita regras duplicadas que inevitavelmente divergiriam com o tempo.
 *
 * Duas invariantes concentram quase toda a complexidade deste módulo:
 *
 *  1. **Capacidade x notebooks vinculados.** A capacidade é editável, mas o
 *     sistema nunca aceita silenciosamente mais notebooks do que cabem — quem
 *     reduzir a capacidade abaixo do que já existe precisa confirmar de forma
 *     explícita, e a confirmação fica registrada na auditoria.
 *  2. **Desativação lógica.** Kit com histórico nunca é apagado; vira
 *     `DESATIVADO` e some da visão do professor. Desativar um kit com reserva
 *     ativa é recusado, porque a reserva seguiria de pé apontando para um
 *     recurso que a supervisão considera fora do inventário.
 */

// ---------------------------------------------------------------------------
// Contexto e tipos
// ---------------------------------------------------------------------------

export type MutationContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export type CreateKitInput = {
  code: string;
  name: string;
  type: KitType;
  capacity: number;
  location?: string | null;
  description?: string | null;
  notes?: string | null;
  status?: KitStatus;
};

export type UpdateKitInput = Partial<CreateKitInput> & {
  /**
   * Autoriza reduzir a capacidade abaixo do número de notebooks já vinculados.
   * Sem esta confirmação a redução é recusada.
   */
  confirmCapacityOverflow?: boolean;
};

export type KitFilters = {
  type?: KitType;
  status?: KitStatus[];
  location?: string;
  search?: string;
  minCapacity?: number;
  /** Só tem efeito para a supervisão: traz também os kits desativados. */
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
};

/** Kit de carregadores em versão resumida, como aparece junto do kit. */
export type ChargerKitSummary = {
  id: string;
  code: string;
  status: ChargerKitStatus;
  statusLabel: string;
  totalQuantity: number;
  availableQuantity: number;
  faltando: number;
  completo: boolean;
};

export type KitSummary = {
  id: string;
  code: string;
  name: string;
  type: KitType;
  capacity: number;
  location: string | null;
  description: string | null;
  notes: string | null;
  status: KitStatus;
  statusLabel: string;
  /** Notebooks ativos vinculados. Desativados não ocupam vaga (ver capacidade). */
  notebookCount: number;
  /** Vagas ainda livres na capacidade planejada. Nunca negativo. */
  vagasRestantes: number;
  /** `true` quando há mais notebooks vinculados do que a capacidade. */
  capacidadeExcedida: boolean;
  /** `true` quando o status permite reserva (não considera a agenda). */
  reservavel: boolean;
  chargerKit: ChargerKitSummary | null;
  createdAt: string;
  updatedAt: string;
};

export type KitNotebookSummary = {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  nickname: string | null;
  brand: string | null;
  model: string | null;
  status: NotebookStatus;
  /** Rótulo em português: a tela nunca deve exibir o enum cru. */
  statusLabel: string;
  notes: string | null;
};

/** Reserva que ainda ocupa o kit. Sem telefone: contato passa pelo WhatsApp. */
export type KitUpcomingReservation = {
  id: string;
  code: string;
  status: ReservationStatus;
  statusLabel: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  periodoFormatado: string;
  room: string | null;
  purpose: string | null;
  professor: { id: string; fullName: string };
};

export type KitDetail = KitSummary & {
  /**
   * Notebooks vinculados. A supervisão vê também os desativados (o vínculo é
   * histórico); para o professor eles são omitidos, como na listagem.
   */
  notebooks: KitNotebookSummary[];
  reservasFuturas: KitUpcomingReservation[];
};

export type KitListResult = {
  items: KitSummary[];
  total: number;
  page: number;
  pageSize: number;
};

// ---------------------------------------------------------------------------
// Esquemas de consulta (usados pelos route handlers)
// ---------------------------------------------------------------------------

/** "?status=" chega como string vazia e deve valer como filtro ausente. */
const emptyAsUndefined = (value: unknown): unknown =>
  value === "" || (Array.isArray(value) && value.length === 0)
    ? undefined
    : value;

/** Aceita `?status=A&status=B` e também `?status=A,B`. */
const asList = (value: unknown): unknown => {
  if (value === "" || value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.length > 0 ? value : undefined;
  if (typeof value !== "string") return value;
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
};

const flagSchema = z
  .preprocess(
    emptyAsUndefined,
    z.union([z.boolean(), z.enum(["true", "false", "1", "0"])]).optional(),
  )
  .transform((value) => value === true || value === "true" || value === "1");

export const kitListQuerySchema = paginationSchema.extend({
  type: z.preprocess(emptyAsUndefined, kitTypeSchema.optional()),
  status: z.preprocess(asList, z.array(kitStatusSchema).optional()),
  location: z.preprocess(
    emptyAsUndefined,
    z.string().trim().max(120).optional(),
  ),
  search: z.preprocess(emptyAsUndefined, z.string().trim().max(80).optional()),
  minCapacity: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1).max(200).optional(),
  ),
  includeInactive: flagSchema,
});

export const kitStatusPatchSchema = z.object({
  status: kitStatusSchema,
  /** Justificativa opcional que vai para o resumo da auditoria. */
  reason: z.string().trim().max(300).optional(),
});

/**
 * Corpo aceito na alteração parcial do kit.
 *
 * `updateKitSchema` nasce de `createKitSchema.partial()`, e o `.partial()` do
 * Zod **não** remove o `.default("DISPONIVEL")` do campo `status`: um PATCH que
 * só renomeia o kit chega ao serviço com `status: "DISPONIVEL"` embutido e
 * devolve à disponibilidade — silenciosamente, e com um registro de auditoria
 * enganoso — um kit que a supervisão tinha posto em manutenção ou desativado.
 * Um corpo vazio reativaria um kit desativado sem que ninguém pedisse.
 *
 * Redeclarar o campo como opcional puro faz "não enviado" significar "não mexa
 * no status", que é a única leitura correta em um PATCH.
 */
export const kitPatchSchema = updateKitSchema.extend({
  status: kitStatusSchema.optional(),
});

export type KitPatchInput = z.infer<typeof kitPatchSchema>;

// ---------------------------------------------------------------------------
// Formas de consulta
// ---------------------------------------------------------------------------

const chargerKitSelect = {
  id: true,
  code: true,
  status: true,
  totalQuantity: true,
  availableQuantity: true,
} satisfies Prisma.ChargerKitSelect;

const kitInclude = {
  chargerKit: { select: chargerKitSelect },
  // Contagem filtrada: precisa bater exatamente com a regra de capacidade
  // (`countActiveNotebooks`), senão a tela mostraria "3 de 2 ocupados" para um
  // kit que o serviço considera dentro do limite.
  _count: {
    select: { notebooks: { where: { status: { not: "DESATIVADO" } } } },
  },
} satisfies Prisma.KitInclude;

type KitRow = Prisma.KitGetPayload<{ include: typeof kitInclude }>;

function toChargerKitSummary(
  charger: KitRow["chargerKit"],
): ChargerKitSummary | null {
  if (!charger) return null;
  return {
    id: charger.id,
    code: charger.code,
    status: charger.status,
    // Rótulo vem de `chargers.ts`: uma cópia local aqui sairia do lugar assim
    // que um status novo fosse criado, e a tela mostraria o enum cru.
    statusLabel: CHARGER_KIT_STATUS_LABEL[charger.status],
    totalQuantity: charger.totalQuantity,
    availableQuantity: charger.availableQuantity,
    faltando: Math.max(0, charger.totalQuantity - charger.availableQuantity),
    completo: charger.status === "COMPLETO",
  };
}

function toKitSummary(kit: KitRow): KitSummary {
  const notebookCount = kit._count.notebooks;
  return {
    id: kit.id,
    code: kit.code,
    name: kit.name,
    type: kit.type,
    capacity: kit.capacity,
    location: kit.location,
    description: kit.description,
    notes: kit.notes,
    status: kit.status,
    statusLabel: KIT_STATUS_LABEL[kit.status],
    notebookCount,
    vagasRestantes: Math.max(0, kit.capacity - notebookCount),
    capacidadeExcedida: notebookCount > kit.capacity,
    reservavel: kitIsReservable(kit.status),
    chargerKit: toChargerKitSummary(kit.chargerKit),
    createdAt: kit.createdAt.toISOString(),
    updatedAt: kit.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Capacidade
// ---------------------------------------------------------------------------

export type KitCapacityCheck = {
  kitId: string;
  kitLabel: string;
  capacidade: number;
  /** Notebooks ativos já vinculados ao kit. */
  notebooksVinculados: number;
  /** Total depois de aplicar `novosNotebooks`. */
  totalResultante: number;
  excedeu: boolean;
  /** `true` quando o excesso foi aceito por confirmação explícita. */
  confirmado: boolean;
};

/**
 * Notebooks que ocupam vaga no kit.
 *
 * Decisão: notebook `DESATIVADO` continua apontando para o kit (o vínculo é
 * histórico), mas não ocupa vaga — do contrário a capacidade ficaria presa a
 * equipamentos que já saíram do inventário e a supervisão teria que desvincular
 * um a um só para conseguir cadastrar reposições.
 */
async function countActiveNotebooks(
  kitId: string,
  client: Prisma.TransactionClient | typeof prisma,
): Promise<number> {
  return client.notebook.count({
    where: { kitId, status: { not: "DESATIVADO" } },
  });
}

/**
 * Garante que o kit comporta os notebooks pedidos.
 *
 * Reutilizável pelo domínio de notebooks: ao vincular um notebook a um kit,
 * chame com `novosNotebooks = 1` (ou com a quantidade do cadastro em lote).
 * `novosNotebooks` é um **acréscimo**, não o total — passar `0` apenas confere
 * a situação atual, que é o caso da redução de capacidade.
 *
 * `options.capacity` permite avaliar a capacidade que *será* gravada, antes de
 * o update acontecer. `options.client` mantém a contagem dentro da mesma
 * transação da escrita, evitando decidir sobre um número já desatualizado.
 *
 * Excedendo o limite sem `confirmou`, lança `REGRA_DE_NEGOCIO` com a contagem
 * nos detalhes para que a interface possa oferecer o botão de confirmação.
 */
export async function assertKitCapacity(
  kitId: string,
  novosNotebooks = 0,
  confirmou = false,
  options: {
    client?: Prisma.TransactionClient;
    capacity?: number;
  } = {},
): Promise<KitCapacityCheck> {
  const client = options.client ?? prisma;

  const kit = await client.kit.findUnique({
    where: { id: kitId },
    select: { id: true, code: true, name: true, capacity: true },
  });
  if (!kit) throw naoEncontrado("Kit não encontrado.");

  const capacidade = options.capacity ?? kit.capacity;
  const notebooksVinculados = await countActiveNotebooks(kitId, client);
  const totalResultante = notebooksVinculados + Math.max(0, novosNotebooks);
  const excedeu = totalResultante > capacidade;
  const kitLabel = `${kit.name} (${kit.code})`;

  if (excedeu && !confirmou) {
    const mensagem =
      novosNotebooks > 0
        ? `O kit ${kitLabel} comporta ${capacidade} notebook(s) e já tem ${notebooksVinculados} vinculado(s). ` +
          `Incluir mais ${novosNotebooks} deixaria o total em ${totalResultante}. ` +
          "Aumente a capacidade do kit ou confirme a exceção para prosseguir."
        : `O kit ${kitLabel} já tem ${notebooksVinculados} notebook(s) vinculado(s) e a capacidade informada é ${capacidade}. ` +
          "Desvincule os notebooks excedentes ou confirme a exceção para registrar a redução mesmo assim.";

    throw regraDeNegocio(mensagem, {
      kitId,
      capacidade,
      notebooksVinculados,
      novosNotebooks: Math.max(0, novosNotebooks),
      totalResultante,
      campoConfirmacao: "confirmCapacityOverflow",
    });
  }

  return {
    kitId,
    kitLabel,
    capacidade,
    notebooksVinculados,
    totalResultante,
    excedeu,
    confirmado: excedeu && confirmou,
  };
}

// ---------------------------------------------------------------------------
// Reservas que impedem a desativação
// ---------------------------------------------------------------------------

/**
 * Reservas ativas que ainda ocupam o kit.
 *
 * Só contam as que terminam no futuro: uma reserva ainda `EM_USO` cujo período
 * já passou é problema do fluxo de devolução, não motivo para travar a
 * manutenção do inventário.
 */
async function countBlockingReservations(
  kitId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
  now = new Date(),
): Promise<number> {
  return client.reservation.count({
    where: {
      status: { in: BLOCKING_STATUSES },
      endsAt: { gt: now },
      items: { some: { kitId, blocking: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

/**
 * Lista kits com filtros e paginação.
 *
 * O professor nunca recebe kits `DESATIVADO`, mesmo pedindo explicitamente:
 * a autorização é resolvida aqui e não na interface, então chamar a API direto
 * não muda o resultado.
 */
export async function listKits(
  filters: KitFilters,
  actor: SessionUser,
): Promise<KitListResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  const isSupervisor = actor.role === "SUPERVISOR";
  const incluirDesativados = isSupervisor && filters.includeInactive === true;

  const pedidos = filters.status ?? [];
  const statusFiltrados = incluirDesativados
    ? pedidos
    : pedidos.filter((status) => status !== "DESATIVADO");

  // Pedir apenas status proibidos precisa resultar em lista vazia. Sem esta
  // guarda o filtro esvaziado cairia no ramo "sem filtro" e devolveria tudo.
  if (pedidos.length > 0 && statusFiltrados.length === 0) {
    return { items: [], total: 0, page, pageSize };
  }

  const where: Prisma.KitWhereInput = {
    ...(filters.type ? { type: filters.type } : {}),
    ...(statusFiltrados.length > 0
      ? { status: { in: statusFiltrados } }
      : incluirDesativados
        ? {}
        : { status: { not: "DESATIVADO" } }),
    ...(filters.location
      ? { location: { contains: filters.location, mode: "insensitive" } }
      : {}),
    ...(filters.minCapacity ? { capacity: { gte: filters.minCapacity } } : {}),
    ...(filters.search
      ? {
          OR: [
            { code: { contains: filters.search, mode: "insensitive" } },
            { name: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.kit.findMany({
      where,
      include: kitInclude,
      orderBy: [{ type: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.kit.count({ where }),
  ]);

  return { items: rows.map(toKitSummary), total, page, pageSize };
}

/**
 * Detalhe do kit: notebooks vinculados, kit de carregadores e reservas ativas.
 *
 * `actor` é opcional para permitir uso interno (relatórios, jobs); quando
 * informado e o usuário não é da supervisão, um kit desativado responde como
 * inexistente — a mesma resposta de um id inválido, para não confirmar a
 * existência do registro a quem não pode vê-lo.
 */
export async function getKit(
  id: string,
  actor?: SessionUser,
): Promise<KitDetail> {
  const kit = await prisma.kit.findUnique({
    where: { id },
    include: {
      ...kitInclude,
      notebooks: {
        select: {
          id: true,
          assetTag: true,
          serialNumber: true,
          nickname: true,
          brand: true,
          model: true,
          status: true,
          notes: true,
        },
        orderBy: { assetTag: "asc" },
      },
    },
  });
  if (!kit) throw naoEncontrado("Kit não encontrado.");

  if (actor && actor.role !== "SUPERVISOR" && kit.status === "DESATIVADO") {
    throw naoEncontrado("Kit não encontrado.");
  }

  const reservas = await prisma.reservation.findMany({
    where: {
      status: { in: BLOCKING_STATUSES },
      endsAt: { gt: new Date() },
      items: { some: { kitId: id, blocking: true } },
    },
    select: {
      id: true,
      code: true,
      status: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      room: true,
      purpose: true,
      // Apenas identificação do docente: telefone e e-mail não saem daqui.
      user: { select: { id: true, fullName: true } },
    },
    orderBy: { startsAt: "asc" },
    take: 50,
  });

  return {
    ...toKitSummary(kit),
    notebooks: kit.notebooks,
    reservasFuturas: reservas.map((reserva) => ({
      id: reserva.id,
      code: reserva.code,
      status: reserva.status,
      statusLabel: RESERVATION_STATUS_LABEL[reserva.status],
      startsAt: reserva.startsAt.toISOString(),
      endsAt: reserva.endsAt.toISOString(),
      allDay: reserva.allDay,
      periodoFormatado: formatIntervalBR(
        reserva.startsAt,
        reserva.endsAt,
        reserva.allDay,
      ),
      room: reserva.room,
      purpose: reserva.purpose,
      professor: reserva.user,
    })),
  };
}

// ---------------------------------------------------------------------------
// Criação
// ---------------------------------------------------------------------------

function assertSupervisor(actor: SessionUser): void {
  // Redundante com `requireSupervisor()` da rota, de propósito: o serviço
  // também é chamado por scripts e por outros módulos do servidor.
  if (actor.role !== "SUPERVISOR") {
    throw semPermissao("Somente a supervisão pode alterar o inventário.");
  }
}

export async function createKit(
  input: CreateKitInput,
  actor: SessionUser,
  context: MutationContext = {},
): Promise<KitDetail> {
  assertSupervisor(actor);

  const code = input.code.trim();

  const id = await prisma.$transaction(async (tx) => {
    // Checagem antecipada só para dar mensagem melhor; a restrição UNIQUE do
    // banco continua sendo a garantia real contra duas criações simultâneas.
    const duplicado = await tx.kit.findUnique({
      where: { code },
      select: { id: true, name: true },
    });
    if (duplicado) {
      throw conflito(
        `Já existe um kit com o código "${code}" (${duplicado.name}). Use outro código.`,
      );
    }

    const created = await tx.kit.create({
      data: {
        code,
        name: input.name.trim(),
        type: input.type,
        capacity: input.capacity,
        location: input.location ?? null,
        description: input.description ?? null,
        notes: input.notes ?? null,
        status: input.status ?? "DISPONIVEL",
      },
      select: { id: true },
    });

    await audit(
      {
        actorId: actor.id,
        action: "kit.criar",
        entity: "Kit",
        entityId: created.id,
        summary: `${input.type === "MALETA" ? "Maleta" : "Carrinho"} "${input.name.trim()}" (${code}) cadastrado com capacidade ${input.capacity}`,
        after: {
          code,
          name: input.name.trim(),
          type: input.type,
          capacity: input.capacity,
          location: input.location ?? null,
          status: input.status ?? "DISPONIVEL",
        },
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );

    return created.id;
  });

  return getKit(id, actor);
}

// ---------------------------------------------------------------------------
// Alteração
// ---------------------------------------------------------------------------

type PatchMeta = {
  action: string;
  /** Substitui o resumo automático montado a partir dos campos alterados. */
  summary?: string;
};

/**
 * Caminho único de alteração de kit.
 *
 * `updateKit`, `setKitStatus` e `deactivateKit` passam por aqui para que as
 * guardas de capacidade, de código duplicado e de desativação valham para
 * todos — inclusive quando a alteração chega por um atalho da interface.
 */
async function applyKitPatch(
  id: string,
  patch: UpdateKitInput,
  actor: SessionUser,
  context: MutationContext,
  meta: PatchMeta,
): Promise<KitDetail> {
  assertSupervisor(actor);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.kit.findUnique({ where: { id } });
    if (!existing) throw naoEncontrado("Kit não encontrado.");

    const code = patch.code?.trim();
    if (code && code !== existing.code) {
      const duplicado = await tx.kit.findUnique({
        where: { code },
        select: { id: true, name: true },
      });
      if (duplicado && duplicado.id !== id) {
        throw conflito(
          `Já existe um kit com o código "${code}" (${duplicado.name}). Use outro código.`,
        );
      }
    }

    // --- Capacidade ------------------------------------------------------
    let capacidade: KitCapacityCheck | null = null;
    if (patch.capacity !== undefined && patch.capacity !== existing.capacity) {
      capacidade = await assertKitCapacity(
        id,
        0,
        patch.confirmCapacityOverflow === true,
        { client: tx, capacity: patch.capacity },
      );
    }

    // --- Desativação -----------------------------------------------------
    const nextStatus = patch.status ?? existing.status;
    if (nextStatus === "DESATIVADO" && existing.status !== "DESATIVADO") {
      const reservas = await countBlockingReservations(id, tx);
      if (reservas > 0) {
        throw regraDeNegocio(
          `Não é possível desativar "${existing.name}": ${reservas} reserva(s) ativa(s) ainda ocupam este kit. ` +
            "Cancele ou encerre essas reservas antes de desativar.",
          { kitId: id, reservasImpeditivas: reservas },
        );
      }
    }

    const data: Prisma.KitUpdateInput = {
      ...(code !== undefined ? { code } : {}),
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.type !== undefined ? { type: patch.type } : {}),
      ...(patch.capacity !== undefined ? { capacity: patch.capacity } : {}),
      ...(patch.location !== undefined ? { location: patch.location } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };

    const updated = await tx.kit.update({ where: { id }, data });

    const changes = diffChanges(
      {
        code: existing.code,
        name: existing.name,
        type: existing.type,
        capacity: existing.capacity,
        location: existing.location,
        description: existing.description,
        notes: existing.notes,
        status: existing.status,
      },
      {
        code: updated.code,
        name: updated.name,
        type: updated.type,
        capacity: updated.capacity,
        location: updated.location,
        description: updated.description,
        notes: updated.notes,
        status: updated.status,
      },
    );

    // A confirmação de excesso de capacidade fica explícita no histórico: é a
    // evidência de que a supervisão aceitou o kit fora do planejado.
    const excessoConfirmado =
      capacidade && capacidade.confirmado ? capacidade : null;
    const sufixoConfirmacao = excessoConfirmado
      ? ` — redução confirmada pela supervisão com ${excessoConfirmado.notebooksVinculados} notebook(s) vinculado(s)`
      : "";

    const resumoAutomatico =
      changes.changedKeys.length > 0
        ? `Alterado: ${changes.changedKeys.join(", ")}`
        : "Nenhum campo alterado";

    await audit(
      {
        actorId: actor.id,
        action: meta.action,
        entity: "Kit",
        entityId: id,
        summary: `${meta.summary ?? resumoAutomatico}${sufixoConfirmacao}`,
        before: changes.before,
        after: {
          ...changes.after,
          ...(excessoConfirmado
            ? {
                confirmacaoCapacidade: true,
                notebooksVinculados: excessoConfirmado.notebooksVinculados,
                capacidadeInformada: excessoConfirmado.capacidade,
              }
            : {}),
        },
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );
  });

  return getKit(id, actor);
}

export async function updateKit(
  id: string,
  patch: UpdateKitInput,
  actor: SessionUser,
  context: MutationContext = {},
): Promise<KitDetail> {
  return applyKitPatch(id, patch, actor, context, { action: "kit.atualizar" });
}

/**
 * Muda apenas o status operacional.
 *
 * Decisão: colocar em `MANUTENCAO`/`INDISPONIVEL` é permitido mesmo com
 * reservas futuras — a supervisão precisa poder sinalizar um carrinho
 * quebrado na hora. O que essa mudança faz é tirar o kit da disponibilidade
 * para *novas* reservas; as existentes continuam visíveis para que a
 * supervisão negocie caso a caso. Só `DESATIVADO` é bloqueado, por ser
 * definitivo.
 */
export async function setKitStatus(
  id: string,
  status: KitStatus,
  actor: SessionUser,
  context: MutationContext = {},
  reason?: string | null,
): Promise<KitDetail> {
  const kit = await prisma.kit.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!kit) throw naoEncontrado("Kit não encontrado.");

  const resumo = `Status alterado de "${KIT_STATUS_LABEL[kit.status]}" para "${KIT_STATUS_LABEL[status]}"`;

  return applyKitPatch(id, { status }, actor, context, {
    action: "kit.status",
    summary: reason ? `${resumo}: ${reason}` : resumo,
  });
}

/**
 * Desativação lógica.
 *
 * Nunca apagamos o registro: kits aparecem em reservas encerradas, ocorrências
 * e auditoria, e a exclusão física deixaria esse histórico sem referência.
 *
 * Decisão: os notebooks vinculados **não** são desativados em cascata. Ao
 * aposentar uma maleta a supervisão normalmente redistribui os equipamentos, e
 * desativá-los junto obrigaria a reativar um a um. O kit sai da
 * disponibilidade; cada notebook segue com o status próprio.
 */
export async function deactivateKit(
  id: string,
  actor: SessionUser,
  context: MutationContext = {},
  reason?: string | null,
): Promise<KitDetail> {
  const kit = await prisma.kit.findUnique({
    where: { id },
    select: { name: true, code: true, status: true },
  });
  if (!kit) throw naoEncontrado("Kit não encontrado.");

  if (kit.status === "DESATIVADO") {
    throw regraDeNegocio(`O kit "${kit.name}" já está desativado.`);
  }

  const resumo = `Kit "${kit.name}" (${kit.code}) desativado`;

  return applyKitPatch(id, { status: "DESATIVADO" }, actor, context, {
    action: "kit.desativar",
    summary: reason ? `${resumo}: ${reason}` : resumo,
  });
}
