/**
 * Cria (ou promove) o primeiro supervisor do sistema.
 *
 *   npm run bootstrap:admin
 *
 * Existe porque o cadastro público só cria professores: sem este script, uma
 * instalação nova não teria ninguém capaz de cadastrar inventário ou promover
 * outras contas. É o único caminho de escalonamento de privilégio fora da
 * aplicação — por isso roda apenas no servidor, com acesso ao banco.
 *
 * Idempotente de propósito: rodar de novo com um usuário existente apenas
 * garante o cargo de supervisor e reativa a conta. A senha de uma conta que já
 * existe NUNCA é sobrescrita aqui — trocar senha alheia é ação auditada da
 * supervisão (ou do próprio dono), não efeito colateral de um script de deploy.
 */

// O Prisma 7 não carrega `.env`; o Node >= 20.6 resolve isso sem dependência.
try {
  process.loadEnvFile(".env");
} catch {
  // Sem arquivo `.env`: as variáveis já devem vir do ambiente (Docker/Coolify).
}

import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { hashPassword } from "@/lib/password";
import { usernameSchema } from "@/lib/validation";

/** Mínimo exigido para a conta mais poderosa do sistema. */
const MIN_PASSWORD_LENGTH = 12;

const AJUDA = `
Cria o primeiro supervisor do sistema de reservas.

Uso:
  npm run bootstrap:admin
  npm run bootstrap:admin -- --usuario coordenacao --nome "Maria Souza"

Opções (equivalem às variáveis de ambiente):
  --usuario,  --username   BOOTSTRAP_ADMIN_USERNAME
  --nome,     --name       BOOTSTRAP_ADMIN_NAME
  --senha,    --password   BOOTSTRAP_ADMIN_PASSWORD
  --ajuda,    --help       mostra esta mensagem

A senha precisa ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.
Prefira a variável de ambiente ou a digitação interativa: senha passada por
argumento fica registrada no histórico do shell e visível em "ps".
`;

type Argumentos = Map<string, string>;

function lerArgumentos(argv: string[]): Argumentos {
  const out: Argumentos = new Map();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg || !arg.startsWith("--")) continue;

    const igual = arg.indexOf("=");
    if (igual > -1) {
      out.set(arg.slice(2, igual), arg.slice(igual + 1));
      continue;
    }

    const proximo = argv[i + 1];
    if (proximo && !proximo.startsWith("--")) {
      out.set(arg.slice(2), proximo);
      i++;
    } else {
      out.set(arg.slice(2), "true");
    }
  }

  return out;
}

function opcao(args: Argumentos, ...nomes: string[]): string | undefined {
  for (const nome of nomes) {
    const valor = args.get(nome);
    if (valor !== undefined && valor !== "") return valor;
  }
  return undefined;
}

/**
 * Lê a senha sem ecoar no terminal.
 *
 * Modo cru em vez de `readline`: o `readline` sempre imprime o que foi digitado,
 * e silenciá-lo depende de sobrescrever um método privado.
 */
function lerSenhaOculta(pergunta: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      reject(
        new Error(
          "Sem terminal interativo. Informe BOOTSTRAP_ADMIN_PASSWORD ou --senha.",
        ),
      );
      return;
    }

    stdout.write(pergunta);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let buffer = "";

    const encerrar = (): void => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", aoReceber);
      stdout.write("\n");
    };

    const aoReceber = (chunk: string): void => {
      for (const caractere of chunk) {
        // Enter / EOF: fim da digitação.
        if (caractere === "\n" || caractere === "\r" || caractere === "") {
          encerrar();
          resolve(buffer);
          return;
        }
        if (caractere === "") {
          encerrar();
          reject(new Error("Operação cancelada."));
          return;
        }
        if (caractere === "" || caractere === "\b") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        buffer += caractere;
      }
    };

    stdin.on("data", aoReceber);
  });
}

