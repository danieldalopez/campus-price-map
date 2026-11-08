// One way of writing an item's size everywhere: the amount, then what it comes in ("250 ml can",
// "10–12 oz cup", "40 g bag", "1 sandwich"). The items table keeps its original wording (the seed, the
// Databricks pipeline and photo reading use it); this only changes what people read.

/** Item id → size as shown. Items not listed show their stored size, which already follows the pattern. */
const SHOWN_SIZE: Record<string, string> = {
  I06: "500 ml bottle",
  I08: "10–12 oz cup",
  I09: "14–16 oz cup",
  I10: "10–12 oz cup",
  I11: "10–12 oz cup",
  I12: "12 oz cup",
  I13: "1 bagel",
  I14: "1 muffin",
  I15: "1 sandwich",
  I16: "1 wrap",
  I17: "8-piece pack",
  I18: "60 g bar",
  I19: "40 g bag",
  I20: "1 banana",
  I21: "1 apple",
  I23: "68 g bar",
};

export function shownSize(id: string, size: string): string {
  return SHOWN_SIZE[id] ?? size;
}
