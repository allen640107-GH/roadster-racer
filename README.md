# Roadster Racer — Tesla Roadster 賽道狂飆

Browser 3D racing game (Three.js + cannon-es, vendored). 2026 aerospace-wedge Roadster remodel + Rocket cold-gas **flight mode**.

## 執行
- Modular: open via any static server (`python3 -m http.server`) → `index.html`
- Standalone: open `roadster-racer-standalone.html` (no server needed for file:// on desktop; mobile browsers may restrict)

## 操作
| 輸入 | 動作 |
|------|------|
| W / ↑ / 油門 | 油門；飛行時爬升 |
| S / ↓ / 煞車 | 煞車／倒車；飛行時下降 |
| A D / ← → | 轉向；飛行時偏航／滾轉 |
| Space / 手煞車 | 甩尾；飛行時 **加力** |
| **F / 「飛行」** | 按住啟動冷氣推進飛行 |
| R / 重置 | 重置車輛 |
| C / 鏡頭 | 切換鏡頭 |

## 手機觸控
橫向建議。多點觸控同時按：轉向、油門、煞車、手煞車／加力、**飛行**、重置、鏡頭、聲音。

### 傾斜轉向（陀螺儀）
- 觸控 HUD 上的「傾斜轉向」可開關（預設嘗試開啟）。
- **iPhone / iPad（Safari）**：首次開啟時會跳出「動作與方向」權限；請點允許。若曾拒絕，到「設定 → Safari → 動作與方向」或重新整理後再開。
- **Android**：多數瀏覽器無需額外權限；橫向握持，左右傾斜即可轉向。
- 螢幕上的 ◀ ▶ 轉向鍵仍可當備援。

## 視覺
Ano White 車漆（高清漆／金屬感）、鈦金屬飾條、金色遮陽罩玻璃、隱藏式頭燈與 DRL、分段全寬尾燈、主動尾翼（端板）、地面效應風扇、冷氣推進噴嘴、鈑金縫線、後視鏡、煞車卡鉗、胎壁細節。
車廂內裝：縮小座椅／頭枕避免穿出車體、中控台與雙螢幕、yoke（車內鏡頭時隱藏以免擋風）、門板；車內鏡頭會隱藏 HUD 雜訊。車頭：引擎蓋鈑件縫、隱藏頭燈凹槽、前保桿／分流器與徽章。
賽道：更寫實瀝青／砂石緩衝帶、紅白路肩、護牆胎印與藍頂欄、煞車距離牌、廣告板、起點照明；海岸泡沫與山崖色帶、補光與環境反射強化。

## 傾斜轉向
死區約 5°、最大傾斜約 28° 達滿舵、平滑響應（較先前 9°/36°/0.82 更靈敏）。
