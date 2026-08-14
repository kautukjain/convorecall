/**
 * The mark: three bars of a waveform, then a tick. The call, then the receipt — which is
 * the entire product in four strokes.
 *
 * Drawn in `currentColor` rather than the icon's own palette so it inherits pine in the
 * header and ink wherever it needs to sit quietly. `app/icon.svg` is the same drawing on
 * a fixed dark tile, because a favicon cannot inherit anything.
 */
export function Mark({ size = 18 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <g strokeWidth={2.6}>
        <line x1="4" y1="13" x2="4" y2="19" />
        <line x1="9.5" y1="8.5" x2="9.5" y2="23.5" />
        <line x1="15" y1="12" x2="15" y2="20" />
      </g>
      <path d="M19.5 16.5l3.2 3.2 6.3-6.9" strokeWidth={2.8} />
    </svg>
  );
}

/**
 * Mark plus name. The name is set in the display serif at a small size, which is where a
 * serif earns its keep — it reads as a masthead rather than as a logo built from the same
 * font as the interface around it.
 */
export function Wordmark() {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span className="translate-y-[0.1875rem] text-brand">
        <Mark size={17} />
      </span>
      <span className="font-serif text-[0.9375rem] font-medium tracking-[-0.01em] text-fg">
        Convo<span className="text-muted">Recall</span>
      </span>
    </span>
  );
}
