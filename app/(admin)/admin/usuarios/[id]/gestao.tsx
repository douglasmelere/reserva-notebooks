"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CheckboxField,
  SelectField,
  TextField,
} from "@/components/ui/field";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api-client";
import { adminUpdateUserSchema } from "@/lib/validation";
import type { Role } from "@/generated/prisma/enums";

/**
 * Ações administrativas sobre uma conta.
 *
 * Cada bloco tem estado próprio (carregando, erro, sucesso) porque são operações
 * independentes: um erro ao redefinir a senha não pode apagar o aviso de que os
 * dados cadastrais foram salvos.
 *
 * As regras de verdade (não desativar a si mesmo, não remover o último
 * supervisor) moram no servidor. Aqui apenas escondemos o que já se sabe
 * proibido e exibimos, sem reescrever, a mensagem que a API devolve.
 */

export type UsuarioGerenciado = {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  role: Role;
  active: boolean;
  whatsappOptIn: boolean;
};

type Estado = {
  enviando: boolean;
  erro: string | null;
  campos: Record<string, string[]>;
  sucesso: string | null;
};

const ESTADO_INICIAL: Estado = {
  enviando: false,
  erro: null,
  campos: {},
  sucesso: null,
};

type RespostaUsuario = { usuario: UsuarioGerenciado; mensagem?: string };

/**
 * Executa uma ação da API mantendo estado de carregamento, erro e sucesso.
 *
 * `aoTerminar` roda no `finally`, e não só no caminho feliz: é o que fecha o
 * diálogo de confirmação. Fechá-lo apenas em caso de sucesso deixaria a
 * mensagem de erro renderizada ATRÁS do modal, invisível e inalcançável — a
 * pessoa veria o botão parar de girar sem nenhuma explicação.
 */
function useAcao() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>(ESTADO_INICIAL);

  async function executar(
    acao: () => Promise<string>,
    aoTerminar?: () => void,
  ) {
    setEstado({ ...ESTADO_INICIAL, enviando: true });
    try {
      const mensagem = await acao();
      setEstado({ enviando: false, erro: null, campos: {}, sucesso: mensagem });
      // Recarrega os Server Components: os selos e o histórico da ficha passam
      // a refletir a alteração sem recarregar a página inteira.
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setEstado({
          enviando: false,
          erro: error.message,
          campos: error.fieldErrors,
          sucesso: null,
        });
      } else {
        setEstado({
          enviando: false,
          erro: "Não foi possível concluir agora. Tente novamente.",
          campos: {},
          sucesso: null,
        });
      }
    } finally {
      aoTerminar?.();
    }
  }

  return { estado, executar, limpar: () => setEstado(ESTADO_INICIAL) };
}

function Feedback({ estado }: { estado: Estado }) {
  if (estado.erro) {
    return (
      <Alert tone="danger" title="Não foi possível concluir">
        {estado.erro}
      </Alert>
    );
  }
  if (estado.sucesso) {
    return <Alert tone="success">{estado.sucesso}</Alert>;
  }
  return null;
}

