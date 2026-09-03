/**
 * iOS focus auto-zoom suppression — pure decision core (host half, change
 * `2026-09-03-ios-focus-zoom-suppression`).
 *
 * iOS Safari auto-zooms the page (~115–120%) whenever ANY focusable control
 * with a computed font-size below 16px receives focus; DSH's input surfaces
 * are all 13–14px, so every focus on an iPhone trips it. Solution B (user
 * ruling, 2026-09-03): rewrite the viewport meta early — appending
 * `maximum-scale=1, user-scalable=no` — which suppresses the focus zoom on
 * iOS 10+ WITHOUT disabling pinch zoom (Discourse PR #30877 empirics).
 *
 * The three exported predicates here are the entire decision surface:
 * everything else (state machine, resize re-evaluation, stock-meta
 * reconciliation) lives in the boot script section {@link buildZoomGuardSection}
 * emits. That section embeds these functions via `Function.prototype.toString`
 * — the unit-tested source IS the shipped source, byte for byte — which
 * constrains their shape:
 *
 * - **ES5 syntax only** (the inline head script targets ancient parsers):
 *   `var`, function declarations, string concatenation; no arrows, no
 *   let/const, no template literals, no destructuring.
 * - **Fully self-contained bodies**: no module-scope identifiers, no helper
 *   calls, no shared constants. A bundler may rename the declaration, but a
 *   renamed free reference would be a `ReferenceError` on the page. The
 *   eval-style tests in `test/web-trust.spec.ts` execute the real generated
 *   script against a stub DOM, so any such leak fails the suite.
 *
 * @module dashr/mobile/zoom-guard
 */

/** The two zoom tokens the guard merges into the stock viewport content. */
export const ZOOM_GUARD_TOKENS: Readonly<Record<string, string>> = {
  'maximum-scale': '1',
  'user-scalable': 'no',
}

/**
 * Whether a UA string + touch-capability pair is an iOS-class browser
 * (design D2, mirroring Discourse `capabilities.isIOS`): iPhone/iPod/iPad,
 * plus iPadOS 13+ desktop-Safari masquerade (`Macintosh` UA with a
 * multi-touch digitizer). Deliberately NOT `pointer:coarse` — Android Chrome
 * never focus-zooms and `maximum-scale` has historical side effects there,
 * so the gate is tightened to the iOS family. UA-shape drift degrades
 * benignly: a novel UA simply reads as non-iOS and no rewriting happens.
 *
 * @param ua - `navigator.userAgent`.
 * @param maxTouchPoints - `navigator.maxTouchPoints` (0 when absent).
 * @returns `true` for iOS-class browsers.
 */
export function isIOSClassUA(ua: string, maxTouchPoints: number): boolean {
  return /iPhone|iPod|iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
}

/**
 * Token-level merge of viewport directives into a viewport meta `content`
 * string (design D4): existing tokens keep their positions, a token whose key
 * (compared case-insensitively) is in `tokens` is REPLACED by the configured
 * key=value, and configured keys not present are APPENDED in insertion order.
 * Idempotent by construction — merging always re-derives from the input, so
 * repeated evaluation cannot accumulate duplicates.
 *
 *   mergeViewportTokens('width=device-width, initial-scale=1', T)
 *   → 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
 *   mergeViewportTokens('width=device-width, maximum-scale=5', T)
 *   → 'width=device-width, maximum-scale=1, user-scalable=no'   // same-key override, position kept
 *
 * @param content - the stock (or stock-equivalent) content string.
 * @param tokens - the directives to merge, keyed lowercase.
 * @returns the merged content string.
 */
export function mergeViewportTokens(content: string, tokens: Record<string, string>): string {
  var out = []
  var seen: Record<string, boolean> = {}
  var parts = content.split(',')
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i]
    var raw = (part === undefined ? '' : part).replace(/^\s+|\s+$/g, '')
    if (raw === '') continue
    var eq = raw.indexOf('=')
    var key = eq < 0 ? raw : raw.slice(0, eq).replace(/^\s+|\s+$/g, '')
    var hit = null
    for (var k in tokens) {
      if (tokens.hasOwnProperty(k) && k.toLowerCase() === key.toLowerCase()) { hit = k; break }
    }
    if (hit === null) { out[out.length] = raw; continue }
    out[out.length] = hit + '=' + tokens[hit]!
    seen[hit] = true
  }
  for (var j in tokens) {
    if (tokens.hasOwnProperty(j) && !seen[j]) out[out.length] = j + '=' + tokens[j]!
  }
  return out.join(', ')
}

/**
 * The double gate (design D2/D3 + the `zoomGuard` config): rewrite applies
 * only on an iOS-class browser AND a narrow viewport AND a non-`off`
 * `zoomGuard`. An absent payload (or absent key) means the `'meta'` default —
 * the same default-on posture as the mobile leg itself — so only an explicit
 * `'off'` disarms the guard. Unknown non-`off` values read as `'meta'`
 * (schema validation makes them unreachable in production; benign here).
 *
 * @param config - the `__DASHR_MOBILE__` payload (only `zoomGuard` is read).
 * @param isIOS - {@link isIOSClassUA} verdict for this page load.
 * @param isNarrow - `matchMedia('(max-width: breakpoint-0.02px)')` verdict.
 * @returns `true` when the viewport rewrite should be applied.
 */
