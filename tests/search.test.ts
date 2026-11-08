// Search tests (docs/SPEC.md section 7). Run with Node's built-in test runner and TypeScript support:
//   npm test      (node --test tests/*.test.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  damerauLevenshtein,
  groupByItemName,
  normalise,
  parseAliases,
  prepareMenu,
  searchItems,
  searchMenu,
  typoBudget,
} from "../src/lib/search.ts";

// The 23 items and their aliases exactly as db/seed.sql loads them into `items`.
const ITEMS = [
  ["I01", "Red Bull", "250 ml can", "Energy drinks", "redbull|red bull|rb|energy drink"],
  ["I02", "Monster Energy", "473 ml can", "Energy drinks", "monster|monster energy"],
  ["I03", "Celsius", "355 ml can", "Energy drinks", "celsius"],
  ["I04", "Coca-Cola", "355 ml can", "Soft drinks", "coke|coca cola|cola|pop|soda|coke can"],
  ["I05", "Coca-Cola", "591 ml bottle", "Soft drinks", "coke bottle|coca cola bottle|pop bottle"],
  ["I06", "Bottled water", "500 ml", "Water", "water|bottled water|dasani|aquafina|ethos"],
  ["I07", "Sparkling water", "355 ml can", "Water", "sparkling water|soda water|bubly|perrier"],
  ["I08", "Drip coffee", "small, 10 to 12 oz", "Hot drinks", "coffee|drip|drip coffee|brewed coffee|regular coffee"],
  ["I09", "Drip coffee", "medium, 14 to 16 oz", "Hot drinks", "medium coffee|large coffee"],
  ["I10", "Latte", "small, 10 to 12 oz", "Hot drinks", "latte|caffe latte"],
  ["I11", "Tea", "small, 10 to 12 oz", "Hot drinks", "tea|hot tea|steeped tea"],
  ["I12", "Iced coffee or cold brew", "12 oz", "Cold coffee", "iced coffee|cold brew"],
  ["I13", "Bagel with cream cheese", "each", "Breakfast and bakery", "bagel"],
  ["I14", "Muffin", "each", "Breakfast and bakery", "muffin"],
  ["I15", "Pre-made sandwich", "each", "Lunch grab and go", "sandwich|sandwhich"],
  ["I16", "Pre-made wrap", "each", "Lunch grab and go", "wrap"],
  ["I17", "Sushi pack, California roll", "8 pieces", "Lunch grab and go", "sushi|california roll"],
  ["I18", "Quest Protein Bar", "60 g", "Snacks", "quest|protein bar"],
  ["I19", "Lay's Classic chips", "40 g", "Snacks", "chips|lays|lay's|crisps"],
  ["I20", "Banana", "each", "Fruit", "banana"],
  ["I21", "Apple", "each", "Fruit", "apple"],
  ["I22", "Red Bull", "355 ml can", "Energy drinks", "red bull 355|big red bull"],
  ["I23", "Clif Bar", "68 g", "Snacks", "clif|clif bar|cliff bar|energy bar"],
].map(([id, name, size, category, aliases]) => ({ id, name, size, category, aliases: parseAliases(aliases) }));

const ids = (query: string) => searchItems(query, ITEMS).items.map((i) => i.id);
const first = (query: string) => ids(query)[0];

describe("normalise", () => {
  it("lowercases, strips accents and drops everything but letters and digits", () => {
    for (const q of ["Red-Bull", "red bull", "REDBULL", " red_bull! "]) assert.equal(normalise(q), "redbull");
    assert.equal(normalise("Café Crème"), "cafecreme");
    assert.equal(normalise("Lay's"), "lays");
    assert.equal(normalise("--"), "");
  });
});

describe("damerauLevenshtein", () => {
  it("counts insertions, deletions, substitutions and neighbour swaps as 1", () => {
    assert.equal(damerauLevenshtein("rdbull", "redbull"), 1); // missing letter
    assert.equal(damerauLevenshtein("reddbull", "redbull"), 1); // extra letter
    assert.equal(damerauLevenshtein("rodbull", "redbull"), 1); // wrong letter
    assert.equal(damerauLevenshtein("rebdull", "redbull"), 1); // swapped neighbours
    assert.equal(damerauLevenshtein("redbull", "redbull"), 0);
    assert.equal(damerauLevenshtein("", "abc"), 3);
  });
  it("allows 1 typo for 4 to 7 letters and 2 for 8 or more", () => {
    assert.equal(typoBudget(3), 0);
    assert.equal(typoBudget(4), 1);
    assert.equal(typoBudget(7), 1);
    assert.equal(typoBudget(8), 2);
  });
});

