import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { audit, auditSafe, diffChanges } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  AppError,
  dadosInvalidos,
  naoEncontrado,
  regraDeNegocio,
  semPermissao,
} from "@/lib/errors";
import { fakeVerify, hashPassword, verifyPassword } from "@/lib/password";
import {
  checkLoginRateLimit,
  recordLoginAttempt,
  tooManyAttempts,
} from "@/lib/rate-limit";
import {
  createSession,
  revokeAllUserSessions,
  revokeSession,
  type SessionUser,
} from "@/lib/session";
import { listQuerySchema } from "@/lib/validation";

/**
 * Serviço de contas: cadastro, autenticação, perfil e administração.
 *
 * Toda regra que protege a instituição mora aqui, e não na interface: quem
 * chamar a API diretamente encontra exatamente as mesmas barreiras. As duas
 * invariantes mais importantes são:
 *
 *  - o hash de senha nunca sai deste módulo (as projeções abaixo o excluem por
 *    construção, não por esquecimento);
 *  - a instituição nunca fica sem nenhum supervisor ativo.
 */

// ---------------------------------------------------------------------------
// Projeções seguras
// ---------------------------------------------------------------------------

/**
 * Campos de uma listagem administrativa.
 *
 * O telefone fica de fora de propósito: uma listagem paginada que devolve
 * contatos vira, na prática, um catálogo telefônico exportável do corpo
 * docente. Quem precisa do número abre a ficha individual do usuário.
 */
const summarySelect = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  department: true,
  role: true,
  active: true,
  mustChangePassword: true,
  whatsappOptIn: true,
  createdAt: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

/** Ficha individual: o próprio usuário ou a supervisão vendo um usuário. */
const detailSelect = {
  ...summarySelect,
  phone: true,
  updatedAt: true,
  passwordChangedAt: true,
} satisfies Prisma.UserSelect;

export type UserSummary = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  department: string | null;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  whatsappOptIn: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
};

export type UserDetail = UserSummary & {
  phone: string | null;
  updatedAt: Date;
  passwordChangedAt: Date | null;
};

export type ActionContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export type RegisterUserInput = {
  username: string;
  password: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  whatsappOptIn?: boolean;
  department?: string | null;
};

export type AdminCreateUserInput = RegisterUserInput & {
  role?: Role;
  active?: boolean;
};

export type UpdateProfileInput = {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  whatsappOptIn?: boolean;
  department?: string | null;
};

export type AdminUpdateUserInput = UpdateProfileInput & {
  role?: Role;
  active?: boolean;
};

export type AuthResult = {
  user: SessionUser;
  token: string;
  expiresAt: Date;
};

// ---------------------------------------------------------------------------
// Utilidades internas
// ---------------------------------------------------------------------------

/** Conflito de unicidade com erro no campo, para o formulário destacá-lo. */
function conflitoDeCampo(campo: string, mensagem: string): AppError {
  return new AppError("CONFLITO", mensagem, {
    fieldErrors: { [campo]: [mensagem] },
  });
}

/**
 * Mesma mensagem para usuário inexistente, senha errada e conta desativada.
 *
 * Distinguir os casos entregaria de graça a lista de logins válidos da
 * instituição a quem estivesse sondando o formulário.
 */
function credenciaisInvalidas(): AppError {
  return new AppError("NAO_AUTENTICADO", "Usuário ou senha inválidos.");
}

/**
 * Erro de unicidade do PostgreSQL traduzido para o campo certo.
 *
 * A pré-checagem cobre o caso comum; esta função cobre a corrida entre dois
 * cadastros simultâneos, que só o índice único do banco consegue arbitrar.
 */
function uniqueViolationFields(error: unknown): string[] | null {
  if (typeof error !== "object" || error === null) return null;
  if ((error as { code?: unknown }).code !== "P2002") return null;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === "string") return [target];
  return [];
}

