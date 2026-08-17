import { requireUser } from "@/lib/auth";
import { formatDateTimeBR } from "@/lib/datetime";
import { getProfile } from "@/server/users";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
} from "@/components/ui/primitives";
import { PerfilForm } from "./perfil-form";
import { SenhaForm } from "./senha-form";

export const dynamic = "force-dynamic";

/**
 * Perfil do professor.
 *
 * Leitura no servidor, edição em dois formulários independentes: trocar a
 * senha e corrigir o telefone são ações com riscos diferentes e não devem
 * compartilhar um único botão "salvar".
 */

export default async function PerfilPage() {
  const user = await requireUser();
  const perfil = await getProfile(user.id);

  const dadosPessoais = (
    <Card>
      <CardHeader
        title="Dados pessoais"
        description="Como a supervisão e os colegas identificam você no sistema."
      />
      <CardBody>
        <PerfilForm
          inicial={{
            fullName: perfil.fullName,
            email: perfil.email ?? "",
            phone: perfil.phone ?? "",
            department: perfil.department ?? "",
            whatsappOptIn: perfil.whatsappOptIn,
          }}
        />
      </CardBody>
    </Card>
  );

  const senha = (
    <Card>
      <CardHeader
        title="Senha de acesso"
        description="Troque sempre que suspeitar que alguém descobriu a sua senha."
      />
      <CardBody>
        <SenhaForm obrigatoria={perfil.mustChangePassword} />
      </CardBody>
    </Card>
  );

  return (
    <>
      <PageHeader
        title="Meu perfil"
        description="Seus dados de contato e a sua senha de acesso."
      />

      <div className="flex flex-col gap-6">
        {/* Com troca pendente, a senha vem primeiro: é o que impede o uso
            normal do sistema. */}
        {perfil.mustChangePassword ? (
          <>
            {senha}
            {dadosPessoais}
          </>
        ) : (
          <>
            {dadosPessoais}
            {senha}
          </>
        )}

        <Card>
          <CardHeader
            title="Dados da conta"
            description="Definidos pela supervisão — não podem ser alterados por aqui."
          />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Usuário
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {perfil.username}
                </dd>
              </div>

              <div>
                <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Perfil de acesso
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  <Badge
                    tone={perfil.role === "SUPERVISOR" ? "info" : "neutral"}
                  >
                    {perfil.role === "SUPERVISOR"
                      ? "Supervisão"
                      : "Professor(a)"}
                  </Badge>
                </dd>
              </div>

              <div>
                <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Último acesso
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {perfil.lastLoginAt
                    ? formatDateTimeBR(perfil.lastLoginAt)
                    : "Este é o seu primeiro acesso."}
                </dd>
              </div>

              <div>
                <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Senha alterada em
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {perfil.passwordChangedAt
                    ? formatDateTimeBR(perfil.passwordChangedAt)
                    : "Ainda não alterada desde o cadastro."}
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-xs text-slate-600">
              Precisa mudar o seu usuário ou o seu perfil de acesso? Fale com a
              supervisão.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