export function shouldApplyZoomGuard(config: { zoomGuard?: string } | undefined, isIOS: boolean, isNarrow: boolean): boolean {
  if (!isIOS || !isNarrow) return false
  if (!config) return true
  return config.zoomGuard !== 'off'
}

/**
 * Build the boot script's zoomGuard section: the three decision predicates
 * embedded via `toString()` plus the DOM state machine that applies them.
 * The machine implements design D3/D4 with one discovered refinement —
 *
 * **Why reconciliation exists.** The webserver splices head injections
 * immediately after the opening `<head>` tag, i.e. BEFORE the stock
 * `<meta name="viewport">` in upstream's `index.html`. At boot-script time
 * the stock meta is therefore NOT yet parsed, so the "meta missing"
 * branch is the NORMAL path on the served shell, not an edge case. A
 * provisional meta is created right away (the timing requirement: the
 * suppressive tokens are live before any application bundle can focus an
 * input), and a MutationObserver watches for the parser to insert the stock
 * meta; the moment it appears, the guard records the true stock content,
 * rewrites the STOCK meta (token merge, D4's actual semantics — restore
 * later writes these exact bytes back), and removes the provisional one —
 * leaving a single-meta document instead of relying on engines'
 * unspecified multi-meta merge behavior. Engines without MutationObserver
 * keep the provisional meta for the page's lifetime (degraded but still
 * suppressive); the observer is never started once the stock meta was
 * found synchronously.
 *
 * State machine (ES5, zero dependencies, synchronous first evaluation):
 * `meta` is the element under management (provisional or reconciled stock),
 * `stock` its recorded stock content, `mine` whether we created it,
 * `applied` the last applied gate verdict. `apply(on)` is idempotent per
 * state (no-op when the verdict is unchanged); merges always re-derive
 * from the recorded stock, never from the live content, so resize storms
 * cannot accumulate tokens. Non-iOS pages never wire any listener.
 *
 * Emitted only when the mobile payload exists and `zoomGuard !== 'off'`.
 *
 * @returns the inline section text (truthy `var` declarations + IIFE).
 */
export function buildZoomGuardSection(): string {
  return [
    `var ZI=${isIOSClassUA.toString()};`,
    `var ZM=${mergeViewportTokens.toString()};`,
    `var ZS=${shouldApplyZoomGuard.toString()};`,
    '(function(){',
    'var m=window.__DASHR_MOBILE__;',
    'var ios=ZI(navigator.userAgent,(navigator.maxTouchPoints||0));',
    'if(!ios)return;',
    "var bp=((m&&typeof m.breakpoint==='number'&&m.breakpoint>0)?m.breakpoint:768)-0.02;",
    "var mq=(typeof window.matchMedia==='function')?window.matchMedia('(max-width:'+bp+'px)'):null;",
    "var T={'maximum-scale':'1','user-scalable':'no'};",
    'var meta=null,stock=null,mine=false,applied=false,obs=null;',
    "function findStock(){var s=document.getElementsByTagName('meta');for(var i=0;i<s.length;i++){var e=s[i];if(e!==meta&&(e.getAttribute('name')||'').toLowerCase()==='viewport')return e}return null}",
    "function headEl(){return document.head||document.getElementsByTagName('head')[0]||document.documentElement}",
    'function stopWatch(){if(obs){obs.disconnect();obs=null}}',
    "function dropMine(){if(meta&&mine){if(meta.parentNode)meta.parentNode.removeChild(meta);meta=null;mine=false}}",
    'function apply(on){',
    'if(on===applied)return;',
    'applied=on;',
    'if(on){',
    'var el=findStock();',
    "if(el){meta=el;mine=false;stock=el.getAttribute('content')||''}",
    "else if(!meta){meta=document.createElement('meta');meta.setAttribute('name','viewport');mine=true;stock='';headEl().appendChild(meta)}",
    "meta.setAttribute('content',ZM(stock,T));",
    "if(mine&&typeof MutationObserver==='function'&&!obs){obs=new MutationObserver(check);obs.observe(document.documentElement,{childList:true,subtree:true})}",
    '}else{',
    'stopWatch();',
    'if(!meta)return;',
    'if(mine)dropMine();',
    "else meta.setAttribute('content',stock);", // restore = exact stock bytes (D4)
    '}',
    '}',
    'function check(){',
    'var el=findStock();',
    'if(!el)return;',
    'stopWatch();',
    "stock=el.getAttribute('content')||'';",
    "if(applied){dropMine();meta=el;mine=false;meta.setAttribute('content',ZM(stock,T))}",
    'else{dropMine();meta=null;stock=null}',
    '}',
    'function re(){apply(ZS(m,true,mq?mq.matches:false))}',
    're();',
    "window.addEventListener('resize',re);",
    '})()',
  ].join('')
}