function traduzUnicidade(error: unknown): never {
  const fields = uniqueViolationFields(error);
  if (fields) {
    if (fields.some((f) => f.includes("username"))) {
      throw conflitoDeCampo(
        "username",
        "Este nome de usuário já está em uso. Escolha outro.",
      );
    }
    if (fields.some((f) => f.includes("email"))) {
      throw conflitoDeCampo(
        "email",
        "Este e-mail já está cadastrado em outra conta.",
      );
    }
  }
  throw error;
}

/**
 * E-mails são comparados sem diferenciar maiúsculas.
 * O índice único do PostgreSQL é sensível a caixa; sem normalizar,
 * "Maria@escola.br" e "maria@escola.br" virariam duas contas distintas.
 */
function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * Autorização no próprio serviço, além da checagem na rota.
 *
 * Redundante de propósito: qualquer chamada futura vinda de um Server Action
 * ou de um script continua barrada mesmo que esqueçam o `requireSupervisor()`.
 */
function assertSupervisor(actor: SessionUser): void {
  if (actor.role !== "SUPERVISOR") {
    throw semPermissao("Esta área é restrita à supervisão.");
  }
}

/** Impede que o cadastro colida com um login/e-mail já existente. */
async function assertIdentificadoresLivres(
  username: string | null,
  email: string | null,
  ignoreUserId?: string,
): Promise<void> {
  const exceptSelf = ignoreUserId ? { id: { not: ignoreUserId } } : {};

  const [porUsername, porEmail] = await Promise.all([
    username
      ? prisma.user.findFirst({
          where: { username, ...exceptSelf },
          select: { id: true },
        })
      : Promise.resolve(null),
    email
      ? prisma.user.findFirst({
          where: { email, ...exceptSelf },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (porUsername) {
    throw conflitoDeCampo(
      "username",
      "Este nome de usuário já está em uso. Escolha outro.",
    );
  }
  if (porEmail) {
    throw conflitoDeCampo(
      "email",
      "Este e-mail já está cadastrado em outra conta.",
    );
  }
}

/**
 * Guarda das mudanças de privilégio.
 *
 * Duas travas distintas:
 *  1. ninguém se desativa nem se rebaixa — um clique errado deixaria o próprio
 *     supervisor sem acesso ao painel que usaria para desfazer o clique;
 *  2. o último supervisor ativo não pode perder o cargo — sem supervisor não há
 *     quem cadastre inventário, feche reservas ou recrie outro supervisor, e a
 *     recuperação exigiria acesso ao servidor (`npm run bootstrap:admin`).
 */
async function assertMudancaDePrivilegioPermitida(
  target: { id: string; role: Role; active: boolean },
  next: { role?: Role; active?: boolean },
  actor: SessionUser,
): Promise<void> {
  const desativando = next.active === false && target.active;
  const rebaixando =
    next.role !== undefined &&
    next.role !== target.role &&
    target.role === "SUPERVISOR";

  if (target.id === actor.id) {
    if (desativando) {
      throw regraDeNegocio(
        "Você não pode desativar a sua própria conta. Peça a outro supervisor.",
      );
    }
    if (next.role !== undefined && next.role !== target.role) {
      throw regraDeNegocio(
        "Você não pode alterar o seu próprio perfil de acesso. Peça a outro supervisor.",
      );
    }
  }

  const perdeSupervisao =
    target.role === "SUPERVISOR" && target.active && (desativando || rebaixando);
  if (!perdeSupervisao) return;

  const outrosSupervisores = await prisma.user.count({
    where: { role: "SUPERVISOR", active: true, id: { not: target.id } },
  });
  if (outrosSupervisores === 0) {
    throw regraDeNegocio(
      "Esta é a última conta de supervisão ativa do sistema. Promova outro usuário a supervisor antes de alterar esta conta.",
    );
  }
}

function toSessionUser(user: {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  whatsappOptIn: boolean;
  department: string | null;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
}): SessionUser {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    whatsappOptIn: user.whatsappOptIn,
    department: user.department,
    role: user.role,
    active: user.active,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Mantém no patch apenas os campos realmente enviados pelo cliente.
 *
 * Os esquemas compartilhados normalizam campos textuais opcionais para `null`,
 * então um PATCH que só troca o nome chegaria aqui pedindo, sem querer, para
 * apagar e-mail, telefone e departamento. Comparar com as chaves do corpo
 * original preserva a semântica de PATCH: o que não veio não muda.
 */
export function somenteCamposEnviados<T extends object>(
  parsed: T,
  rawBody: Record<string, unknown>,
): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(parsed) as (keyof T & string)[]) {
    if (Object.hasOwn(rawBody, key)) out[key] = parsed[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cadastro público
// ---------------------------------------------------------------------------

/**
 * Cadastro do professor pela tela pública.
 *
 * Sempre cria com perfil PROFESSOR e conta ativa: elevar privilégio é ação
 * exclusiva da supervisão. O primeiro supervisor nasce fora da web, pelo
 * script `npm run bootstrap:admin`.
 */
export async function registerUser(
  input: RegisterUserInput,
  ctx: ActionContext = {},
): Promise<UserDetail> {
  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);

  await assertIdentificadoresLivres(username, email);

  const passwordHash = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          passwordHash,
          fullName: input.fullName.trim(),
          email,
          phone: input.phone ?? null,
          whatsappOptIn: input.whatsappOptIn ?? false,
          department: input.department ?? null,
          role: "PROFESSOR",
          active: true,
          passwordChangedAt: new Date(),
        },
        select: detailSelect,
      });

      // O ator é o próprio recém-criado: o registro nasce dentro da transação,
      // então a chave estrangeira da auditoria já é válida aqui.
      await audit(
        {
          actorId: created.id,
          action: "usuario.cadastrar",
          entity: "User",
          entityId: created.id,
          summary: `Cadastro público de ${created.fullName} (${created.username})`,
          after: {
            username: created.username,
            fullName: created.fullName,
            role: created.role,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return created;
    });
  } catch (error) {
    traduzUnicidade(error);
  }
}

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------

/**
 * Verifica credenciais e abre a sessão.
 *
 * O caminho de falha é deliberadamente uniforme: conta inexistente, conta
 * desativada e senha errada custam o mesmo tempo (`fakeVerify` gasta um
 * Argon2id descartável), contam para o mesmo limite de tentativas e devolvem a
 * mesma mensagem. Só assim o formulário não vira um oráculo de quais logins
 * existem na instituição.
 */
export async function authenticate(
  username: string,
  password: string,
  ctx: ActionContext & { ip: string },
): Promise<AuthResult> {
  const login = normalizeUsername(username);
  const ip = ctx.ip || "desconhecido";

  const limite = await checkLoginRateLimit(login, ip);
  if (!limite.allowed) throw tooManyAttempts(limite.retryAfterSeconds);

  const user = await prisma.user.findUnique({
    where: { username: login },
    select: {
      id: true,
      username: true,
      fullName: true,
      email: true,
      phone: true,
      whatsappOptIn: true,
      department: true,
      role: true,
      active: true,
      mustChangePassword: true,
      passwordHash: true,
    },
  });

  if (!user || !user.active) {
    await fakeVerify(password);
    await recordLoginAttempt(login, ip, false);
    throw credenciaisInvalidas();
  }

  const senhaConfere = await verifyPassword(user.passwordHash, password);
  await recordLoginAttempt(login, ip, senhaConfere);
  if (!senhaConfere) throw credenciaisInvalidas();

  const { token, expiresAt } = await createSession({
    userId: user.id,
    ip,
    userAgent: ctx.userAgent,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  // Entidade "Session", e não "User": o histórico da ficha do usuário deve
  // mostrar mudanças administrativas, não uma enxurrada de logins diários.
  await auditSafe({
    actorId: user.id,
    action: "sessao.login",
    entity: "Session",
    entityId: user.id,
    summary: `Login de ${user.username}`,
    ip,
    userAgent: ctx.userAgent,
  });

  return { user: toSessionUser(user), token, expiresAt };
}

/** Revoga a sessão do token informado. Idempotente. */
export async function logout(
  token: string | null | undefined,
  actor?: SessionUser | null,
  ctx: ActionContext = {},
): Promise<void> {
  if (!token) return;
  await revokeSession(token);

  if (actor) {
    await auditSafe({
      actorId: actor.id,
      action: "sessao.logout",
      entity: "Session",
      entityId: actor.id,
      summary: `Logout de ${actor.username}`,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }
}

// ---------------------------------------------------------------------------
// Perfil do próprio usuário
// ---------------------------------------------------------------------------

export async function getProfile(userId: string): Promise<UserDetail> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: detailSelect,
  });
  if (!user) throw naoEncontrado("Usuário não encontrado.");
  return user;
}

/**
 * Atualiza os próprios dados de contato.
 *
 * `role` e `active` não existem neste caminho: promover-se a supervisor ou
 * reativar a própria conta jamais pode passar pela tela de perfil.
 */
export async function updateProfile(
  userId: string,
  patch: UpdateProfileInput,
  ctx: ActionContext = {},
): Promise<UserDetail> {
  const atual = await prisma.user.findUnique({
    where: { id: userId },
    select: detailSelect,
  });
  if (!atual) throw naoEncontrado("Usuário não encontrado.");

  const email =
    patch.email !== undefined ? normalizeEmail(patch.email) : undefined;
  if (email) await assertIdentificadoresLivres(null, email, userId);

  const data: Prisma.UserUpdateInput = {
    ...(patch.fullName !== undefined ? { fullName: patch.fullName.trim() } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    ...(patch.whatsappOptIn !== undefined
      ? { whatsappOptIn: patch.whatsappOptIn }
      : {}),
    ...(patch.department !== undefined ? { department: patch.department } : {}),
  };

  // Retirar o consentimento de WhatsApp precisa ter efeito real: sem apagar o
  // número, ele continuaria armazenado sem base para uso.
  if (patch.whatsappOptIn === false) data.phone = null;

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data,
        select: detailSelect,
      });

      const changes = diffChanges(
        {
          fullName: atual.fullName,
          email: atual.email,
          department: atual.department,
          whatsappOptIn: atual.whatsappOptIn,
          telefoneCadastrado: Boolean(atual.phone),
        },
        {
          fullName: updated.fullName,
          email: updated.email,
          department: updated.department,
          whatsappOptIn: updated.whatsappOptIn,
          telefoneCadastrado: Boolean(updated.phone),
        },
      );

      if (changes.changedKeys.length > 0) {
        await audit(
          {
            actorId: userId,
            action: "usuario.atualizar-perfil",
            entity: "User",
            entityId: userId,
            summary: `Perfil atualizado: ${changes.changedKeys.join(", ")}`,
            before: changes.before,
            after: changes.after,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
          },
          tx,
        );
      }

      return updated;
    });
  } catch (error) {
    traduzUnicidade(error);
  }
}

