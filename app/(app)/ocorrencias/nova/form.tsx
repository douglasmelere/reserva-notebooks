"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { ApiError, api, queryString } from "@/lib/api-client";
import { createIncidentSchema } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import {
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/ui/field";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  Spinner,
} from "@/components/ui/primitives";
import type { IncidentTargetType } from "@/generated/prisma/enums";

export type Opcao = { value: string; label: string };

/** Limite do servidor (`MAX_UPLOAD_BYTES`), repetido aqui para avisar antes do envio. */
const LIMITE_ANEXO_MB = 5;
const LIMITE_ANEXO_BYTES = LIMITE_ANEXO_MB * 1024 * 1024;
const TIPOS_ACEITOS = ["image/jpeg", "image/png", "image/webp"];
const MAX_ANEXOS = 5;

const ALVOS: { value: IncidentTargetType; label: string }[] = [
  { value: "NOTEBOOK", label: "Um notebook" },
  { value: "KIT", label: "Uma maleta ou carrinho" },
  { value: "CHARGER_KIT", label: "Um kit de carregadores" },
  { value: "RESERVATION", label: "A reserva inteira" },
];

/** Severidades em que o servidor sugere tirar o equipamento de circulação. */
const SEVERIDADES_GRAVES = ["ALTA", "CRITICA"];

type AnexoDTO = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
};

type OcorrenciaCriada = {
  id: string;
  code: string;
  alvoLabel: string;
  severityLabel: string;
  statusLabel: string;
};

type RespostaCriacao = {
  ocorrencia: OcorrenciaCriada;
  sugerirBloqueio: boolean;
  recursoBloqueado: boolean;
  aviso: string | null;
};

/** Recortes mínimos das listagens do inventário — só o que vira rótulo. */
type NotebookItem = {
  id: string;
  assetTag: string;
  nickname: string | null;
  statusLabel: string;
};
type KitItem = { id: string; code: string; name: string; statusLabel: string };
type ChargerKitItem = { id: string; code: string; statusLabel: string };

