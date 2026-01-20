import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAllApps, mockExportDsl } = vi.hoisted(() => ({
  mockGetAllApps: vi.fn(),
  mockExportDsl: vi.fn(),
}));

vi.mock("../../../src/auth/playwright-auth.js", () => ({
  getAuthWithPlaywright: vi.fn().mockResolvedValue({
    cookies: "test-cookie",
    csrfToken: "test-csrf",
  }),
}));

vi.mock("../../../src/infra/difyConsoleClient.js", () => {
  return {
    DifyConsoleClient: class {
      getAllApps = mockGetAllApps;
      exportDsl = mockExportDsl;
    },
  };
});

import { exportAllDsl } from "../../../src/application/exportDslUsecase.js";

const TEST_DIR = "/tmp/test-export-dsl";

describe("exportAllDsl", () => {
  beforeEach(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
    vi.clearAllMocks();
    mockGetAllApps.mockResolvedValue([]);
    mockExportDsl.mockResolvedValue("app:\n  name: test\n");
  });

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it("アプリがない場合は空の結果を返す", async () => {
    const results = await exportAllDsl({
      baseUrl: "http://localhost",
      outputDir: TEST_DIR,
    });

    expect(results).toHaveLength(0);
  });

  it("1つのアプリをエクスポートできる", async () => {
    mockGetAllApps.mockResolvedValue([
      { id: "app-1", name: "My App", mode: "workflow", icon: "", icon_background: "" },
    ]);
    mockExportDsl.mockResolvedValue("app:\n  name: My App\n");

    const results = await exportAllDsl({
      baseUrl: "http://localhost",
      outputDir: TEST_DIR,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      appId: "app-1",
      appName: "My App",
      filename: "my-app.yml",
      success: true,
    });

    // ファイルが作成されたか確認
    const content = await fs.readFile(path.join(TEST_DIR, "my-app.yml"), "utf-8");
    expect(content).toBe("app:\n  name: My App\n");
  });

  it("複数のアプリをエクスポートできる", async () => {
    mockGetAllApps.mockResolvedValue([
      { id: "app-1", name: "App One", mode: "workflow", icon: "", icon_background: "" },
      { id: "app-2", name: "App Two", mode: "chat", icon: "", icon_background: "" },
    ]);
    mockExportDsl
      .mockResolvedValueOnce("app:\n  name: App One\n")
      .mockResolvedValueOnce("app:\n  name: App Two\n");

    const results = await exportAllDsl({
      baseUrl: "http://localhost",
      outputDir: TEST_DIR,
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ appName: "App One", success: true });
    expect(results[1]).toMatchObject({ appName: "App Two", success: true });
  });

  it("エクスポートエラー時はsuccess: falseとerrorを返す", async () => {
    mockGetAllApps.mockResolvedValue([
      { id: "app-1", name: "My App", mode: "workflow", icon: "", icon_background: "" },
    ]);
    mockExportDsl.mockRejectedValue(new Error("API error"));

    const results = await exportAllDsl({
      baseUrl: "http://localhost",
      outputDir: TEST_DIR,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      appId: "app-1",
      appName: "My App",
      success: false,
      error: "API error",
    });
  });

  it("appFilterでアプリをフィルタできる", async () => {
    mockGetAllApps.mockResolvedValue([
      { id: "app-1", name: "Workflow App", mode: "workflow", icon: "", icon_background: "" },
      { id: "app-2", name: "Chat App", mode: "chat", icon: "", icon_background: "" },
    ]);
    mockExportDsl.mockResolvedValue("app:\n  name: Workflow App\n");

    const results = await exportAllDsl({
      baseUrl: "http://localhost",
      outputDir: TEST_DIR,
      appFilter: (app) => app.mode === "workflow",
    });

    expect(results).toHaveLength(1);
    expect(results[0].appName).toBe("Workflow App");
    expect(mockExportDsl).toHaveBeenCalledTimes(1);
  });

  it("includeSecret: trueを渡せる", async () => {
    mockGetAllApps.mockResolvedValue([
      { id: "app-1", name: "My App", mode: "workflow", icon: "", icon_background: "" },
    ]);
    mockExportDsl.mockResolvedValue("app:\n  name: My App\n");

    await exportAllDsl({
      baseUrl: "http://localhost",
      outputDir: TEST_DIR,
      includeSecret: true,
    });

    expect(mockExportDsl).toHaveBeenCalledWith("app-1", true);
  });

  it("ファイル名に使えない文字は変換される", async () => {
    mockGetAllApps.mockResolvedValue([
      {
        id: "app-1",
        name: 'App: "Test" <Version>',
        mode: "workflow",
        icon: "",
        icon_background: "",
      },
    ]);
    mockExportDsl.mockResolvedValue("app:\n  name: test\n");

    const results = await exportAllDsl({
      baseUrl: "http://localhost",
      outputDir: TEST_DIR,
    });

    expect(results[0].filename).toBe("app_-_test_-_version_.yml");
  });

  it("スペースはハイフンに変換される", async () => {
    mockGetAllApps.mockResolvedValue([
      { id: "app-1", name: "My Test App", mode: "workflow", icon: "", icon_background: "" },
    ]);
    mockExportDsl.mockResolvedValue("app:\n  name: My Test App\n");

    const results = await exportAllDsl({
      baseUrl: "http://localhost",
      outputDir: TEST_DIR,
    });

    expect(results[0].filename).toBe("my-test-app.yml");
  });

  it("出力ディレクトリが存在しない場合は作成される", async () => {
    const newDir = path.join(TEST_DIR, "new", "nested", "dir");
    mockGetAllApps.mockResolvedValue([
      { id: "app-1", name: "My App", mode: "workflow", icon: "", icon_background: "" },
    ]);
    mockExportDsl.mockResolvedValue("app:\n  name: My App\n");

    const results = await exportAllDsl({
      baseUrl: "http://localhost",
      outputDir: newDir,
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);

    // ディレクトリとファイルが作成されたか確認
    const stat = await fs.stat(newDir);
    expect(stat.isDirectory()).toBe(true);
  });
});
