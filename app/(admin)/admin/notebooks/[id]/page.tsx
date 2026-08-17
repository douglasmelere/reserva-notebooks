import Link from "next/link";
import { notFound } from "next/navigation";
import { entityHistory } from "@/lib/audit";
import { requireSupervisor } from "@/lib/auth";
import { formatDateTimeBR } from "@/lib/datetime";
import { isAppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/session";
import { listKits } from "@/server/kits";
import { getNotebook, type NotebookDetail } from "@/server/notebooks";
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
import type {
  NotebookStatus,
  ReservationStatus,
} from "@/generated/prisma/enums";
import { PainelDoNotebook } from "../notebook-form";

export const dynamic = "force-dynamic";

const TOM_DO_STATUS: Record<NotebookStatus, BadgeTone> = {
  DISPONIVEL: "success",
  RESERVADO: "info",
  EM_USO: "info",
  MANUTENCAO: "warning",
  PERDIDO: "danger",
  INDISPONIVEL: "danger",
  DESATIVADO: "muted",
};

const TOM_DA_RESERVA: Record<ReservationStatus, BadgeTone> = {
  SOLICITADA: "warning",
  CONFIRMADA: "info",
  RETIRADA: "info",
  EM_USO: "info",
  DEVOLVIDA: "success",
  ENCERRADA: "success",
  CANCELADA: "danger",
  NAO_COMPARECEU: "danger",
};

/** Rótulos das ocorrências. A API devolve o enum cru; a tela nunca o exibe. */
const CATEGORIA_LABEL: Record<string, string> = {
  HARDWARE: "Hardware",
  CARREGADOR: "Carregador",
  BATERIA: "Bateria",
  TELA: "Tela",
  TECLADO: "Teclado",
  TOUCHPAD: "Touchpad",
  REDE: "Rede",
  SISTEMA: "Sistema",
  SOFTWARE: "Software",
  DANO_FISICO: "Dano físico",
  LIMPEZA: "Limpeza",
  ACESSORIO_AUSENTE: "Acessório ausente",
  DEVOLUCAO_INCOMPLETA: "Devolução incompleta",
  NOTEBOOK_FALTANTE: "Notebook faltante",
  CARREGADOR_FALTANTE: "Carregador faltante",
  OUTRO: "Outro",
};

const SEVERIDADE_LABEL: Record<string, string> = {
  BAIXA: "Baixa",
  MEDIA: "Média",
  ALTA: "Alta",
  CRITICA: "Crítica",
};

const TOM_DA_SEVERIDADE: Record<string, BadgeTone> = {
  BAIXA: "neutral",
  MEDIA: "warning",
  ALTA: "warning",
  CRITICA: "danger",
};

const OCORRENCIA_STATUS_LABEL: Record<string, string> = {
  ABERTA: "Aberta",
  EM_ANALISE: "Em análise",
  EM_MANUTENCAO: "Em manutenção",
  RESOLVIDA: "Resolvida",
  DESCARTADA: "Descartada",
  RECORRENTE: "Recorrente",
};

const TOM_DA_OCORRENCIA: Record<string, BadgeTone> = {
  ABERTA: "warning",
  EM_ANALISE: "warning",
  EM_MANUTENCAO: "warning",
  RESOLVIDA: "success",
  DESCARTADA: "muted",
  RECORRENTE: "danger",
};

/**
 * A trilha de auditoria guarda a ação como chave técnica
 * ("notebook.transferir"). Quem lê a tela é a supervisão, então a chave nunca
 * aparece crua.
 */
const ACAO_LABEL: Record<string, string> = {
  "notebook.criar": "Equipamento cadastrado",
  "notebook.atualizar": "Cadastro editado",
  "notebook.status": "Status alterado",
  "notebook.transferir": "Transferido de kit",
  "notebook.desativar": "Equipamento desativado",
  "notebook.bloquear": "Enviado para manutenção por ocorrência",
  "notebook.liberar": "Liberado após ocorrência",
};

const BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

async function buscarNotebook(
  id: string,
  actor: SessionUser,
): Promise<NotebookDetail | null> {
  try {
    return await getNotebook(id, actor);
  } catch (erro) {
    if (isAppError(erro) && erro.code === "NAO_ENCONTRADO") return null;
    throw erro;
  }
}

export default async function NotebookDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireSupervisor();

  const notebook = await buscarNotebook(id, actor);
  if (!notebook) notFound();

  const [historico, kits] = await Promise.all([
    entityHistory("Notebook", notebook.id, 20),
    listKits({ pageSize: 100, includeInactive: true }, actor),
  ]);

  const totalDeReservas =
    notebook.reservasAtivas.length + notebook.reservasDoKit.length;

  return (
    <>
      <PageHeader
        title={notebook.assetTag}
        description={
          [
            notebook.nickname,
            [notebook.brand, notebook.model].filter(Boolean).join(" "),
            notebook.kit ? `Kit ${notebook.kit.name}` : "Avulso (sem kit)",
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        action={
          <Link href="/admin/notebooks" className={BOTAO_SECUNDARIO}>
            ← Voltar para a lista
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        {notebook.status === "DESATIVADO" && (
          <Alert tone="warning" title="Equipamento desativado">
            Ele não aparece para os professores e não pode ser reservado. O
            vínculo com o kit e todo o histórico foram preservados.
          </Alert>
        )}

        <Card>
          <CardHeader title="Dados do equipamento" />
          <CardBody>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">Status</dt>
                <dd className="mt-1">
                  <Badge tone={TOM_DO_STATUS[notebook.status]}>
                    {notebook.statusLabel}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Patrimônio</dt>
                <dd className="mt-1 font-mono text-slate-800">
                  {notebook.assetTag}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Número de série</dt>
                <dd className="mt-1 font-mono text-slate-800">
                  {notebook.serialNumber ?? "Não informado"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Apelido</dt>
                <dd className="mt-1 text-slate-800">
                  {notebook.nickname ?? "Sem apelido"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Marca e modelo</dt>
                <dd className="mt-1 text-slate-800">
                  {[notebook.brand, notebook.model].filter(Boolean).join(" ") ||
                    "Não informados"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Kit</dt>
                <dd className="mt-1 text-slate-800">
                  {notebook.kit ? (
                    <Link
                      href={`/admin/kits/${notebook.kit.id}`}
                      className="text-senai-800 underline underline-offset-2"
                    >
                      {notebook.kit.name} ({notebook.kit.code})
                    </Link>
                  ) : (
                    "Avulso"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">
                  Reservas já registradas
                </dt>
                <dd className="mt-1 text-slate-800 tabular-nums">
                  {notebook.totalReservas}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Ocorrências</dt>
                <dd className="mt-1 text-slate-800 tabular-nums">
                  {notebook.totalOcorrencias}
                </dd>
              </div>
              <div className="sm:col-span-3">
                <dt className="text-xs text-slate-500">Observações internas</dt>
                <dd className="mt-1 whitespace-pre-line text-slate-800">
                  {notebook.notes ?? "Sem observações."}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <PainelDoNotebook
          notebook={{
            id: notebook.id,
            assetTag: notebook.assetTag,
            serialNumber: notebook.serialNumber,
            nickname: notebook.nickname,
            brand: notebook.brand,
            model: notebook.model,
            kitId: notebook.kit?.id ?? null,
            status: notebook.status,
            notes: notebook.notes,
            statusLabel: notebook.statusLabel,
          }}
          kits={kits.items.map((kit) => ({
            id: kit.id,
            code: kit.code,
            name: kit.name,
            status: kit.status,
          }))}
        />

        {/* Âncora usada pelo aviso de impacto do painel acima. */}
        <section id="reservas-afetadas" className="scroll-mt-20">
          <Card>
            <CardHeader
              title="Reservas ativas"
              description="Reservas que ainda não terminaram e contam com este equipamento — diretamente ou pelo kit em que ele está."
            />
            <CardBody>
              {totalDeReservas === 0 ? (
                <EmptyState
                  title="Nenhuma reserva ativa"
                  description="Nada depende deste equipamento agora: mudar o status ou desativá-lo não afeta aula nenhuma."
                />
              ) : (
                <div className="flex flex-col gap-4">
                  {notebook.reservasAtivas.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">
                        Reservas deste notebook ({notebook.reservasAtivas.length}
                        )
                      </h3>
                      <ul className="mt-2 flex flex-col gap-2">
                        {notebook.reservasAtivas.map((reserva) => (
                          <li
                            key={reserva.reservationId}
                            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 p-3"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900">
                                {reserva.periodoFormatado}
                              </p>
                              <p className="text-sm text-slate-600">
                                {reserva.docente.fullName}
                                {reserva.room ? ` · sala ${reserva.room}` : ""}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <Badge tone={TOM_DA_RESERVA[reserva.status]}>
                                {reserva.statusLabel}
                              </Badge>
                              <Link
                                href={`/admin/reservas/${reserva.reservationId}`}
                                className="inline-flex min-h-11 items-center text-sm font-medium text-senai-800 underline underline-offset-2"
                              >
                                Ver reserva {reserva.code}
                              </Link>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {notebook.reservasDoKit.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">
                        Reservas do kit inteiro ({notebook.reservasDoKit.length})
                      </h3>
                      <p className="text-sm text-slate-600">
                        O kit foi reservado por completo; este notebook vai
                        junto na maleta.
                      </p>
                      <ul className="mt-2 flex flex-col gap-2">
                        {notebook.reservasDoKit.map((reserva) => (
                          <li
                            key={reserva.reservationId}
                            className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 p-3"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900">
                                {reserva.periodoFormatado}
                              </p>
                              <p className="text-sm text-slate-600">
                                {reserva.docente.fullName}
                                {reserva.room ? ` · sala ${reserva.room}` : ""}
                              </p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <Badge tone={TOM_DA_RESERVA[reserva.status]}>
                                {reserva.statusLabel}
                              </Badge>
                              <Link
                                href={`/admin/reservas/${reserva.reservationId}`}
                                className="inline-flex min-h-11 items-center text-sm font-medium text-senai-800 underline underline-offset-2"
                              >
                                Ver reserva {reserva.code}
                              </Link>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </section>

        <section id="ocorrencias" className="scroll-mt-20">
          <Card>
            <CardHeader
              title="Ocorrências do equipamento"
              description="Últimos problemas registrados por professores e pela supervisão."
              action={
                <Link href="/admin/ocorrencias" className={BOTAO_SECUNDARIO}>
                  Ver todas as ocorrências
                </Link>
              }
            />
            <CardBody>
              {notebook.ocorrenciasRecentes.length === 0 ? (
                <EmptyState
                  title="Nenhuma ocorrência registrada"
                  description="Quando alguém relatar um problema com este equipamento, o registro aparece aqui com categoria, gravidade e situação."
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {notebook.ocorrenciasRecentes.map((ocorrencia) => (
                    <li
                      key={ocorrencia.id}
                      className="rounded-lg border border-slate-200 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-medium text-slate-900">
                          {CATEGORIA_LABEL[ocorrencia.category] ??
                            ocorrencia.category}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Badge
                            tone={
                              TOM_DA_SEVERIDADE[ocorrencia.severity] ??
                              "neutral"
                            }
                          >
                            Gravidade:{" "}
                            {SEVERIDADE_LABEL[ocorrencia.severity] ??
                              ocorrencia.severity}
                          </Badge>
                          <Badge
                            tone={
                              TOM_DA_OCORRENCIA[ocorrencia.status] ?? "neutral"
                            }
                          >
                            {OCORRENCIA_STATUS_LABEL[ocorrencia.status] ??
                              ocorrencia.status}
                          </Badge>
                        </div>
                      </div>
                      <p className="mt-1 text-sm text-slate-700">
                        {ocorrencia.description}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDateTimeBR(new Date(ocorrencia.createdAt))} ·{" "}
                        {ocorrencia.reportedBy
                          ? ocorrencia.reportedBy.fullName
                          : "autor removido"}
                      </p>
                      <Link
                        href={`/admin/ocorrencias/${ocorrencia.id}`}
                        className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-senai-800 underline underline-offset-2"
                      >
                        Abrir ocorrência {ocorrencia.code}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </section>

        <section id="historico" className="scroll-mt-20">
          <Card>
            <CardHeader
              title="Histórico de alterações"
              description="Últimos 20 registros da trilha de auditoria deste equipamento."
            />
            <CardBody>
              {historico.length === 0 ? (
                <EmptyState
                  title="Sem alterações registradas"
                  description="Cadastro, mudanças de status, transferências entre kits e desativação aparecem aqui com autor e data."
                />
              ) : (
                <ol className="flex flex-col gap-3">
                  {historico.map((registro) => (
                    <li
                      key={registro.id}
                      className="border-l-2 border-slate-200 pl-3"
                    >
                      <p className="text-sm text-slate-900">
                        {registro.summary ??
                          ACAO_LABEL[registro.action] ??
                          registro.action}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDateTimeBR(registro.createdAt)} ·{" "}
                        {registro.actor
                          ? registro.actor.fullName
                          : "usuário removido"}{" "}
                        · {ACAO_LABEL[registro.action] ?? registro.action}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </section>
      </div>
    </>
  );
}
