import type { LLM, LLMRequest, LLMResponse, MessageParam, ToolUseBlock, ToolResultBlock } from "./types.js";
import { detectLang, type Lang } from "./lang.js";
import { loadRestaurant, type RestaurantConfig } from "../domain/restaurant.js";

/**
 * A deterministic, rule-based stand-in for Claude. It lets the test suite and the
 * eval harness run offline and in CI. It is NOT the product: real conversations
 * and real eval numbers come from running with MISE_LLM=anthropic.
 */
export class MockLLM implements LLM {
  readonly name = "mock";
  private n = 0;
  constructor(private config: RestaurantConfig = loadRestaurant()) {}
  private get popup() { return this.config.mode === "popup"; }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    const today = req.system.match(/Today is \w+ (\d{4}-\d{2}-\d{2})/)?.[1] ?? new Date().toISOString().slice(0, 10);
    const userTexts = req.messages.filter((m) => m.role === "user" && typeof m.content === "string").map((m) => m.content as string);
    const latest = userTexts.at(-1) ?? "";
    // A bare "2" or "6:30" has no language of its own: keep the language of the conversation.
    const lang = detectLang([...userTexts].reverse().find((t) => (t.match(/\p{L}/gu) ?? []).length >= 3) ?? latest);
    const last = req.messages.at(-1);
    if (last && last.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result")
      return this.afterTools(req.messages, userTexts, lang, today);
    return this.firstStep(req.messages, userTexts, latest, lang, today);
  }

  // ---------- step 1: decide what to do with the guest's message ----------
  private firstStep(messages: MessageParam[], userTexts: string[], latest: string, lang: Lang, today: string): LLMResponse {
    const all = userTexts.join(" \n ");
    // "2 syrniki and a tea for 10:30" names dishes with a number: that's an order even without the word "order".
    const intentOf = (u: string): Intent | undefined =>
      detectIntent(u) ?? (/\d|\b(one|two|three|a|an)\b|\p{Script=Cyrillic}/u.test(u) && orderItems(this.config, u).length ? "order" : undefined);
    const intent = intentOf(latest) ?? [...userTexts].reverse().map(intentOf).find(Boolean) ?? "chat";
    const s = allSlots(messages, userTexts, today, this.popup);
    const t = T[lang];

    if (intent === "injection") return this.text(T[lang].decline);
    if (intent === "handoff") return this.tool("handoff_to_human", { reason: "guest_request", summary: latest });
    if (intent === "allergy" || intent === "dietary") {
      const { allergens, dietary } = allergyInfo(all);
      return this.tool("search_menu", { query: "*", excludeAllergens: allergens, dietary });
    }
    if (intent === "menu_question") return this.tool("search_menu", { query: s.asked ?? "*" });
    if (intent === "order") {
      // The items may have been named a few messages ago ("2 syrniki" ... "11:00" ... "Anya, 510...").
      const items = [...userTexts].reverse().map((u) => orderItems(this.config, u)).find((x) => x.length) ?? [];
      if (!items.length) return this.tool("search_menu", { query: s.unknownItem ?? "*" });
      if (this.popup && !s.time) return this.tool("list_pickup_windows", {});
      if (!s.name || !s.phone) return this.text(t.needContact);
      return this.tool("place_order", { name: s.name, phone: s.phone, items, ...(this.popup ? { pickupTime: s.time } : {}) });
    }
    if (intent === "reservation" && this.popup) return this.text(t.pickupOnly(this.config.name));
    if (intent === "reservation") {
      if (s.party && s.party > this.config.seating.maxPartySize)
        return this.tool("handoff_to_human", { reason: "large_party", summary: `Party of ${s.party}` });
      if (!s.date) return this.text(T[lang].askDate);
      if (!s.time) return this.text(T[lang].askTime);
      if (!s.party) return this.text(T[lang].askParty);
      return this.tool("check_availability", { date: s.date, time: s.time, partySize: s.party });
    }
    return this.text(t.greet(this.config.name, this.popup));
  }

