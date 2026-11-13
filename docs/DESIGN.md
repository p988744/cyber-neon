> 早期設計提案（v0，2026-11-12）。之後加入的地圖、任務日誌、掃描卡等以 `RECIPE.md` 為準。

# Cyberpunk-Neon 設計提案

以 Cyberpunk 2077 介面為**靈感**的 Herdr Desktop layout。只借風格，不用遊戲素材、logo 或遊戲字體。
依據：`research/visual-language.md`（風格）、`research/materials.md`（素材）、`research/herdr-fit.md`（Herdr 能畫什麼）。

## 1. 一句話

黑底、紅色線條與標籤，**青色＝正在互動／作用中**，**黃色＝需要你看一眼**，**亮紅＝真的出事**。
切角、1px 細線、大寫窄體字，動畫只在狀態改變時出現。

## 2. 三份研究互相衝突的地方，以及取捨

| 議題 | 選項 | 決定 | 理由 |
|---|---|---|---|
| 主色 | herdr-fit 草稿：青框＋黃強調（泛霓虹）／visual：紅為主、青為作用中 | **紅為主** | 遊戲本身就是紅底系；青黃泛霓虹會變成任何 synthwave 主題 |
| 切角位置 | visual：右下／herdr-fit：左上不用量尺寸，其他角要 `on_size_change` | **左上 45°** | 遊戲也用左上（對角組）；省掉每次縮放多一次 render |
| 終端字體 | herdr-fit：Share Tech Mono／materials、visual：JetBrains Mono | **JetBrains Mono** | Share Tech Mono 只有一個字重、沒有 box-drawing 細節；它留給狀態列數字 |
| 掃描線 | 鋪在終端背後（terminal_opacity 0.92）／只鋪 chrome | **v1 不做** | Herdr 不能畫在終端上方；鋪在背後會降低對比，且不支援圖片平鋪 |
| 終端配色 | Scarlet Protocol（MIT）／Cyberpunk-Neon（CC-BY-SA） | **Scarlet Protocol 改兩處** | MIT 好散布；改前景與選取色 |

## 3. 色彩（`themes/Cyberpunk-Neon.json`）

主題檔只收 `#rrggbb`，所以半透明色都先混到底色上算成實色。

| 名稱（Herdr color） | Hex | 用途 |
|---|---|---|
| `canvas` | `#0A0B0F` | 視窗最底層 |
| `chrome` / `surface` | `#140C15` | 側欄、面板（深紫黑） |
| `raised` / `popover` | `#1C1220` | 選單、浮層 |
| `hover` | `#2A1418` | 滑過 |
| `selected` | `#4A1D1F` | 選取列（深紅） |
| `border` | `#7A2A28` | 1px 線 |
| `input` | `#5EF6FF` | 輸入框焦點 |
| `foreground` | `#E8E1D9` | 內文（紅字看久會累，內文不用紅） |
| `muted` | `#E0645A` | 標籤、次要文字 |
| `dim` | `#B04A40` | 停用、裝飾 |
| `accent` | `#F44638` | 標題、強調線、品牌 |
| `accent_foreground` | `#0A0B0F` | |
| `solid` / `solid_foreground` | `#FCEE0A` / `#0A0B0F` | 實心標籤（黃底黑字） |
| `working` | `#5EF6FF` | 青 |
| `blocked` | `#FF003C` | 亮紅，只留給這個 |
| `done` | `#FCEE0A` | 黃 |
| `idle` | `#B04A40` | |
| `unknown` | `#3A2A2E` | |

終端：`background #0A0B0F`、`foreground #E8E1D9`、`cursor #5EF6FF`、`selection #4A1D1F`，
ansi 0–15 用 Scarlet Protocol：
`#101116 #ff0051 #01dc84 #faf945 #0271b6 #c930c7 #00c5c7 #c7c7c7 #686868 #ff6e67 #60fa68 #fffc67 #6871ff #bd35ec #60fdff #ffffff`

## 4. 字體（全部 OFL，放 `mods/cyberneon-chrome/fonts/`）

| 用途 | 字體 | 設定 |
|---|---|---|
| 介面（`ui_font`）、標題 | Rajdhani 600/700 | 大寫，限 3 個字以內 |
| 分頁、標籤 | Chakra Petch 600 | 大寫，12px |
| 狀態列數字、ID | Share Tech Mono | 11px |
| 終端（`font`） | JetBrains Mono | 13–14px |

Herdr 沒有 letter-spacing，寬字距靠手動加空格或放棄。

