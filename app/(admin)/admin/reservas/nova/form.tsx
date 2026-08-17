"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/ui/field";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  type BadgeTone,
} from "@/components/ui/primitives";
import { ApiError, api } from "@/lib/api-client";
import { createReservationSchema } from "@/lib/validation";

/**
 * Formulário de reserva da supervisão.
 *
 * Valida com o mesmo esquema Zod da API: o erro aparece antes de a requisição
 * sair, e a rota revalida tudo do outro lado assim mesmo. Conflito de recurso é
 * tratado como informação, e não como falha genérica — a tela mostra quem está
 * com o equipamento para que a conversa aconteça.
 */

export type OpcaoRecurso = {
  id: string;
  nome: string;
  detalhe: string;
  statusLabel: string;
  tom: BadgeTone;
  reservavel: boolean;
  carregadoresCompletos?: boolean | null;
};

export type Politicas = {
  requireTimeRange: boolean;
  minAdvanceHours: number;
  maxAdvanceDays: number;
  allowSameDay: boolean;
  maxActiveReservationsPerUser: number;
  maxResourcesPerReservation: number;
  openingTime: string;
  closingTime: string;
  allowMixedResourceReservation: boolean;
  requireCompleteChargerKit: boolean;
};

type Conflito = {
  resourceLabel: string;
  reservationId: string;
  reservationCode: string;
  periodoFormatado: string;
  room: string | null;
  holder: { fullName: string };
};

/** `detalhes.conflitos` chega como `unknown`; só exibimos o que reconhecemos. */
function extraiConflitos(detalhes: unknown): Conflito[] {
  if (typeof detalhes !== "object" || detalhes === null) return [];
  const lista = (detalhes as { conflitos?: unknown }).conflitos;
  if (!Array.isArray(lista)) return [];

  return lista.flatMap((item): Conflito[] => {
    if (typeof item !== "object" || item === null) return [];
    const bruto = item as Record<string, unknown>;
    const dono = bruto.holder as { fullName?: unknown } | undefined;
    return [
      {
        resourceLabel: String(bruto.resourceLabel ?? "Equipamento"),
        reservationId: String(bruto.reservationId ?? ""),
        reservationCode: String(bruto.reservationCode ?? "—"),
        periodoFormatado: String(bruto.periodoFormatado ?? ""),
        room: typeof bruto.room === "string" ? bruto.room : null,
        holder: { fullName: String(dono?.fullName ?? "professor(a)") },
      },
    ];
  });
}

type Estado = {
  userId: string;
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
  status: "SOLICITADA" | "CONFIRMADA";
};

