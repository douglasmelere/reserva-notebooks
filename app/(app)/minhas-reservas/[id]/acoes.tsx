"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { z } from "zod";
import { ApiError, api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { formatDateTimeBR } from "@/lib/datetime";
import {
  closeReservationSchema,
  incidentCategorySchema,
  incidentSeveritySchema,
} from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectField, TextAreaField } from "@/components/ui/field";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Spinner,
} from "@/components/ui/primitives";

/**
 * Ações do professor sobre a própria reserva: cancelar, registrar a devolução
 * e consultar o histórico.
 *
 * A devolução começa por uma pergunta simples ("ocorreu tudo bem?") porque é o
 * caso comum; os campos de ocorrência só aparecem para quem responde que não.
 * Pedir categoria, severidade e descrição de todo mundo faria a maioria pular a
 * devolução — e o equipamento continuaria bloqueado na agenda.
 */

// ---------------------------------------------------------------------------
// Vocabulário das ocorrências
// ---------------------------------------------------------------------------

type Categoria = z.infer<typeof incidentCategorySchema>;
type Severidade = z.infer<typeof incidentSeveritySchema>;

/**
 * Rótulos repetidos do servidor de propósito: `@/server/incidents` carrega
 * banco e armazenamento de anexos, que não podem ir para o pacote do navegador.
 * O `Record` tipado quebra a compilação se um valor do enum ficar sem rótulo.
 */
const CATEGORIA_LABEL: Record<Categoria, string> = {
  HARDWARE: "Hardware",
  CARREGADOR: "Carregador",
  BATERIA: "Bateria",
  TELA: "Tela",
  TECLADO: "Teclado",
  TOUCHPAD: "Touchpad",
  REDE: "Rede / Wi-Fi",
  SISTEMA: "Sistema operacional",
  SOFTWARE: "Software",
  DANO_FISICO: "Dano físico",
  LIMPEZA: "Limpeza",
  ACESSORIO_AUSENTE: "Acessório ausente",
  DEVOLUCAO_INCOMPLETA: "Devolução incompleta",
  NOTEBOOK_FALTANTE: "Notebook faltante",
  CARREGADOR_FALTANTE: "Carregador faltante",
  OUTRO: "Outro",
};

const SEVERIDADE_LABEL: Record<Severidade, string> = {
  BAIXA: "Baixa — dá para usar assim mesmo",
  MEDIA: "Média — atrapalha o uso",
  ALTA: "Alta — o equipamento ficou inutilizável",
  CRITICA: "Crítica — risco de perda ou dano grave",
};