  // ---------- step 2+: react to tool results ----------
  private afterTools(messages: MessageParam[], userTexts: string[], lang: Lang, today: string): LLMResponse {
    const resultsMsg = messages.at(-1) as { content: ToolResultBlock[] };
    const assistant = messages.at(-2) as { content: ToolUseBlock[] };
    const use = assistant.content.find((b) => b.type === "tool_use")!;
    const result = resultsMsg.content[0];
    const out = JSON.parse(result.content);
    if (result.is_error) return this.text(T[lang].error(out.error));
    const s = allSlots(messages, userTexts, today, this.popup);

    switch (use.name) {
      case "list_pickup_windows": {
        const open = (out.windows as { time: string; open: boolean }[]).filter((w) => w.open).map((w) => w.time);
        return this.text(open.length ? `${T[lang].askWindow} ${list(open)}` : T[lang].closed);
      }
      case "check_availability":
        if (!out.available) return this.text(T[lang].unavailable(out.time, out.alternatives ?? []));
        if (!s.name || !s.phone) return this.text(T[lang].needContact);
        return this.tool("create_reservation", { date: out.date, time: out.time, partySize: out.partySize, name: s.name, phone: s.phone });
      case "create_reservation":
        return this.text(T[lang].booked(out.partySize, out.date, out.time, out.code));
      case "search_menu": {
        const names: string[] = out.results.map((r: { name: string }) => r.name);
        if (!names.length) return this.text(T[lang].notOnMenu);
        if ((use.input.excludeAllergens as string[] | undefined)?.length || (use.input.dietary as string[] | undefined)?.length)
          return this.text(T[lang].safe(names.slice(0, 4)));
        return this.text(T[lang].found(names.slice(0, 4)));
      }
      case "place_order":
        if (this.popup) return this.text(T[lang].preordered(out.id, out.total, out.pickupDate, out.pickupTime, out.location, out.payment));
        return this.text(T[lang].ordered(out.id, out.total, out.pickupTime));
      case "handoff_to_human":
        return this.text(T[lang].handoff);
    }
    return this.text(T[lang].greet(this.config.name, this.popup));
  }

  private text(text: string): LLMResponse {
    return { content: [{ type: "text", text }], stop_reason: "end_turn" };
  }
  private tool(name: string, input: Record<string, unknown>): LLMResponse {
    return { content: [{ type: "tool_use", id: `toolu_mock_${++this.n}`, name, input }], stop_reason: "tool_use" };
  }
}

// ---------------- parsing helpers ----------------

type Intent = "injection" | "handoff" | "allergy" | "dietary" | "menu_question" | "order" | "reservation";

const has = (t: string, re: RegExp) => re.test(t.toLowerCase());

function detectIntent(t: string): Intent | undefined {
  if (has(t, /ignore (all|your|previous)|discount|free meal|comp me|descuento|gratis|скидк|бесплатн|réduction|gratuit|remise/)) return "injection";
  if (has(t, /manager|human|real person|refund|complain|reembolso|queja|gerente|менеджер|возврат|жалоб|rembourse|plainte|responsable/)) return "handoff";
  if (has(t, /allerg|alérg|аллерг|gluten|глютен|celiac|celíac|peanut|cacahu|maní|арахис|arachide|lactose|lactosa|лактоз|shellfish|mariscos|морепродукт/)) return "allergy";
  if (has(t, /\bvegan|vegano|веган|végan|vegetarian|vegetariano|вегетариан|végétarien/)) return "dietary";
  if (has(t, /\border\b|pre-?order|pick ?up|предзаказ|to go|takeout|pedir|pedido|para llevar|заказ|с собой|commander|commande|à emporter/)) return "order";
  if (has(t, /\bbook|reserv|table|mesa|брон|столик|réserv/)) return "reservation";
  if (has(t, /do you have|have you got|tienen|tienes|у вас есть|есть ли|avez-vous|vous avez/)) return "menu_question";
  return undefined;
}

const NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, twelve: 12,
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  двоих: 2, троих: 3, четверых: 4, пятерых: 5,
  deux: 2, trois: 3, quatre: 4, cinq: 5,
};
const toNum = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUM[w.toLowerCase()]);

const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + d * 864e5).toISOString().slice(0, 10);

