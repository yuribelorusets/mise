export type Lang = "en" | "es" | "ru" | "fr";

const STOP: Record<Exclude<Lang, "ru">, string[]> = {
  en: ["the", "and", "you", "your", "for", "table", "is", "are", "we", "have", "with", "thanks", "what", "i", "a", "to"],
  es: ["el", "la", "los", "las", "de", "que", "para", "su", "una", "mesa", "gracias", "tienen", "por", "quiero", "con", "es"],
  fr: ["le", "la", "les", "de", "des", "pour", "votre", "une", "merci", "nous", "vous", "avec", "je", "est", "et", "à"],
};

/** Cheap language guess for the four languages Mise is tested in. */
export function detectLang(text: string): Lang {
  const letters = text.replace(/[^\p{L}]/gu, "");
  const cyr = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  if (letters.length && cyr / letters.length > 0.3) return "ru";
  const words = text.toLowerCase().split(/[^\p{L}']+/u).filter(Boolean);
  const score = (l: keyof typeof STOP) => words.filter((w) => STOP[l].includes(w)).length;
  const accentsEs = /[ñ¿¡áíóú]/i.test(text) ? 2 : 0;
  const accentsFr = /[èêàçùœ]|\bl'|\bd'|\bj'/i.test(text) ? 2 : 0;
  const s = { en: score("en"), es: score("es") + accentsEs, fr: score("fr") + accentsFr };
  return (Object.entries(s).sort((a, b) => b[1] - a[1])[0][0] as Lang) ?? "en";
}
