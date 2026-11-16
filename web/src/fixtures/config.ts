import type { PublicConfig } from "../api/types";

/** What GET /api/config answers for the Ruki pop-up. */
export const publicConfig: PublicConfig = {
  id: "ruki",
  name: "Ruki",
  city: "Oakland",
  examples: [],
  popup: { eventDate: "2026-12-05", location: "The Ruki cart", pickupWindows: ["11:00", "12:00", "13:00"] },
  menu: [
    { id: "syrniki", name: "Babushka's Syrniki", category: "sweet", price: 12, description: "Farmer's cheese pancakes, sour cream, seasonal jam.", allergens: ["dairy", "egg", "gluten"], dietary: ["vegetarian"] },
    { id: "nalysnyky", name: "Nalysnyky", category: "savory", price: 14.5, description: "Thin crepes with cheese filling.", allergens: ["dairy", "egg", "gluten"], dietary: ["vegetarian"] },
  ],
  privacyNotice:
    "We keep your name, phone number, order notes and what you write in this chat for 90 days, then delete them. The owner can read them, to prepare your order and to improve the assistant.",
};
