import { RefObject, useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isElementVisible(element: HTMLElement): boolean {
  if (element.hidden) {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => isElementVisible(element));
}

type UseDialogFocusTrapInput = {
  isOpen: boolean;
  containerRef: RefObject<HTMLElement>;
};

export function useDialogFocusTrap({
  isOpen,
  containerRef,
}: UseDialogFocusTrapInput): void {
  const previousFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    previousFocusedElementRef.current = document.activeElement as HTMLElement | null;

    const animationFrame = window.requestAnimationFrame(() => {
      const focusable = getFocusableElements(container);
      if (focusable.length > 0) {
        focusable[0]?.focus();
        return;
      }

      if (!container.hasAttribute("tabindex")) {
        container.setAttribute("tabindex", "-1");
      }
      container.focus();
    });

    function handleTabNavigation(event: KeyboardEvent) {
      if (event.key !== "Tab") {
        return;
      }

      const nextContainer = containerRef.current;
      if (!nextContainer) {
        return;
      }

      const focusable = getFocusableElements(nextContainer);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;
      const activeInside = activeElement
        ? nextContainer.contains(activeElement)
        : false;

      if (event.shiftKey) {
        if (!activeInside || activeElement === firstElement) {
          event.preventDefault();
          lastElement?.focus();
        }
        return;
      }

      if (!activeInside || activeElement === lastElement) {
        event.preventDefault();
        firstElement?.focus();
      }
    }

    document.addEventListener("keydown", handleTabNavigation);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleTabNavigation);

      const previous = previousFocusedElementRef.current;
      if (previous && typeof previous.focus === "function") {
        previous.focus();
      }
    };
  }, [containerRef, isOpen]);
}

