import { expect, test } from "@playwright/test";
import { CONTAS, entrar, resemear } from "./helpers";

/**
 * Nenhuma tela principal pode registrar erro no console do navegador.
 *
 * Erro de console em produção quase sempre significa hidratação quebrada,
 * requisição falhando em silêncio ou prop inválida — coisas que degradam a
 * tela sem produzir um sintoma óbvio para quem está usando.
 */

/** Ruído que não indica defeito da aplicação. */
const IGNORAR = [
  /favicon/i,
  /Download the React DevTools/i,
  /\[vite\]/i,
];

const TELAS_PROFESSOR = [
  "/inicio",
  "/disponibilidade",
  "/reservar",
  "/minhas-reservas",
  "/ocorrencias",
  "/perfil",
];

const TELAS_SUPERVISAO = [
  "/admin",
  "/admin/usuarios",
  "/admin/kits",
  "/admin/notebooks",
  "/admin/carregadores",
  "/admin/reservas",
  "/admin/ocorrencias",
  "/admin/relatorios",
  "/admin/configuracoes",
];

test.beforeAll(async () => {
  await resemear();
});

async function verificarTelas(
  page: import("@playwright/test").Page,
  rotas: string[],
) {
  const problemas: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const texto = msg.text();
    if (deveIgnorar(texto)) return;
    problemas.push(`[console] ${page.url()} :: ${texto}`);
  });

  page.on("pageerror", (erro) => {
    problemas.push(`[exceção] ${page.url()} :: ${erro.message}`);
  });

  for (const rota of rotas) {
    await page.goto(rota);
    await page.waitForLoadState("networkidle");
    // A hidratação do React acontece logo após o carregamento; um respiro
    // curto evita medir a página antes de ela terminar de montar.
    await page.waitForTimeout(600);
  }

  expect(problemas, problemas.join("\n")).toEqual([]);
}

function deveIgnorar(texto: string): boolean {
  return IGNORAR.some((padrao) => padrao.test(texto));
}

test("telas do professor não registram erro no console", async ({ page }) => {
  await entrar(page, CONTAS.silva);
  await verificarTelas(page, TELAS_PROFESSOR);
});

test("telas da supervisão não registram erro no console", async ({ page }) => {
  await entrar(page, CONTAS.supervisor);
  await verificarTelas(page, TELAS_SUPERVISAO);
});
