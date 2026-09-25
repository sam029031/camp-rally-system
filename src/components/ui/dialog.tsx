"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { useIsClient } from "@/lib/client/use-is-client";

// 巢狀對話框：只有最上層的回應 Escape；body 捲動鎖用計數
const openStack: string[] = [];
let scrollLocks = 0;
let savedOverflow = "";

function lockScroll(): () => void {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks += 1;
  return () => {
    scrollLocks -= 1;
    if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
  };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  /** 使用者要求關閉（點背景、Escape、右上角 X）。dismissible=false 時只會由你自己的按鈕觸發。 */
  onClose: () => void;
  /**
   * 是否允許點背景／按 Escape／右上角 X 關閉（預設 true）。
   * 撤銷提醒（第二十二節）必須設為 false，只能按「我知道了」關閉。
   */
  dismissible?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** 底部按鈕區（大按鈕，手機上垂直排列） */
  footer?: React.ReactNode;
  /** 寬度：sm 24rem、md 32rem（預設）、lg 48rem、full 全螢幕 */
  size?: "sm" | "md" | "lg" | "full";
  /** center = 置中對話框；right = 右側抽屜（桌機）／全寬（手機）；bottom = 底部抽屜 */
  placement?: "center" | "right" | "bottom";
  /** 對話框本體額外 class */
  className?: string;
  /** 語意：alertdialog（需要使用者回應的警示）或 dialog */
  role?: "dialog" | "alertdialog";
}

const SIZE: Record<NonNullable<DialogProps["size"]>, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-3xl",
  full: "sm:max-w-none",
};

/**
 * 模態對話框／抽屜（無第三方依賴）。
 * - 開啟時鎖住背景捲動、焦點移到對話框內並在 Tab 時循環；關閉後焦點回到原本的元素。
 * - 放在 document.body 的 portal。
 */
export function Dialog({
  open,
  onClose,
  dismissible = true,
  title,
  description,
  children,
  footer,
  size = "md",
  placement = "center",
  className,
  role = "dialog",
}: DialogProps) {
  const isClient = useIsClient();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;

  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });

  React.useEffect(() => {
    if (!open) return;
    openStack.push(id);
    const unlock = lockScroll();
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    if (panel) {
      const auto = panel.querySelector<HTMLElement>("[data-autofocus]");
      (auto ?? panel).focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      if (e.key === "Escape") {
        if (dismissible) {
          e.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        );
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const idx = openStack.lastIndexOf(id);
      if (idx >= 0) openStack.splice(idx, 1);
      unlock();
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [open, id, dismissible]);

  if (!open || !isClient) return null;

  const placementClass =
    placement === "right"
      ? "inset-y-0 right-0 h-full w-full sm:w-[28rem] sm:max-w-[90vw] rounded-none sm:rounded-l-2xl"
      : placement === "bottom"
        ? "inset-x-0 bottom-0 max-h-[90dvh] w-full rounded-t-2xl"
        : cn(
            "left-1/2 top-1/2 max-h-[92dvh] w-[calc(100%-1.5rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl",
            SIZE[size],
            size === "full" && "h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)]",
          );

  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <div
        className="absolute inset-0 bg-slate-950/70"
        aria-hidden
        onClick={() => {
          if (dismissible) onClose();
        }}
      />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          "absolute flex flex-col overflow-hidden border-2 border-slate-300 bg-white text-slate-900 shadow-2xl outline-none",
          "pb-safe",
          placementClass,
          className,
        )}
      >
        {(title || dismissible) && (
          <div className="flex shrink-0 items-start gap-3 border-b-2 border-slate-200 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3">
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id={titleId} className="text-xl font-bold leading-snug">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 text-base text-slate-700">
                  {description}
                </p>
              )}
            </div>
            {dismissible && (
              <button
                type="button"
                onClick={onClose}
                className="-mr-1 inline-flex size-12 shrink-0 items-center justify-center rounded-xl text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60"
                aria-label="關閉"
              >
                <X className="size-7" aria-hidden />
              </button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {footer && <div className="flex shrink-0 flex-col gap-3 border-t-2 border-slate-200 p-4 sm:flex-row-reverse">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
