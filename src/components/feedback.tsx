"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

// In-app replacements for window.alert() and window.confirm(): toasts that do
// not block the page and are announced to screen readers, and a confirmation
// dialog that a keyboard can answer. Call sites use the promise-based
// confirm() exactly where they used window.confirm().

type Tone = "info" | "error";

interface ToastOptions {
  tone?: Tone;
  // A toast with an action stays until it is used or dismissed.
  action?: { label: string; onClick: () => void };
}

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
}

interface Feedback {
  toast: (message: string, options?: ToastOptions) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

const AUTO_DISMISS_MS = 6000;

const FeedbackContext = createContext<Feedback | null>(null);

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) {
    throw new Error("useFeedback() needs a <FeedbackProvider> above it");
  }
  return feedback;
}

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (answer: boolean) => void }) | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const toast = useCallback((message: string, options: ToastOptions = {}) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-3), { id, message, ...options }]);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    []
  );

  const answer = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && answer(false)}>
        <AlertDialogContent>
          <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
          {pending?.description ? <AlertDialogDescription>{pending.description}</AlertDialogDescription> : null}
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline" onClick={() => answer(false)}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant={pending?.destructive ? "destructive" : "default"} onClick={() => answer(true)}>
                {pending?.confirmLabel}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FeedbackContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    if (item.action) {
      return;
    }
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [item.action, onDismiss]);

  return (
    <div
      role={item.tone === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
        item.tone === "error" ? "border-rose-400/40 bg-rose-950 text-rose-50" : "border-border bg-popover text-popover-foreground"
      }`}
    >
      <p className="flex-1">{item.message}</p>
      {item.action ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            item.action?.onClick();
            onDismiss();
          }}
        >
          {item.action.label}
        </Button>
      ) : null}
      <button type="button" onClick={onDismiss} className="opacity-70 hover:opacity-100" aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
