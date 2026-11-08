import { expect, test, type Page } from "@playwright/test";

import { wcagViolations } from "./axe.mts";
import { appSiteOrigin } from "./mock-cms/config.mts";

/**
 * The theme control (`components/ThemeToggle.tsx`, `lib/theme.ts`): the
 * System / Light / Dark radios at the end of the site footer, the stored
 * choice, the head script that themes the first paint, and what each kind
 * of reader gets. Every check here is on the welcome page at `/`, since the
 * control is in the shell on every page; `specimen.spec.ts` checks the
 * specimen's still copies.
 *
 * The values are never written down here: the dark and the light surface
 * are read from a page that follows the emulated system scheme, and every
 * other page's colour is compared with those.
 */

const STORAGE_KEY = "rh-theme";

const NAMES = { system: "System theme", light: "Light theme", dark: "Dark theme" } as const;
type Choice = keyof typeof NAMES;

function group(page: Page) {
  return page.getByRole("group", { name: "Theme" });
}

/** Where a focused element is: the skip link, or the landmark it is in, or `null` for none (the page itself). */
type Stop = { region: "skip" | "banner" | "main" | "contentinfo" | null; name: string; theme: boolean };

async function focusedStop(page: Page): Promise<Stop> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element === null || element === document.body) return { region: null, name: "", theme: false };
    const region = element.classList.contains("rh-skip")
      ? "skip"
      : element.closest("header.rh-header")
        ? "banner"
        : element.closest("main")
          ? "main"
          : element.closest("footer.rh-footer")
            ? "contentinfo"
            : null;
    // The header's search button is named by `aria-label`, around an icon with no text.
    const name = element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "";
    return { region, name, theme: element.closest("fieldset.rh-theme") !== null };
  });
}

/** Presses Tab from the top of the page until the theme control has focus, and returns every stop on the way, the control's last. */
async function tabToTheme(page: Page): Promise<Stop[]> {
  const stops: Stop[] = [];
  for (let presses = 0; presses < 40; presses += 1) {
    await page.keyboard.press("Tab");
    const stop = await focusedStop(page);
    stops.push(stop);
    if (stop.theme) return stops;
  }
  throw new Error(`the theme control was not reached in 40 Tab presses: ${JSON.stringify(stops)}`);
}

function radio(page: Page, choice: Choice) {
  return page.getByRole("radio", { name: NAMES[choice], exact: true });
}

/** Stores a choice before any page script runs, as a reader's earlier visit would have. */
async function store(page: Page, value: "light" | "dark" | null) {
  await page.addInitScript(
    ({ key, value }) => {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    },
    { key: STORAGE_KEY, value },
  );
}

async function surface(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

async function colorScheme(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
}

async function stored(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
}

const html = (page: Page) => page.locator("html");

test.describe("System", () => {
  test("is the default: nothing stored, nothing on <html>, and the page follows the system scheme live", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(group(page)).toBeVisible();
    await expect(radio(page, "system")).toBeChecked();
    // In the footer, and only there: the header holds the site's name alone.
    await expect(page.getByRole("contentinfo").getByRole("group", { name: "Theme" })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("group")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("group", { name: "Theme" })).toHaveCount(0);
    await expect(html(page)).not.toHaveAttribute("data-theme");
    expect(await colorScheme(page)).toBe("light dark");
    expect(await stored(page)).toBeNull();
    const dark = await surface(page);
    // The system preference changes while the page is open: the tokens
    // re-resolve with no script and no reload.
    await page.emulateMedia({ colorScheme: "light" });
    const light = await surface(page);
    expect(light).not.toBe(dark);
    await expect(radio(page, "system")).toBeChecked();
  });

  test("renders no option checked on the server, and the group invisible until hydration", async ({ request }) => {
    const body = await (await request.get("/")).text();
    const fieldset = body.match(/<fieldset class="rh-theme[^"]*"[\s\S]*?<\/fieldset>/)?.[0];
    expect(fieldset).toBeDefined();
    expect(fieldset).toContain("rh-theme--pending");
    expect(fieldset).not.toMatch(/\schecked/);
    expect(fieldset?.match(/type="radio"/g)).toHaveLength(3);
  });
});

