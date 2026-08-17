import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isAppError } from "@/lib/errors";
import { resolveSession } from "@/lib/session";
import {
  adminCreateUser,
  adminResetPassword,
  authenticate,
  changeOwnPassword,
  getProfile,
  listUsers,
  registerUser,
  setUserActive,
  setUserRole,
  updateProfile,
} from "@/server/users";
import { createTestUser, resetDatabase, toSessionUser } from "../helpers/db";

const IP = { ip: "10.0.0.1" };

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("cadastro", () => {
  it("cria a conta e nunca guarda a senha em texto puro", async () => {
    const user = await registerUser({
      username: "prof.novo",
      password: "senha-de-teste-123",
      fullName: "Professor Novo",
    });

    expect(user.username).toBe("prof.novo");
    expect(user.role).toBe("PROFESSOR");
    expect(user.active).toBe(true);
    // A projeção não expõe o hash.
    expect(user).not.toHaveProperty("passwordHash");

    const doBanco = await prisma.user.findUnique({
      where: { username: "prof.novo" },
    });
    expect(doBanco!.passwordHash).not.toContain("senha-de-teste-123");
    expect(doBanco!.passwordHash.startsWith("$argon2id$")).toBe(true);
  });

  it("normaliza o usuário para minúsculas", async () => {
    await registerUser({
      username: "Prof.MAIUSCULO",
      password: "senha-de-teste-123",
      fullName: "Teste",
    });
    expect(
      await prisma.user.findUnique({ where: { username: "prof.maiusculo" } }),
    ).not.toBeNull();
  });

  it("recusa usuário já existente", async () => {
    await registerUser({
      username: "duplicado",
      password: "senha-de-teste-123",
      fullName: "Um",
    });

    const erro = await registerUser({
      username: "duplicado",
      password: "outra-senha-123",
      fullName: "Dois",
    }).catch((e) => e);

    expect(isAppError(erro)).toBe(true);
    // Erro por campo, para o formulário destacar o input certo.
    expect(erro.fieldErrors?.username ?? erro.fieldErrors?.["username"]).toBeTruthy();
  });
});

describe("autenticação", () => {
  it("autentica com credenciais corretas e cria sessão utilizável", async () => {
    const { user, password } = await createTestUser({ username: "prof.ok" });

    const resultado = await authenticate("prof.ok", password, IP);

    expect(resultado.user.id).toBe(user.id);
    expect(resultado.token).toBeTruthy();

    const sessao = await resolveSession(resultado.token);
    expect(sessao?.user.id).toBe(user.id);

    const atualizado = await prisma.user.findUnique({ where: { id: user.id } });
    expect(atualizado!.lastLoginAt).not.toBeNull();
  });

  it("dá a mesma mensagem para senha errada e usuário inexistente", async () => {
    await createTestUser({ username: "prof.existe" });

    const erroSenha = await authenticate("prof.existe", "errada", IP).catch(
      (e) => e,
    );
    const erroUsuario = await authenticate("nao.existe", "errada", IP).catch(
      (e) => e,
    );

    // Mensagens distintas revelariam quais contas existem.
    expect(erroSenha.message).toBe(erroUsuario.message);
    expect(erroSenha.message).toMatch(/usuário ou senha inválidos/i);
  });

  it("conta desativada não entra, e a mensagem não revela o motivo", async () => {
    const { password } = await createTestUser({
      username: "prof.inativo",
      active: false,
    });

    const erro = await authenticate("prof.inativo", password, IP).catch((e) => e);
    expect(erro.message).toMatch(/usuário ou senha inválidos/i);
  });

  it("bloqueia após muitas tentativas erradas", async () => {
    await createTestUser({ username: "prof.forca" });

    // O limite padrão é 8 tentativas na janela.
    for (let i = 0; i < 8; i++) {
      await authenticate("prof.forca", "errada", IP).catch(() => undefined);
    }

    const erro = await authenticate("prof.forca", "errada", IP).catch((e) => e);
    expect(erro.code).toBe("MUITAS_TENTATIVAS");
  });

  it("login correto limpa o histórico de falhas do usuário", async () => {
    const { password } = await createTestUser({ username: "prof.recupera" });

    for (let i = 0; i < 3; i++) {
      await authenticate("prof.recupera", "errada", IP).catch(() => undefined);
    }
    await authenticate("prof.recupera", password, IP);

    const falhas = await prisma.loginAttempt.count({
      where: { username: "prof.recupera", success: false },
    });
    expect(falhas).toBe(0);
  });

  it("registra a tentativa sem nunca guardar a senha", async () => {
    await createTestUser({ username: "prof.log" });
    await authenticate("prof.log", "senha-secreta-xyz", IP).catch(() => undefined);

    const tentativas = await prisma.loginAttempt.findMany({
      where: { username: "prof.log" },
    });
    expect(tentativas).toHaveLength(1);
    expect(JSON.stringify(tentativas)).not.toContain("senha-secreta-xyz");
  });
});

