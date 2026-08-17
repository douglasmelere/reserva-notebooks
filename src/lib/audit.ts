import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Trilha de auditoria e histórico de alterações.
 *
 * Uma única tabela `audit_logs` atende dois requisitos ao mesmo tempo: a
 * auditoria de ações administrativas e o "histórico de alterações" exigido
 * para kits, notebooks, reservas e ocorrências. Evita uma tabela de histórico
 * por entidade e mantém a consulta de histórico uniforme.
 */

export type AuditEntity =
  | "User"
  | "Kit"
  | "Notebook"
  | "ChargerKit"
  | "Reservation"
  | "Incident"
  | "SystemSetting"
  | "Session";

export type AuditInput = {
  actorId: string | null;
  action: string;
  entity: AuditEntity;
  entityId: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
};

/** Campos que nunca podem entrar na auditoria. */
const REDACTED_KEYS = new Set([
  "passwordHash",
  "password_hash",
  "password",
  "senha",
  "token",
  "tokenHash",
  "token_hash",
  "sessionSecret",
]);

/**
 * Remove segredos e normaliza para JSON.
 *
 * A auditoria é lida pela supervisão na interface; um hash de senha ou token
 * ali seria um vazamento silencioso. A limpeza é recursiva porque os objetos
 * gravados vêm direto de registros do Prisma.
 */
export function sanitizeForAudit(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  if (depth > 6) return "[profundidade máxima]";

  if (value instanceof Date) return value.toISOString();

  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return value as Prisma.InputJsonValue;
  }
  if (type === "bigint") return Number(value as bigint);

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeForAudit(item, depth + 1))
      .filter((item): item is Prisma.InputJsonValue => item !== undefined);
  }

  if (type === "object") {
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (REDACTED_KEYS.has(key)) continue;
      const clean = sanitizeForAudit(raw, depth + 1);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }

  return undefined;
}

/**
 * Grava um evento de auditoria.
 *
 * Aceita um client transacional para que o registro caia junto com a operação
 * quando a transação é revertida — auditoria de algo que não aconteceu seria
 * pior do que auditoria nenhuma.
 */
export async function audit(
  input: AuditInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      summary: input.summary ?? null,
      before: sanitizeForAudit(input.before),
      after: sanitizeForAudit(input.after),
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 255) ?? null,
    },
  });
}

/**
 * Versão que nunca lança.
 *
 * Usada fora de transação, quando a ação principal já foi concluída: falhar a
 * requisição inteira porque o log de auditoria não gravou seria pior para o
 * usuário do que perder uma linha de histórico.
 */
export async function auditSafe(
  input: AuditInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  try {
    await audit(input, client);
  } catch (error) {
    console.error(
      JSON.stringify({
        nivel: "erro",
        contexto: "auditoria",
        mensagem: error instanceof Error ? error.message : String(error),
        entidade: input.entity,
        acao: input.action,
      }),
    );
  }
}

/** Histórico de uma entidade, do mais recente para o mais antigo. */
export async function entityHistory(
  entity: AuditEntity,
  entityId: string,
  limit = 100,
) {
  return prisma.auditLog.findMany({
    where: { entity, entityId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, fullName: true, username: true } },
    },
  });
}

/**
 * Calcula o "antes/depois" apenas dos campos que mudaram.
 * Deixa o histórico legível: só o que de fato foi alterado aparece na tela.
 */
export function diffChanges<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T>; changedKeys: string[] } {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  const changedKeys: string[] = [];

  for (const [key, nextValue] of Object.entries(after) as [keyof T, unknown][]) {
    if (nextValue === undefined) continue;
    const prevValue = before[key];

    const prevComparable =
      prevValue instanceof Date ? prevValue.getTime() : prevValue;
    const nextComparable =
      nextValue instanceof Date ? nextValue.getTime() : nextValue;

    if (prevComparable !== nextComparable) {
      changedBefore[key] = prevValue as T[keyof T];
      changedAfter[key] = nextValue as T[keyof T];
      changedKeys.push(String(key));
    }
  }

  return { before: changedBefore, after: changedAfter, changedKeys };
}
