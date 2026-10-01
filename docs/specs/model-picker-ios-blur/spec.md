# model-picker-ios-blur Specification

## Status

**OPEN — 不修，仅记录。** 2026-10-01 user 裁决：按奥卡姆剃刀，production 没问题就不引入非必要的兜底；当时写好的页面级兜底**已 revert**（源码、单测、mobile leg 接线全部移除）。本文是该问题的**调查记录**，不含任何生效的代码变更。

---

## Purpose

记录一个**未坐实的 iOS 触摸缺陷**的完整证据链，使得：

1. 日后任何人不必从零重查——已知的事实、已证伪的假设、以及仍未知的部分都在这里；
2. 当时那段**已删除**的兜底实现（要点 + 判据）可被重建；
3. 「什么时候该重新研究」有明确触发条件。

---

## 现象（user 报告，2026-10-01）

iPhone Safari / 加到主屏的 Web App，composer 的 model seat：

- 第一次点触发按钮 → 弹出**一级菜单**（两行：`Model │ <当前模型>`、`Effort │ <当前等级>`）—— 正常。
- 再点一级菜单里的 **`Model` 那一行**（期望进入二级的 provider 分组模型清单）→ **整个 menu 直接关掉**，清单不出现。
- 换模型、resume 会话等后续流程在能进入二级菜单时一切正常。

发生实例：**4999 rig**（DSH 0.1.7-rc.1 checkout 构建 + better-dsh 0.2.4-d）。
未发生实例：**3080 production**（DSH 0.1.7-rc.2 全局安装 + better-dsh 0.2.4-c），同一台 iPhone。

> user 补充的历史：更早 **test.pc 的 PC 端**也出现过同样行为，后来某次更新/调整后**自愈**了。这条是「上游版本差异」这一方向的重要旁证。

---

## Why not fixed (Occam 裁决)

| 事实 | 含义 |
|---|---|
| prod（rc.2）在同机型同模式下**没有**这个问题 | 现役稳定版本不需要兜底 |
| user 推测更早的 beta 也没有 | 不是「新版本引入的回归」 |
| 曾经的 test.pc PC 端**自愈** | 更像上游某次改动带进来的差异，而非我们的插件 |
| 两端**都是**加到主屏的 Web App（PWA） | PWA/浏览器模式差异这条最省事的解释被**排除** |

结论：**不引入页面级兜底**；把证据留下，等有更强的复现条件（或上游版本对齐）再研究。

---

## 已确证的事实（证据）

**E1 — 不是数据/凭据问题。** 4999 活体驱动该组件：根菜单正常；二级清单完整加载 `DeepSeek`（V4.1-Flash、V4-Pro）+ `zai`（GLM-4.7、GLM-5-Turbo、GLM-5.2、GLM-5.2 Highspeed、GLM-5.3、GLM-5.3-Flash、GLM-5.3 Highspeed），**无 error strip / warning 行**。host 侧 `agent-default-model: zai/glm-5.3-flash`，`ZAI_API_KEY` 在凭据库。

**E2 — 上游的关闭逻辑在两版之间字节一致。** `@deepseek-ai/dsh-client-ui-model-selection` 的 `ModelSelect.onBlur`：

```js
const onBlur = (event) => {
  if (event.relatedTarget instanceof Node && (rootRef.current?.contains(event.relatedTarget) === true
      || menuRef.current?.contains(event.relatedTarget) === true)) return;
  close();   // 任何「没落在卡片里」的 blur 都关菜单
};
```

prod 的 rc.2 与 rig 的 rc.1 逐字符相同 ⇒ 组件本身在两个实例上**同样脆弱**。

**E3 — 机制可达（本地复现，无需 iOS）。** 菜单开着、触发器持焦时，制造一个 `relatedTarget === null` 的 `focusout`：

```
before: menuOpen=1, active=Select model, current …
after:  menuOpen=0        ← 菜单被 onBlur 关掉
```

