import { mockCmsOrigin } from "./config.mts";
import type {
  ControlError,
  CreatePageInput,
  CreateResourceInput,
  FaultInput,
  FaultSummary,
  FrontPageSetting,
  HealthResponse,
  PageStatus,
  PageSummary,
  RenameTermInput,
  RequestCounts,
  ResourceStatus,
  ResourceSummary,
  StateSummary,
  Taxonomy,
  TermSummary,
} from "./types.mts";

/**
 * A typed client for the mock's control endpoints and for reading its public
 * routes, for specs and the unit test. Every method is one HTTP call; a
 * control error (a 4xx `{ "error" }`) throws, so a spec that misuses the mock
 * fails where it does so.
 *
 * ```ts
 * const cms = mockCms();
 * await cms.reset();
 * const { resources } = await cms.state();
 * await cms.renameSlug(resources[0].id, "new-slug");
 * ```
 */

/** A public route's answer: the status, the headers and the parsed JSON body. */
export interface PublicResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

export class MockCmsClientError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "MockCmsClientError";
    this.status = status;
  }
}

export class MockCmsClient {
  readonly origin: string;

  constructor(origin: string = mockCmsOrigin()) {
    this.origin = origin;
  }

  // --- Control ------------------------------------------------------------------

  /** Which mock answered: its directory, process ID and origin. */
  health(): Promise<HealthResponse> {
    return this.control<HealthResponse>("GET", "/__mock/health");
  }

  /** Back to the seed dataset, with the request counters cleared. */
  reset(): Promise<StateSummary> {
    return this.control<StateSummary>("POST", "/__mock/reset");
  }

  state(): Promise<StateSummary> {
    return this.control<StateSummary>("GET", "/__mock/state");
  }

  requests(): Promise<RequestCounts> {
    return this.control<RequestCounts>("GET", "/__mock/requests");
  }

  resetRequests(): Promise<RequestCounts> {
    return this.control<RequestCounts>("POST", "/__mock/requests/reset");
  }

  /** Makes the public routes under `fault.path` fail or slow down (`faults.mts`); returns every fault in force. */
  addFault(fault: FaultInput): Promise<FaultSummary[]> {
    return this.control<FaultSummary[]>("POST", "/__mock/faults", fault);
  }

  faults(): Promise<FaultSummary[]> {
    return this.control<FaultSummary[]>("GET", "/__mock/faults");
  }

  /** Clears every fault; `reset()` does too. */
  clearFaults(): Promise<FaultSummary[]> {
    return this.control<FaultSummary[]>("DELETE", "/__mock/faults");
  }

  /** Publishes a new resource and returns it. */
  createResource(input: CreateResourceInput): Promise<ResourceSummary> {
    return this.control<ResourceSummary>("POST", "/__mock/resources", input);
  }

  /** Changes a resource's title and nothing else, as an editor's save does. */
  setTitle(id: number, title: string): Promise<ResourceSummary> {
    return this.control<ResourceSummary>("POST", `/__mock/resources/${id}/title`, { title });
  }

  /** Changes a resource's slug; the old one is kept for the resolve route. */
  renameSlug(id: number, slug: string): Promise<ResourceSummary> {
    return this.control<ResourceSummary>("POST", `/__mock/resources/${id}/slug`, { slug });
  }

  setType(id: number, type: string): Promise<ResourceSummary> {
    return this.control<ResourceSummary>("POST", `/__mock/resources/${id}/type`, { type });
  }

  setTopics(id: number, topics: string[]): Promise<ResourceSummary> {
    return this.control<ResourceSummary>("POST", `/__mock/resources/${id}/topics`, { topics });
  }

  /** `draft` unpublishes, `trash` trashes, `publish` restores. */
  setStatus(id: number, status: ResourceStatus): Promise<ResourceSummary> {
    return this.control<ResourceSummary>("POST", `/__mock/resources/${id}/status`, { status });
  }

  /** Replaces the editor's picks (`related_picks`) with these IDs, in order. */
  setPicks(id: number, picks: number[]): Promise<ResourceSummary> {
    return this.control<ResourceSummary>("POST", `/__mock/resources/${id}/picks`, { picks });
  }

  renameTerm(taxonomy: Taxonomy, id: number, patch: RenameTermInput): Promise<TermSummary> {
    return this.control<TermSummary>("POST", `/__mock/terms/${taxonomy}/${id}`, patch);
  }

