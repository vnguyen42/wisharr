import type { ReactNode } from "react";

export function Chip({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "err" | "accent" | "muted";
  children: ReactNode;
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}

export function Card({
  title,
  headExtra,
  children,
  noPad,
}: {
  title: string;
  headExtra?: ReactNode;
  children: ReactNode;
  noPad?: boolean;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">{title}</h2>
        <div className="spacer" />
        {headExtra}
      </div>
      {noPad ? children : <div className="card-body">{children}</div>}
    </div>
  );
}

export function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="track" />
    </label>
  );
}

export function timeAgo(iso: string): string {
  // SQLite timestamps arrive as "YYYY-MM-DD HH:MM:SS" (UTC, no zone marker);
  // normalize to strict ISO — WebKit refuses the space-separated form.
  const normalized = iso.replace(" ", "T");
  const thenMs =
    normalized.endsWith("Z") || normalized.includes("+")
      ? Date.parse(normalized)
      : Date.parse(normalized + "Z");
  const seconds = Math.max(0, Math.round((Date.now() - thenMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}
