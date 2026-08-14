"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";

/**
 * Copies text and says so. The confirmation replaces the label in place rather than
 * arriving as a toast — the feedback belongs where the click happened, and a toast for
 * something this small interrupts more than it reassures.
 */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // A click on the way out would otherwise set state on an unmounted component.
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard denied or unavailable; the text is on screen and selectable. */
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void copy()}
      icon={
        copied ? (
          <Check size={13} strokeWidth={2} aria-hidden />
        ) : (
          <Copy size={13} strokeWidth={2} aria-hidden />
        )
      }
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
