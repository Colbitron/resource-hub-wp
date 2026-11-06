import { describe, expect, it } from "vitest";

import { THEME_ATTRIBUTE, THEME_CHOICES, THEME_INIT_SCRIPT, THEME_STORAGE_KEY, themeFromStored } from "../lib/theme";

/**
 * The head script (`THEME_INIT_SCRIPT`) runs before anything else on every
 * page, with no bundle and no React, so it is tested as what it is: a
 * string of JavaScript, run here against a stub `document` and
 * `localStorage`. The end-to-end spec (`e2e/theme.spec.ts`) proves it
 * themes the first paint on its own in a real browser; this test pins what
 * it does with each value storage can hold, and that it survives storage
 * that throws.
 */

interface Stub {
  attributes: Map<string, string>;
  run(): void;
}

/** Runs the script with `localStorage.getItem` answering `stored`, or throwing when it is a function. */
function stub(stored: string | null | (() => never)): Stub {
  const attributes = new Map<string, string>();
  const documentStub = {
    documentElement: {
      setAttribute(name: string, value: string) {
        attributes.set(name, value);
      },
    },
  };
  const localStorageStub = {
    getItem(key: string) {
      expect(key).toBe(THEME_STORAGE_KEY);
      if (typeof stored === "function") stored();
      return stored;
    },
  };
  // The script's free identifiers, `document` and `localStorage`, resolve to
  // the parameters; nothing else is reachable.
  const run = new Function("document", "localStorage", THEME_INIT_SCRIPT) as (d: unknown, l: unknown) => void;
  return { attributes, run: () => run(documentStub, localStorageStub) };
}

describe("the head script", () => {
  it("is one expression that leaves nothing in the global scope", () => {
    expect(THEME_INIT_SCRIPT).toMatch(/^\(function\(\)\{.*\}\)\(\)$/);
    expect(THEME_INIT_SCRIPT).not.toContain("\n");
  });

  it.each(["light", "dark"])("sets data-theme to a stored %s", (value) => {
    const page = stub(value);
    page.run();
    expect(page.attributes.get(THEME_ATTRIBUTE)).toBe(value);
  });

  it("sets nothing when nothing is stored (System)", () => {
    const page = stub(null);
    page.run();
    expect(page.attributes.size).toBe(0);
  });

  it.each(["system", "DARK", "", "auto", "dark "])("sets nothing for a value it does not know (%j)", (value) => {
    const page = stub(value);
    page.run();
    expect(page.attributes.size).toBe(0);
  });

  it("sets nothing and does not throw when storage cannot be read", () => {
    const page = stub(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => page.run()).not.toThrow();
    expect(page.attributes.size).toBe(0);
  });
});

describe("the stored value", () => {
  it("is read the same way by the component as by the script", () => {
    for (const value of ["light", "dark"] as const) {
      expect(themeFromStored(value)).toBe(value);
      const page = stub(value);
      page.run();
      expect(page.attributes.get(THEME_ATTRIBUTE)).toBe(themeFromStored(value));
    }
    for (const value of [null, undefined, "", "system", "DARK"]) {
      expect(themeFromStored(value)).toBe("system");
    }
  });

  it("has System first, as the default and the control's first option", () => {
    expect(THEME_CHOICES).toEqual(["system", "light", "dark"]);
  });
});
