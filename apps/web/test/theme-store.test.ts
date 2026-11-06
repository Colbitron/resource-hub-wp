import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_ATTRIBUTE, THEME_STORAGE_KEY, type ThemeChoice } from "../lib/theme";

/**
 * The client store behind the theme control (`lib/theme-store.ts`), run
 * against stubs of the three browser globals it touches: `localStorage`,
 * `window` (its two event listeners) and `document.documentElement`. Each
 * test loads a fresh copy of the module, so the unpersisted choice and the
 * listener set start empty.
 *
 * The property every case holds: what `readTheme` answers, which is what the
 * control shows checked, is what `<html>` shows.
 */

type Store = typeof import("../lib/theme-store");

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** A `localStorage` that holds values, and throws on read or write when told to. */
function storage(options: { readThrows?: boolean; writeThrows?: boolean } = {}) {
  const values = new Map<string, string>();
  const area = {
    readThrows: options.readThrows ?? false,
    writeThrows: options.writeThrows ?? false,
    values,
    getItem(key: string) {
      if (area.readThrows) throw new DOMException("blocked", "SecurityError");
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (area.writeThrows) throw new DOMException("full", "QuotaExceededError");
      values.set(key, value);
    },
    removeItem(key: string) {
      if (area.writeThrows) throw new DOMException("blocked", "SecurityError");
      values.delete(key);
    },
  } satisfies Storage & Record<string, unknown>;
  return area;
}

/** A `window` that records its listeners and can dispatch to them. */
function windowStub() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    listeners,
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatch(type: string, event: unknown) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

/** `<html>`, holding its attributes. */
function rootStub() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    removeAttribute(name: string) {
      attributes.delete(name);
    },
  };
}

let local: ReturnType<typeof storage>;
let session: ReturnType<typeof storage>;
let win: ReturnType<typeof windowStub>;
let root: ReturnType<typeof rootStub>;

async function load(options: Parameters<typeof storage>[0] = {}): Promise<Store> {
  local = storage(options);
  session = storage();
  win = windowStub();
  root = rootStub();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { documentElement: root });
  return import("../lib/theme-store");
}

/** What `<html>` shows, as a choice. */
function shown(): ThemeChoice {
  const value = root.attributes.get(THEME_ATTRIBUTE);
  return value === "light" || value === "dark" ? value : "system";
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading and writing", () => {
  it("reads the stored value, and System when there is none", async () => {
    const store = await load();
    expect(store.readTheme()).toBe("system");
    local.values.set(THEME_STORAGE_KEY, "dark");
    expect(store.readTheme()).toBe("dark");
    local.values.set(THEME_STORAGE_KEY, "sepia");
    expect(store.readTheme()).toBe("system");
  });

  it("stores Light and Dark, removes the key for System, and applies each to <html>", async () => {
    const store = await load();
    store.setTheme("dark");
    expect(local.values.get(THEME_STORAGE_KEY)).toBe("dark");
    expect(root.attributes.get(THEME_ATTRIBUTE)).toBe("dark");
    expect(store.readTheme()).toBe("dark");

    store.setTheme("light");
    expect(local.values.get(THEME_STORAGE_KEY)).toBe("light");
    expect(shown()).toBe("light");

    store.setTheme("system");
    expect(local.values.has(THEME_STORAGE_KEY)).toBe(false);
    expect(root.attributes.has(THEME_ATTRIBUTE)).toBe(false);
    expect(store.readTheme()).toBe("system");
  });

  it("is null on the server, so hydration renders nothing checked", async () => {
    const store = await load();
    expect(store.getServerSnapshot()).toBeNull();
  });
});

