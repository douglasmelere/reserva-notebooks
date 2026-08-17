import Link from "next/link";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
} from "@/components/ui/primitives";
import { KitForm } from "../kit-form";

export const dynamic = "force-dynamic";

const BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

export default function NovoKitPage() {
  return (
    <>
      <PageHeader
        title="Cadastrar kit"
        description="Maletas e carrinhos são o mesmo cadastro: mudam o tipo e o formato físico."
        action={
          <Link href="/admin/kits" className={BOTAO_SECUNDARIO}>
            ← Voltar para a lista
          </Link>
        }
      />

      <Alert tone="info" title="O que acontece depois de cadastrar">
        O kit nasce sem notebooks e sem kit de carregadores. Na tela do kit você
        vincula os equipamentos; os carregadores são cadastrados em{" "}
        <Link
          href="/admin/carregadores"
          className="font-semibold underline underline-offset-2"
        >
          Carregadores
        </Link>
        .
      </Alert>

      <Card className="mt-4">
        <CardHeader
          title="Dados do kit"
          description="Campos com * são obrigatórios."
        />
        <CardBody>
          <KitForm />
        </CardBody>
      </Card>
    </>
  );
}
