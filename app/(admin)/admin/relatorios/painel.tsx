"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import {
  Alert,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Stat,
  TableWrapper,
  Td,
  Th,
} from "@/components/ui/primitives";
import { addDays } from "@/lib/datetime";

/**
 * Painel de relatórios.
 *
 * O relatório em si é montado no servidor a cada navegação — este componente
 * cuida da escolha do recorte e da leitura do resultado. A exportação é um
 * link direto para a API: o navegador baixa o CSV sozinho, o que também faz o
 * arquivo funcionar em "abrir em nova aba" e em "salvar link como".
 */

export type TipoRelatorio =
  | "utilizacao"
  | "professores"
  | "ocorrencias"
  | "conflitos"
  | "indisponiveis"
  | "historico";

export type ColunaRelatorio = {
  chave: string;
  rotulo: string;
  tipo?: "texto" | "numero" | "data" | "percentual";
};

export type TabelaRelatorio = {
  titulo: string;
  colunas: ColunaRelatorio[];
  linhas: Record<string, unknown>[];
};

export type RelatorioParaTela = {
  tipo: TipoRelatorio;
  titulo: string;
  periodo: { from: string; to: string; formatado: string } | null;
  geradoEmFormatado: string;
  resumo: { rotulo: string; valor: string }[];
  /** Frases do resumo que não cabem em um número — ficam fora dos cartões. */
  observacoes: string[];
  principal: TabelaRelatorio;
  extras: TabelaRelatorio[];
};

export const TIPOS_DE_RELATORIO: {
  valor: TipoRelatorio;
  rotulo: string;
  explicacao: string;
  usaPeriodo: boolean;
}[] = [
  {
    valor: "utilizacao",
    rotulo: "Utilização de equipamentos",
    explicacao:
      "Quantas reservas e quantas horas cada kit e cada notebook ficaram ocupados. Mostra o que é disputado e o que está parado.",
    usaPeriodo: true,
  },
  {
    valor: "professores",
    rotulo: "Reservas por professor",
    explicacao:
      "Quantas reservas cada professor fez no período, separadas por situação — inclusive cancelamentos e não comparecimentos.",
    usaPeriodo: true,
  },
  {
    valor: "ocorrencias",
    rotulo: "Ocorrências",
    explicacao:
      "Problemas registrados por equipamento, com recortes por categoria, severidade e situação.",
    usaPeriodo: true,
  },
  {
    valor: "conflitos",
    rotulo: "Conflitos e contatos",
    explicacao:
      "Tentativas de reserva que esbarraram em equipamento ocupado e os contatos por WhatsApp gerados a partir delas.",
    usaPeriodo: true,
  },
  {
    valor: "indisponiveis",
    rotulo: "Recursos indisponíveis",
    explicacao:
      "Fotografia do que está fora de circulação agora: manutenção, perdido, indisponível ou desativado.",
    usaPeriodo: false,
  },
  {
    valor: "historico",
    rotulo: "Histórico de reservas",
    explicacao:
      "Lista completa das reservas do período, com professor, equipamento, sala, retirada e devolução.",
    usaPeriodo: true,
  },
];

/** Coluna que ganha barra de leitura em cada relatório. */
const COLUNA_DA_BARRA: Record<TipoRelatorio, string | null> = {
  utilizacao: "horasOcupadas",
  professores: "total",
  ocorrencias: "total",
  conflitos: null,
  indisponiveis: "diasIndisponivel",
  historico: null,
};

/** Teto do que é desenhado na tela; o CSV continua trazendo tudo. */
const LINHAS_NA_TELA = 200;

function formataCelula(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number") {
    return Number.isInteger(valor) ? String(valor) : valor.toFixed(1).replace(".", ",");
  }
  if (Array.isArray(valor)) return valor.map((item) => String(item)).join(", ");
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

function comoNumero(valor: unknown): number | null {
  return typeof valor === "number" && Number.isFinite(valor) ? valor : null;
}

