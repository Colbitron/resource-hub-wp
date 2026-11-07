/**
 * THROWAWAY EXPERIMENT: a frozen reference workload for calibrating the CPU
 * slowdown on the work a page load does, rather than on `benchmarkIndex`'s
 * microbenchmark. A static page that loads React 19's production build (the
 * installed copy, standing in for a vendored, frozen one) through a tiny
 * CommonJS shim and renders a fixed listing of cards twice, reading layout
 * between, so its main-thread time is parse/compile, script evaluation, style
 * and layout, the same mix the sampled pages have. Nothing in it depends on
 * the app under test.
 */

import { createServer, type Server } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function cjs(pkg: string, file: string): string {
  const dir = dirname(require.resolve(`${pkg}/package.json`, { paths: [dirname(require.resolve("next/package.json"))] }));
  return readFileSync(join(dir, file), "utf8");
}

function bundle(): string {
  const mods: Record<string, string> = {
    scheduler: cjs("scheduler", "cjs/scheduler.production.js"),
    react: cjs("react", "cjs/react.production.js"),
    "react-dom": cjs("react-dom", "cjs/react-dom.production.js"),
    "react-dom/client": cjs("react-dom", "cjs/react-dom-client.production.js"),
  };
  const defs = Object.entries(mods)
    .map(([name, src]) => `__defs[${JSON.stringify(name)}] = function (module, exports, require) {\n${src}\n};`)
    .join("\n");
  const app = `
(function () {
  var React = require("react");
  var ReactDOM = require("react-dom");
  var client = require("react-dom/client");
  var h = React.createElement;
  var topics = ["Performance", "Accessibility", "Caching", "Editorial", "Security", "Design"];
  function Tag(props) { return h("li", null, props.t); }
  function Tags(props) {
    var list = React.useMemo(function () { return topics.slice(0, 1 + (props.i % 4)); }, [props.i]);
    return h("ul", { className: "card__tags" }, list.map(function (t) { return h(Tag, { key: t, t: t }); }));
  }
  function Title(props) {
    var s = React.useState(props.i)[0];
    return h("h3", { className: "card__title" }, h("a", { href: "#r" + s }, props.text));
  }
  function Card(props) {
    var i = props.i, d = props.d;
    return h("article", { className: "card" },
      h("p", { className: "card__type" }, d.type),
      h(Title, { i: i, text: d.title + " " + props.v }),
      h("p", { className: "card__summary" }, d.summary),
      h(Tags, { i: i }));
  }
  function List(props) {
    var items = [];
    for (var i = 0; i < props.data.length; i++) items.push(h(Card, { key: i, i: i, v: props.v, d: props.data[i] }));
    return h("main", null, h("h1", null, "Reference listing " + props.v), h("div", { className: "grid" }, items));
  }
  // A payload to parse, as a page's serialised server data is.
  var rows = [];
  for (var i = 0; i < 600; i++) rows.push({ id: i, type: ["Article", "Webinar", "Podcast", "Guide"][i % 4], title: "Resource number " + i + " on " + topics[i % 6], summary: "A summary of resource " + i + ", long enough to wrap onto a second line at a phone's width.", meta: { topics: topics.slice(0, 1 + (i % 4)), date: "2026-11-0" + (1 + (i % 9)), weight: i * 7 % 13 } });
  var payload = JSON.stringify(rows);
  var data = JSON.parse(payload);
  var root = client.createRoot(document.getElementById("root"));
  for (var v = 1; v <= 3; v++) {
    ReactDOM.flushSync(function () { root.render(h(List, { v: v, data: JSON.parse(payload) })); });
  }
  window.__h = document.body.offsetHeight + data.length;
})();`;
  return `var __defs = {}, __cache = {};
function require(name) {
  if (__cache[name]) return __cache[name].exports;
  var module = { exports: {} };
  __cache[name] = module;
  __defs[name](module, module.exports, require);
  return module.exports;
}
var process = { env: { NODE_ENV: "production" } };
${defs}
${app}`;
}

const SNAPSHOT = new URL("../calibration-page", import.meta.url).pathname;

const CSS = `
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#222;background:#fff}
main{max-width:72rem;margin:0 auto;padding:1rem}.grid{display:flex;flex-direction:column;gap:1rem}
.card{border:1px solid #ddd;border-radius:.5rem;padding:1rem;display:flex;flex-direction:column;gap:.5rem}
.card__type{text-transform:uppercase;font-size:.75rem;letter-spacing:.05em;margin:0}
.card__title{font-size:1.125rem;margin:0}.card__title a{color:inherit}.card__summary{margin:0;color:#555}
.card__tags{display:flex;flex-wrap:wrap;gap:.25rem;list-style:none;margin:0;padding:0}.card__tags li{border:1px solid #ccc;border-radius:1rem;padding:0 .5rem;font-size:.75rem}
`;

const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reference workload</title><style>${CSS}</style></head><body><div id="root"></div><script src="/reference/bundle.js"></script></body></html>`;

export function startReferenceServer(port: number): Promise<Server> {
  const js = bundle();
  const server = createServer((req, res) => {
    if (req.url === "/reference/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(HTML);
    } else if (req.url === "/reference/bundle.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      res.end(js);
    } else if (req.url === "/snapshot/" || req.url?.startsWith("/_next/static/")) {
      // A frozen copy of the app's built "/" (HTML and the static files it names), see ../calibration-page/.
      const file = req.url === "/snapshot/" ? join(SNAPSHOT, "index.html") : join(SNAPSHOT, req.url.split("?")[0]);
      if (!file.startsWith(SNAPSHOT) || !existsSync(file)) {
        res.writeHead(404);
        res.end();
        return;
      }
      const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".woff2") ? "font/woff2" : file.endsWith(".png") ? "image/png" : "application/octet-stream";
      res.writeHead(200, { "content-type": type, "cache-control": file.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable" });
      res.end(readFileSync(file));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(port, process.env.RH_LHX_REF_HOST ?? "127.0.0.1", () => resolve(server)));
}
