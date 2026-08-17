import { requireUser } from "@/lib/auth";
import { addDays, todayLocal } from "@/lib/datetime";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/ui/primitives";
import { AssistenteDeReserva } from "./wizard";

export const dynamic = "force-dynamic";

/**
 * Tela de nova reserva.
 *
 * As regras configuráveis (horário de funcionamento, antecedência, limite de
 * equipamentos) são lidas aqui, no servidor, e descem prontas para o
 * assistente. Assim o professor esbarra no limite enquanto preenche, e não
 * depois de enviar — sem que a tela precise buscar as configurações por HTTP.
 */
export default async function ReservarPage() {
  await requireUser();
  const settings = await getSettings();

  const hoje = todayLocal();

  return (
    <>
      <PageHeader
        title="Fazer uma reserva"
        description="Em poucas etapas você reserva uma maleta, um carrinho ou notebooks avulsos para a sua aula."
      />

      <AssistenteDeReserva
        config={{
          hoje,
          // Quando a instituição não libera reserva para o mesmo dia, o próprio
          // seletor de data já começa amanhã.
          dataMinima: settings.allowSameDay ? hoje : addDays(hoje, 1),
          dataMaxima: addDays(hoje, settings.maxAdvanceDays),
          requireTimeRange: settings.requireTimeRange,
          openingTime: settings.openingTime,
          closingTime: settings.closingTime,
          minAdvanceHours: settings.minAdvanceHours,
          maxResourcesPerReservation: settings.maxResourcesPerReservation,
          allowMixedResourceReservation: settings.allowMixedResourceReservation,
          whatsappContactEnabled: settings.whatsappContactEnabled,
        }}
      />
    </>
  );
}
