import { z } from "zod";
import { requireSupervisor } from "@/lib/auth";
import { sanitizeForAudit } from "@/lib/audit";
import { dayBounds } from "@/lib/datetime";
import { prisma } from "@/lib/db";
import { handle, json, readQuery } from "@/lib/http";
import { listQuerySchema } from "@/lib/validation";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * Entidades auditáveis. Fechar em uma lista evita que um filtro digitado à mão
 * varra a tabela inteira com um valor que nunca existiu.
 */
const auditEntitySchema = z.enum([
  "User",
  "Kit",
  "Notebook",
  "ChargerKit",
  "Reservation",
  "Incident",
  "SystemSetting",
  "Session",
]);

const auditQuerySchema = listQuerySchema.extend({
  entity: auditEntitySchema.optional(),
  entityId: z.string().trim().min(1).max(64).optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  /** Prefixo/trecho da ação, ex.: "reserva" ou "kit.atualizar". */
  action: z.string().trim().min(1).max(80).optional(),
});

/**
 * Trilha de auditoria.
 *
 * `before`/`after` já foram limpos de segredos na gravação (`sanitizeForAudit`);
 * passamos de novo na leitura porque registros antigos podem ter sido gravados
 * antes de alguma chave entrar na lista de redação — a limpeza é barata e a
 * alternativa é vazar um hash na tela da supervisão.
 */
export const GET = handle(async (request: Request) => {
  await requireSupervisor();

  const filtros = readQuery(request, auditQuerySchema);

  const where: Prisma.AuditLogWhereInput = {
    ...(filtros.entity ? { entity: filtros.entity } : {}),
    ...(filtros.entityId ? { entityId: filtros.entityId } : {}),
    ...(filtros.actorId ? { actorId: filtros.actorId } : {}),
    ...(filtros.action
      ? { action: { contains: filtros.action, mode: "insensitive" } }
      : {}),
    ...(filtros.from || filtros.to
      ? {
          createdAt: {
            // As datas chegam no fuso da instituição; o banco guarda UTC.
            ...(filtros.from ? { gte: dayBounds(filtros.from).start } : {}),
            ...(filtros.to ? { lt: dayBounds(filtros.to).end } : {}),
          },
        }
      : {}),
    ...(filtros.search
      ? {
          OR: [
            { summary: { contains: filtros.search, mode: "insensitive" } },
            { action: { contains: filtros.search, mode: "insensitive" } },
            { entityId: { contains: filtros.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [registros, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filtros.page - 1) * filtros.pageSize,
      take: filtros.pageSize,
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        summary: true,
        before: true,
        after: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        actor: { select: { id: true, fullName: true, username: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return json({
    itens: registros.map((registro) => ({
      id: registro.id,
      acao: registro.action,
      entidade: registro.entity,
      entidadeId: registro.entityId,
      resumo: registro.summary,
      antes: sanitizeForAudit(registro.before) ?? null,
      depois: sanitizeForAudit(registro.after) ?? null,
      ip: registro.ip,
      userAgent: registro.userAgent,
      criadoEm: registro.createdAt.toISOString(),
      ator: registro.actor
        ? {
            id: registro.actor.id,
            fullName: registro.actor.fullName,
            username: registro.actor.username,
          }
        : null,
    })),
    total,
    page: filtros.page,
    pageSize: filtros.pageSize,
    totalPaginas: Math.max(1, Math.ceil(total / filtros.pageSize)),
  });
}, "admin.audit-logs");
