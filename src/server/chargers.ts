import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit, diffChanges } from "@/lib/audit";
import {
  conflito,
  dadosInvalidos,
  naoEncontrado,
  regraDeNegocio,
  semPermissao,
} from "@/lib/errors";
import type { SessionUser } from "@/lib/session";
import { chargerKitStatusSchema, paginationSchema } from "@/lib/validation";
import type { Prisma } from "@/generated/prisma/client";
import type { ChargerKitStatus } from "@/generated/prisma/enums";
import type { MutationContext } from "./kits";

/**
 * Serviço de kits de carregadores.
 *
 * Um kit de carregadores acompanha uma maleta/carrinho e é o item que mais
 * some na prática — daí o par `totalQuantity` (quantos deveriam existir) e
 * `availableQuantity` (quantos estão lá).
 *
 * DECISÃO CENTRAL — status derivado:
 * `COMPLETO` e `INCOMPLETO` não são digitados por ninguém: são uma *função*
 * das quantidades (`disponível >= total` => completo) e são recalculados a cada
 * gravação. Deixar esses dois status editáveis abriria espaço para um registro
 * que se diz completo faltando três carregadores, e é exatamente esse dado que
 * a política `requireCompleteChargerKit` usa para liberar ou barrar reservas.
 *
 * Os outros três status (`MANUTENCAO`, `INDISPONIVEL`, `DESATIVADO`) são
 * decisões humanas e não podem ser deduzidas de contagem nenhuma. Por isso:
 *
 *  - se a supervisão informar um deles, ele prevalece sobre a derivação;
 *  - uma vez em vigor, ele **persiste** mesmo que as quantidades mudem depois:
 *    corrigir a contagem de um kit em manutenção não pode devolvê-lo
 *    silenciosamente ao uso;
 *  - para sair do estado manual, a supervisão envia `COMPLETO`/`INCOMPLETO`
 *    explicitamente — o pedido é lido como "volte a derivar" e o valor final
 *    sai das quantidades, não do que foi enviado.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type CreateChargerKitInput = {
  code: string;
  kitId?: string | null;
  totalQuantity: number;
  availableQuantity: number;
  status?: ChargerKitStatus;
  missingParts?: string | null;
  notes?: string | null;
};

export type UpdateChargerKitInput = Partial<CreateChargerKitInput>;

export type ChargerKitFilters = {
  status?: ChargerKitStatus[];
  kitId?: string;
  search?: string;
  /** Apenas kits de carregadores ainda não vinculados a nenhuma maleta. */
  onlyUnlinked?: boolean;
  /** Só tem efeito para a supervisão: traz também os desativados. */
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
};