export function FormularioDeReserva({
  hoje,
  professores,
  kits,
  notebooks,
  politicas,
}: {
  hoje: string;
  professores: { id: string; nome: string; departamento: string | null }[];
  kits: OpcaoRecurso[];
  notebooks: OpcaoRecurso[];
  politicas: Politicas;
}) {
  const router = useRouter();

  const [form, setForm] = useState<Estado>({
    userId: "",
    date: hoje,
    diaInteiro: !politicas.requireTimeRange,
    startTime: politicas.openingTime,
    endTime: politicas.closingTime,
    kitIds: [],
    notebookIds: [],
    purpose: "",
    className: "",
    subject: "",
    room: "",
    requestedNotebooks: "",
    teacherNotes: "",
    supervisorNotes: "",
    status: "CONFIRMADA",
  });

  const [enviando, setEnviando] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  const [sucesso, setSucesso] = useState<string | null>(null);

  const totalSelecionado = form.kitIds.length + form.notebookIds.length;

  const professorEscolhido = useMemo(
    () => professores.find((professor) => professor.id === form.userId) ?? null,
    [professores, form.userId],
  );

  function atualiza<C extends keyof Estado>(campo: C, valor: Estado[C]): void {
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

  async function enviar(evento: FormEvent<HTMLFormElement>): Promise<void> {
    evento.preventDefault();
    setErroGeral(null);
    setErros({});
    setConflitos([]);
    setSucesso(null);

    const bruto = {
      userId: form.userId,
      date: form.date,
      startTime: form.diaInteiro ? null : form.startTime,
      endTime: form.diaInteiro ? null : form.endTime,
      kitIds: form.kitIds,
      notebookIds: form.notebookIds,
      purpose: form.purpose,
      className: form.className,
      subject: form.subject,
      room: form.room,
      requestedNotebooks: form.requestedNotebooks
        ? Number(form.requestedNotebooks)
        : null,
      teacherNotes: form.teacherNotes,
      supervisorNotes: form.supervisorNotes,
      status: form.status,
    };

    if (!form.userId) {
      setErros({ userId: ["Escolha o professor responsável pela reserva."] });
      setErroGeral("Verifique os dados destacados abaixo.");
      return;
    }

    const validado = createReservationSchema.safeParse(bruto);
    if (!validado.success) {
      const porCampo: Record<string, string[]> = {};
      for (const problema of validado.error.issues) {
        const chave = problema.path.join(".") || "_";
        (porCampo[chave] ??= []).push(problema.message);
      }
      setErros(porCampo);
      setErroGeral("Verifique os dados destacados abaixo.");
      return;
    }

    setEnviando(true);
    // A navegação para o detalhe é assíncrona: se o botão voltasse a ficar
    // ativo aqui, um segundo clique durante a troca de página criaria uma
    // reserva duplicada. Só reabilitamos quando a criação falha.
    let criou = false;
    try {
      const criada = await api.post<{ id: string; code: string }>(
        "/api/reservations",
        validado.data,
      );
      criou = true;
      setSucesso(
        `Reserva ${criada.code} criada para ${professorEscolhido?.nome ?? "o professor"}. Abrindo os detalhes...`,
      );
      router.push(`/admin/reservas/${criada.id}`);
      router.refresh();
    } catch (erro) {
      if (erro instanceof ApiError) {
        setErroGeral(erro.message);
        setErros(erro.fieldErrors);
        if (erro.code === "CONFLITO_RESERVA") {
          setConflitos(extraiConflitos(erro.details));
        }
      } else {
        setErroGeral("Não foi possível criar a reserva. Tente novamente.");
      }
    } finally {
      if (!criou) setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-5">
      <Alert tone="warning" title="Esta reserva não passa pelas regras do professor">
        <ul className="ml-4 list-disc space-y-1">
          <li>
            Antecedência mínima ({politicas.minAdvanceHours} h) e máxima (
            {politicas.maxAdvanceDays} dias) <strong>não</strong> se aplicam.
          </li>
          <li>
            Reserva para hoje é permitida{" "}
            {politicas.allowSameDay
              ? "(e também já é permitida aos professores)."
              : "mesmo com o mesmo dia bloqueado para os professores."}
          </li>
          <li>
            O horário de funcionamento ({politicas.openingTime} às{" "}
            {politicas.closingTime}) e a exigência de informar horário podem ser
            ultrapassados.
          </li>
          <li>
            O limite de reservas ativas por professor (
            {politicas.maxActiveReservationsPerUser === 0
              ? "sem limite configurado"
              : `${politicas.maxActiveReservationsPerUser} em aberto`}
            ) e o de {politicas.maxResourcesPerReservation} recurso(s) por reserva
            não bloqueiam a supervisão.
          </li>
        </ul>
        <p className="mt-2">
          Continuam valendo: conflito com outra reserva no mesmo período,
          equipamento em manutenção ou indisponível
          {politicas.requireCompleteChargerKit
            ? ", kit de carregadores incompleto"
            : ""}
          {politicas.allowMixedResourceReservation
            ? ""
            : " e a proibição de misturar kit com notebook avulso"}
          .
        </p>
      </Alert>

      <div aria-live="polite" className="flex flex-col gap-3 empty:hidden">
        {sucesso && <Alert tone="success">{sucesso}</Alert>}
        {erroGeral && (
          <Alert tone="danger" title="Não foi possível criar a reserva">
            {erroGeral}
          </Alert>
        )}
        {conflitos.length > 0 && (
          <Alert tone="warning" title="Equipamento já reservado neste período">
            <ul className="mt-1 flex flex-col gap-2">
              {conflitos.map((conflito) => (
                <li key={`${conflito.reservationId}-${conflito.resourceLabel}`}>
                  <span className="font-medium">{conflito.resourceLabel}</span> está
                  com {conflito.holder.fullName} na reserva {conflito.reservationCode}{" "}
                  ({conflito.periodoFormatado}
                  {conflito.room ? `, sala ${conflito.room}` : ""}).{" "}
                  {conflito.reservationId && (
                    <a
                      className="font-semibold underline underline-offset-2"
                      href={`/admin/reservas/${conflito.reservationId}`}
                    >
                      Abrir reserva
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Escolha outro período, outro equipamento ou ajuste a reserva existente.
            </p>
          </Alert>
        )}
      </div>

      <Card>
        <CardHeader
          title="Professor e período"
          description="A reserva fica registrada no nome do professor escolhido; a autoria da criação fica na auditoria."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Professor responsável"
            required
            placeholder="Selecione o professor"
            value={form.userId}
            error={erros.userId}
            options={professores.map((professor) => ({
              value: professor.id,
              label: professor.departamento
                ? `${professor.nome} — ${professor.departamento}`
                : professor.nome,
            }))}
            onChange={(evento) => atualiza("userId", evento.target.value)}
            hint="Somente contas ativas podem receber reservas."
          />

          <SelectField
            label="Situação inicial"
            value={form.status}
            error={erros.status}
            options={[
              { value: "CONFIRMADA", label: "Confirmada (pronta para retirada)" },
              { value: "SOLICITADA", label: "Solicitada (aguardando confirmação)" },
            ]}
            onChange={(evento) =>
              atualiza("status", evento.target.value === "SOLICITADA" ? "SOLICITADA" : "CONFIRMADA")
            }
            hint="Nos dois casos o equipamento já fica reservado no período."
          />

          <TextField
            label="Data"
            type="date"
            required
            value={form.date}
            error={erros.date}
            onChange={(evento) => atualiza("date", evento.target.value)}
            hint="Datas passadas são aceitas apenas para registro pela supervisão."
          />

          <div className="flex items-end pb-2">
            <CheckboxField
              label="Reserva de dia inteiro"
              checked={form.diaInteiro}
              onChange={(evento) => atualiza("diaInteiro", evento.target.checked)}
              hint="Ocupa o equipamento das 00:00 às 24:00 do dia escolhido."
            />
          </div>

          {!form.diaInteiro && (
            <>
              <TextField
                label="Horário inicial"
                type="time"
                required
                value={form.startTime}
                error={erros.startTime}
                onChange={(evento) => atualiza("startTime", evento.target.value)}
              />
              <TextField
                label="Horário final"
                type="time"
                required
                value={form.endTime}
                error={erros.endTime}
                onChange={(evento) => atualiza("endTime", evento.target.value)}
              />
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Equipamentos"
          description={`Selecionados: ${totalSelecionado}. Itens em manutenção ou indisponíveis não podem ser reservados nem pela supervisão.`}
        />
        <CardBody className="flex flex-col gap-5">
          <ListaDeRecursos
            titulo="Maletas e carrinhos"
            vazio="Nenhum kit cadastrado. Cadastre em Kits e carrinhos antes de reservar."
            opcoes={kits}
            selecionados={form.kitIds}
            aoAlternar={(id, marcado) => alternaRecurso("kitIds", id, marcado)}
            avisoCarregadores={politicas.requireCompleteChargerKit}
            erro={erros.kitIds}
          />

          <ListaDeRecursos
            titulo="Notebooks"
            vazio="Nenhum notebook cadastrado. Cadastre em Notebooks antes de reservar."
            opcoes={notebooks}
            selecionados={form.notebookIds}
            aoAlternar={(id, marcado) => alternaRecurso("notebookIds", id, marcado)}
            avisoCarregadores={false}
            erro={erros.notebookIds}
          />

          <TextField
            label="Notebooks necessários do kit"
            type="number"
            inputMode="numeric"
            min={1}
            max={200}
            value={form.requestedNotebooks}
            error={erros.requestedNotebooks}
            onChange={(evento) => atualiza("requestedNotebooks", evento.target.value)}
            hint="Opcional. Informativo para quem entrega o kit — não reserva notebooks separados."
            className="max-w-xs"
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Dados da aula"
          description="Ajudam a identificar a reserva no balcão e nos relatórios."
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Sala"
            value={form.room}
            error={erros.room}
            onChange={(evento) => atualiza("room", evento.target.value)}
            placeholder="Ex.: Sala 12"
          />
          <TextField
            label="Turma"
            value={form.className}
            error={erros.className}
            onChange={(evento) => atualiza("className", evento.target.value)}
            placeholder="Ex.: 3º ano B"
          />
          <TextField
            label="Disciplina"
            value={form.subject}
            error={erros.subject}
            onChange={(evento) => atualiza("subject", evento.target.value)}
            placeholder="Ex.: Matemática"
          />
          <TextField
            label="Finalidade"
            value={form.purpose}
            error={erros.purpose}
            onChange={(evento) => atualiza("purpose", evento.target.value)}
            placeholder="Ex.: Simulado on-line"
          />
          <TextAreaField
            label="Observações do professor"
            value={form.teacherNotes}
            error={erros.teacherNotes}
            onChange={(evento) => atualiza("teacherNotes", evento.target.value)}
            hint="O que o professor pediu ou combinou."
            className="sm:col-span-2"
          />
          <TextAreaField
            label="Observações da supervisão"
            value={form.supervisorNotes}
            error={erros.supervisorNotes}
            onChange={(evento) => atualiza("supervisorNotes", evento.target.value)}
            hint="Visível para a supervisão no detalhe da reserva. Registre aqui o motivo da exceção, se houver."
            className="sm:col-span-2"
          />
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={enviando} size="lg">
          Criar reserva
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={enviando}
          onClick={() => router.push("/admin/reservas")}
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}

/**
 * Lista de seleção de equipamentos.
 *
 * Exportada porque a tela de gestão da reserva edita exatamente os mesmos
 * recursos; manter duas listas iguais garantiria que uma delas envelhecesse.
 */
export function ListaDeRecursos({
  titulo,
  vazio,
  opcoes,
  selecionados,
  aoAlternar,
  avisoCarregadores,
  erro,
}: {
  titulo: string;
  vazio: string;
  opcoes: OpcaoRecurso[];
  selecionados: string[];
  aoAlternar: (id: string, marcado: boolean) => void;
  avisoCarregadores: boolean;
  /**
   * Erro que a API (ou a validação) devolveu para esta lista. Sem isto, uma
   * recusa em `kitIds`/`notebookIds` ficaria só no `fieldErrors` e a tela
   * mostraria "verifique os dados" sem destacar nada.
   */
  erro?: string | string[] | null;
}) {
  const erroId = useId();
  const textoDoErro = Array.isArray(erro) ? erro.join(" ") : erro;

  if (opcoes.length === 0) {
    return (
      <fieldset>
        <legend className="pb-2 text-sm font-medium text-slate-700">{titulo}</legend>
        <EmptyState title="Nada cadastrado por aqui" description={vazio} />
      </fieldset>
    );
  }

  return (
    <fieldset aria-describedby={textoDoErro ? erroId : undefined}>
      <legend className="pb-2 text-sm font-medium text-slate-700">{titulo}</legend>
      {textoDoErro && (
        <p id={erroId} className="pb-2 text-sm font-medium text-red-700">
          {textoDoErro}
        </p>
      )}
      <ul
        className={
          textoDoErro
            ? "max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-red-500"
            : "max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200"
        }
      >
        {opcoes.map((opcao) => {
          const bloqueadoPorCarregador =
            avisoCarregadores && opcao.carregadoresCompletos === false;
          const desabilitado = !opcao.reservavel || bloqueadoPorCarregador;

          return (
            <li key={opcao.id}>
              <label
                className={
                  desabilitado
                    ? "flex min-h-11 cursor-not-allowed items-start gap-3 p-3 opacity-70"
                    : "flex min-h-11 cursor-pointer items-start gap-3 p-3 hover:bg-slate-50"
                }
              >
                <input
                  type="checkbox"
                  checked={selecionados.includes(opcao.id)}
                  disabled={desabilitado}
                  onChange={(evento) => aoAlternar(opcao.id, evento.target.checked)}
                  className="mt-0.5 size-5 shrink-0 rounded border-slate-300 text-sky-700 focus:outline-2 focus:outline-offset-2 focus:outline-sky-600"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">
                      {opcao.nome}
                    </span>
                    <Badge tone={opcao.tom}>{opcao.statusLabel}</Badge>
                  </span>
                  <span className="block text-xs text-slate-500">{opcao.detalhe}</span>
                  {bloqueadoPorCarregador && (
                    <span className="block text-xs font-medium text-amber-800">
                      Kit de carregadores incompleto e a configuração atual exige kit
                      completo.
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
