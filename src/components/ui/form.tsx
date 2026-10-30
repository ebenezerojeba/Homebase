"use client";

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { formatKobo, parseNairaToKobo } from "@/lib/money";

const control =
  "block w-full rounded-xl border border-cream-300 bg-white px-3.5 text-sm text-ink-900 shadow-xs placeholder:text-ink-400 transition-colors focus:border-emerald-600 focus:outline-none focus:ring-3 focus:ring-emerald-600/15 disabled:bg-cream-100 disabled:text-ink-500 aria-[invalid=true]:border-rose-700 aria-[invalid=true]:ring-rose-700/10";

export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: string | string[];
  required?: boolean;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }) => ReactNode;
}

/** Label + control + hint + error wired together for screen readers. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const err = Array.isArray(error) ? error[0] : error;
  const describedBy = [hint ? hintId : null, err ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-800">
        {label}
        {required ? <span className="text-rose-700" aria-hidden="true"> *</span> : null}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": err ? true : undefined, required })}
      {hint && !err ? (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      ) : null}
      {err ? (
        <p id={errId} className="text-xs font-medium text-rose-700">
          {err}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-2.5", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%236b7685%22><path d=%22M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z%22/></svg>')] bg-[length:18px] bg-[right_0.75rem_center] bg-no-repeat pr-10", className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ label, description, className, ...props }: ComponentProps<"input"> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn("flex gap-3", className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-4.5 shrink-0 rounded border-cream-300 accent-emerald-700" {...props} />
      <label htmlFor={id} className="text-sm text-ink-800">
        {label}
        {description ? <span className="mt-0.5 block text-xs text-ink-500">{description}</span> : null}
      </label>
    </div>
  );
}

/**
 * Naira input that reports integer kobo to the form. Users type naira ("150,000"),
 * conversion to kobo is exact (no floating point).
 */
export function MoneyInput({
  valueKobo,
  onChangeKobo,
  className,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & { valueKobo: number | null; onChangeKobo: (kobo: number | null) => void }) {
  const [text, setText] = useState(valueKobo !== null ? formatKobo(valueKobo, { symbol: false }).replace(/\.00$/, "") : "");
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-ink-500">₦</span>
      <input
        inputMode="decimal"
        autoComplete="off"
        className={cn(control, "tabular h-11 pl-8", className)}
        value={text}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.,]/g, "");
          setText(v);
          onChangeKobo(v ? parseNairaToKobo(v) : null);
        }}
        onBlur={() => {
          const k = text ? parseNairaToKobo(text) : null;
          if (k !== null) setText(formatKobo(k, { symbol: false }).replace(/\.00$/, ""));
        }}
        {...props}
      />
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-rose-700/20 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {message}
    </p>
  );
}
