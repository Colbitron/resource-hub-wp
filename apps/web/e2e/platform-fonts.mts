import type { Page } from "@playwright/test";

/**
 * The font files Chromium actually drew an element's text with, by family
 * name (CDP's `CSS.getPlatformFontsForNode`, glyph-bearing fonts only): the
 * truth about which face a page shows, where `document.fonts` only says
 * which files have loaded. Figtree's variable file names itself by its
 * default instance, "Figtree Light".
 */
export async function platformFonts(page: Page, selector: string): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`platformFonts: nothing matches ${selector}`);
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    return fonts.filter((font) => font.glyphCount > 0).map((font) => font.familyName);
  } finally {
    await cdp.detach();
  }
}
