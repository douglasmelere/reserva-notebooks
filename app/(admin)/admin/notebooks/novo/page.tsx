import Link from "next/link";
import { requireSupervisor } from "@/lib/auth";
import { listKits } from "@/server/kits";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
} from "@/components/ui/primitives";
import { NotebookForm } from "../notebook-form";

export const dynamic = "force-dynamic";

const BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

export default async function NovoNotebookPage() {
  const actor = await requireSupervisor();
  // Kits desativados vão junto na lista para ficarem visíveis (e desabilitados)
  // no seletor: some da vaga, não da tela.
  const kits = await listKits({ pageSize: 100, includeInactive: true }, actor);

  return (
    <>
      <PageHeader
        title="Cadastrar notebook"
        description="Um equipamento por vez, com patrimônio, série e kit de destino."
        action={
          <>
            <Link href="/admin/notebooks/lote" className={BOTAO_SECUNDARIO}>
              Cadastrar em lote
            </Link>
            <Link href="/admin/notebooks" className={BOTAO_SECUNDARIO}>
              ← Voltar para a lista
            </Link>
          </>
        }
      />

      <Alert tone="info" title="Vai cadastrar vários de uma vez?">
        O{" "}
        <Link
          href="/admin/notebooks/lote"
          className="font-semibold underline underline-offset-2"
        >
          cadastro em lote
        </Link>{" "}
        gera patrimônios sequenciais a partir de um prefixo e mostra a prévia
        antes de gravar.
      </Alert>

      <Card className="mt-4">
        <CardHeader
          title="Dados do equipamento"
          description="Campos com * são obrigatórios. Patrimônio e número de série não podem se repetir."
        />
        <CardBody>
          <NotebookForm
            kits={kits.items.map((kit) => ({
              id: kit.id,
              code: kit.code,
              name: kit.name,
              status: kit.status,
            }))}
          />
        </CardBody>
      </Card>
    </>
  );
}
