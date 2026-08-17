import { Building2, Code2, LifeBuoy, UserRound } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { CREDITOS } from "@/components/brand/creditos";
import { getSettings } from "@/lib/settings";
import {
  Card,
  CardBody,
  CardHeader,
  PageHeader,
} from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sobre o sistema" };

/**
 * Ficha técnica do sistema.
 *
 * Serve a duas pessoas: o professor que quer saber a quem recorrer, e quem
 * herdar a manutenção daqui a alguns anos e precisa descobrir rapidamente o que
 * roda por baixo.
 */
export default async function SobrePage() {
  const settings = await getSettings();

  return (
    <>
      <PageHeader
        title="Sobre o sistema"
        description="Informações de versão, autoria e suporte."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardBody className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Logo tamanho="xl" />
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-slate-900">
                Reserva de Notebooks, Maletas e Carrinhos
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {settings.institutionName} · versão {CREDITOS.versao}
              </p>
            </div>
          </CardBody>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader title="Autoria" />
            <CardBody>
              <dl className="flex flex-col gap-3 text-sm">
                <Linha
                  icone={UserRound}
                  rotulo="Desenvolvido por"
                  valor={CREDITOS.autor}
                />
                <Linha
                  icone={Building2}
                  rotulo="Para"
                  valor={CREDITOS.instituicao}
                />
                <Linha
                  icone={Code2}
                  rotulo="Primeira versão"
                  valor={String(CREDITOS.ano)}
                />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Suporte" />
            <CardBody>
              {CREDITOS.suporte ? (
                <dl className="flex flex-col gap-3 text-sm">
                  <Linha
                    icone={LifeBuoy}
                    rotulo="Canal de atendimento"
                    valor={CREDITOS.suporte}
                  />
                </dl>
              ) : (
                <p className="text-sm text-slate-600">
                  Para problemas de acesso, equipamento danificado ou dúvida
                  sobre uma reserva, procure a supervisão de tecnologia da
                  unidade.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader
            title="Tecnologias"
            description="Para quem for dar manutenção no sistema."
          />
          <CardBody>
            <ul className="grid gap-x-6 gap-y-2 text-sm text-slate-700 sm:grid-cols-2">
              <Item termo="Interface" valor="Vinext (Next.js sobre Vite) e React" />
              <Item termo="Linguagem" valor="TypeScript" />
              <Item termo="Banco de dados" valor="PostgreSQL" />
              <Item termo="Acesso a dados" valor="Prisma ORM" />
              <Item termo="Estilo" valor="Tailwind CSS" />
              <Item termo="Ícones" valor="Lucide" />
              <Item termo="Testes" valor="Vitest e Playwright" />
              <Item termo="Implantação" valor="Docker, gerenciado pelo Coolify" />
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Marca" />
          <CardBody className="text-sm text-slate-600">
            <p>
              A marca SENAI reproduzida aqui é a versão oficial, obtida no
              repositório de marcas do Sistema Indústria e aplicada conforme o
              manual: sem distorção, sem recoloração e com a área de proteção
              preservada.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Linha({
  icone: Icone,
  rotulo,
  valor,
}: {
  icone: typeof UserRound;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <dt className="text-xs text-slate-500">{rotulo}</dt>
        <dd className="font-medium text-slate-900">{valor}</dd>
      </div>
    </div>
  );
}

function Item({ termo, valor }: { termo: string; valor: string }) {
  return (
    <li className="flex flex-wrap justify-between gap-x-3 border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-slate-500">{termo}</span>
      <span className="font-medium">{valor}</span>
    </li>
  );
}