只放 Rajdhani SemiBold 與 Bold，不放 Medium：一般字重（400）沒有對應檔，會挑最近的；少了 Medium 就落到 SemiBold，整體變粗、在深底上較清楚。
字體在「下次外觀變更」才載入：第一次安裝後要切到別的 layout 再切回來。

對比（實測）：`foreground` 14.8:1、`muted #E0645A` 5.6:1、`dim #B04A40` 3.6:1（只用在時間戳等次要資訊）。

## 5. 版面（保留 `main` 的 node id，內建 mod 靠 id 找節點）

```
root  背景漸層 #0A0B0F→#05060A，titlebar none
├─ sidebar 268px（chrome #140C15）
│  ├─ brand 52px        cyberneon-chrome   字標＋偶爾閃一下的 RGB 錯位
│  ├─ spaces            spaces（內建，原樣）
│  ├─ agents            cyberneon-agents   狀態標籤（第 6 節）
│  └─ footer 60px       cyberneon-chrome {footer:true}
└─ work
   ├─ tabs 40px         cyberneon-tabs     左上切角的分頁；作用中＝黃色 2px 底線
   ├─ work-body
   │  ├─ main  pane：radius 0、border #622021、focus 1px #5EF6FF、header cyberneon-pane 26px
   │  └─ panel files / changes（內建，原樣）
   └─ status 26px       cyberneon-status   機器・分支・agent 數・時鐘，以 ▮ 分段
```

- **Pane 外框不能切角**（Herdr 限制）。改由 pane header 承擔：左上切角、左側 3px 狀態色條、大寫標題、右側狀態標籤。
- **霓虹光暈**沒有原生 API，用 2–3 條透明度遞減的細線疊出來，只用在焦點與品牌。
- 沿用的內建 mod 是圓角，v1 先接受。

## 6. Agent 狀態

| 狀態 | 色 | 標籤 | 樣子 | 動畫 |
|---|---|---|---|---|
| working | 青 `#5EF6FF` | `EXEC` | 左側青色細條 | `.frames` 跑資料條 `▰▱▱▱…`，110ms |
| blocked | 亮紅 `#FF003C` | `INPUT REQ` | 實心紅標籤＋深色粗體字（5.2:1），整列／整條 header 染紅 | 標籤永遠看得到，只有上面的深色斜紋硬閃，900ms |
| done | 黃 `#FCEE0A` | `COMPLETE` | 黃底黑字實心標籤，看過就變 idle | 呼吸 0.6→1，1400ms |
| idle | `#6B2A27` | `STANDBY` | 1px 空心方塊 | 無 |

分頁與 spaces 用 6×6 方點取代圓點。

## 7. 動畫規則

- 只用原生 `.frames` / `.loop` / `.transition`，不用 timer（timer 會重繪整個視窗）。
- 只能動 `opacity` `width` `height` `left` `top`；不能動顏色、縮放、模糊。
- 常駐動畫最多一個（品牌字標，慢速）；其餘只在 agent 狀態上。
- 一個「動畫」開關，關掉時全部靜止。

## 8. 分階段

| 階段 | 內容 | 程式碼 |
|---|---|---|
| **v0 外觀** | 主題檔、root 外觀鍵、pane 外框、字體；clone `workspace-chrome` 當字體容器 | 幾乎沒有 |
| **v1 主體** | clone `pane` `tabs` `agents` `workspace-status` 為 `cyberneon-*`，各帶一個小 `neon.js`（切角、光暈、閃爍） | 中 |
| **v2 加料** | clone `spaces`、自製 toast、chrome 上的掃描線、右側 HUD 抽屜、音效（預設關） | 視需要 |

每一階段結束：每個 mod 跑 `herdr-app check`、確認沒有 `*.error`、`herdr-app shot` 截圖比對。

## 9. 已知限制

- 主題挑選器會蓋掉 layout 的主題，無法阻止。
- 遊戲調色盤沒有官方數值；hex 來自社群主題與 CSS 仿作取樣（研究檔有標 seen/inferred）。
- 選單、對話框、浮層會是 Herdr 預設的圓角外框。
- 縮放不是 1 時，1px 霓虹線會有鋸齒（win98 的對齊像素做法可借）。

## 10. 已決定（2026-11-12）

1. 主色：紅為主。
2. 動畫：預設開，附一個總開關。
3. 第一版：v0＋v1。
4. 名字：`Cyberpunk-Neon`，mod 前綴 `cyberneon-`。
