"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CheckboxField,
  TextAreaField,
  TextField,
} from "@/components/ui/field";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api-client";
import { updateReservationSchema } from "@/lib/validation";
import { ListaDeRecursos, type OpcaoRecurso } from "../nova/form";

/**
 * Gestão da reserva: mudanças de situação e edição dos dados.
 *
 * As transições oferecidas vêm prontas do servidor, que as calcula a partir da
 * mesma tabela de transições usada pela API. Ainda assim, toda recusa da API é
 * exibida como veio: a regra pode mudar (ou a reserva pode ter sido alterada em
 * outra aba) entre a renderização e o clique.
 */

type ConfigAcao = {
  rotulo: string;
  descricao: string;
  variante: ButtonVariant;
  /** Endpoint que executa a mudança. */
  via: "patch" | "close" | "cancel";
  confirmar: string;
  campoTexto: { rotulo: string; hint: string; obrigatorio: boolean } | null;
  /** Devolução e encerramento perguntam se ocorreu tudo bem. */
  perguntaSemProblemas: boolean;
};

const ACOES: Partial<Record<ReservationStatus, ConfigAcao>> = {
  CONFIRMADA: {
    rotulo: "Confirmar reserva",
    descricao:
      "A reserva passa a valer para retirada. O equipamento continua reservado no período.",
    variante: "primary",
    via: "patch",
    confirmar: "Confirmar reserva",
    campoTexto: {
      rotulo: "Motivo da alteração (opcional)",
      hint: "Fica registrado na auditoria.",
      obrigatorio: false,
    },
    perguntaSemProblemas: false,
  },
  RETIRADA: {
    rotulo: "Marcar retirada",
    descricao:
      "Registra que o professor retirou o equipamento agora. A data e a hora da retirada são gravadas automaticamente.",
    variante: "primary",
    via: "patch",
    confirmar: "Registrar retirada",
    campoTexto: {
      rotulo: "Observação da retirada (opcional)",
      hint: "Ex.: retirou sem o mouse, levou carregador extra.",
      obrigatorio: false,
    },
    perguntaSemProblemas: false,
  },
  EM_USO: {
    rotulo: "Marcar em uso",
    descricao: "Indica que a aula começou e o equipamento está em sala.",
    variante: "secondary",
    via: "patch",
    confirmar: "Marcar em uso",
    campoTexto: null,
    perguntaSemProblemas: false,
  },
  DEVOLVIDA: {
    rotulo: "Registrar devolução",
    descricao:
      "Libera o equipamento para outras reservas e registra a devolução com data e hora.",
    variante: "primary",
    via: "close",
    confirmar: "Registrar devolução",
    campoTexto: {
      rotulo: "Observações da devolução (opcional)",
      hint: "Registre aqui o estado do equipamento. Problemas devem virar uma ocorrência.",
      obrigatorio: false,
    },
    perguntaSemProblemas: true,
  },
  ENCERRADA: {
    rotulo: "Encerrar reserva",
    descricao:
      "Fecha a reserva definitivamente. Depois disso ela não muda mais de situação.",
    variante: "danger",
    via: "close",
    confirmar: "Encerrar reserva",
    campoTexto: {
      rotulo: "Observações do encerramento (opcional)",
      hint: "Explique por que a reserva foi encerrada nesta situação.",
      obrigatorio: false,
    },
    perguntaSemProblemas: true,
  },
  NAO_COMPARECEU: {
    rotulo: "Marcar não comparecimento",
    descricao:
      "Registra que ninguém retirou o equipamento. Ele volta a ficar disponível imediatamente.",
    variante: "danger",
    via: "patch",
    confirmar: "Marcar não comparecimento",
    campoTexto: {
      rotulo: "Motivo da alteração",
      hint: "Explique o que foi verificado — este texto vai para a auditoria.",
      obrigatorio: true,
    },
    perguntaSemProblemas: false,
  },
  CANCELADA: {
    rotulo: "Cancelar reserva",
    descricao:
      "Cancela a reserva e libera o equipamento. O registro permanece no histórico do professor.",
    variante: "danger",
    via: "cancel",
    confirmar: "Cancelar reserva",
    campoTexto: {
      rotulo: "Motivo do cancelamento",
      hint: "O professor vê este motivo no detalhe da reserva.",
      obrigatorio: true,
    },
    perguntaSemProblemas: false,
  },
};

export type ValoresDaReserva = {
  date: string;
  diaInteiro: boolean;
  startTime: string;
  endTime: string;
  kitIds: string[];
  notebookIds: string[];
  purpose: string;
  className: string;
  subject: string;
  room: string;
  requestedNotebooks: string;
  teacherNotes: string;
  supervisorNotes: string;
};

