// Search tests (docs/SPEC.md section 7). Run with Node's built-in test runner and TypeScript support:
//   npm test      (node --test tests/*.test.ts)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { damerauLevenshtein, normalise, parseAliases, searchItems, typoBudget } from "../src/lib/search.ts";

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
