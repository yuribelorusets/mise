import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** A test-only passcode, used by the e2e server and nowhere else. */
export const PASSCODE = "e2e-test-passcode-4471";

export async function signIn(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
}

export async function apiSignIn(request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/owner/sign-in", { data: { passcode: PASSCODE } });
  expect(res.status()).toBe(204);
}

let counts = 0;
/** Posts a count through the API. The request context must already be signed in. */
export async function postCount(request: APIRequestContext, location: string, lines: { item: string; qty: number; unit: string }[]): Promise<void> {
  const clientId = `e2e-${Date.now().toString(36)}-${++counts}`;
  const res = await request.post("/api/kitchen/counts", { data: { clientId, location, lines } });
  expect(res.ok()).toBeTruthy();
}

/** Signs in through the API, posts the 5 December plan (40 orders of syrniki) and counts for the walk-in and dry storage. */
export async function seed(request: APIRequestContext): Promise<void> {
  await apiSignIn(request);
  const plan = { id: "popup-2026-12-05", date: "2026-12-05", lines: [{ item: "syrniki", qty: 40, unit: "order", source: "manual" }] };
  const saved = await request.post("/api/kitchen/catalog/plans", { data: plan });
  expect(saved.ok()).toBeTruthy();
  await postCount(request, "walk-in", [
    { item: "farmers-cheese", qty: 1.5, unit: "kg" },
    { item: "sour-cream", qty: 1, unit: "kg" },
    { item: "eggs", qty: 6, unit: "each" },
    { item: "jam", qty: 2, unit: "kg" },
  ]);
  await postCount(request, "dry", [
    { item: "flour", qty: 5, unit: "kg" },
    { item: "sugar", qty: 2, unit: "kg" },
    { item: "black-tea", qty: 0.5, unit: "kg" },
  ]);
}
