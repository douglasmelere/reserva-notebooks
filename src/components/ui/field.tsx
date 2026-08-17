"use client";

import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Campos de formulário acessíveis.
 *
 * `Field` amarra rótulo, dica e mensagem de erro ao controle por `id` e
 * `aria-describedby`, e marca `aria-invalid` quando há erro. Isso faz o leitor
 * de tela anunciar o problema junto com o campo, em vez de deixar a mensagem
 * solta na tela.
 */

const controlBase =
  "w-full rounded-lg border bg-white px-3 py-2.5 text-slate-900 shadow-xs " +
  "placeholder:text-slate-400 focus:outline-2 focus:outline-offset-0 focus:outline-senai-600 " +
  "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

const controlState = (hasError: boolean) =>
  hasError
    ? "border-red-500 focus:outline-red-600"
    : "border-slate-300 hover:border-slate-400";

type FieldShellProps = {
  label: string;
  hint?: ReactNode;
  error?: string | string[] | null;
  required?: boolean;
  className?: string;
  children: (ids: {
    id: string;
    describedBy: string | undefined;
    hasError: boolean;
  }) => ReactNode;
};

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const errorText = Array.isArray(error) ? error.join(" ") : error;
  const hasError = Boolean(errorText);

  const describedBy =
    [hint ? hintId : null, hasError ? errorId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
        {required && (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (obrigatório)</span>}
      </label>

      {children({ id, describedBy, hasError })}

      {hint && !hasError && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {hasError && (
        <p id={errorId} className="text-xs font-medium text-red-700">
          {errorText}
        </p>
      )}
    </div>
  );
}

export type TextFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "className"
> & {
  label: string;
  hint?: ReactNode;
  error?: string | string[] | null;
  className?: string;
};

export function TextField({
  label,
  hint,
  error,
  className,
  required,
  ...rest
}: TextFieldProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      {({ id, describedBy, hasError }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          required={required}
          className={cn(controlBase, controlState(hasError))}
          {...rest}
        />
      )}
    </Field>
  );
}

export type TextAreaFieldProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id" | "className"
> & {
  label: string;
  hint?: ReactNode;
  error?: string | string[] | null;
  className?: string;
};

export function TextAreaField({
  label,
  hint,
  error,
  className,
  required,
  rows = 3,
  ...rest
}: TextAreaFieldProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      {({ id, describedBy, hasError }) => (
        <textarea
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          required={required}
          className={cn(controlBase, controlState(hasError), "resize-y")}
          {...rest}
        />
      )}
    </Field>
  );
}

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectFieldProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id" | "className" | "children"
> & {
  label: string;
  options: SelectOption[];
  placeholder?: string;
  hint?: ReactNode;
  error?: string | string[] | null;
  className?: string;
};

export function SelectField({
  label,
  options,
  placeholder,
  hint,
  error,
  className,
  required,
  ...rest
}: SelectFieldProps) {
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      {({ id, describedBy, hasError }) => (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={hasError || undefined}
          required={required}
          className={cn(controlBase, controlState(hasError), "pr-8")}
          {...rest}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export type CheckboxFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type" | "className"
> & {
  label: string;
  hint?: ReactNode;
  error?: string | string[] | null;
  className?: string;
};

export function CheckboxField({
  label,
  hint,
  error,
  className,
  ...rest
}: CheckboxFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorText = Array.isArray(error) ? error.join(" ") : error;

  return (
    <div className={cn("flex gap-3", className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={hint ? hintId : undefined}
        aria-invalid={Boolean(errorText) || undefined}
        className="mt-0.5 size-5 shrink-0 rounded border-slate-300 text-senai-700 focus:outline-2 focus:outline-offset-2 focus:outline-senai-600"
        {...rest}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {hint && (
          <p id={hintId} className="text-xs text-slate-500">
            {hint}
          </p>
        )}
        {errorText && (
          <p className="text-xs font-medium text-red-700">{errorText}</p>
        )}
      </div>
    </div>
  );
}
