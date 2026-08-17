"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError, api, queryString } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { createReservationSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  TextAreaField,
  TextField,
} from "@/components/ui/field";
import {
  Alert,
  Badge,
  Card,
  CardBody,
  EmptyState,
  Spinner,
} from "@/components/ui/primitives";
import { IndicadorDeEtapas, etapaPorNumero } from "./etapas";
import type {
  AvailabilityResult,
  KitAvailability,
  NotebookAvailability,
} from "@/server/availability";

/**
 * Assistente de reserva em etapas.
 *
 * Uma decisão por tela: o professor costuma abrir esta página no celular, entre
 * uma aula e outra, e um formulário único com data, horário, equipamentos e
 * dados da aula é longo demais para ser preenchido nessa situação. Dividir em
 * etapas também permite validar cada escolha antes de gastar o tempo da
 * próxima — em especial a etapa 4, que só faz sentido depois de o período estar
 * definido.
 *
 * A disponibilidade mostrada aqui é sempre uma fotografia: entre a consulta e a
 * confirmação outra pessoa pode reservar o mesmo equipamento. Por isso o erro
 * de conflito (409) não é tratado como falha genérica — ele tem tela própria,
 * com quem está no equipamento e o caminho para conversar.
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type ConfigReserva = {
  /** Primeira data selecionável (hoje, ou amanhã quando o mesmo dia é vetado). */
  dataMinima: string;
  dataMaxima: string;
  hoje: string;
  requireTimeRange: boolean;
  openingTime: string;
  closingTime: string;
  minAdvanceHours: number;
  maxResourcesPerReservation: number;
  allowMixedResourceReservation: boolean;
  whatsappContactEnabled: boolean;
};

type TipoRecurso = "kit" | "notebooks" | "ambos";

type ItemReservado = {
  id: string;
  kit: { id: string; code: string; name: string } | null;
  notebook: { id: string; assetTag: string; nickname: string | null } | null;
};

type ReservaCriada = {
  id: string;
  code: string;
  room: string | null;
  purpose: string | null;
  className: string | null;
  subject: string | null;
  requestedNotebooks: number | null;
  items: ItemReservado[];
};

/** Conflito devolvido em `detalhes.conflitos` quando a API responde 409. */
type Conflito = {
  resourceKey: string;
  resourceLabel: string;
  reservationId: string;
  periodoFormatado: string;
  holderNome: string;
  whatsappDisponivel: boolean;
};

// ---------------------------------------------------------------------------
// Auxiliares puros
// ---------------------------------------------------------------------------

/** "2026-08-17" → "17/08/2026". Sem fuso: é só reordenar o texto. */
function dataBR(valor: string): string {
  const [ano, mes, dia] = valor.split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor;
}

function periodoTexto(
  data: string,
  diaInteiro: boolean,
  inicio: string,
  fim: string,
): string {
  if (!data) return "Período não definido";
  if (diaInteiro) return `${dataBR(data)} (dia inteiro)`;
  return `${dataBR(data)}, das ${inicio} às ${fim}`;
}

/**
 * Lê os conflitos do corpo do erro sem confiar no formato.
 * O 409 também pode vir da rede de segurança do banco, que não traz detalhes.
 */
function extrairConflitos(detalhes: unknown): Conflito[] {
  if (typeof detalhes !== "object" || detalhes === null) return [];
  const lista = (detalhes as { conflitos?: unknown }).conflitos;
  if (!Array.isArray(lista)) return [];

  const saida: Conflito[] = [];
  for (const bruto of lista) {
    if (typeof bruto !== "object" || bruto === null) continue;
    const item = bruto as Record<string, unknown>;
    const holder =
      typeof item.holder === "object" && item.holder !== null
        ? (item.holder as Record<string, unknown>)
        : {};

    saida.push({
      resourceKey: typeof item.resourceKey === "string" ? item.resourceKey : "",
      resourceLabel:
        typeof item.resourceLabel === "string"
          ? item.resourceLabel
          : "Equipamento",
      reservationId:
        typeof item.reservationId === "string" ? item.reservationId : "",
      periodoFormatado:
        typeof item.periodoFormatado === "string" ? item.periodoFormatado : "",
      holderNome:
        typeof holder.fullName === "string"
          ? holder.fullName
          : "outro(a) docente",
      whatsappDisponivel: holder.whatsappDisponivel === true,
    });
  }
  return saida;
}

function rotuloKit(kit: KitAvailability): string {
  return `${kit.name} (${kit.code})`;
}

function rotuloNotebook(notebook: NotebookAvailability): string {
  return notebook.nickname
    ? `Notebook ${notebook.assetTag} — ${notebook.nickname}`
    : `Notebook ${notebook.assetTag}`;
}

/** Nome do campo na API → nome que o professor vê na tela. */
const ROTULO_DO_CAMPO: Record<string, string> = {
  _: "Dados da reserva",
  date: "Data",
  startTime: "Horário de início",
  endTime: "Horário de término",
  kitIds: "Equipamentos",
  notebookIds: "Equipamentos",
  purpose: "Finalidade",
  className: "Turma",
  subject: "Disciplina",
  room: "Sala",
  requestedNotebooks: "Quantidade de notebooks",
  teacherNotes: "Observações",
};

/**
 * Rótulo do campo para o resumo de erros.
 *
 * Caminhos com índice ("kitIds.0") caem no rótulo da lista, e uma chave que a
 * API venha a criar sem rótulo aqui vira um texto genérico — o professor nunca
 * lê o nome interno do campo.
 */
function rotuloDoCampo(caminho: string): string {
  const direto = ROTULO_DO_CAMPO[caminho];
  if (direto) return direto;
  const base = caminho.split(".")[0] ?? caminho;
  return ROTULO_DO_CAMPO[base] ?? "Dados da reserva";
}