describe("searchItems", () => {
  it("Redbull finds Red Bull (exact alias), 250 ml first", () => {
    const r = searchItems("Redbull", ITEMS);
    assert.equal(r.kind, "match");
    assert.equal(first("Redbull"), "I01");
    assert.ok(ids("Redbull").includes("I22"), "the 355 ml can is listed too");
  });

  it("red-bull finds Red Bull", () => {
    assert.equal(searchItems("red-bull", ITEMS).kind, "match");
    assert.equal(first("red-bull"), "I01");
    assert.equal(first("RED BULL"), "I01");
  });

  it("rdbull is a typo: Did you mean Red Bull?", () => {
    const r = searchItems("rdbull", ITEMS);
    assert.equal(r.kind, "typo");
    if (r.kind !== "typo") return;
    assert.equal(r.didYouMean.id, "I01");
    assert.equal(r.didYouMean.name, "Red Bull");
    assert.equal(r.items[0].id, "I01");
  });

  it("coke and pop find the Coca-Cola can first, then the bottle", () => {
    for (const q of ["coke", "pop", "Coca-Cola", "cola"]) {
      assert.deepEqual(ids(q).slice(0, 2), ["I04", "I05"], q);
    }
  });

  it("latte finds Latte", () => {
    assert.equal(first("latte"), "I10");
    assert.equal(first("Latté"), "I10");
  });

  it('"monster energy" finds Monster Energy', () => {
    assert.equal(first("monster energy"), "I02");
    assert.equal(first("Monster"), "I02");
  });

  it("prefix and contains: partial words work", () => {
    assert.equal(first("redb"), "I01"); // prefix
    assert.equal(first("mons"), "I02"); // prefix
    assert.equal(first("protein"), "I18"); // prefix of an alias
    assert.ok(ids("sushi").includes("I17"));
    assert.ok(ids("california").includes("I17")); // prefix of "california roll"
    assert.ok(ids("classic").includes("I19")); // contains, in the name
  });

  it("category words match: coffee lists I08 to I12, drip coffee small first", () => {
    const found = ids("coffee");
    assert.equal(found[0], "I08");
    for (const id of ["I08", "I09", "I10", "I11", "I12"]) assert.ok(found.includes(id), id);
    assert.deepEqual(ids("snacks").sort(), ["I18", "I19", "I23"]);
    assert.ok(ids("fruit").includes("I20") && ids("fruit").includes("I21"));
  });

  it("tolerates small typos in longer words", () => {
    assert.equal(first("monstr"), "I02"); // 6 letters, 1 typo
    assert.equal(first("sandwitch"), "I15"); // 9 letters, within 2
    assert.equal(first("bananna"), "I20");
  });

  it("short queries don't get typo matches", () => {
    assert.equal(searchItems("tex", ITEMS).kind, "none"); // 3 letters: no typos allowed
  });

  it("blank and unknown queries", () => {
    assert.equal(searchItems("", ITEMS).kind, "empty");
    assert.equal(searchItems("  -- ", ITEMS).kind, "empty");
    assert.equal(searchItems("kombucha", ITEMS).kind, "none");
  });
});

