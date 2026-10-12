import ui from "./ui.json";
import english from "./ui-en.json";

/** Source strings are catalogued separately from identifiers and user content. */
export const hermesUiIds: Record<string, string> = ui;
export const hermesChineseMessages = Object.fromEntries(Object.entries(ui).map(([text, key]) => [key, text]));
export const hermesEnglishMessages = Object.fromEntries(Object.entries(ui).map(([text, key]) => [key, (english as Record<string, string>)[text] ?? text]));
