"use client";

import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { FormError } from "./form";

/** Accessible modal. On small screens it becomes a bottom sheet (drawer). */
export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  size = "md",
}: {
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  trigger?: ReactNode;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <D.Trigger asChild>{trigger}</D.Trigger> : null}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-fade-in bg-ink-900/40 backdrop-blur-[2px]" />
        <D.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] animate-slide-up overflow-y-auto rounded-t-3xl bg-white p-5 shadow-pop focus:outline-none sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[8vh] sm:w-full sm:-translate-x-1/2 sm:rounded-3xl sm:p-6",
            { sm: "sm:max-w-md", md: "sm:max-w-lg", lg: "sm:max-w-2xl" }[size],
          )}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-cream-300 sm:hidden" aria-hidden />
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-lg font-semibold text-ink-900">{title}</D.Title>
              {description ? <D.Description className="mt-1 text-sm text-ink-600">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded-lg p-1 text-ink-500 hover:bg-cream-200 hover:text-ink-800" aria-label="Close">
              <X className="size-5" />
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation for consequential actions. `onConfirm` may throw/return an error message. */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "primary",
  onConfirm,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => Promise<boolean | void>;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setError(null); }} trigger={trigger} title={title} description={description} size="sm">
      {children}
      <FormError message={error} />
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant={tone === "danger" ? "danger" : "primary"}
          loading={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              const ok = await onConfirm();
              if (ok !== false) setOpen(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Something went wrong");
            } finally {
              setPending(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
