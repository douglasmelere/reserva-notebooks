import Link from "next/link";
import { Card, CardBody } from "@/components/ui/primitives";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Criar cadastro",
};

export default function CadastroPage() {
  return (
    <Card>
      <CardBody className="flex flex-col gap-5 py-5 sm:py-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Criar meu cadastro
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Você faz isso uma única vez. Informe o{" "}
            <strong className="font-semibold">mesmo usuário da intranet</strong>{" "}
            e escolha a{" "}
            <strong className="font-semibold">mesma senha</strong> que já usa
            nela — assim não há duas senhas para lembrar.
          </p>
        </div>

        <RegisterForm />

        <div className="border-t border-slate-200 pt-4">
          <p className="text-sm text-slate-600">Já tem cadastro?</p>
          <Link
            href="/entrar"
            className="mt-2 inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            Entrar com meu usuário
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
