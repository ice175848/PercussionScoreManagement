# Cloudflare 部署與維運

## 架構與費用

GitHub 保存程式與執行 CI；Cloudflare Workers 供應網站及 API；D1 保存 SQLite 資料。不需要 Render 常駐服務，也不需要同時維護 Neon 或 Expo。

以 Workers Free 為目標，不啟用付費方案、不購買網域，使用 workers.dev。官方目前列出 Workers 免費每日 100,000 次動態請求；D1 免費每日 500 萬列讀取、10 萬列寫入、帳號合計 5 GB 儲存，Free 單庫另有 500 MB 上限。這些額度與同帳號其他專案共用；用完可能中斷服務。部署前確認帳號方案；若帳號既有付費方案，費用需依實際方案計算。

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/

## 第一次部署

```sh
npm ci
npx wrangler login --scopes account:read user:read workers:write d1:write
npx wrangler d1 create percussion-sync
```

將回傳 UUID 填入 wrangler.jsonc 的 database_id。若已有同名資源，先確認用途，不要覆蓋他人的資料庫或 Worker。

```sh
npm run db:local
npm test
npm run build
npx wrangler deploy --dry-run
npm run db:remote
npx wrangler secret put ADMIN_KEY
npm run deploy
```

ADMIN_KEY 至少 32 字元，使用高熵隨機值，保存於密碼管理器或本機忽略的 backups/，權限設為 600，不要放入 Git、CI log 或聊天訊息。Wrangler 可能先建立未部署 Worker 儲存 Secret；確認名稱是本專案 percussion-sync。缺少 Secret 時業務 API 拒絕服務。首次使用帳號可能需在 Workers 控制台設定 workers.dev 子網域；OAuth 權限需由帳號擁有者授權。

## 驗證與限制

- GET /api/health 回傳 status=ok、database=up；未登入 GET /api/data 得到 401。
- 登入後新增測試分部、重新整理確認留存，測試編輯、清點、備份、刪除測試分部及登出。
- /data.json、/Code.gs、/.dev.vars 不應洩露原始資料或設定。
- 本機 API 測試涵蓋登入、來源限制、Cookie、登入限流、原子儲存、併發版本衝突、錯誤 ID 範圍、匯入驗證與備份還原。

單一管理金鑰允許讀寫全部資料。Session 8 小時到期，HttpOnly、SameSite=Strict，HTTPS 時使用 Secure。每 IP 每分鐘 5 次登入限制，Cloudflare 原生限流採近似計數。更換 ADMIN_KEY 使既有 Session 全部失效；登出清除目前瀏覽器 Cookie，不逐一撤銷已外洩的 Session。

異動使用 D1 原子 batch 與全域 revision 檢查。其他人更新後，舊頁面儲存得到 409，請取消編輯、重新載入，再確認後重做。失敗不會宣稱已儲存或關閉編輯器。ID 不會隨刪除而平移。刪除分部會刪除其配置，請先備份。

匯入限 2 MB、5000 列；只允許對尚無演出配置的資料庫匯入。單次編輯或刪除最多 1000 個舊 ID。資料庫沿用配置列模型，目前沒有完整庫存、借還、維修或個別帳號權限。

## 更新、備份及回滾

更新前下載 JSON，另可匯出 SQL：

```sh
mkdir -p backups
npx wrangler d1 export DB --remote --output backups/percussion-before-update.sql
```

測試、建置、dry-run 通過後，檢查 migration 再執行 db:remote 與 deploy。初始 migration 僅對本專案新建空庫執行，勿套用至其他系統。部署不會自動搬移舊資料。

程式回滾使用 npx wrangler rollback，不會回復資料庫 schema 或資料。D1 Time Travel 窗口依方案而定，使用前確認時間點與影響。JSON 還原可先對新建空庫匯入，驗證後切換 binding；不要直接清空現有資料或重跑初始 SQL。

## GitHub

codex-web.yml 在 codex 分支執行 npm ci、API 測試、靜態建置、Wrangler dry-run，不包含部署 Token，也不部署原有 GitHub Pages。若未來啟用自動部署，再設定最小權限 Token 與對應 environment；不得將 Token 放進 YAML。

## 2026-10-27 首次部署紀錄（台灣時間）

- 網站：https://percussion-sync.memory509609.workers.dev
- 資料庫：percussion-sync，APAC，UUID af34db59-ccde-4495-bd51-de59d9a538fb。
- Cloudflare 控制台確認 Current plan = Free（$0），未升級方案。
- 管理金鑰已設定為 Worker Secret；本機備份位於 backups/admin-key.txt（Git 忽略、權限 600）。本機 .dev.vars 僅為測試金鑰，不可用於正式網站。
- 本機 API 整合測試 6/6 通過；建置、部署預檢及 migration 通過。
- 瀏覽器驗證登入、建立、重新載入、編輯作曲／編曲資訊與樂器備註、器材統整、清點及下載備份。
- 線上 API 驗證健康檢查、匿名 401、登入、建立／讀回、清點保留備註、刪除測試資料、登出後 401；線上瀏覽器確認登入頁正常。
- 正式庫僅預置 26 種樂器，舊試算表與快照未自動匯入；請檢查來源資料的新舊，再從系統設定搬移。
- 既有 develop GitHub Pages 與 Google Sheet 未變更。原本尚未提交的 .claspignore／appsscript 設定未納入本次提交。