test.describe("choosing", () => {
  test("Dark applies at once, is stored, survives a reload, and System removes the key", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(group(page)).toBeVisible();
    const light = await surface(page);

    await radio(page, "dark").check();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    expect(await colorScheme(page)).toBe("dark");
    expect(await stored(page)).toBe("dark");
    const dark = await surface(page);
    expect(dark).not.toBe(light);

    await page.reload();
    await expect(group(page)).toBeVisible();
    await expect(radio(page, "dark")).toBeChecked();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    expect(await surface(page)).toBe(dark);

    await radio(page, "light").check();
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    expect(await stored(page)).toBe("light");
    expect(await surface(page)).toBe(light);

    await radio(page, "system").check();
    await expect(html(page)).not.toHaveAttribute("data-theme");
    expect(await stored(page)).toBeNull();
    expect(await colorScheme(page)).toBe("light dark");
  });

  test("a stored choice beats the system scheme on load", async ({ page }) => {
    await store(page, "light");
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect(group(page)).toBeVisible();
    await expect(radio(page, "light")).toBeChecked();
    expect(await colorScheme(page)).toBe("light");
  });
});

test.describe("first paint", () => {
  test("is themed by the head script alone, with every script bundle blocked", async ({ page }) => {
    // The surfaces, from a page that follows the emulated scheme.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    const dark = await surface(page);
    await page.emulateMedia({ colorScheme: "light" });
    const light = await surface(page);
    expect(dark).not.toBe(light);

    // Now Dark is stored, the system scheme is light, and no bundle loads:
    // the CSS (inline in the HTML, `inlineCss` in next.config.ts) and the
    // font (under `/_next/static/` too) still do, every JavaScript file does
    // not, so React never runs. The inline script in <head> is all there is.
    await page.evaluate((key) => localStorage.setItem(key, "dark"), STORAGE_KEY);
    await page.route(
      (url) => url.pathname.startsWith("/_next/static/") && url.pathname.endsWith(".js"),
      (route) => route.abort(),
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(html(page)).toHaveAttribute("data-theme", "dark");
    await page.waitForLoadState("load");
    expect(await colorScheme(page)).toBe("dark");
    expect(await surface(page)).toBe(dark);
    // Without hydration the control stays invisible: nothing it shows could be trusted.
    await expect(page.locator("fieldset.rh-theme")).toHaveClass(/rh-theme--pending/);
    await expect(group(page)).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
  });

  // What this proves on the production build the suite runs: no uncaught
  // error, and no hydration failure that makes React throw the server's
  // markup away and render on the client, which production React logs as a
  // console error (minified error #418 or #425). It cannot prove the absence
  // of an attribute mismatch warning: production React never reports one,
  // with or without `suppressHydrationWarning`. That prop is pinned in the
  // source by `test/hydration-warning.test.ts`, and `e2e/theme.dev.ts` (run
  // by hand, `pnpm web:test:dev`) loads the page under `next dev`, where the
  // warning would be logged.
  for (const choice of ["system", "light", "dark"] as const) {
    test(`hydrates with ${choice} stored and logs no console error or warning`, async ({ page }) => {
      const messages: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") messages.push(message.text());
      });
      page.on("pageerror", (error) => messages.push(error.message));
      await store(page, choice === "system" ? null : choice);
      await page.goto("/");
      await expect(group(page)).toBeVisible();
      await expect(radio(page, choice)).toBeChecked();
      await page.waitForLoadState("load");
      expect(messages).toEqual([]);
    });
  }
});

