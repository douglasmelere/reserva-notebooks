import { requireSupervisor } from "@/lib/auth";
import { defaultSettings, getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui/primitives";
import { FormularioDeConfiguracoes } from "./form";

export const dynamic = "force-dynamic";

/**
 * Configurações do sistema.
 *
 * Os valores atuais e os padrões de fábrica são lidos no servidor e entregues
 * ao formulário de uma vez: a tela abre preenchida e consegue mostrar, campo a
 * campo, qual era o padrão original — o que dá segurança para experimentar uma
 * regra sabendo como voltar atrás.
 */
export default async function ConfiguracoesPage() {
  await requireSupervisor();
  const configuracoes = await getSettings();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Configurações"
        description="Regras de reserva, carregadores, contato por WhatsApp e dados da operação."
      />

      <FormularioDeConfiguracoes
        configuracoes={configuracoes}
        padroes={defaultSettings}
      />
    </div>
  );
}