即：**只要 iOS 在 tap 的触摸相位把焦点抹到"没有地方"，菜单就会在 click 之前被 unmount，tap 被吃掉。** 这也解释了 user 观察到的「按完直接关回去」。

**E4 — prod 并不免疫（对照实验，决定性）。** 用 prod 自己的 cookie 在真实浏览器里对 **3080 活体页面**施加同一个事件：

| | 菜单开 | 施加 `focusout(relatedTarget=null)` | 点 Model 行 |
|---|---|---|---|
| **PROD 3080** | ✓ | **菜单被关掉** ❌ | — |
| **RIG 4999**（当时带兜底） | ✓ | 存活 ✓ | 9 行清单 ✓ |

⇒ 「prod 的代码里没有这个缺陷」被**证伪**。差异不在组件逻辑。

**E5 — 两个实例服务的组件实现并不"几乎一样"。** 抓取**实际被浏览器加载**的 client bundle 比对（rc.1 vs rc.2），差异是实质性的（非仅 CSS）：

- 菜单容器：裸 `<div>` → primitives 的 **`MenuSurface`**（多一层 `material` + 一个 `position:fixed` 的 backing portal）；
- `show()`：rc.2 在「没有当前选择」时**直接开二级清单**（`setPane(state.current === null ? 'model' : 'root')`），rc.1 永远先开一级；
- 新增 `pending` / `StateDot` 转圈、`retainedEffort`、`deepseek-account` provider 分组与文案；
- 删除 composer-block（`blocked.composer`）；
- `busy` 语义：`status === 'selecting'` → `pending !== null`；
- 目录同步整段重写：catalog 未就绪时 **rc.1 把 `current` 清成 null / `groups` 清空**（除非 `resolved`），**rc.2 保留**。

**E6 — 我们的插件不碰焦点/指针默认。** `better-dsh/src/mobile/client/index.ts` 的滑动手势只在 `document` 上**记录** pointerdown/move 的起点与位移，**既不 `preventDefault()` 也不 `stopPropagation()`**；zoom guard 只在 iOS 窄视口下改 viewport meta / 注入字号地板，不触碰焦点。⇒ 没有「我们的插件把 tap 吃掉」的通路。

---

## 已证伪的假设

| # | 假设 | 证伪方式 |
|---|---|---|
| H1 | 没有 GLM-5.3 的 key / catalog 两边对不上 → listing 报错后静默弹回 | **E1**（清单完整、无报错） |
| H2 | 我们某个插件开发不到位（手势/zoom guard 吞掉了 tap） | **E6** |
| H3 | prod 是 PWA、rig 是浏览器标签页，模式差异 | user 确认**两端都是加到主屏的 Web App** |
| H4 | prod 的组件代码免疫，所以只有 rig 坏 | **E4**（prod 活体同样被关掉） |
| H5 | 「两个实例几乎一样，只是版本落后一点点」 | **E5**（该组件实现有实质差异） |

---

## 仍然未知（open question）

> 同一台 iPhone、同为 PWA：为什么 **rc.2 的页面不发**那个杀死菜单的 blur，而 **rc.1 的页面发**？

按可疑度排序的候选方向（**均未验证**）：

- **D1（最可疑）** rc.1 → rc.2 之间**该组件自身**的行为差异（E5 那一串），特别是菜单容器从裸 `div` 换成 `MenuSurface`、以及 `show()` 开窗策略/目录同步重写。这条与 user 的「更新后自愈」时间线吻合。
- **D2** 壳层（shell / kernel / composer / `ui-conversation`）在 rc.1→rc.2 的焦点处理差异。
- **D3（低）** better-dsh 0.2.4-c（prod）vs 0.2.4-d（rig）的差异 —— 但 c→d 只多了 web-password gate 与本次已 revert 的 fix，两者都不参与焦点。
- **D4** 其它环境项：iOS 版本、键盘是否弹起、PWA 安装时间与缓存态、tap 时 `document.activeElement` 究竟是谁。