test.describe("keyboard", () => {
  test("comes last: after the skip link, the site's name, the header's search, the page's content and the footer's links", async ({ page }) => {
    await page.goto("/");
    await expect(group(page)).toBeVisible();
    const stops = await tabToTheme(page);
    expect(stops[0]).toMatchObject({ region: "skip", name: "Skip to content" });
    expect(stops[1]).toMatchObject({ region: "banner", name: "Resource Hub" });
    expect(stops[2]).toMatchObject({ region: "banner", name: "Search" });
    // Then every link in the welcome page's body, in order, and nothing else.
    const content = await page.getByRole("main").getByRole("link").allTextContents();
    expect(content.length).toBeGreaterThan(0);
    const between = stops.slice(3, -1);
    expect(between.slice(0, content.length)).toEqual(content.map((name) => ({ region: "main", name: name.trim(), theme: false })));
    // Then the footer's links, if it has any, in order.
    const footer = await page.getByRole("contentinfo").getByRole("link").allTextContents();
    expect(between.slice(content.length)).toEqual(footer.map((name) => ({ region: "contentinfo", name: name.trim(), theme: false })));
    // And the control, on its checked option.
    expect(stops.at(-1)).toMatchObject({ region: "contentinfo", theme: true });
    await expect(radio(page, "system")).toBeFocused();
  });

  test("is one Tab stop; the arrows move the choice and wrap, applying each at once", async ({ page }) => {
    await page.goto("/");
    await expect(group(page)).toBeVisible();

    await tabToTheme(page);
    await expect(radio(page, "system")).toBeFocused();

    // One more Tab leaves the group: Light and Dark are not stops of their own.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("fieldset.rh-theme") === null)).toBe(true);
    await page.keyboard.press("Shift+Tab");
    await expect(radio(page, "system")).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(radio(page, "light")).toBeFocused();
    await expect(radio(page, "light")).toBeChecked();
    await expect(html(page)).toHaveAttribute("data-theme", "light");
    expect(await stored(page)).toBe("light");

    await page.keyboard.press("ArrowDown");
    await expect(radio(page, "dark")).toBeChecked();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");

    await page.keyboard.press("ArrowRight");
    await expect(radio(page, "system")).toBeChecked();
    await expect(html(page)).not.toHaveAttribute("data-theme");
    expect(await stored(page)).toBeNull();

    await page.keyboard.press("ArrowLeft");
    await expect(radio(page, "dark")).toBeChecked();
    await expect(html(page)).toHaveAttribute("data-theme", "dark");

    // Tab again from the group lands on the checked option on the way back.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(radio(page, "dark")).toBeFocused();
  });

  test("the focused segment shows a focus ring", async ({ page }) => {
    await page.goto("/");
    await expect(group(page)).toBeVisible();
    await tabToTheme(page);
    await expect(radio(page, "system")).toBeFocused();
    const label = page.locator("label[for]", { hasText: "System" });
    const outline = await label.evaluate((node) => {
      const style = getComputedStyle(node);
      return { style: style.outlineStyle, width: style.outlineWidth };
    });
    expect(outline.style).toBe("solid");
    expect(outline.width).not.toBe("0px");
  });

  test("the focus ring fits inside the group and clear of the next segment, on every option", async ({ page }) => {
    await page.goto("/");
    await expect(group(page)).toBeVisible();
    await tabToTheme(page);
    for (const [index, choice] of (["system", "light", "dark"] as const).entries()) {
      if (index > 0) await page.keyboard.press("ArrowRight");
      await expect(radio(page, choice)).toBeFocused();
      const geometry = await page.evaluate((focused) => {
        const fieldset = document.querySelector("fieldset.rh-theme")!;
        const labels = [...fieldset.querySelectorAll("label")];
        const label = labels[focused]!;
        const style = getComputedStyle(label);
        const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
        const box = label.getBoundingClientRect();
        const ring = { left: box.left - reach, top: box.top - reach, right: box.right + reach, bottom: box.bottom + reach };
        const outer = fieldset.getBoundingClientRect();
        const border = getComputedStyle(fieldset);
        // The fieldset's padding box: inside its border, where the ring may be drawn.
        const inner = {
          left: outer.left + parseFloat(border.borderLeftWidth),
          top: outer.top + parseFloat(border.borderTopWidth),
          right: outer.right - parseFloat(border.borderRightWidth),
          bottom: outer.bottom - parseFloat(border.borderBottomWidth),
        };
        const others = labels.filter((_, i) => i !== focused).map((other) => other.getBoundingClientRect());
        const overlaps = others.filter((o) => o.left < ring.right && o.right > ring.left && o.top < ring.bottom && o.bottom > ring.top).length;
        return { style: style.outlineStyle, reach, ring, inner, overlaps };
      }, index);
      expect(geometry.style, choice).toBe("solid");
      expect(geometry.reach, choice).toBeGreaterThan(0);
      expect(geometry.ring.left, choice).toBeGreaterThanOrEqual(geometry.inner.left);
      expect(geometry.ring.top, choice).toBeGreaterThanOrEqual(geometry.inner.top);
      expect(geometry.ring.right, choice).toBeLessThanOrEqual(geometry.inner.right);
      expect(geometry.ring.bottom, choice).toBeLessThanOrEqual(geometry.inner.bottom);
      expect(geometry.overlaps, choice).toBe(0);
    }
  });
});

