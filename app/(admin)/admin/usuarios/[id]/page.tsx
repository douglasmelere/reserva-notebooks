import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  type BadgeTone,
} from "@/components/ui/primitives";
import { entityHistory } from "@/lib/audit";
import { requireSupervisor } from "@/lib/auth";
import { formatDateTimeBR } from "@/lib/datetime";
import { isAppError } from "@/lib/errors";
import { adminGetUser, type UserDetail } from "@/server/users";
import type { Role } from "@/generated/prisma/enums";
import { GestaoUsuario } from "./gestao";

export const dynamic = "force-dynamic";

// Sem isto, a aba do navegador ficava só com "Reserva de Notebooks" — as demais
// telas de usuários já se identificam, e quem abre várias fichas em abas
// paralelas não conseguia distinguir uma da outra.
export const metadata = { title: "Ficha do usuário" };

const ROTULO_PERFIL: Record<Role, string> = {
  PROFESSOR: "Professor(a)",
  SUPERVISOR: "Supervisão",
};

const TOM_PERFIL: Record<Role, BadgeTone> = {
  PROFESSOR: "neutral",
  SUPERVISOR: "info",
};

/** Ações registradas na auditoria desta entidade, em linguagem de gente. */
const ROTULO_ACAO: Record<string, string> = {
  "usuario.cadastrar": "Cadastro feito pela própria pessoa",
  "usuario.criar": "Conta criada pela supervisão",
  "usuario.atualizar": "Cadastro alterado pela supervisão",
  "usuario.atualizar-perfil": "Dados alterados pela própria pessoa",
  "usuario.trocar-senha": "Senha trocada pela própria pessoa",
  "usuario.redefinir-senha": "Senha redefinida pela supervisão",
};

/** Nomes técnicos gravados na auditoria traduzidos para a tela. */
const ROTULO_CAMPO: Record<string, string> = {
  fullName: "Nome",
  username: "Usuário",
  email: "E-mail",
  phone: "Telefone",
  department: "Departamento",
  role: "Perfil de acesso",
  active: "Situação da conta",
  whatsappOptIn: "Contato por WhatsApp",
  mustChangePassword: "Troca de senha obrigatória",
  telefoneCadastrado: "Telefone cadastrado",
  sessoesEncerradas: "Sessões encerradas",
};

