/**
 * Limpeza periódica.
 *
 * Sessões expiradas e tentativas de login se acumulam indefinidamente — a
 * primeira tabela cresce com o uso normal, a segunda cresce mais rápido ainda
 * sob tentativa de força bruta. Nenhuma das duas tem valor histórico depois de
 * alguns dias.
 *
 * Rode semanalmente como Scheduled Task do Coolify:
 *   npx tsx scripts/cleanup.ts
 */
import { purgeExpiredSessions } from "../src/lib/session.js";
import { purgeOldLoginAttempts } from "../src/lib/rate-limit.js";
import { prisma } from "../src/lib/db.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Em produção as variáveis vêm do ambiente do container.
}

const SESSION_RETENTION_DAYS = Number(process.env.CLEANUP_SESSION_DAYS ?? 7);
const LOGIN_RETENTION_DAYS = Number(process.env.CLEANUP_LOGIN_DAYS ?? 30);

async function main() {
  const sessoes = await purgeExpiredSessions(SESSION_RETENTION_DAYS);
  const tentativas = await purgeOldLoginAttempts(LOGIN_RETENTION_DAYS);

  console.log(
    JSON.stringify({
      nivel: "info",
      contexto: "limpeza",
      momento: new Date().toISOString(),
      sessoesRemovidas: sessoes,
      tentativasDeLoginRemovidas: tentativas,
    }),
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      nivel: "erro",
      contexto: "limpeza",
      mensagem: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});