export function NovaOcorrenciaForm({
  isSupervisor,
  alvoInicial,
  itemInicial,
  reservas,
  reservaInicial,
  categorias,
  severidades,
}: {
  isSupervisor: boolean;
  alvoInicial: IncidentTargetType;
  itemInicial: Opcao | null;
  reservas: Opcao[];
  reservaInicial: string;
  categorias: Opcao[];
  severidades: Opcao[];
}) {
  const [targetType, setTargetType] = useState<IncidentTargetType>(alvoInicial);
  const [itemId, setItemId] = useState(itemInicial?.value ?? "");
  const [reservationId, setReservationId] = useState(reservaInicial);
  const [category, setCategory] = useState("");
  const [severity, setSeverity] = useState("");
  const [description, setDescription] = useState("");
  const [blockResource, setBlockResource] = useState(false);

  const [busca, setBusca] = useState("");
  const [opcoesItem, setOpcoesItem] = useState<Opcao[]>(
    itemInicial ? [itemInicial] : [],
  );
  const [carregandoItens, setCarregandoItens] = useState(false);
  const [erroItens, setErroItens] = useState<string | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [errosCampo, setErrosCampo] = useState<Record<string, string[]>>({});
  const [resultado, setResultado] = useState<RespostaCriacao | null>(null);

  const precisaDeItem = targetType !== "RESERVATION";
  const severidadeGrave = SEVERIDADES_GRAVES.includes(severity);
  const podeBloquear = precisaDeItem && severidadeGrave;

  /**
   * Carrega o inventário do tipo escolhido.
   *
   * A lista é grande em escola de porte médio, então a busca vai ao servidor em
   * vez de filtrar no cliente — e o item que veio pré-selecionado pela URL é
   * costurado de volta na lista para nunca sumir do campo.
   */
  useEffect(() => {
    if (targetType === "RESERVATION") {
      setOpcoesItem([]);
      setErroItens(null);
      return;
    }

    let cancelado = false;
    const timer = setTimeout(() => {
      setCarregandoItens(true);
      setErroItens(null);

      const carregar = async (): Promise<Opcao[]> => {
        const qs = queryString({ search: busca.trim(), pageSize: 100 });
        if (targetType === "NOTEBOOK") {
          const { items } = await api.get<{ items: NotebookItem[] }>(
            `/api/notebooks${qs}`,
          );
          return items.map((n) => ({
            value: n.id,
            label: `${n.assetTag}${n.nickname ? ` — ${n.nickname}` : ""} (${n.statusLabel})`,
          }));
        }
        if (targetType === "KIT") {
          const { items } = await api.get<{ items: KitItem[] }>(`/api/kits${qs}`);
          return items.map((k) => ({
            value: k.id,
            label: `${k.name} (${k.code}) — ${k.statusLabel}`,
          }));
        }
        const { items } = await api.get<{ items: ChargerKitItem[] }>(
          `/api/charger-kits${qs}`,
        );
        return items.map((c) => ({
          value: c.id,
          label: `${c.code} — ${c.statusLabel}`,
        }));
      };

      carregar()
        .then((opcoes) => {
          if (cancelado) return;
          const preSelecionado =
            itemInicial && targetType === alvoInicial ? itemInicial : null;
          const finais =
            preSelecionado && !opcoes.some((o) => o.value === preSelecionado.value)
              ? [preSelecionado, ...opcoes]
              : opcoes;
          setOpcoesItem(finais);
          // Refinar a busca pode expulsar da lista o item já escolhido. Deixar o
          // id no estado enviaria um equipamento que sumiu da tela.
          setItemId((atual) =>
            atual && finais.some((o) => o.value === atual) ? atual : "",
          );
        })
        .catch((erro: unknown) => {
          if (cancelado) return;
          setOpcoesItem([]);
          setErroItens(
            erro instanceof ApiError
              ? erro.message
              : "Não foi possível carregar a lista de equipamentos.",
          );
        })
        .finally(() => {
          if (!cancelado) setCarregandoItens(false);
        });
    }, 300);

    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [targetType, busca, alvoInicial, itemInicial]);

  function trocarAlvo(proximo: IncidentTargetType) {
    setTargetType(proximo);
    setBusca("");
    // Um id de notebook não vale como id de maleta: trocar o tipo tem de limpar
    // a seleção, exceto quando voltamos ao alvo que veio pela URL.
    setItemId(proximo === alvoInicial ? (itemInicial?.value ?? "") : "");
    setBlockResource(false);
    setErrosCampo({});
  }

  function trocarSeveridade(proxima: string) {
    setSeverity(proxima);
    // Marcar o bloqueio e depois baixar a severidade deixaria um pedido que o
    // servidor recusa para o professor; a caixa some e o valor volta a falso.
    if (!SEVERIDADES_GRAVES.includes(proxima)) setBlockResource(false);
  }

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setErroGeral(null);
    setErrosCampo({});

    // Estas duas conferências vêm antes do Zod porque o esquema reporta a falta
    // do alvo no campo `targetType`, e a mensagem tem de aparecer no campo que o
    // usuário precisa corrigir.
    if (precisaDeItem && !itemId) {
      setErrosCampo({ item: ["Selecione o equipamento da ocorrência."] });
      setErroGeral("Verifique os campos destacados.");
      return;
    }
    if (!isSupervisor && targetType !== "RESERVATION" && !reservationId) {
      setErrosCampo({
        reservationId: ["Selecione a reserva em que você usou o equipamento."],
      });
      setErroGeral("Verifique os campos destacados.");
      return;
    }

    const payload = {
      targetType,
      notebookId: targetType === "NOTEBOOK" ? itemId || null : null,
      kitId: targetType === "KIT" ? itemId || null : null,
      chargerKitId: targetType === "CHARGER_KIT" ? itemId || null : null,
      reservationId: reservationId || null,
      category,
      severity,
      description,
      blockResource: podeBloquear && blockResource,
    };

    // O mesmo esquema da API roda aqui: erro de digitação não precisa de
    // ida ao servidor para virar mensagem.
    const conferido = createIncidentSchema.safeParse(payload);
    if (!conferido.success) {
      const campos: Record<string, string[]> = {};
      for (const issue of conferido.error.issues) {
        const chave = issue.path.join(".") || "_";
        (campos[chave] ??= []).push(issue.message);
      }
      setErrosCampo(campos);
      setErroGeral("Verifique os campos destacados.");
      return;
    }

    setEnviando(true);
    try {
      const resposta = await api.post<RespostaCriacao>(
        "/api/incidents",
        conferido.data,
      );
      setResultado(resposta);
    } catch (erro: unknown) {
      if (erro instanceof ApiError) {
        setErroGeral(erro.message);
        setErrosCampo(erro.fieldErrors);
      } else {
        setErroGeral("Não foi possível registrar a ocorrência. Tente novamente.");
      }
    } finally {
      setEnviando(false);
    }
  }

  if (resultado) {
    return (
      <OcorrenciaRegistrada
        resultado={resultado}
        onNovaOcorrencia={() => {
          setResultado(null);
          setCategory("");
          setSeverity("");
          setDescription("");
          setBlockResource(false);
          setItemId("");
          setBusca("");
        }}
      />
    );
  }

  return (
    <form onSubmit={enviar} noValidate>
      <Card>
        <CardHeader
          title="Dados da ocorrência"
          description="Quanto mais concreto o relato, menos tempo o equipamento fica parado."
        />
        <CardBody className="flex flex-col gap-5">
          {erroGeral && <Alert tone="danger">{erroGeral}</Alert>}

          <SelectField
            label="O problema é com"
            required
            value={targetType}
            onChange={(e) => trocarAlvo(e.target.value as IncidentTargetType)}
            options={ALVOS}
            error={errosCampo.targetType}
            hint='Use "A reserva inteira" para problemas que não são de um equipamento específico — por exemplo, a maleta não estava no armário combinado.'
          />

          {precisaDeItem && (
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
              <TextField
                label="Buscar equipamento"
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={
                  targetType === "NOTEBOOK"
                    ? "Patrimônio, série ou apelido"
                    : "Nome ou código"
                }
                hint="Deixe em branco para ver os primeiros 100 itens."
              />

              {/* `Spinner` e `Alert` já trazem role="status"/"alert"; um
                  aria-live aqui criaria região viva dentro de região viva. */}
              {carregandoItens && <Spinner label="Carregando equipamentos..." />}
              {erroItens && <Alert tone="danger">{erroItens}</Alert>}

              <SelectField
                label={
                  targetType === "NOTEBOOK"
                    ? "Notebook"
                    : targetType === "KIT"
                      ? "Maleta ou carrinho"
                      : "Kit de carregadores"
                }
                required
                value={itemId}
                onChange={(e) => setItemId(e.target.value)}
                options={opcoesItem}
                placeholder={
                  opcoesItem.length === 0 && !carregandoItens
                    ? "Nenhum item encontrado"
                    : "Selecione o item"
                }
                disabled={carregandoItens}
                error={
                  errosCampo.item ??
                  errosCampo.notebookId ??
                  errosCampo.kitId ??
                  errosCampo.chargerKitId
                }
              />
            </div>
          )}

          <SelectField
            label="Reserva relacionada"
            required={!isSupervisor}
            value={reservationId}
            onChange={(e) => setReservationId(e.target.value)}
            options={reservas}
            placeholder={
              reservas.length === 0
                ? "Você ainda não tem reservas registradas"
                : isSupervisor
                  ? "Sem reserva vinculada"
                  : "Selecione a reserva"
            }
            error={errosCampo.reservationId}
            hint={
              isSupervisor
                ? "Opcional para a supervisão. Vincular ajuda a reconstruir o histórico do equipamento."
                : "É por ela que a supervisão sabe quem estava com o equipamento."
            }
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <SelectField
              label="Categoria"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={categorias}
              placeholder="Selecione a categoria"
              error={errosCampo.category}
            />

            <SelectField
              label="Severidade"
              required
              value={severity}
              onChange={(e) => trocarSeveridade(e.target.value)}
              options={severidades}
              placeholder="Selecione a severidade"
              error={errosCampo.severity}
              hint="Alta ou crítica = o equipamento não deve ser usado assim."
            />
          </div>

          <TextAreaField
            label="Descrição detalhada"
            required
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={errosCampo.description}
            placeholder="Ex.: o notebook 034 desliga sozinho depois de uns 10 minutos ligado na tomada. Aconteceu duas vezes na aula de hoje, na sala 12."
            hint="Ajude a supervisão a diagnosticar: o que aconteceu, quando começou, se acontece sempre ou de vez em quando, qual sala, o que você já tentou."
          />

          {podeBloquear && (
            <Alert tone="warning" title="Este problema pode exigir bloqueio">
              <p>
                Em severidade alta ou crítica o equipamento normalmente sai de
                circulação até a supervisão conferir.
              </p>
              <div className="mt-3">
                <CheckboxField
                  label="Marcar como indisponível para novas reservas"
                  checked={blockResource}
                  onChange={(e) => setBlockResource(e.target.checked)}
                  hint="As reservas já existentes NÃO são canceladas automaticamente. A supervisão precisa avisar quem já reservou este equipamento."
                />
              </div>
            </Alert>
          )}

          <p className="text-xs text-slate-500">
            Depois de registrar, você poderá anexar fotos (JPG, PNG ou WEBP, até{" "}
            {LIMITE_ANEXO_MB} MB cada, no máximo {MAX_ANEXOS}).
          </p>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" loading={enviando}>
              Registrar ocorrência
            </Button>
            <Link
              href="/ocorrencias"
              className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
            >
              Cancelar
            </Link>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Confirmação + envio das fotos
// ---------------------------------------------------------------------------

function OcorrenciaRegistrada({
  resultado,
  onNovaOcorrencia,
}: {
  resultado: RespostaCriacao;
  onNovaOcorrencia: () => void;
}) {
  const { ocorrencia } = resultado;
  const [anexos, setAnexos] = useState<AnexoDTO[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  const atingiuLimite = anexos.length >= MAX_ANEXOS;

  async function enviarArquivo(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    if (!arquivo) return;

    setErro(null);
    setSucesso(null);

    // Checagem local antes de gastar a rede da escola com um arquivo grande
    // demais; o servidor confere de novo, inclusive os bytes do arquivo.
    if (!TIPOS_ACEITOS.includes(arquivo.type)) {
      setErro("Envie uma imagem JPG, PNG ou WEBP.");
      evento.target.value = "";
      return;
    }
    if (arquivo.size > LIMITE_ANEXO_BYTES) {
      setErro(`A imagem tem mais de ${LIMITE_ANEXO_MB} MB. Reduza e tente de novo.`);
      evento.target.value = "";
      return;
    }

    setEnviando(true);
    try {
      const anexo = await enviarAnexo(ocorrencia.id, arquivo);
      setAnexos((atuais) => [...atuais, anexo]);
      setSucesso(`Foto "${anexo.fileName}" anexada.`);
    } catch (falha: unknown) {
      setErro(
        falha instanceof ApiError
          ? falha.message
          : "Não foi possível enviar a foto. Tente novamente.",
      );
    } finally {
      setEnviando(false);
      evento.target.value = "";
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Ocorrência ${ocorrencia.code} registrada`}
        description={ocorrencia.alvoLabel}
      />
      <CardBody className="flex flex-col gap-4">
        <Alert tone="success" title="Registro enviado para a supervisão">
          Severidade {ocorrencia.severityLabel.toLowerCase()} · situação atual:{" "}
          {ocorrencia.statusLabel}.
        </Alert>

        {resultado.aviso && <Alert tone="warning">{resultado.aviso}</Alert>}

        {resultado.recursoBloqueado && (
          <Alert tone="warning" title="Equipamento fora de circulação">
            Ele não aparece mais para novas reservas. As reservas já feitas
            continuam valendo — a supervisão precisa avisar quem seria afetado.
          </Alert>
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-slate-900">
            Anexar fotos (opcional)
          </h2>
          <p className="text-sm text-slate-600">
            Uma foto do dano resolve metade do diagnóstico. Aceitamos JPG, PNG ou
            WEBP de até {LIMITE_ANEXO_MB} MB, no máximo {MAX_ANEXOS} por
            ocorrência.
          </p>

          <div>
            <label
              htmlFor="anexo-ocorrencia"
              className="text-sm font-medium text-slate-700"
            >
              Escolher foto
            </label>
            <input
              id="anexo-ocorrencia"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={enviarArquivo}
              disabled={enviando || atingiuLimite}
              className="mt-1.5 block w-full min-h-11 cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 file:mr-3 file:min-h-9 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:text-sm file:font-medium file:text-slate-800 focus:outline-2 focus:outline-offset-0 focus:outline-sky-600 disabled:cursor-not-allowed disabled:bg-slate-50"
            />
          </div>

          <div className="flex flex-col gap-2 empty:hidden">
            {enviando && <Spinner label="Enviando foto..." />}
            {erro && <Alert tone="danger">{erro}</Alert>}
            {sucesso && <Alert tone="success">{sucesso}</Alert>}
            {atingiuLimite && (
              <Alert tone="info">
                Limite de {MAX_ANEXOS} fotos atingido nesta ocorrência.
              </Alert>
            )}
          </div>

          {anexos.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {anexos.map((anexo) => (
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
                      {anexo.fileName}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-4">
          <Link
            href={`/ocorrencias/${ocorrencia.id}`}
            className="inline-flex min-h-11 items-center justify-center rounded-lg bg-sky-700 px-4 text-sm font-medium text-white transition-colors hover:bg-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
          >
            Ver a ocorrência
          </Link>
          <Button variant="outline" onClick={onNovaOcorrencia}>
            Registrar outro problema
          </Button>
          <Link
            href="/ocorrencias"
            className="inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
          >
            Voltar para a lista
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Envio do anexo.
 *
 * O `api-client` serializa o corpo como JSON, e o endpoint espera `multipart`;
 * por isso o `fetch` direto — mas o envelope de erro é lido do mesmo jeito, para
 * a tela exibir a mensagem do servidor e não uma genérica.
 */
async function enviarAnexo(incidentId: string, arquivo: File): Promise<AnexoDTO> {
  const corpo = new FormData();
  corpo.append("file", arquivo);

  let resposta: Response;
  try {
    resposta = await fetch(`/api/incidents/${incidentId}/attachments`, {
      method: "POST",
      body: corpo,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, undefined, "Falha de conexão ao enviar a foto.");
  }

  const texto = await resposta.text();
  let payload: unknown;
  try {
    payload = texto ? JSON.parse(texto) : undefined;
  } catch {
    payload = undefined;
  }

  if (!resposta.ok) {
    const envelope = payload as
      | {
          erro?: {
            codigo: string;
            mensagem: string;
            campos?: Record<string, string[]>;
            detalhes?: unknown;
          };
        }
      | undefined;
    throw new ApiError(resposta.status, envelope?.erro);
  }

  return (payload as { anexo: AnexoDTO }).anexo;
}
