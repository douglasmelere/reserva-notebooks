"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { CheckboxField, TextAreaField, TextField } from "@/components/ui/field";
import { Alert, Card, CardBody, CardHeader } from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api-client";
import type { Settings } from "@/lib/settings";
import { renderTemplate } from "@/lib/whatsapp";

/**
 * Configurações administrativas.
 *
 * A validação de verdade é a da API: `settingsSchema` mora junto do acesso ao
 * banco, e importá-lo aqui arrastaria o Prisma para o pacote do navegador. Por
 * isso os limites de cada campo aparecem como restrições nativas do controle
 * (min, max, passo, formato) e as mensagens por campo vêm da resposta — geradas
 * pelo mesmo schema, sem uma segunda versão das regras para divergir.
 */

/** Dados de exemplo da prévia da mensagem de WhatsApp. */
const EXEMPLO_WHATSAPP = {
  professor: "Ana Souza",
  recurso: "Maleta 2 (MAL-002)",
  periodo: "17/08/2026, das 13:30 às 15:10",
  solicitante: "Carlos Lima",
  sala: "Sala 12",
};

const MARCADORES = [
  { marcador: "{professor}", significado: "nome de quem está com o equipamento" },
  { marcador: "{recurso}", significado: "kit ou notebook reservado" },
  { marcador: "{periodo}", significado: "data e horário da reserva" },
  { marcador: "{solicitante}", significado: "nome de quem está pedindo" },
  { marcador: "{sala}", significado: "sala informada na reserva" },
];

type Estado = {
  requireTimeRange: boolean;
  minAdvanceHours: string;
  maxAdvanceDays: string;
  allowSameDay: boolean;
  maxActiveReservationsPerUser: string;
  maxResourcesPerReservation: string;
  openingTime: string;
  closingTime: string;
  cancellationDeadlineHours: string;
  allowCancelAfterStart: boolean;
  allowMixedResourceReservation: boolean;
  requireCompleteChargerKit: boolean;
  whatsappContactEnabled: boolean;
  whatsappMessageTemplate: string;
  whatsappUnavailableMessage: string;
  noShowAfterHours: string;
  institutionName: string;
};

function paraEstado(settings: Settings): Estado {
  return {
    requireTimeRange: settings.requireTimeRange,
    minAdvanceHours: String(settings.minAdvanceHours),
    maxAdvanceDays: String(settings.maxAdvanceDays),
    allowSameDay: settings.allowSameDay,
    maxActiveReservationsPerUser: String(settings.maxActiveReservationsPerUser),
    maxResourcesPerReservation: String(settings.maxResourcesPerReservation),
    openingTime: settings.openingTime,
    closingTime: settings.closingTime,
    cancellationDeadlineHours: String(settings.cancellationDeadlineHours),
    allowCancelAfterStart: settings.allowCancelAfterStart,
    allowMixedResourceReservation: settings.allowMixedResourceReservation,
    requireCompleteChargerKit: settings.requireCompleteChargerKit,
    whatsappContactEnabled: settings.whatsappContactEnabled,
    whatsappMessageTemplate: settings.whatsappMessageTemplate,
    whatsappUnavailableMessage: settings.whatsappUnavailableMessage,
    noShowAfterHours: String(settings.noShowAfterHours),
    institutionName: settings.institutionName,
  };
}

const CAMPOS_NUMERICOS = [
  "minAdvanceHours",
  "maxAdvanceDays",
  "maxActiveReservationsPerUser",
  "maxResourcesPerReservation",
  "cancellationDeadlineHours",
  "noShowAfterHours",
] as const;

type CampoNumerico = (typeof CAMPOS_NUMERICOS)[number];

function ehCampoNumerico(chave: string): chave is CampoNumerico {
  return (CAMPOS_NUMERICOS as readonly string[]).includes(chave);
}