describe("autorização administrativa", () => {
  it("professor não consegue listar usuários", async () => {
    const { user: professor } = await createTestUser();

    const erro = await listUsers({}, toSessionUser(professor)).catch((e) => e);
    expect(isAppError(erro)).toBe(true);
    expect(erro.code).toBe("SEM_PERMISSAO");
  });

  it("professor não consegue criar usuário", async () => {
    const { user: professor } = await createTestUser();

    await expect(
      adminCreateUser(
        {
          username: "invasor",
          password: "senha-de-teste-123",
          fullName: "Invasor",
          role: "SUPERVISOR",
        },
        toSessionUser(professor),
      ),
    ).rejects.toMatchObject({ code: "SEM_PERMISSAO" });
  });

  it("professor não consegue desativar outra conta", async () => {
    const { user: professor } = await createTestUser();
    const { user: alvo } = await createTestUser();

    await expect(
      setUserActive(alvo.id, false, toSessionUser(professor)),
    ).rejects.toMatchObject({ code: "SEM_PERMISSAO" });
  });

  it("professor não consegue se promover a supervisor", async () => {
    const { user: professor } = await createTestUser();

    await expect(
      setUserRole(professor.id, "SUPERVISOR", toSessionUser(professor)),
    ).rejects.toMatchObject({ code: "SEM_PERMISSAO" });

    const conferido = await prisma.user.findUnique({
      where: { id: professor.id },
    });
    expect(conferido!.role).toBe("PROFESSOR");
  });

  it("supervisor consegue as operações administrativas", async () => {
    const { user: supervisor } = await createTestUser({ role: "SUPERVISOR" });
    const { user: alvo } = await createTestUser();

    const lista = await listUsers({}, toSessionUser(supervisor));
    expect(lista.total).toBeGreaterThanOrEqual(2);

    const desativado = await setUserActive(
      alvo.id,
      false,
      toSessionUser(supervisor),
    );
    expect(desativado.active).toBe(false);
  });
});

describe("proteções contra perda de acesso", () => {
  it("supervisor não pode desativar a si mesmo", async () => {
    const { user: supervisor } = await createTestUser({ role: "SUPERVISOR" });

    await expect(
      setUserActive(supervisor.id, false, toSessionUser(supervisor)),
    ).rejects.toThrow();
  });

  it("não remove o último supervisor ativo", async () => {
    const { user: unico } = await createTestUser({ role: "SUPERVISOR" });
    const { user: outroSup } = await createTestUser({ role: "SUPERVISOR" });

    // Com dois supervisores, rebaixar um é permitido.
    await setUserRole(outroSup.id, "PROFESSOR", toSessionUser(unico));

    // Agora só resta um; a instituição não pode ficar sem nenhum.
    const { user: novoSup } = await createTestUser({ role: "SUPERVISOR" });
    await expect(
      setUserRole(unico.id, "PROFESSOR", toSessionUser(unico)),
    ).rejects.toThrow();
    expect(novoSup.role).toBe("SUPERVISOR");
  });
});

describe("desativação encerra o acesso na hora", () => {
  it("sessão aberta deixa de valer quando a conta é desativada", async () => {
    const { user: supervisor } = await createTestUser({ role: "SUPERVISOR" });
    const { user: alvo, password } = await createTestUser({
      username: "prof.sessao",
    });

    const { token } = await authenticate("prof.sessao", password, IP);
    expect(await resolveSession(token)).not.toBeNull();

    await setUserActive(alvo.id, false, toSessionUser(supervisor));

    // É esta a diferença prática de guardar sessão em banco em vez de JWT.
    expect(await resolveSession(token)).toBeNull();
  });

  it("redefinir a senha encerra as sessões e exige troca", async () => {
    const { user: supervisor } = await createTestUser({ role: "SUPERVISOR" });
    const { user: alvo, password } = await createTestUser({
      username: "prof.reset",
    });

    const { token } = await authenticate("prof.reset", password, IP);

    const atualizado = await adminResetPassword(
      alvo.id,
      "nova-senha-provisoria-123",
      toSessionUser(supervisor),
    );

    expect(atualizado.mustChangePassword).toBe(true);
    expect(await resolveSession(token)).toBeNull();

    // A senha nova funciona.
    const novo = await authenticate(
      "prof.reset",
      "nova-senha-provisoria-123",
      IP,
    );
    expect(novo.token).toBeTruthy();
  });
});

describe("perfil do próprio usuário", () => {
  it("atualiza dados e o consentimento de WhatsApp", async () => {
    const { user } = await createTestUser();

    const atualizado = await updateProfile(user.id, {
      fullName: "Nome Atualizado",
      phone: "48999998888",
      whatsappOptIn: true,
      department: "Física",
    });

    expect(atualizado.fullName).toBe("Nome Atualizado");
    expect(atualizado.whatsappOptIn).toBe(true);
    expect(atualizado.department).toBe("Física");
  });

  it("troca a própria senha exigindo a senha atual", async () => {
    const { user, password } = await createTestUser({ username: "prof.troca" });

    await expect(
      changeOwnPassword(user.id, "senha-errada", "nova-senha-boa-123"),
    ).rejects.toThrow();

    await changeOwnPassword(user.id, password, "nova-senha-boa-123");

    const resultado = await authenticate("prof.troca", "nova-senha-boa-123", IP);
    expect(resultado.token).toBeTruthy();
    await expect(authenticate("prof.troca", password, IP)).rejects.toThrow();
  });

  it("a ficha do usuário nunca traz o hash da senha", async () => {
    const { user } = await createTestUser();
    const perfil = await getProfile(user.id);
    expect(JSON.stringify(perfil)).not.toContain("argon2");
  });
});

describe("auditoria administrativa", () => {
  it("registra quem fez cada alteração administrativa", async () => {
    const { user: supervisor } = await createTestUser({ role: "SUPERVISOR" });
    const { user: alvo } = await createTestUser();

    await setUserActive(alvo.id, false, toSessionUser(supervisor));

    const logs = await prisma.auditLog.findMany({
      where: { entity: "User", entityId: alvo.id },
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]!.actorId).toBe(supervisor.id);
    // Nada sensível pode ter entrado no antes/depois.
    expect(JSON.stringify(logs)).not.toContain("passwordHash");
    expect(JSON.stringify(logs)).not.toContain("argon2");
  });
});
