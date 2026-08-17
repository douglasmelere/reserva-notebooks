import { expect, test } from "@playwright/test";
import { CONTAS, SENHA_DEMO, entrar, resemear, sair } from "./helpers";

/**
 * Autenticação, autorização e responsividade das telas principais.
 *
 * Estes cenários cobrem os critérios de aceite ligados a acesso: o professor
 * entra, o supervisor entra, e o professor não alcança a área administrativa —
 * nem pela interface, nem digitando o endereço.
 */

test.beforeAll(async () => {
  await resemear();
});

test.describe("cadastro e entrada", () => {
  test("professor cria conta e entra no sistema", async ({ page }) => {
    const usuario = `prof.novo${Date.now().toString().slice(-6)}`;

    await page.goto("/cadastro");
    await expect(
      page.getByRole("heading", { name: /criar cadastro/i }),
    ).toBeVisible();

    await page.getByLabel("Nome completo").fill("Professor de Teste");
    await page.getByLabel("Usuário da intranet").fill(usuario);
    await page.getByLabel("Senha", { exact: true }).fill(SENHA_DEMO);
    await page.getByLabel("Confirme a senha").fill(SENHA_DEMO);

    await page.getByRole("button", { name: /criar|cadastrar/i }).click();

    // O cadastro já leva o professor para dentro do sistema.
    await page.waitForURL(/\/inicio/, { timeout: 30_000 });
    await expect(page.getByRole("navigation")).toBeVisible();
  });

  test("entra e sai", async ({ page }) => {
    await entrar(page, CONTAS.silva);
    await expect(page).toHaveURL(/\/inicio/);
    await sair(page);
    await expect(page).toHaveURL(/\/entrar/);
  });

  test("senha errada mostra mensagem genérica e não entra", async ({ page }) => {
    await page.goto("/entrar");
    await page.getByLabel("Usuário da intranet").fill(CONTAS.silva.usuario);
    await page.getByLabel("Senha", { exact: true }).fill("senha-errada");
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page.getByRole("alert")).toContainText(/inválidos/i);
    await expect(page).toHaveURL(/\/entrar/);
  });

  test("usuário inexistente dá a mesma mensagem", async ({ page }) => {
    await page.goto("/entrar");
    await page.getByLabel("Usuário da intranet").fill("nao.existe.mesmo");
    await page.getByLabel("Senha", { exact: true }).fill("qualquer-coisa");
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page.getByRole("alert")).toContainText(/inválidos/i);
  });
});

test.describe("separação entre professor e supervisão", () => {
  test("professor não vê o menu administrativo", async ({ page }) => {
    await entrar(page, CONTAS.silva);

    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: /minhas reservas/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^painel$/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /usuários/i })).toHaveCount(0);
  });

  test("professor digitando /admin é mandado de volta", async ({ page }) => {
    await entrar(page, CONTAS.silva);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/inicio/);

    await page.goto("/admin/usuarios");
    await expect(page).toHaveURL(/\/inicio/);
  });

  test("professor chamando a API administrativa recebe 403", async ({
    page,
    baseURL,
  }) => {
    await entrar(page, CONTAS.silva);

    // Requisição feita com a sessão real do professor, direto na API.
    for (const rota of [
      "/api/admin/dashboard",
      "/api/admin/users",
      "/api/admin/audit-logs",
      "/api/admin/settings",
    ]) {
      const resposta = await page.request.get(`${baseURL}${rota}`);
      expect(resposta.status(), `esperado 403 em ${rota}`).toBe(403);
    }
  });

  test("supervisor vê o menu completo e abre o painel", async ({ page }) => {
    await entrar(page, CONTAS.supervisor);

    const nav = page.getByRole("navigation");
    await expect(nav.getByRole("link", { name: /^painel$/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /usuários/i })).toBeVisible();

    await nav.getByRole("link", { name: /^painel$/i }).click();
    await page.waitForURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("visitante sem sessão é levado ao login", async ({ page }) => {
    await page.goto("/inicio");
    await expect(page).toHaveURL(/\/entrar/);

    await page.goto("/minhas-reservas");
    await expect(page).toHaveURL(/\/entrar/);
  });
});

test.describe("responsividade", () => {
  const TELAS = [
    "/inicio",
    "/disponibilidade",
    "/minhas-reservas",
    "/reservar",
    "/perfil",
  ];

  for (const rota of TELAS) {
    test(`${rota} não rola na horizontal no celular`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await entrar(page, CONTAS.silva);
      await page.goto(rota);
      await page.waitForLoadState("networkidle");

      // Conteúdo mais largo que a janela força rolagem lateral — o defeito de
      // responsividade mais comum e o mais irritante no celular.
      const estouro = await page.evaluate(() => {
        const doc = document.documentElement;
        return doc.scrollWidth - doc.clientWidth;
      });
      expect(estouro, `${rota} estoura ${estouro}px na horizontal`).toBeLessThanOrEqual(1);
    });
  }

  test("menu do celular abre e fecha", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await entrar(page, CONTAS.silva);

    const abrir = page.getByRole("button", { name: /abrir menu/i });
    await expect(abrir).toBeVisible();
    await abrir.click();

    await expect(
      page.getByRole("navigation").getByRole("link", { name: /disponibilidade/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /fechar menu/i }).click();
  });
});
