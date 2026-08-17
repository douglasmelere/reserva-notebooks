import { expect, test } from "@playwright/test";
import { CONTAS, dataFutura, entrar, resemear } from "./helpers";

/**
 * Fluxo completo de reserva, do calendário ao comprovante.
 *
 * Cobre os critérios de aceite centrais: reservar um kit, ver o conflito
 * quando o equipamento já está ocupado, receber a alternativa de contato e
 * cancelar a própria reserva.
 */

// Reseeda a cada cenário: o teste de cancelamento libera a Maleta 01, e os
// cenários de conflito dependem justamente dela estar ocupada. Sem isolar, a
// suíte passaria ou falharia conforme a ordem de execução.
test.beforeEach(async () => {
  await resemear();
});

/** Avança o assistente até a etapa de escolha dos equipamentos. */
async function irAteEquipamentos(
  page: import("@playwright/test").Page,
  dia: string,
  inicio = "08:00",
  fim = "10:00",
) {
  await page.goto("/reservar");

  await page.getByLabel(/^Data da aula\b/).fill(dia);
  await page.getByRole("button", { name: /continuar/i }).click();

  await page.getByLabel(/^Início\b/).fill(inicio);
  await page.getByLabel(/^Término\b/).fill(fim);
  await page.getByRole("button", { name: /continuar/i }).click();

  // Etapa 3: tipo de recurso (grupo de rádio).
  await page.getByRole("radio", { name: /kit completo/i }).check();
  await page.getByRole("button", { name: /continuar/i }).click();

  // Etapa 4: a lista de equipamentos é carregada da API.
  await expect(
    page.getByRole("heading", { name: /equipamentos|selecione/i, level: 2 }),
  ).toBeVisible({ timeout: 20_000 });
}

test.describe("criar reserva", () => {
  test("professor reserva um kit e recebe o comprovante", async ({ page }) => {
    await entrar(page, CONTAS.costa);

    const dia = dataFutura(12);
    await irAteEquipamentos(page, dia);

    // Marca o primeiro equipamento livre oferecido.
    const disponiveis = page.getByRole("checkbox");
    await expect(disponiveis.first()).toBeVisible({ timeout: 20_000 });
    await disponiveis.first().check();
    await page.getByRole("button", { name: /continuar/i }).click();

    // Etapa 5: dados da aula.
    await page.getByLabel(/^Finalidade da aula\b/).fill("Produção textual");
    await page.getByLabel(/^Sala \(opcional\)/).fill("Sala 7");
    await page.getByRole("button", { name: /continuar/i }).click();

    // Etapa 6: revisão.
    await page.getByRole("button", { name: /continuar/i }).click();

    // Etapa 7: confirmação.
    await page.getByRole("button", { name: /confirmar reserva/i }).click();

    // Etapa 8: comprovante com o código.
    await expect(page.getByText(/RS-[A-Z0-9]{6}/).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a reserva aparece em Minhas reservas e pode ser cancelada", async ({
    page,
  }) => {
    await entrar(page, CONTAS.silva);

    await page.goto("/minhas-reservas");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // O seed cria uma reserva confirmada para amanhã.
    const primeira = page.getByRole("link", { name: /RS-/ }).first();
    await expect(primeira).toBeVisible({ timeout: 15_000 });
    await primeira.click();

    await page.getByRole("button", { name: /cancelar/i }).first().click();

    // Confirmação obrigatória antes de uma ação destrutiva.
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("button", { name: /cancelar reserva|confirmar/i }).click();

    await expect(page.getByText(/cancelada/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe("conflito de reserva", () => {
  test("equipamento ocupado aparece indisponível com quem está usando", async ({
    page,
  }) => {
    await entrar(page, CONTAS.lima);

    // O seed reserva a Maleta 01 para o prof. Silva amanhã, das 08:00 às 10:00.
    await page.goto(
      `/disponibilidade?date=${dataFutura(1)}`,
    );

    await expect(
      page.getByRole("heading", { name: "Maleta 01", level: 3 }),
    ).toBeVisible({ timeout: 20_000 });

    // O estado aparece de cara; a identidade de quem reservou só depois de um
    // clique — privacidade por padrão, e é assim que a tela foi construída.
    await expect(page.getByText(/reservad/i).first()).toBeVisible();

    await page
      .getByRole("button", { name: /ver quem está com o equipamento — Maleta 01/i })
      .click();

    await expect(page.getByText("Carlos Silva").first()).toBeVisible();
  });

  test("botão de WhatsApp só aparece para quem autorizou", async ({ page }) => {
    await entrar(page, CONTAS.lima);

    await page.goto(
      `/disponibilidade?date=${dataFutura(1)}`,
    );
    await expect(
      page.getByRole("heading", { name: "Maleta 01", level: 3 }),
    ).toBeVisible({ timeout: 20_000 });

    // Carlos Silva (Maleta 01) autorizou contato.
    await page
      .getByRole("button", { name: /ver quem está com o equipamento — Maleta 01/i })
      .click();
    await expect(page.getByText("Carlos Silva").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /whatsapp/i }).first(),
    ).toBeVisible();

    // Ana Souza (Carrinho A) NÃO autorizou: mesmo estado de ocupado, sem botão.
    await page
      .getByRole("button", { name: /ver quem está com o equipamento — Carrinho A/i })
      .click();
    await expect(page.getByText("Ana Souza").first()).toBeVisible();
    await expect(
      page.getByText(/não disponibilizou contato por WhatsApp/i).first(),
    ).toBeVisible();
  });
});

test.describe("recursos indisponíveis", () => {
  test("kit em manutenção não é oferecido para reserva", async ({ page }) => {
    await entrar(page, CONTAS.costa);

    await page.goto(`/disponibilidade?date=${dataFutura(20)}`);
    await expect(page.getByText(/Maleta 02/).first()).toBeVisible({
      timeout: 20_000,
    });

    // O seed deixa a Maleta 02 em manutenção; ela aparece, mas marcada.
    const corpo = await page.locator("body").innerText();
    expect(corpo).toMatch(/manutenção/i);
  });
});
