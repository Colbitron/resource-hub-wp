import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { renderContent } from "../lib/content/render";

// The parse itself fails here, which no body can make it do any more; this
// pins what `renderContent` does if one ever does: plain text, logged.
vi.mock("html-react-parser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("html-react-parser")>()),
  default: () => {
    throw new Error("boom");
  },
}));

it("renders the body as plain text, logged, when the parse or the pass throws", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const cms = { cmsOrigins: ["https://cms.example"], uploadsBase: "https://cms.example/wp-content/uploads" };
    const output = renderToStaticMarkup(<>{renderContent("<p>Before <a href=\"https://cms.example/resources/\">https://cms.example/resources/</a></p>", cms)}</>);
    expect(output).toBe("Before /resources/");
    expect(error).toHaveBeenCalledTimes(1);
  } finally {
    error.mockRestore();
  }
});
