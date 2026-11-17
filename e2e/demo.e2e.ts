import { expect, test, devices, type Page } from "@playwright/test";
import { join } from "node:path";
import { PASSCODE, apiSignIn, guestOrder, postCount, seed, seedPrices } from "./fixtures";

// A scripted walkthrough for the README. Run with `npm run web:build && npm run demo`.
const OUT = join(import.meta.dirname, "..", "docs", "demo");
const hold = (page: Page, ms = 1000) => page.waitForTimeout(ms);

/** Waits until nothing on the page says it's loading, then lets the layout settle. */
async function ready(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Loading…")).toHaveCount(0);
}

test("walkthrough", async ({ page, context, browser }) => {
  test.setTimeout(240_000);
  const request = context.request;

  // Prices first (a count resets what's on hand), then the plan and counts, then two guests already in the book.
  await apiSignIn(request);
  await seedPrices(request);
  await seed(request);
  await guestOrder(request, "Anya", "510-555-0101", "10:30", "3 syrniki");
  await guestOrder(request, "Mike", "510-555-0102", "11:00");
  await context.clearCookies();

  let n = 0;
  const shot = async (name: string) => {
    await ready(page);
    await hold(page);
    await page.screenshot({ path: join(OUT, `${String(++n).padStart(2, "0")}-${name}-mobile.png`) });
  };
  const ask = async (message: string) => {
    await page.getByLabel("Message").fill(message);
    await page.getByRole("button", { name: "Send" }).click();
  };

  // 1. Sign in
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Passcode").fill(PASSCODE);
  await shot("sign-in");
  await page.getByRole("button", { name: "Sign in" }).click();

  // 2. Today
  await expect(page.getByText(/Next production, .*40 syrniki/)).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /Eggs/ })).toBeVisible();
  await shot("today");
  await page.getByRole("region", { name: "Preorders" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("listitem", { name: "Preorder from Anya" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot("today-preorders");

  // 3. Count: two rows
  await page.getByRole("link", { name: "Count" }).click();
  await expect(page.getByLabel("Eggs", { exact: true })).toBeVisible();
  await page.getByLabel("Eggs", { exact: true }).fill("30");
  await page.getByRole("button", { name: "More Farmer's cheese" }).click();
  await page.getByRole("button", { name: "More Farmer's cheese" }).click();
  await shot("count");
  await page.getByRole("button", { name: /Save count/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await shot("count-saved");

  // 4. Assistant: a card, then Booked
  await page.getByRole("link", { name: "Ask the assistant" }).click();
  await ask("received 2 cases of eggs");
  const card = page.getByRole("region", { name: "Proposal" });
  await expect(card.getByRole("heading", { name: "To book" })).toBeVisible();
  await shot("assistant-card");
  await card.getByRole("button", { name: "Confirm" }).click();
  await expect(card.getByRole("heading", { name: "Booked" })).toBeVisible();
  await shot("assistant-booked");

  // 5. A stale card: someone counts the eggs while the card is open
  await ask("received 1 case of eggs");
  const second = page.getByRole("region", { name: "Proposal" }).nth(1);
  await expect(second.getByRole("heading", { name: "To book" })).toBeVisible();
  await postCount(request, "walk-in", [{ item: "eggs", qty: 48, unit: "each" }]);
  await second.getByRole("button", { name: "Confirm" }).click();
  await expect(second.getByText("Stale", { exact: true })).toBeVisible();
  await shot("assistant-stale");
  await second.getByRole("button", { name: "Refresh" }).click();
  await expect(second.getByText("Stale", { exact: true })).toHaveCount(0);
  await second.getByRole("button", { name: "Confirm" }).click();
  await expect(second.getByRole("heading", { name: "Booked" })).toBeVisible();
  await shot("assistant-refreshed");

  // 6. A new item
  await ask("received 3 kg sumac");
  const offer = page.getByRole("group", { name: "New item" });
  await expect(offer).toContainText("sumac");
  await shot("assistant-new-item");
  await offer.getByRole("button", { name: /^Add/ }).click();
  await expect(offer.getByText(/Added/)).toBeVisible();
  await shot("assistant-item-added");

  // 7. Stock
  await page.getByRole("link", { name: "Stock" }).click();
  await expect(page.getByRole("button", { name: /^Eggs/ })).toBeVisible();
  await shot("stock");
  await page.getByRole("button", { name: /^Eggs/ }).click();
  await expect(page.getByRole("table", { name: "Eggs history" })).toBeVisible();
  await shot("stock-history");

  // 8. Recipes, with a cost
  await page.getByRole("link", { name: "Recipes" }).click();
  await expect(page.getByRole("link", { name: /Syrniki batter/ })).toBeVisible();
  await expect(page.getByText("–")).toHaveCount(0);
  await shot("recipes");

  // 9. Plan, with the preorder line
  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page.getByRole("group", { name: "Syrniki", exact: true }).getByText("Preorder", { exact: true })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /Syrniki batter/ })).toBeVisible();
  await shot("plan");

  // 10. A guest orders at /order (no sign-in needed there)
  await page.goto("/order");
  await expect(page.getByRole("heading", { name: "Menu" })).toBeVisible();
  await shot("order-menu");
  await page.getByRole("note").scrollIntoViewIfNeeded();
  await shot("order-privacy");
  await ask("Hi! I'd like to preorder 2 syrniki for pickup at 11:30. Sasha, 510-555-0103");
  await expect(page.getByRole("log", { name: "Chat" })).toContainText(/RK-[A-Z0-9]{6}/);
  await shot("order-placed");

  // 11. Back to Today with the new preorder
  await page.goto("/");
  await expect(page.getByRole("listitem", { name: "Preorder from Sasha" })).toBeVisible();
  await page.getByRole("region", { name: "Preorders" }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot("today-new-preorder");

  // The video is the mobile pass. Save it before the desktop screenshots.
  await page.close();
  await page.video()?.saveAs(join(OUT, "mise-walkthrough.webm"));

  // Desktop screenshots, from a second, unrecorded window.
  const wide = await browser.newContext({ ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, storageState: await context.storageState() });
  const desk = await wide.newPage();
  const deskShot = async (name: string) => {
    await ready(desk);
    await hold(desk, 500);
    await desk.screenshot({ path: join(OUT, `${String(++n).padStart(2, "0")}-${name}-desktop.png`) });
  };
  await desk.goto("/");
  await expect(desk.getByRole("listitem", { name: "Preorder from Sasha" })).toBeVisible();
  await deskShot("today");
  await desk.goto("/assistant");
  await desk.getByLabel("Message").fill("received 2 cases of eggs");
  await desk.getByRole("button", { name: "Send" }).click();
  const deskCard = desk.getByRole("region", { name: "Proposal" });
  await deskCard.getByRole("button", { name: "Confirm" }).click();
  await expect(deskCard.getByRole("heading", { name: "Booked" })).toBeVisible();
  await deskShot("assistant");
  await desk.goto("/plan");
  await expect(desk.getByRole("group", { name: "Syrniki", exact: true }).getByText("Preorder", { exact: true })).toBeVisible();
  await expect(desk.getByRole("rowheader", { name: /Syrniki batter/ })).toBeVisible();
  await deskShot("plan");
  await desk.goto("/order");
  await expect(desk.getByRole("heading", { name: "Menu" })).toBeVisible();
  await desk.getByLabel("Message").fill("2 syrniki for pickup at 12:00, Dana, 510-555-0104");
  await desk.getByRole("button", { name: "Send" }).click();
  await expect(desk.getByRole("log", { name: "Chat" })).toContainText(/RK-[A-Z0-9]{6}/);
  await deskShot("order");
  await wide.close();
});