const OPCOES_CATEGORIA = Object.entries(CATEGORIA_LABEL).map(
  ([value, label]) => ({ value, label }),
);
const OPCOES_SEVERIDADE = Object.entries(SEVERIDADE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

/** Campo devolvido pela API → nome que o professor vê na tela. */
const ROTULO_DO_CAMPO: Record<string, string> = {
  notes: "Observações da devolução",
  reason: "Motivo do cancelamento",
  allGood: "Como foi a devolução",
  incident: "Dados do problema",
  "incident.targetType": "O que teve problema",
  "incident.category": "Tipo de problema",
  "incident.severity": "Gravidade",
  "incident.description": "O que aconteceu",
};

/**
 * Nome amigável do campo no resumo de erros. Sem isso, o professor lia só a
 * mensagem solta, sem saber a qual campo ela pertence — e um caminho novo da
 * API apareceria cru, como "incident.targetType".
 */
function rotuloDoCampo(caminho: string): string {
  const direto = ROTULO_DO_CAMPO[caminho];
  if (direto) return direto;
  const base = caminho.split(".")[0] ?? caminho;
  return ROTULO_DO_CAMPO[base] ?? "Dados enviados";
}

/** Item da reserva que pode receber a ocorrência (formato "TIPO" ou "TIPO:id"). */
export type AlvoDeOcorrencia = { valor: string; rotulo: string };

const TIPOS_DE_ALVO = [
  "RESERVATION",
  "KIT",
  "NOTEBOOK",
  "CHARGER_KIT",
] as const;
type TipoDeAlvo = (typeof TIPOS_DE_ALVO)[number];

function ehTipoDeAlvo(valor: string | undefined): valor is TipoDeAlvo {
  return TIPOS_DE_ALVO.some((tipo) => tipo === valor);
}

type RespostaFechamento = {
  incident: { code: string } | null;
  aviso?: string;
};

const CLASSE_LINK_BOTAO =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-slate-500";

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

export function AcoesDaReserva({
  reservationId,
  codigo,
  podeCancelar,
  motivoNaoCancelar,
  podeEncerrar,
  alvos,
}: {
  reservationId: string;
  codigo: string;
  podeCancelar: boolean;
  /** Explicação exibida quando o cancelamento não está mais liberado. */
  motivoNaoCancelar: string | null;
  podeEncerrar: boolean;
  alvos: AlvoDeOcorrencia[];
}) {
  const router = useRouter();

  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [cancelando, setCancelando] = useState(false);

  const [formularioAberto, setFormularioAberto] = useState(false);
  const [tudoBem, setTudoBem] = useState<boolean | null>(null);
  const [alvo, setAlvo] = useState(alvos[0]?.valor ?? "RESERVATION");
  const [categoria, setCategoria] = useState<string>("HARDWARE");
  const [severidade, setSeveridade] = useState<string>("MEDIA");
  const [descricao, setDescricao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [encerrando, setEncerrando] = useState(false);

  const [erro, setErro] = useState<string | null>(null);
  const [errosCampo, setErrosCampo] = useState<Record<string, string[]>>({});
  const [sucesso, setSucesso] = useState<string | null>(null);

  const acoesRef = useRef<HTMLDivElement>(null);
  const formularioRef = useRef<HTMLDivElement>(null);
  const formularioJaAberto = useRef(false);

  // Abrir o formulário tira da tela o próprio botão que estava com o foco, e
  // fechá-lo tira o botão "Voltar": nos dois casos o foco cairia no início da
  // página. Reposicionar mantém quem navega por teclado onde a ação continua.
  useEffect(() => {
    if (formularioAberto) {
      formularioJaAberto.current = true;
      formularioRef.current?.focus();
      return;
    }
    if (formularioJaAberto.current) {
      formularioJaAberto.current = false;
      acoesRef.current?.querySelector("button")?.focus();
    }
  }, [formularioAberto]);

  function tratarErro(falha: unknown, padrao: string) {
    if (falha instanceof ApiError) {
      setErro(falha.message);
      setErrosCampo(falha.fieldErrors);
      return;
    }
    setErro(padrao);
  }

  async function cancelar() {
    setCancelando(true);
    setErro(null);
    setErrosCampo({});
    try {
      await api.post(`/api/reservations/${reservationId}/cancel`, {
        reason: motivo.trim() || null,
      });
      setDialogoAberto(false);
      setMotivo("");
      setSucesso(
        `Reserva ${codigo} cancelada. Os equipamentos já voltaram a aparecer como disponíveis para os outros professores. Se precisar deles de novo, faça uma nova reserva.`,
      );
      router.refresh();
    } catch (falha) {
      setDialogoAberto(false);
      tratarErro(falha, "Não foi possível cancelar a reserva agora.");
    } finally {
      setCancelando(false);
    }
  }

  async function encerrar() {
    setEncerrando(true);
    setErro(null);
    setErrosCampo({});

    // O alvo chega como "TIPO" ou "TIPO:id" para caber num único select; a API
    // espera o tipo e o identificador em campos separados.
    const partes = alvo.split(":");
    const tipoAlvo: TipoDeAlvo = ehTipoDeAlvo(partes[0])
      ? partes[0]
      : "RESERVATION";
    const idAlvo = partes[1];

    const incidente =
      tudoBem === false
        ? {
            targetType: tipoAlvo,
            notebookId: tipoAlvo === "NOTEBOOK" ? (idAlvo ?? null) : null,
            kitId: tipoAlvo === "KIT" ? (idAlvo ?? null) : null,
            chargerKitId: tipoAlvo === "CHARGER_KIT" ? (idAlvo ?? null) : null,
            category: categoria,
            severity: severidade,
            description: descricao,
          }
        : null;

    const validado = closeReservationSchema.safeParse({
      allGood: tudoBem === true,
      notes: observacoes.trim() || null,
      incident: incidente,
    });

    if (!validado.success) {
      const campos: Record<string, string[]> = {};
      for (const problema of validado.error.issues) {
        const chave = problema.path.join(".") || "_";
        (campos[chave] ??= []).push(problema.message);
      }
      setErrosCampo(campos);
      setErro("Verifique os campos destacados antes de enviar.");
      setEncerrando(false);
      return;
    }

    try {
      const resposta = await api.post<RespostaFechamento>(
        `/api/reservations/${reservationId}/close`,
        validado.data,
      );
      setFormularioAberto(false);
      setTudoBem(null);
      setDescricao("");
      setObservacoes("");
      setSucesso(
        [
          `Devolução da reserva ${codigo} registrada.`,
          resposta.incident
            ? `Ocorrência ${resposta.incident.code} aberta para a supervisão — guarde este número para acompanhar o conserto.`
            : null,
          resposta.aviso,
          "Entregue os equipamentos no local combinado; nada mais é necessário aqui no sistema.",
        ]
          .filter(Boolean)
          .join(" "),
      );
      router.refresh();
    } catch (falha) {
      tratarErro(falha, "Não foi possível registrar a devolução agora.");
    } finally {
      setEncerrando(false);
    }
  }

  const nenhumaAcao = !podeCancelar && !podeEncerrar;

  return (
    <Card>
      <CardHeader
        title="O que você quer fazer"
        description="Cancelar libera o equipamento para outra turma. Registrar a devolução encerra a reserva."
      />
      <CardBody className="space-y-4">
        {sucesso && (
          <Alert tone="success" title="Pronto">
            {sucesso}
          </Alert>
        )}

        {erro && (
          <Alert tone="danger" title="Não foi possível concluir">
            {erro}
            {Object.keys(errosCampo).length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {Object.entries(errosCampo).map(([campo, mensagens]) => (
                  <li key={campo}>
                    <strong className="font-semibold">
                      {rotuloDoCampo(campo)}:
                    </strong>{" "}
                    {mensagens.join(" ")}
                  </li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        {nenhumaAcao && !formularioAberto && (
          <p className="text-sm text-slate-600">
            {motivoNaoCancelar ??
              "Esta reserva não aceita mais alterações. Procure a supervisão se precisar de algo."}
          </p>
        )}

        <div ref={acoesRef} className="flex flex-wrap gap-2">
          {podeEncerrar && !formularioAberto && (
            <Button
              onClick={() => {
                setFormularioAberto(true);
                setSucesso(null);
                setErro(null);
              }}
            >
              Registrar devolução
            </Button>
          )}

          {podeCancelar && (
            <Button variant="danger" onClick={() => setDialogoAberto(true)}>
              Cancelar reserva
            </Button>
          )}

          <Link
            href={`/ocorrencias/nova?reserva=${reservationId}`}
            className={CLASSE_LINK_BOTAO}
          >
            Registrar um problema
          </Link>
        </div>

        {!podeCancelar && podeEncerrar && motivoNaoCancelar && (
          <p className="text-sm text-slate-600">{motivoNaoCancelar}</p>
        )}

        {formularioAberto && (
          <FormularioDeDevolucao
            containerRef={formularioRef}
            alvos={alvos}
            tudoBem={tudoBem}
            alvo={alvo}
            categoria={categoria}
            severidade={severidade}
            descricao={descricao}
            observacoes={observacoes}
            errosCampo={errosCampo}
            enviando={encerrando}
            setTudoBem={setTudoBem}
            setAlvo={setAlvo}
            setCategoria={setCategoria}
            setSeveridade={setSeveridade}
            setDescricao={setDescricao}
            setObservacoes={setObservacoes}
            onEnviar={encerrar}
            onFechar={() => {
              setFormularioAberto(false);
              setTudoBem(null);
            }}
          />
        )}
      </CardBody>

      <ConfirmDialog
        open={dialogoAberto}
        title={`Cancelar a reserva ${codigo}?`}
        description="Os equipamentos voltam a ficar disponíveis para outros professores imediatamente. Esta ação não pode ser desfeita — para usar de novo, faça uma nova reserva."
        confirmLabel="Sim, cancelar reserva"
        cancelLabel="Manter reserva"
        loading={cancelando}
        onConfirm={cancelar}
        onCancel={() => setDialogoAberto(false)}
      >
        <TextAreaField
          label="Motivo do cancelamento (opcional)"
          rows={3}
          maxLength={300}
          value={motivo}
          onChange={(evento) => setMotivo(evento.target.value)}
          hint="Ajuda a supervisão a entender a demanda. Ex.: aula adiada."
        />
      </ConfirmDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Formulário de devolução
// ---------------------------------------------------------------------------

function FormularioDeDevolucao({
  containerRef,
  alvos,
  tudoBem,
  alvo,
  categoria,
  severidade,
  descricao,
  observacoes,
  errosCampo,
  enviando,
  setTudoBem,
  setAlvo,
  setCategoria,
  setSeveridade,
  setDescricao,
  setObservacoes,
  onEnviar,
  onFechar,
}: {
  /** Recebe o foco quando o formulário abre. */
  containerRef: RefObject<HTMLDivElement | null>;
  alvos: AlvoDeOcorrencia[];
  tudoBem: boolean | null;
  alvo: string;
  categoria: string;
  severidade: string;
  descricao: string;
  observacoes: string;
  errosCampo: Record<string, string[]>;
  enviando: boolean;
  setTudoBem: (v: boolean) => void;
  setAlvo: (v: string) => void;
  setCategoria: (v: string) => void;
  setSeveridade: (v: string) => void;
  setDescricao: (v: string) => void;
  setObservacoes: (v: string) => void;
  onEnviar: () => void;
  onFechar: () => void;
}) {
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="rounded-lg border border-slate-200 bg-slate-50 p-4 focus:outline-2 focus:outline-offset-2 focus:outline-senai-600"
    >
      <fieldset>
        <legend className="text-sm font-semibold text-slate-900">
          Ocorreu tudo bem com os equipamentos?
        </legend>

        <div className="mt-3 space-y-2">
          <OpcaoDeDevolucao
            marcada={tudoBem === true}
            titulo="Sim, deu tudo certo"
            descricao="Os equipamentos foram devolvidos completos e funcionando."
            onSelecionar={() => setTudoBem(true)}
          />
          <OpcaoDeDevolucao
            marcada={tudoBem === false}
            titulo="Não, quero registrar um problema"
            descricao="Algo quebrou, faltou ou não funcionou. A supervisão é avisada."
            onSelecionar={() => setTudoBem(false)}
          />
        </div>
      </fieldset>

      {tudoBem === false && (
        <div className="mt-4 space-y-4">
          <SelectField
            label="O que teve problema?"
            value={alvo}
            options={alvos.map((item) => ({
              value: item.valor,
              label: item.rotulo,
            }))}
            error={errosCampo["incident.targetType"]}
            onChange={(evento) => setAlvo(evento.target.value)}
            hint="Só é possível registrar problemas nos itens desta reserva."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Tipo de problema"
              value={categoria}
              options={OPCOES_CATEGORIA}
              error={errosCampo["incident.category"]}
              onChange={(evento) => setCategoria(evento.target.value)}
            />
            <SelectField
              label="Gravidade"
              value={severidade}
              options={OPCOES_SEVERIDADE}
              error={errosCampo["incident.severity"]}
              onChange={(evento) => setSeveridade(evento.target.value)}
            />
          </div>
          <TextAreaField
            label="O que aconteceu?"
            required
            rows={4}
            maxLength={2000}
            value={descricao}
            error={errosCampo["incident.description"]}
            onChange={(evento) => setDescricao(evento.target.value)}
            placeholder="Ex.: o notebook 12 não liga mesmo ligado na tomada."
            hint="Descreva com pelo menos 5 caracteres. Quanto mais concreto, mais rápido o conserto."
          />
        </div>
      )}

      {tudoBem !== null && (
        <div className="mt-4 space-y-4">
          <TextAreaField
            label="Observações da devolução (opcional)"
            rows={2}
            maxLength={500}
            value={observacoes}
            error={errosCampo.notes}
            onChange={(evento) => setObservacoes(evento.target.value)}
          />

          {/* Encerrar a reserva não tem volta pelo sistema; dizer isso antes do
              clique evita a confirmação extra num formulário já longo. */}
          <Alert tone="warning">
            Ao confirmar, a reserva é encerrada e os equipamentos voltam para a
            agenda. Não é possível desfazer pelo sistema — se errar algo, procure
            a supervisão.
          </Alert>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={onEnviar} loading={enviando}>
              Confirmar devolução
            </Button>
            <Button variant="ghost" onClick={onFechar} disabled={enviando}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function OpcaoDeDevolucao({
  marcada,
  titulo,
  descricao,
  onSelecionar,
}: {
  marcada: boolean;
  titulo: string;
  descricao: string;
  onSelecionar: () => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer gap-3 rounded-lg border bg-white p-3 transition-colors",
        marcada
          ? "border-senai-600 ring-1 ring-senai-600"
          : "border-slate-300 hover:border-slate-400",
      )}
    >
      <input
        type="radio"
        name="devolucao-tudo-bem"
        checked={marcada}
        onChange={onSelecionar}
        className="mt-0.5 size-5 shrink-0 border-slate-300 text-senai-700 focus:outline-2 focus:outline-offset-2 focus:outline-senai-600"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-900">
          {titulo}
        </span>
        <span className="mt-0.5 block text-sm text-slate-600">{descricao}</span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

type ItemDeHistorico = {
  id: string;
  action: string;
  summary: string | null;
  createdAt: string;
  actor: { id: string; fullName: string; username: string } | null;
};

const ACAO_LABEL: Record<string, string> = {
  "reserva.criar": "Reserva criada",
  "reserva.atualizar": "Reserva atualizada",
  "reserva.cancelar": "Reserva cancelada",
  "reserva.encerrar": "Devolução registrada",
  "reserva.contato_whatsapp": "Contato por WhatsApp solicitado",
};

/**
 * Descrição da ação no histórico.
 *
 * O mapa cobre as ações que a API registra hoje; se uma nova entrar antes de
 * ganhar rótulo, o professor lê "Reserva atualizada" em vez da chave crua
 * `reserva.alguma_coisa`.
 */
function rotuloDaAcao(acao: string): string {
  return ACAO_LABEL[acao] ?? "Reserva atualizada";
}

/**
 * Histórico em seção recolhível.
 *
 * A busca só acontece quando o professor abre a seção: na maioria das visitas
 * ele quer o código e o horário, não a trilha de auditoria — e a tela de
 * detalhe carrega mais rápido sem essa consulta.
 */
export function HistoricoDaReserva({
  reservationId,
  timeZone,
}: {
  reservationId: string;
  /** Fuso da instituição: o navegador do professor pode estar em outro. */
  timeZone: string;
}) {
  const [itens, setItens] = useState<ItemDeHistorico[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await api.get<{ items: ItemDeHistorico[] }>(
        `/api/reservations/${reservationId}/history`,
      );
      setItens(resposta.items);
    } catch (falha) {
      setErro(
        falha instanceof ApiError
          ? falha.message
          : "Não foi possível carregar o histórico agora.",
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    <Card>
      <details
        onToggle={(evento) => {
          if (evento.currentTarget.open && itens === null && !carregando) {
            void carregar();
          }
        }}
      >
        {/* O título vai dentro do `summary` como h2: assim ele entra na lista de
            cabeçalhos junto com os outros cartões da página, em vez de ser só um
            texto em negrito. */}
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold text-slate-900">
            Histórico da reserva
          </h2>
          <span aria-hidden="true" className="text-sm text-slate-500">
            ver
          </span>
        </summary>

        <div
          aria-busy={carregando}
          className="border-t border-slate-200 px-4 py-4 sm:px-5"
        >
          {/* Só a linha de situação é região viva: marcar a lista inteira faria
              o leitor de tela recitar todos os registros ao abrir a seção. */}
          <p aria-live="polite" className="sr-only">
            {carregando
              ? "Carregando o histórico da reserva."
              : erro
                ? "Não foi possível carregar o histórico."
                : itens !== null
                  ? `Histórico carregado com ${itens.length} registro(s).`
                  : ""}
          </p>

          {carregando && <Spinner label="Carregando o histórico..." />}

          {erro && (
            <Alert tone="danger" title="Falha ao carregar">
              {erro} Feche e abra a seção para tentar de novo.
            </Alert>
          )}

          {itens !== null && itens.length === 0 && (
            <p className="text-sm text-slate-600">
              Nenhum registro no histórico ainda.
            </p>
          )}

          {itens !== null && itens.length > 0 && (
            <ol className="space-y-3">
              {itens.map((item) => (
                <li
                  key={item.id}
                  className="border-l-2 border-slate-200 pl-3 text-sm"
                >
                  <p className="font-medium text-slate-900">
                    {rotuloDaAcao(item.action)}
                  </p>
                  {item.summary && (
                    <p className="mt-0.5 text-slate-600">{item.summary}</p>
                  )}
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.actor ? item.actor.fullName : "Sistema"} ·{" "}
                    {formatDateTimeBR(new Date(item.createdAt), timeZone)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </details>
    </Card>
  );
}
