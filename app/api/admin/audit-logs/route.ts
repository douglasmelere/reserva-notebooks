import { z } from "zod";
import { requireSupervisor } from "@/lib/auth";
import { sanitizeForAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { dadosInvalidos } from "@/lib/errors";
import { handle, json, readQuery } from "@/lib/http";
import { listQuerySchema } from "@/lib/validation";
import { limitesDoDia } from "@/server/reports";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

/**
 * Entidades auditáveis. Fechar em uma lista evita que um filtro digitado à mão
 * varra a tabela inteira com um valor que nunca existiu.
 */
const auditEntitySchema = z.enum(
  [
    "User",
    "Kit",
    "Notebook",
    "ChargerKit",
    "Reservation",
    "Incident",
    "SystemSetting",
    "Session",
  ],
  { message: "Tipo de registro desconhecido para a auditoria." },
);

const auditQuerySchema = listQuerySchema.extend({
  entity: auditEntitySchema.optional(),
  entityId: z
    .string()
    .trim()
    .min(1, "Informe o identificador do registro.")
    .max(64, "Identificador do registro muito longo.")
    .optional(),
  actorId: z
    .string()
    .trim()
    .min(1, "Informe o identificador de quem executou a ação.")
    .max(64, "Identificador de quem executou a ação muito longo.")
    .optional(),
  /** Prefixo/trecho da ação, ex.: "reserva" ou "kit.atualizar". */
  action: z
    .string()
    .trim()
    .min(1, "Informe ao menos um trecho da ação a filtrar.")
    .max(80, "Trecho da ação muito longo.")
    .optional(),
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

  if (filtros.from && filtros.to && filtros.from > filtros.to) {
    const mensagem = "A data inicial não pode ser posterior à data final.";
    throw dadosInvalidos(mensagem, { from: [mensagem] });
  }

  // O schema só garante o formato AAAA-MM-DD: "2026-02-30" passa por ele e
  // quebraria a conversão de fuso com um 500 "erro inesperado".
  const inicio = filtros.from ? limitesDoDia(filtros.from, "from").start : null;
  const fim = filtros.to ? limitesDoDia(filtros.to, "to").end : null;

  const where: Prisma.AuditLogWhereInput = {
    ...(filtros.entity ? { entity: filtros.entity } : {}),
    ...(filtros.entityId ? { entityId: filtros.entityId } : {}),
    ...(filtros.actorId ? { actorId: filtros.actorId } : {}),
    ...(filtros.action
      ? { action: { contains: filtros.action, mode: "insensitive" } }
      : {}),
    ...(inicio || fim
      ? {
          createdAt: {
            // As datas chegam no fuso da instituição; o banco guarda UTC.
            ...(inicio ? { gte: inicio } : {}),
            ...(fim ? { lt: fim } : {}),
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
