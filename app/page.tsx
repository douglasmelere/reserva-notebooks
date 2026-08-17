import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Raiz do site.
 *
 * Não existe página pública de apresentação: quem chega já é da instituição.
 * Quem tem sessão vai para o início; quem não tem, para o login.
 */
export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? "/inicio" : "/entrar");
}
