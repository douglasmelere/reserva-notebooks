import { z } from "zod";
import { AppError, isAppError } from "./errors";
import { getEnv } from "./env";

/**
 * Envelope de resposta e tratamento de erro da API.
 *
 * Todo route handler é embrulhado por `handle()`, que garante três coisas:
 * respostas de erro sempre no mesmo formato, códigos HTTP corretos e — em
 * produção — nenhum vazamento de stack trace ou mensagem interna.
 */

export type ApiErrorBody = {
  erro: {
    codigo: string;
    mensagem: string;
    campos?: Record<string, string[]>;
    detalhes?: unknown;
  };
};

export function json<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function noContent(): Response {
  return new Response(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  });
}

export function errorResponse(error: AppError): Response {
  const body: ApiErrorBody = {
    erro: {
      codigo: error.code,
      mensagem: error.message,
      ...(error.fieldErrors ? { campos: error.fieldErrors } : {}),
      ...(error.details !== undefined ? { detalhes: error.details } : {}),
    },
  };
  return json(body, { status: error.status });
}

/** Converte erros do Zod em `AppError` com erros por campo. */
export function fromZodError(error: z.ZodError): AppError {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_";
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return new AppError("DADOS_INVALIDOS", "Verifique os dados informados.", {
    fieldErrors,
  });
}

/** Erros do PostgreSQL que sabemos traduzir para o usuário. */
function translateDatabaseError(error: unknown): AppError | null {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : undefined;

  // Violação da restrição EXCLUDE que impede reservas sobrepostas.
  // Chegar aqui significa que duas requisições simultâneas passaram pela
  // checagem da camada de serviço — o banco é a rede de segurança.
  if (code === "23P01") {
    return new AppError(
      "CONFLITO_RESERVA",
      "Este recurso acabou de ser reservado por outra pessoa para o mesmo período. Atualize a disponibilidade e escolha outra opção.",
    );
  }

  if (code === "23505") {
    return new AppError(
      "CONFLITO",
      "Já existe um registro com esse identificador único.",
    );
  }

  if (code === "23503") {
    return new AppError(
      "REGRA_DE_NEGOCIO",
      "Não foi possível concluir: o registro está vinculado a outros dados.",
    );
  }

  return null;
}

/**
 * Normaliza qualquer exceção em `AppError`.
 * Erros inesperados viram 500 genérico e são registrados no servidor.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof z.ZodError) return fromZodError(error);

  // O Prisma embrulha o erro do driver; olhamos também em `cause`.
  const translated =
    translateDatabaseError(error) ??
    translateDatabaseError((error as { cause?: unknown })?.cause);
  if (translated) return translated;

  return new AppError(
    "ERRO_INTERNO",
    "Ocorreu um erro inesperado. Tente novamente em instantes.",
    { cause: error },
  );
}

/**
 * Registra o erro no log do servidor em formato JSON de uma linha — o formato
 * que o Coolify exibe bem. Nunca inclui corpo de requisição, senha ou token.
 */
export function logError(context: string, error: unknown): void {
  const env = getEnv();
  const base = {
    nivel: "erro",
    contexto: context,
    momento: new Date().toISOString(),
  };

  if (isAppError(error) && error.code !== "ERRO_INTERNO") {
    // Erros de negócio são esperados: registramos em nível informativo.
    console.warn(
      JSON.stringify({ ...base, nivel: "aviso", codigo: error.code, mensagem: error.message }),
    );
    return;
  }

  const cause = isAppError(error) ? error.cause : error;
  console.error(
    JSON.stringify({
      ...base,
      mensagem: cause instanceof Error ? cause.message : String(cause),
      // Stack só no log do servidor, e apenas fora de produção, para não
      // encher o log do Coolify com ruído.
      ...(env.NODE_ENV !== "production" && cause instanceof Error
        ? { stack: cause.stack }
        : {}),
    }),
  );
}

/**
 * Embrulha um route handler com tratamento de erro consistente.
 *
 * ```ts
 * export const GET = handle(async () => json(await listarKits()));
 * ```
 */
export function handle<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
  context = "api",
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      const appError = toAppError(error);
      logError(context, appError);
      return errorResponse(appError);
    }
  };
}

/** Lê e valida o corpo JSON da requisição. */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("DADOS_INVALIDOS", "Corpo da requisição inválido.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw fromZodError(parsed.error);
  return parsed.data;
}

/** Lê e valida os parâmetros de busca da URL. */
export function readQuery<S extends z.ZodType>(
  request: Request,
  schema: S,
): z.infer<S> {
  const url = new URL(request.url);
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    raw[key] = values.length > 1 ? values : values[0]!;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw fromZodError(parsed.error);
  return parsed.data;
}
