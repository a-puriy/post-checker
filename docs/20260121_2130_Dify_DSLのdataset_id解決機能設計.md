# Dify DSLのdataset_id解決機能設計

## 目的

**開発者が、DifyのDSLをGit管理し、ローカル環境から本番環境へ安全にデプロイできるようになるため。**

現状、DSLをエクスポートしてそのまま別環境にインポートすると、Knowledge Base（dataset）へのリンクが切れてしまい、手動での再設定が必要になる。この問題を解決し、GitOpsワークフローを実現する。

---

## 背景・課題

### Difyの現状

Difyは以下の点で優れている：
- 非エンジニアでも触れるUI
- RAG + ワークフローが一体化
- プロンプト調整がWebUIで即座に可能

一方、DevOps/GitOps観点では未成熟：
- 環境間のマイグレーションが手動
- CI/CD向けのAPIが不十分
- DSLにハードコードされたID問題

### 具体的な問題：dataset_idsのID問題

DSLをエクスポートすると、デフォルト設定ではKnowledge Baseへの参照が暗号化された文字列として出力される：

```yaml
# postchecker.yml（デフォルト設定の場合）
dataset_ids:
  - ug+03ZydCJD3JIL/UFfHqeYOQ0rWhlsSKaboDTz2/PMbQAo74J0ka4ZlAcbTe7xg
```

ただし、Difyの環境変数 `DSL_EXPORT_ENCRYPT_DATASET_ID=false` を設定することで、平文のUUIDとして出力できる：

```yaml
# postchecker.yml（DSL_EXPORT_ENCRYPT_DATASET_ID=false の場合）
dataset_ids:
  - xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**本設計では `DSL_EXPORT_ENCRYPT_DATASET_ID=false` を前提とする。**

dataset_idの平文出力に関するセキュリティリスク：
- dataset_id自体はKnowledge BaseのUUIDにすぎない
- APIキーや認証情報ではなく、IDだけでは認証なしにアクセスできない
- 本リポジトリはpublicであり、DSL・プロンプト・マニフェスト等も公開情報
- **よって、平文出力によるセキュリティリスクは実質的にない**

IDが平文になっても、環境間で以下の問題は残る：
- ローカル環境と本番環境でIDが異なる
- そのままインポートするとKnowledge Baseへのリンクが切れる

### 調査結果：既存ツールの状況

| ツール | 内容 | dataset_id対応 |
|--------|------|----------------|
| dify-apps-dsl-exporter | DSL一括エクスポート/インポート | 非対応 |
| Dify公式 | Version Control機能 | 環境間同期なし |
| コミュニティ | Discussion #24781等で要望あり | 未解決 |

**結論：この問題を解決するツールは存在しない。**

---

## 設計方針

### 前提条件

- **`DSL_EXPORT_ENCRYPT_DATASET_ID=false`** がローカル・本番の両環境で設定されている
- Knowledge Baseの「名前」は環境間で統一されている
- 同一環境内でKnowledge Baseの名前は重複しない

### アプローチ：プレースホルダー方式

dataset_idを人間が読める論理名（プレースホルダー）に置換し、インポート時に実際のIDに解決する。

```
Export時: dataset_id → {{dataset:チームみらいマニフェスト}}
Import時: {{dataset:チームみらいマニフェスト}} → 実際のdataset_id
```

---

## 機能仕様

### 1. Export時の処理（DSL正規化）

**入力:** Difyからエクスポートした生のDSL

**処理:**
1. DSLをパース
2. `dataset_ids` フィールドを検出
3. 各IDに対して、Console APIでdataset一覧を取得しID→名前を解決
4. IDをプレースホルダー `{{dataset:名前}}` に置換
5. 正規化されたDSLを保存

**出力:** 正規化されたDSL（Git管理用）

```yaml
# 正規化後のpostchecker.yml
dataset_ids:
  - "{{dataset:チームみらいマニフェスト}}"
