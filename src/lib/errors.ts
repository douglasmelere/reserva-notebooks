/**
 * Erros de domínio.
 *
 * Toda falha esperada vira um `AppError` com código estável e mensagem já em
 * português, pronta para exibição. Qualquer outra exceção é tratada como erro
 * interno: o detalhe vai para o log do servidor e o cliente recebe apenas uma
 * mensagem genérica — nunca stack trace.
 */
export type AppErrorCode =
  | "NAO_AUTENTICADO"
  | "SEM_PERMISSAO"
  | "NAO_ENCONTRADO"
  | "DADOS_INVALIDOS"
  | "CONFLITO"
  | "CONFLITO_RESERVA"
  | "REGRA_DE_NEGOCIO"
  | "MUITAS_TENTATIVAS"
  | "ORIGEM_INVALIDA"
  | "ERRO_INTERNO";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  NAO_AUTENTICADO: 401,
  SEM_PERMISSAO: 403,
  NAO_ENCONTRADO: 404,
  DADOS_INVALIDOS: 422,
  CONFLITO: 409,
  CONFLITO_RESERVA: 409,
  REGRA_DE_NEGOCIO: 422,
  MUITAS_TENTATIVAS: 429,
  ORIGEM_INVALIDA: 403,
  ERRO_INTERNO: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Erros por campo, no formato aceito pelos formulários. */
  readonly fieldErrors?: Record<string, string[]>;
  /** Dados extras seguros para o cliente (ex.: reservas conflitantes). */
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: {
      fieldErrors?: Record<string, string[]>;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.fieldErrors = options?.fieldErrors;
    this.details = options?.details;
  }
}

export const naoAutenticado = (msg = "Faça login para continuar.") =>
  new AppError("NAO_AUTENTICADO", msg);

export const semPermissao = (msg = "Você não tem permissão para esta ação.") =>
  new AppError("SEM_PERMISSAO", msg);

export const naoEncontrado = (msg = "Registro não encontrado.") =>
  new AppError("NAO_ENCONTRADO", msg);

export const dadosInvalidos = (
  msg: string,
  fieldErrors?: Record<string, string[]>,
) => new AppError("DADOS_INVALIDOS", msg, { fieldErrors });

export const regraDeNegocio = (msg: string, details?: unknown) =>
  new AppError("REGRA_DE_NEGOCIO", msg, { details });

export const conflito = (msg: string, details?: unknown) =>
  new AppError("CONFLITO", msg, { details });

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
