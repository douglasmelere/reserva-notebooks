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
import { FormularioDeLote } from "./form";

export const dynamic = "force-dynamic";

const BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

export default async function LoteDeNotebooksPage() {
  const actor = await requireSupervisor();
  const kits = await listKits({ pageSize: 100, includeInactive: true }, actor);

  return (
    <>
      <PageHeader
        title="Cadastrar notebooks em lote"
        description="Gera patrimônios sequenciais a partir de um prefixo — ideal para uma remessa nova de equipamentos."
        action={
          <Link href="/admin/notebooks" className={BOTAO_SECUNDARIO}>
            ← Voltar para a lista
          </Link>
        }
      />

      <Alert tone="info" title="Como funciona">
        <p>
          O sistema junta o prefixo ao número sequencial, completando com zeros
          à esquerda. Confira a prévia antes de gravar: é ela que evita cadastrar
          dezenas de equipamentos com o prefixo errado.
        </p>
        <p className="mt-1">
          É tudo ou nada: se qualquer patrimônio da faixa já existir, nenhum
          equipamento é criado e a tela mostra quais colidiram.
        </p>
      </Alert>

      <Card className="mt-4">
        <CardHeader
          title="Faixa a gerar"
          description="Máximo de 100 equipamentos por lote."
        />
        <CardBody>
          <FormularioDeLote
            kits={kits.items.map((kit) => ({
              id: kit.id,
              code: kit.code,
              name: kit.name,
              status: kit.status,
              capacity: kit.capacity,
              notebookCount: kit.notebookCount,
            }))}
          />
        </CardBody>
      </Card>
    </>
  );
}
