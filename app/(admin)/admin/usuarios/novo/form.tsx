"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  SelectField,
  TextField,
} from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api-client";
import { adminCreateUserSchema } from "@/lib/validation";

type RespostaCriacao = {
  usuario: { id: string; fullName: string; username: string };
  mensagem: string;
};

type Sucesso = {
  id: string;
  fullName: string;
  username: string;
  mensagem: string;
};

const VALORES_INICIAIS = {
  fullName: "",
  username: "",
  password: "",
  email: "",
  phone: "",
  department: "",
  role: "PROFESSOR",
  whatsappOptIn: false,
  active: true,
};

/**
 * Formulário de criação de conta.
 *
 * Valida com o mesmo esquema Zod da rota antes de enviar. A validação local não
 * substitui a do servidor — ela só evita uma ida ao servidor para dizer o que já
 * dá para ver na tela.
 */
export function FormNovoUsuario() {
  const router = useRouter();

  const [valores, setValores] = useState(VALORES_INICIAIS);
  const [campos, setCampos] = useState<Record<string, string[]>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState<Sucesso | null>(null);

  function alterar<C extends keyof typeof VALORES_INICIAIS>(
    campo: C,
    valor: (typeof VALORES_INICIAIS)[C],
  ) {
    setValores((atual) => ({ ...atual, [campo]: valor }));
  }

  async function enviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErro(null);
    setCampos({});

    // E-mail e telefone são validados por formato ANTES de virarem `null`: uma
    // string vazia seria recusada como "e-mail inválido". Campo em branco vira
    // `null` aqui, que é o que "não informado" significa no banco.
    const analise = adminCreateUserSchema.safeParse({
      ...valores,
      email: valores.email.trim() || null,
      phone: valores.phone.trim() || null,
    });
    if (!analise.success) {
      const porCampo: Record<string, string[]> = {};
      for (const problema of analise.error.issues) {
        const chave = problema.path.join(".") || "_";
        (porCampo[chave] ??= []).push(problema.message);
      }
      setCampos(porCampo);
      setErro("Verifique os campos destacados.");
      return;
    }

    setEnviando(true);
    try {
      const resposta = await api.post<RespostaCriacao>(
        "/api/admin/users",
        analise.data,
      );
      setSucesso({
        id: resposta.usuario.id,
        fullName: resposta.usuario.fullName,
        username: resposta.usuario.username,
        mensagem: resposta.mensagem,
      });
      setValores(VALORES_INICIAIS);
      // A listagem é um Server Component: sem isto, voltar para /admin/usuarios
      // mostraria a lista anterior, sem a conta recém-criada.
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setErro(error.message);
        setCampos(error.fieldErrors);
      } else {
        setErro("Não foi possível cadastrar agora. Tente novamente.");
      }
    } finally {
      setEnviando(false);
    }
  }

  if (sucesso) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title={`Conta criada para ${sucesso.fullName}`}>
          <p>{sucesso.mensagem}</p>
          <p className="mt-1">
            Usuário de acesso: <strong>{sucesso.username}</strong>. Entregue a
            senha provisória pessoalmente — ela não pode ser consultada depois.
          </p>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/usuarios/${sucesso.id}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-sky-700 px-4 text-sm font-medium text-white hover:bg-sky-800"
          >
            Abrir a ficha de {sucesso.fullName}
          </Link>
          <Button variant="secondary" onClick={() => setSucesso(null)}>
            Cadastrar outra pessoa
          </Button>
          <Link
            href="/admin/usuarios"
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Voltar para a lista
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
      {erro && (
        <Alert tone="danger" title="Não foi possível cadastrar">
          {erro}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <TextField
          label="Nome completo"
          required
          autoComplete="name"
          value={valores.fullName}
          error={campos.fullName}
          onChange={(event) => alterar("fullName", event.target.value)}
        />

        <TextField
          label="Usuário de acesso"
          required
          autoComplete="off"
          hint="Letras, números, ponto, hífen e sublinhado. É o que a pessoa digita para entrar."
          value={valores.username}
          error={campos.username}
          onChange={(event) => alterar("username", event.target.value)}
        />

        <TextField
          label="Senha provisória"
          type="password"
          required
          autoComplete="new-password"
          hint="Ao menos 8 caracteres. Será trocada pelo docente no primeiro acesso."
          value={valores.password}
          error={campos.password}
          onChange={(event) => alterar("password", event.target.value)}
        />

        <TextField
          label="E-mail"
          type="email"
          autoComplete="email"
          hint="Opcional. Usado para identificar a pessoa; não há envio automático."
          value={valores.email}
          error={campos.email}
          onChange={(event) => alterar("email", event.target.value)}
        />

        <TextField
          label="Telefone"
          type="tel"
          autoComplete="tel"
          hint="Opcional, com DDD. Ex.: (48) 99999-8888"
          value={valores.phone}
          error={campos.phone}
          onChange={(event) => alterar("phone", event.target.value)}
        />

        <TextField
          label="Departamento ou disciplina"
          value={valores.department}
          error={campos.department}
          onChange={(event) => alterar("department", event.target.value)}
        />

        <SelectField
          label="Perfil de acesso"
          required
          hint="Supervisão administra inventário, reservas de terceiros e contas."
          value={valores.role}
          error={campos.role}
          onChange={(event) => alterar("role", event.target.value)}
          options={[
            { value: "PROFESSOR", label: "Professor(a)" },
            { value: "SUPERVISOR", label: "Supervisão" },
          ]}
        />
      </div>

      <CheckboxField
        label="A pessoa autoriza contato por WhatsApp"
        hint="Permite que o número seja usado para avisar sobre devolução pendente."
        checked={valores.whatsappOptIn}
        error={campos.whatsappOptIn}
        onChange={(event) => alterar("whatsappOptIn", event.target.checked)}
      />

      <CheckboxField
        label="Conta ativa"
        hint="Desmarque para deixar a conta pronta, mas sem acesso, até a data de início."
        checked={valores.active}
        error={campos.active}
        onChange={(event) => alterar("active", event.target.checked)}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={enviando}>
          Cadastrar usuário
        </Button>
        <Link
          href="/admin/usuarios"
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
