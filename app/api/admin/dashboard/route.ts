import { requireSupervisor } from "@/lib/auth";
import { handle, json } from "@/lib/http";
import { getDashboard } from "@/server/dashboard";

/** Lê cookie de sessão e o banco a cada requisição: nada pode ser pré-renderizado. */
export const dynamic = "force-dynamic";

/**
 * Painel da supervisão.
 *
 * A interface esconde o menu para quem é professor, mas quem barra de verdade é
 * o `requireSupervisor()` daqui: uma chamada direta à API responde 403.
 */
export const GET = handle(async () => {
  await requireSupervisor();
  return json(await getDashboard());
}, "admin.dashboard");
