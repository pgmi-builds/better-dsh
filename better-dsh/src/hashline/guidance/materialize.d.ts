/** The presets shipped by the harness, each seeded with editable guidance. */
export declare const DEFAULT_PRESETS: readonly string[];
/**
 * The root README: the per-preset customization convention users see in the
 * plugin home.
 */
export declare const GUIDANCE_HOME_README = "# dsh-better-edit guidance\n\nEach agent preset has its own guidance directory here: `<preset>/<section>.md`.\nOn first boot the plugin seeds the shipped presets (`standard`, `code`,\n`minimal`, `cordis`) with the compiled defaults; existing files are never\noverwritten, so your edits survive.\n\nEach file is one tool section:\n\n- `read.md` -> `tool:read`\n- `edit.md` -> `tool:edit`\n- `undo_last_edit.md` -> `tool:undo_last_edit`\n\n## Customize\n\nEdit the `<section>.md` file for the preset and section you want to change \u2014\nthe file body IS the text the model reads for that section. Files are read once\nper agent at session-start, so edits apply to new sessions.\n\nAn optional YAML front-matter fence places the section at a custom position in\nthe assembled system prompt:\n\n    ---\n    order: 150\n    ---\n\n    <section text>\n\nA file without front-matter keeps the default order. A malformed fence (a\nmissing closing `---`, a non-integer `order`, an unknown key) makes the whole\nfile plain prose.\n\n## Fallback\n\nA preset with no directory here, or a missing section file, falls back to the\ncompiled defaults in the plugin bundle. To customize a preset that has no\nseeded directory, copy a seeded one to its name.\n";
export declare const GUIDANCE_HOME_README_ZH = "# dsh-better-edit \u6307\u5F15\n\n\u6BCF\u4E2A agent preset \u5728\u8FD9\u91CC\u90FD\u6709\u81EA\u5DF1\u7684\u6307\u5F15\u76EE\u5F55\uFF1A`<preset>/<section>.md`\u3002\u9996\u6B21\u542F\u52A8\u65F6\n\u63D2\u4EF6\u4F1A\u4E3A\u968F\u9644\u7684 preset\uFF08`standard`\u3001`code`\u3001`minimal`\u3001`cordis`\uFF09\u5199\u5165\u7F16\u8BD1\u5185\u7F6E\u7684\n\u9ED8\u8BA4\u5185\u5BB9\uFF1B\u5DF2\u6709\u6587\u4EF6\u7EDD\u4E0D\u88AB\u8986\u76D6\uFF0C\u56E0\u6B64\u4F60\u7684\u7F16\u8F91\u4F1A\u4FDD\u7559\u3002\n\n\u6BCF\u4E2A\u6587\u4EF6\u5BF9\u5E94\u4E00\u4E2A\u5DE5\u5177\u7247\u6BB5\uFF1A\n\n- `read.md` -> `tool:read`\n- `edit.md` -> `tool:edit`\n- `undo_last_edit.md` -> `tool:undo_last_edit`\n\n## \u81EA\u5B9A\u4E49\n\n\u7F16\u8F91\u4F60\u60F3\u4FEE\u6539\u7684 preset \u4E0E\u7247\u6BB5\u7684 `<section>.md` \u6587\u4EF6\u5373\u53EF\u2014\u2014\u6587\u4EF6\u6B63\u6587\u5C31\u662F\u8BE5\u7247\u6BB5\u5448\n\u73B0\u7ED9\u6A21\u578B\u7684\u6587\u672C\u3002\u6587\u4EF6\u5728 agent \u7684 session-start \u65F6\u8BFB\u53D6\u4E00\u6B21\uFF0C\u56E0\u6B64\u4FEE\u6539\u53EA\u5F71\u54CD\u65B0\u4F1A\u8BDD\u3002\n\n\u53EF\u4EE5\u7528\u53EF\u9009\u7684 YAML front-matter \u6805\u680F\u628A\u7247\u6BB5\u653E\u5230\u7EC4\u88C5\u540E\u7CFB\u7EDF\u63D0\u793A\u4E2D\u7684\u81EA\u5B9A\u4E49\u4F4D\u7F6E\uFF1A\n\n    ---\n    order: 150\n    ---\n\n    <\u7247\u6BB5\u6587\u672C>\n\n\u6CA1\u6709 front-matter \u7684\u6587\u4EF6\u4FDD\u6301\u9ED8\u8BA4\u987A\u5E8F\u3002\u683C\u5F0F\u9519\u8BEF\u7684\u6805\u680F\uFF08\u7F3A\u5C11\u6536\u5C3E `---`\u3001\u975E\u6574\u6570\n`order`\u3001\u672A\u77E5\u952E\uFF09\u4F1A\u8BA9\u6574\u4E2A\u6587\u4EF6\u9000\u5316\u4E3A\u7EAF\u6587\u672C\u3002\n\n## \u56DE\u9000\n\n\u8FD9\u91CC\u6CA1\u6709\u5BF9\u5E94\u76EE\u5F55\u7684 preset\u3001\u6216\u7F3A\u5931\u67D0\u4E2A\u7247\u6BB5\u6587\u4EF6\u65F6\uFF0C\u4F1A\u56DE\u9000\u5230\u63D2\u4EF6\u5305\u5185\u7684\u7F16\u8BD1\u5185\u7F6E\u9ED8\u8BA4\n\u503C\u3002\u8981\u81EA\u5B9A\u4E49\u6CA1\u6709\u79CD\u5B50\u76EE\u5F55\u7684 preset\uFF0C\u628A\u4E00\u4E2A\u79CD\u5B50\u76EE\u5F55\u590D\u5236\u6210\u5B83\u7684\u540D\u5B57\u5373\u53EF\u3002\n";
/**
 * Materialize per-preset guidance directories in the plugin home.
 *
 * For each of `DEFAULT_PRESETS` creates `<preset>/{read,edit,
 * undo_last_edit}.md` rendered from the compiled defaults (with order
 * front-matter), plus a root `README.md` documenting the convention.
 * Idempotent: a user-edited file survives repeated calls. A blank override file
 * (whitespace-only body, no fence) is re-seeded with the current compiled
 * default; malformed, non-blank, and deliberate-blank (valid-fence) files are
 * never touched. Custom preset directories present on disk are scanned the same
 * way but never fabricated. Missing directories are created on demand (shipped
 * presets only), and shipped files are written exclusively so two concurrent
 * first runs race safely.
 */
export declare function ensurePresetGuidance(homeDir: string): Promise<void>;
