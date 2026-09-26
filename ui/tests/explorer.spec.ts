import { test, expect, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import axe from "axe-core";

const root = resolve("..");
let process: ChildProcess | null = null;

async function open(page: Page, fixture: string) {
  const target =
    fixture.startsWith("synthetic:") || fixture.startsWith("benchmark:")
      ? fixture
      : resolve(root, "tests/fixtures", fixture);
  const installedCLI = globalThis.process.env.ARCHI_TEST_CLI;
  const useInstalled = installedCLI && !fixture.includes(":");
  process = spawn(
    useInstalled ? installedCLI : "python3",
    useInstalled
      ? [target, "--no-browser", "--port", "0"]
      : ["tests/browser_host.py", target],
    {
      cwd: root,
      env: {
        ...globalThis.process.env,
        PYTHONPATH: useInstalled ? "" : resolve(root, "src"),
        PATH: useInstalled
          ? dirname(installedCLI)
          : globalThis.process.env.PATH,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const url = await new Promise<string>((resolveURL, reject) => {
    let output = "",
      errors = "";
    const timeout = setTimeout(
      () => reject(new Error(`Server timed out: ${errors}`)),
      10000,
    );
    process!.stderr!.on("data", (data) => (errors += data.toString()));
    process!.stdout!.on("data", (data) => {
      output += data.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) {
        clearTimeout(timeout);
        resolveURL(match[0]);
      }
    });
    process!.on("exit", (code) => {
      clearTimeout(timeout);
      if (!output.includes("http://"))
        reject(new Error(`Server exited ${code}: ${errors}`));
    });
  });
  await page.goto(url);
  await page.waitForFunction(
    () => performance.getEntriesByName("archi-interactive").length > 0,
  );
  await expect(
    page.getByRole("heading", { name: "Architecture map", exact: true }),
  ).toBeVisible();
  return url;
}

test.afterEach(async () => {
  if (process && process.exitCode === null) {
    const stopped = new Promise<void>((resolveExit) =>
      process!.once("exit", () => resolveExit()),
    );
    process.kill("SIGTERM");
    await stopped;
  }
  process = null;
});

test("AN-04 / IR-02 / UI-04: aggregate arrow opens every exact source site and underlying modules", async ({
  page,
}) => {
  await open(page, "aggregation");
  await page
    .getByRole("button", {
      name: "Dependency a to b, 3 import sites",
      exact: true,
    })
    .click();
  const inspector = page.locator(".inspector-content");
  await expect(inspector.locator(".evidence-location")).toHaveText([
    "a/one.py:1",
    "a/one.py:2",
    "a/two.py:1",
  ]);
  await expect(inspector.locator(".evidence pre")).toHaveText([
    "import b.one, b.two",
    "import b.one",
    "import b.two",
  ]);
  await expect(
    inspector.getByRole("button", { name: /Inspect module dependency/ }),
  ).toHaveCount(3);
  await page
    .getByRole("button", {
      name: "Inspect module dependency a.one to b.one",
      exact: true,
    })
    .click();
  await expect(inspector.locator(".evidence-location")).toHaveText([
    "a/one.py:1",
    "a/one.py:2",
  ]);
});

test("UI-02 / UI-05: two nested levels, back restores selection/camera, search reveals a hidden module", async ({
  page,
}) => {
  await open(page, "src_layout");
  await page
    .getByRole("button", { name: "Select package acme", exact: true })
    .click();
  const camera = await page.getByTestId("graph-world").getAttribute("style");
  await page
    .getByRole("button", { name: "Expand package acme", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Expand package acme.nested", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Select module acme.nested.worker",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to previous view", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Expand package acme.nested",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Back to previous view", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select package acme", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("graph-world")).toHaveAttribute(
    "style",
    camera!,
  );
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search packages and modules" })
    .fill("acme.nested.worker");
  await page
    .getByRole("button", {
      name: /acme.nested.worker.*src\/acme\/nested\/worker.py/,
    })
    .click();
  const module = page.getByRole("button", {
    name: "Select module acme.nested.worker",
    exact: true,
  });
  await expect(module).toHaveAttribute("aria-pressed", "true");
  await expect(module).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(module).toBeInViewport();
});

test("RL-02 / UI-06: browser diagnostics preserve IDs, members, cycle route and all evidence", async ({
  page,
}) => {
  const url = await open(page, "cycles");
  const graph = await (await page.request.get(`${url}api/graph`)).json();
  const installedCLI = globalThis.process.env.ARCHI_TEST_CLI;
  const command = installedCLI
    ? [installedCLI, "check", resolve(root, "tests/fixtures/cycles")]
    : [
        "python3",
        "-m",
        "archi",
        "check",
        resolve(root, "tests/fixtures/cycles"),
      ];
  const checked = spawnSync(command[0], command.slice(1), {
    cwd: root,
    env: {
      ...globalThis.process.env,
      PYTHONPATH: installedCLI ? "" : resolve(root, "src"),
    },
    encoding: "utf8",
  });
  expect(checked.status).toBe(1);

  await expect(page.locator(".graph-edge.cyclic")).toHaveCount(5);
  for (let i = 0; i < graph.diagnostics.length; i++) {
    const d = graph.diagnostics[i];
    expect(checked.stdout).toContain(d.id);
    for (const site of d.evidence)
      expect(checked.stdout).toContain(`${site.path}:${site.line}`);
    await page
      .getByRole("button", { name: new RegExp(`^Cycle ${i + 1} `) })
      .click();
    const inspector = page.locator(".inspector-content");
    await expect(inspector.locator(".rule-code")).toHaveText(d.rule_code);
    await expect(inspector.locator(".cycle-route li")).toHaveCount(
      d.cycle.length,
    );
    await expect(inspector.locator(".evidence-location")).toHaveText(
      d.evidence.map((s: any) => `${s.path}:${s.line}`),
    );
    await inspector.getByText("Diagnostic ID", { exact: true }).click();
    await expect(inspector.locator(".diagnostic-id code")).toHaveText(d.id);
    const names = new Map(graph.nodes.map((n: any) => [n.id, n.name]));
    expect(checked.stdout).toContain(
      `Affected nodes: ${d.nodes.map((id: string) => names.get(id)).join(", ")}`,
    );
    await expect(inspector.locator(".member-list button")).toHaveText(
      d.nodes.map((id: string) => `${names.get(id)} `),
    );
  }
});

test("AN-05: malformed file leaves useful nodes and a visible incomplete-analysis explanation", async ({
  page,
}) => {
  await open(page, "malformed");
  await expect(page.getByRole("alert")).toContainText("Analysis incomplete");
  await page.getByRole("button", { name: "View issues", exact: true }).click();
  await expect(page.locator(".inspector-content")).toContainText(
    "pkg/broken.py:1",
  );
  await page
    .getByRole("button", { name: "Expand package pkg", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select module pkg.good", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Dependency pkg.good to pkg.other, 1 import sites",
      exact: true,
    })
    .click();
  await expect(page.locator(".evidence-location")).toHaveText([
    "pkg/good.py:1",
  ]);
});

test("UI-03 / UI-08: keyboard and pointer pan, zoom, fit, focus and modal focus restoration", async ({
  page,
}) => {
  await open(page, "cycles");
  const world = page.getByTestId("graph-world"),
    map = page.locator("#graph-surface");
  const original = await world.getAttribute("style");
  await map.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(world).not.toHaveAttribute("style", original!);
  await page.getByRole("button", { name: "Fit map to view" }).click();
  await expect(world).toHaveAttribute("style", original!);
  const bounds = await map.boundingBox();
  await page.mouse.move(bounds!.x + 20, bounds!.y + 50);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 75, bounds!.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect(world).not.toHaveAttribute("style", original!);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, -150);
  await expect(page.getByLabel("Zoom level")).not.toHaveText("100%");
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await page.getByRole("button", { name: "Fit map to view" }).click();
  const node = page.getByRole("button", {
    name: "Select package a",
    exact: true,
  });
  await node.focus();
  await page.keyboard.press("Enter");
  await expect(node).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Focus selected node", exact: true })
    .click();
  await expect(world).not.toHaveAttribute("style", original!);
  await expect(node).toBeInViewport();
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("textbox", { name: "Search packages and modules" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: /Find a module/ }),
  ).toBeFocused();
});

test("UI-01 / UI-07 / UI-08: desktop and narrow layouts, accessible controls, reduced motion", async ({
  page,
}) => {
  await open(page, "cycles");
  await mkdir(resolve(root, ".artifacts"), { recursive: true });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("button", { name: "Fit map to view" }),
    ).toBeInViewport();
    await page
      .getByRole("button", {
        name: "Dependency a to b, 1 import sites",
        exact: true,
      })
      .click();
    await expect(page.locator(".evidence-location")).toHaveText(["a/one.py:1"]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: resolve(root, `.artifacts/explorer-${viewport.width}.png`),
      fullPage: true,
    });
    await page.evaluate(axe.source);
    const violations = await page.evaluate(async () =>
      (window as any).axe
        .run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
        })
        .then((r: any) =>
          r.violations.map((v: any) => ({
            id: v.id,
            nodes: v.nodes.map((n: any) => ({
              target: n.target,
              summary: n.failureSummary,
            })),
          })),
        ),
    );
    expect(violations).toEqual([]);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".graph-node")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  await page.keyboard.press("Control+k");
  await page.evaluate(axe.source);
  const modalViolations = await page.evaluate(async () =>
    (window as any).axe.run(document).then((r: any) =>
      r.violations.map((v: any) => ({
        id: v.id,
        nodes: v.nodes.map((n: any) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ),
  );
  expect(modalViolations).toEqual([]);
});

test("OP-02 / UI-05: 5,000 modules stay bounded, page and search reveal any module", async ({
  page,
}) => {
  await open(page, "synthetic:5000");
  await expect(page.locator(".graph-node")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Expand package bulk", exact: true })
    .click();
  await expect(page.locator(".graph-node")).toHaveCount(9);
  await expect(page.locator(".bounded-notice")).toContainText("of 5000");
  await page.screenshot({
    path: resolve(root, ".artifacts/explorer-dense.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Next map page" }).click();
  await expect(page.locator(".bounded-notice")).toContainText("10–18");
  await page
    .getByRole("button", { name: "Back to previous view", exact: true })
    .click();
  await expect(page.locator(".graph-node")).toHaveCount(1);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search packages and modules" })
    .fill("bulk.mod4999");
  await page
    .getByRole("button", { name: /bulk.mod4999.*bulk\/mod4999.py/ })
    .click();
  const node = page.getByRole("button", {
    name: "Select module bulk.mod4999",
    exact: true,
  });
  await expect(node).toBeFocused();
  await expect(node).toBeInViewport();
  expect(await page.locator(".graph-node").count()).toBeLessThanOrEqual(9);
  expect(await page.locator(".graph-edge").count()).toBeLessThanOrEqual(120);
  await expect(page.locator(".inspector-content")).toContainText(
    "bulk/mod4999.py",
  );
});

test("UX-05: explorer works with all external requests blocked", async ({
  page,
}) => {
  const external: string[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") {
      external.push(url.href);
      await route.abort();
    } else await route.continue();
  });
  await open(page, "src_layout");
  await page
    .getByRole("button", { name: "Expand package acme", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select module acme.api", exact: true })
    .click();
  await expect(page.locator(".inspector-content")).toContainText(
    "src/acme/api.py",
  );
  expect(external).toEqual([]);
});

test("OP-01: record three runs of a real 500-module fixture", async ({
  page,
}) => {
  const url = await open(page, "benchmark:500");
  const runs: { loadMs: number; interactionMs: number }[] = [];
  const project = await (await page.request.get(`${url}api/project`)).json();
  for (let i = 0; i < 3; i++) {
    if (i) {
      await page.reload();
      await page.waitForFunction(
        () => performance.getEntriesByName("archi-interactive").length > 0,
      );
      await expect(
        page.getByRole("heading", { name: "Architecture map", exact: true }),
      ).toBeVisible();
    }
    const loadMs = await page.evaluate(
      () =>
        performance.measure(
          "archi-load",
          "archi-data-ready",
          "archi-interactive",
        ).duration,
    );
    const interactionMs = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const start = performance.now();
          (
            document.querySelector(
              '[aria-label="Expand package bulk"]',
            ) as HTMLButtonElement
          ).click();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(performance.now() - start)),
          );
        }),
    );
    await expect(page.locator(".graph-node")).toHaveCount(9);
    runs.push({ loadMs, interactionMs });
    if (i === 0)
      await page.screenshot({
        path: resolve(root, ".artifacts/explorer-medium.png"),
        fullPage: true,
      });
  }
  await mkdir(resolve(root, ".artifacts"), { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    resolve(root, ".artifacts/browser-benchmark.json"),
    JSON.stringify(
      {
        analysisSeconds: project.analysis_seconds,
        runs,
        viewport: { width: 1440, height: 900 },
      },
      null,
      2,
    ),
  );
  console.log("500-module browser benchmark:", JSON.stringify(runs));
});