/**
 * Troca de senha pelo próprio usuário.
 *
 * Decisão: revogamos **todas** as sessões e abrimos uma nova para quem está
 * trocando a senha, devolvendo o token para a rota renovar o cookie. Preservar
 * a sessão atual exigiria uma variante de revogação ciente do id da sessão, que
 * não existe em `session.ts`; além disso, rotacionar o token junto com a
 * credencial elimina qualquer sessão fixada antes da troca. O efeito prático é
 * o desejado: os outros dispositivos caem, o atual continua conectado.
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  ctx: ActionContext = {},
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      fullName: true,
      email: true,
      phone: true,
      whatsappOptIn: true,
      department: true,
      role: true,
      active: true,
      mustChangePassword: true,
      passwordHash: true,
    },
  });
  if (!user) throw naoEncontrado("Usuário não encontrado.");

  const confere = await verifyPassword(user.passwordHash, currentPassword);
  if (!confere) {
    throw dadosInvalidos("A senha atual não confere.", {
      currentPassword: ["A senha atual não confere."],
    });
  }

  const repetida = await verifyPassword(user.passwordHash, newPassword);
  if (repetida) {
    throw dadosInvalidos("A nova senha deve ser diferente da atual.", {
      newPassword: ["A nova senha deve ser diferente da atual."],
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
    },
  });

  await revokeAllUserSessions(userId);

  const { token, expiresAt } = await createSession({
    userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  await auditSafe({
    actorId: userId,
    action: "usuario.trocar-senha",
    entity: "User",
    entityId: userId,
    summary: "Senha alterada pelo próprio usuário; demais sessões encerradas",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return {
    user: toSessionUser({ ...user, mustChangePassword: false }),
    token,
    expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Administração de usuários (somente supervisão)
// ---------------------------------------------------------------------------

/** Filtros aceitos pela listagem administrativa, já validados. */
export const listUsersQuerySchema = listQuerySchema
  .omit({ from: true, to: true })
  .extend({
    role: z.enum(["PROFESSOR", "SUPERVISOR"]).optional(),
    active: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .optional()
      .transform((v) =>
        v === undefined ? undefined : v === true || v === "true",
      ),
  });

