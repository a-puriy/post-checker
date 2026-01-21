// DSLエクスポート usecase
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAuthWithPlaywright } from "../auth/playwright-auth.js";
import {
  type DatasetMapping,
  replaceDatasetIdsWithPlaceholders,
} from "../domain/dslTransformer.js";
import { type ConsoleApp, DifyConsoleClient } from "../infra/difyConsoleClient.js";
import { DifyKnowledgeClient } from "../infra/difyKnowledgeClient.js";

export interface ExportDslOptions {
  baseUrl: string;
  outputDir: string;
  email?: string;
  password?: string;
  includeSecret?: boolean;
  headless?: boolean;
  appFilter?: (app: ConsoleApp) => boolean;
  /** Knowledge APIのベースURL（プレースホルダー変換用） */
  knowledgeApiUrl?: string;
  /** Knowledge APIのAPIキー（プレースホルダー変換用） */
  knowledgeApiKey?: string;
}

export interface ExportResult {
  appId: string;
  appName: string;
  filename: string;
  success: boolean;
  error?: string;
}

/**
 * 全アプリのDSLをエクスポートする
 */
export async function exportAllDsl(options: ExportDslOptions): Promise<ExportResult[]> {
  const {
    baseUrl,
    outputDir,
    email,
    password,
    includeSecret = false,
    headless = false,
    knowledgeApiUrl,
    knowledgeApiKey,
  } = options;

  // 1. Playwright で認証情報を取得
  const auth = await getAuthWithPlaywright({ baseUrl, email, password, headless });

  // 2. Console API クライアントを作成
  const client = new DifyConsoleClient({ baseUrl, auth });

  // 3. アプリ一覧を取得
  let apps = await client.getAllApps();
  console.log(`Found ${apps.length} app(s).`);

  // フィルタがあれば適用
  if (options.appFilter) {
    apps = apps.filter(options.appFilter);
    console.log(`After filter: ${apps.length} app(s).`);
  }

  // 4. dataset一覧を取得（プレースホルダー変換用）
  let datasets: DatasetMapping[] = [];
  if (knowledgeApiUrl && knowledgeApiKey) {
    const knowledgeClient = new DifyKnowledgeClient({
      baseUrl: knowledgeApiUrl,
      apiKey: knowledgeApiKey,
    });
    const datasetList = await knowledgeClient.listDatasets();
    datasets = datasetList.map((d) => ({ id: d.id, name: d.name }));
    console.log(`Found ${datasets.length} dataset(s) for placeholder conversion.`);
  }

  // 5. 出力ディレクトリを作成
  await fs.mkdir(outputDir, { recursive: true });

  // 6. 各アプリのDSLをエクスポート
  const results: ExportResult[] = [];

  for (const app of apps) {
    const filename = `${sanitizeFilename(app.name)}.yml`;
    const filepath = path.join(outputDir, filename);

    try {
      const dsl = await client.exportDsl(app.id, includeSecret);

      // raw DSLを保存
      await fs.writeFile(filepath, dsl, "utf-8");

      // プレースホルダー変換版を保存（datasets取得済みの場合）
      if (datasets.length > 0) {
        const normalizedDsl = replaceDatasetIdsWithPlaceholders(dsl, datasets);
        const normalizedFilename = `${sanitizeFilename(app.name)}.normalized.yml`;
        const normalizedFilepath = path.join(outputDir, normalizedFilename);
        await fs.writeFile(normalizedFilepath, normalizedDsl, "utf-8");
        console.log(`  Exported: ${app.name} → ${filename}, ${normalizedFilename}`);
      } else {
        console.log(`  Exported: ${app.name} → ${filename}`);
      }

      results.push({
        appId: app.id,
        appName: app.name,
        filename,
        success: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        appId: app.id,
        appName: app.name,
        filename,
        success: false,
        error: message,
      });

      console.error(`  Failed: ${app.name} - ${message}`);
    }
  }

  return results;
}

/**
 * ファイル名として安全な文字列に変換
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "-")
    .toLowerCase();
}
