import { defineConfig } from "vite";
import vinext from "vinext";
import tailwindcss from "@tailwindcss/vite";

/**
 * Configuração do Vinext (Next.js rodando sobre Vite).
 *
 * Não registramos `@vitejs/plugin-rsc` manualmente: o vinext registra
 * automaticamente quando detecta o diretório `app/`.
 *
 * Nenhum plugin específico de plataforma (Cloudflare/Vercel/Nitro) é usado —
 * o alvo de produção é `vinext start`, um servidor Node comum dentro de um
 * container Docker gerenciado pelo Coolify.
 */
export default defineConfig({
  plugins: [tailwindcss(), vinext()],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  // `pg` e `@node-rs/argon2` acessam APIs/bindings do Node e devem ser
  // resolvidos em runtime pelo Node, nunca empacotados pelo Vite.
  ssr: {
    external: ["pg", "@node-rs/argon2", "@prisma/adapter-pg"],
  },
});
