"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { useDisclosureFocus } from "@/components/ui/use-disclosure-focus";
import { KitForm, type KitParaEdicao } from "../kit-form";

/**
 * Painel de gestão do kit: edição do cadastro, troca rápida de status e
 * desativação.
 *
 * A troca de status é enviada sozinha (só o campo `status`) de propósito: a
 * API roteia esse corpo para `setKitStatus`, e o histórico registra
 * "kit.status" com os rótulos em português em vez de um genérico
 * "Alterado: status" no meio das edições de cadastro.
 */

type KitGerenciavel = KitParaEdicao & {
  statusLabel: string;
  notebookCount: number;
};

const OPCOES_DE_STATUS = [
  { value: "DISPONIVEL", label: "Disponível" },
  { value: "MANUTENCAO", label: "Em manutenção" },
  { value: "INDISPONIVEL", label: "Indisponível" },
];

export function GestaoDoKit({ kit }: { kit: KitGerenciavel }) {
  const router = useRouter();

  // O botão "Editar cadastro" dá lugar ao formulário; o hook garante que o
  // foco do teclado acompanhe essa troca nos dois sentidos.
  const {
    aberto: editando,
    abrir: abrirEdicao,
    fechar: fecharEdicao,
    painelRef: formularioRef,
    gatilhoRef: botaoEditarRef,
  } = useDisclosureFocus();

  const [status, setStatus] = useState<string>(kit.status);
  const [motivo, setMotivo] = useState("");

  const [confirmandoDesativacao, setConfirmandoDesativacao] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const desativado = kit.status === "DESATIVADO";

  async function salvarStatus() {
    setProcessando(true);
    setErro(null);
    setAviso(null);
    try {
      await api.patch(`/api/kits/${kit.id}`, { status });
      const rotulo =
        OPCOES_DE_STATUS.find((opcao) => opcao.value === status)?.label ??
        status;
      // Dizer só "Status atualizado" deixaria no ar a dúvida que mais aparece:
      // se mudar para manutenção derrubou as reservas já marcadas. Não derruba.
      setAviso(
        `Kit agora está como “${rotulo}”. As reservas já marcadas continuam de pé — ` +
          "avise os professores se este kit não puder sair.",
      );
      router.refresh();
    } catch (falha) {
      setErro(
        falha instanceof ApiError
          ? falha.message
          : "Não foi possível alterar o status. Tente novamente.",
      );
    } finally {
      setProcessando(false);
    }
  }

  async function desativar() {
    setProcessando(true);
    setErro(null);
    setAviso(null);
    try {
      const query = motivo.trim()
        ? `?reason=${encodeURIComponent(motivo.trim())}`
        : "";
      const resposta = await api.delete<{ mensagem: string }>(
        `/api/kits/${kit.id}${query}`,
      );
      setConfirmandoDesativacao(false);
      setMotivo("");
      setAviso(resposta.mensagem);
      router.refresh();
    } catch (falha) {
      setConfirmandoDesativacao(false);
      // A recusa mais comum é "há reservas ativas": a mensagem da API já
      // explica quantas são e o que fazer, então ela vai para a tela inteira.
      setErro(
        falha instanceof ApiError
          ? falha.message
          : "Não foi possível desativar o kit. Tente novamente.",
      );
    } finally {
      setProcessando(false);
    }
  }

  async function reativar() {
    setProcessando(true);
    setErro(null);
    setAviso(null);
    try {
      await api.patch(`/api/kits/${kit.id}`, { status: "DISPONIVEL" });
      setStatus("DISPONIVEL");
      setAviso("Kit reativado e disponível para novas reservas.");
      router.refresh();
    } catch (falha) {
      setErro(
        falha instanceof ApiError
          ? falha.message
          : "Não foi possível reativar o kit. Tente novamente.",
      );
    } finally {
      setProcessando(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Gestão do kit"
        description="Editar cadastro, mudar o status operacional e desativar."
        action={
          !editando && (
            <Button
              ref={botaoEditarRef}
              variant="outline"
              aria-expanded={false}
              onClick={abrirEdicao}
            >
              Editar cadastro
            </Button>
          )
        }
      />
      <CardBody className="flex flex-col gap-4">
        {erro && (
          <Alert tone="danger" title="Ação recusada">
            {erro}
          </Alert>
        )}
        {aviso && <Alert tone="success">{aviso}</Alert>}

        {editando ? (
          <div
            ref={formularioRef}
            tabIndex={-1}
            aria-label={`Editar cadastro do kit ${kit.name}`}
            className="focus:outline-none"
          >
            <KitForm
              kit={kit}
              onSaved={fecharEdicao}
              onCancel={fecharEdicao}
            />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-slate-800">
                Status operacional
              </h3>
              {desativado ? (
                <>
                  <p className="text-sm text-slate-600">
                    O kit está desativado. Reative-o para voltar a aparecer na
                    disponibilidade dos professores.
                  </p>
                  <Button
                    variant="primary"
                    loading={processando}
                    onClick={() => void reativar()}
                  >
                    Reativar kit
                  </Button>
                </>
              ) : (
                <>
                  <SelectField
                    label="Situação atual"
                    value={status}
                    options={OPCOES_DE_STATUS}
                    hint="Manutenção e indisponível tiram o kit de novas reservas; as reservas já existentes continuam e precisam ser tratadas caso a caso."
                    onChange={(evento) => setStatus(evento.target.value)}
                  />
                  <Button
                    variant="secondary"
                    loading={processando}
                    disabled={status === kit.status}
                    onClick={() => void salvarStatus()}
                  >
                    Salvar status
                  </Button>
                </>
              )}
            </div>

            {!desativado && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-slate-800">
                  Desativar kit
                </h3>
                <p className="text-sm text-slate-600">
                  A desativação é lógica: o kit some da visão dos professores,
                  mas continua nas reservas antigas, nas ocorrências e no
                  histórico. Kits com reserva ativa não podem ser desativados.
                </p>
                <Button
                  variant="danger"
                  onClick={() => setConfirmandoDesativacao(true)}
                >
                  Desativar kit
                </Button>
              </div>
            )}
          </div>
        )}
      </CardBody>

      <ConfirmDialog
        open={confirmandoDesativacao}
        title={`Desativar "${kit.name}"?`}
        confirmLabel="Desativar kit"
        cancelLabel="Cancelar"
        loading={processando}
        onConfirm={() => void desativar()}
        onCancel={() => setConfirmandoDesativacao(false)}
        description={
          <>
            <p>
              Nada é apagado: o kit recebe o status “Desativado”, sai da
              disponibilidade e o histórico inteiro é preservado. Você pode
              reativá-lo depois.
            </p>
            <p className="mt-2">
              Os {kit.notebookCount} notebook(s) vinculado(s) NÃO são
              desativados junto — cada equipamento mantém o próprio status.
            </p>
            <p className="mt-2">
              Se houver reserva ativa que ainda não terminou, a operação será
              recusada e a mensagem dirá quantas são.
            </p>
          </>
        }
      >
        <TextAreaField
          label="Motivo (opcional)"
          value={motivo}
          rows={2}
          maxLength={300}
          hint="Fica registrado no histórico junto com o seu nome."
          onChange={(evento) => setMotivo(evento.target.value)}
        />
      </ConfirmDialog>
    </Card>
  );
}
