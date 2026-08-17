import { cn } from "@/lib/cn";

/**
 * Marca SENAI.
 *
 * O arquivo é o SVG oficial (public/marca/), servido como imagem e não embutido
 * como JSX: assim trocar a marca — pela assinatura regional da unidade, por
 * exemplo — é substituir um arquivo, sem tocar em código.
 *
 * A proporção 436×110 vem do original e é preservada em todos os tamanhos; o
 * manual de marcas proíbe distorcer o wordmark, então só a altura é escolhida e
 * a largura acompanha.
 */

const PROPORCAO = 436 / 110;

/**
 * Alturas em pixels. A marca é um wordmark horizontal e larga (proporção ~4:1),
 * então altura pequena vira um risco ilegível — por isso a escala começa mais
 * alta do que a de um logo quadrado começaria.
 */
const ALTURAS = {
  sm: 24,
  md: 40,
  lg: 56,
  xl: 80,
} as const;

export type LogoTamanho = keyof typeof ALTURAS;

export function Logo({
  tamanho = "md",
  variante = "cor",
  className,
  /** Some para leitores de tela quando o nome já aparece ao lado. */
  decorativo = false,
}: {
  tamanho?: LogoTamanho;
  variante?: "cor" | "negativa";
  className?: string;
  decorativo?: boolean;
}) {
  const altura = ALTURAS[tamanho];
  const largura = Math.round(altura * PROPORCAO);

  return (
    <img
      src={variante === "negativa" ? "/marca/senai-negativa.svg" : "/marca/senai.svg"}
      width={largura}
      height={altura}
      // `width`/`height` explícitos reservam o espaço antes de a imagem chegar,
      // evitando o pulo de layout no primeiro carregamento.
      style={{ height: altura, width: largura }}
      alt={decorativo ? "" : "SENAI"}
      aria-hidden={decorativo || undefined}
      className={cn("shrink-0 select-none", className)}
      draggable={false}
    />
  );
}

/**
 * Marca + nome do sistema, do jeito que aparece no cabeçalho e no login.
 *
 * A barra vertical entre a marca e o texto é a "área de proteção" que o manual
 * exige: ela impede que o nome do sistema encoste no wordmark e passe a ser
 * lido como parte dele.
 */
export function Assinatura({
  nomeDoSistema = "Reserva de Notebooks",
  instituicao,
  tamanho = "md",
  variante = "cor",
  className,
}: {
  nomeDoSistema?: string;
  instituicao?: string;
  tamanho?: LogoTamanho;
  variante?: "cor" | "negativa";
  className?: string;
}) {
  const escuro = variante === "negativa";

  return (
    <span className={cn("flex min-w-0 items-center gap-3", className)}>
      <Logo tamanho={tamanho} variante={variante} />
      <span
        aria-hidden="true"
        className={cn(
          "h-10 w-px shrink-0",
          escuro ? "bg-white/30" : "bg-slate-300",
        )}
      />
      <span className="flex min-w-0 flex-col leading-tight">
        <span
          className={cn(
            "truncate text-sm font-semibold",
            escuro ? "text-white" : "text-slate-900",
          )}
        >
          {nomeDoSistema}
        </span>
        {instituicao && (
          <span
            className={cn(
              "truncate text-xs",
              escuro ? "text-white/70" : "text-slate-500",
            )}
          >
            {instituicao}
          </span>
        )}
      </span>
    </span>
  );
}
