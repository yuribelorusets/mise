import { expect, test, type Page } from "@playwright/test";
import { PASSCODE, postCount, seed, signIn } from "./fixtures";

async function ask(page: Page, message: string) {
  await page.getByLabel("Message").fill(message);
  await page.getByRole("button", { name: "Send" }).click();
}

test.beforeEach(async ({ request }) => {
  await seed(request);
});

test("signed out, / shows the sign-in screen; a wrong passcode errors, the right one opens Today", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Passcode").fill("not-the-passcode");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("passcode isn't right");
  await page.getByLabel("Passcode").fill(PASSCODE);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});

test("a reload on /count returns the app, and /order loads without signing in", async ({ page }) => {
  await signIn(page);
  await page.goto("/count");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Count" })).toBeVisible();

  await page.context().clearCookies();
  await page.goto("/order");
  await expect(page.getByRole("heading", { name: "Order for pickup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
});

test("Today shows the plan date, the prep list and the Short table", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText(/Next production, .*40 syrniki/)).toBeVisible();
  await expect(page.getByText("Syrniki batter").first()).toBeVisible();
  const short = page.getByRole("region", { name: "Short" });
  await expect(short.getByRole("columnheader", { name: "Buy" })).toBeVisible();
  await expect(short.getByRole("rowheader", { name: /Eggs/ })).toBeVisible();
  await expect(short.getByRole("rowheader", { name: /Farmer's cheese/i })).toBeVisible();
});

test("a saved count shows on Stock without a reload", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Count" }).click();
  await expect(page.getByRole("heading", { name: "Count" })).toBeVisible();
  await page.getByLabel("Eggs", { exact: true }).fill("42");
  await page.getByRole("button", { name: /Save count/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await page.getByRole("link", { name: "Stock" }).click();
  const eggs = page.getByRole("button", { name: /^Eggs/ });
  await expect(eggs).toContainText("42");
});

test("confirming an assistant card books it and Stock gains 360 eggs", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Stock" }).click();
  await expect(page.getByRole("button", { name: /^Eggs/ })).toHaveText(/^Eggs\s*6\s*each$/);

  await page.getByRole("link", { name: "Ask the assistant" }).click();
  await ask(page, "received 2 cases of eggs");
  const card = page.getByRole("region", { name: "Proposal" });
  await expect(card.getByRole("heading", { name: "To book" })).toBeVisible();
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByRole("heading", { name: "Booked" })).toBeVisible();

  await page.getByRole("link", { name: "Stock" }).click();
  await expect(page.getByRole("button", { name: /^Eggs/ })).toHaveText(/366\s*each$/);
});

test("a card goes stale when eggs are counted elsewhere; Refresh then Confirm books it", async ({ page, request }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Ask the assistant" }).click();
  await ask(page, "received 2 cases of eggs");
  const card = page.getByRole("region", { name: "Proposal" });
  await expect(card.getByRole("heading", { name: "To book" })).toBeVisible();

  await postCount(request, "walk-in", [{ item: "eggs", qty: 12, unit: "each" }]);
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByText("Stale", { exact: true })).toBeVisible();
  await expect(card.getByText(/Stock changed since this was made/)).toHaveCount(1);

  await card.getByRole("button", { name: "Refresh" }).click();
  await expect(card.getByText("Stale", { exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByRole("heading", { name: "Booked" })).toBeVisible();
});

test("discarding a card leaves a Discarded stub", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Ask the assistant" }).click();
  await ask(page, "received 2 cases of eggs");
  const card = page.getByRole("region", { name: "Proposal" });
  await card.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText(/^Discarded/)).toBeVisible();
});

test("a new-item offer adds sumac with the id sumac, and eggs keep their units", async ({ page, request }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Ask the assistant" }).click();
  await ask(page, "received 3 kg sumac");
  const offer = page.getByRole("group", { name: "New item" });
  await expect(offer).toContainText("sumac");
  await offer.getByRole("button", { name: /^Add/ }).click();
  await expect(offer.getByText(/Added/)).toBeVisible();

  const catalog = await (await request.get("/api/kitchen/catalog")).json();
  const sumac = catalog.items.find((i: { id: string }) => i.id === "sumac");
  expect(sumac).toMatchObject({ id: "sumac", baseUnit: "g" });
  const eggs = catalog.items.find((i: { id: string }) => i.id === "eggs");
  expect(eggs.units).toEqual({ case: 180, dozen: 12 });
});

test("a guest order shows a confirmation, appears on Today and as a locked preorder line on Plan", async ({ page }) => {
  await page.goto("/order");
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Your data");
  await ask(page, "Can I preorder 2 syrniki for pickup at 11:00? Sam, 510-555-0202");
  await expect(page.getByRole("log", { name: "Chat" })).toContainText(/RK-[A-Z0-9]{6}/);

  await signIn(page);
  const orders = page.getByRole("region", { name: "Preorders" });
  await expect(orders.getByRole("listitem", { name: "Preorder from Sam" })).toContainText("2 babushka's syrniki");

  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
  const syrniki = page.getByRole("group", { name: "Syrniki", exact: true });
  await expect(syrniki.getByText("Preorder", { exact: true })).toBeVisible();
  await expect(syrniki.getByLabel(/manual/).first()).toBeVisible();
  await expect(syrniki.getByRole("spinbutton")).toHaveCount(1);
});