export function FormularioDeConfiguracoes({
  configuracoes,
  padroes,
}: {
  configuracoes: Settings;
  padroes: Settings;
}) {
  const router = useRouter();

  const [form, setForm] = useState<Estado>(() => paraEstado(configuracoes));
  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string[]>>({});

  // Depois de salvar, o servidor devolve os valores gravados; o formulário
  // acompanha para que o próximo salvamento compare com o que está no banco.
  const assinatura = JSON.stringify(configuracoes);
  useEffect(() => {
    setForm(paraEstado(JSON.parse(assinatura) as Settings));
  }, [assinatura]);

  function atualiza<C extends keyof Estado>(campo: C, valor: Estado[C]): void {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  }

  async function salvar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setSucesso(null);
    setErroGeral(null);
    setErros({});

    const atual = paraEstado(configuracoes);

    // Só as chaves alteradas são enviadas: a rota entende PATCH parcial e o
    // histórico registra exatamente o que mudou, e não a configuração inteira.
    const patch: Record<string, string | number | boolean> = {};
    for (const [chave, valor] of Object.entries(form) as [
      keyof Estado,
      string | boolean,
    ][]) {
      if (valor === atual[chave]) continue;
      patch[chave] =
        typeof valor === "string" && ehCampoNumerico(chave) ? Number(valor) : valor;
    }

    if (Object.keys(patch).length === 0) {
      setErroGeral(
        "Nenhuma configuração foi alterada. Ajuste algum campo acima antes de salvar.",
      );
      return;
    }

    setSalvando(true);
    try {
      await api.patch("/api/admin/settings", patch);
      setSucesso(
        `Configurações salvas. ${Object.keys(patch).length} ajuste(s) passam a valer para as próximas reservas.`,
      );
      router.refresh();
    } catch (erro) {
      if (erro instanceof ApiError) {
        setErroGeral(erro.message);
        setErros(erro.fieldErrors);
      } else {
        setErroGeral("Não foi possível salvar as configurações. Tente novamente.");
      }
    } finally {
      setSalvando(false);
    }
  }

  const previa = renderTemplate(form.whatsappMessageTemplate, EXEMPLO_WHATSAPP);

  return (
    <form onSubmit={salvar} className="flex flex-col gap-5">
      <Alert tone="info" title="O que muda ao salvar">
        As regras abaixo valem para as <strong>próximas</strong> reservas. Reservas
        já criadas continuam como estão — mudar o limite de recursos, por exemplo,
        não desfaz uma reserva existente. A supervisão continua podendo contornar
        prazos e limites ao criar uma reserva no balcão.
      </Alert>

      <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
        {sucesso && <Alert tone="success">{sucesso}</Alert>}
        {erroGeral && (
          <Alert tone="danger" title="Não foi possível salvar">
            {erroGeral}
          </Alert>
        )}
      </div>

      <Card>
        <CardHeader
          title="Regras de reserva"
          description="Definem o que o professor consegue fazer sozinho, sem passar pela supervisão."
        />
        <CardBody className="flex flex-col gap-5">
          <CheckboxField
            label="Exigir horário inicial e final"
            checked={form.requireTimeRange}
            onChange={(evento) => atualiza("requireTimeRange", evento.target.checked)}
            error={erros.requireTimeRange}
            hint={`Ligado: o professor precisa escolher de que horas a que horas vai usar. Desligado: ele pode reservar o dia inteiro, e o equipamento fica bloqueado o dia todo. ${padrao(padroes.requireTimeRange)}`}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Antecedência mínima (horas)"
              type="number"
              inputMode="numeric"
              min={0}
              max={720}
              step={1}
              value={form.minAdvanceHours}
              error={erros.minAdvanceHours}
              onChange={(evento) => atualiza("minAdvanceHours", evento.target.value)}
              hint={`Quanto tempo antes do início a reserva precisa ser feita. Com 2, uma aula das 10:00 só pode ser reservada até as 08:00. Zero libera reservar para daqui a pouco. Padrão: ${padroes.minAdvanceHours}.`}
            />

            <TextField
              label="Antecedência máxima (dias)"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              step={1}
              value={form.maxAdvanceDays}
              error={erros.maxAdvanceDays}
              onChange={(evento) => atualiza("maxAdvanceDays", evento.target.value)}
              hint={`Até quantos dias à frente dá para agendar. Evita que alguém reserve o carrinho para o semestre inteiro. Padrão: ${padroes.maxAdvanceDays}.`}
            />

            <TextField
              label="Reservas ativas por professor"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              value={form.maxActiveReservationsPerUser}
              error={erros.maxActiveReservationsPerUser}
              onChange={(evento) =>
                atualiza("maxActiveReservationsPerUser", evento.target.value)
              }
              hint={`Quantas reservas em aberto cada professor pode ter ao mesmo tempo. Use 0 para não limitar. Padrão: ${padroes.maxActiveReservationsPerUser}.`}
            />

            <TextField
              label="Recursos por reserva"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              step={1}
              value={form.maxResourcesPerReservation}
              error={erros.maxResourcesPerReservation}
              onChange={(evento) =>
                atualiza("maxResourcesPerReservation", evento.target.value)
              }
              hint={`Quantos kits e notebooks cabem em uma mesma reserva. Padrão: ${padroes.maxResourcesPerReservation}.`}
            />

            <TextField
              label="Abertura"
              type="time"
              value={form.openingTime}
              error={erros.openingTime}
              onChange={(evento) => atualiza("openingTime", evento.target.value)}
              hint={`Reservas com horário só podem começar a partir daqui. Também define as horas usadas no cálculo de uso dos relatórios. Padrão: ${padroes.openingTime}.`}
            />

            <TextField
              label="Fechamento"
              type="time"
              value={form.closingTime}
              error={erros.closingTime}
              onChange={(evento) => atualiza("closingTime", evento.target.value)}
              hint={`Reservas com horário precisam terminar até aqui. Padrão: ${padroes.closingTime}.`}
            />

            <TextField
              label="Prazo de cancelamento (horas)"
              type="number"
              inputMode="numeric"
              min={0}
              max={168}
              step={1}
              value={form.cancellationDeadlineHours}
              error={erros.cancellationDeadlineHours}
              onChange={(evento) =>
                atualiza("cancellationDeadlineHours", evento.target.value)
              }
              hint={`Até quantas horas antes do início o professor cancela sozinho. Depois disso ele precisa procurar a supervisão. Zero permite cancelar até o momento do início. Padrão: ${padroes.cancellationDeadlineHours}.`}
            />
          </div>

          <CheckboxField
            label="Permitir reserva para o mesmo dia"
            checked={form.allowSameDay}
            onChange={(evento) => atualiza("allowSameDay", evento.target.checked)}
            error={erros.allowSameDay}
            hint={`Desligado, o professor só consegue reservar de amanhã em diante — útil quando a preparação dos equipamentos leva um dia. ${padrao(padroes.allowSameDay)}`}
          />

          <CheckboxField
            label="Permitir cancelar depois de a reserva começar"
            checked={form.allowCancelAfterStart}
            onChange={(evento) =>
              atualiza("allowCancelAfterStart", evento.target.checked)
            }
            error={erros.allowCancelAfterStart}
            hint={`Ligado, o professor cancela mesmo com a aula em andamento. Desligado, ele precisa procurar a supervisão para registrar a devolução. ${padrao(padroes.allowCancelAfterStart)}`}
          />

          <CheckboxField
            label="Permitir combinar kit e notebook avulso na mesma reserva"
            checked={form.allowMixedResourceReservation}
            onChange={(evento) =>
              atualiza("allowMixedResourceReservation", evento.target.checked)
            }
            error={erros.allowMixedResourceReservation}
            hint={`Desligado, quem precisa dos dois faz duas reservas separadas. Esta regra também vale para a supervisão. ${padrao(padroes.allowMixedResourceReservation)}`}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Carregadores"
          description="Controla quando uma maleta ou carrinho pode sair sem o conjunto de carregadores completo."
        />
        <CardBody>
          <CheckboxField
            label="Exigir kit de carregadores completo para reservar"
            checked={form.requireCompleteChargerKit}
            onChange={(evento) =>
              atualiza("requireCompleteChargerKit", evento.target.checked)
            }
            error={erros.requireCompleteChargerKit}
            hint={`Ligado, uma maleta ou carrinho com carregador faltando deixa de aparecer como reservável até a reposição — inclusive para a supervisão. ${padrao(padroes.requireCompleteChargerKit)}`}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Contato por WhatsApp"
          description="Quando o equipamento desejado já está reservado, o sistema oferece conversar com quem está com ele."
        />
        <CardBody className="flex flex-col gap-5">
          <CheckboxField
            label="Oferecer contato por WhatsApp em caso de conflito"
            checked={form.whatsappContactEnabled}
            onChange={(evento) =>
              atualiza("whatsappContactEnabled", evento.target.checked)
            }
            error={erros.whatsappContactEnabled}
            hint={`Desligado, ninguém recebe o link de conversa e o sistema apenas informa que o equipamento está ocupado. O telefone do docente nunca é exibido: o sistema abre a conversa já pronta. ${padrao(padroes.whatsappContactEnabled)}`}
          />

          <div className="flex flex-col gap-2">
            <TextAreaField
              label="Modelo da mensagem"
              rows={5}
              value={form.whatsappMessageTemplate}
              error={erros.whatsappMessageTemplate}
              onChange={(evento) =>
                atualiza("whatsappMessageTemplate", evento.target.value)
              }
              hint="Texto que aparece já digitado na conversa. Os marcadores abaixo são trocados pelos dados reais."
            />

            <ul className="flex flex-wrap gap-2">
              {MARCADORES.map((item) => (
                <li
                  key={item.marcador}
                  className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-700"
                >
                  <code className="font-semibold">{item.marcador}</code> ={" "}
                  {item.significado}
                </li>
              ))}
            </ul>

            <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-3">
              <p className="text-xs font-semibold tracking-wide text-sky-900 uppercase">
                Prévia com dados de exemplo
              </p>
              <p className="mt-1 text-sm whitespace-pre-wrap text-sky-950">{previa}</p>
              <p className="mt-2 text-xs text-sky-900">
                Exemplo: {EXEMPLO_WHATSAPP.solicitante} pedindo a{" "}
                {EXEMPLO_WHATSAPP.professor} a {EXEMPLO_WHATSAPP.recurso}.
              </p>
            </div>
          </div>

          <TextAreaField
            label="Texto quando não há contato autorizado"
            rows={3}
            value={form.whatsappUnavailableMessage}
            error={erros.whatsappUnavailableMessage}
            onChange={(evento) =>
              atualiza("whatsappUnavailableMessage", evento.target.value)
            }
            hint="Aparece quando o docente não cadastrou telefone ou não autorizou o contato. Diga o que a pessoa deve fazer em seguida."
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Operação"
          description="Identificação da instituição e rotina de acompanhamento das retiradas."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nome da instituição"
            value={form.institutionName}
            error={erros.institutionName}
            onChange={(evento) => atualiza("institutionName", evento.target.value)}
            hint={`Aparece no cabeçalho do sistema e nos comprovantes de reserva. Padrão: ${padroes.institutionName}.`}
            required
          />

          <TextField
            label="Horas para marcar não comparecimento"
            type="number"
            inputMode="numeric"
            min={0}
            max={72}
            step={1}
            value={form.noShowAfterHours}
            error={erros.noShowAfterHours}
            onChange={(evento) => atualiza("noShowAfterHours", evento.target.value)}
            hint={`Quanto tempo depois do início uma reserva não retirada passa a ser tratada como não comparecimento no acompanhamento da supervisão. Padrão: ${padroes.noShowAfterHours}.`}
          />
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" loading={salvando}>
          Salvar configurações
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={salvando}
          onClick={() => {
            setForm(paraEstado(configuracoes));
            setErros({});
            setErroGeral(null);
            setSucesso(null);
          }}
        >
          Descartar mudanças
        </Button>
      </div>
    </form>
  );
}

/** Texto curto informando o padrão de fábrica de uma opção de ligar/desligar. */
function padrao(valor: boolean): ReactNode {
  return `Padrão: ${valor ? "ligado" : "desligado"}.`;
}