export type ListUsersFilters = {
  search?: string;
  role?: Role;
  active?: boolean;
  page?: number;
  pageSize?: number;
};

export async function listUsers(
  filters: ListUsersFilters,
  actor: SessionUser,
): Promise<{
  items: UserSummary[];
  total: number;
  page: number;
  pageSize: number;
}> {
  assertSupervisor(actor);

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const search = filters.search?.trim();

  const where: Prisma.UserWhereInput = {
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.active !== undefined ? { active: filters.active } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { username: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
            { department: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: summarySelect,
      orderBy: [{ active: "desc" }, { fullName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function adminGetUser(
  id: string,
  actor: SessionUser,
): Promise<UserDetail> {
  assertSupervisor(actor);
  const user = await prisma.user.findUnique({
    where: { id },
    select: detailSelect,
  });
  if (!user) throw naoEncontrado("Usuário não encontrado.");
  return user;
}

/**
 * Cria uma conta pela supervisão.
 *
 * A senha inicial é escolhida por quem cadastra e, portanto, é conhecida por
 * outra pessoa: a conta nasce com `mustChangePassword`, obrigando o docente a
 * definir uma senha que só ele conheça no primeiro acesso.
 */
export async function adminCreateUser(
  input: AdminCreateUserInput,
  actor: SessionUser,
  ctx: ActionContext = {},
): Promise<UserDetail> {
  assertSupervisor(actor);

  const username = normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  await assertIdentificadoresLivres(username, email);

  const passwordHash = await hashPassword(input.password);
  const role: Role = input.role ?? "PROFESSOR";

  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          passwordHash,
          fullName: input.fullName.trim(),
          email,
          phone: input.phone ?? null,
          whatsappOptIn: input.whatsappOptIn ?? false,
          department: input.department ?? null,
          role,
          active: input.active ?? true,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
        },
        select: detailSelect,
      });

      await audit(
        {
          actorId: actor.id,
          action: "usuario.criar",
          entity: "User",
          entityId: created.id,
          summary: `Conta criada para ${created.fullName} (${created.username}) com perfil ${created.role}`,
          after: {
            username: created.username,
            fullName: created.fullName,
            role: created.role,
            active: created.active,
            department: created.department,
          },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return created;
    });
  } catch (error) {
    traduzUnicidade(error);
  }
}

/**
 * Atualiza cadastro, perfil e situação em uma única operação auditada.
 *
 * Quando o patch desativa a conta, as sessões caem junto — deixar o acesso
 * vivo até o cookie expirar tornaria a desativação uma promessa vazia.
 */
export async function adminUpdateUser(
  id: string,
  patch: AdminUpdateUserInput,
  actor: SessionUser,
  ctx: ActionContext = {},
): Promise<UserDetail> {
  assertSupervisor(actor);

  const atual = await prisma.user.findUnique({
    where: { id },
    select: detailSelect,
  });
  if (!atual) throw naoEncontrado("Usuário não encontrado.");

  await assertMudancaDePrivilegioPermitida(
    atual,
    { role: patch.role, active: patch.active },
    actor,
  );

  const email =
    patch.email !== undefined ? normalizeEmail(patch.email) : undefined;
  if (email) await assertIdentificadoresLivres(null, email, id);

  const data: Prisma.UserUpdateInput = {
    ...(patch.fullName !== undefined ? { fullName: patch.fullName.trim() } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    ...(patch.whatsappOptIn !== undefined
      ? { whatsappOptIn: patch.whatsappOptIn }
      : {}),
    ...(patch.department !== undefined ? { department: patch.department } : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
  };
  if (patch.whatsappOptIn === false) data.phone = null;

  let updated: UserDetail;
  try {
    updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { id },
        data,
        select: detailSelect,
      });

      const changes = diffChanges(
        {
          fullName: atual.fullName,
          email: atual.email,
          department: atual.department,
          role: atual.role,
          active: atual.active,
          whatsappOptIn: atual.whatsappOptIn,
        },
        {
          fullName: result.fullName,
          email: result.email,
          department: result.department,
          role: result.role,
          active: result.active,
          whatsappOptIn: result.whatsappOptIn,
        },
      );

      await audit(
        {
          actorId: actor.id,
          action: "usuario.atualizar",
          entity: "User",
          entityId: id,
          summary:
            changes.changedKeys.length > 0
              ? `${result.fullName}: alterado ${changes.changedKeys.join(", ")}`
              : `${result.fullName}: cadastro revisado sem alterações`,
          before: changes.before,
          after: changes.after,
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
        tx,
      );

      return result;
    });
  } catch (error) {
    traduzUnicidade(error);
  }

  // Fora da transação: revogar sessões é um efeito colateral idempotente e não
  // deve prender a transação de escrita mais tempo que o necessário.
  if (patch.active === false && atual.active) {
    await revokeAllUserSessions(id);
  }

  return updated;
}

/**
 * Ativa ou desativa a conta.
 *
 * Preferimos desativação lógica à exclusão: o usuário aparece como dono de
 * reservas, ocorrências e registros de auditoria, e apagá-lo destruiria esse
 * histórico (ou seria recusado pelas chaves estrangeiras `Restrict`).
 */
export async function setUserActive(
  id: string,
  active: boolean,
  actor: SessionUser,
  ctx: ActionContext = {},
): Promise<UserDetail> {
  return adminUpdateUser(id, { active }, actor, ctx);
}

export async function setUserRole(
  id: string,
  role: Role,
  actor: SessionUser,
  ctx: ActionContext = {},
): Promise<UserDetail> {
  return adminUpdateUser(id, { role }, actor, ctx);
}

/**
 * Redefinição de senha pela supervisão.
 *
 * A senha passa a ser conhecida por um terceiro, então a conta é marcada com
 * `mustChangePassword` e todas as sessões são encerradas: se a redefinição
 * aconteceu porque a conta foi comprometida, manter qualquer sessão viva
 * anularia a medida.
 */
export async function adminResetPassword(
  id: string,
  newPassword: string,
  actor: SessionUser,
  ctx: ActionContext = {},
  options: { mustChangePassword?: boolean } = {},
): Promise<UserDetail> {
  assertSupervisor(actor);

  if (id === actor.id) {
    // Redefinir a própria senha por aqui derrubaria a sessão de quem está
    // clicando, sem aviso. O caminho certo já valida a senha atual.
    throw regraDeNegocio(
      "Para trocar a sua própria senha, use a opção “Alterar minha senha” no seu perfil.",
    );
  }

  const alvo = await prisma.user.findUnique({
    where: { id },
    select: { id: true, fullName: true, username: true },
  });
  if (!alvo) throw naoEncontrado("Usuário não encontrado.");

  const passwordHash = await hashPassword(newPassword);
  const mustChangePassword = options.mustChangePassword ?? true;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword,
        passwordChangedAt: new Date(),
      },
      select: detailSelect,
    });

    await audit(
      {
        actorId: actor.id,
        action: "usuario.redefinir-senha",
        entity: "User",
        entityId: id,
        summary: `Senha de ${alvo.fullName} (${alvo.username}) redefinida pela supervisão`,
        // Nada de senha nem de hash aqui: só o efeito administrativo.
        after: { mustChangePassword, sessoesEncerradas: true },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      },
      tx,
    );

    return result;
  });

  await revokeAllUserSessions(id);

  return updated;
}
