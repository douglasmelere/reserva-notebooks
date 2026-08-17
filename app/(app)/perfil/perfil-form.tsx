"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { updateProfileSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { CheckboxField, TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";

/**
 * Dados pessoais do professor.
 *
 * Valida com o mesmo esquema Zod da rota antes de enviar (resposta imediata) e
 * ainda assim confia no servidor como autoridade — os erros por campo que
 * voltam da API sobrescrevem os locais.
 */

export type PerfilInicial = {
  fullName: string;
  email: string;
  phone: string;
  department: string;
  whatsappOptIn: boolean;
};

export function PerfilForm({ inicial }: { inicial: PerfilInicial }) {
  const router = useRouter();
  const [form, setForm] = useState<PerfilInicial>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string[]>>({});

  const atualizar = <K extends keyof PerfilInicial>(
    campo: K,
    valor: PerfilInicial[K],
  ) => setForm((atual) => ({ ...atual, [campo]: valor }));

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSalvando(true);
    setErroGeral(null);
    setSucesso(null);
    setErros({});

    const analise = updateProfileSchema.safeParse({
      fullName: form.fullName,
      email: form.email,
      phone: form.phone,
      department: form.department,
      whatsappOptIn: form.whatsappOptIn,
    });

    if (!analise.success) {
      const porCampo: Record<string, string[]> = {};
      for (const problema of analise.error.issues) {
        const chave = problema.path.join(".") || "_";
        (porCampo[chave] ??= []).push(problema.message);
      }
      setErros(porCampo);
      setErroGeral("Verifique os campos destacados abaixo.");
      setSalvando(false);
      return;
    }

    try {
      await api.patch("/api/me", analise.data);
      setSucesso("Dados atualizados com sucesso.");
      // Recarrega os Server Components para que o cabeçalho e o resumo da
      // conta passem a mostrar o nome novo.
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setErroGeral(error.message);
        setErros(error.fieldErrors);
      } else {
        setErroGeral("Não foi possível salvar agora. Tente novamente.");
      }
    } finally {
      setSalvando(false);
    }
  }

  const autorizouSemTelefone = form.whatsappOptIn && form.phone.trim() === "";

  return (
    <form onSubmit={enviar} noValidate>
      <div aria-live="polite">
        {erroGeral && (
          <Alert tone="danger" className="mb-4">
            {erroGeral}
          </Alert>
        )}
        {sucesso && (
          <Alert tone="success" className="mb-4">
            {sucesso}
          </Alert>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Nome completo"
          type="text"
          required
          autoComplete="name"
          value={form.fullName}
          error={erros.fullName}
          onChange={(e) => atualizar("fullName", e.target.value)}
          className="sm:col-span-2"
        />

        <TextField
          label="E-mail"
          type="email"
          autoComplete="email"
          value={form.email}
          error={erros.email}
          hint="Usado pela supervisão para falar com você sobre equipamentos."
          onChange={(e) => atualizar("email", e.target.value)}
        />

        <TextField
          label="Telefone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(48) 99999-8888"
          value={form.phone}
          error={erros.phone}
          hint="Com DDD. Deixe em branco para remover o número."
          onChange={(e) => atualizar("phone", e.target.value)}
        />

        <TextField
          label="Departamento ou disciplina"
          type="text"
          value={form.department}
          error={erros.department}
          placeholder="Ex.: Matemática"
          onChange={(e) => atualizar("department", e.target.value)}
          className="sm:col-span-2"
        />
      </div>

      <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50/70 px-4 py-4">
        <CheckboxField
          label="Autorizo o contato por WhatsApp sobre equipamentos reservados por mim"
          checked={form.whatsappOptIn}
          error={erros.whatsappOptIn}
          onChange={(e) => atualizar("whatsappOptIn", e.target.checked)}
          hint={
            <>
              Quando um colega precisar de um equipamento que está reservado no
              seu nome, o sistema mostra a ele um botão que abre uma conversa de
              WhatsApp com você, com a mensagem já escrita. O seu número não
              aparece na tela e não é enviado ao navegador de ninguém: o sistema
              só monta o link da conversa. Cada contato fica registrado (quem
              pediu e quando). Você não é obrigado(a) a responder nem a ceder o
              equipamento, e pode desmarcar esta opção a qualquer momento.
            </>
          }
        />

        {autorizouSemTelefone && (
          <Alert tone="info" className="mt-3">
            Sem telefone cadastrado a autorização não tem efeito — o botão de
            contato continuará indisponível para os colegas.
          </Alert>
        )}
      </div>

      <div className="mt-5">
        <Button type="submit" loading={salvando}>
          Salvar alterações
        </Button>
      </div>
    </form>
  );
}
