import Link from "next/link";
import { notFound } from "next/navigation";
import { entityHistory } from "@/lib/audit";
import { requireSupervisor } from "@/lib/auth";
import { formatDateTimeBR } from "@/lib/datetime";
import { isAppError } from "@/lib/errors";
import type { SessionUser } from "@/lib/session";
import { getKit, type KitDetail } from "@/server/kits";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  TableWrapper,
  Td,
  Th,
  type BadgeTone,
} from "@/components/ui/primitives";
import type {
  KitType,
  NotebookStatus,
  ReservationStatus,
} from "@/generated/prisma/enums";
import { GestaoDoKit } from "./gestao";

export const dynamic = "force-dynamic";

const TIPO_LABEL: Record<KitType, string> = {
  MALETA: "Maleta",
  CARRINHO: "Carrinho",
};

const TOM_DO_NOTEBOOK: Record<NotebookStatus, BadgeTone> = {
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

const BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500";

/**
 * A trilha de auditoria guarda a ação como chave técnica ("kit.desativar").
 * Quem lê a tela é a supervisão, então a chave nunca aparece crua.
 */
const ACAO_LABEL: Record<string, string> = {
  "kit.criar": "Kit cadastrado",
  "kit.atualizar": "Cadastro editado",
  "kit.status": "Status alterado",
  "kit.desativar": "Kit desativado",
  "kit.bloquear": "Enviado para manutenção por ocorrência",
  "kit.liberar": "Liberado após ocorrência",
};

/**
 * Kit inexistente vira 404 da própria aplicação. Qualquer outro erro continua
 * subindo: engolir uma falha de banco aqui esconderia o problema real.
 */
async function buscarKit(
  id: string,
  actor: SessionUser,
): Promise<KitDetail | null> {
  try {
    return await getKit(id, actor);
  } catch (erro) {
    if (isAppError(erro) && erro.code === "NAO_ENCONTRADO") return null;
    throw erro;
  }
}

export default async function KitDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireSupervisor();

  const kit = await buscarKit(id, actor);
  if (!kit) notFound();

  // O histórico é a própria trilha de auditoria: uma fonte só para auditoria e
  // para o "histórico de alterações" pedido na tela.
  const historico = await entityHistory("Kit", kit.id, 20);

  const faltamNotebooks = kit.capacity - kit.notebookCount;
  const carregador = kit.chargerKit;

  return (
    <>
      <PageHeader
        title={kit.name}
        description={`${TIPO_LABEL[kit.type]} · código ${kit.code} · capacidade ${kit.capacity}`}
        action={
          <Link href="/admin/kits" className={BOTAO_SECUNDARIO}>
            ← Voltar para a lista
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        {kit.status === "DESATIVADO" && (
          <Alert tone="warning" title="Kit desativado">
            Este kit não aparece para os professores e não pode ser reservado. O
            histórico foi preservado e ele pode voltar ao inventário pelo painel
            de gestão abaixo.
          </Alert>
        )}

        {kit.capacidadeExcedida && (
          <Alert tone="danger" title="Notebooks acima da capacidade">
            O kit comporta {kit.capacity} notebook(s), mas tem{" "}
            {kit.notebookCount} vinculado(s). Transfira os excedentes para outro
            kit ou aumente a capacidade.
          </Alert>
        )}

        {!kit.capacidadeExcedida && faltamNotebooks > 0 && (
          <Alert tone="warning" title="Kit incompleto">
            Faltam {faltamNotebooks} notebook(s) para o kit atingir a capacidade
            planejada de {kit.capacity}.
          </Alert>
        )}

        {carregador && !carregador.completo && (
          <Alert tone="warning" title="Carregadores incompletos">
            O kit de carregadores {carregador.code} está como “
            {carregador.statusLabel}”: {carregador.availableQuantity} de{" "}
            {carregador.totalQuantity} disponíveis
            {carregador.faltando > 0 ? ` (faltam ${carregador.faltando})` : ""}.
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Dados do kit" />
            <CardBody>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">Status</dt>
                  <dd className="mt-1">
                    <Badge
                      tone={
                        kit.status === "DISPONIVEL"
                          ? "success"
                          : kit.status === "MANUTENCAO"
                            ? "warning"
                            : kit.status === "INDISPONIVEL"
                              ? "danger"
                              : "muted"
                      }
                    >
                      {kit.statusLabel}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Localização</dt>
                  <dd className="mt-1 text-slate-800">
                    {kit.location ?? "Não informada"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">
                    Notebooks vinculados
                  </dt>
                  <dd className="mt-1 text-slate-800 tabular-nums">
                    {kit.notebookCount} de {kit.capacity} ·{" "}
                    {kit.vagasRestantes} vaga(s) livre(s)
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Reservável</dt>
                  <dd className="mt-1 text-slate-800">
                    {kit.reservavel
                      ? "Sim, conforme a agenda"
                      : "Não, pelo status atual"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">Descrição</dt>
                  <dd className="mt-1 whitespace-pre-line text-slate-800">
                    {kit.description ?? "Sem descrição."}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-slate-500">
                    Observações internas
                  </dt>
                  <dd className="mt-1 whitespace-pre-line text-slate-800">
                    {kit.notes ?? "Sem observações."}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Kit de carregadores"
              description="Completo ou incompleto é calculado pela contagem: disponível contra total."
            />
            <CardBody>
              {carregador ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-sm text-slate-700">
                      {carregador.code}
                    </p>
                    <Badge
                      tone={
                        carregador.status === "COMPLETO"
                          ? "success"
                          : carregador.status === "INCOMPLETO" ||
                              carregador.status === "MANUTENCAO"
                            ? "warning"
                            : carregador.status === "INDISPONIVEL"
                              ? "danger"
                              : "muted"
                      }
                    >
                      {carregador.statusLabel}
                    </Badge>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">Total</dt>
                      <dd className="text-slate-800 tabular-nums">
                        {carregador.totalQuantity}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Disponíveis</dt>
                      <dd className="text-slate-800 tabular-nums">
                        {carregador.availableQuantity}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Faltando</dt>
                      <dd className="text-slate-800 tabular-nums">
                        {carregador.faltando}
                      </dd>
                    </div>
                  </dl>
                  <Link href="/admin/carregadores" className={BOTAO_SECUNDARIO}>
                    Gerenciar carregadores
                  </Link>
                </div>
              ) : (
                <EmptyState
                  title="Nenhum kit de carregadores vinculado"
                  description="Cadastre um kit de carregadores e vincule-o a esta maleta/carrinho para que a supervisão saiba quantas fontes saem junto."
                  action={
                    <Link
                      href="/admin/carregadores"
                      className={BOTAO_SECUNDARIO}
                    >
                      Ir para carregadores
                    </Link>
                  }
                />
              )}
            </CardBody>
          </Card>
        </div>

        {/* Só os campos que o painel usa: o detalhe inteiro (notebooks e
            reservas) seria serializado para o navegador à toa. */}
        <GestaoDoKit
          kit={{
            id: kit.id,
            code: kit.code,
            name: kit.name,
            type: kit.type,
            capacity: kit.capacity,
            location: kit.location,
            description: kit.description,
            notes: kit.notes,
            status: kit.status,
            statusLabel: kit.statusLabel,
            notebookCount: kit.notebookCount,
          }}
        />

        <Card>
          <CardHeader
            title="Notebooks deste kit"
            description={`${kit.notebooks.length} equipamento(s) vinculado(s), incluindo os desativados (o vínculo é histórico).`}
          />
          <CardBody>
            {kit.notebooks.length === 0 ? (
              <EmptyState
                title="Nenhum notebook vinculado"
                description="Cadastre os equipamentos e escolha este kit como destino, ou transfira notebooks avulsos na tela de cada equipamento."
                action={
                  <Link href="/admin/notebooks/lote" className={BOTAO_SECUNDARIO}>
                    Cadastrar notebooks em lote
                  </Link>
                }
              />
            ) : (
              <>
                <ul className="flex flex-col gap-3 md:hidden">
                  {kit.notebooks.map((notebook) => (
                    <li
                      key={notebook.id}
                      className="rounded-lg border border-slate-200 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-semibold text-slate-900">
                            {notebook.assetTag}
                          </p>
                          <p className="text-sm text-slate-600">
                            {notebook.nickname ??
                              ([notebook.brand, notebook.model]
                                .filter(Boolean)
                                .join(" ") ||
                                "Sem apelido")}
                          </p>
                        </div>
                        <Badge tone={TOM_DO_NOTEBOOK[notebook.status]}>
                          {notebook.statusLabel}
                        </Badge>
                      </div>
                      <Link
                        href={`/admin/notebooks/${notebook.id}`}
                        className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-sky-800 underline underline-offset-2"
                      >
                        Abrir equipamento
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="hidden md:block">
                  <TableWrapper>
                    <caption className="sr-only">
                      Notebooks vinculados a este kit, com status atual.
                    </caption>
                    <thead>
                      <tr>
                        <Th>Patrimônio</Th>
                        <Th>Apelido</Th>
                        <Th>Marca / modelo</Th>
                        <Th>Status</Th>
                        <Th>
                          <span className="sr-only">Ações</span>
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {kit.notebooks.map((notebook) => (
                        <tr key={notebook.id} className="hover:bg-slate-50">
                          <Td className="font-mono text-xs">
                            {notebook.assetTag}
                          </Td>
                          <Td>{notebook.nickname ?? "—"}</Td>
                          <Td>
                            {[notebook.brand, notebook.model]
                              .filter(Boolean)
                              .join(" ") || "—"}
                          </Td>
                          <Td>
                            <Badge tone={TOM_DO_NOTEBOOK[notebook.status]}>
                              {notebook.statusLabel}
                            </Badge>
                          </Td>
                          <Td>
                            <Link
                              href={`/admin/notebooks/${notebook.id}`}
                              className="inline-flex min-h-11 items-center font-medium text-sky-800 underline underline-offset-2"
                            >
                              Abrir
                              <span className="sr-only">
                                {" "}
                                o notebook {notebook.assetTag}
                              </span>
                            </Link>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </TableWrapper>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Próximas reservas"
            description="Reservas ativas que ainda não terminaram. Enquanto existirem, o kit não pode ser desativado."
          />
          <CardBody>
            {kit.reservasFuturas.length === 0 ? (
              <EmptyState
                title="Nenhuma reserva ativa"
                description="Este kit está livre na agenda. Nada impede desativá-lo ou colocá-lo em manutenção agora."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {kit.reservasFuturas.map((reserva) => (
                  <li
                    key={reserva.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 p-3"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900">
                        {reserva.periodoFormatado}
                      </p>
                      <p className="text-sm text-slate-600">
                        {reserva.professor.fullName}
                        {reserva.room ? ` · sala ${reserva.room}` : ""}
                      </p>
                      {reserva.purpose && (
                        <p className="text-sm text-slate-600">
                          {reserva.purpose}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge tone={TOM_DA_RESERVA[reserva.status]}>
                        {reserva.statusLabel}
                      </Badge>
                      <Link
                        href={`/admin/reservas/${reserva.id}`}
                        className="inline-flex min-h-11 items-center text-sm font-medium text-sky-800 underline underline-offset-2"
                      >
                        Ver reserva {reserva.code}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Histórico de alterações"
            description="Últimos 20 registros da trilha de auditoria deste kit."
          />
          <CardBody>
            {historico.length === 0 ? (
              <EmptyState
                title="Sem alterações registradas"
                description="Assim que alguém editar o cadastro, mudar o status ou desativar o kit, o registro aparece aqui com autor e data."
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
      </div>
    </>
  );
}