// Real menu lines (menu_items), trimmed to what each case needs, plus near misses that must NOT match.
const MENU = [
  ["Kinton Ramen", "Ramen / Japanese", "Pork Shoyu Ramen", null, 15.99],
  ["Kinton Ramen", "Ramen / Japanese", "Chicken Miso Ramen", null, 16.99],
  ["Kinton Ramen", "Ramen / Japanese", "Edamame", null, 5.99],
  ["Kinton Ramen", "Ramen / Japanese", "Homemade Lemonade", null, 4.99],
  ["Grand Noodle Emporium", "Contains Pork", "Miso Roasted Chicken Ramen", null, 12.99],
  ["Meet Night Izakaya", "Izakaya", "Tonkotsu Ramen", null, 16.95],
  ["Ramen Danbo Express", "Ramen", "Classic Tonkotsu Ramen", null, 17.25],
  ["Grocery Checkout", "Grocery", "Instant Ramen (Shin)", "cup", 2.79],
  ["Blue Chip Cafe", "UBC's Favourite Cookie", "Chocolate Chunk Cookie", null, 3.19],
  ["Subway (Life Building)", "Sides", "Cookie", null, 1.59],
  ["Tim Hortons (Orca House)", "Baked goods", "Chocolate Chip Cookie", null, 1.69],
  ["Tim Hortons (David Lam)", "Baked goods", "Chocolate Chip Cookie", null, 1.69],
  ["Togo Sushi", "Sushi", "Maki Sushi Combo", null, 17.35],
  ["H-Mart", "Grab and go", "Sushi Pack (California Roll)", "8 pcs", 6.75],
  ["Togo Sushi", "Sushi", "Salmon Roll", null, 8.5],
  ["Tim Hortons (Orca House)", "Hot drinks", "Steeped Tea", "Small 10 oz", 2.09],
  ["The Point Grill", "Mains", "Steak Sandwich", null, 18.0],
  ["Blue Chip Cafe", "Coffee Drinks", "Latte", "16oz", 5.99],
].map(([outlet, category, item, variant, price]) => ({
  outlet: outlet as string,
  category: category as string,
  item: item as string,
  variant: variant as string | null,
  price: price as number,
}));
const MENU_INDEX = prepareMenu(MENU);
const menu = (q: string) => searchMenu(q, MENU_INDEX);
const items = (q: string) => menu(q).lines.map((l) => l.item);

describe("searchMenu", () => {
  it("ramen finds every ramen by item name, cheapest first, and not the rest of Kinton's menu", () => {
    const r = menu("ramen");
    assert.equal(r.kind, "match");
    assert.deepEqual(items("ramen"), [
      "Instant Ramen (Shin)",
      "Miso Roasted Chicken Ramen",
      "Pork Shoyu Ramen",
      "Tonkotsu Ramen",
      "Chicken Miso Ramen",
      "Classic Tonkotsu Ramen",
    ]);
    assert.ok(!items("ramen").includes("Edamame"), "a menu section called Ramen doesn't pull in its edamame");
  });

  it("cookie finds cookies, and groups the same name across outlets", () => {
    assert.deepEqual(items("cookie"), ["Cookie", "Chocolate Chip Cookie", "Chocolate Chip Cookie", "Chocolate Chunk Cookie"]);
    assert.deepEqual(items("cookies"), items("cookie"), "a plural finds the singular");
    const groups = groupByItemName(menu("cookie").lines);
    assert.deepEqual(
      groups.map((g) => [g.name, g.lines.length]),
      [["Cookie", 1], ["Chocolate Chip Cookie", 2], ["Chocolate Chunk Cookie", 1]],
    );
  });

  it("sushi finds item names first; menu sections only when no name matches", () => {
    assert.deepEqual(items("sushi"), ["Sushi Pack (California Roll)", "Maki Sushi Combo"]);
    assert.ok(!items("sushi").includes("Salmon Roll"), "Togo's Salmon Roll only matches through its section");
    const r = menu("izakaya");
    assert.equal(r.kind, "category");
    assert.deepEqual(items("izakaya"), ["Tonkotsu Ramen"]);
  });

  it("tonkotsu finds both tonkotsu ramens", () => {
    assert.equal(menu("tonkotsu").kind, "match");
    assert.deepEqual(items("Tonkotsu"), ["Tonkotsu Ramen", "Classic Tonkotsu Ramen"]);
  });

  it("a typo: raemn means ramen", () => {
    const r = menu("raemn");
    assert.equal(r.kind, "typo");
    if (r.kind !== "typo") return;
    assert.equal(r.didYouMean, "ramen");
    assert.equal(r.lines[0].item, "Instant Ramen (Shin)");
    assert.equal(r.total, 6);
    assert.equal(menu("tonkatsu").kind, "typo", "tonkatsu is one letter off tonkotsu");
  });

  it("matches the start of words, so tea doesn't find steak", () => {
    assert.deepEqual(items("tea"), ["Steeped Tea"]);
    assert.deepEqual(items("chicken ramen"), ["Miso Roasted Chicken Ramen", "Chicken Miso Ramen"]);
    assert.deepEqual(items("latte 16oz"), ["Latte"], "the variant counts for multi-word queries");
  });

  it("caps the lines, counts the total, and ignores one-letter and empty queries", () => {
    const r = searchMenu("ramen", MENU_INDEX, 2);
    assert.equal(r.lines.length, 2);
    assert.equal(r.total, 6);
    assert.equal(menu("r").kind, "empty");
    assert.equal(menu(" -- ").kind, "empty");
    assert.equal(menu("zzzz").kind, "none");
  });
});
