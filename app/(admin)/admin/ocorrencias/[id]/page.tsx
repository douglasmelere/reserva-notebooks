import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { entityHistory } from "@/lib/audit";
import { requireSupervisor } from "@/lib/auth";
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
import {
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  getIncident,
} from "@/server/incidents";
import { listUsers } from "@/server/users";
import type { IncidentSeverity, IncidentStatus } from "@/generated/prisma/enums";
import { GestaoOcorrencia } from "./gestao";

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

const ACAO_LABEL: Record<string, string> = {
  "ocorrencia.registrar": "Ocorrência registrada",
  "ocorrencia.atualizar": "Ocorrência atualizada",
  "ocorrencia.anexar": "Foto anexada",
};

/** Onde a supervisão libera cada tipo de equipamento. */
const TELA_DO_INVENTARIO: Record<string, { href: string; nome: string }> = {
  NOTEBOOK: { href: "/admin/notebooks", nome: "Notebooks" },
  KIT: { href: "/admin/kits", nome: "Kits e carrinhos" },
  CHARGER_KIT: { href: "/admin/carregadores", nome: "Carregadores" },
};

export default async function AdminDetalheOcorrenciaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireSupervisor();
  const { id } = await params;

  const ocorrencia = await getIncident(id, user).catch(() => null);
  if (!ocorrencia) notFound();

  const [historico, supervisores] = await Promise.all([
    entityHistory("Incident", ocorrencia.id),
    listUsers({ role: "SUPERVISOR", active: true, pageSize: 100 }, user),
  ]);

  const inventario = TELA_DO_INVENTARIO[ocorrencia.targetType];

  return (
    <>
      <PageHeader
        title={`Ocorrência ${ocorrencia.code}`}
        description={`${ocorrencia.targetTypeLabel}: ${ocorrencia.alvoLabel}`}
        action={
          <Link
            href="/admin/ocorrencias"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            Voltar para a fila
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
          <Badge tone={ocorrencia.recursoBloqueado ? "danger" : "success"}>
            {ocorrencia.recursoBloqueado
              ? "Equipamento bloqueado"
              : "Equipamento em circulação"}
          </Badge>
        </div>

        {/* A regra que mais gera engano na operação: fechar a ocorrência não
            devolve o equipamento à fila de reservas. */}
        {ocorrencia.recursoBloqueado ? (
          <Alert tone="warning" title="Equipamento fora de circulação">
            <p>
              {ocorrencia.alvoLabel} está em manutenção e não aparece para novas
              reservas. Resolver ou descartar esta ocorrência{" "}
              <strong>não</strong> devolve o equipamento à disponibilidade — a
              liberação é uma decisão separada, tomada quando o item estiver
              conferido.
            </p>
            <p className="mt-2">
              Libere pelo painel abaixo ou pela tela{" "}
              {inventario ? (
                <Link href={inventario.href} className="font-semibold underline">
                  {inventario.nome}
                </Link>
              ) : (
                "de inventário"
              )}
              . As reservas já existentes não foram canceladas: avise quem seria
              afetado.
            </p>
          </Alert>
        ) : (
          ocorrencia.targetType !== "RESERVATION" && (
            <Alert tone="info">
              {ocorrencia.alvoLabel} continua disponível para novas reservas. Se o
              problema impede o uso, bloqueie o equipamento no painel de gestão.
            </Alert>
          )
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4 lg:col-span-2">
            <Card>
              <CardHeader title="Resumo" />
              <CardBody>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Info titulo="Tipo de alvo" valor={ocorrencia.targetTypeLabel} />
                  <Info titulo="Equipamento" valor={ocorrencia.alvoLabel} />
                  <Info
                    titulo="Aberta em"
                    valor={formatDateTimeBR(new Date(ocorrencia.createdAt))}
                  />
                  <Info
                    titulo="Última atualização"
                    valor={formatDateTimeBR(new Date(ocorrencia.updatedAt))}
                  />
                  <Info
                    titulo="Relatada por"
                    valor={`${ocorrencia.reportedBy.fullName} (${ocorrencia.reportedBy.username})`}
                  />
                  <Info
                    titulo="Responsável"
                    valor={ocorrencia.assignedTo?.fullName ?? "Sem responsável"}
                  />
                  <Info
                    titulo="Reserva vinculada"
                    valor={
                      ocorrencia.reservation ? (
                        <>
                          {ocorrencia.reservation.code} ·{" "}
                          {ocorrencia.reservation.periodoFormatado}
                          <span className="block text-xs text-slate-600">
                            Docente: {ocorrencia.reservation.professor.fullName}
                          </span>
                        </>
                      ) : (
                        "Nenhuma"
                      )
                    }
                  />
                  {ocorrencia.notebook && (
                    <Info
                      titulo="Situação do notebook"
                      valor={`${ocorrencia.notebook.assetTag} — ${ocorrencia.notebook.statusLabel}`}
                    />
                  )}
                  {ocorrencia.kit && (
                    <Info
                      titulo="Situação da maleta/carrinho"
                      valor={`${ocorrencia.kit.name} — ${ocorrencia.kit.statusLabel}`}
                    />
                  )}
                  {ocorrencia.chargerKit && (
                    <Info
                      titulo="Situação do kit de carregadores"
                      valor={`${ocorrencia.chargerKit.code} — ${ocorrencia.chargerKit.statusLabel}`}
                    />
                  )}
                  {ocorrencia.resolvedAt && (
                    <Info
                      titulo="Encerrada em"
                      valor={formatDateTimeBR(new Date(ocorrencia.resolvedAt))}
                    />
                  )}
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Relato do docente" />
              <CardBody>
                <p className="text-sm whitespace-pre-line text-slate-800">
                  {ocorrencia.description}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Fotos anexadas" />
              <CardBody>
                {ocorrencia.attachments.length === 0 ? (
                  <EmptyState
                    title="Sem fotos anexadas"
                    description="Esta ocorrência foi registrada apenas com texto. Se precisar de imagem para avaliar o dano, peça ao docente que envie ao registrar a próxima ou anexe o laudo da assistência."
                  />
                ) : (
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
                title="Histórico completo"
                description="Trilha de auditoria desta ocorrência, do mais recente para o mais antigo."
              />
              <CardBody>
                {historico.length === 0 ? (
                  <EmptyState
                    title="Sem movimentações registradas"
                    description="Nenhuma alteração foi gravada para esta ocorrência além do registro inicial."
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
                          {registro.actor
                            ? ` · ${registro.actor.fullName} (${registro.actor.username})`
                            : " · sistema"}
                          {registro.ip ? ` · IP ${registro.ip}` : ""}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <GestaoOcorrencia
              incidenteId={ocorrencia.id}
              codigo={ocorrencia.code}
              alvoLabel={ocorrencia.alvoLabel}
              bloqueavel={ocorrencia.targetType !== "RESERVATION"}
              recursoBloqueado={ocorrencia.recursoBloqueado}
              inicial={{
                status: ocorrencia.status,
                severity: ocorrencia.severity,
                assignedToId: ocorrencia.assignedTo?.id ?? "",
                resolution: ocorrencia.resolution ?? "",
              }}
              statusOpcoes={(
                Object.keys(INCIDENT_STATUS_LABEL) as IncidentStatus[]
              ).map((valor) => ({
                value: valor,
                label: INCIDENT_STATUS_LABEL[valor],
              }))}
              severidadeOpcoes={(
                Object.keys(INCIDENT_SEVERITY_LABEL) as IncidentSeverity[]
              ).map((valor) => ({
                value: valor,
                label: INCIDENT_SEVERITY_LABEL[valor],
              }))}
              supervisores={supervisores.items.map((supervisor) => ({
                value: supervisor.id,
                label: supervisor.fullName,
              }))}
              telaInventario={inventario ?? null}
            />
          </div>
        </div>
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