test("AN-03: unresolved and external records stay inspectable without guessed arrows", async ({
  page,
}) => {
  await open(page, "unresolved");
  await page
    .getByRole("button", { name: "Resolution details", exact: true })
    .click();
  const inspector = page.locator(".inspector-content");
  await expect(inspector).toContainText("definitely_missing_dependency");
  await expect(inspector).toContainText("pkg.missing");
  await expect(inspector).toContainText("pkg.unknown_symbol");
  await expect(inspector.locator(".issue > .badge")).toHaveCount(6);
  await expect(page.locator(".graph-edge")).toHaveCount(0);
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () =>
    (window as any).axe.run(document).then((r: any) =>
      r.violations.map((v: any) => ({
        id: v.id,
        nodes: v.nodes.map((n: any) => n.failureSummary),
      })),
    ),
  );
  expect(violations).toEqual([]);
});

test("UI-04: crossing arrows have separate clickable evidence badges", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await open(page, "crossing");
  const first = page.getByRole("button", {
    name: "Dependency b to c, 1 import sites",
    exact: true,
  });
  const second = page.getByRole("button", {
    name: "Dependency d to a, 1 import sites",
    exact: true,
  });
  const a = await first.locator("rect").boundingBox();
  const b = await second.locator("rect").boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(
    a!.x + a!.width <= b!.x ||
      b!.x + b!.width <= a!.x ||
      a!.y + a!.height <= b!.y ||
      b!.y + b!.height <= a!.y,
  ).toBeTruthy();
  await first.click();
  await expect(
    page.getByRole("heading", { name: "b → c", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".inspector-content .evidence-location"),
  ).toHaveText(["b/main.py:1"]);
  await second.click();
  await expect(
    page.getByRole("heading", { name: "d → a", exact: true }),
  ).toBeVisible();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "b → c", exact: true }),
  ).toBeVisible();
});

