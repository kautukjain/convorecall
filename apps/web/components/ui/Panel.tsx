import type { ReactNode } from "react";

/**
 * A panel groups related content behind one hairline and one soft shadow. It is the only
 * container in the app, which is what keeps screens from looking independently designed.
 *
 * Nesting panels is not supported on purpose — the design system asks us to avoid nested
 * cards, and inside a panel a divider does the same job with none of the visual cost.
 */
export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-border bg-surface elev-1 ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A panel's header. Sits on the raised surface so the panel body reads as the content
 * and the header as its label.
 */
export function PanelHeader({
  title,
  meta,
  icon,
  action,
}: {
  title: string;
  meta?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border bg-raised px-4 py-2.5">
      {icon && <span className="text-subtle">{icon}</span>}
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      {meta && <span className="text-xs text-subtle">{meta}</span>}
      {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
    </div>
  );
}