const CLASSE_LINK_BOTAO =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2";

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function AssistenteDeReserva({ config }: { config: ConfigReserva }) {
  const [etapa, setEtapa] = useState(1);
  const [maiorLiberada, setMaiorLiberada] = useState(1);

  // Etapas 1 e 2 — período
  const [data, setData] = useState(config.dataMinima);
  const [diaInteiro, setDiaInteiro] = useState(!config.requireTimeRange);
  const [horaInicio, setHoraInicio] = useState("");
  const [horaFim, setHoraFim] = useState("");

  // Etapa 3 — tipo de recurso
  const [tipo, setTipo] = useState<TipoRecurso | null>(null);

  // Etapa 4 — equipamentos
  const [disponibilidade, setDisponibilidade] =
    useState<AvailabilityResult | null>(null);
  const [carregandoDisp, setCarregandoDisp] = useState(false);
  const [erroDisp, setErroDisp] = useState<string | null>(null);
  const [kitsSelecionados, setKitsSelecionados] = useState<string[]>([]);
  const [notebooksSelecionados, setNotebooksSelecionados] = useState<string[]>(
    [],
  );

  // Etapa 5 — dados da aula
  const [finalidade, setFinalidade] = useState("");
  const [turma, setTurma] = useState("");
  const [disciplina, setDisciplina] = useState("");
  const [sala, setSala] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [observacoes, setObservacoes] = useState("");

  // Etapas 7 e 8 — envio
  const [enviando, setEnviando] = useState(false);
  const [erroEtapa, setErroEtapa] = useState<string | null>(null);
  const [errosCampo, setErrosCampo] = useState<Record<string, string[]>>({});
  const [conflitos, setConflitos] = useState<Conflito[] | null>(null);
  const [comprovante, setComprovante] = useState<ReservaCriada | null>(null);
  /** Explica, na etapa 4, por que o professor foi trazido de volta para cá. */
  const [avisoRecursos, setAvisoRecursos] = useState<string | null>(null);

  const tituloRef = useRef<HTMLHeadingElement>(null);
  const primeiraRenderizacao = useRef(true);
  /** Período já consultado, para não repetir a busca a cada renderização. */
  const periodoConsultado = useRef<string | null>(null);

  // Mover o foco para o título a cada troca de etapa: sem isso, quem navega por
  // teclado ou leitor de tela continua no botão "Continuar" da etapa anterior e
  // não percebe que o conteúdo mudou.
  useEffect(() => {
    if (primeiraRenderizacao.current) {
      primeiraRenderizacao.current = false;
      return;
    }
    tituloRef.current?.focus();
  }, [etapa]);

  const chaveDoPeriodo = `${data}|${diaInteiro ? "dia-inteiro" : `${horaInicio}-${horaFim}`}`;

  const totalSelecionado = kitsSelecionados.length + notebooksSelecionados.length;
  const limiteAtingido =
    totalSelecionado >= config.maxResourcesPerReservation;

  const kitsEscolhidos = (disponibilidade?.kits ?? []).filter((kit) =>
    kitsSelecionados.includes(kit.id),
  );
  const notebooksEscolhidos = (disponibilidade?.notebooks ?? []).filter(
    (notebook) => notebooksSelecionados.includes(notebook.id),
  );

  const periodoFormatado =
    disponibilidade?.periodo.formatado ??
    periodoTexto(data, diaInteiro, horaInicio, horaFim);

  // --- Mudanças que invalidam escolhas posteriores -------------------------

  /**
   * Trocar data ou horário muda a pergunta "o que está livre?", então as
   * seleções anteriores deixam de valer. Limpar aqui evita reservar um
   * equipamento escolhido para outro período.
   *
   * Quando havia algo selecionado, a etapa 4 explica por que a lista voltou
   * vazia — sem o aviso, o professor acha que o sistema perdeu a escolha dele.
   */
  function limparSelecoes() {
    setAvisoRecursos(
      totalSelecionado > 0
        ? "Você mudou a data ou o horário, então a seleção anterior foi desfeita: o que está livre muda de um período para outro. Escolha os equipamentos novamente nesta etapa."
        : null,
    );
    setKitsSelecionados([]);
    setNotebooksSelecionados([]);
    setDisponibilidade(null);
    setConflitos(null);
  }

  function alterarData(valor: string) {
    setData(valor);
    limparSelecoes();
  }

  function alterarHorario(inicio: string, fim: string) {
    setHoraInicio(inicio);
    setHoraFim(fim);
    limparSelecoes();
  }

  /**
   * Estreitar o tipo descarta o que não cabe mais na reserva. Como o descarte
   * acontece uma etapa antes da lista, o aviso espera o professor na etapa 4 —
   * senão ele volta e encontra a seleção menor sem entender o porquê.
   */
  function alterarTipo(valor: TipoRecurso) {
    setTipo(valor);
    const perdeNotebooks = valor === "kit" && notebooksSelecionados.length > 0;
    const perdeKits = valor === "notebooks" && kitsSelecionados.length > 0;

    if (valor === "kit") setNotebooksSelecionados([]);
    if (valor === "notebooks") setKitsSelecionados([]);

    if (perdeNotebooks) {
      setAvisoRecursos(
        "Você escolheu apenas kit completo, então os notebooks avulsos saíram da seleção. Escolha aqui a maleta ou o carrinho desta reserva.",
      );
    } else if (perdeKits) {
      setAvisoRecursos(
        "Você escolheu apenas notebooks avulsos, então a maleta ou o carrinho saiu da seleção. Escolha aqui os notebooks desta reserva.",
      );
    }
  }

  // --- Disponibilidade -----------------------------------------------------

  async function carregarDisponibilidade() {
    setCarregandoDisp(true);
    setErroDisp(null);
    try {
      const consulta = queryString({
        date: data,
        startTime: diaInteiro ? undefined : horaInicio,
        endTime: diaInteiro ? undefined : horaFim,
      });
      const resultado = await api.get<AvailabilityResult>(
        `/api/availability${consulta}`,
      );
      setDisponibilidade(resultado);

      // Um equipamento pode ter sido ocupado desde a última consulta; manter a
      // seleção antiga daria a impressão de que ele continua reservável.
      setKitsSelecionados((atual) =>
        atual.filter((id) =>
          resultado.kits.some(
            (kit) => kit.id === id && kit.state === "DISPONIVEL",
          ),
        ),
      );
      setNotebooksSelecionados((atual) =>
        atual.filter((id) =>
          resultado.notebooks.some(
            (notebook) =>
              notebook.id === id && notebook.state === "DISPONIVEL",
          ),
        ),
      );
    } catch (erro) {
      setErroDisp(
        erro instanceof ApiError
          ? erro.message
          : "Não foi possível consultar a disponibilidade. Verifique a conexão e tente de novo.",
      );
    } finally {
      setCarregandoDisp(false);
    }
  }

  // --- Navegação entre etapas ---------------------------------------------

  function irPara(numero: number) {
    setErroEtapa(null);
    setEtapa(numero);
    setMaiorLiberada((maior) => Math.max(maior, numero));
  }

  /** Mensagem de bloqueio da etapa atual, ou `null` quando pode avançar. */
  function validarEtapa(numero: number): string | null {
    if (numero === 1) {
      if (!data) return "Escolha a data da aula.";
      if (data < config.dataMinima) {
        return `A data mais próxima permitida é ${dataBR(config.dataMinima)}.`;
      }
      if (data > config.dataMaxima) {
        return `As reservas vão até ${dataBR(config.dataMaxima)}.`;
      }
      return null;
    }

    if (numero === 2) {
      if (diaInteiro) return null;
      if (!horaInicio || !horaFim) {
        return "Informe o horário de início e o de término.";
      }
      if (horaFim <= horaInicio) {
        return "O horário de término precisa ser depois do de início.";
      }
      if (horaInicio < config.openingTime || horaFim > config.closingTime) {
        return `As reservas só podem ocorrer entre ${config.openingTime} e ${config.closingTime}.`;
      }
      return null;
    }

    if (numero === 3) {
      if (!tipo) return "Escolha o tipo de equipamento que você precisa.";
      return null;
    }

    if (numero === 4) {
      if (totalSelecionado === 0) {
        return "Selecione ao menos um equipamento para continuar.";
      }
      if (totalSelecionado > config.maxResourcesPerReservation) {
        return `Cada reserva aceita no máximo ${config.maxResourcesPerReservation} equipamento(s).`;
      }
      return null;
    }

    if (numero === 5) {
      if (finalidade.trim().length < 3) {
        return "Descreva a finalidade da aula — é o que a supervisão lê para organizar os equipamentos.";
      }
      return null;
    }

    return null;
  }

  // A consulta acontece ao entrar na etapa 4 — e não antes — porque só aqui o
  // período está fechado. Ficar no efeito, e não no botão "Continuar", cobre
  // também quem volta pelo indicador de etapas depois de trocar a data.
  useEffect(() => {
    if (etapa !== 4) return;
    if (periodoConsultado.current === chaveDoPeriodo && disponibilidade) return;
    periodoConsultado.current = chaveDoPeriodo;
    void carregarDisponibilidade();
    // A busca depende apenas da etapa e do período consultado; incluir a
    // função nas dependências a refaria a cada digitação de outro campo.
  }, [etapa, chaveDoPeriodo]);

  function avancar() {
    const problema = validarEtapa(etapa);
    if (problema) {
      setErroEtapa(problema);
      return;
    }
    setErroEtapa(null);
    if (etapa === 4) setAvisoRecursos(null);

    irPara(etapa + 1);
  }

  function voltar() {
    setErroEtapa(null);
    if (etapa > 1) setEtapa(etapa - 1);
  }

  // --- Envio ---------------------------------------------------------------

  async function confirmar() {
    setEnviando(true);
    setErroEtapa(null);
    setErrosCampo({});
    setConflitos(null);

    const corpo = {
      date: data,
      startTime: diaInteiro ? null : horaInicio,
      endTime: diaInteiro ? null : horaFim,
      kitIds: kitsSelecionados,
      notebookIds: notebooksSelecionados,
      purpose: finalidade.trim() || null,
      className: turma.trim() || null,
      subject: disciplina.trim() || null,
      room: sala.trim() || null,
      requestedNotebooks: quantidade.trim() === "" ? null : quantidade.trim(),
      teacherNotes: observacoes.trim() || null,
    };

    // O mesmo esquema da API: erro de digitação aparece antes da viagem à rede.
    const validado = createReservationSchema.safeParse(corpo);
    if (!validado.success) {
      const campos: Record<string, string[]> = {};
      for (const problema of validado.error.issues) {
        const chave = problema.path.join(".") || "_";
        (campos[chave] ??= []).push(problema.message);
      }
      setErrosCampo(campos);
      setErroEtapa("Verifique os dados informados antes de confirmar.");
      setEnviando(false);
      return;
    }

    try {
      const criada = await api.post<ReservaCriada>(
        "/api/reservations",
        validado.data,
      );
      setComprovante(criada);
      irPara(8);
    } catch (erro) {
      if (erro instanceof ApiError && erro.code === "CONFLITO_RESERVA") {
        setConflitos(extrairConflitos(erro.details));
        setErroEtapa(erro.message);
      } else if (erro instanceof ApiError) {
        setErroEtapa(erro.message);
        setErrosCampo(erro.fieldErrors);
      } else {
        setErroEtapa(
          "Não foi possível concluir a reserva. Tente novamente em instantes.",
        );
      }
    } finally {
      setEnviando(false);
    }
  }

  /** Conflito resolvido escolhendo outro equipamento: volta à etapa 4. */
  async function escolherOutroEquipamento() {
    const bloqueados = new Set((conflitos ?? []).map((c) => c.resourceKey));
    setKitsSelecionados((atual) =>
      atual.filter((id) => !bloqueados.has(`kit:${id}`)),
    );
    setNotebooksSelecionados((atual) =>
      atual.filter((id) => !bloqueados.has(`notebook:${id}`)),
    );
    setConflitos(null);
    setAvisoRecursos(
      "Tiramos da seleção o que foi reservado por outra pessoa. Escolha outro equipamento para o mesmo período.",
    );
    irPara(4);
    await carregarDisponibilidade();
  }

  function recomecar() {
    setComprovante(null);
    setData(config.dataMinima);
    setDiaInteiro(!config.requireTimeRange);
    setHoraInicio("");
    setHoraFim("");
    setTipo(null);
    setDisponibilidade(null);
    setKitsSelecionados([]);
    setNotebooksSelecionados([]);
    setFinalidade("");
    setTurma("");
    setDisciplina("");
    setSala("");
    setQuantidade("");
    setObservacoes("");
    setConflitos(null);
    setAvisoRecursos(null);
    setErroEtapa(null);
    setErrosCampo({});
    setMaiorLiberada(1);
    setEtapa(1);
  }

  // --- Render --------------------------------------------------------------

  // O indicador já diz "Etapa 3 de 8 — Tipo"; o título da vez traz a pergunta
  // que a etapa responde, para não repetir a mesma informação duas vezes.
  const tituloEtapa =
    etapa === 8 ? "Comprovante da reserva" : etapaPorNumero(etapa).resumo;

  return (
    <div className="mx-auto w-full max-w-3xl">
      {etapa < 8 && (
        <IndicadorDeEtapas
          atual={etapa}
          maiorLiberada={maiorLiberada}
          onIr={(numero) => {
            setErroEtapa(null);
            setEtapa(numero);
          }}
        />
      )}

      <Card>
        <CardBody className="space-y-5">
          <h2
            ref={tituloRef}
            tabIndex={-1}
            className="text-lg font-semibold text-slate-900 focus:outline-2 focus:outline-offset-4 focus:outline-sky-600"
          >
            {etapa < 8 && (
              <span className="text-slate-500">{etapa}. </span>
            )}
            {tituloEtapa}
          </h2>

          {etapa === 1 && (
            <EtapaData
              config={config}
              data={data}
              onChange={alterarData}
            />
          )}

          {etapa === 2 && (
            <EtapaHorario
              config={config}
              data={data}
              diaInteiro={diaInteiro}
              horaInicio={horaInicio}
              horaFim={horaFim}
              onDiaInteiro={(valor) => {
                setDiaInteiro(valor);
                limparSelecoes();
              }}
              onHorario={alterarHorario}
            />
          )}

          {etapa === 3 && (
            <EtapaTipo config={config} tipo={tipo} onChange={alterarTipo} />
          )}

          {etapa === 4 && (
            <EtapaEquipamentos
              config={config}
              tipo={tipo}
              disponibilidade={disponibilidade}
              carregando={carregandoDisp}
              erro={erroDisp}
              aviso={avisoRecursos}
              kitsSelecionados={kitsSelecionados}
              notebooksSelecionados={notebooksSelecionados}
              limiteAtingido={limiteAtingido}
              totalSelecionado={totalSelecionado}
              onRecarregar={carregarDisponibilidade}
              onAlternarKit={(id) =>
                setKitsSelecionados((atual) =>
                  atual.includes(id)
                    ? atual.filter((item) => item !== id)
                    : [...atual, id],
                )
              }
              onAlternarNotebook={(id) =>
                setNotebooksSelecionados((atual) =>
                  atual.includes(id)
                    ? atual.filter((item) => item !== id)
                    : [...atual, id],
                )
              }
            />
          )}

          {etapa === 5 && (
            <EtapaDadosDaAula
              erros={errosCampo}
              exigeQuantidade={kitsEscolhidos.length > 0}
              capacidadeTotal={kitsEscolhidos.reduce(
                (soma, kit) => soma + kit.capacity,
                0,
              )}
              finalidade={finalidade}
              turma={turma}
              disciplina={disciplina}
              sala={sala}
              quantidade={quantidade}
              observacoes={observacoes}
              setFinalidade={setFinalidade}
              setTurma={setTurma}
              setDisciplina={setDisciplina}
              setSala={setSala}
              setQuantidade={setQuantidade}
              setObservacoes={setObservacoes}
            />
          )}

          {etapa === 6 && (
            <EtapaRevisao
              periodoFormatado={periodoFormatado}
              tipo={tipo}
              kits={kitsEscolhidos}
              notebooks={notebooksEscolhidos}
              finalidade={finalidade}
              turma={turma}
              disciplina={disciplina}
              sala={sala}
              quantidade={quantidade}
              observacoes={observacoes}
              onEditar={irPara}
            />
          )}

          {etapa === 7 && (
            <EtapaConfirmacao
              periodoFormatado={periodoFormatado}
              kits={kitsEscolhidos}
              notebooks={notebooksEscolhidos}
              conflitos={conflitos}
              whatsappHabilitado={config.whatsappContactEnabled}
              onEscolherOutro={escolherOutroEquipamento}
            />
          )}

          {etapa === 8 && comprovante && (
            <EtapaComprovante
              reserva={comprovante}
              periodoFormatado={periodoFormatado}
              onNovaReserva={recomecar}
            />
          )}

          {erroEtapa && etapa !== 7 && (
            <Alert tone="danger" title="Não foi possível continuar">
              {erroEtapa}
            </Alert>
          )}
          {erroEtapa && etapa === 7 && !conflitos && (
            <Alert tone="danger" title="Não foi possível confirmar">
              {erroEtapa}
            </Alert>
          )}

          {/* Resumo dos erros só na confirmação: nas etapas anteriores cada
              campo já mostra a própria mensagem logo abaixo do controle. */}
          {etapa === 7 && Object.keys(errosCampo).length > 0 && (
            <Alert tone="danger" title="Corrija os campos abaixo">
              <ul className="list-inside list-disc">
                {Object.entries(errosCampo).map(([campo, mensagens]) => (
                  <li key={campo}>
                    <strong className="font-semibold">
                      {rotuloDoCampo(campo)}:
                    </strong>{" "}
                    {mensagens.join(" ")}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </CardBody>
      </Card>

      {etapa < 8 && (
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          {etapa === 1 ? (
            <Link
              href="/inicio"
              className={cn(
                CLASSE_LINK_BOTAO,
                "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-slate-500",
              )}
            >
              Cancelar
            </Link>
          ) : (
            <Button variant="outline" onClick={voltar} disabled={enviando}>
              Voltar
            </Button>
          )}

          {etapa < 7 ? (
            <Button onClick={avancar} disabled={carregandoDisp}>
              Continuar
            </Button>
          ) : (
            <Button onClick={confirmar} loading={enviando}>
              Confirmar reserva
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa 1 — Data
// ---------------------------------------------------------------------------

function EtapaData({
  config,
  data,
  onChange,
}: {
  config: ConfigReserva;
  data: string;
  onChange: (valor: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Escolha o dia em que os equipamentos serão usados. É possível reservar
        de {dataBR(config.dataMinima)} até {dataBR(config.dataMaxima)}.
      </p>
      <TextField
        label="Data da aula"
        type="date"
        required
        value={data}
        min={config.dataMinima}
        max={config.dataMaxima}
        onChange={(evento) => onChange(evento.target.value)}
        hint={data ? `Selecionado: ${dataBR(data)}` : "Formato dd/mm/aaaa"}
        className="max-w-xs"
      />
      {data === config.hoje && (
        <Alert tone="info" title="Reserva para hoje">
          O horário escolhido precisa ser futuro
          {config.minAdvanceHours > 0
            ? `, com pelo menos ${config.minAdvanceHours} hora(s) de antecedência.`
            : "."}
        </Alert>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa 2 — Horário
// ---------------------------------------------------------------------------

function EtapaHorario({
  config,
  data,
  diaInteiro,
  horaInicio,
  horaFim,
  onDiaInteiro,
  onHorario,
}: {
  config: ConfigReserva;
  data: string;
  diaInteiro: boolean;
  horaInicio: string;
  horaFim: string;
  onDiaInteiro: (valor: boolean) => void;
  onHorario: (inicio: string, fim: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Reserva para {dataBR(data)}. O equipamento fica bloqueado para os outros
        professores apenas dentro do período informado — quanto mais justo o
        horário, mais gente consegue usar no mesmo dia.
      </p>

      {!config.requireTimeRange && (
        <CheckboxField
          label="Preciso do equipamento o dia inteiro"
          hint="Bloqueia o equipamento das 00:00 às 23:59 desta data."
          checked={diaInteiro}
          onChange={(evento) => onDiaInteiro(evento.target.checked)}
        />
      )}

      {!diaInteiro && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Início"
            type="time"
            required
            value={horaInicio}
            min={config.openingTime}
            max={config.closingTime}
            onChange={(evento) => onHorario(evento.target.value, horaFim)}
            hint={`Funcionamento: ${config.openingTime} às ${config.closingTime}`}
          />
          <TextField
            label="Término"
            type="time"
            required
            value={horaFim}
            min={config.openingTime}
            max={config.closingTime}
            onChange={(evento) => onHorario(horaInicio, evento.target.value)}
            hint="Considere o tempo de guardar e devolver o equipamento."
          />
        </div>
      )}

      {diaInteiro && (
        <Alert tone="info">
          Com o dia inteiro marcado, ninguém mais consegue reservar os mesmos
          equipamentos em {dataBR(data)}. Use apenas quando realmente precisar.
        </Alert>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa 3 — Tipo de recurso
// ---------------------------------------------------------------------------

function EtapaTipo({
  config,
  tipo,
  onChange,
}: {
  config: ConfigReserva;
  tipo: TipoRecurso | null;
  onChange: (valor: TipoRecurso) => void;
}) {
  const opcoes: {
    valor: TipoRecurso;
    titulo: string;
    descricao: string;
    desabilitada?: boolean;
    aviso?: string;
  }[] = [
    {
      valor: "kit",
      titulo: "Kit completo (maleta ou carrinho)",
      descricao:
        "Vem com todos os notebooks guardados nele e com o kit de carregadores. É a escolha para a turma inteira usar ao mesmo tempo.",
    },
    {
      valor: "notebooks",
      titulo: "Notebooks avulsos",
      descricao:
        "Unidades individuais, retiradas uma a uma. Use quando poucos alunos precisam de máquina e não faz sentido bloquear uma maleta inteira.",
    },
    {
      valor: "ambos",
      titulo: "Combinar os dois",
      descricao:
        "Um kit para a turma e alguns notebooks a mais, na mesma reserva.",
      desabilitada: !config.allowMixedResourceReservation,
      aviso:
        "A supervisão desativou reservas mistas. Faça uma reserva para o kit e outra para os notebooks avulsos.",
    },
  ];

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm text-slate-600">
        O que você precisa levar para a aula?
      </legend>

      {opcoes.map((opcao) => {
        const marcada = tipo === opcao.valor;
        return (
          <label
            key={opcao.valor}
            className={cn(
              "flex min-h-11 gap-3 rounded-lg border p-3 transition-colors",
              opcao.desabilitada
                ? "cursor-not-allowed border-slate-200 bg-slate-50"
                : "cursor-pointer",
              marcada && !opcao.desabilitada
                ? "border-sky-600 bg-sky-50 ring-1 ring-sky-600"
                : !opcao.desabilitada && "border-slate-300 hover:border-slate-400",
            )}
          >
            <input
              type="radio"
              name="tipo-de-recurso"
              value={opcao.valor}
              checked={marcada}
              disabled={opcao.desabilitada}
              onChange={() => onChange(opcao.valor)}
              className="mt-0.5 size-5 shrink-0 border-slate-300 text-sky-700 focus:outline-2 focus:outline-offset-2 focus:outline-sky-600"
            />
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-sm font-semibold",
                  opcao.desabilitada ? "text-slate-500" : "text-slate-900",
                )}
              >
                {opcao.titulo}
              </span>
              <span className="mt-0.5 block text-sm text-slate-600">
                {opcao.descricao}
              </span>
              {opcao.desabilitada && opcao.aviso && (
                <span className="mt-1 block text-xs font-medium text-amber-800">
                  {opcao.aviso}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Etapa 4 — Equipamentos
// ---------------------------------------------------------------------------

function EtapaEquipamentos({
  config,
  tipo,
  disponibilidade,
  carregando,
  erro,
  aviso,
  kitsSelecionados,
  notebooksSelecionados,
  limiteAtingido,
  totalSelecionado,
  onRecarregar,
  onAlternarKit,
  onAlternarNotebook,
}: {
  config: ConfigReserva;
  tipo: TipoRecurso | null;
  disponibilidade: AvailabilityResult | null;
  carregando: boolean;
  erro: string | null;
  aviso: string | null;
  kitsSelecionados: string[];
  notebooksSelecionados: string[];
  limiteAtingido: boolean;
  totalSelecionado: number;
  onRecarregar: () => void;
  onAlternarKit: (id: string) => void;
  onAlternarNotebook: (id: string) => void;
}) {
  const mostrarKits = tipo === "kit" || tipo === "ambos";
  const mostrarNotebooks = tipo === "notebooks" || tipo === "ambos";

  const kits = mostrarKits ? (disponibilidade?.kits ?? []) : [];
  // Notebooks fora de maleta aparecem primeiro: são os "avulsos" de verdade,
  // e reservar um que está dentro de um kit tira aquela unidade da maleta.
  const notebooks = mostrarNotebooks
    ? [...(disponibilidade?.notebooks ?? [])].sort((a, b) => {
        const pesoA = a.kitId ? 1 : 0;
        const pesoB = b.kitId ? 1 : 0;
        if (pesoA !== pesoB) return pesoA - pesoB;
        return a.assetTag.localeCompare(b.assetTag, "pt-BR");
      })
    : [];

  const kitsLivres = kits.filter((kit) => kit.state === "DISPONIVEL");
  const kitsOcupados = kits.filter((kit) => kit.state === "RESERVADO");
  const notebooksLivres = notebooks.filter((n) => n.state === "DISPONIVEL");
  const notebooksOcupados = notebooks.filter((n) => n.state === "RESERVADO");

  const bloqueados =
    kits.filter((k) => k.state === "MANUTENCAO" || k.state === "INDISPONIVEL")
      .length +
    notebooks.filter(
      (n) => n.state === "MANUTENCAO" || n.state === "INDISPONIVEL",
    ).length;

  const nadaLivre = kitsLivres.length === 0 && notebooksLivres.length === 0;
  const nadaOcupado = kitsOcupados.length === 0 && notebooksOcupados.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          Disponibilidade em{" "}
          <strong className="font-semibold text-slate-800">
            {disponibilidade?.periodo.formatado ?? "..."}
          </strong>
        </p>
        <Button
          variant="outline"
          onClick={onRecarregar}
          loading={carregando}
          aria-label="Atualizar a disponibilidade dos equipamentos"
        >
          Atualizar
        </Button>
      </div>

      {aviso && <Alert tone="warning">{aviso}</Alert>}

      {erro && (
        <Alert tone="danger" title="Falha ao consultar a disponibilidade">
          {erro}
        </Alert>
      )}

      <div aria-busy={carregando} className="space-y-5">
        {/* Só a linha de situação é anunciada: marcar a lista inteira como
            região viva faria o leitor de tela reler dezenas de equipamentos. */}
        <p aria-live="polite" className="text-sm text-slate-600">
          {carregando
            ? "Consultando os equipamentos livres neste período..."
            : erro
              ? // Sem isto a linha ficaria em "Consultando..." para sempre depois
                // de uma falha, contradizendo o aviso de erro logo acima.
                "A consulta não foi concluída. Use o botão Atualizar para tentar de novo."
              : !disponibilidade
                ? "Consultando os equipamentos livres neste período..."
                : `${kitsLivres.length + notebooksLivres.length} equipamento(s) disponível(is). ${totalSelecionado} de ${config.maxResourcesPerReservation} selecionado(s).`}
          {!carregando &&
            !erro &&
            limiteAtingido &&
            " Limite atingido — desmarque um item para trocar."}
        </p>

        {(carregando || (!erro && !disponibilidade)) && (
          <Spinner label="Consultando equipamentos livres..." />
        )}

        {!carregando && !erro && disponibilidade && (
          <>

            {nadaLivre && (
              <EmptyState
                title="Nenhum equipamento livre neste período"
                description={
                  nadaOcupado
                    ? "Não há equipamentos cadastrados para este tipo de recurso. Volte à etapa anterior e escolha outro tipo, ou procure a supervisão."
                    : "Tudo o que existe já está reservado neste horário. Você pode voltar e escolher outra data ou horário, ou falar com quem está com o equipamento na lista abaixo."
                }
              />
            )}

            {kitsLivres.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Maletas e carrinhos disponíveis ({kitsLivres.length})
                </h3>
                {kitsLivres.map((kit) => (
                  <CartaoKit
                    key={kit.id}
                    kit={kit}
                    selecionado={kitsSelecionados.includes(kit.id)}
                    bloqueadoPorLimite={
                      limiteAtingido && !kitsSelecionados.includes(kit.id)
                    }
                    onAlternar={() => onAlternarKit(kit.id)}
                  />
                ))}
              </section>
            )}

            {notebooksLivres.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Notebooks disponíveis ({notebooksLivres.length})
                </h3>
                {notebooksLivres.map((notebook) => (
                  <CartaoNotebook
                    key={notebook.id}
                    notebook={notebook}
                    selecionado={notebooksSelecionados.includes(notebook.id)}
                    bloqueadoPorLimite={
                      limiteAtingido &&
                      !notebooksSelecionados.includes(notebook.id)
                    }
                    onAlternar={() => onAlternarNotebook(notebook.id)}
                  />
                ))}
              </section>
            )}

            {!nadaOcupado && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-800">
                  Já reservados neste período (
                  {kitsOcupados.length + notebooksOcupados.length})
                </h3>
                <p className="text-sm text-slate-600">
                  Não dá para reservar por cima. Se precisar muito de um destes,
                  fale com quem está com ele — o sistema não tem fila de espera.
                </p>
                {kitsOcupados.map((kit) => (
                  <CartaoOcupado
                    key={kit.id}
                    titulo={rotuloKit(kit)}
                    detalhe={`${kit.type === "CARRINHO" ? "Carrinho" : "Maleta"} · ${kit.notebookCount} notebook(s)`}
                    ocupacoes={kit.occupations}
                    whatsappHabilitado={config.whatsappContactEnabled}
                  />
                ))}
                {notebooksOcupados.map((notebook) => (
                  <CartaoOcupado
                    key={notebook.id}
                    titulo={rotuloNotebook(notebook)}
                    detalhe={
                      notebook.kitName
                        ? `Pertence a ${notebook.kitName}`
                        : "Notebook avulso"
                    }
                    ocupacoes={notebook.occupations}
                    whatsappHabilitado={config.whatsappContactEnabled}
                  />
                ))}
              </section>
            )}

            {bloqueados > 0 && (
              <p className="text-sm text-slate-500">
                {bloqueados} equipamento(s) estão em manutenção ou indisponíveis
                e por isso não aparecem nesta lista.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CartaoKit({
  kit,
  selecionado,
  bloqueadoPorLimite,
  onAlternar,
}: {
  kit: KitAvailability;
  selecionado: boolean;
  bloqueadoPorLimite: boolean;
  onAlternar: () => void;
}) {
  const carregadores = kit.chargerKit;

  return (
    <label
      className={cn(
        "flex min-h-11 gap-3 rounded-lg border p-3 transition-colors",
        bloqueadoPorLimite
          ? "cursor-not-allowed border-slate-200 bg-slate-50"
          : "cursor-pointer",
        selecionado
          ? "border-sky-600 bg-sky-50 ring-1 ring-sky-600"
          : !bloqueadoPorLimite && "border-slate-300 hover:border-slate-400",
      )}
    >
      <input
        type="checkbox"
        checked={selecionado}
        disabled={bloqueadoPorLimite}
        onChange={onAlternar}
        className="mt-0.5 size-5 shrink-0 rounded border-slate-300 text-sky-700 focus:outline-2 focus:outline-offset-2 focus:outline-sky-600"
      />
      <span className="min-w-0 flex-1 break-words">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">
            {rotuloKit(kit)}
          </span>
          <Badge tone="success">Disponível</Badge>
        </span>

        <span className="mt-1 block text-sm text-slate-600">
          {kit.type === "CARRINHO" ? "Carrinho" : "Maleta"} · capacidade para{" "}
          {kit.capacity} notebook(s) · {kit.notebookCount} guardado(s) hoje
          {kit.location ? ` · ${kit.location}` : ""}
        </span>

        <span className="mt-1.5 block">
          {carregadores ? (
            <Badge tone={carregadores.completo ? "success" : "warning"}>
              {carregadores.completo
                ? "Kit de carregadores completo"
                : `Carregadores: ${carregadores.availableQuantity} de ${carregadores.totalQuantity}`}
            </Badge>
          ) : (
            <Badge tone="warning">Sem kit de carregadores cadastrado</Badge>
          )}
        </span>
      </span>
    </label>
  );
}

function CartaoNotebook({
  notebook,
  selecionado,
  bloqueadoPorLimite,
  onAlternar,
}: {
  notebook: NotebookAvailability;
  selecionado: boolean;
  bloqueadoPorLimite: boolean;
  onAlternar: () => void;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 gap-3 rounded-lg border p-3 transition-colors",
        bloqueadoPorLimite
          ? "cursor-not-allowed border-slate-200 bg-slate-50"
          : "cursor-pointer",
        selecionado
          ? "border-sky-600 bg-sky-50 ring-1 ring-sky-600"
          : !bloqueadoPorLimite && "border-slate-300 hover:border-slate-400",
      )}
    >
      <input
        type="checkbox"
        checked={selecionado}
        disabled={bloqueadoPorLimite}
        onChange={onAlternar}
        className="mt-0.5 size-5 shrink-0 rounded border-slate-300 text-sky-700 focus:outline-2 focus:outline-offset-2 focus:outline-sky-600"
      />
      <span className="min-w-0 flex-1 break-words">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">
            {rotuloNotebook(notebook)}
          </span>
          <Badge tone="success">Disponível</Badge>
        </span>
        <span className="mt-1 block text-sm text-slate-600">
          {[notebook.brand, notebook.model].filter(Boolean).join(" ") ||
            "Sem marca/modelo cadastrados"}
          {notebook.kitName
            ? ` · sai de ${notebook.kitName} nesse período`
            : " · notebook avulso"}
        </span>
      </span>
    </label>
  );
}

type Ocupacao = KitAvailability["occupations"][number];

function CartaoOcupado({
  titulo,
  detalhe,
  ocupacoes,
  whatsappHabilitado,
}: {
  titulo: string;
  detalhe: string;
  ocupacoes: Ocupacao[];
  whatsappHabilitado: boolean;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <input
        type="checkbox"
        checked={false}
        disabled
        readOnly
        aria-label={`${titulo} — indisponível neste período`}
        className="mt-0.5 size-5 shrink-0 rounded border-slate-300"
      />
      <div className="min-w-0 flex-1 break-words">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">{titulo}</span>
          <Badge tone="info">Reservado</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-600">{detalhe}</p>

        <ul className="mt-2 space-y-2">
          {ocupacoes.map((ocupacao) => (
            <li
              key={ocupacao.reservationId}
              className="rounded-md border border-slate-200 bg-white p-2.5"
            >
              <p className="text-sm text-slate-700">
                Com{" "}
                <strong className="font-semibold">
                  {ocupacao.holder.fullName}
                </strong>{" "}
                em {ocupacao.periodoFormatado}
                {ocupacao.room ? ` · sala ${ocupacao.room}` : ""}
              </p>
              {whatsappHabilitado && ocupacao.holder.whatsappDisponivel && (
                <div className="mt-2">
                  <BotaoWhatsapp
                    reservationId={ocupacao.reservationId}
                    nome={ocupacao.holder.fullName}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Contato com quem está usando o equipamento.
 *
 * O número do colega nunca chega ao navegador: a API devolve o link já pronto
 * e registra o acesso. Se o navegador bloquear a nova aba (o clique passou por
 * um `await`), o link é exibido para o professor abrir manualmente.
 */
function BotaoWhatsapp({
  reservationId,
  nome,
}: {
  reservationId: string;
  nome: string;
}) {
  const [carregando, setCarregando] = useState(false);
  const [indisponivel, setIndisponivel] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  async function abrir() {
    setCarregando(true);
    setIndisponivel(null);
    try {
      const resposta = await api.post<
        | { disponivel: true; url: string; mensagem: string }
        | { disponivel: false; motivo: string }
      >(`/api/reservations/${reservationId}/whatsapp`);

      if (!resposta.disponivel) {
        setIndisponivel(resposta.motivo);
        return;
      }
      const janela = window.open(resposta.url, "_blank", "noopener,noreferrer");
      if (!janela) setUrl(resposta.url);
    } catch (erro) {
      setIndisponivel(
        erro instanceof ApiError
          ? erro.message
          : "Não foi possível gerar o contato agora.",
      );
    } finally {
      setCarregando(false);
    }
  }

  // Um nome vazio ou só com espaços deixaria "Falar com  no WhatsApp".
  const primeiroNome = nome.trim().split(" ")[0] || "o(a) docente";

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        loading={carregando}
        onClick={abrir}
        icon={<span aria-hidden="true">💬</span>}
      >
        Falar com {primeiroNome} no WhatsApp
      </Button>

      {/* A aba bloqueada é uma mudança que acontece sozinha depois do clique:
          sem região viva, quem usa leitor de tela não fica sabendo do link. */}
      {url && (
        <p role="status" className="text-sm">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-sky-800 underline"
          >
            Abrir a conversa no WhatsApp
          </a>{" "}
          (seu navegador bloqueou a abertura automática)
        </p>
      )}

      {indisponivel && (
        <Alert tone="info" className="mt-1">
          {indisponivel}
        </Alert>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa 5 — Dados da aula
// ---------------------------------------------------------------------------

function EtapaDadosDaAula({
  erros,
  exigeQuantidade,
  capacidadeTotal,
  finalidade,
  turma,
  disciplina,
  sala,
  quantidade,
  observacoes,
  setFinalidade,
  setTurma,
  setDisciplina,
  setSala,
  setQuantidade,
  setObservacoes,
}: {
  erros: Record<string, string[]>;
  exigeQuantidade: boolean;
  capacidadeTotal: number;
  finalidade: string;
  turma: string;
  disciplina: string;
  sala: string;
  quantidade: string;
  observacoes: string;
  setFinalidade: (v: string) => void;
  setTurma: (v: string) => void;
  setDisciplina: (v: string) => void;
  setSala: (v: string) => void;
  setQuantidade: (v: string) => void;
  setObservacoes: (v: string) => void;
}) {
  const excedeCapacidade =
    exigeQuantidade &&
    quantidade.trim() !== "" &&
    Number(quantidade) > capacidadeTotal;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Estas informações aparecem para a supervisão e ajudam a preparar os
        equipamentos antes da sua aula.
      </p>

      <TextField
        label="Finalidade da aula"
        required
        maxLength={200}
        value={finalidade}
        error={erros.purpose}
        onChange={(evento) => setFinalidade(evento.target.value)}
        placeholder="Ex.: pesquisa sobre energias renováveis"
        hint="Uma frase basta."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Turma (opcional)"
          maxLength={80}
          value={turma}
          error={erros.className}
          onChange={(evento) => setTurma(evento.target.value)}
          placeholder="Ex.: 9º ano B"
        />
        <TextField
          label="Disciplina (opcional)"
          maxLength={80}
          value={disciplina}
          error={erros.subject}
          onChange={(evento) => setDisciplina(evento.target.value)}
          placeholder="Ex.: Ciências"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Sala (opcional)"
          maxLength={80}
          value={sala}
          error={erros.room}
          onChange={(evento) => setSala(evento.target.value)}
          placeholder="Ex.: Laboratório 2"
          hint="Onde o equipamento será usado."
        />
        {exigeQuantidade && (
          <TextField
            label="Quantos notebooks você vai usar?"
            type="number"
            inputMode="numeric"
            min={1}
            max={capacidadeTotal || 200}
            value={quantidade}
            error={erros.requestedNotebooks}
            onChange={(evento) => setQuantidade(evento.target.value)}
            hint={`O kit selecionado comporta ${capacidadeTotal} notebook(s). Informar ajuda a supervisão a conferir a devolução.`}
          />
        )}
      </div>

      {excedeCapacidade && (
        <Alert tone="warning" title="Quantidade acima da capacidade">
          Os kits escolhidos comportam {capacidadeTotal} notebook(s). Ajuste a
          quantidade ou volte e selecione mais equipamentos.
        </Alert>
      )}

      <TextAreaField
        label="Observações para a supervisão (opcional)"
        maxLength={500}
        rows={3}
        value={observacoes}
        error={erros.teacherNotes}
        onChange={(evento) => setObservacoes(evento.target.value)}
        placeholder="Ex.: vou retirar 10 minutos antes da aula começar."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa 6 — Revisão
// ---------------------------------------------------------------------------

function LinhaResumo({
  rotulo,
  valor,
}: {
  rotulo: string;
  valor: ReactNode;
}) {
  return (
    <div className="grid gap-0.5 border-b border-slate-100 py-2 last:border-b-0 sm:grid-cols-3 sm:gap-3">
      <dt className="text-sm font-medium text-slate-500">{rotulo}</dt>
      {/* `break-words` evita que uma observação com um link longo, colada pelo
          professor, empurre a página para o lado num celular de 360px. */}
      <dd className="min-w-0 text-sm break-words text-slate-900 sm:col-span-2">
        {valor}
      </dd>
    </div>
  );
}

function EtapaRevisao({
  periodoFormatado,
  tipo,
  kits,
  notebooks,
  finalidade,
  turma,
  disciplina,
  sala,
  quantidade,
  observacoes,
  onEditar,
}: {
  periodoFormatado: string;
  tipo: TipoRecurso | null;
  kits: KitAvailability[];
  notebooks: NotebookAvailability[];
  finalidade: string;
  turma: string;
  disciplina: string;
  sala: string;
  quantidade: string;
  observacoes: string;
  onEditar: (etapa: number) => void;
}) {
  const tipoTexto =
    tipo === "kit"
      ? "Kit completo"
      : tipo === "notebooks"
        ? "Notebooks avulsos"
        : "Kit e notebooks avulsos";

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Confira tudo antes de confirmar. Nada foi reservado ainda.
      </p>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Período</h3>
          <Button variant="ghost" onClick={() => onEditar(1)}>
            Alterar período
          </Button>
        </div>
        <dl>
          <LinhaResumo rotulo="Quando" valor={periodoFormatado} />
        </dl>
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Equipamentos</h3>
          <Button variant="ghost" onClick={() => onEditar(4)}>
            Alterar equipamentos
          </Button>
        </div>
        <dl>
          <LinhaResumo rotulo="Tipo" valor={tipoTexto} />
          <LinhaResumo
            rotulo="Selecionados"
            valor={
              <ul className="space-y-1">
                {kits.map((kit) => (
                  <li key={kit.id}>
                    {rotuloKit(kit)} — {kit.notebookCount} notebook(s)
                    {kit.chargerKit
                      ? kit.chargerKit.completo
                        ? " · carregadores completos"
                        : ` · carregadores ${kit.chargerKit.availableQuantity}/${kit.chargerKit.totalQuantity}`
                      : " · sem kit de carregadores"}
                  </li>
                ))}
                {notebooks.map((notebook) => (
                  <li key={notebook.id}>{rotuloNotebook(notebook)}</li>
                ))}
              </ul>
            }
          />
        </dl>
      </section>

      <section>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Dados da aula</h3>
          <Button variant="ghost" onClick={() => onEditar(5)}>
            Alterar dados
          </Button>
        </div>
        <dl>
          <LinhaResumo rotulo="Finalidade" valor={finalidade || "Não informada"} />
          <LinhaResumo rotulo="Turma" valor={turma || "Não informada"} />
          <LinhaResumo
            rotulo="Disciplina"
            valor={disciplina || "Não informada"}
          />
          <LinhaResumo rotulo="Sala" valor={sala || "Não informada"} />
          {kits.length > 0 && (
            <LinhaResumo
              rotulo="Notebooks necessários"
              valor={quantidade || "Não informado"}
            />
          )}
          <LinhaResumo
            rotulo="Observações"
            valor={observacoes || "Nenhuma observação"}
          />
        </dl>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa 7 — Confirmação
// ---------------------------------------------------------------------------

function EtapaConfirmacao({
  periodoFormatado,
  kits,
  notebooks,
  conflitos,
  whatsappHabilitado,
  onEscolherOutro,
}: {
  periodoFormatado: string;
  kits: KitAvailability[];
  notebooks: NotebookAvailability[];
  conflitos: Conflito[] | null;
  whatsappHabilitado: boolean;
  onEscolherOutro: () => void;
}) {
  return (
    <div className="space-y-4">
      {!conflitos && (
        <>
          <p className="text-sm text-slate-700">
            Ao confirmar, os equipamentos abaixo ficam reservados no seu nome em{" "}
            <strong className="font-semibold">{periodoFormatado}</strong> e
            deixam de aparecer para os outros professores nesse período.
          </p>
          <ul className="list-inside list-disc text-sm text-slate-700">
            {kits.map((kit) => (
              <li key={kit.id}>{rotuloKit(kit)}</li>
            ))}
            {notebooks.map((notebook) => (
              <li key={notebook.id}>{rotuloNotebook(notebook)}</li>
            ))}
          </ul>
          <Alert tone="info">
            Se seus planos mudarem, cancele a reserva em “Minhas reservas” para
            liberar o equipamento para outra turma.
          </Alert>
        </>
      )}

      {conflitos && (
        <Alert
          tone="warning"
          title="Alguém reservou enquanto você preenchia"
        >
          <p>
            Estes equipamentos foram reservados por outra pessoa nos últimos
            minutos e não estão mais livres no período escolhido:
          </p>

          {conflitos.length > 0 ? (
            <ul className="mt-3 space-y-3">
              {conflitos.map((conflito) => (
                <li
                  key={`${conflito.resourceKey}-${conflito.reservationId}`}
                  className="rounded-md border border-amber-300 bg-white p-3"
                >
                  <p className="text-sm font-semibold text-slate-900">
                    {conflito.resourceLabel}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-700">
                    Com {conflito.holderNome}
                    {conflito.periodoFormatado
                      ? ` em ${conflito.periodoFormatado}`
                      : ""}
                    .
                  </p>
                  {whatsappHabilitado && conflito.whatsappDisponivel && (
                    <div className="mt-2">
                      <BotaoWhatsapp
                        reservationId={conflito.reservationId}
                        nome={conflito.holderNome}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2">
              Atualize a disponibilidade para ver o que continua livre.
            </p>
          )}

          <div className="mt-4">
            <Button variant="primary" onClick={onEscolherOutro}>
              Escolher outro equipamento
            </Button>
          </div>
        </Alert>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Etapa 8 — Comprovante
// ---------------------------------------------------------------------------

function EtapaComprovante({
  reserva,
  periodoFormatado,
  onNovaReserva,
}: {
  reserva: ReservaCriada;
  periodoFormatado: string;
  onNovaReserva: () => void;
}) {
  const equipamentos = reserva.items.map((item) => ({
    id: item.id,
    rotulo: item.kit
      ? `${item.kit.name} (${item.kit.code})`
      : item.notebook
        ? `Notebook ${item.notebook.assetTag}${item.notebook.nickname ? ` — ${item.notebook.nickname}` : ""}`
        : "Equipamento",
  }));

  return (
    <div className="space-y-5">
      <Alert tone="success" title="Reserva confirmada">
        Guarde o código abaixo: é por ele que a supervisão localiza a sua
        reserva na retirada.
      </Alert>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-5 text-center">
        <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">
          Código da reserva
        </p>
        {/* O código pode ganhar sufixo extra em caso de colisão; `break-all` e
            o tamanho menor no celular impedem que ele estoure a largura. */}
        <p className="mt-1 font-mono text-2xl font-bold tracking-wider break-all text-emerald-900 sm:text-3xl">
          {reserva.code}
        </p>
      </div>

      <dl>
        <LinhaResumo rotulo="Período" valor={periodoFormatado} />
        <LinhaResumo
          rotulo="Equipamentos"
          valor={
            <ul className="space-y-0.5">
              {equipamentos.map((equipamento) => (
                <li key={equipamento.id}>{equipamento.rotulo}</li>
              ))}
            </ul>
          }
        />
        <LinhaResumo rotulo="Sala" valor={reserva.room || "Não informada"} />
        <LinhaResumo
          rotulo="Finalidade"
          valor={reserva.purpose || "Não informada"}
        />
        <LinhaResumo rotulo="Turma" valor={reserva.className || "Não informada"} />
        {reserva.requestedNotebooks !== null && (
          <LinhaResumo
            rotulo="Notebooks necessários"
            valor={String(reserva.requestedNotebooks)}
          />
        )}
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Link
          href="/minhas-reservas"
          className={cn(
            CLASSE_LINK_BOTAO,
            "bg-sky-700 text-white hover:bg-sky-800 focus-visible:outline-sky-700",
          )}
        >
          Ver minhas reservas
        </Link>
        <Button variant="outline" onClick={onNovaReserva}>
          Fazer outra reserva
        </Button>
      </div>
    </div>
  );
}
