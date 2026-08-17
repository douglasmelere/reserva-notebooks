import Link from "next/link";
import { Card, CardBody } from "@/components/ui/primitives";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Entrar",
};

/**
 * Tela de entrada.
 *
 * O h1 é escrito aqui (e não com PageHeader) porque nesta moldura o título
 * pertence ao cartão centralizado, junto do formulário.
 */
export default function EntrarPage() {
  return (
    <Card>
      <CardBody className="flex flex-col gap-5 py-5 sm:py-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Entrar
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Use o <strong className="font-semibold">mesmo usuário e a mesma
            senha da intranet</strong> da instituição. Não existe uma senha
            separada para este sistema.
          </p>
        </div>

        <LoginForm />

        <div className="border-t border-slate-200 pt-4">
          <p className="text-sm text-slate-600">
            É a sua primeira vez aqui? Você precisa criar o cadastro uma única
            vez para começar a reservar.
          </p>
          <Link
            href="/cadastro"
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            Criar meu cadastro
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
