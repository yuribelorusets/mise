import type { ReactElement } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { makeQueryClient } from "../api/query-client";

/** Renders a screen the way main.tsx does: a query client and a router. */
export function renderWith(ui: ReactElement, opts: { path?: string; client?: QueryClient } = {}) {
  const client = opts.client ?? makeQueryClient();
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[opts.path ?? "/"]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}
