import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Configuração de testes separada da `vite.config.ts`.
 *
 * O plugin do vinext monta os ambientes RSC/SSR do Vite, o que não é
 * necessário — e atrapalha — para testes de unidade e integração que rodam
 * direto em Node.
 *
 * Os testes de integração usam um PostgreSQL real (ver `tests/setup-db.ts`):
 * a lógica de conflito de reservas depende de restrição EXCLUDE e de
 * transações, e nada disso seria exercido contra um banco simulado.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    // Os testes de integração compartilham um banco; rodá-los em paralelo
    // criaria interferência entre arquivos.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
