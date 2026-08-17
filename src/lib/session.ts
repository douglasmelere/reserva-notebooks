import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import { getEnv } from "./env";
import type { Role } from "@/generated/prisma/enums";

export const SESSION_COOKIE = "reserva_session";

/**
 * Sessões opacas guardadas no banco.
 *
 * Optamos por sessão em banco no lugar de JWT porque o sistema precisa
 * revogar acesso imediatamente: quando a supervisão desativa uma conta ou
 * redefine uma senha, todas as sessões daquele usuário são encerradas na hora.
 * Um JWT autocontido continuaria válido até expirar.
 *
 * O cookie carrega o token em claro; o banco guarda apenas
 * `SHA-256(token + SESSION_SECRET)`. Um vazamento do banco não permite
 * reconstruir cookies válidos.
 */
function hashToken(token: string): string {
  return createHash("sha256")
    .update(`${token}.${getEnv().SESSION_SECRET}`)
    .digest("hex");
}

export type SessionUser = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  whatsappOptIn: boolean;
  department: string | null;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
};

export type CreateSessionInput = {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
};

export type CreatedSession = {
  token: string;
  expiresAt: Date;
};

export async function createSession(
  input: CreateSessionInput,
): Promise<CreatedSession> {
  const env = getEnv();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);

  await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(token),
      expiresAt,
      ip: input.ip ?? null,
      // Truncado: user agents longos não acrescentam nada ao diagnóstico.
      userAgent: input.userAgent?.slice(0, 255) ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * Resolve o usuário de uma sessão.
 *
 * Devolve `null` para sessão inexistente, expirada, revogada ou de conta
 * desativada — a checagem de `active` acontece a cada requisição, e não apenas
 * no login, para que desativar uma conta tenha efeito imediato.
 */
export async function resolveSession(
  token: string | undefined | null,
): Promise<{ user: SessionUser; sessionId: string } | null> {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          fullName: true,
          email: true,
          phone: true,
          whatsappOptIn: true,
          department: true,
          role: true,
          active: true,
          mustChangePassword: true,
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (!session.user.active) return null;

  // `lastUsedAt` serve para a supervisão auditar acessos; atualizamos no
  // máximo a cada 5 minutos para não gerar uma escrita por requisição.
  if (Date.now() - session.lastUsedAt.getTime() > 300_000) {
    await prisma.session
      .update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Falha aqui é irrelevante para a requisição em curso.
      });
  }

  return { user: session.user, sessionId: session.id };
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Encerra todas as sessões de um usuário (desativação, troca de senha). */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Remove sessões expiradas/revogadas antigas. Chamado pelo job de limpeza. */
export async function purgeExpiredSessions(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const result = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return result.count;
}

/** Comparação de strings em tempo constante (usada em fluxos de token). */
export function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
