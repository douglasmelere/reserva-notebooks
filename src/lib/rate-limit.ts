import { prisma } from "./db";
import { getEnv } from "./env";
import { AppError } from "./errors";

/**
 * Rate limiting do login, com estado no banco.
 *
 * Contadores em memória se perdem a cada restart do container e não valem nada
 * se um dia a aplicação rodar em mais de uma réplica. Como o volume é baixo
 * (uma escola), guardar as tentativas em uma tabela indexada é suficiente e
 * evita acrescentar Redis à topologia do Coolify.
 *
 * Limitamos por usuário e por IP: o primeiro protege uma conta específica de
 * força bruta; o segundo protege contra varredura de vários usuários a partir
 * da mesma origem.
 */

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export async function checkLoginRateLimit(
  username: string,
  ip: string,
): Promise<RateLimitResult> {
  const env = getEnv();
  const windowStart = new Date(Date.now() - env.LOGIN_WINDOW_MINUTES * 60_000);

  const [byUsername, byIp] = await Promise.all([
    prisma.loginAttempt.count({
      where: { username, success: false, createdAt: { gte: windowStart } },
    }),
    prisma.loginAttempt.count({
      where: { ip, success: false, createdAt: { gte: windowStart } },
    }),
  ]);

  // O limite por IP é mais folgado: uma sala de professores costuma sair pelo
  // mesmo IP público, e bloquear a escola inteira por erros de digitação de
  // um usuário seria pior que o ataque que queremos evitar.
  const ipLimit = env.LOGIN_MAX_ATTEMPTS * 5;

  if (byUsername >= env.LOGIN_MAX_ATTEMPTS || byIp >= ipLimit) {
    return {
      allowed: false,
      retryAfterSeconds: env.LOGIN_WINDOW_MINUTES * 60,
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordLoginAttempt(
  username: string,
  ip: string,
  success: boolean,
): Promise<void> {
  await prisma.loginAttempt.create({ data: { username, ip, success } });

  // Um login bem-sucedido zera o bloqueio daquele usuário: quem lembrou a
  // senha não deve continuar penalizado pelas tentativas anteriores.
  if (success) {
    await prisma.loginAttempt.deleteMany({ where: { username, success: false } });
  }
}

export function tooManyAttempts(retryAfterSeconds: number): AppError {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return new AppError(
    "MUITAS_TENTATIVAS",
    `Muitas tentativas de login. Aguarde ${minutes} minuto(s) e tente novamente.`,
  );
}

/** Remove tentativas antigas. Chamado pelo job de limpeza. */
export async function purgeOldLoginAttempts(olderThanDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const result = await prisma.loginAttempt.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
