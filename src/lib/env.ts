import { z } from "zod";

/**
 * Validação das variáveis de ambiente.
 *
 * Falhar cedo e com mensagem clara é preferível a descobrir uma variável
 * ausente só quando o primeiro usuário tenta entrar. Em produção, um segredo
 * de sessão fraco derruba o processo de propósito.
 */
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL é obrigatória (string de conexão do PostgreSQL)"),

  /// URL pública da aplicação. Usada para validar a origem das requisições
  /// (proteção CSRF) e para montar links absolutos.
  APP_URL: z.string().url().default("http://localhost:3000"),

  /// Segredo usado para derivar o hash dos tokens de sessão.
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET precisa ter ao menos 32 caracteres"),

  /// Duração da sessão em horas.
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),

  /// Fuso horário da instituição. Toda data/hora informada pelo usuário é
  /// interpretada neste fuso e convertida para UTC antes de persistir.
  INSTITUTION_TIMEZONE: z.string().default("America/Sao_Paulo"),

  /// Bootstrap do primeiro supervisor (opcional; ver docs/deploy).
  BOOTSTRAP_ADMIN_USERNAME: z.string().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().optional(),

  /// Armazenamento de anexos: "s3" (recomendado) ou "local" (volume).
  STORAGE_DRIVER: z.enum(["s3", "local"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("/data/uploads"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  /// Custo do Argon2id. Ajustável conforme a CPU/memória da VPS.
  ARGON2_MEMORY_COST: z.coerce.number().int().positive().default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().positive().default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().positive().default(1),

  /// Rate limiting do login.
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  /// Permite desligar o cookie `secure` em ambientes HTTP internos.
  COOKIE_SECURE: z
    .enum(["auto", "true", "false"])
    .default("auto"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Configuração de ambiente inválida:\n${issues}\n\nConsulte .env.example.`,
    );
  }

  const env = parsed.data;

  if (env.NODE_ENV === "production") {
    if (/dev-only|change-me|localhost-secret/i.test(env.SESSION_SECRET)) {
      throw new Error(
        "SESSION_SECRET de exemplo detectado em produção. Gere um novo com: openssl rand -hex 32",
      );
    }
    if (env.STORAGE_DRIVER === "s3") {
      const missing = (
        ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const
      ).filter((k) => !env[k]);
      if (missing.length > 0) {
        throw new Error(
          `STORAGE_DRIVER=s3 exige: ${missing.join(", ")}`,
        );
      }
    }
  }

  cached = env;
  return env;
}

/** Cookies `secure` são obrigatórios sob HTTPS; `auto` decide pelo APP_URL. */
export function cookiesAreSecure(): boolean {
  const env = getEnv();
  if (env.COOKIE_SECURE === "true") return true;
  if (env.COOKIE_SECURE === "false") return false;
  return env.APP_URL.startsWith("https://");
}
