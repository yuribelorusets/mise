import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./client";
import { keys } from "./keys";

const NO_RETRY = [401, 403, 404, 409, 422];

/** One 401 from any owner route means the session is gone: show the sign-in screen. */
export function makeQueryClient(): QueryClient {
  const signedOut = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) qc.setQueryData(keys.owner, null);
  };
  const qc: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: signedOut }),
    mutationCache: new MutationCache({ onError: signedOut }),
    defaultOptions: {
      queries: {
        retry: (count, e) => count < 2 && !(e instanceof ApiError && NO_RETRY.includes(e.status)),
      },
    },
  });
  return qc;
}
