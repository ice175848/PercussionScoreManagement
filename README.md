# Percussion Sync｜打擊樂譜與樂器管理

管理演出、曲目、分部、演奏者與樂器需求。`codex` 分支延續既有響應式網頁，改用 **Cloudflare Workers + D1** 儲存資料；原本 Flutter 程式仍保留。

功能包含曲目／分部建立、編輯與刪除、作曲／編曲資訊、演奏者配置、樂器庫、演出器材清單、清點、JSON 備份與舊資料匯入。器材清單同時列出「各曲目需求最大值」與「整場配置次數」，供場務判斷搬運需求。

## 本機執行

需要 Node.js 22.5 以上與 npm。

```sh
npm ci
cp .dev.vars.example .dev.vars
# 修改 .dev.vars 的 ADMIN_KEY，至少 32 字元
npm run db:local
npm run dev
```

開啟 Wrangler 顯示的本機網址，輸入 `.dev.vars` 中的管理金鑰登入。登入後以 HttpOnly Cookie 保持 8 小時；金鑰不會寫進瀏覽器儲存空間。

```sh
npm test
npm run build
npx wrangler deploy --dry-run
```

## 上線與維運

詳見 [部署說明](docs/DEPLOYMENT.md)。同一 Worker 供應靜態網頁與 `/api/*`，D1 僅由後端存取。建置只複製明確列出的公開檔案，不會公開 `data.json`、Apps Script、部署設定或金鑰。

`codex-web.yml` 僅執行測試及部署預檢；管理者執行 `npm run deploy` 部署。既有 `develop` 的 GitHub Pages 流程維持原樣。

## 舊版資料搬移

1. 先在 Google 試算表建立副本。
2. 新網站「系統設定 → 從原本的 Google Sheet 搬移」輸入舊試算表網址，下載 JSON。舊 API 讀取時可能補齊表格結構；若已無法存取，需先修復舊 API 或自行整理成相容 JSON。
3. 檢查備份內容，再按「匯入 JSON」。也可使用已自行確認的舊 `static_web/data.json` 快照，它不保證是最新資料。
4. 匯入僅適用於尚無演出配置的資料庫，不會默默覆寫或重複合併演出。搬移後以新資料庫為準，沒有雙向同步。

支援舊版資料列陣列及 `{ instruments, players, performances }` 格式。新備份另含 `version`、`revision`，保留備註、清點與演奏者。

目前是一個樂團共用管理金鑰的管理站，沒有個別成員帳號、分級權限或樂譜檔案上傳。請僅將金鑰提供給可以編輯全部資料的人。