test("MET-01/02/03: package metrics stay fixed across navigation and expose every contributing import", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, "metrics");
  await page
    .getByRole("button", { name: "Select package alpha", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Package import metrics" });
  const counts = async () => {
    await expect(panel.getByTestId("metric-incoming")).toHaveText("1");
    await expect(panel.getByTestId("metric-outgoing")).toHaveText("2");
    await expect(panel.getByTestId("metric-instability")).toHaveText("0.67");
  };
  await counts();
  await expect(panel.getByTestId("metric-coverage")).toHaveText(
    "Excluded outgoing references: 1 external · 1 uncertain · 1 unresolved.",
  );
  await expect(
    panel.getByText("2 import sites involving root-level modules excluded"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Next map page", exact: true })
    .click();
  await counts();
  await page
    .getByRole("button", { name: "Previous map page", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Expand package alpha", exact: true })
    .click();
  await counts();
  await page.getByRole("button", { name: "Back to previous view" }).click();
  await counts();
  await panel.getByText("Outgoing packages (2)", { exact: true }).click();
  await panel
    .getByRole("button", { name: "Inspect outgoing imports beta", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "alpha → beta", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".inspector-content .evidence-location"),
  ).toHaveText([
    "alpha/main.py:1",
    "alpha/main.py:2",
    "alpha/main.py:3",
    "alpha/main.py:7",
    "alpha/nested/worker.py:1",
  ]);
  await page
    .getByRole("button", {
      name: "Inspect module dependency alpha.main to beta.one",
      exact: true,
    })
    .click();
  await expect(
    page.locator(".inspector-content .evidence-location"),
  ).toHaveText(["alpha/main.py:1", "alpha/main.py:2"]);
  await page.getByRole("button", { name: "Back to package metrics" }).click();
  await counts();
  await panel.getByText("Incoming packages (1)", { exact: true }).click();
  await panel
    .getByRole("button", {
      name: "Inspect incoming imports delta",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "delta → alpha", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".inspector-content .evidence-location"),
  ).toHaveText(["delta/client.py:1", "delta/client.py:2"]);
  await page.getByRole("button", { name: "Back to package metrics" }).click();
  await panel.getByText("Outgoing packages (2)", { exact: true }).click();
  await panel
    .getByRole("button", { name: "Show package beta", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "beta", exact: true }),
  ).toBeVisible();
  await expect(panel.getByTestId("metric-incoming")).toHaveText("2");
  await expect(panel.getByTestId("metric-instability")).toHaveText("0.00");
});

test("MET-04/05: metrics are informational, accessible, and isolated packages show N/A", async ({
  page,
}) => {
  await open(page, "metrics");
  await page
    .getByRole("button", { name: "Select package alpha", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Package import metrics" });
  await panel.getByText("Counting rules and coverage", { exact: true }).click();
  await expect(panel).toContainText(
    "not Martin’s class-based metric or a lint rule",
  );
  await panel.getByText("Outgoing packages (2)", { exact: true }).click();
  const inspect = panel.getByRole("button", {
    name: "Inspect outgoing imports beta",
    exact: true,
  });
  await inspect.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "alpha → beta", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back to package metrics" }).click();
  await panel.getByText("Incoming packages (1)", { exact: true }).click();
  await panel.getByText("Outgoing packages (2)", { exact: true }).click();
  await panel.getByText("Counting rules and coverage", { exact: true }).click();
  await panel
    .getByText("2 import sites involving root-level modules excluded", {
      exact: true,
    })
    .click();
  await page.evaluate(axe.source);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    const violations = await page.evaluate(async () =>
      (window as any).axe.run(document).then((r: any) =>
        r.violations.map((v: any) => ({
          id: v.id,
          targets: v.nodes.map((n: any) => n.target),
        })),
      ),
    );
    expect(violations).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await mkdir(resolve(root, ".artifacts"), { recursive: true });
  await panel
    .getByRole("heading", { name: "Package-import instability" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(root, ".artifacts/package-metrics.png"),
  });
  const cli = globalThis.process.env.ARCHI_TEST_CLI;
  const result = spawnSync(
    cli || "python3",
    cli
      ? ["check", resolve(root, "tests/fixtures/metrics")]
      : ["-m", "archi", "check", resolve(root, "tests/fixtures/metrics")],
    {
      cwd: root,
      env: {
        ...globalThis.process.env,
        PYTHONPATH: cli ? "" : resolve(root, "src"),
      },
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  await expect(
    page.getByText("No rule violations", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search packages and modules" })
    .fill("isolated");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "isolated isolated Package", exact: true })
    .click();
  await expect(panel.getByTestId("metric-instability")).toHaveText("N/A");
  await expect(panel.getByTestId("metric-incoming")).toHaveText("0");
  await expect(panel.getByTestId("metric-outgoing")).toHaveText("0");
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search packages and modules" })
    .fill("isolated.lone");
  await page
    .getByRole("dialog")
    .getByRole("button", {
      name: "isolated.lone isolated/lone.py Module",
      exact: true,
    })
    .click();
  await expect(panel).toHaveCount(0);
});

test("MET-04: incomplete analysis labels metrics provisional", async ({
  page,
}) => {
  await open(page, "malformed");
  await page
    .getByRole("button", { name: "Select package pkg", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Package import metrics" });
  await expect(panel.getByRole("note")).toContainText("Analysis is incomplete");
  await expect(panel.getByTestId("metric-instability")).toHaveText("N/A");
});
