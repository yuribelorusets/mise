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
