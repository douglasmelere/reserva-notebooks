import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Botão base do sistema.
 *
 * O estado de carregamento desabilita o botão e anuncia a mudança via
 * `aria-busy`, evitando envio duplicado de formulário — algo comum em rede
 * lenta de escola, onde o usuário clica de novo achando que não funcionou.
 */

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "ghost"
  | "outline";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-senai-700 text-white hover:bg-senai-800 focus-visible:outline-senai-700 disabled:bg-senai-300",
  secondary:
    "bg-slate-100 text-slate-800 hover:bg-slate-200 focus-visible:outline-slate-500 disabled:text-slate-400",
  danger:
    "bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700 disabled:bg-red-300",
  ghost:
    "bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-500",
  outline:
    "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-slate-500",
};

const SIZES: Record<ButtonSize, string> = {
  // min-h-11 garante alvo de toque confortável no celular (~44px).
  sm: "min-h-9 px-3 text-sm gap-1.5",
  md: "min-h-11 px-4 text-sm gap-2",
  lg: "min-h-12 px-6 text-base gap-2",
};

/**
 * `ComponentProps<"button">` (e não `ButtonHTMLAttributes`) porque inclui
 * `ref`: telas que trocam o botão pelo painel que ele abre precisam devolver o
 * foco para cá quando o painel fecha.
 */
export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  fullWidth = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center rounded-lg font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-70",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
