import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { THEME_ATTRIBUTE, THEME_CHOICES, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "../lib/theme";

/**
 * The CMS theme's System / Light / Dark control is its own script,
 * `wp-content/themes/resource-hub/js/theme-control.js`, since the contract
 * package shares CSS and markup but no JavaScript (`packages/ui/DESIGN.md`).
 * So a reader who uses both sites on one browser profile is served by two
 * programs that must agree on three facts: the `localStorage` key, the two
 * values it may hold, and the attribute on `<html>` they set. This holds the
 * theme's script to the constants in `lib/theme.ts`, twice over: the
 * literals in its source, and what it does, run as a string against the
 * stubs `theme.test.ts` runs the head script against, for every value storage
 * can hold. A change to either side's key, values or attribute fails here
 * until the other follows.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const script = readFileSync(path.resolve(here, "../../../wp-content/themes/resource-hub/js/theme-control.js"), "utf8");

const STORED = THEME_CHOICES.filter((choice) => choice !== "system");

/** The one string literal a `const NAME = '…'` line in the theme's script holds. */
function constant(name: string): string {
  const match = script.match(new RegExp(`const ${name} = '([^']*)';`));
  expect(match, `the theme's script declares ${name}`).not.toBeNull();
  return match![1]!;
}

interface Listener {
  (event: Record<string, unknown>): void;
}

interface FakeInput {
  value: string;
  checked: boolean;
}

/** The theme's script run against stubs: the attributes it leaves on `<html>`, the listeners it added, and what it wrote. */
function run(stored: string | null | (() => never), inputs: FakeInput[] = []) {
  const attributes = new Map<string, string>();
  const documentListeners = new Map<string, Listener>();
  const windowListeners = new Map<string, Listener>();
  const fieldsetListeners = new Map<string, Listener>();
  const writes: string[] = [];
  const pending = new Set(["rh-theme--pending"]);
  const fieldset = {
    addEventListener(type: string, listener: Listener) {
      fieldsetListeners.set(type, listener);
    },
    classList: {
      remove(name: string) {
        pending.delete(name);
      },
    },
  };
  const documentStub = {
    documentElement: {
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
      removeAttribute(name: string) {
        attributes.delete(name);
      },
    },
    readyState: "loading",
    addEventListener(type: string, listener: Listener) {
      documentListeners.set(type, listener);
    },
    querySelectorAll(selector: string) {
      return selector.includes("input") ? inputs : [fieldset];
    },
  };
  const localStorageStub = {
    getItem(key: string) {
      expect(key).toBe(THEME_STORAGE_KEY);
      if (typeof stored === "function") stored();
      return stored;
    },
    setItem(key: string, value: string) {
      writes.push(`set ${key}=${value}`);
    },
    removeItem(key: string) {
      writes.push(`remove ${key}`);
    },
  };
  const windowStub = {
    addEventListener(type: string, listener: Listener) {
      windowListeners.set(type, listener);
    },
  };
  new Function("document", "localStorage", "window", script)(documentStub, localStorageStub, windowStub);
  return { attributes, documentListeners, windowListeners, fieldsetListeners, writes, pending };
}

/** The front end's head script run against the same kind of stubs: the attributes it leaves. */
function runInit(stored: string | null | (() => never)): Map<string, string> {
  const attributes = new Map<string, string>();
  const documentStub = {
    documentElement: {
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
    },
  };
  const localStorageStub = {
    getItem() {
      if (typeof stored === "function") stored();
      return stored;
    },
  };
  new Function("document", "localStorage", THEME_INIT_SCRIPT)(documentStub, localStorageStub);
  return attributes;
}

const throws = (): never => {
  throw new Error("storage is blocked");
};

describe("the CMS theme's script keeps the front end's constants", () => {
  it("stores the choice under the same key", () => {
    expect(constant("STORAGE_KEY")).toBe(THEME_STORAGE_KEY);
  });

  it("applies it as the same attribute", () => {
    expect(constant("ATTRIBUTE")).toBe(THEME_ATTRIBUTE);
  });

  it("knows the same two stored values and System as their absence", () => {
    // The check the script reads storage with: one `value === '…'` per stored value, and nothing else.
    const check = script.match(/return (value === '[a-z]+'(?: \|\| value === '[a-z]+')*) \? value : 'system';/);
    expect(check, "the theme's script maps a stored value to a choice").not.toBeNull();
    const values = [...check![1]!.matchAll(/value === '([a-z]+)'/g)].map((match) => match[1]);
    expect(values).toEqual(STORED);
    // The values the control's change handler accepts, in the control's order.
    const accepted = script.match(/choice !== '([a-z]+)' && choice !== '([a-z]+)' && choice !== '([a-z]+)'/);
    expect(accepted?.slice(1)).toEqual([...THEME_CHOICES]);
  });

  it("names no other storage key or attribute", () => {
    expect(script.match(/localStorage\.\w+\(\s*(\w+)/g)?.map((call) => call.replace(/.*\(\s*/, ""))).toEqual([
      "STORAGE_KEY",
      "STORAGE_KEY",
      "STORAGE_KEY",
    ]);
    expect(script.match(/(?:set|remove)Attribute\(\s*(\w+)/g)?.map((call) => call.replace(/.*\(\s*/, ""))).toEqual([
      "ATTRIBUTE",
      "ATTRIBUTE",
    ]);
  });
});

describe("the CMS theme's script does what the front end's head script does", () => {
  for (const stored of [...STORED, null, "", "auto", "LIGHT", "system"]) {
    it(`leaves <html> as the head script does with ${JSON.stringify(stored)} stored`, () => {
      expect(run(stored).attributes).toEqual(runInit(stored));
    });
  }

  it("sets nothing and throws nothing when storage throws", () => {
    expect(run(throws).attributes).toEqual(runInit(throws));
    expect(run(throws).attributes.size).toBe(0);
  });

  it("applies the stored choice at once, before it waits for the DOM", () => {
    const { attributes, documentListeners, fieldsetListeners } = run("dark");
    expect(attributes.get(THEME_ATTRIBUTE)).toBe("dark");
    // The wiring waits for the DOM while the document is still loading.
    expect([...documentListeners.keys()]).toEqual(["DOMContentLoaded"]);
    expect(fieldsetListeners.size).toBe(0);
  });

  it("checks the stored choice's radio, shows the group, and applies and stores each change", () => {
    const inputs = THEME_CHOICES.map((choice) => ({ value: choice, checked: false }));
    const { attributes, documentListeners, fieldsetListeners, windowListeners, writes, pending } = run("light", inputs);
    documentListeners.get("DOMContentLoaded")!({});

    expect(inputs.map((input) => input.checked)).toEqual([false, true, false]);
    expect(pending.size).toBe(0);
    expect([...fieldsetListeners.keys()]).toEqual(["change"]);
    expect([...windowListeners.keys()].sort()).toEqual(["pageshow", "storage"]);

    const change = fieldsetListeners.get("change")!;
    change({ target: { value: "dark" } });
    expect(attributes.get(THEME_ATTRIBUTE)).toBe("dark");
    change({ target: { value: "system" } });
    expect(attributes.has(THEME_ATTRIBUTE)).toBe(false);
    change({ target: { value: "sepia" } });
    expect(attributes.has(THEME_ATTRIBUTE)).toBe(false);
    expect(writes).toEqual([`set ${THEME_STORAGE_KEY}=dark`, `remove ${THEME_STORAGE_KEY}`]);
  });
});