export function Painel({
  relatorio,
  erro,
  hoje,
  filtros,
}: {
  relatorio: RelatorioParaTela | null;
  erro: string | null;
  hoje: string;
  filtros: { tipo: TipoRelatorio; from: string; to: string };
}) {
  const router = useRouter();
  const [pendente, iniciarTransicao] = useTransition();

  const [form, setForm] = useState(filtros);

  const assinatura = JSON.stringify(filtros);
  useEffect(() => {
    setForm(JSON.parse(assinatura) as typeof filtros);
  }, [assinatura]);

  const definicao =
    TIPOS_DE_RELATORIO.find((item) => item.valor === form.tipo) ?? TIPOS_DE_RELATORIO[0]!;

  function navegar(proximo: { tipo: TipoRelatorio; from: string; to: string }): void {
    const params = new URLSearchParams({ tipo: proximo.tipo });
    if (proximo.from) params.set("from", proximo.from);
    if (proximo.to) params.set("to", proximo.to);
    iniciarTransicao(() => {
      router.push(`/admin/relatorios?${params.toString()}`);
    });
  }

  function aplicar(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault();
    navegar(form);
  }

  function atalho(inicio: string): void {
    const proximo = { ...form, from: inicio, to: hoje };
    setForm(proximo);
    navegar(proximo);
  }

  // A exportação segue o recorte já aplicado (o que está na tela), e não o
  // formulário em edição — evita baixar um arquivo diferente do que se vê.
  const paramsCsv = new URLSearchParams({ tipo: filtros.tipo, formato: "csv" });
  if (filtros.from) paramsCsv.set("from", filtros.from);
  if (filtros.to) paramsCsv.set("to", filtros.to);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader
          title="Escolha o relatório"
          description="Todos os relatórios podem ser baixados em CSV, prontos para abrir no Excel."
        />
        <CardBody>
          <form onSubmit={aplicar} className="flex flex-col gap-4">
            <SelectField
              label="Tipo de relatório"
              value={form.tipo}
              options={TIPOS_DE_RELATORIO.map((item) => ({
                value: item.valor,
                label: item.rotulo,
              }))}
              onChange={(evento) => {
                const proximo = {
                  ...form,
                  tipo: evento.target.value as TipoRelatorio,
                };
                setForm(proximo);
                // Trocar de relatório recarrega na hora: ninguém espera ter de
                // confirmar duas vezes para ver outro relatório.
                navegar(proximo);
              }}
              hint={definicao.explicacao}
            />

            {definicao.usaPeriodo ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    label="De"
                    type="date"
                    value={form.from}
                    max={form.to || undefined}
                    onChange={(evento) =>
                      setForm((atual) => ({ ...atual, from: evento.target.value }))
                    }
                    hint="Em branco: últimos 30 dias."
                  />
                  <TextField
                    label="Até"
                    type="date"
                    value={form.to}
                    min={form.from || undefined}
                    onChange={(evento) =>
                      setForm((atual) => ({ ...atual, to: evento.target.value }))
                    }
                    hint="Em branco: até hoje."
                  />
                </div>

                <fieldset>
                  <legend className="pb-2 text-sm font-medium text-slate-700">
                    Atalhos de período
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={pendente}
                      onClick={() => atalho(addDays(hoje, -30))}
                    >
                      Últimos 30 dias
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pendente}
                      onClick={() => atalho(`${hoje.slice(0, 7)}-01`)}
                    >
                      Este mês
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pendente}
                      onClick={() => atalho(`${hoje.slice(0, 4)}-01-01`)}
                    >
                      Este ano
                    </Button>
                  </div>
                </fieldset>
              </>
            ) : (
              <Alert tone="info">
                Este relatório mostra a posição de agora e não usa período.
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={pendente}>
                Gerar relatório
              </Button>
              <a
                href={`/api/admin/reports?${paramsCsv.toString()}`}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
              >
                <span aria-hidden="true">⬇</span>
                Exportar CSV
              </a>
            </div>

            {/* Anuncia também o desfecho: sem isso o leitor de tela ouvia
                "gerando..." e nunca era avisado de que o relatório chegou. */}
            <p aria-live="polite" className="text-xs text-slate-500">
              {pendente
                ? "Gerando o relatório..."
                : relatorio
                  ? `${relatorio.titulo}: ${relatorio.principal.linhas.length} linha(s) no recorte atual.`
                  : ""}
            </p>
          </form>
        </CardBody>
      </Card>

      {erro && (
        <Alert tone="danger" title="Não foi possível gerar o relatório">
          {erro}
        </Alert>
      )}

      {relatorio && (
        <>
          <Card>
            <CardHeader
              title={relatorio.titulo}
              description={
                relatorio.periodo
                  ? `Período: ${relatorio.periodo.formatado} · gerado em ${relatorio.geradoEmFormatado}`
                  : `Posição de ${relatorio.geradoEmFormatado}`
              }
            />
            <CardBody className="flex flex-col gap-4">
              {relatorio.resumo.length === 0 ? (
                <p className="text-sm text-slate-600">Sem números de resumo.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {relatorio.resumo.map((item) => (
                    <Stat key={item.rotulo} label={item.rotulo} value={item.valor} />
                  ))}
                </div>
              )}

              {relatorio.observacoes.length > 0 && (
                <Alert tone="info" title="Como ler estes números">
                  <ul className="ml-4 list-disc space-y-1">
                    {relatorio.observacoes.map((observacao) => (
                      <li key={observacao}>{observacao}</li>
                    ))}
                  </ul>
                </Alert>
              )}
            </CardBody>
          </Card>

          <Tabela
            tabela={relatorio.principal}
            colunaDaBarra={COLUNA_DA_BARRA[relatorio.tipo]}
            vazio={{
              titulo: "Nenhum resultado no período",
              descricao:
                "Amplie o período com um dos atalhos acima ou escolha outro relatório. Reservas canceladas e não comparecimentos não entram no cálculo de uso.",
            }}
          />

          {relatorio.extras.map((extra) => (
            <Tabela
              key={extra.titulo}
              tabela={extra}
              colunaDaBarra="quantidade"
              vazio={{
                titulo: "Sem dados neste recorte",
                descricao: "Nada foi registrado no período escolhido.",
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Tabela({
  tabela,
  colunaDaBarra,
  vazio,
}: {
  tabela: TabelaRelatorio;
  colunaDaBarra: string | null;
  vazio: { titulo: string; descricao: string };
}) {
  const linhas = tabela.linhas.slice(0, LINHAS_NA_TELA);
  const truncado = tabela.linhas.length > linhas.length;

  const maximo = colunaDaBarra
    ? tabela.linhas.reduce((maior, linha) => {
        const valor = comoNumero(linha[colunaDaBarra]);
        return valor !== null && valor > maior ? valor : maior;
      }, 0)
    : 0;

  return (
    <Card>
      <CardHeader
        title={tabela.titulo}
        description={`${tabela.linhas.length} linha(s).`}
      />
      <CardBody className="flex flex-col gap-3">
        {tabela.linhas.length === 0 ? (
          <EmptyState title={vazio.titulo} description={vazio.descricao} />
        ) : (
          <>
            {truncado && (
              <Alert tone="info">
                Exibindo as primeiras {LINHAS_NA_TELA} linhas de{" "}
                {tabela.linhas.length}. O arquivo CSV traz todas.
              </Alert>
            )}

            {/* Celular: cada linha vira um cartão rotulado — uma tabela com
                tantas colunas fica ilegível numa tela estreita. */}
            <ul className="flex flex-col gap-3 lg:hidden">
              {linhas.map((linha, indice) => (
                <li
                  key={indice}
                  className="rounded-lg border border-slate-200 px-3 py-3"
                >
                  <dl className="flex flex-col gap-1">
                    {tabela.colunas.map((coluna) => (
                      <div key={coluna.chave} className="flex flex-wrap gap-2 text-sm">
                        <dt className="text-slate-500">{coluna.rotulo}:</dt>
                        <dd className="font-medium text-slate-900">
                          {formataCelula(linha[coluna.chave])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>

            <div className="hidden lg:block">
              <TableWrapper>
                <caption className="sr-only">{tabela.titulo}</caption>
                <thead>
                  <tr>
                    {tabela.colunas.map((coluna) => (
                      <Th key={coluna.chave}>{coluna.rotulo}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((linha, indice) => (
                    <tr key={indice} className="hover:bg-slate-50">
                      {tabela.colunas.map((coluna) => {
                        const valor = linha[coluna.chave];
                        const numero =
                          colunaDaBarra === coluna.chave ? comoNumero(valor) : null;

                        return (
                          <Td
                            key={coluna.chave}
                            className={
                              coluna.tipo === "numero" || coluna.tipo === "percentual"
                                ? "tabular-nums"
                                : undefined
                            }
                          >
                            {numero !== null && maximo > 0 ? (
                              <span className="flex items-center gap-2">
                                <span className="w-12 shrink-0 text-right tabular-nums">
                                  {formataCelula(valor)}
                                </span>
                                <span
                                  aria-hidden="true"
                                  className="block h-2 w-24 rounded-full bg-slate-100"
                                >
                                  <span
                                    className="block h-2 rounded-full bg-senai-600"
                                    style={{
                                      width: `${Math.max(2, Math.round((numero / maximo) * 100))}%`,
                                    }}
                                  />
                                </span>
                              </span>
                            ) : (
                              formataCelula(valor)
                            )}
                          </Td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </TableWrapper>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
