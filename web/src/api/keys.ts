/** Everything owner-side starts with "kitchen", so one prefix can invalidate a group. */
export const keys = {
  owner: ["owner"] as const,
  config: ["config"] as const,
  catalog: ["kitchen", "catalog"] as const,
  stock: ["kitchen", "stock"] as const,
  history: (item: string) => ["kitchen", "stock", item, "history"] as const,
  today: ["kitchen", "today"] as const,
  plans: ["kitchen", "plans"] as const,
  planResult: (id: string) => ["kitchen", "plans", id, "result"] as const,
  cost: (item: string, qty: number, unit: string) => ["kitchen", "cost", item, qty, unit] as const,
  maxBatch: (item: string, unit: string) => ["kitchen", "max-batch", item, unit] as const,
  proposals: ["kitchen", "proposals"] as const,
};
