import { defineConfig, env } from "prisma/config";

// Prisma 7 não carrega `.env` automaticamente. Node >= 20.6 traz
// `process.loadEnvFile`, evitando uma dependência extra só para isso.
try {
  process.loadEnvFile(".env");
} catch {
  // Sem arquivo `.env` — as variáveis já devem vir do ambiente (Docker/Coolify).
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