describe("storage that refuses", () => {
  it("cannot be read or written: the choice holds for the page, and the control agrees with it", async () => {
    const store = await load({ readThrows: true, writeThrows: true });
    expect(store.readTheme()).toBe("system");
    expect(shown()).toBe("system");
    for (const choice of ["dark", "light", "system", "dark"] as const) {
      store.setTheme(choice);
      expect(shown()).toBe(choice);
      expect(store.readTheme()).toBe(choice);
    }
  });

  it("can be read but not written: the control shows the choice made, not the stale stored value", async () => {
    const store = await load({ writeThrows: true });
    local.values.set(THEME_STORAGE_KEY, "light");
    expect(store.readTheme()).toBe("light");

    store.setTheme("dark");
    expect(local.values.get(THEME_STORAGE_KEY)).toBe("light");
    expect(shown()).toBe("dark");
    expect(store.readTheme()).toBe("dark");

    store.setTheme("system");
    expect(shown()).toBe("system");
    expect(store.readTheme()).toBe("system");
  });

  it("forgets the unpersisted choice once a write succeeds", async () => {
    const store = await load({ writeThrows: true });
    store.setTheme("dark");
    expect(store.readTheme()).toBe("dark");

    local.writeThrows = false;
    store.setTheme("light");
    expect(local.values.get(THEME_STORAGE_KEY)).toBe("light");
    // Storage holds the choice now: a later change there is what counts.
    local.values.set(THEME_STORAGE_KEY, "dark");
    expect(store.readTheme()).toBe("dark");
  });
});

describe("subscribers", () => {
  it("adds the window listeners with the first subscriber and removes them with the last", async () => {
    const store = await load();
    expect(win.count("storage")).toBe(0);
    expect(win.count("pageshow")).toBe(0);

    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(first);
    const unsubscribeSecond = store.subscribe(second);
    expect(win.count("storage")).toBe(1);
    expect(win.count("pageshow")).toBe(1);
    expect(win.addEventListener).toHaveBeenCalledTimes(2);

    store.setTheme("dark");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    expect(win.count("storage")).toBe(1);
    store.setTheme("light");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
    expect(win.count("storage")).toBe(0);
    expect(win.count("pageshow")).toBe(0);
  });

  it("notifies once for a listener subscribed twice, as a Set holds it once", async () => {
    const store = await load();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.subscribe(listener);
    store.setTheme("dark");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(win.count("storage")).toBe(0);
  });
});

describe("another tab", () => {
  it("writing our key re-applies the stored value here and notifies", async () => {
    const store = await load();
    const listener = vi.fn();
    store.subscribe(listener);

    local.values.set(THEME_STORAGE_KEY, "dark");
    win.dispatch("storage", { key: THEME_STORAGE_KEY, storageArea: local });
    expect(shown()).toBe("dark");
    expect(store.readTheme()).toBe("dark");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clearing storage (a null key) hands the page back to System", async () => {
    const store = await load();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setTheme("dark");
    listener.mockClear();

    local.values.clear();
    win.dispatch("storage", { key: null, storageArea: local });
    expect(shown()).toBe("system");
    expect(store.readTheme()).toBe("system");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("writing another key changes nothing and notifies no one", async () => {
    const store = await load();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setTheme("light");
    listener.mockClear();

    local.values.set(THEME_STORAGE_KEY, "dark");
    win.dispatch("storage", { key: "something-else", storageArea: local });
    expect(shown()).toBe("light");
    expect(listener).not.toHaveBeenCalled();
  });

  it("writing sessionStorage, even under our key, changes nothing", async () => {
    const store = await load();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setTheme("light");
    listener.mockClear();

    local.values.set(THEME_STORAGE_KEY, "dark");
    win.dispatch("storage", { key: THEME_STORAGE_KEY, storageArea: session });
    win.dispatch("storage", { key: null, storageArea: session });
    expect(shown()).toBe("light");
    expect(listener).not.toHaveBeenCalled();
  });

  it("a write there replaces a choice this tab could not store", async () => {
    const store = await load({ writeThrows: true });
    store.subscribe(vi.fn());
    store.setTheme("dark");
    expect(store.readTheme()).toBe("dark");

    local.values.set(THEME_STORAGE_KEY, "light");
    win.dispatch("storage", { key: THEME_STORAGE_KEY, storageArea: local });
    expect(shown()).toBe("light");
    expect(store.readTheme()).toBe("light");
  });
});

describe("the back/forward cache", () => {
  it("re-reads the stored value when the page is restored from it, and not on an ordinary load", async () => {
    const store = await load();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setTheme("light");
    listener.mockClear();

    // Another tab chose Dark while this page was frozen; no storage event reached it.
    local.values.set(THEME_STORAGE_KEY, "dark");
    win.dispatch("pageshow", { persisted: false });
    expect(shown()).toBe("light");
    expect(listener).not.toHaveBeenCalled();

    win.dispatch("pageshow", { persisted: true });
    expect(shown()).toBe("dark");
    expect(store.readTheme()).toBe("dark");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