export type ChargerKitDetail = {
  id: string;
  code: string;
  status: ChargerKitStatus;
  statusLabel: string;
  totalQuantity: number;
  availableQuantity: number;
  /** Quantos faltam para o kit ficar completo. */
  faltando: number;
  completo: boolean;
  /** `true` quando o status foi definido manualmente e não pela contagem. */
  statusManual: boolean;
  missingParts: string | null;
  notes: string | null;
  kit: {
    id: string;
    code: string;
    name: string;
    type: string;
    status: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type ChargerKitListResult = {
  items: ChargerKitDetail[];
  total: number;
  page: number;
  pageSize: number;
};

export const CHARGER_KIT_STATUS_LABEL: Record<ChargerKitStatus, string> = {
  COMPLETO: "Completo",
  INCOMPLETO: "Incompleto",
  MANUTENCAO: "Em manutenção",
  INDISPONIVEL: "Indisponível",
  DESATIVADO: "Desativado",
};

/** Status que exprimem uma decisão da supervisão, não a contagem. */
const MANUAL_STATUSES: ChargerKitStatus[] = [
  "MANUTENCAO",
  "INDISPONIVEL",
  "DESATIVADO",
];

export function isManualChargerStatus(status: ChargerKitStatus): boolean {
  return MANUAL_STATUSES.includes(status);
}

/** `COMPLETO`/`INCOMPLETO` derivados das quantidades. */
export function derivedChargerStatus(
  availableQuantity: number,
  totalQuantity: number,
): ChargerKitStatus {
  return availableQuantity >= totalQuantity ? "COMPLETO" : "INCOMPLETO";
}

/** Aplica a política de status descrita no cabeçalho do módulo. */
export function resolveChargerStatus(input: {
  requested?: ChargerKitStatus;
  current?: ChargerKitStatus;
  totalQuantity: number;
  availableQuantity: number;
}): ChargerKitStatus {
  const derived = derivedChargerStatus(
    input.availableQuantity,
    input.totalQuantity,
  );

  if (input.requested) {
    // Pedido manual vence; pedido de COMPLETO/INCOMPLETO significa "volte a
    // derivar", e a derivação é quem decide qual dos dois de fato vale.
    return isManualChargerStatus(input.requested) ? input.requested : derived;
  }

  if (input.current && isManualChargerStatus(input.current)) {
    return input.current;
  }

  return derived;
}

// ---------------------------------------------------------------------------
// Esquemas de consulta (usados pelos route handlers)
// ---------------------------------------------------------------------------

const emptyAsUndefined = (value: unknown): unknown =>
  value === "" || (Array.isArray(value) && value.length === 0)
    ? undefined
    : value;

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

export const chargerKitListQuerySchema = paginationSchema.extend({
  status: z.preprocess(asList, z.array(chargerKitStatusSchema).optional()),
  kitId: z.preprocess(emptyAsUndefined, z.string().trim().max(64).optional()),
  search: z.preprocess(emptyAsUndefined, z.string().trim().max(80).optional()),
  onlyUnlinked: flagSchema,
  includeInactive: flagSchema,
});

// ---------------------------------------------------------------------------
// Forma de consulta e mapeamento
// ---------------------------------------------------------------------------

const chargerKitInclude = {
  kit: { select: { id: true, code: true, name: true, type: true, status: true } },
} satisfies Prisma.ChargerKitInclude;

type ChargerKitRow = Prisma.ChargerKitGetPayload<{
  include: typeof chargerKitInclude;
}>;

function toChargerKitDetail(row: ChargerKitRow): ChargerKitDetail {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    statusLabel: CHARGER_KIT_STATUS_LABEL[row.status],
    totalQuantity: row.totalQuantity,
    availableQuantity: row.availableQuantity,
    faltando: Math.max(0, row.totalQuantity - row.availableQuantity),
    completo: row.status === "COMPLETO",
    statusManual: isManualChargerStatus(row.status),
    missingParts: row.missingParts,
    notes: row.notes,
    kit: row.kit,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertSupervisor(actor: SessionUser): void {
  if (actor.role !== "SUPERVISOR") {
    throw semPermissao("Somente a supervisão pode alterar o inventário.");
  }
}

/**
 * Quantidades coerentes.
 *
 * "Disponível maior que o total" não é um estado que a operação consiga
 * descrever: ou o total está errado, ou apareceu carregador de outro kit.
 * Barrar aqui evita um `faltando` negativo se espalhando pelas telas.
 */
function assertQuantities(
  totalQuantity: number,
  availableQuantity: number,
): void {
  if (availableQuantity > totalQuantity) {
    throw dadosInvalidos(
      `A quantidade disponível (${availableQuantity}) não pode ser maior que a quantidade total (${totalQuantity}). ` +
        "Ajuste o total se o kit passou a ter mais carregadores.",
      {
        availableQuantity: [
          "Deve ser menor ou igual à quantidade total do kit",
        ],
      },
    );
  }
}

/**
 * Garante a relação 1-1 com o kit.
 *
 * O banco já tem `UNIQUE` em `kit_id`, mas o erro cru viraria um "registro
 * duplicado" genérico. Aqui a supervisão descobre *qual* kit de carregadores
 * está ocupando a vaga e o que precisa fazer.
 */
async function assertKitLinkAvailable(
  kitId: string,
  chargerKitId: string | null,
  client: Prisma.TransactionClient,
): Promise<void> {
  const kit = await client.kit.findUnique({
    where: { id: kitId },
    select: { id: true, code: true, name: true },
  });
  if (!kit) {
    throw naoEncontrado(
      "A maleta/carrinho informada não existe mais. Atualize a página e selecione outra.",
    );
  }

  const ocupante = await client.chargerKit.findUnique({
    where: { kitId },
    select: { id: true, code: true },
  });
  if (ocupante && ocupante.id !== chargerKitId) {
    throw conflito(
      `O kit "${kit.name}" (${kit.code}) já está vinculado ao kit de carregadores ${ocupante.code}. ` +
        "Cada maleta/carrinho comporta apenas um kit de carregadores: desvincule o atual antes de vincular este.",
    );
  }
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export async function listChargerKits(
  filters: ChargerKitFilters,
  actor: SessionUser,
): Promise<ChargerKitListResult> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));

  const isSupervisor = actor.role === "SUPERVISOR";
  const incluirDesativados = isSupervisor && filters.includeInactive === true;

  const pedidos = filters.status ?? [];
  const statusFiltrados = incluirDesativados
    ? pedidos
    : pedidos.filter((status) => status !== "DESATIVADO");

  // Filtrar só por status proibido resulta em lista vazia, não em "sem filtro".
  if (pedidos.length > 0 && statusFiltrados.length === 0) {
    return { items: [], total: 0, page, pageSize };
  }

  const where: Prisma.ChargerKitWhereInput = {
    ...(statusFiltrados.length > 0
      ? { status: { in: statusFiltrados } }
      : incluirDesativados
        ? {}
        : { status: { not: "DESATIVADO" } }),
    ...(filters.kitId ? { kitId: filters.kitId } : {}),
    ...(filters.onlyUnlinked ? { kitId: null } : {}),
    ...(filters.search
      ? {
          OR: [
            { code: { contains: filters.search, mode: "insensitive" } },
            { kit: { name: { contains: filters.search, mode: "insensitive" } } },
            { kit: { code: { contains: filters.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.chargerKit.findMany({
      where,
      include: chargerKitInclude,
      orderBy: { code: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.chargerKit.count({ where }),
  ]);

  return { items: rows.map(toChargerKitDetail), total, page, pageSize };
}

export async function getChargerKit(
  id: string,
  actor?: SessionUser,
): Promise<ChargerKitDetail> {
  const row = await prisma.chargerKit.findUnique({
    where: { id },
    include: chargerKitInclude,
  });
  if (!row) throw naoEncontrado("Kit de carregadores não encontrado.");

  // Mesma regra dos kits: registro desativado é histórico da supervisão.
  if (actor && actor.role !== "SUPERVISOR" && row.status === "DESATIVADO") {
    throw naoEncontrado("Kit de carregadores não encontrado.");
  }

  return toChargerKitDetail(row);
}

// ---------------------------------------------------------------------------
// Criação e alteração
// ---------------------------------------------------------------------------

export async function createChargerKit(
  input: CreateChargerKitInput,
  actor: SessionUser,
  context: MutationContext = {},
): Promise<ChargerKitDetail> {
  assertSupervisor(actor);

  const code = input.code.trim();
  assertQuantities(input.totalQuantity, input.availableQuantity);

  const status = resolveChargerStatus({
    requested: input.status,
    totalQuantity: input.totalQuantity,
    availableQuantity: input.availableQuantity,
  });

  const id = await prisma.$transaction(async (tx) => {
    const duplicado = await tx.chargerKit.findUnique({
      where: { code },
      select: { id: true },
    });
    if (duplicado) {
      throw conflito(
        `Já existe um kit de carregadores com o código "${code}". Use outro código.`,
      );
    }

    const kitId = input.kitId ?? null;
    if (kitId) await assertKitLinkAvailable(kitId, null, tx);

    const created = await tx.chargerKit.create({
      data: {
        code,
        kitId,
        totalQuantity: input.totalQuantity,
        availableQuantity: input.availableQuantity,
        status,
        missingParts: input.missingParts ?? null,
        notes: input.notes ?? null,
      },
      select: { id: true },
    });

    await audit(
      {
        actorId: actor.id,
        action: "kit-carregadores.criar",
        entity: "ChargerKit",
        entityId: created.id,
        summary: `Kit de carregadores ${code} cadastrado com ${input.availableQuantity}/${input.totalQuantity} carregador(es)`,
        after: {
          code,
          kitId,
          totalQuantity: input.totalQuantity,
          availableQuantity: input.availableQuantity,
          status,
        },
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );

    return created.id;
  });

  return getChargerKit(id, actor);
}

/**
 * Caminho único de alteração.
 *
 * `updateChargerKit` e `deactivateChargerKit` passam por aqui para que a
 * validação de quantidades, a relação 1-1 e a derivação de status valham
 * igualmente para os dois — só o rótulo da auditoria muda.
 */
async function applyChargerPatch(
  id: string,
  patch: UpdateChargerKitInput,
  actor: SessionUser,
  context: MutationContext,
  meta: { action: string; summary?: string },
): Promise<ChargerKitDetail> {
  assertSupervisor(actor);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.chargerKit.findUnique({ where: { id } });
    if (!existing) throw naoEncontrado("Kit de carregadores não encontrado.");

    const code = patch.code?.trim();
    if (code && code !== existing.code) {
      const duplicado = await tx.chargerKit.findUnique({
        where: { code },
        select: { id: true },
      });
      if (duplicado && duplicado.id !== id) {
        throw conflito(
          `Já existe um kit de carregadores com o código "${code}". Use outro código.`,
        );
      }
    }

    const totalQuantity = patch.totalQuantity ?? existing.totalQuantity;
    const availableQuantity =
      patch.availableQuantity ?? existing.availableQuantity;
    assertQuantities(totalQuantity, availableQuantity);

    // `undefined` = campo não enviado (mantém o vínculo); `null` = desvincular.
    const kitIdChanged =
      patch.kitId !== undefined && (patch.kitId ?? null) !== existing.kitId;
    const nextKitId = kitIdChanged ? (patch.kitId ?? null) : existing.kitId;
    if (kitIdChanged && nextKitId) {
      await assertKitLinkAvailable(nextKitId, id, tx);
    }

    const status = resolveChargerStatus({
      requested: patch.status,
      current: existing.status,
      totalQuantity,
      availableQuantity,
    });

    const updated = await tx.chargerKit.update({
      where: { id },
      data: {
        ...(code !== undefined ? { code } : {}),
        ...(kitIdChanged ? { kitId: nextKitId } : {}),
        ...(patch.totalQuantity !== undefined ? { totalQuantity } : {}),
        ...(patch.availableQuantity !== undefined ? { availableQuantity } : {}),
        ...(patch.missingParts !== undefined
          ? { missingParts: patch.missingParts }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        status,
      },
    });

    const changes = diffChanges(
      {
        code: existing.code,
        kitId: existing.kitId,
        totalQuantity: existing.totalQuantity,
        availableQuantity: existing.availableQuantity,
        status: existing.status,
        missingParts: existing.missingParts,
        notes: existing.notes,
      },
      {
        code: updated.code,
        kitId: updated.kitId,
        totalQuantity: updated.totalQuantity,
        availableQuantity: updated.availableQuantity,
        status: updated.status,
        missingParts: updated.missingParts,
        notes: updated.notes,
      },
    );

    // O status pode mudar sem ter sido pedido (derivação). Deixar isso escrito
    // no resumo evita que o histórico pareça ter mudado sozinho.
    const statusDerivado =
      updated.status !== existing.status &&
      (!patch.status || !isManualChargerStatus(patch.status));

    const resumo =
      changes.changedKeys.length > 0
        ? `Alterado: ${changes.changedKeys.join(", ")}`
        : "Nenhum campo alterado";

    const resumoBase = meta.summary ?? resumo;

    await audit(
      {
        actorId: actor.id,
        action: meta.action,
        entity: "ChargerKit",
        entityId: id,
        summary: statusDerivado
          ? `${resumoBase} — status recalculado para "${CHARGER_KIT_STATUS_LABEL[updated.status]}" a partir de ${updated.availableQuantity}/${updated.totalQuantity}`
          : resumoBase,
        before: changes.before,
        after: {
          ...changes.after,
          ...(statusDerivado ? { statusDerivadoDasQuantidades: true } : {}),
        },
        ip: context.ip,
        userAgent: context.userAgent,
      },
      tx,
    );
  });

  return getChargerKit(id, actor);
}

export async function updateChargerKit(
  id: string,
  patch: UpdateChargerKitInput,
  actor: SessionUser,
  context: MutationContext = {},
): Promise<ChargerKitDetail> {
  return applyChargerPatch(id, patch, actor, context, {
    action: "kit-carregadores.atualizar",
  });
}

/**
 * Desativação lógica.
 *
 * Como o kit de carregadores aparece em ocorrências e no histórico das
 * reservas, ele nunca é apagado: recebe `DESATIVADO` e é desvinculado da
 * maleta, liberando a vaga 1-1 para um kit de reposição.
 */
export async function deactivateChargerKit(
  id: string,
  actor: SessionUser,
  context: MutationContext = {},
): Promise<ChargerKitDetail> {
  assertSupervisor(actor);

  const existing = await prisma.chargerKit.findUnique({
    where: { id },
    select: { status: true, code: true },
  });
  if (!existing) throw naoEncontrado("Kit de carregadores não encontrado.");
  if (existing.status === "DESATIVADO") {
    throw regraDeNegocio(
      `O kit de carregadores ${existing.code} já está desativado.`,
    );
  }

  return applyChargerPatch(
    id,
    { status: "DESATIVADO", kitId: null },
    actor,
    context,
    {
      action: "kit-carregadores.desativar",
      summary: `Kit de carregadores ${existing.code} desativado e desvinculado da maleta/carrinho`,
    },
  );
}