/** Compara seleções de recursos sem depender da ordem em que foram marcadas. */
function mesmaSelecao(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const ordenadoA = [...a].sort();
  const ordenadoB = [...b].sort();
  return ordenadoA.every((item, indice) => item === ordenadoB[indice]);
}

export function Gestao({
  reservaId,
  codigo,
  statusAtual,
  statusAtualLabel,
  transicoesPermitidas,
  valoresIniciais,
  kits,
  notebooks,
}: {
  reservaId: string;
  codigo: string;
  statusAtual: ReservationStatus;
  statusAtualLabel: string;
  transicoesPermitidas: ReservationStatus[];
  valoresIniciais: ValoresDaReserva;
  kits: OpcaoRecurso[];
  notebooks: OpcaoRecurso[];
}) {
  const router = useRouter();

  // --- Ações de situação ---------------------------------------------------
  const [acaoAberta, setAcaoAberta] = useState<ReservationStatus | null>(null);
  const [textoDaAcao, setTextoDaAcao] = useState("");
  const [semProblemas, setSemProblemas] = useState(true);
  const [executando, setExecutando] = useState(false);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  const configAberta = acaoAberta ? ACOES[acaoAberta] : undefined;

  function abrirAcao(status: ReservationStatus): void {
    setAcaoAberta(status);
    setTextoDaAcao("");
    setSemProblemas(true);
    setErroDaAcao(null);
    setMensagem(null);
  }

  function fecharAcao(): void {
    setAcaoAberta(null);
    setErroDaAcao(null);
  }

  async function executarAcao(): Promise<void> {
    if (!acaoAberta || !configAberta) return;

    const texto = textoDaAcao.trim();
    if (configAberta.campoTexto?.obrigatorio && texto.length < 3) {
      setErroDaAcao("Descreva o motivo com pelo menos 3 caracteres.");
      return;
    }

    setExecutando(true);
    setErroDaAcao(null);
    try {
      if (configAberta.via === "cancel") {
        await api.post(`/api/reservations/${reservaId}/cancel`, {
          reason: texto || null,
        });
      } else if (configAberta.via === "close") {
        await api.post(`/api/reservations/${reservaId}/close`, {
          allGood: semProblemas,
          notes: texto || null,
          status: acaoAberta,
        });
      } else {
        await api.patch(`/api/reservations/${reservaId}`, {
          status: acaoAberta,
          changeReason: texto || null,
        });
      }

      setAcaoAberta(null);
      setMensagem(`Reserva ${codigo}: ${configAberta.rotulo.toLowerCase()} concluído.`);
      // Recarrega os componentes de servidor: situação, linha do tempo e
      // histórico passam a refletir a mudança sem recarregar a página inteira.
      router.refresh();
    } catch (erro) {
      setErroDaAcao(
        erro instanceof ApiError
          ? erro.message
          : "Não foi possível concluir a ação. Tente novamente.",
      );
    } finally {
      setExecutando(false);
    }
  }

  // --- Edição --------------------------------------------------------------
  const [form, setForm] = useState<ValoresDaReserva>(valoresIniciais);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  const [errosCampos, setErrosCampos] = useState<Record<string, string[]>>({});
  const [sucessoEdicao, setSucessoEdicao] = useState<string | null>(null);

  // Depois de salvar, o servidor devolve os valores novos: o formulário precisa
  // acompanhar, senão o próximo "diff" compararia com dados velhos.
  const assinatura = JSON.stringify(valoresIniciais);
  useEffect(() => {
    setForm(JSON.parse(assinatura) as ValoresDaReserva);
  }, [assinatura]);

  function atualiza<C extends keyof ValoresDaReserva>(
    campo: C,
    valor: ValoresDaReserva[C],
  ): void {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }

  function alternaRecurso(
    campo: "kitIds" | "notebookIds",
    id: string,
    marcado: boolean,
  ): void {
    setForm((atual) => ({
      ...atual,
      [campo]: marcado
        ? [...atual[campo], id]
        : atual[campo].filter((item) => item !== id),
    }));
  }

  async function salvarEdicao(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setErroEdicao(null);
    setErrosCampos({});
    setSucessoEdicao(null);

    // Só o que mudou é enviado: PATCH parcial evita reescrever campos que a
    // supervisão não tocou e mantém o histórico legível.
    const patch: Record<string, unknown> = {};

    const periodoMudou =
      form.date !== valoresIniciais.date ||
      form.diaInteiro !== valoresIniciais.diaInteiro ||
      form.startTime !== valoresIniciais.startTime ||
      form.endTime !== valoresIniciais.endTime;

    if (periodoMudou) {
      patch.date = form.date;
      patch.startTime = form.diaInteiro ? null : form.startTime;
      patch.endTime = form.diaInteiro ? null : form.endTime;
    }

    if (!mesmaSelecao(form.kitIds, valoresIniciais.kitIds)) {
      patch.kitIds = form.kitIds;
    }
    if (!mesmaSelecao(form.notebookIds, valoresIniciais.notebookIds)) {
      patch.notebookIds = form.notebookIds;
    }

    const textos = [
      "purpose",
      "className",
      "subject",
      "room",
      "teacherNotes",
      "supervisorNotes",
    ] as const;
    for (const campo of textos) {
      if (form[campo] !== valoresIniciais[campo]) patch[campo] = form[campo];
    }

    if (form.requestedNotebooks !== valoresIniciais.requestedNotebooks) {
      patch.requestedNotebooks = form.requestedNotebooks
        ? Number(form.requestedNotebooks)
        : null;
    }

    if (Object.keys(patch).length === 0) {
      setErroEdicao("Nenhum campo foi alterado. Ajuste algum dado antes de salvar.");
      return;
    }

    if (motivo.trim().length < 3) {
      setErrosCampos({
        changeReason: ["Explique o motivo da alteração (mínimo de 3 caracteres)."],
      });
      setErroEdicao("Informe o motivo da alteração antes de salvar.");
      return;
    }

    const validado = updateReservationSchema.safeParse({
      ...patch,
      changeReason: motivo,
    });
    if (!validado.success) {
      const porCampo: Record<string, string[]> = {};
      for (const problema of validado.error.issues) {
        const chave = problema.path.join(".") || "_";
        (porCampo[chave] ??= []).push(problema.message);
      }
      setErrosCampos(porCampo);
      setErroEdicao("Verifique os dados destacados abaixo.");
      return;
    }

    setSalvando(true);
    try {
      // Enviamos o recorte original — o esquema acima serve para avisar cedo, e
      // a rota valida de novo. Mandar o resultado do parse incluiria os campos
      // ausentes como `null` e apagaria dados que ninguém pediu para apagar.
      await api.patch(`/api/reservations/${reservaId}`, {
        ...patch,
        changeReason: motivo.trim(),
      });
      setSucessoEdicao("Alterações salvas e registradas na auditoria.");
      setMotivo("");
      router.refresh();
    } catch (erro) {
      if (erro instanceof ApiError) {
        setErroEdicao(erro.message);
        setErrosCampos(erro.fieldErrors);
      } else {
        setErroEdicao("Não foi possível salvar. Tente novamente.");
      }
    } finally {
      setSalvando(false);
    }
  }

  const acoes = transicoesPermitidas.flatMap((status) => {
    const config = ACOES[status];
    return config ? [{ status, config }] : [];
  });

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Ações da supervisão"
          description={`Situação atual: ${statusAtualLabel}. Só aparecem as mudanças que a API aceita a partir daqui.`}
        />
        <CardBody className="flex flex-col gap-3">
          <div aria-live="polite" className="empty:hidden">
            {mensagem && <Alert tone="success">{mensagem}</Alert>}
          </div>

          {acoes.length === 0 ? (
            <p className="text-sm text-slate-600">
              Esta reserva está em <strong>{statusAtualLabel}</strong> e não admite
              mais mudanças de situação. Você ainda pode ajustar os dados e as
              observações abaixo.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {acoes.map(({ status, config }) => (
                <Button
                  key={status}
                  variant={config.variante}
                  onClick={() => abrirAcao(status)}
                  disabled={executando}
                >
                  {config.rotulo}
                </Button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {configAberta && acaoAberta && (
        <ConfirmDialog
          open
          title={configAberta.rotulo}
          description={configAberta.descricao}
          confirmLabel={configAberta.confirmar}
          cancelLabel="Voltar"
          confirmVariant={configAberta.variante === "primary" ? "primary" : "danger"}
          loading={executando}
          onConfirm={() => void executarAcao()}
          onCancel={fecharAcao}
        >
          <div className="flex flex-col gap-3">
            {configAberta.perguntaSemProblemas && (
              <CheckboxField
                label="Ocorreu tudo bem com o equipamento"
                checked={semProblemas}
                onChange={(evento) => setSemProblemas(evento.target.checked)}
                hint="Desmarque se houve problema. Registre a ocorrência em Ocorrências para acionar a manutenção."
              />
            )}

            {configAberta.campoTexto && (
              <TextAreaField
                label={configAberta.campoTexto.rotulo}
                hint={configAberta.campoTexto.hint}
                required={configAberta.campoTexto.obrigatorio}
                value={textoDaAcao}
                maxLength={300}
                onChange={(evento) => setTextoDaAcao(evento.target.value)}
              />
            )}

            {erroDaAcao && <Alert tone="danger">{erroDaAcao}</Alert>}
          </div>
        </ConfirmDialog>
      )}

      <Card>
        <CardHeader
          title="Editar reserva"
          description="Alterar período ou equipamentos verifica novamente a disponibilidade. O motivo informado vai para a auditoria."
        />
        <CardBody>
          <form onSubmit={salvarEdicao} className="flex flex-col gap-5">
            <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
              {sucessoEdicao && <Alert tone="success">{sucessoEdicao}</Alert>}
              {erroEdicao && (
                <Alert tone="danger" title="Não foi possível salvar">
                  {erroEdicao}
                </Alert>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Data"
                type="date"
                value={form.date}
                error={errosCampos.date}
                onChange={(evento) => atualiza("date", evento.target.value)}
              />
              <div className="flex items-end pb-2">
                <CheckboxField
                  label="Dia inteiro"
                  checked={form.diaInteiro}
                  onChange={(evento) => atualiza("diaInteiro", evento.target.checked)}
                  hint="Ocupa o equipamento das 00:00 às 24:00."
                />
              </div>
              {!form.diaInteiro && (
                <>
                  <TextField
                    label="Horário inicial"
                    type="time"
                    value={form.startTime}
                    error={errosCampos.startTime}
                    onChange={(evento) => atualiza("startTime", evento.target.value)}
                  />
                  <TextField
                    label="Horário final"
                    type="time"
                    value={form.endTime}
                    error={errosCampos.endTime}
                    onChange={(evento) => atualiza("endTime", evento.target.value)}
                  />
                </>
              )}
            </div>

            <ListaDeRecursos
              titulo="Maletas e carrinhos"
              vazio="Nenhum kit cadastrado."
              opcoes={kits}
              selecionados={form.kitIds}
              aoAlternar={(id, marcado) => alternaRecurso("kitIds", id, marcado)}
              avisoCarregadores={false}
            />

            <ListaDeRecursos
              titulo="Notebooks"
              vazio="Nenhum notebook cadastrado."
              opcoes={notebooks}
              selecionados={form.notebookIds}
              aoAlternar={(id, marcado) => alternaRecurso("notebookIds", id, marcado)}
              avisoCarregadores={false}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Sala"
                value={form.room}
                error={errosCampos.room}
                onChange={(evento) => atualiza("room", evento.target.value)}
              />
              <TextField
                label="Turma"
                value={form.className}
                error={errosCampos.className}
                onChange={(evento) => atualiza("className", evento.target.value)}
              />
              <TextField
                label="Disciplina"
                value={form.subject}
                error={errosCampos.subject}
                onChange={(evento) => atualiza("subject", evento.target.value)}
              />
              <TextField
                label="Finalidade"
                value={form.purpose}
                error={errosCampos.purpose}
                onChange={(evento) => atualiza("purpose", evento.target.value)}
              />
              <TextField
                label="Notebooks necessários do kit"
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                value={form.requestedNotebooks}
                error={errosCampos.requestedNotebooks}
                onChange={(evento) =>
                  atualiza("requestedNotebooks", evento.target.value)
                }
                hint="Informativo. Deixe em branco se não se aplica."
              />
            </div>

            <TextAreaField
              label="Observações do professor"
              value={form.teacherNotes}
              error={errosCampos.teacherNotes}
              onChange={(evento) => atualiza("teacherNotes", evento.target.value)}
            />

            <TextAreaField
              label="Observações da supervisão"
              value={form.supervisorNotes}
              error={errosCampos.supervisorNotes}
              onChange={(evento) => atualiza("supervisorNotes", evento.target.value)}
              hint="Visível apenas para a supervisão."
            />

            <TextAreaField
              label="Motivo da alteração"
              required
              rows={2}
              maxLength={300}
              value={motivo}
              error={errosCampos.changeReason}
              onChange={(evento) => setMotivo(evento.target.value)}
              hint="Obrigatório: é o que aparece no histórico da reserva para quem consultar depois."
            />

            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={salvando}>
                Salvar alterações
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={salvando}
                onClick={() => {
                  setForm(valoresIniciais);
                  setMotivo("");
                  setErroEdicao(null);
                  setErrosCampos({});
                  setSucessoEdicao(null);
                }}
              >
                Descartar mudanças
              </Button>
            </div>

            <p className="text-xs text-slate-500">
              Reserva {codigo} · situação {statusAtualLabel}
              {statusAtual === "CANCELADA" || statusAtual === "ENCERRADA"
                ? " · reservas encerradas continuam editáveis apenas para correção de registro."
                : ""}
            </p>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
