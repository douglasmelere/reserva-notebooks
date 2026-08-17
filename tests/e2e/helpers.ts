import type { Page, APIRequestContext } from "@playwright/test";

/**
 * Auxiliares dos testes ponta a ponta.
 *
 * Os seletores usam papel e nome acessível (`getByLabel`, `getByRole`) em vez
 * de classes CSS: se o teste consegue encontrar o elemento pelo mesmo caminho
 * que um leitor de tela usaria, a tela está acessível; e a suíte não quebra a
 * cada ajuste de estilo.
 */

export const SENHA_DEMO = "senha-de-teste-123";

export const CONTAS = {
  supervisor: { usuario: "supervisao", senha: SENHA_DEMO },
  silva: { usuario: "prof.silva", senha: SENHA_DEMO },
  souza: { usuario: "prof.souza", senha: SENHA_DEMO },
  lima: { usuario: "prof.lima", senha: SENHA_DEMO },
  costa: { usuario: "prof.costa", senha: SENHA_DEMO },
} as const;

export async function entrar(
  page: Page,
  conta: { usuario: string; senha: string },
): Promise<void> {
  await page.goto("/entrar");
  await page.getByLabel("Usuário da intranet").fill(conta.usuario);
  await page.getByLabel("Senha", { exact: true }).fill(conta.senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/(inicio|perfil)/, { timeout: 20_000 });
}

export async function sair(page: Page): Promise<void> {
  await page.getByRole("button", { name: /sair/i }).click();
  await page.waitForURL(/\/entrar/, { timeout: 20_000 });
}

/** Data futura em "AAAA-MM-DD", para preencher campos de data. */
export function dataFutura(diasAdiante: number): string {
  const d = new Date(Date.now() + diasAdiante * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Restaura o banco ao estado do seed.
 *
 * Cada arquivo de teste começa de um ponto conhecido; sem isso, uma reserva
 * criada em um cenário faria o seguinte encontrar um conflito inesperado.
 */
export async function resemear(): Promise<void> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)("npm", ["run", "db:seed"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.E2E_DATABASE_URL ??
        "postgresql://reserva:devpass@localhost:55432/reserva_e2e?schema=public",
    },
    timeout: 120_000,
  });
}

/** Faz login pela API e devolve o cookie, para testes que só olham a API. */
export async function loginViaApi(
  request: APIRequestContext,
  conta: { usuario: string; senha: string },
  baseURL: string,
): Promise<void> {
  const resposta = await request.post("/api/auth/login", {
    headers: { origin: baseURL },
    data: { username: conta.usuario, password: conta.senha },
  });
  if (!resposta.ok()) {
    throw new Error(
      `Falha ao autenticar ${conta.usuario}: ${resposta.status()} ${await resposta.text()}`,
    );
  }
}