function slots(text: string, today: string, popup = false) {
  const t = text.toLowerCase();
  let date: string | undefined;
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) date = iso[1];
  else if (/tomorrow|mañana|завтра|demain/.test(t)) date = addDays(today, 1);
  else if (/tonight|today|esta noche|hoy|сегодня|ce soir|aujourd/.test(t)) date = today;
  else {
    const days = [/sunday|domingo|воскресень|dimanche/, /monday|lunes|понедельник|lundi/, /tuesday|martes|вторник|mardi/,
      /wednesday|miércoles|miercoles|сред[ау]|mercredi/, /thursday|jueves|четверг|jeudi/, /friday|viernes|пятниц|vendredi/, /saturday|sábado|sabado|суббот|samedi/];
    const want = days.findIndex((re) => re.test(t));
    if (want >= 0) {
      const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
      date = addDays(today, ((want - dow + 7) % 7) || 7);
    }
  }

  let time: string | undefined;
  const ampm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|p\.m\.|a\.m\.)/);
  // A pop-up's pickup times arrive as "for 11" or "на 12": only read those as times in pop-up mode.
  const popupAt = popup
    ? [...t.matchAll(/(?<!\p{L})(?:for|at|by|around|к|на|в|para|pour|à)\s+(\d{1,2})(?::(\d{2}))?(?!\d)(?![ \t]*(?:people|persons|guests|человек|personas|personnes))/gu)]
        .find((m) => Number(m[1]) >= 6 && Number(m[1]) <= 14) ?? null
    : null;
  const h24 = popupAt ?? t.match(/\b([01]?\d|2[0-3])[:h](\d{2})\b/) ?? t.match(/\b(?:at|a las|в|à)\s+([01]?\d|2[0-3])\s*h?\b/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3].startsWith("p")) h += 12;
    time = `${String(h).padStart(2, "0")}:${ampm[2] ?? "00"}`;
  } else if (h24) {
    let h = Number(h24[1]);
    if (h < 11 && !popup) h += 12; // dinner-only restaurant: "at 7" means 19:00 (a morning pop-up means 7:00)
    time = `${String(h).padStart(2, "0")}:${h24[2] ?? "00"}`;
  }

  let party: number | undefined;
  const p1 = t.match(/(?:for|para|на|pour)\s+(\d+|[a-zа-яё]+)\b/u);
  const p2 = t.match(/(\d+)\s*(?:people|persons|guests|personas|человек|personnes)/u);
  if (p2) party = Number(p2[1]);
  else if (p1 && toNum(p1[1])) party = toNum(p1[1]);

  const nameM = text.match(/(?:name is|name's|under|me llamo|a nombre de|меня зовут|на имя|je m'appelle|au nom de)\s+([A-ZА-ЯЁ][\p{L}'-]+)/iu);
  // "Kim, 510-555-0144" / "Anya 510 555 0201": a capitalized word right before the phone number is the name.
  const beforePhone = text.match(/(?:^|[\s,.;:!?])([A-ZА-ЯЁ][\p{L}'-]+)[,\s]+\+?\d[\d\s().-]{7,}\d/u);
  const notName = /^(Hi|Hello|Hey|Yes|No|Ok|Okay|Sure|Please|Thanks|Phone|Number|Call|Text|Tel|Да|Нет|Hola|Bonjour|Oui|Sí)$/i;
  const phoneM = text.match(/(\+?\d[\d\s().-]{7,}\d)/);
  const askedM = t.match(/(?:do you have|have you got|tienen|tienes|у вас есть|есть ли|avez-vous|vous avez)\s+(?:any\s+|des\s+|du\s+)?([\p{L}]+)/u);
  const unknownM = t.match(/\b(\d+|two|three|dos|tres|deux|trois)\s+([\p{L}]{3,})/u);
  return {
    date, time, party,
    name: nameM?.[1] ?? (beforePhone && !notName.test(beforePhone[1]) ? beforePhone[1] : undefined), phone: phoneM?.[1].trim(),
    asked: askedM?.[1], unknownItem: unknownM?.[2],
  };
}

/**
 * Short answers only make sense next to the question they answer: "2" after
 * "How many people?" is a party size, "Jo, 510..." after "What name?" is a name.
 */
function answers(messages: MessageParam[], popup: boolean) {
  const asked = (text: string) => {
    for (const l of Object.values(T)) {
      if (text === l.askParty) return "party";
      if (text === l.askTime || text.startsWith(l.askWindow)) return "time";
      if (text === l.needContact) return "contact";
    }
    return undefined;
  };
  const out: { party?: number; time?: string; name?: string } = {};
  let pending: string | undefined;
  for (const m of messages) {
    if (m.role === "assistant") {
      pending = asked(m.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim());
      continue;
    }
    if (typeof m.content !== "string") continue;
    const text = m.content.trim();
    if (pending === "party") {
      const n = text.match(/^(?:just\s+|only\s+)?(\d{1,2}|[a-zа-яё]+)\b/iu);
      if (n && toNum(n[1])) out.party = toNum(n[1]);
    } else if (pending === "time") {
      const t = text.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
      if (t) {
        let h = Number(t[1]) % 24;
        if (t[3]?.toLowerCase() === "pm" || (!t[3] && h < 11 && !popup)) h = (h % 12) + 12;
        out.time = `${String(h).padStart(2, "0")}:${t[2] ?? "00"}`;
      }
    } else if (pending === "contact") {
      const n = text.match(/^([A-ZА-ЯЁ][\p{L}'-]+)/u);
      if (n && !/^(sure|yes|ok|okay|it's|its|my|sí|да|oui)$/i.test(n[1])) out.name = n[1];
    }
    pending = undefined;
  }
  return out;
}

function allSlots(messages: MessageParam[], userTexts: string[], today: string, popup: boolean) {
  const s = slots(userTexts.join(" \n "), today, popup);
  const a = answers(messages, popup);
  return { ...s, party: s.party ?? a.party, time: s.time ?? a.time, name: s.name ?? a.name };
}

function allergyInfo(text: string) {
  const t = text.toLowerCase();
  const allergens = new Set<string>();
  if (/peanut|cacahu|maní|арахис|arachide/.test(t)) allergens.add("peanuts");
  else if (/\bnut|nuez|nueces|орех|noix/.test(t)) { allergens.add("peanuts"); allergens.add("tree_nuts"); }
  if (/gluten|глютен|celiac|celíac|cœliaque/.test(t)) allergens.add("gluten");
  if (/dairy|lactose|lactosa|lácteo|лактоз|молоч|laitier/.test(t)) allergens.add("dairy");
  if (/shellfish|mariscos|морепродукт|fruits de mer/.test(t)) allergens.add("shellfish");
  const dietary: string[] = [];
  if (/vegan|vegano|веган|végan/.test(t)) dietary.push("vegan");
  else if (/vegetarian|vegetariano|вегетариан|végétarien/.test(t)) dietary.push("vegetarian");
  return { allergens: [...allergens], dietary };
}

function orderItems(config: RestaurantConfig, text: string) {
  let t = ` ${text.toLowerCase()} `;
  // Longest names first, and blank out each match, so "dill bagel" isn't also read as "bagel".
  const keys = config.menu
    .flatMap((m) => [m.name, ...m.aliases].map((k) => ({ id: m.id, key: k.toLowerCase() })))
    .sort((a, b) => b.key.length - a.key.length);
  const qty = new Map<string, number>();
  for (const { id, key } of keys) {
    const at = t.indexOf(key);
    if (at < 0) continue;
    const before = t.slice(0, at).trim().split(/\s+/).at(-1) ?? "";
    qty.set(id, (qty.get(id) ?? 0) + (toNum(before) ?? 1));
    t = t.slice(0, at) + " ".repeat(key.length) + t.slice(at + key.length);
  }
  return [...qty].map(([item, quantity]) => ({ item, quantity }));
}

// ---------------- reply templates ----------------

const list = (xs: string[]) => xs.join(", ");
const T: Record<Lang, {
  greet: (name: string, popup: boolean) => string; decline: string; askDate: string; askTime: string; askParty: string; needContact: string;
  unavailable: (t: string, alts: string[]) => string; booked: (p: number, d: string, t: string, c: string) => string;
  notOnMenu: string; found: (n: string[]) => string; safe: (n: string[]) => string;
  ordered: (id: string, total: number, t: string) => string; handoff: string; error: (e: string) => string;
  pickupOnly: (name: string) => string; askWindow: string; closed: string;
  preordered: (id: string, total: number, date: string, t: string, where: string, pay: string) => string;
}> = {
  en: {
    greet: (n, p) => p ? `Hi! Thanks for reaching out to ${n}. I can take a preorder for the next pop-up or answer menu questions.` : `Hi! Thanks for reaching out to ${n}. I can book a table, answer menu questions, or take a pickup order.`,
    decline: "Sorry, I can't offer discounts or change our policies, but I'm happy to help with a booking or an order.",
    askDate: "Happy to help! What date would you like?", askTime: "What time would you like?", askParty: "How many people will be joining?",
    needContact: "Great. What name and phone number should I put this under?",
    unavailable: (t, a) => `Sorry, ${t} is fully booked.` + (a.length ? ` I can do ${list(a)}. Would one of those work?` : " Would another day work?"),
    booked: (p, d, t, c) => `You're all set: a table for ${p} on ${d} at ${t}. Your confirmation code is ${c}.`,
    notOnMenu: "Sorry, we don't have that on our menu. Would you like to hear what we do have?",
    found: (n) => `Yes! On the menu we have ${list(n)}.`,
    safe: (n) => `Good options for you: ${list(n)}. Our kitchen handles common allergens, so cross-contact is possible. Please tell your server too.`,
    ordered: (id, total, t) => `Your order ${id} is in. Total $${total}, ready for pickup at ${t}.`,
    handoff: "I've passed this to a team member, and someone will follow up with you shortly.",
    pickupOnly: (n) => `${n} is a pop-up, so there are no tables to book, but I'd love to take a preorder for pickup. What would you like?`,
    askWindow: "Which pickup window works for you? Open windows:",
    closed: "Sorry, preorders for this pop-up are closed or every window is full. Follow us on Instagram for the next one!",
    preordered: (id, total, d, t, w, pay) => `Your preorder ${id} is in: pickup ${d} at ${t}, ${w}. Total $${total}. ${pay}`,
    error: (e) => `Sorry, I couldn't do that: ${e}`,
  },
  es: {
    greet: (n, p) => p ? `¡Hola! Gracias por contactar a ${n}. Puedo tomar un pedido anticipado para el próximo pop-up o responder preguntas del menú.` : `¡Hola! Gracias por contactar a ${n}. Puedo reservar una mesa, responder preguntas del menú o tomar un pedido para llevar.`,
    decline: "Lo siento, no puedo ofrecer descuentos ni cambiar nuestras políticas, pero con gusto le ayudo con una reserva o un pedido.",
    askDate: "¡Con gusto! ¿Para qué fecha?", askTime: "¿A qué hora le gustaría?", askParty: "¿Para cuántas personas?",
    needContact: "Perfecto. ¿A nombre de quién y con qué número de teléfono?",
    unavailable: (t, a) => `Lo siento, a las ${t} está completo.` + (a.length ? ` Tengo ${list(a)}. ¿Le sirve alguna?` : " ¿Le sirve otro día?"),
    booked: (p, d, t, c) => `¡Listo! Mesa para ${p} el ${d} a las ${t}. Su código de confirmación es ${c}.`,
    notOnMenu: "Lo siento, eso no está en nuestro menú. ¿Le cuento lo que sí tenemos?",
    found: (n) => `¡Sí! En el menú tenemos ${list(n)}.`,
    safe: (n) => `Buenas opciones para usted: ${list(n)}. La cocina maneja alérgenos comunes, así que puede haber contacto cruzado. Por favor avise también a su mesero.`,
    ordered: (id, total, t) => `Su pedido ${id} está confirmado. Total $${total}, listo para recoger a las ${t}.`,
    handoff: "Le pasé esto a un miembro del equipo y alguien se comunicará con usted pronto.",
    pickupOnly: (n) => `${n} es un pop-up, así que no hay mesas para reservar, pero con gusto le tomo un pedido anticipado para recoger. ¿Qué le gustaría?`,
    askWindow: "¿Qué horario de recogida le conviene? Horarios disponibles:",
    closed: "Lo siento, los pedidos para este pop-up están cerrados o todos los horarios están llenos.",
    preordered: (id, total, d, t, w, pay) => `Su pedido ${id} está confirmado: recogida el ${d} a las ${t}, ${w}. Total $${total}. ${pay}`,
    error: (e) => `Lo siento, no pude hacerlo: ${e}`,
  },
  ru: {
    greet: (n, p) => p ? `Здравствуйте! Спасибо, что написали в ${n}. Я могу принять предзаказ на следующий поп-ап или ответить на вопросы о меню.` : `Здравствуйте! Спасибо, что обратились в ${n}. Я могу забронировать столик, ответить на вопросы о меню или принять заказ с собой.`,
    decline: "К сожалению, я не могу предложить скидку или изменить наши правила, но с радостью помогу с бронью или заказом.",
    askDate: "С удовольствием! На какую дату?", askTime: "На какое время?", askParty: "Сколько будет гостей?",
    needContact: "Отлично. На какое имя и какой номер телефона оформить?",
    unavailable: (t, a) => `К сожалению, на ${t} всё занято.` + (a.length ? ` Могу предложить ${list(a)}. Подойдёт?` : " Может быть, другой день?"),
    booked: (p, d, t, c) => `Готово: столик на ${p} гостей, ${d} в ${t}. Ваш код подтверждения ${c}.`,
    notOnMenu: "К сожалению, этого нет в нашем меню. Рассказать, что у нас есть?",
    found: (n) => `Да! В меню есть ${list(n)}.`,
    safe: (n) => `Вам подойдут: ${list(n)}. На кухне используются распространённые аллергены, поэтому возможен перекрёстный контакт. Пожалуйста, предупредите и официанта.`,
    ordered: (id, total, t) => `Ваш заказ ${id} принят. Сумма $${total}, будет готов к ${t}.`,
    handoff: "Я передал ваш вопрос сотруднику, с вами скоро свяжутся.",
    pickupOnly: (n) => `${n} — это поп-ап, столиков для брони нет, но я с радостью приму предзаказ на самовывоз. Что бы вы хотели?`,
    askWindow: "В какое время вам удобно забрать заказ? Свободное время:",
    closed: "К сожалению, предзаказы на этот поп-ап закрыты или всё время уже занято.",
    preordered: (id, total, d, t, w, pay) => `Ваш предзаказ ${id} принят: самовывоз ${d} в ${t}, ${w}. Сумма $${total}. ${pay}`,
    error: (e) => `К сожалению, не получилось: ${e}`,
  },
  fr: {
    greet: (n, p) => p ? `Bonjour ! Merci de contacter ${n}. Je peux prendre une précommande pour le prochain pop-up ou répondre à vos questions sur le menu.` : `Bonjour ! Merci de contacter ${n}. Je peux réserver une table, répondre à vos questions sur le menu ou prendre une commande à emporter.`,
    decline: "Désolé, je ne peux pas offrir de réduction ni changer nos règles, mais je peux vous aider pour une réservation ou une commande.",
    askDate: "Avec plaisir ! Pour quelle date ?", askTime: "Pour quelle heure ?", askParty: "Vous serez combien de personnes ?",
    needContact: "Parfait. À quel nom et quel numéro de téléphone ?",
    unavailable: (t, a) => `Désolé, ${t} est complet.` + (a.length ? ` Je peux vous proposer ${list(a)}. Cela vous convient ?` : " Un autre jour vous conviendrait ?"),
    booked: (p, d, t, c) => `C'est réservé : une table pour ${p} le ${d} à ${t}. Votre code de confirmation est ${c}.`,
    notOnMenu: "Désolé, ce plat n'est pas sur notre menu. Voulez-vous que je vous présente ce que nous avons ?",
    found: (n) => `Oui ! Au menu nous avons ${list(n)}.`,
    safe: (n) => `Bonnes options pour vous : ${list(n)}. Notre cuisine manipule des allergènes courants, un contact croisé est donc possible. Merci de prévenir aussi votre serveur.`,
    ordered: (id, total, t) => `Votre commande ${id} est confirmée. Total ${total} $, prête à emporter à ${t}.`,
    handoff: "J'ai transmis votre demande à un membre de l'équipe, quelqu'un vous recontactera rapidement.",
    pickupOnly: (n) => `${n} est un pop-up, il n'y a donc pas de table à réserver, mais je peux prendre une précommande à emporter. Que souhaitez-vous ?`,
    askWindow: "Quel créneau de retrait vous convient ? Créneaux disponibles :",
    closed: "Désolé, les précommandes pour ce pop-up sont fermées ou tous les créneaux sont complets.",
    preordered: (id, total, d, t, w, pay) => `Votre précommande ${id} est confirmée : retrait le ${d} à ${t}, ${w}. Total ${total} $. ${pay}`,
    error: (e) => `Désolé, je n'ai pas pu le faire : ${e}`,
  },
};
