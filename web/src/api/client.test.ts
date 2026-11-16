import { apiGet, apiPost, ApiError } from "./client";

afterEach(() => vi.unstubAllGlobals());

const stub = (res: Response) => {
  const fn = vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", fn);
  return fn;
};

const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected the request to fail");
    },
    (e: ApiError) => e,
  );

test("a 204 returns undefined instead of throwing", async () => {
  stub(new Response(null, { status: 204 }));
  await expect(apiPost("/api/x", {})).resolves.toBeUndefined();
});

test("an empty 200 body returns undefined", async () => {
  stub(new Response("", { status: 200 }));
  await expect(apiGet("/api/x")).resolves.toBeUndefined();
});

test("a 4xx uses the error from the JSON body and keeps the status", async () => {
  stub(new Response(JSON.stringify({ error: "Unknown item" }), { status: 422 }));
  const err = await failure(apiGet("/api/x"));
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(422);
  expect(err.message).toBe("Unknown item");
});

test("a non-JSON error body still throws an ApiError with the status", async () => {
  stub(new Response("oops", { status: 500 }));
  const err = await failure(apiGet("/api/x"));
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(500);
});

test("POST sends JSON with same-origin credentials", async () => {
  const fn = stub(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  await expect(apiPost("/api/x", { a: 1 })).resolves.toEqual({ ok: true });
  const [, init] = fn.mock.calls[0];
  expect(init.method).toBe("POST");
  expect(init.credentials).toBe("same-origin");
  expect(init.headers["Content-Type"]).toBe("application/json");
  expect(init.body).toBe('{"a":1}');
});
