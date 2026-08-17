import Link from "next/link";
import type { KitStatus, NotebookStatus } from "@/generated/prisma/enums";
import { requireSupervisor } from "@/lib/auth";
import { todayLocal } from "@/lib/datetime";
import { getSettings } from "@/lib/settings";
import { PageHeader, type BadgeTone } from "@/components/ui/primitives";
import { listKits } from "@/server/kits";
import { listNotebooks } from "@/server/notebooks";
import { notebookIsReservable } from "@/server/resources";
import { listUsers } from "@/server/users";
import { FormularioDeReserva } from "./form";

export const dynamic = "force-dynamic";

/** Tom do selo de situação do equipamento. O texto sempre acompanha a cor. */
const tomDoKit = (status: KitStatus): BadgeTone =>
  status === "DISPONIVEL"
    ? "success"
    : status === "MANUTENCAO"
      ? "warning"
      : status === "DESATIVADO"
        ? "muted"
        : "danger";

const tomDoNotebook = (status: NotebookStatus): BadgeTone =>
  status === "DISPONIVEL"
    ? "success"
    : status === "RESERVADO" || status === "EM_USO"
      ? "info"
      : status === "MANUTENCAO"
        ? "warning"
        : status === "DESATIVADO"
          ? "muted"
          : "danger";

/**
 * Criação de reserva em nome de um professor.
 *
 * As listas de professores e equipamentos são carregadas no servidor: a tela
 * abre já preenchida, sem uma cascata de requisições no navegador. As regras
 * que a supervisão contorna vêm das configurações vigentes e são exibidas com
 * os valores reais, para que a exceção seja uma decisão consciente.
 */
export default async function NovaReservaPage() {
  const supervisor = await requireSupervisor();

  const [settings, professores, kits, notebooks] = await Promise.all([
    getSettings(),
    listUsers({ pageSize: 100, active: true }, supervisor),
    listKits({ pageSize: 100 }, supervisor),
    listNotebooks({ pageSize: 100 }, supervisor),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Nova reserva pela supervisão"
        description="Registre uma reserva em nome de um professor — inclusive fora dos prazos que valem para ele."
        action={
          <Link
            href="/admin/reservas"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            ← Voltar para as reservas
          </Link>
        }
      />

      <FormularioDeReserva
        hoje={todayLocal()}
        professores={professores.items.map((professor) => ({
          id: professor.id,
          nome: professor.fullName,
          departamento: professor.department,
        }))}
        kits={kits.items.map((kit) => ({
          id: kit.id,
          nome: `${kit.name} (${kit.code})`,
          detalhe: `${kit.type === "MALETA" ? "Maleta" : "Carrinho"} · ${kit.notebookCount} notebook(s)${kit.location ? ` · ${kit.location}` : ""}`,
          statusLabel: kit.statusLabel,
          tom: tomDoKit(kit.status),
          reservavel: kit.reservavel,
          // A regra "kit de carregadores completo" só vale quando ligada nas
          // configurações; mostramos o estado para a decisão ser informada.
          carregadoresCompletos: kit.chargerKit?.completo ?? null,
        }))}
        notebooks={notebooks.items.map((notebook) => ({
          id: notebook.id,
          nome: `${notebook.assetTag}${notebook.nickname ? ` — ${notebook.nickname}` : ""}`,
          detalhe: notebook.kit ? `Pertence ao kit ${notebook.kit.name}` : "Avulso",
          statusLabel: notebook.statusLabel,
          tom: tomDoNotebook(notebook.status),
          reservavel: notebookIsReservable(notebook.status),
        }))}
        politicas={{
          requireTimeRange: settings.requireTimeRange,
          minAdvanceHours: settings.minAdvanceHours,
          maxAdvanceDays: settings.maxAdvanceDays,
          allowSameDay: settings.allowSameDay,
          maxActiveReservationsPerUser: settings.maxActiveReservationsPerUser,
          maxResourcesPerReservation: settings.maxResourcesPerReservation,
          openingTime: settings.openingTime,
          closingTime: settings.closingTime,
          allowMixedResourceReservation: settings.allowMixedResourceReservation,
          requireCompleteChargerKit: settings.requireCompleteChargerKit,
        }}
      />
    </div>
  );
}