function validarSenha(senha: string, username: string): string[] {
  const erros: string[] = [];
  if (senha.length < MIN_PASSWORD_LENGTH) {
    erros.push(`A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (senha.toLowerCase().includes(username.toLowerCase())) {
    erros.push("A senha não pode conter o nome de usuário.");
  }
  if (/^(.)\1+$/.test(senha)) {
    erros.push("A senha não pode ser um único caractere repetido.");
  }
  return erros;
}

function falhar(mensagem: string, dicas: string[] = []): never {
  console.error(`\nERRO: ${mensagem}`);
  for (const dica of dicas) console.error(`  - ${dica}`);
  console.error("");
  process.exitCode = 1;
  throw new Error(mensagem);
}

async function principal(): Promise<void> {
  const args = lerArgumentos(process.argv.slice(2));

  if (args.has("ajuda") || args.has("help")) {
    console.log(AJUDA);
    return;
  }

  // Falha cedo e com mensagem útil se o ambiente estiver incompleto: pior seria
  // pedir a senha ao operador e só então descobrir que falta DATABASE_URL.
  try {
    getEnv();
  } catch (error) {
    falhar(
      error instanceof Error ? error.message : "Ambiente inválido.",
      ["Confira o arquivo .env ou as variáveis configuradas no Coolify."],
    );
  }

  const usernameBruto =
    opcao(args, "usuario", "username") ?? process.env.BOOTSTRAP_ADMIN_USERNAME;
  if (!usernameBruto) {
    falhar("Informe o nome de usuário do supervisor.", [
      "Defina BOOTSTRAP_ADMIN_USERNAME no ambiente, ou",
      'use: npm run bootstrap:admin -- --usuario coordenacao --nome "Maria Souza"',
    ]);
  }

  const username = usernameSchema.safeParse(usernameBruto);
  if (!username.success) {
    falhar(
      "Nome de usuário inválido.",
      username.error.issues.map((i) => i.message),
    );
  }
  const login = username.data;

  const existente = await prisma.user.findUnique({
    where: { username: login },
    select: { id: true, fullName: true, role: true, active: true },
  });

  // --- Conta já existente: só garantimos o cargo -----------------------------
  if (existente) {
    if (existente.role === "SUPERVISOR" && existente.active) {
      console.log(
        `\n"${login}" já é supervisor ativo. Nada a fazer.\n\n` +
          "Se a senha foi perdida, peça a outro supervisor para redefini-la no painel\n" +
          "de usuários. Este script nunca sobrescreve a senha de uma conta existente.\n",
      );
      return;
    }

    const antes = { role: existente.role, active: existente.active };
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existente.id },
        data: { role: "SUPERVISOR", active: true },
      });

      // Sem ator: a ação partiu do console do servidor, não de um usuário
      // autenticado. Registrar isso é justamente o que torna visível qualquer
      // promoção feita por fora da aplicação.
      await audit(
        {
          actorId: null,
          action: "usuario.bootstrap-supervisor",
          entity: "User",
          entityId: existente.id,
          summary: `"${login}" promovido a SUPERVISOR pelo script de bootstrap`,
          before: antes,
          after: { role: "SUPERVISOR", active: true },
          userAgent: "scripts/bootstrap-admin",
        },
        tx,
      );
    });

    console.log(
      `\nConta "${login}" (${existente.fullName}) atualizada:\n` +
        `  perfil:  ${existente.role} -> SUPERVISOR\n` +
        `  situação: ${existente.active ? "ativa" : "desativada"} -> ativa\n\n` +
        "A senha permaneceu a mesma.\n",
    );
    return;
  }

  // --- Conta nova ------------------------------------------------------------
  const fullName =
    opcao(args, "nome", "name") ?? process.env.BOOTSTRAP_ADMIN_NAME;
  if (!fullName || fullName.trim().length < 3) {
    falhar("Informe o nome completo do supervisor.", [
      "Defina BOOTSTRAP_ADMIN_NAME no ambiente, ou use --nome \"Maria Souza\".",
    ]);
  }

  let senha =
    opcao(args, "senha", "password") ?? process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!senha) {
    console.log(
      `\nCriando o supervisor "${login}" (${fullName.trim()}).\n` +
        `A senha não será exibida enquanto você digita (mínimo ${MIN_PASSWORD_LENGTH} caracteres).\n`,
    );
    senha = await lerSenhaOculta("Senha: ");
    const confirmacao = await lerSenhaOculta("Confirme a senha: ");
    if (senha !== confirmacao) {
      falhar("As senhas não conferem. Rode o comando novamente.");
    }
  }

  const problemas = validarSenha(senha, login);
  if (problemas.length > 0) {
    falhar("Senha recusada.", problemas);
  }

  const passwordHash = await hashPassword(senha);

  const criado = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: login,
        passwordHash,
        fullName: fullName.trim(),
        role: "SUPERVISOR",
        active: true,
        // A senha inicial costuma vir de uma variável de ambiente conhecida por
        // quem opera o servidor: o supervisor define a dele no primeiro acesso.
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      },
      select: { id: true, username: true, fullName: true },
    });

    await audit(
      {
        actorId: null,
        action: "usuario.bootstrap-supervisor",
        entity: "User",
        entityId: user.id,
        summary: `Supervisor inicial "${user.username}" criado pelo script de bootstrap`,
        after: { username: user.username, role: "SUPERVISOR", active: true },
        userAgent: "scripts/bootstrap-admin",
      },
      tx,
    );

    return user;
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  console.log(
    `\nSupervisor criado com sucesso.\n\n` +
      `  usuário: ${criado.username}\n` +
      `  nome:    ${criado.fullName}\n` +
      `  acesso:  ${appUrl}/login\n\n` +
      "Próximos passos:\n" +
      "  1. Entre com esse usuário e defina uma senha pessoal (a conta está marcada\n" +
      "     para troca obrigatória de senha no primeiro acesso).\n" +
      "  2. Remova BOOTSTRAP_ADMIN_PASSWORD do ambiente após o primeiro acesso.\n" +
      "  3. Cadastre um segundo supervisor: o sistema impede que o último supervisor\n" +
      "     ativo seja desativado ou rebaixado, e um substituto evita depender deste\n" +
      "     script novamente.\n",
  );
}

principal()
  .catch((error: unknown) => {
    // `falhar` já imprimiu a explicação e ajustou o código de saída.
    if (process.exitCode !== 1) {
      console.error(
        `\nERRO: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