export default async function UsuarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireSupervisor();
  const { id } = await params;

  let usuario: UserDetail;
  try {
    usuario = await adminGetUser(id, actor);
  } catch (error) {
    // Endereço antigo ou conta removida do banco: 404 é mais honesto do que a
    // tela genérica de erro.
    if (isAppError(error) && error.code === "NAO_ENCONTRADO") notFound();
    throw error;
  }

  // Leitura direta do serviço de auditoria: em Server Component não faz sentido
  // atravessar a própria API por HTTP só para ler o histórico.
  const historico = await entityHistory("User", id, 100);
  const ehVoce = usuario.id === actor.id;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={usuario.fullName}
        description={`Usuário ${usuario.username}${usuario.department ? ` · ${usuario.department}` : ""}`}
        action={
          <Link
            href="/admin/usuarios"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Voltar para usuários
          </Link>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone={TOM_PERFIL[usuario.role]}>
          {ROTULO_PERFIL[usuario.role]}
        </Badge>
        <Badge tone={usuario.active ? "success" : "muted"}>
          {usuario.active ? "Conta ativa" : "Conta desativada"}
        </Badge>
        {usuario.mustChangePassword && (
          <Badge tone="warning">Precisa trocar a senha no próximo acesso</Badge>
        )}
        {usuario.whatsappOptIn && <Badge tone="info">Autoriza WhatsApp</Badge>}
      </div>

      {ehVoce && (
        <Alert tone="info" title="Esta é a sua própria conta">
          Por segurança, você não pode desativar a si mesmo, mudar o seu próprio
          perfil de acesso nem redefinir a sua senha por aqui. Peça a outro
          supervisor, ou troque a sua senha em “Meu perfil”.
        </Alert>
      )}

      <Card>
        <CardHeader title="Dados cadastrais" />
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Dado rotulo="Nome completo" valor={usuario.fullName} />
            <Dado rotulo="Usuário de acesso" valor={usuario.username} />
            <Dado rotulo="E-mail" valor={usuario.email} />
            <Dado rotulo="Telefone" valor={usuario.phone} />
            <Dado
              rotulo="Departamento ou disciplina"
              valor={usuario.department}
            />
            <Dado
              rotulo="Contato por WhatsApp"
              valor={usuario.whatsappOptIn ? "Autorizado" : "Não autorizado"}
            />
            <Dado
              rotulo="Conta criada em"
              valor={formatDateTimeBR(usuario.createdAt)}
            />
            <Dado
              rotulo="Último acesso"
              valor={
                usuario.lastLoginAt
                  ? formatDateTimeBR(usuario.lastLoginAt)
                  : "Nunca entrou no sistema"
              }
            />
            <Dado
              rotulo="Senha alterada em"
              valor={
                usuario.passwordChangedAt
                  ? formatDateTimeBR(usuario.passwordChangedAt)
                  : "Sem registro"
              }
            />
          </dl>
        </CardBody>
      </Card>

      <GestaoUsuario
        usuario={{
          id: usuario.id,
          username: usuario.username,
          fullName: usuario.fullName,
          email: usuario.email,
          phone: usuario.phone,
          department: usuario.department,
          role: usuario.role,
          active: usuario.active,
          whatsappOptIn: usuario.whatsappOptIn,
        }}
        ehVoce={ehVoce}
      />

      <Card>
        <CardHeader
          title="Histórico de alterações"
          description="Vem da trilha de auditoria. Logins do dia a dia não entram aqui, só mudanças administrativas."
        />
        <CardBody>
          {historico.length === 0 ? (
            <EmptyState
              title="Nenhuma alteração registrada"
              description="Assim que o cadastro, o perfil, a situação ou a senha desta conta forem alterados, o registro aparece aqui com autor e data."
            />
          ) : (
            <ol className="flex flex-col gap-4">
              {historico.map((evento) => {
                const antes = paresDeMudanca(evento.before);
                const depois = paresDeMudanca(evento.after);
                return (
                  <li
                    key={evento.id}
                    className="border-l-2 border-slate-200 pl-4"
                  >
                    <p className="text-sm font-medium text-slate-900">
                      {ROTULO_ACAO[evento.action] ?? evento.action}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTimeBR(evento.createdAt)} ·{" "}
                      {evento.actor
                        ? `${evento.actor.fullName} (${evento.actor.username})`
                        : "Autor removido do sistema"}
                    </p>
                    {evento.summary && (
                      <p className="mt-1 text-sm text-slate-700">
                        {evento.summary}
                      </p>
                    )}
                    {depois.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-0.5 text-sm text-slate-700">
                        {depois.map(([chave, valorDepois]) => {
                          const valorAntes = antes.find(
                            ([outra]) => outra === chave,
                          )?.[1];
                          return (
                            <li key={chave}>
                              <span className="text-slate-500">
                                {ROTULO_CAMPO[chave] ?? chave}:
                              </span>{" "}
                              {valorAntes !== undefined && (
                                <>
                                  <span className="line-through">
                                    {formatarValor(chave, valorAntes)}
                                  </span>{" "}
                                  <span aria-hidden="true">→</span>{" "}
                                  <span className="sr-only">passou para</span>
                                </>
                              )}
                              <strong>{formatarValor(chave, valorDepois)}</strong>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Dado({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {rotulo}
      </dt>
      <dd className="mt-0.5 text-sm break-words text-slate-900">
        {valor && valor.trim() ? valor : "Não informado"}
      </dd>
    </div>
  );
}

/** O `before`/`after` da auditoria é JSON livre; só objetos simples interessam. */
function paresDeMudanca(valor: unknown): [string, unknown][] {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
    return [];
  }
  return Object.entries(valor as Record<string, unknown>);
}

/** O JSON da auditoria serializa `Date` como ISO 8601 — nunca em formato local. */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function formatarValor(chave: string, valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "vazio";
  if (typeof valor === "boolean") {
    // "true" não diz nada em uma linha de histórico; o campo diz o que o
    // booleano significa.
    if (chave === "active") return valor ? "ativa" : "desativada";
    return valor ? "sim" : "não";
  }
  if (valor === "SUPERVISOR") return "Supervisão";
  if (valor === "PROFESSOR") return "Professor(a)";
  if (typeof valor === "string") {
    // "2026-08-17T14:30:00.000Z" no meio do histórico não é lido por ninguém.
    if (ISO_8601.test(valor)) {
      const data = new Date(valor);
      if (!Number.isNaN(data.getTime())) return formatDateTimeBR(data);
    }
    return valor;
  }
  if (typeof valor === "number") return String(valor);
  return JSON.stringify(valor);
}
