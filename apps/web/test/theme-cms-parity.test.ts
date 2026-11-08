import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { THEME_ATTRIBUTE, THEME_CHOICES, THEME_INIT_SCRIPT, THEME_STORAGE_KEY, themeFromStored } from "../lib/theme";

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
 * until the other follows. The source checks read only the literals, in any
 * layout a formatter may give them; everything else is checked by running the
 * script, and the events it answers are the ones `theme-store.test.ts` sends
 * the front end's store.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const script = readFileSync(path.resolve(here, "../../../wp-content/themes/resource-hub/js/theme-control.js"), "utf8");

const STORED = THEME_CHOICES.filter((choice) => choice !== "system");

/** The one string literal a `const NAME = '…'` declaration in the theme's script holds, in either quote and any spacing. */
function constant(name: string): string {
  const match = script.match(new RegExp(`\\bconst\\s+${name}\\s*=\\s*(['"])([^'"]*)\\1`));
  expect(match, `the theme's script declares ${name}`).not.toBeNull();
  return match![2]!;
}

interface Listener {
  (event: Record<string, unknown>): void;
}

interface FakeInput {
  value: string;
  checked: boolean;
}

type Stored = string | null | (() => never);

/**
 * The theme's script run against stubs: the attributes it leaves on `<html>`,
 * the listeners it added, what it wrote, the `localStorage` stub, and a way to
 * change what that stub holds, as another tab's write would.
 */
function run(initial: Stored, inputs: FakeInput[] = []) {
  let stored = initial;
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
      expect(key).toBe(THEME_STORAGE_KEY);
      writes.push(`set ${key}=${value}`);
    },
    removeItem(key: string) {
      expect(key).toBe(THEME_STORAGE_KEY);
      writes.push(`remove ${key}`);
    },
  };
  const windowStub = {
    addEventListener(type: string, listener: Listener) {
      windowListeners.set(type, listener);
    },
  };
  new Function("document", "localStorage", "window", script)(documentStub, localStorageStub, windowStub);
  const store = (value: Stored) => {
    stored = value;
  };
  return { attributes, documentListeners, windowListeners, fieldsetListeners, writes, pending, localStorageStub, store };
}

/** Which radio is checked, as a choice; `null` for none. */
function checked(inputs: FakeInput[]): string | null {
  const on = inputs.filter((input) => input.checked);
  expect(on.length).toBeLessThanOrEqual(1);
  return on[0]?.value ?? null;
}

/** The theme's script with the DOM parsed, three radios in its control. */
function wired(initial: Stored) {
  const inputs = THEME_CHOICES.map((choice) => ({ value: choice, checked: false }));
  const ran = run(initial, inputs);
  ran.documentListeners.get("DOMContentLoaded")!({});
  /** What `<html>` shows, as a choice. */
  const shown = () => themeFromStored(ran.attributes.get(THEME_ATTRIBUTE) ?? null);
  return { ...ran, inputs, shown };
}

/** A `sessionStorage` stub, which a `storage` event can name as its area. */
const sessionStorageStub = { getItem: () => null };

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

  it("names no other storage key or attribute", () => {
    const argument = (call: string) => call.replace(/.*\(\s*/, "");
    expect(script.match(/localStorage\s*\.\s*\w+\s*\(\s*\w+/g)?.map(argument)).toEqual([
      "STORAGE_KEY",
      "STORAGE_KEY",
      "STORAGE_KEY",
    ]);
    expect(script.match(/(?:set|remove)Attribute\s*\(\s*\w+/g)?.map(argument)).toEqual(["ATTRIBUTE", "ATTRIBUTE"]);
  });
});

describe("the CMS theme's script does what the front end's head script does", () => {
  for (const stored of [...STORED, null, "", "auto", "LIGHT", "system"]) {
    it(`leaves <html> as the head script does with ${JSON.stringify(stored)} stored`, () => {
      expect(run(stored).attributes).toEqual(runInit(stored));
    });
  }

  for (const stored of [...STORED, null, "", "auto", "LIGHT", "system"]) {
    it(`checks the radio the front end's store reads from ${JSON.stringify(stored)}`, () => {
      expect(checked(wired(stored).inputs)).toBe(themeFromStored(stored));
    });
  }

  it("stores each of the control's choices as the front end's store does, and ignores any other value", () => {
    const { fieldsetListeners, writes, shown } = wired(null);
    const change = fieldsetListeners.get("change")!;
    for (const choice of THEME_CHOICES) {
      change({ target: { value: choice } });
      expect(shown()).toBe(choice);
    }
    expect(writes).toEqual([
      `remove ${THEME_STORAGE_KEY}`,
      ...STORED.map((choice) => `set ${THEME_STORAGE_KEY}=${choice}`),
    ]);

    writes.length = 0;
    for (const value of ["sepia", "LIGHT", "", "auto"]) {
      change({ target: { value } });
    }
    expect(writes).toEqual([]);
    expect(shown()).toBe("dark");
  });

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

describe("the CMS theme's script follows another tab as the front end's store does", () => {
  it("writing our key re-applies the stored value and checks its radio", () => {
    const { windowListeners, localStorageStub, store, inputs, shown } = wired("light");
    store("dark");
    windowListeners.get("storage")!({ key: THEME_STORAGE_KEY, storageArea: localStorageStub });
    expect(shown()).toBe("dark");
    expect(checked(inputs)).toBe("dark");
  });

  it("clearing storage (a null key) hands the page back to System", () => {
    const { windowListeners, localStorageStub, store, inputs, shown } = wired("dark");
    store(null);
    windowListeners.get("storage")!({ key: null, storageArea: localStorageStub });
    expect(shown()).toBe("system");
    expect(checked(inputs)).toBe("system");
  });

  it("writing another key changes nothing", () => {
    const { windowListeners, localStorageStub, store, inputs, shown } = wired("light");
    store("dark");
    windowListeners.get("storage")!({ key: "something-else", storageArea: localStorageStub });
    expect(shown()).toBe("light");
    expect(checked(inputs)).toBe("light");
  });

  it("writing sessionStorage, even under our key, changes nothing", () => {
    const { windowListeners, store, inputs, shown } = wired("light");
    store("dark");
    windowListeners.get("storage")!({ key: THEME_STORAGE_KEY, storageArea: sessionStorageStub });
    windowListeners.get("storage")!({ key: null, storageArea: sessionStorageStub });
    expect(shown()).toBe("light");
    expect(checked(inputs)).toBe("light");
  });
});

describe("the CMS theme's script and the back/forward cache", () => {
  it("re-reads the stored value when the page is restored from it, and not on an ordinary load", () => {
    const { windowListeners, store, inputs, shown } = wired("light");

    // Another tab chose Dark while this page was frozen; no storage event reached it.
    store("dark");
    windowListeners.get("pageshow")!({ persisted: false });
    expect(shown()).toBe("light");
    expect(checked(inputs)).toBe("light");

    windowListeners.get("pageshow")!({ persisted: true });
    expect(shown()).toBe("dark");
    expect(checked(inputs)).toBe("dark");
  });

  it("goes back to System when the other tab chose it, or storage now throws", () => {
    const { windowListeners, store, inputs, shown } = wired("dark");
    store(null);
    windowListeners.get("pageshow")!({ persisted: true });
    expect(shown()).toBe("system");
    expect(checked(inputs)).toBe("system");

    store("light");
    windowListeners.get("pageshow")!({ persisted: true });
    expect(shown()).toBe("light");
    store(throws);
    windowListeners.get("pageshow")!({ persisted: true });
    expect(shown()).toBe("system");
    expect(checked(inputs)).toBe("system");
  });
});
