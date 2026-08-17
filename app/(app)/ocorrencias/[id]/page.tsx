import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { entityHistory } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { formatDateTimeBR } from "@/lib/datetime";
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
import { getIncident } from "@/server/incidents";
import type { IncidentSeverity, IncidentStatus } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const TOM_STATUS: Record<IncidentStatus, BadgeTone> = {
  ABERTA: "warning",
  EM_ANALISE: "info",
  EM_MANUTENCAO: "warning",
  RESOLVIDA: "success",
  DESCARTADA: "muted",
  RECORRENTE: "danger",
};

const TOM_SEVERIDADE: Record<IncidentSeverity, BadgeTone> = {
  BAIXA: "muted",
  MEDIA: "warning",
  ALTA: "danger",
  CRITICA: "danger",
};

/** Ações de auditoria que caem nesta entidade, em linguagem de quem lê. */
const ACAO_LABEL: Record<string, string> = {
  "ocorrencia.registrar": "Ocorrência registrada",
  "ocorrencia.atualizar": "Ocorrência atualizada",
  "ocorrencia.anexar": "Foto anexada",
};

export default async function DetalheOcorrenciaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  // O serviço responde "não encontrada" também para quem não pode ver a
  // ocorrência; a tela repete essa resposta em vez de revelar que ela existe.
  const ocorrencia = await getIncident(id, user).catch(() => null);
  if (!ocorrencia) notFound();

  const historico = await entityHistory("Incident", ocorrencia.id);

  return (
    <>
      <PageHeader
        title={`Ocorrência ${ocorrencia.code}`}
        description={ocorrencia.alvoLabel}
        action={
          <Link
            href="/ocorrencias"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            Voltar
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge tone={TOM_STATUS[ocorrencia.status]}>
            Situação: {ocorrencia.statusLabel}
          </Badge>
          <Badge tone={TOM_SEVERIDADE[ocorrencia.severity]}>
            Severidade: {ocorrencia.severityLabel}
          </Badge>
          <Badge tone="neutral">{ocorrencia.categoryLabel}</Badge>
          {ocorrencia.recursoBloqueado && (
            <Badge tone="danger">Equipamento bloqueado</Badge>
          )}
        </div>

        {ocorrencia.recursoBloqueado && (
          <Alert tone="warning" title="Este equipamento está fora de circulação">
            Ele não aparece para novas reservas até a supervisão liberá-lo. As
            reservas já existentes não são canceladas automaticamente — confirme
            com a supervisão antes da sua próxima aula.
          </Alert>
        )}

        <Card>
          <CardHeader title="Resumo" />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Info titulo="Tipo de alvo" valor={ocorrencia.targetTypeLabel} />
              <Info titulo="Equipamento" valor={ocorrencia.alvoLabel} />
              <Info
                titulo="Registrada em"
                valor={formatDateTimeBR(new Date(ocorrencia.createdAt))}
              />
              <Info
                titulo="Registrada por"
                valor={ocorrencia.reportedBy.fullName}
              />
              <Info
                titulo="Responsável pela análise"
                valor={
                  ocorrencia.assignedTo?.fullName ?? "Ainda sem responsável definido"
                }
              />
              <Info
                titulo="Reserva vinculada"
                valor={
                  ocorrencia.reservation
                    ? `${ocorrencia.reservation.code} · ${ocorrencia.reservation.periodoFormatado}`
                    : "Nenhuma"
                }
              />
              {ocorrencia.notebook && (
                <Info
                  titulo="Situação do notebook"
                  valor={ocorrencia.notebook.statusLabel}
                />
              )}
              {ocorrencia.kit && (
                <Info
                  titulo="Situação da maleta/carrinho"
                  valor={ocorrencia.kit.statusLabel}
                />
              )}
              {ocorrencia.chargerKit && (
                <Info
                  titulo="Situação do kit de carregadores"
                  valor={ocorrencia.chargerKit.statusLabel}
                />
              )}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="O que foi relatado" />
          <CardBody>
            <p className="text-sm whitespace-pre-line text-slate-800">
              {ocorrencia.description}
            </p>
          </CardBody>
        </Card>

        {ocorrencia.resolution && (
          <Card>
            <CardHeader
              title="Resposta da supervisão"
              description={
                ocorrencia.resolvedAt
                  ? `Encerrada em ${formatDateTimeBR(new Date(ocorrencia.resolvedAt))}`
                  : undefined
              }
            />
            <CardBody>
              <p className="text-sm whitespace-pre-line text-slate-800">
                {ocorrencia.resolution}
              </p>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title="Fotos anexadas" />
          <CardBody>
            {ocorrencia.attachments.length === 0 ? (
              <EmptyState
                title="Nenhuma foto anexada"
                description="As fotos são anexadas logo depois de registrar o problema. Se precisar enviar uma imagem agora, fale com a supervisão."
              />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {ocorrencia.attachments.map((anexo) => (
                  <li key={anexo.id}>
                    <a
                      href={anexo.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={anexo.url}
                        alt={`Foto anexada: ${anexo.fileName}`}
                        className="h-28 w-full object-cover"
                      />
                      <span className="block truncate px-2 py-1 text-xs text-slate-600">
                        {anexo.fileName} · {anexo.uploadedBy.fullName}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Histórico"
            description="Tudo o que aconteceu com esta ocorrência, do mais recente para o mais antigo."
          />
          <CardBody>
            {historico.length === 0 ? (
              <EmptyState
                title="Sem movimentações registradas"
                description="Assim que a supervisão analisar o problema, as mudanças aparecem aqui."
              />
            ) : (
              <ol className="flex flex-col gap-3">
                {historico.map((registro) => (
                  <li
                    key={registro.id}
                    className="border-l-2 border-slate-200 pl-3"
                  >
                    <p className="text-sm font-medium text-slate-900">
                      {ACAO_LABEL[registro.action] ?? registro.action}
                    </p>
                    {registro.summary && (
                      <p className="text-sm text-slate-700">{registro.summary}</p>
                    )}
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatDateTimeBR(registro.createdAt)}
                      {registro.actor ? ` · ${registro.actor.fullName}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Info({ titulo, valor }: { titulo: string; valor: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {titulo}
      </dt>
      <dd className="mt-0.5 text-sm break-words text-slate-900">{valor}</dd>
    </div>
  );
}
