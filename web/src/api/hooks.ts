// Every call to the server goes through here. Pages use these hooks and never call fetch themselves.
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { ApiError, apiDelete, apiGet, apiPost } from "./client";
import { keys } from "./keys";
import type {
  AssistantReply, Catalog, ConfirmResult, CostResult, PlanResult, ProductionPlan, ProposalLine, ProposalView,
  PublicConfig, StockEvent, StockView, TodayView,
} from "./types";

const enc = encodeURIComponent;

/** A booking can change stock, so everything worked out from stock is refetched. The catalog isn't. */
export function stockChanged(qc: QueryClient) {
  const stale = [keys.stock, keys.today, keys.plans, ["kitchen", "cost"], ["kitchen", "max-batch"], keys.proposals];
  return Promise.all(stale.map((queryKey) => qc.invalidateQueries({ queryKey })));
}

/** Writes a proposal the server just returned into the cached list, so its card changes at once. */
function putProposal(qc: QueryClient, p: ProposalView) {
  qc.setQueryData<ProposalView[]>(keys.proposals, (list) => (Array.isArray(list) ? list : undefined)?.map((x) => (x.id === p.id ? p : x)));
}

const newId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

// Owner

export function useOwner() {
  return useQuery({
    queryKey: keys.owner,
    retry: false,
    queryFn: async () => {
      try {
        return await apiGet<{ owner: true }>("/api/owner/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });
}

export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (passcode: string) => apiPost<void>("/api/owner/sign-in", { passcode }),
    onSuccess: () => {
      qc.setQueryData(keys.owner, { owner: true });
      void qc.invalidateQueries({ queryKey: ["kitchen"] });
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<void>("/api/owner/sign-out", {}),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(keys.owner, null);
    },
  });
}

// Guests

export function usePublicConfig() {
  return useQuery({ queryKey: keys.config, queryFn: () => apiGet<PublicConfig>("/api/config") });
}

export function useGuestChat() {
  return useMutation({
    mutationFn: (v: { sessionId: string; message: string }) => apiPost<{ reply: string }>("/api/chat", v),
  });
}

// Reading the kitchen

export const useCatalog = () => useQuery({ queryKey: keys.catalog, queryFn: () => apiGet<Catalog>("/api/kitchen/catalog") });
export const useStock = () => useQuery({ queryKey: keys.stock, queryFn: () => apiGet<StockView>("/api/kitchen/stock") });
export const useToday = () => useQuery({ queryKey: keys.today, queryFn: () => apiGet<TodayView>("/api/kitchen/today") });
export const usePlans = () => useQuery({ queryKey: keys.plans, queryFn: () => apiGet<ProductionPlan[]>("/api/kitchen/plans") });
export const useProposals = () => useQuery({ queryKey: keys.proposals, queryFn: () => apiGet<ProposalView[]>("/api/kitchen/proposals") });

export function useItemHistory(item: string | undefined) {
  return useQuery({
    queryKey: keys.history(item ?? ""),
    queryFn: () => apiGet<StockEvent[]>(`/api/kitchen/stock/${enc(item!)}/history`),
    enabled: !!item,
  });
}

export function usePlanResult(id: string | undefined) {
  return useQuery({
    queryKey: keys.planResult(id ?? ""),
    queryFn: () => apiGet<PlanResult>(`/api/kitchen/plans/${enc(id!)}/result`),
    enabled: !!id,
  });
}

export function useCost(item: string | undefined, qty: number, unit: string | undefined) {
  return useQuery({
    queryKey: keys.cost(item ?? "", qty, unit ?? ""),
    queryFn: () => apiGet<CostResult>(`/api/kitchen/cost?${new URLSearchParams({ item: item!, qty: String(qty), unit: unit! })}`),
    enabled: !!item && !!unit,
  });
}

export function useMaxBatch(item: string | undefined, unit: string | undefined) {
  return useQuery({
    queryKey: keys.maxBatch(item ?? "", unit ?? ""),
    queryFn: () => apiGet<{ max: number | null }>(`/api/kitchen/max-batch?${new URLSearchParams({ item: item!, unit: unit! })}`),
    enabled: !!item && !!unit,
  });
}

// Writing

export interface SaveCountInput {
  location: string;
  lines: { item: string; qty: number; unit: string }[];
}

/** One clientId per save attempt: if the request fails and the owner taps Save again, the same id goes, so a count that did land isn't booked twice. */
export function useSaveCount() {
  const qc = useQueryClient();
  const attempt = useRef<{ sig: string; clientId: string } | null>(null);
  return useMutation({
    mutationFn: (input: SaveCountInput) => {
      const sig = JSON.stringify(input);
      if (attempt.current?.sig !== sig) attempt.current = { sig, clientId: newId() };
      return apiPost<{ events: string[] }>("/api/kitchen/counts", { clientId: attempt.current.clientId, ...input });
    },
    onSuccess: () => {
      attempt.current = null;
      return stockChanged(qc);
    },
  });
}

export type RecordKind = "items" | "locations" | "recipes" | "plans";

function afterCatalogChange(qc: QueryClient, catalog: Catalog) {
  qc.setQueryData(keys.catalog, catalog);
  return qc.invalidateQueries({ queryKey: ["kitchen"] });
}

export function useSaveRecord(kind: RecordKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (record: { id: string }) => apiPost<Catalog>(`/api/kitchen/catalog/${kind}`, record),
    onSuccess: (catalog) => afterCatalogChange(qc, catalog),
  });
}

export function useDeleteRecord(kind: RecordKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete<Catalog>(`/api/kitchen/catalog/${kind}/${enc(id)}`),
    onSuccess: (catalog) => afterCatalogChange(qc, catalog),
  });
}

export function useConfirmProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; lines?: ProposalLine[] }) =>
      apiPost<ConfirmResult>(`/api/kitchen/proposals/${enc(v.id)}/confirm`, v.lines ? { lines: v.lines } : {}),
    onSuccess: (r) => {
      putProposal(qc, r.proposal);
      return stockChanged(qc);
    },
    // Someone else booked it, or stock moved: the list says which, and the card follows.
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) void qc.invalidateQueries({ queryKey: keys.proposals });
    },
  });
}

function useProposalAction(action: "discard" | "refresh") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string }) => apiPost<ProposalView>(`/api/kitchen/proposals/${enc(v.id)}/${action}`, {}),
    onSuccess: (p) => {
      putProposal(qc, p);
      return qc.invalidateQueries({ queryKey: keys.proposals });
    },
  });
}
export const useDiscardProposal = () => useProposalAction("discard");
export const useRefreshProposal = () => useProposalAction("refresh");

export function useAssistantTurn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { sessionId: string; message: string }) => apiPost<AssistantReply>("/api/kitchen/assistant", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.proposals }),
  });
}
