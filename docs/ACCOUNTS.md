# 會員、樂團與權限設計

## 資料模型

- users：正規化唯一帳號、顯示名稱、密碼雜湊與隨機 salt。
- sessions：256-bit 隨機 Token 的 SHA-256、會員 ID、8 小時期限；不儲存原 Token。
- bands：樂團名稱、單一 owner_id、獨立 revision。每會員最多擁有 20 個樂團。
- memberships：會員／樂團複合主鍵，角色為 admin、editor、viewer；owner 由 bands.owner_id 判定。移除或降級擁有者必須先轉移所有權。
- invitations：指定帳號、角色、單次隨機 Token 的雜湊、七天期限、使用與撤銷時間。只有擁有者能邀請管理員；邀請者失去管理權限後，邀請無法被接受。
- band_score_rows、band_instruments、band_players：所有資料列含 band_id，樂器及演奏者名稱以 band_id 組成主鍵。

## API

所有 POST 需要同來源 Origin 與 JSON；所有業務 API 需要有效會員 Session。前端角色顯示不是授權依據。

| 路徑 | 方法 | 用途 |
|---|---|---|
| /api/auth/register | POST | 帳號、密碼、選填顯示名稱註冊並登入 |
| /api/auth/login | POST | 會員登入 |
| /api/auth/logout | POST | 撤銷目前伺服器 Session 與 Cookie |
| /api/auth/password | POST | 驗證舊密碼、修改密碼、撤銷全部 Session |
| /api/me | GET | 本人基本資訊及實際加入的樂團／角色 |
| /api/bands | POST | 建立樂團與擁有者 membership，預置 26 種樂器 |
| /api/legacy/claim | POST | 登入會員以舊管理金鑰一次性認領既有資料 |
| /api/invitations/accept | POST | 帳號符合、未過期／撤銷／使用的邀請原子兌換 |
| /api/data?band=ID | GET / POST | 限定目前會員有權存取的樂團；沿用配置 API |
| /api/members?band=ID | GET / POST | 成員清單、角色調整、移除及自行離開 |
| /api/ownership?band=ID | POST | 擁有者轉移給已有成員 |
| /api/invitations?band=ID | GET / POST | 邀請清單、建立與撤銷；不回傳已儲存的 Token |

一般資料寫入需要 editor 以上；匯入及管理成員需要 admin 以上。管理員不得修改擁有者、其他管理員或授予 admin。擁有者可轉移權限，原擁有者保留 admin。

每次查詢先驗證 membership，資料 SQL 再限定 band_id。寫入在同一個 D1 原子 batch 內再次驗證當下 membership、角色、資料版本與 ID 所屬樂團。錯誤 ID／revision／交易內權限變更以 409 拒絕，不留下部分異動。不同樂團各有 revision，不會因其他樂團寫入產生衝突。

## 密碼與 Session

使用 WebCrypto PBKDF2-HMAC-SHA256、100,000 iterations、每帳號 256-bit 隨機 salt，再以獨立 AUTH_PEPPER 做 HMAC-SHA256。Workers WebCrypto 目前上限為 100,000，低於 OWASP 對單獨 PBKDF2 的 600,000 建議；獨立 pepper 是額外防護，不能宣稱已符合該 work factor 建議。若 pepper 與 DB 同時外洩仍有離線猜測風險；未來可移至支援更高成本 KDF 的驗證服務。

- https://github.com/cloudflare/workerd/issues/1346
- https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

AUTH_PEPPER 為必要 Secret，與舊 ADMIN_KEY 不同，絕不可任意輪替，否則既有密碼無法驗證。一般帳號改密碼由 API 重新產生 salt 與 hash。原 ADMIN_KEY 只用於首次資料認領；認領後再次使用不能增加任何權限。

Cookie 8 小時到期、HttpOnly、SameSite=Strict、HTTPS Secure。Session Token 只存於 Cookie，資料庫僅存雜湊。帳號註冊、登入、改密碼、舊資料認領受每 IP 每分鐘 5 次限制。登出會刪除 Session；成員被移除不需等 Session 到期便失去樂團權限。

## 遷移與相容性

0002_accounts_and_bands.sql 將舊資料歸入未認領的 legacy 樂團，保留配置 ID、AUTOINCREMENT 序列、備註、清點、名冊與版本。SQLite 對非空表的 REFERENCES + 非空 DEFAULT 有限制，因此以新表複製、保留 ID／序列及重建索引完成遷移。舊資料表名稱被移除，避免意外回滾舊的無樂團篩選 Worker 時暴露全部樂團資料；舊版會因缺表拒絕服務。

資料備份不包含會員密碼、Session 或邀請。SQL 備份與 AUTH_PEPPER 必須分開安全保存。沒有 Email 驗證、自助忘記密碼、MFA、操作稽核歷史或自動排程備份。

## 2026-11-18 記住帳號與系統自動填入

登入與註冊使用分開的原生 POST 表單，登入欄位 name=username/password、autocomplete=username/current-password，註冊使用 new-password。帳號欄位關閉自動大寫、拼字及自動更正。密碼保留在表單中直到原生導航離開，讓系統密碼管理工具觀察成功提交；不將密碼寫入 localStorage 或 sessionStorage。

原生表單端點 /api/auth/sign-in、/api/auth/sign-up 沿用 JSON 登入的來源檢查、限流與密碼驗證。成功設置 Session Cookie 後固定 303 導回首頁；失敗只回傳固定錯誤代碼，不在網址／頁面回顯帳密，不接受任意 next URL。JSON API 仍供既有頁面／客戶端使用。

「記住帳號」是選擇性本機帳號偏好，取消勾選立即移除。「保持登入 30 天」只有明確勾選才延長新 Session 與 Cookie 至 30 天，沒有勾選維持 8 小時；它保存的是可撤銷的隨機登入憑證，並非會員密碼。登出立即撤銷當前登入，改密碼撤銷全部裝置。成員移除及角色變更仍由每次 API 請求檢查。

驗證：23 組 API／權限／原生提交測試通過，包含一般／30 天期限、伺服器登出撤銷、原生註冊、跨來源拒絕與固定錯誤跳轉；另以程式驗證 HTML 自動填入屬性、記住帳號／取消、保留系統已填入內容、儲存空間禁用及不保存密碼。手機實際密碼儲存提示及自動填入仍需 iOS／Android 實機驗收，會受系統設定、瀏覽器及密碼管理工具影響。

參考：[Apple Password AutoFill](https://developer.apple.com/documentation/security/enabling-password-autofill-on-an-html-input-element)、[Chrome 登入表單指引](https://developer.chrome.com/docs/modern-web-guidance/guides/forms/autofill-sign-in-form)。
