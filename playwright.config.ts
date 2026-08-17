import { defineConfig, devices } from "@playwright/test";

/**
 * Testes ponta a ponta.
 *
 * Rodam contra o servidor de PRODUÇÃO (`npm run build && npm run start`), e não
 * contra o de desenvolvimento: é a build de produção que vai para o Coolify, e
 * é nela que erros de bundling, de RSC e de variáveis de ambiente aparecem.
 *
 * Antes de rodar:
 *   docker compose up -d db
 *   DATABASE_URL=...reserva_e2e npx prisma migrate deploy
 *   npm run db:seed
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Os cenários compartilham um banco; rodar em paralelo criaria interferência
  // entre reservas de arquivos diferentes.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // O sistema é usado no celular no corredor da escola; a responsividade
      // das telas principais é requisito, não detalhe.
      name: "celular",
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && PORT=${PORT} npm run start`,
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
        env: {
          NODE_ENV: "production",
          PORT: String(PORT),
          APP_URL: BASE_URL,
          COOKIE_SECURE: "false",
          SESSION_SECRET:
            process.env.SESSION_SECRET ??
            "segredo-de-teste-e2e-com-mais-de-32-caracteres-000",
          DATABASE_URL:
            process.env.E2E_DATABASE_URL ??
            "postgresql://reserva:devpass@localhost:55432/reserva_e2e?schema=public",
        },
      },
});
