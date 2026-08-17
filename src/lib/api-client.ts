"use client";

import type { ApiErrorBody } from "./http";

/**
 * Cliente HTTP dos componentes de interface.
 *
 * Traduz o envelope de erro da API em uma exceção tipada, para que os
 * formulários possam exibir a mensagem geral e, quando houver, os erros por
 * campo — sem cada tela reimplementar esse tratamento.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors: Record<string, string[]>;
  readonly details: unknown;

  constructor(
    status: number,
    body: ApiErrorBody["erro"] | undefined,
    fallback = "Não foi possível concluir a operação.",
  ) {
    super(body?.mensagem ?? fallback);
    this.name = "ApiError";
    this.status = status;
    this.code = body?.codigo ?? "ERRO_INTERNO";
    this.fieldErrors = body?.campos ?? {};
    this.details = body?.detalhes;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // Envia o cookie de sessão; a API é do mesmo domínio.
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, undefined, "Falha de conexão. Verifique a rede e tente novamente.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const erro = (payload as ApiErrorBody | undefined)?.erro;
    throw new ApiError(response.status, erro);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path),
};

/** Monta uma query string ignorando valores vazios. */
export function queryString(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
