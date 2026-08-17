"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectField, TextAreaField } from "@/components/ui/field";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
} from "@/components/ui/primitives";

type Opcao = { value: string; label: string };

/** Status em que a ocorrência é considerada encerrada pelo servidor. */
const STATUS_FINAIS = ["RESOLVIDA", "DESCARTADA"];

type Inicial = {
  status: string;
  severity: string;
  assignedToId: string;
  resolution: string;
};

type PatchOcorrencia = {
  status?: string;
  severity?: string;
  assignedToId?: string | null;
  resolution?: string | null;
  blockResource?: boolean;
};

type RespostaAtualizacao = {
  ocorrencia: { id: string; code: string; statusLabel: string };
  recursoBloqueado: boolean;
  recursoLiberado: boolean;
  aviso: string | null;
};

type Confirmacao = "encerrar" | "bloquear" | "liberar" | null;

export function GestaoOcorrencia({
  incidenteId,
  codigo,
  alvoLabel,
  bloqueavel,
  recursoBloqueado,
  inicial,
  statusOpcoes,
  severidadeOpcoes,
  supervisores,
  telaInventario,
}: {
  incidenteId: string;
  codigo: string;
  alvoLabel: string;
  bloqueavel: boolean;
  recursoBloqueado: boolean;
  inicial: Inicial;
  statusOpcoes: Opcao[];
  severidadeOpcoes: Opcao[];
  supervisores: Opcao[];
  telaInventario: { href: string; nome: string } | null;
}) {
  const router = useRouter();

  const [status, setStatus] = useState(inicial.status);
  const [severity, setSeverity] = useState(inicial.severity);
  const [assignedToId, setAssignedToId] = useState(inicial.assignedToId);
  const [resolution, setResolution] = useState(inicial.resolution);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [errosCampo, setErrosCampo] = useState<Record<string, string[]>>({});
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao>(null);

  const vaiEncerrar = STATUS_FINAIS.includes(status);
  const alterado =
    status !== inicial.status ||
    severity !== inicial.severity ||
    assignedToId !== inicial.assignedToId ||
    resolution.trim() !== inicial.resolution.trim();

  function montarPatch(): PatchOcorrencia {
    const patch: PatchOcorrencia = {};
    if (status !== inicial.status) patch.status = status;
    if (severity !== inicial.severity) patch.severity = severity;
    if (assignedToId !== inicial.assignedToId) {
      patch.assignedToId = assignedToId || null;
    }
    if (resolution.trim() !== inicial.resolution.trim()) {
      // String vazia não limpa o campo no servidor; `null` limpa.
      patch.resolution = resolution.trim() || null;
    }
    return patch;
  }

  async function enviar(patch: PatchOcorrencia, mensagemOk: string) {
    setSalvando(true);
    setErro(null);
    setErrosCampo({});
    setSucesso(null);
    setAviso(null);

    try {
      const resposta = await api.patch<RespostaAtualizacao>(
        `/api/incidents/${incidenteId}`,
        patch,
      );
      setSucesso(mensagemOk);
      setAviso(resposta.aviso);
      // Recarrega os Server Components: selo de status, histórico e o aviso de
      // bloqueio do topo da tela vêm todos do servidor.
      router.refresh();
    } catch (falha: unknown) {
      if (falha instanceof ApiError) {
        setErro(falha.message);
        setErrosCampo(falha.fieldErrors);
      } else {
        setErro("Não foi possível salvar. Tente novamente.");
      }
    } finally {
      setSalvando(false);
      setConfirmacao(null);
    }
  }

  function submeter(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErro(null);
    setErrosCampo({});

    // O servidor recusa encerrar sem solução; avisar aqui poupa a viagem e
    // devolve o erro no campo certo.
    if (vaiEncerrar && !resolution.trim()) {
      setErrosCampo({
        resolution: [
          status === "RESOLVIDA"
            ? "Descreva a solução aplicada antes de marcar como resolvida."
            : "Justifique o descarte desta ocorrência.",
        ],
      });
      setErro("Verifique os campos destacados.");
      return;
    }

    const patch = montarPatch();
    if (Object.keys(patch).length === 0) {
      setErro("Nada foi alterado.");
      return;
    }

    // Encerrar é a mudança que tira a ocorrência da fila de trabalho: confirma.
    if (vaiEncerrar && status !== inicial.status) {
      setConfirmacao("encerrar");
      return;
    }

    void enviar(patch, "Alterações salvas.");
  }

  function confirmar() {
    if (confirmacao === "encerrar") {
      void enviar(montarPatch(), "Ocorrência encerrada.");
      return;
    }
    if (confirmacao === "bloquear") {
      void enviar(
        { blockResource: true },
        "Equipamento marcado como indisponível.",
      );
      return;
    }
    if (confirmacao === "liberar") {
      void enviar({ blockResource: false }, "Equipamento liberado para reservas.");
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Painel de gestão"
          description={`Ocorrência ${codigo}`}
        />
        <CardBody className="flex flex-col gap-5">
          {/* `Alert` já carrega role="alert"/"status": a mudança é anunciada
              sem precisar de um aria-live externo envolvendo outro. */}
          <div className="flex flex-col gap-2 empty:hidden">
            {erro && <Alert tone="danger">{erro}</Alert>}
            {sucesso && <Alert tone="success">{sucesso}</Alert>}
            {aviso && <Alert tone="warning">{aviso}</Alert>}
          </div>

          <form onSubmit={submeter} className="flex flex-col gap-4" noValidate>
            <SelectField
              label="Situação"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={statusOpcoes}
              error={errosCampo.status}
            />

            <SelectField
              label="Severidade"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              options={severidadeOpcoes}
              error={errosCampo.severity}
              hint="Reclassifique se a avaliação técnica mostrou algo diferente do relato."
            />

            <SelectField
              label="Responsável pela análise"
              value={assignedToId}
              onChange={(e) => setAssignedToId(e.target.value)}
              options={supervisores}
              placeholder="Sem responsável"
              error={errosCampo.assignedToId}
              hint="Somente contas da supervisão podem ser responsáveis."
            />

            <TextAreaField
              label="Solução aplicada"
              rows={5}
              maxLength={2000}
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              error={errosCampo.resolution}
              placeholder="Ex.: bateria substituída na assistência X em 12/09; equipamento testado por 2 horas sem desligar."
              hint="Obrigatória para resolver ou descartar. Daqui a seis meses este texto é a única memória do que foi feito."
            />

            {/* Botão desabilitado sem explicação vira "o sistema travou". A
                frase diz por que ele está apagado e o que fazer. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button type="submit" loading={salvando} disabled={!alterado}>
                Salvar alterações
              </Button>
              {!alterado && !salvando && (
                <p className="text-xs text-slate-500">
                  Altere um campo acima para habilitar o botão.
                </p>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      {bloqueavel && (
        <Card className="mt-4">
          <CardHeader title="Disponibilidade do equipamento" />
          <CardBody className="flex flex-col gap-3">
            <div>
              <Badge tone={recursoBloqueado ? "danger" : "success"}>
                {recursoBloqueado ? "Bloqueado (em manutenção)" : "Disponível"}
              </Badge>
              <p className="mt-2 text-sm text-slate-700">{alvoLabel}</p>
            </div>

            <Alert tone="info">
              Bloquear tira o equipamento das próximas reservas, mas{" "}
              <strong>não cancela</strong> as reservas já feitas. Encerrar a
              ocorrência também não libera o equipamento sozinho.
            </Alert>

            {recursoBloqueado ? (
              <Button
                variant="outline"
                onClick={() => setConfirmacao("liberar")}
                disabled={salvando}
              >
                Liberar para novas reservas
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={() => setConfirmacao("bloquear")}
                disabled={salvando}
              >
                Bloquear equipamento
              </Button>
            )}

            {telaInventario && (
              <p className="text-xs text-slate-600">
                Também é possível ajustar o status pelo cadastro em{" "}
                <Link
                  href={telaInventario.href}
                  className="font-medium text-sky-800 underline"
                >
                  {telaInventario.nome}
                </Link>
                .
              </p>
            )}
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirmacao !== null}
        loading={salvando}
        title={
          confirmacao === "encerrar"
            ? "Encerrar esta ocorrência?"
            : confirmacao === "bloquear"
              ? "Bloquear o equipamento?"
              : "Liberar o equipamento?"
        }
        confirmLabel={
          confirmacao === "encerrar"
            ? "Encerrar"
            : confirmacao === "bloquear"
              ? "Bloquear"
              : "Liberar"
        }
        confirmVariant={confirmacao === "liberar" ? "primary" : "danger"}
        description={
          confirmacao === "encerrar" ? (
            <>
              A ocorrência sai da fila de trabalho. O equipamento{" "}
              <strong>continua como está</strong>: se estiver bloqueado, siga
              bloqueado até você liberá-lo.
            </>
          ) : confirmacao === "bloquear" ? (
            <>
              {alvoLabel} deixa de aparecer para novas reservas. As reservas já
              existentes <strong>não são canceladas</strong> — avise os docentes
              afetados.
            </>
          ) : (
            <>
              {alvoLabel} volta a ficar disponível para reservas. Confirme apenas
              se o equipamento já foi conferido e está pronto para uso.
            </>
          )
        }
        onConfirm={confirmar}
        onCancel={() => setConfirmacao(null)}
      />
    </>
  );
}
