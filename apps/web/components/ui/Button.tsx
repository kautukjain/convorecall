import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * The button primitive. Six variants and no more (.cursor/rules/design-system.mdc) —
 * a seventh always turns out to be one of these six with a different opinion.
 *
 * Primary is ink rather than a brand hue: on a warm paper background, near-black is the
 * highest-contrast, quietest way to say "this is the action".
 */
type Variant = "primary" | "secondary" | "outline" | "ghost" | "link" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg border border-transparent hover:opacity-90 elev-1",
  secondary:
    "bg-surface text-fg border border-border hover:bg-raised hover:border-border-strong elev-1",
  outline:
    "bg-transparent text-fg border border-border-strong hover:bg-raised",
  ghost: "bg-transparent text-muted border border-transparent hover:bg-raised hover:text-fg",
  link: "bg-transparent text-fg border border-transparent underline decoration-border-strong decoration-1 underline-offset-4 hover:decoration-fg",
  danger:
    "bg-transparent text-danger border border-danger-border hover:bg-danger-bg",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-2.5 text-xs",
  md: "h-9 gap-2 px-3 text-sm",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  /** Swaps the leading icon for a spinner and blocks input. Keeps the label in place. */
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  children,
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  type = "button",
  disabled,
  className = "",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      /*
       * Disabled is a colour change, not an opacity change. Fading an ink-filled primary
       * leaves a mid-grey slab that is the brightest thing on a dark page while being the
       * one thing you cannot click; muting it to the raised surface reads as inactive at a
       * glance. Every variant lands on the same disabled treatment, so a form with two
       * kinds of button does not disable them two different ways.
       */
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-[background-color,border-color,color,box-shadow] duration-150 disabled:pointer-events-none disabled:border-border disabled:bg-raised disabled:text-subtle disabled:shadow-none ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? (
        <Loader2 size={14} strokeWidth={2} className="animate-spin" aria-hidden />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
