"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { changePasswordSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TextField } from "@/components/ui/field";
import { Alert } from "@/components/ui/primitives";

/**
 * Troca da própria senha.
 *
 * A repetição da nova senha é conferida aqui e não vai para a API: ela existe
 * só para evitar erro de digitação em um campo que o usuário não consegue ler.
 */

type RespostaSenha = { mensagem: string };

export function SenhaForm({ obrigatoria }: { obrigatoria: boolean }) {
  const router = useRouter();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");

  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string[]>>({});

  /** Valida antes de perguntar: não faz sentido confirmar um formulário torto. */
  function revisar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErroGeral(null);
    setSucesso(null);
    setErros({});

    const analise = changePasswordSchema.safeParse({
      currentPassword: atual,
      newPassword: nova,
    });

    const porCampo: Record<string, string[]> = {};
    if (!analise.success) {
      for (const problema of analise.error.issues) {
        const chave = problema.path.join(".") || "_";
        (porCampo[chave] ??= []).push(problema.message);
      }
    }
    if (nova !== confirmacao) {
      (porCampo.confirmacao ??= []).push(
        "A confirmação não confere com a nova senha.",
      );
    }

    if (Object.keys(porCampo).length > 0) {
      setErros(porCampo);
      setErroGeral("Verifique os campos destacados abaixo.");
      return;
    }

    setConfirmando(true);
  }

  async function trocar() {
    setSalvando(true);
    setErroGeral(null);

    try {
      const resposta = await api.post<RespostaSenha>("/api/me/password", {
        currentPassword: atual,
        newPassword: nova,
      });
      setAtual("");
      setNova("");
      setConfirmacao("");
      setSucesso(resposta.mensagem);
      setConfirmando(false);
      // O aviso de "senha precisa ser trocada" some depois do refresh.
      router.refresh();
    } catch (error) {
      setConfirmando(false);
      if (error instanceof ApiError) {
        setErroGeral(error.message);
        setErros(error.fieldErrors);
      } else {
        setErroGeral("Não foi possível trocar a senha agora. Tente novamente.");
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={revisar} noValidate>
      {obrigatoria && (
        <Alert tone="warning" title="Troca de senha pendente" className="mb-4">
          Sua senha foi definida ou redefinida pela supervisão. Escolha uma
          senha que só você conheça antes de continuar usando o sistema.
        </Alert>
      )}

      {/* Sem `aria-live` aqui: o próprio `Alert` já é uma região viva
          (`role="alert"`/`role="status"`), e aninhar as duas faz o leitor de
          tela ler a mensagem duas vezes. */}
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

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Senha atual"
          type="password"
          required
          autoComplete="current-password"
          value={atual}
          error={erros.currentPassword}
          onChange={(e) => setAtual(e.target.value)}
          className="sm:col-span-2"
        />

        <TextField
          label="Nova senha"
          type="password"
          required
          autoComplete="new-password"
          value={nova}
          error={erros.newPassword}
          hint="Ao menos 8 caracteres."
          onChange={(e) => setNova(e.target.value)}
        />

        <TextField
          label="Repita a nova senha"
          type="password"
          required
          autoComplete="new-password"
          value={confirmacao}
          error={erros.confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
        />
      </div>

      <p className="mt-3 text-xs text-slate-600">
        Ao trocar a senha, as sessões abertas em outros aparelhos são
        encerradas. Você continua conectado(a) aqui.
      </p>

      <div className="mt-4">
        <Button type="submit" loading={salvando}>
          Trocar senha
        </Button>
      </div>

      {/* Encerrar as sessões dos outros aparelhos não tem volta: quem estiver
          com o sistema aberto no computador da sala terá de entrar de novo. */}
      <ConfirmDialog
        open={confirmando}
        title="Confirmar troca de senha"
        description="A sua senha será substituída e as sessões abertas em outros aparelhos (computador da sala, celular) serão encerradas. Nesta tela você continua conectado(a)."
        confirmLabel="Trocar senha"
        confirmVariant="primary"
        loading={salvando}
        onConfirm={trocar}
        onCancel={() => setConfirmando(false)}
      />
    </form>
  );
}
