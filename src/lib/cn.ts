/**
 * Concatenação condicional de classes CSS.
 *
 * Pequena o bastante para não valer uma dependência: aceita strings, falsos e
 * objetos `{ classe: condição }`, na mesma forma do `clsx`.
 */
type ClassValue =
  | string
  | number
  | bigint
  | null
  | undefined
  | boolean
  | Record<string, boolean | null | undefined>
  | ClassValue[];

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];

  const walk = (value: ClassValue): void => {
    if (!value) return;
    if (typeof value === "string" || typeof value === "number") {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const [key, enabled] of Object.entries(value)) {
      if (enabled) out.push(key);
    }
  };

  for (const value of values) walk(value);
  return out.join(" ");
}
