import { requireSupervisor } from "@/lib/auth";
import { formatDateTimeBR, todayLocal } from "@/lib/datetime";
import { isAppError } from "@/lib/errors";
import { PageHeader } from "@/components/ui/primitives";
import { REPORT_TYPES, buildReport, type ReportResult } from "@/server/reports";
import { Painel, type RelatorioParaTela, type TipoRelatorio } from "./painel";

export const dynamic = "force-dynamic";

/**
 * Relatórios da supervisão.
 *
 * O relatório é montado aqui, no servidor, pelo mesmo `buildReport` que a rota
 * de exportação usa — a tabela na tela e o arquivo CSV nunca divergem, porque
 * não existe uma segunda implementação. O recorte vive na URL, então um
 * relatório específico pode ser guardado nos favoritos.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** Nomes legíveis para as chaves do resumo devolvido pelo serviço. */
const ROTULO_RESUMO: Record<string, string> = {
  recursosUtilizados: "Equipamentos utilizados",
  totalReservas: "Total de reservas",
  totalHorasOcupadas: "Horas ocupadas",
  horasOperacionaisPorDia: "Horas de funcionamento por dia",
  professores: "Professores",
  mediaPorProfessor: "Média por professor",
  total: "Total",
  abertas: "Em aberto",
  resolvidas: "Resolvidas",
  recursosAfetados: "Equipamentos afetados",
  tempoMedioResolucaoHoras: "Tempo médio de resolução (h)",
  tentativasComConflito: "Tentativas com conflito",
  contatosWhatsappGerados: "Contatos por WhatsApp",
  professoresContatados: "Professores contatados",
  kits: "Kits",
  notebooks: "Notebooks",
  kitsDeCarregadores: "Kits de carregadores",
  maiorTempoForaDias: "Maior tempo fora (dias)",
  exibidas: "Linhas exibidas",
  truncado: "Resultado truncado",
};

/** "totalHorasOcupadas" -> "Total horas ocupadas". */
function humaniza(chave: string): string {
  const texto = chave.replace(/([A-Z])/g, " $1").toLowerCase().trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function formataValorDeResumo(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number") {
    return Number.isInteger(valor) ? String(valor) : valor.toFixed(1).replace(".", ",");
  }
  return String(valor);
}

function ehTipoValido(valor: string): valor is TipoRelatorio {
  return (REPORT_TYPES as readonly string[]).includes(valor);
}

function texto(valor: string | string[] | undefined): string {
  if (Array.isArray(valor)) return valor[0] ?? "";
  return valor ?? "";
}

function ehData(valor: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

/**
 * Converte o resultado do serviço no formato que a tela consome.
 *
 * Frases longas do resumo (as "observações") saem dos cartões numéricos: um
 * parágrafo espremido dentro de um indicador não é legível nem no celular.
 */
function paraTela(relatorio: ReportResult): RelatorioParaTela {
  const resumo: { rotulo: string; valor: string }[] = [];
  const observacoes: string[] = [];

  for (const [chave, valor] of Object.entries(relatorio.resumo)) {
    if (typeof valor === "string" && valor.length > 40) {
      observacoes.push(valor);
      continue;
    }
    resumo.push({
      rotulo: ROTULO_RESUMO[chave] ?? humaniza(chave),
      valor: formataValorDeResumo(valor),
    });
  }

  return {
    tipo: relatorio.tipo,
    titulo: relatorio.titulo,
    periodo: relatorio.periodo
      ? {
          from: relatorio.periodo.from,
          to: relatorio.periodo.to,
          formatado: relatorio.periodo.formatado,
        }
      : null,
    geradoEmFormatado: formatDateTimeBR(new Date(relatorio.geradoEm)),
    resumo,
    observacoes,
    principal: {
      titulo: relatorio.titulo,
      colunas: relatorio.colunas,
      linhas: relatorio.linhas,
    },
    extras: relatorio.tabelasExtras.map((extra) => ({
      titulo: extra.titulo,
      colunas: extra.colunas,
      linhas: extra.linhas,
    })),
  };
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSupervisor();
  const sp = await searchParams;

  const tipoInformado = texto(sp.tipo);
  const tipo: TipoRelatorio = ehTipoValido(tipoInformado) ? tipoInformado : "utilizacao";
  const from = ehData(texto(sp.from)) ? texto(sp.from) : "";
  const to = ehData(texto(sp.to)) ? texto(sp.to) : "";

  let relatorio: RelatorioParaTela | null = null;
  let erro: string | null = null;

  try {
    relatorio = paraTela(
      await buildReport(tipo, { from: from || null, to: to || null }),
    );
  } catch (falha) {
    // Período invertido é erro do usuário e vira mensagem na tela; qualquer
    // outra falha continua subindo para o error boundary.
    if (isAppError(falha)) erro = falha.message;
    else throw falha;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Relatórios"
        description="Números de uso, ocorrências e disponibilidade — na tela e em CSV para o Excel."
      />

      <Painel
        relatorio={relatorio}
        erro={erro}
        hoje={todayLocal()}
        filtros={{ tipo, from, to }}
      />
    </div>
  );
}
