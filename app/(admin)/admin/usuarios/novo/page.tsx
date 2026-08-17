import Link from "next/link";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { FormNovoUsuario } from "./form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Cadastrar usuário" };

/**
 * Cadastro de conta pela supervisão.
 *
 * A tela é só a moldura: quem valida e envia é o formulário do lado do cliente,
 * usando os mesmos esquemas Zod que a rota aplica ao receber.
 */
export default function NovoUsuarioPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cadastrar usuário"
        description="A conta nasce com senha provisória: no primeiro acesso o docente é obrigado a definir uma senha que só ele conheça."
        action={
          <Link
            href="/admin/usuarios"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Voltar para usuários
          </Link>
        }
      />

      <Card>
        <CardHeader
          title="Dados da conta"
          description="Campos marcados com asterisco são obrigatórios."
        />
        <CardBody>
          <FormNovoUsuario />
        </CardBody>
      </Card>
    </div>
  );
}
