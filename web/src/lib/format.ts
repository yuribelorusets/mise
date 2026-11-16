export interface Shown {
  value: string;
  unit: string;
}

function trim(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toString();
}

/** Show a base-unit amount in a kitchen-friendly unit: g to kg, ml to L. */
export function showQty(base: number, unit: "g" | "ml" | "each"): Shown {
  if (unit === "g" && base >= 1000) return { value: trim(base / 1000, 2), unit: "kg" };
  if (unit === "ml" && base >= 1000) return { value: trim(base / 1000, 2), unit: "L" };
  return { value: trim(base, 2), unit };
}

/** A base-unit amount that may be negative, with a real minus sign. */
export function showSigned(base: number, unit: "g" | "ml" | "each"): Shown {
  const shown = showQty(Math.abs(base), unit);
  return base < 0 ? { value: `−${shown.value}`, unit: shown.unit } : shown;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");

/** "Tue 1 Dec" for an ISO date or time. */
export function showDay(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Tue 1 Dec, 08:30" for an ISO time. */
export function showWhen(iso: string): string {
  const d = new Date(iso);
  return `${showDay(iso)}, ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Whole calendar days from one ISO time to another. */
export function daysBetween(from: string, to: string): number {
  const day = (iso: string) => {
    const d = new Date(iso);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.round((day(to) - day(from)) / 86_400_000);
}

export function showMoney(dollars: number): string {
  // The nudge keeps a half cent that binary floats store just under (38.635) rounding up.
  return `$${(Math.round(dollars * 100 + 1e-6) / 100).toFixed(2)}`;
}
