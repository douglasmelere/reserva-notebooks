import { cookies, headers } from "next/headers";
import { getEnv, cookiesAreSecure } from "./env";
import { AppError, naoAutenticado, semPermissao } from "./errors";
import {
  SESSION_COOKIE,
  resolveSession,
  type SessionUser,
} from "./session";

/**
 * Ponto único de autenticação/autorização do lado do servidor.
 *
 * Tanto os Server Components quanto os route handlers passam por aqui. A
 * interface esconde botões, mas quem realmente decide é este módulo: um
 * professor que chame a API administrativa direto recebe 403 do mesmo jeito.
 */

export type AuthContext = {
  user: SessionUser;
  sessionId: string;
};

/** Usuário autenticado, ou `null`. Não lança. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const resolved = await resolveSession(token);
  return resolved?.user ?? null;
}

/** Contexto completo (usuário + sessão), ou `null`. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  return await resolveSession(token);
}

/** Exige um usuário autenticado. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw naoAutenticado();
  return user;
}

/** Exige perfil de supervisão. */
export async function requireSupervisor(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "SUPERVISOR") {
    throw semPermissao("Esta área é restrita à supervisão.");
  }
  return user;
}

/** `true` se o usuário é dono do recurso ou é supervisor. */
export function canManage(user: SessionUser, ownerId: string): boolean {
  return user.role === "SUPERVISOR" || user.id === ownerId;
}

/** Exige ser dono do recurso ou supervisor. */
export function assertCanManage(user: SessionUser, ownerId: string): void {
  if (!canManage(user, ownerId)) {
    throw semPermissao("Você só pode alterar as suas próprias reservas.");
  }
}

// ---------------------------------------------------------------------------
// Cookie de sessão
// ---------------------------------------------------------------------------

export async function setSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookiesAreSecure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: cookiesAreSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// ---------------------------------------------------------------------------
// Dados da requisição
// ---------------------------------------------------------------------------

/**
 * IP do cliente.
 *
 * Atrás do proxy reverso do Coolify (Traefik), o IP real vem em
 * `x-forwarded-for`. Usamos a primeira entrada da lista, que é o cliente
 * original. Só confie nesse cabeçalho quando a aplicação está de fato atrás de
 * um proxy — o que é o caso do deploy documentado.
 */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip") ?? "desconhecido";
}

export async function getUserAgent(): Promise<string | null> {
  const h = await headers();
  return h.get("user-agent");
}

/**
 * Proteção CSRF para mutações.
 *
 * O cookie de sessão é `SameSite=Lax`, o que já bloqueia envios cross-site em
 * formulários POST. Esta checagem de origem é a segunda camada: comparamos o
 * `Origin` (ou `Referer`) com a URL pública configurada e recusamos o que não
 * bater. Requisições sem `Origin` — como um `curl` de terminal ou um cliente
 * de API — não são cross-site e passam.
 */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  const origin = h.get("origin") ?? undefined;
  if (!origin) return;

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(getEnv().APP_URL).origin);
  } catch {
    // APP_URL inválida já teria sido barrada na validação de ambiente.
  }

  // O host efetivo da requisição também é aceito: cobre acesso por IP interno
  // ou por um domínio alternativo apontado para o mesmo container.
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  if (host) {
    allowed.add(`${proto}://${host}`);
    allowed.add(`http://${host}`);
  }

  if (!allowed.has(origin)) {
    throw new AppError(
      "ORIGEM_INVALIDA",
      "Requisição recusada por origem não confiável.",
    );
  }
}