```

### 2. Import時の処理（ID解決）

**入力:** 正規化されたDSL

**処理:**
1. DSLを読み込み
2. プレースホルダー `{{dataset:名前}}` を検出
3. ターゲット環境のConsole APIでdataset一覧を取得
4. 名前→IDを解決
5. プレースホルダーを実際のIDに置換
6. DifyのimportDsl APIを呼び出し

**出力:** インポート成功/失敗

### 3. エラーハンドリング

| ケース | 挙動 |
|--------|------|
| プレースホルダーの名前が見つからない | エラー終了、該当名をログ出力 |
| 同名のdatasetが複数存在 | エラー終了（前提条件違反） |
| Console APIへのアクセス失敗 | リトライ後エラー終了 |

---

## API設計

### 必要なAPI呼び出し

#### Console API（既存）
- `GET /console/api/apps` - アプリ一覧
- `GET /console/api/apps/{id}/export` - DSLエクスポート
- `POST /console/api/apps/import` - DSLインポート
- `POST /console/api/apps/{id}/import` - 既存アプリのDSL更新

#### Console API（追加調査が必要）
- `GET /console/api/datasets` - dataset一覧（ID・名前の対応を取得）

※ Knowledge API (`/v1/datasets`) は別の認証方式（API Key）のため、Console APIで統一するのが望ましい。

---

## ファイル構成

```
scripts/src/
├── application/
│   ├── exportDslUsecase.ts      # 既存：エクスポート処理
│   ├── importDslUsecase.ts      # 新規：インポート処理
│   └── dslTransformer.ts        # 新規：プレースホルダー変換
├── domain/
│   └── datasetResolver.ts       # 新規：名前⇔ID解決ロジック
└── infra/
    └── difyConsoleClient.ts     # 既存：listDatasetsメソッド追加
```

---

## 運用フロー

```
[ローカルDify]
     │
     │ 1. WebUIでワークフロー編集
     ▼
[Export Script]
     │
     │ 2. DSLエクスポート + プレースホルダー置換
     ▼
[Git Repository]
     │
     │ 3. レビュー & マージ
     ▼
[Import Script]
     │
     │ 4. プレースホルダー解決 + インポート
     ▼
[本番Dify]
```

---

## 制約・前提

1. **Dify環境変数設定**: ローカル・本番の両環境で `DSL_EXPORT_ENCRYPT_DATASET_ID=false` を設定
2. **Knowledge Base名の統一**: ローカルと本番で同じ名前のKnowledge Baseを用意する必要がある
3. **名前の一意性**: 同一環境内でKnowledge Base名は重複不可
4. **Console APIアクセス**: Playwright経由での認証が必要（現在の実装と同様）

---

## テスト方針

### テストレベルの選定

| レベル | 対象 | 採用 |
|--------|------|------|
| Unit Test | dslTransformer（プレースホルダー置換ロジック） | ○ |
| Integration Test | Export/Import全体フロー（実Dify環境） | ○ |
| E2E Test | GitOpsワークフロー全体 | △（手動） |

### 1. Unit Test

**対象:** `dslTransformer.ts` のプレースホルダー変換ロジック

Dify APIに依存しない純粋な文字列変換処理をテストする。

```
テストケース:
- dataset_idをプレースホルダーに置換できる
- プレースホルダーをdataset_idに置換できる
- 複数のdataset_idsを一括で置換できる
- dataset_idsが存在しないDSLはそのまま返す
- 不正なプレースホルダー形式はエラーになる
```

### 2. Integration Test

**対象:** Export/Importの全体フロー

実際のDify環境（ローカル）に接続し、以下を検証する。

```
前提:
- テスト用Dify環境が起動している
- テスト用Knowledge Base「test-dataset」が存在する
- テスト用App「test-app」が存在し、test-datasetを参照している

テストケース:
1. Export → プレースホルダー変換
   - test-appをエクスポート
   - DSL内のdataset_idが {{dataset:test-dataset}} に変換されていることを確認

2. Import → ID解決
   - プレースホルダーを含むDSLを用意
   - インポート実行
   - アプリがKnowledge Baseを正しく参照していることを確認

3. ラウンドトリップ
   - Export → Import → 再Export
   - 最初と最後のDSLが等価であることを確認

4. エラーケース
   - 存在しないKnowledge Base名のプレースホルダー → エラー
   - Dify APIアクセス失敗 → リトライ後エラー
```

### 3. テスト環境

Integration Testはローカルの開発用Dify環境を使用する。

```
環境変数:
  DSL_EXPORT_ENCRYPT_DATASET_ID=false
```

---

## 未解決事項

1. **Console APIのdataset一覧エンドポイント確認**
   - `/console/api/datasets` が存在するか実機で確認が必要
   - 存在しない場合、Knowledge API (`/v1/datasets`) を併用する設計に変更