  /** Deletes the term and removes it from every resource. */
  async deleteTerm(taxonomy: Taxonomy, id: number): Promise<void> {
    await this.control<{ deleted: true }>("DELETE", `/__mock/terms/${taxonomy}/${id}`);
  }

  // --- Pages (ADR 0052) --------------------------------------------------------------

  /** Settings > Reading: a page ID makes it the static front page; `null` sets the site to show posts. */
  setFrontPage(pageId: number | null): Promise<FrontPageSetting> {
    return this.control<FrontPageSetting>("POST", "/__mock/front-page", { pageId });
  }

  createPage(input: CreatePageInput): Promise<PageSummary> {
    return this.control<PageSummary>("POST", "/__mock/pages", input);
  }

  setPageTitle(id: number, title: string): Promise<PageSummary> {
    return this.control<PageSummary>("POST", `/__mock/pages/${id}/title`, { title });
  }

  /** Changes the slug; unlike a resource's, no old slug is kept, as core keeps none for pages. */
  setPageSlug(id: number, slug: string): Promise<PageSummary> {
    return this.control<PageSummary>("POST", `/__mock/pages/${id}/slug`, { slug });
  }

  /** Moves the page under another parent (0 for the top level), which changes its path and its children's. */
  setPageParent(id: number, parent: number): Promise<PageSummary> {
    return this.control<PageSummary>("POST", `/__mock/pages/${id}/parent`, { parent });
  }

  setPageContent(id: number, content: string): Promise<PageSummary> {
    return this.control<PageSummary>("POST", `/__mock/pages/${id}/content`, { content });
  }

  setPageStatus(id: number, status: PageStatus): Promise<PageSummary> {
    return this.control<PageSummary>("POST", `/__mock/pages/${id}/status`, { status });
  }

  async deletePage(id: number): Promise<void> {
    await this.control<{ deleted: true }>("DELETE", `/__mock/pages/${id}`);
  }

  /** `GET /wp-json/resource-hub/v1/page?path=…`. */
  lookupPage(path: string): Promise<PublicResponse> {
    return this.get(`/wp-json/resource-hub/v1/page?path=${encodeURIComponent(path)}`);
  }

  // --- Public routes, as the front end would call them ---------------------------------

  /** `GET {origin}{path}` for any public path (`/wp-json/…`, `/wp-content/uploads/…`); the body is parsed as JSON when it is JSON. */
  async get<T = unknown>(path: string): Promise<PublicResponse<T>> {
    const response = await fetch(`${this.origin}${path}`);
    const isJson = (response.headers.get("content-type") ?? "").startsWith("application/json");
    const body = (isJson ? await response.json() : await response.text()) as T;
    return { status: response.status, headers: response.headers, body };
  }

  /** `GET /wp-json/resource-hub/v1/resolve?slug=…`. */
  resolve(slug: string): Promise<PublicResponse> {
    return this.get(`/wp-json/resource-hub/v1/resolve?slug=${encodeURIComponent(slug)}`);
  }

  /** `GET /wp-json/resource-hub/v1/related/{id}`, with `?count=` when given. */
  related(id: number, count?: number | string): Promise<PublicResponse> {
    return this.get(`/wp-json/resource-hub/v1/related/${id}${count === undefined ? "" : `?count=${encodeURIComponent(count)}`}`);
  }

  /** `GET /wp-json/resource-hub/v1/search?q=…`, with `&page=` when given. */
  search(q: string, page?: number | string): Promise<PublicResponse> {
    return this.get(`/wp-json/resource-hub/v1/search?q=${encodeURIComponent(q)}${page === undefined ? "" : `&page=${encodeURIComponent(page)}`}`);
  }

  private async control<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.origin}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = (await response.json()) as T | ControlError;
    if (!response.ok) {
      const message = typeof parsed === "object" && parsed !== null && "error" in parsed ? parsed.error : response.statusText;
      throw new MockCmsClientError(response.status, `${method} ${path}: ${message}`);
    }
    return parsed as T;
  }
}

/** The client for the mock at `mockCmsOrigin()`, or at the origin given. */
export function mockCms(origin?: string): MockCmsClient {
  return new MockCmsClient(origin);
}