export function GestaoUsuario({
  usuario,
  ehVoce,
}: {
  usuario: UsuarioGerenciado;
  ehVoce: boolean;
}) {
  return (
    <section
      aria-labelledby="acoes-da-supervisao"
      className="flex flex-col gap-6"
    >
      <h2
        id="acoes-da-supervisao"
        className="text-base font-semibold text-slate-900"
      >
        Ações da supervisão
      </h2>
      <BlocoDados usuario={usuario} />
      <BlocoPerfil usuario={usuario} ehVoce={ehVoce} />
      <BlocoSituacao usuario={usuario} ehVoce={ehVoce} />
      <BlocoSenha usuario={usuario} ehVoce={ehVoce} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Dados cadastrais
// ---------------------------------------------------------------------------

function BlocoDados({ usuario }: { usuario: UsuarioGerenciado }) {
  const { estado, executar } = useAcao();

  const [fullName, setFullName] = useState(usuario.fullName);
  const [email, setEmail] = useState(usuario.email ?? "");
  const [phone, setPhone] = useState(usuario.phone ?? "");
  const [department, setDepartment] = useState(usuario.department ?? "");
  const [whatsappOptIn, setWhatsappOptIn] = useState(usuario.whatsappOptIn);
  const [camposLocais, setCamposLocais] = useState<Record<string, string[]>>({});
  const [resumoLocal, setResumoLocal] = useState<string | null>(null);

  // Depois de salvar, o servidor devolve os valores já normalizados (nome com
  // espaços aparados, e-mail em minúsculas). Ressincronizar evita que a tela
  // mostre algo diferente do que foi realmente gravado.
  useEffect(() => {
    setFullName(usuario.fullName);
    setEmail(usuario.email ?? "");
    setPhone(usuario.phone ?? "");
    setDepartment(usuario.department ?? "");
    setWhatsappOptIn(usuario.whatsappOptIn);
  }, [
    usuario.fullName,
    usuario.email,
    usuario.phone,
    usuario.department,
    usuario.whatsappOptIn,
  ]);

  const campos = { ...camposLocais, ...estado.campos };

  function salvar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCamposLocais({});

    // Campo em branco vira `null`: o esquema valida o formato do e-mail e do
    // telefone antes de qualquer normalização, e "" não é um e-mail válido.
    const analise = adminUpdateUserSchema.safeParse({
      fullName,
      email: email.trim() || null,
      phone: phone.trim() || null,
      department,
      whatsappOptIn,
    });

    if (!analise.success) {
      const porCampo: Record<string, string[]> = {};
      for (const problema of analise.error.issues) {
        const chave = problema.path.join(".") || "_";
        (porCampo[chave] ??= []).push(problema.message);
      }
      setCamposLocais(porCampo);
      // Erro só no campo passa despercebido: quem usa leitor de tela continua
      // com o foco no botão e não recebe aviso nenhum de que nada foi salvo.
      setResumoLocal(
        "Nada foi salvo. Corrija os campos destacados abaixo e envie de novo.",
      );
      return;
    }

    setResumoLocal(null);
    void executar(async () => {
      await api.patch<RespostaUsuario>(
        `/api/admin/users/${usuario.id}`,
        analise.data,
      );
      return "Dados cadastrais atualizados.";
    });
  }

  return (
    <Card>
      <CardHeader
        title="Editar dados"
        description="Nome, contato e departamento. Alterações ficam registradas no histórico abaixo."
      />
      <CardBody>
        <form onSubmit={salvar} noValidate className="flex flex-col gap-4">
          {resumoLocal ? (
            <Alert tone="danger" title="Não foi possível salvar">
              {resumoLocal}
            </Alert>
          ) : (
            <Feedback estado={estado} />
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField
              label="Nome completo"
              required
              autoComplete="name"
              value={fullName}
              error={campos.fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
            <TextField
              label="E-mail"
              type="email"
              autoComplete="email"
              hint="Deixe em branco para remover o e-mail da conta."
              value={email}
              error={campos.email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label="Telefone"
              type="tel"
              autoComplete="tel"
              hint="Com DDD. Ex.: (48) 99999-8888"
              value={phone}
              error={campos.phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <TextField
              label="Departamento ou disciplina"
              value={department}
              error={campos.department}
              onChange={(event) => setDepartment(event.target.value)}
            />
          </div>

          <CheckboxField
            label="A pessoa autoriza contato por WhatsApp"
            hint="Sem essa autorização, o sistema não gera link de mensagem para este número."
            checked={whatsappOptIn}
            error={campos.whatsappOptIn}
            onChange={(event) => setWhatsappOptIn(event.target.checked)}
          />

          <div>
            <Button type="submit" loading={estado.enviando}>
              Salvar dados
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Perfil de acesso
// ---------------------------------------------------------------------------

function BlocoPerfil({
  usuario,
  ehVoce,
}: {
  usuario: UsuarioGerenciado;
  ehVoce: boolean;
}) {
  const { estado, executar } = useAcao();
  const [role, setRole] = useState<string>(usuario.role);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => setRole(usuario.role), [usuario.role]);

  const mudou = role !== usuario.role;
  const promovendo = role === "SUPERVISOR";

  function confirmar() {
    void executar(
      async () => {
        await api.patch<RespostaUsuario>(`/api/admin/users/${usuario.id}`, {
          role,
        });
        return promovendo
          ? `${usuario.fullName} agora tem perfil de supervisão.`
          : `${usuario.fullName} agora tem perfil de professor(a).`;
      },
      () => setConfirmando(false),
    );
  }

  return (
    <Card>
      <CardHeader
        title="Perfil de acesso"
        description="Supervisão administra inventário, reservas de terceiros, ocorrências e contas. Professor só acessa a própria área."
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          <Feedback estado={estado} />

          <SelectField
            label="Perfil desta conta"
            value={role}
            disabled={ehVoce}
            hint={
              ehVoce
                ? "Você não pode alterar o seu próprio perfil de acesso."
                : undefined
            }
            onChange={(event) => setRole(event.target.value)}
            options={[
              { value: "PROFESSOR", label: "Professor(a)" },
              { value: "SUPERVISOR", label: "Supervisão" },
            ]}
          />

          <div>
            <Button
              onClick={() => setConfirmando(true)}
              disabled={ehVoce || !mudou}
              loading={estado.enviando}
            >
              Alterar perfil
            </Button>
          </div>
        </div>

        <ConfirmDialog
          open={confirmando}
          title={
            promovendo
              ? `Promover ${usuario.fullName} a supervisão?`
              : `Rebaixar ${usuario.fullName} a professor(a)?`
          }
          description={
            promovendo
              ? "Essa pessoa passará a ver e alterar o inventário, as reservas de todo mundo, as ocorrências e as contas de usuário — inclusive redefinir senhas."
              : "Essa pessoa perderá o acesso à área de supervisão imediatamente. As reservas e ocorrências dela continuam intactas."
          }
          confirmLabel="Alterar perfil"
          confirmVariant={promovendo ? "primary" : "danger"}
          loading={estado.enviando}
          onConfirm={confirmar}
          onCancel={() => setConfirmando(false)}
        />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Situação da conta
// ---------------------------------------------------------------------------

function BlocoSituacao({
  usuario,
  ehVoce,
}: {
  usuario: UsuarioGerenciado;
  ehVoce: boolean;
}) {
  const { estado, executar } = useAcao();
  const [confirmando, setConfirmando] = useState(false);

  function alterar(ativa: boolean) {
    void executar(
      async () => {
        await api.patch<RespostaUsuario>(`/api/admin/users/${usuario.id}`, {
          active: ativa,
        });
        return ativa
          ? `Conta de ${usuario.fullName} reativada. A pessoa já pode entrar de novo.`
          : `Conta de ${usuario.fullName} desativada e sessões encerradas. Para devolver o acesso, use “Reativar conta” nesta mesma ficha.`;
      },
      () => setConfirmando(false),
    );
  }

  return (
    <Card>
      <CardHeader
        title="Situação da conta"
        description="Contas não são apagadas: a desativação preserva o histórico de reservas, ocorrências e auditoria."
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          <Feedback estado={estado} />

          <p className="text-sm text-slate-700">
            Esta conta está{" "}
            <strong>{usuario.active ? "ativa" : "desativada"}</strong>.{" "}
            {usuario.active
              ? "A pessoa consegue entrar e fazer reservas."
              : "A pessoa não consegue entrar no sistema."}
          </p>

          <div>
            {usuario.active ? (
              <Button
                variant="danger"
                onClick={() => setConfirmando(true)}
                disabled={ehVoce}
                loading={estado.enviando}
              >
                Desativar conta
              </Button>
            ) : (
              <Button
                onClick={() => alterar(true)}
                loading={estado.enviando}
              >
                Reativar conta
              </Button>
            )}
          </div>

          {ehVoce && usuario.active && (
            <p className="text-sm text-slate-600">
              Você não pode desativar a sua própria conta. Peça a outro
              supervisor.
            </p>
          )}
        </div>

        <ConfirmDialog
          open={confirmando}
          title={`Desativar a conta de ${usuario.fullName}?`}
          description={
            <>
              <p>
                A pessoa perde o acesso na hora e{" "}
                <strong>
                  todas as sessões abertas dessa pessoa serão encerradas
                  imediatamente
                </strong>{" "}
                — inclusive no celular e em outros computadores.
              </p>
              <p className="mt-2">
                As reservas já feitas continuam existindo e o histórico é
                preservado. Você pode reativar a conta depois.
              </p>
            </>
          }
          confirmLabel="Desativar conta"
          loading={estado.enviando}
          onConfirm={() => alterar(false)}
          onCancel={() => setConfirmando(false)}
        />
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Redefinição de senha
// ---------------------------------------------------------------------------

function BlocoSenha({
  usuario,
  ehVoce,
}: {
  usuario: UsuarioGerenciado;
  ehVoce: boolean;
}) {
  const { estado, executar } = useAcao();
  const [senha, setSenha] = useState("");
  const [exigirTroca, setExigirTroca] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  function abrirConfirmacao() {
    if (senha.length < 8) {
      setErroLocal("A senha provisória deve ter ao menos 8 caracteres.");
      return;
    }
    setErroLocal(null);
    setConfirmando(true);
  }

  function confirmar() {
    void executar(
      async () => {
        const resposta = await api.post<RespostaUsuario>(
          `/api/admin/users/${usuario.id}/reset-password`,
          { newPassword: senha, mustChangePassword: exigirTroca },
        );
        setSenha("");
        return (
          resposta.mensagem ??
          "Senha redefinida e sessões encerradas. Entregue a senha provisória pessoalmente, sem escrever em bilhete."
        );
      },
      () => setConfirmando(false),
    );
  }

  if (ehVoce) {
    return (
      <Card>
        <CardHeader title="Redefinir senha" />
        <CardBody>
          <p className="text-sm text-slate-700">
            Para trocar a sua própria senha, use a opção “Alterar minha senha” em{" "}
            <strong>Meu perfil</strong>. Por lá o sistema confere a senha atual
            antes de trocar, o que não acontece na redefinição administrativa.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Redefinir senha"
        description="Use quando a pessoa esquecer a senha ou quando houver suspeita de que a conta foi acessada por outra pessoa."
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          <Feedback estado={estado} />

          <TextField
            label="Nova senha provisória"
            type="password"
            autoComplete="new-password"
            hint="Ao menos 8 caracteres. Combine algo simples e entregue pessoalmente — a senha não pode ser consultada depois."
            value={senha}
            error={erroLocal ?? estado.campos.newPassword}
            onChange={(event) => {
              setSenha(event.target.value);
              if (erroLocal) setErroLocal(null);
            }}
          />

          <CheckboxField
            label="Obrigar a trocar a senha no próximo acesso"
            hint="Recomendado: enquanto a senha for conhecida por outra pessoa, ela não é secreta."
            checked={exigirTroca}
            onChange={(event) => setExigirTroca(event.target.checked)}
          />

          <div>
            <Button
              variant="danger"
              onClick={abrirConfirmacao}
              loading={estado.enviando}
            >
              Redefinir senha
            </Button>
          </div>
        </div>

        <ConfirmDialog
          open={confirmando}
          title={`Redefinir a senha de ${usuario.fullName}?`}
          description={
            <>
              <p>
                <strong>
                  Todas as sessões abertas dessa pessoa serão encerradas
                  imediatamente
                </strong>
                : ela será desconectada de todos os aparelhos e só voltará a
                entrar com a senha provisória que você acabou de definir.
              </p>
              <p className="mt-2">
                Entregue essa senha pessoalmente. O sistema não a mostra de novo.
              </p>
            </>
          }
          confirmLabel="Redefinir e encerrar sessões"
          loading={estado.enviando}
          onConfirm={confirmar}
          onCancel={() => setConfirmando(false)}
        />
      </CardBody>
    </Card>
  );
}
