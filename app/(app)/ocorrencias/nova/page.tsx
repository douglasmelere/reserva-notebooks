import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { formatIntervalBR } from "@/lib/datetime";
import { Alert, PageHeader } from "@/components/ui/primitives";
import {
  INCIDENT_CATEGORY_LABEL,
  INCIDENT_SEVERITY_LABEL,
} from "@/server/incidents";
import { getChargerKit } from "@/server/chargers";
import { getKit } from "@/server/kits";
import { getNotebook } from "@/server/notebooks";
import { getReservation, listReservations } from "@/server/reservations";
import { RESERVATION_STATUS_LABEL } from "@/server/reservation-policy";
import type {
  IncidentCategory,
  IncidentSeverity,
  IncidentTargetType,
} from "@/generated/prisma/enums";
import { NovaOcorrenciaForm, type Opcao } from "./form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Registrar problema" };

/** Reservas recentes o bastante para o professor reconhecer na lista. */
const RESERVAS_NA_LISTA = 40;

export default async function NovaOcorrenciaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const notebookId = primeiro(sp.notebookId);
  const kitId = primeiro(sp.kitId);
  const chargerKitId = primeiro(sp.chargerKitId);
  const reservationId = primeiro(sp.reservationId);

  // O alvo mais específico da URL vence: quem vem da tela de um notebook quer
  // falar do notebook, mesmo que a reserva também tenha sido informada.
  const alvoInicial: IncidentTargetType = notebookId
    ? "NOTEBOOK"
    : kitId
      ? "KIT"
      : chargerKitId
        ? "CHARGER_KIT"
        : "RESERVATION";

  const [itemInicial, reservas] = await Promise.all([
    resolverItemInicial(user, { notebookId, kitId, chargerKitId }),
    listReservations({ pageSize: RESERVAS_NA_LISTA }, user),
  ]);

  const isSupervisor = user.role === "SUPERVISOR";

  // A formatação de data acontece aqui, no servidor: `formatIntervalBR` depende
  // do fuso da instituição, que só existe no ambiente do servidor.
  const opcoesReserva: Opcao[] = reservas.items.map((reserva) => ({
    value: reserva.id,
    label:
      `${reserva.code} — ${formatIntervalBR(reserva.startsAt, reserva.endsAt, reserva.allDay)}` +
      `${reserva.room ? ` · sala ${reserva.room}` : ""}` +
      `${isSupervisor ? ` · ${reserva.user.fullName}` : ""}` +
      ` · ${RESERVATION_STATUS_LABEL[reserva.status]}`,
  }));

  // A reserva que veio na URL pode ser antiga demais para estar entre as
  // últimas carregadas; sem esta costura o campo apareceria vazio e o professor
  // perderia o vínculo sem perceber.
  const reservaInicial =
    reservationId && opcoesReserva.some((o) => o.value === reservationId)
      ? reservationId
      : reservationId
        ? await rotularReservaAvulsa(user, reservationId, opcoesReserva)
        : "";

  const categorias: Opcao[] = (
    Object.keys(INCIDENT_CATEGORY_LABEL) as IncidentCategory[]
  ).map((valor) => ({ value: valor, label: INCIDENT_CATEGORY_LABEL[valor] }));

  const severidades: Opcao[] = (
    Object.keys(INCIDENT_SEVERITY_LABEL) as IncidentSeverity[]
  ).map((valor) => ({ value: valor, label: INCIDENT_SEVERITY_LABEL[valor] }));

  return (
    <>
      <PageHeader
        title="Registrar problema"
        description="Conte o que aconteceu com o equipamento. A supervisão recebe o registro e acompanha até a solução."
      />

      {!isSupervisor && (
        <Alert tone="info" className="mb-4">
          Informe a reserva em que você usou o equipamento. É ela que mostra à
          supervisão quem estava com o item. Se o problema não tem relação com
          uma reserva sua, procure a supervisão presencialmente.
        </Alert>
      )}

      <NovaOcorrenciaForm
        isSupervisor={isSupervisor}
        alvoInicial={alvoInicial}
        itemInicial={itemInicial}
        reservas={opcoesReserva}
        reservaInicial={reservaInicial}
        categorias={categorias}
        severidades={severidades}
      />

      <p className="mt-6 text-sm text-slate-600">
        <Link href="/ocorrencias" className="font-medium text-sky-800 underline">
          Voltar para meus problemas
        </Link>
      </p>
    </>
  );
}

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Resolve o rótulo do item que veio pré-selecionado na URL.
 *
 * Sem isso, o `select` do formulário dependeria de o item estar entre os
 * primeiros resultados da API — e um patrimônio que caísse fora da primeira
 * página apareceria como "nada selecionado", silenciosamente.
 */
async function resolverItemInicial(
  user: Awaited<ReturnType<typeof requireUser>>,
  ids: {
    notebookId?: string;
    kitId?: string;
    chargerKitId?: string;
  },
): Promise<Opcao | null> {
  try {
    if (ids.notebookId) {
      const notebook = await getNotebook(ids.notebookId, user);
      return {
        value: notebook.id,
        label: `${notebook.assetTag}${notebook.nickname ? ` — ${notebook.nickname}` : ""} (${notebook.statusLabel})`,
      };
    }
    if (ids.kitId) {
      const kit = await getKit(ids.kitId, user);
      return {
        value: kit.id,
        label: `${kit.name} (${kit.code}) — ${kit.statusLabel}`,
      };
    }
    if (ids.chargerKitId) {
      const chargerKit = await getChargerKit(ids.chargerKitId, user);
      return {
        value: chargerKit.id,
        label: `${chargerKit.code} — ${chargerKit.statusLabel}`,
      };
    }
  } catch {
    // Link antigo ou item que o usuário não pode ver: o formulário abre com o
    // campo vazio em vez de estourar uma tela de erro.
    return null;
  }
  return null;
}

/**
 * Acrescenta à lista a reserva indicada na URL quando ela não está entre as
 * mais recentes. Devolve o id se conseguiu; string vazia se não.
 */
async function rotularReservaAvulsa(
  user: Awaited<ReturnType<typeof requireUser>>,
  reservationId: string,
  opcoes: Opcao[],
): Promise<string> {
  try {
    const reserva = await getReservation(reservationId, user);
    opcoes.unshift({
      value: reserva.id,
      label: `${reserva.code} — ${formatIntervalBR(reserva.startsAt, reserva.endsAt, reserva.allDay)}`,
    });
    return reserva.id;
  } catch {
    // Reserva de outro docente, ou removida: o campo abre vazio e o professor
    // escolhe uma reserva válida.
    return "";
  }
}