**重新研究的触发条件**：把 rig 对齐到 rc.2 后现象**仍在** ⇒ 推翻 D1/D2，转 D4，此时才值得上真机探针。

---

## 复现与取证

### R1 本地机制复现（Chromium，无需 iOS）

```js
// 菜单开着、触发器持焦时执行
document.activeElement.blur()          // → menuOpen 1 → 0，菜单消失
```

或者用完整对照脚本：用 cookie 打开 3080 / 4999，`click` 触发器 → `document.activeElement.blur()` → 看 `[role="menu"]` 是否还在 → 若在，点 `[role="menuitem"]` 里含 `Model` 的那行，数 `[role="menuitemradio"]`。当时的脚本（已随 revert 删除）用的是 `puppeteer-core`（`better-dsh/node_modules`）+ playwright 缓存的 Chromium（`~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`），cookie 从 curl 的 Netscape jar 解析（**注意 `#HttpOnly_` 前缀不是注释**）。

### R2 真机取证（建议的下一步，尚未做）

在页面注入探针，记录并**悬浮显示**最近 N 条 `touchstart / touchend / mousedown / focusin / focusout(relatedTarget) / click` + 每步的 `document.activeElement`，在 iPhone 上点一次、截图。这是唯一能看到「iOS 到底发了什么事件」的手段——本机没有可用真 WebKit（Playwright 不支持 Ubuntu 26.04，系统只有 snap epiphany）。

---

## 当时的兜底实现（已 revert，存档备查）

若将来 R2 证明「iOS 确实发了那个 blur」，可按此重建（`better-dsh` 的 `dashr-mobile` boot-script 腿，纯函数 + `Function.prototype.toString` 内联，与 `zoom-guard.ts` 同一约束：ES5、自包含）：

```js
export function isSpuriousMenuBlur(target, relatedTarget) {
  if (relatedTarget !== null && relatedTarget !== undefined) return false
  if (target === null || typeof target !== 'object') return false
  var el = target
  if (typeof el.closest === 'function') {
    var owner = el.closest('[role="menu"]')
    if (owner !== null && owner !== undefined) return true
  }
  if (typeof el.getAttribute !== 'function') return false
  return el.getAttribute('aria-haspopup') === 'menu'
    && el.getAttribute('aria-expanded') === 'true'
}
```

接线：`document.addEventListener('focusout', e => { if (isSpuriousMenuBlur(e.target, e.relatedTarget)) e.stopPropagation() }, true)` —— **capture 相位在 React 的 root container 监听器之前跑**，所以 React 的 `onBlur` 收不到该事件。

验证过的安全性：菜单外 `mousedown`（不依赖焦点）、`Escape`、`Tab`、以及任何 `relatedTarget` 是真实元素的 blur，全部照旧关闭；只有「从打开的菜单里 blur 到没有地方」这一种被压掉。段落需自带分号定界（相邻的 zoom 段以 `})()` 结尾、靠 ASI，裸语句会拼成 `})()var …` = SyntaxError）。

---

## 参考锚点

- 上游组件：`packages/client/ui-model-selection/src/client/ModelSelect.tsx`（`onBlur` / `show` / `drill` / `close`）
- 上游 WebKit 相关的两笔提交（**只修了鼠标路径**，rig 与 prod 都已包含）：`6613660223`（keep model picker focus during mouse selection）、`06ef26a80f`（preserve focus when toggling the model picker），分支 `fix/webkit-model-picker`
- 上游 e2e：`apps/web/tests/declared-reasoning.e2e.ts`（Chromium + WebKit 双引擎，含 `pointer-menu` 快照）；其 WebKit 用例走的是 `page.mouse.down()`（**鼠标**），因此覆盖不到触摸相位
- 相关实现：`packages/client/ui-primitives/src/client/MenuSurface.tsx`（rc.2 新增的菜单容器）
