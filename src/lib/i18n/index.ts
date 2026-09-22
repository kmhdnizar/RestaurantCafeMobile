import en from "./en";
import ms from "./ms";
import type { Dictionary } from "./en";
import { useLocaleStore, type Locale } from "@/state/locale-store";

export type { Locale } from "@/state/locale-store";

const dictionaries: Record<Locale, Dictionary> = { en, ms };

// Dotted-path union of every leaf key in the dictionary, e.g. "common.save",
// "newOrder.title" — gives autocomplete/typo-checking on every t() call.
type Path<T, Prefix extends string = ""> = T extends string
  ? Prefix
  : { [K in keyof T & string]: Path<T[K], Prefix extends "" ? K : `${Prefix}.${K}`> }[keyof T & string];

export type TKey = Path<Dictionary>;

function resolve(dict: Dictionary, key: string): string {
  const value = key.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), dict);
  return typeof value === "string" ? value : key;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] !== undefined ? String(params[name]) : match));
}

export function useT() {
  const locale = useLocaleStore((s) => s.locale);
  return (key: TKey, params?: Record<string, string | number>) => interpolate(resolve(dictionaries[locale], key), params);
}
