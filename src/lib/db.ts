import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Instância única do Prisma Client.
 *
 * O Prisma 7 é "Rust-free": o acesso ao banco acontece pelo driver adapter
 * (`pg`, JavaScript puro), o que torna o client compatível com o pipeline de
 * bundling do Vite/vinext sem binários nativos.
 *
 * Em desenvolvimento o HMR recria os módulos a cada alteração; guardamos a
 * instância em `globalThis` para não abrir um novo pool de conexões a cada
 * recarga.
 */
declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL não configurada. Copie .env.example para .env e ajuste a conexão.",
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "production"
        ? ["warn", "error"]
        : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalThis.__prisma__ ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma__ = prisma;
}
