import { expect, test } from "@playwright/test";
import { CONTAS, SENHA_DEMO, entrar, resemear } from "./helpers";

/**
 * Defeitos de interface que já aconteceram uma vez e não podem voltar.
 */

test.beforeAll(async () => {
  await resemear();
});

test.describe("credenciais nunca vão para a URL", () => {
  /**
   * Um `<form>` sem `method` faz GET nativo quando o JavaScript ainda não
   * hidratou — e joga usuário e senha na barra de endereços, no histórico do
   * navegador e no log do proxy reverso. Numa escola com rede lenta, submeter
   * antes da hidratação é rotina, não exceção.
   */
  const FORMULARIOS_COM_SENHA = [
    { rota: "/entrar", publico: true },
    { rota: "/cadastro", publico: true },
    { rota: "/perfil", publico: false },
  ];

  for (const { rota, publico } of FORMULARIOS_COM_SENHA) {
    test(`${rota}: o formulário de senha é POST`, async ({ page }) => {
      if (!publico) await entrar(page, CONTAS.silva);
      await page.goto(rota);

      const metodos = await page
        .locator("form")
        .evaluateAll((forms) =>
          forms
            .filter((f) => f.querySelector('input[type="password"]'))
            .map((f) => f.getAttribute("method")?.toLowerCase() ?? "get"),
        );

      expect(metodos.length, `${rota} deveria ter formulário com senha`)
        .toBeGreaterThan(0);
      expect(metodos.every((m) => m === "post"), `métodos: ${metodos.join(", ")}`)
        .toBe(true);
    });
  }

  test("login bem-sucedido não deixa a senha na URL", async ({ page }) => {
    await entrar(page, CONTAS.silva);
    expect(page.url()).not.toContain(SENHA_DEMO);
    expect(page.url()).not.toContain("password");
  });
});

test.describe("ícones são visíveis", () => {
  /**
   * O ícone do atalho "Fazer reserva" chegou a ficar azul sobre o cartão azul —
   * invisível, e nenhum teste percebia porque o elemento estava lá e o layout
   * não mudava. Comparar a cor do traço com o fundo pega essa classe de erro.
   */
  test("nenhum ícone tem a mesma cor do próprio fundo", async ({ page }) => {
    await entrar(page, CONTAS.silva);

    for (const rota of ["/inicio", "/disponibilidade", "/minhas-reservas"]) {
      await page.goto(rota);
      await page.waitForLoadState("networkidle");

      const invisiveis = await page.evaluate(() => {
        const achados: string[] = [];
        for (const svg of document.querySelectorAll("svg")) {
          const estilo = getComputedStyle(svg);
          if (estilo.display === "none" || estilo.visibility === "hidden") continue;

          const cor = estilo.color;
          // Sobe até achar o primeiro ancestral com fundo realmente pintado.
          let el: HTMLElement | null = svg.parentElement;
          let fundo = "rgba(0, 0, 0, 0)";
          while (el && (fundo === "rgba(0, 0, 0, 0)" || fundo === "transparent")) {
            fundo = getComputedStyle(el).backgroundColor;
            el = el.parentElement;
          }

          if (cor === fundo) {
            const rotulo =
              svg.closest("a,button")?.textContent?.trim().slice(0, 40) ??
              "(sem rótulo)";
            achados.push(`${rotulo} — traço ${cor} sobre fundo ${fundo}`);
          }
        }
        return achados;
      });

      expect(invisiveis, `${rota}:\n${invisiveis.join("\n")}`).toEqual([]);
    }
  });
});

test.describe("a marca aparece", () => {
  test("logo oficial carrega no login e no cabeçalho", async ({ page }) => {
    // `:visible` porque o cabeçalho traz duas marcas — uma só para celular e
    // outra só para desktop — e apenas uma delas está exibida por vez.
    const marcaVisivel = page.locator('img[alt="SENAI"]:visible');

    await page.goto("/entrar");
    await expect(marcaVisivel.first()).toBeVisible();

    // Imagem quebrada renderiza com largura natural 0.
    const carregou = await marcaVisivel
      .first()
      .evaluate((img) => (img as HTMLImageElement).naturalWidth > 0);
    expect(carregou, "a logo não carregou").toBe(true);

    await entrar(page, CONTAS.silva);
    await expect(marcaVisivel.first()).toBeVisible();
  });
});