test.describe("names and sizes", () => {
  for (const width of [320, 1280]) {
    test(`has the same group and option names at ${width}px, with the words visible`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await expect(group(page)).toBeVisible();
      await expect(page.getByRole("radio")).toHaveCount(3);
      for (const choice of ["system", "light", "dark"] as const) {
        await expect(radio(page, choice)).toBeVisible();
        // The word is in the page, not only in the name.
        await expect(group(page).locator("label", { hasText: NAMES[choice].split(" ")[0] })).toBeVisible();
      }
      const widths = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    });
  }

  test("each segment is at least 24px both ways at 320×256, and the input covers it", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 256 });
    await page.goto("/");
    await expect(group(page)).toBeVisible();
    for (const choice of ["system", "light", "dark"] as const) {
      const input = radio(page, choice);
      const label = page.locator(`label[for="${await input.getAttribute("id")}"]`);
      const inputBox = await input.boundingBox();
      const labelBox = await label.boundingBox();
      expect(inputBox, choice).not.toBeNull();
      expect(labelBox, choice).not.toBeNull();
      expect(inputBox!.width, choice).toBeGreaterThanOrEqual(24);
      expect(inputBox!.height, choice).toBeGreaterThanOrEqual(24);
      // The real input sits where the segment is drawn, so a finger finds it.
      for (const side of ["x", "y", "width", "height"] as const) {
        expect(Math.abs(inputBox![side] - labelBox![side]), `${choice} ${side}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

test.describe("without JavaScript", () => {
  for (const scheme of ["dark", "light"] as const) {
    test(`the control is absent and the page follows the ${scheme} system scheme`, async ({ browser, page }) => {
      // The reference surface, from a page with JavaScript.
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      const reference = await surface(page);

      const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: scheme, baseURL: appSiteOrigin() });
      const plain = await context.newPage();
      await plain.goto("/");
      await expect(plain.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(plain.getByRole("radio")).toHaveCount(0);
      await expect(group(plain)).toHaveCount(0);
      await expect(plain.locator("fieldset.rh-theme")).toBeHidden();
      await expect(html(plain)).not.toHaveAttribute("data-theme");
      expect(await surface(plain)).toBe(reference);
      await context.close();
    });
  }

  for (const width of [320, 1280]) {
    test(`the footer keeps no space for the control at ${width}px`, async ({ browser, page }) => {
      // The reference: a page with JavaScript, with the control's slot taken out.
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      await expect(group(page)).toBeVisible();
      const withControl = await page.locator(".rh-footer").evaluate((node) => node.getBoundingClientRect().height);
      const withoutControl = await page.evaluate(() => {
        document.querySelector(".rh-footer__theme")?.remove();
        return document.querySelector(".rh-footer")!.getBoundingClientRect().height;
      });
      // Otherwise the comparison below proves nothing.
      expect(withControl).toBeGreaterThan(withoutControl);

      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 800 }, baseURL: appSiteOrigin() });
      const plain = await context.newPage();
      await plain.goto("/");
      expect(await plain.locator(".rh-footer__theme").boundingBox()).toBeNull();
      expect(await plain.locator(".rh-footer").evaluate((node) => node.getBoundingClientRect().height)).toBe(withoutControl);
      await context.close();
    });
  }
});

test.describe("forced colours", () => {
  // What a forced palette resolves to differs by platform: Chromium on Linux
  // draws SelectedItemText in white, the same as Canvas, and on macOS in
  // black. So no assertion here compares two segments' colours with each
  // other. The selection must be a shape that only the checked segment has,
  // a bar with real width, and every colour is checked against the system
  // colour it should resolve to on whatever platform runs the test. The one
  // inequality, CanvasText against Canvas, is the pair every forced palette
  // keeps apart.
  test("the checked segment and the focus ring are still shown", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/");
    await expect(group(page)).toBeVisible();
    await expect(radio(page, "system")).toBeChecked();
    expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);
    const system = await page.evaluate(() => {
      const probe = document.createElement("span");
      document.body.append(probe);
      const resolve = (keyword: string) => {
        probe.style.color = keyword;
        return getComputedStyle(probe).color;
      };
      const colours = {
        canvas: resolve("Canvas"),
        canvasText: resolve("CanvasText"),
        selectedItem: resolve("SelectedItem"),
        selectedItemText: resolve("SelectedItemText"),
        highlight: resolve("Highlight"),
      };
      probe.remove();
      return colours;
    });
    expect(system.canvasText).not.toBe(system.canvas);

    const read = (choice: Choice) =>
      page.locator("label", { hasText: NAMES[choice].split(" ")[0] }).evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          fill: style.backgroundColor,
          ink: style.color,
          bar: style.borderBottomColor,
          barStyle: style.borderBottomStyle,
          barWidth: Number.parseFloat(style.borderBottomWidth),
          height: node.getBoundingClientRect().height,
          outline: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth),
          outlineColour: style.outlineColor,
        };
      });
    const checked = await read("system");
    // The cue that is not a colour: a solid bar of real width under the
    // checked segment, in the page's text colour on the page.
    expect(checked.barStyle).toBe("solid");
    expect(checked.barWidth).toBeGreaterThanOrEqual(2);
    expect(checked.bar).toBe(system.canvasText);
    // And the system's selection colours.
    expect(checked.fill).toBe(system.selectedItem);
    expect(checked.ink).toBe(system.selectedItemText);
    for (const choice of ["light", "dark"] as const) {
      const unchecked = await read(choice);
      // No bar at all, and no selection fill, on an unchecked segment.
      expect(unchecked.barWidth, choice).toBe(0);
      expect(unchecked.fill, choice).not.toBe(system.selectedItem);
      // The bar's width moves to the padding: no segment changes height.
      expect(unchecked.height, choice).toBe(checked.height);
    }

    await tabToTheme(page);
    await expect(radio(page, "system")).toBeFocused();
    const focused = await read("system");
    expect(focused.outline).toBe("solid");
    expect(focused.outlineWidth).toBeGreaterThan(0);
    expect(focused.outlineColour).toBe(system.highlight);
  });
});

test.describe("motion", () => {
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    test(`nothing transitions on a theme change (reduced motion: ${reducedMotion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await page.goto("/");
      await expect(group(page)).toBeVisible();
      // Every element of the shell a theme switch repaints: <html>, <body>,
      // the header and the footer and everything in them, the control's
      // parts among them, and `main`. A list of selectors would miss an
      // element added later; this walks the tree. `transitionDuration` is a
      // list, one entry per transitioned property.
      const durations = await page.evaluate(() => {
        const elements = [
          document.documentElement,
          document.body,
          ...document.querySelectorAll("header, header *, main, footer, footer *"),
        ];
        return elements.map((element) => {
          // getAttribute, not className, which is an object on SVG elements.
          const names = (element.getAttribute("class") ?? "").trim();
          const classes = names === "" ? "" : `.${names.split(/\s+/).join(".")}`;
          return { element: `${element.tagName.toLowerCase()}${classes}`, duration: getComputedStyle(element).transitionDuration };
        });
      });
      // The control's inputs, labels and icons are among them.
      expect(durations.filter(({ element }) => element.startsWith("input.rh-theme__input"))).toHaveLength(3);
      expect(durations.filter(({ element }) => element.startsWith("label.rh-theme__label"))).toHaveLength(3);
      expect(durations.filter(({ element }) => element.startsWith("svg.rh-theme__icon"))).toHaveLength(3);
      for (const { element, duration } of durations) {
        expect(duration.split(", ").every((part) => part === "0s"), `${element}: ${duration}`).toBe(true);
      }
    });
  }
});

test.describe("other tabs", () => {
  test("follow a choice made in one tab", async ({ context }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto("/");
    await second.goto("/");
    await expect(group(first)).toBeVisible();
    await expect(group(second)).toBeVisible();

    await radio(first, "dark").check();
    await expect(html(second)).toHaveAttribute("data-theme", "dark");
    await expect(radio(second, "dark")).toBeChecked();

    await radio(second, "system").check();
    await expect(html(first)).not.toHaveAttribute("data-theme");
    await expect(radio(first, "system")).toBeChecked();
  });
});

test.describe("axe", () => {
  for (const choice of ["system", "light", "dark"] as const) {
    test(`finds no WCAG A or AA violation with ${choice} chosen`, async ({ page }) => {
      await store(page, choice === "system" ? null : choice);
      await page.goto("/");
      await expect(group(page)).toBeVisible();
      await expect(radio(page, choice)).toBeChecked();
      expect(await wcagViolations(page)).toEqual([]);
    });
  }
});
