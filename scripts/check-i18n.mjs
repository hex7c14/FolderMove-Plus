/**
 * 语言包一致性检查。
 *
 *   node scripts/check-i18n.mjs        # 或 pnpm i18n:check
 *
 * 以 `src/i18n/locales/zh-CN.json`（源语言）为基准，逐项对比其它语言包：
 *   - 缺 key   → 报错（运行时会回退中文，界面会中英混杂，必须补）
 *   - 多 key   → 警告（可能是源语言删过的残留）
 *   - 疑似未翻译（与中文原文完全一致且含中日文字符）→ 提示
 *
 * 复数形式按 i18next 规则处理：
 *   - zh-CN / zh-TW / ja-JP 只有 `_other`
 *   - en-US 需要 `_one` + `_other`
 * 因此「zh-CN 有 foo_other、en-US 有 foo_one」视为一致。
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const localeDir = join(here, "..", "src", "i18n", "locales");

const SOURCE = "zh-CN";
/** 只有单一复数形式的语言 */
const SINGLE_PLURAL = new Set(["zh-CN", "zh-TW", "ja-JP"]);
/** 目标语言不该出现中日韩汉字的语言（出现说明整段忘了翻） */
const NON_CJK = new Set(["en-US"]);

const PLURAL_RE = /_(zero|one|two|few|many|other)$/;

/** 复数 key 归一化：`foo_one` / `foo_other` → `foo` */
function normalizeKey(path) {
  const m = path.match(PLURAL_RE);
  return m ? path.slice(0, -m[0].length) : path;
}

function flatten(obj, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, path, out);
    } else {
      out.set(normalizeKey(path), value);
    }
  }
  return out;
}

function loadLocales() {
  const files = readdirSync(localeDir).filter((f) => f.endsWith(".json"));
  const map = new Map();
  for (const file of files) {
    const code = file.replace(/\.json$/, "");
    map.set(code, flatten(JSON.parse(readFileSync(join(localeDir, file), "utf8"))));
  }
  return map;
}

const locales = loadLocales();
const source = locales.get(SOURCE);

if (!source) {
  console.error(`✖ 找不到源语言包 ${SOURCE}.json`);
  process.exit(1);
}

let errors = 0;
let warnings = 0;

console.log(`源语言：${SOURCE}（${source.size} 条文案）\n`);

for (const [code, entries] of locales) {
  if (code === SOURCE) continue;

  const missing = [];
  const identical = [];

  for (const [key, sourceValue] of source) {
    if (!entries.has(key)) {
      missing.push(key);
      continue;
    }
    const value = entries.get(key);
    // 与中文原文一字不差，且原文含中日文字符 → 大概率忘了翻译
    if (value === sourceValue && /[\u3400-\u9fff\u3040-\u30ff]/.test(String(sourceValue))) {
      identical.push(key);
    }
  }

  const extra = [...entries.keys()].filter((k) => !source.has(k));

  // 非 CJK 语言里出现汉字 → 基本都是整段忘了翻译
  const untranslated = [];
  if (NON_CJK.has(code)) {
    for (const [key, value] of entries) {
      if (typeof value === "string" && /[\u3400-\u9fff]/.test(value)) {
        untranslated.push(key);
      }
    }
  }

  // en-US 之类需要复数形式的语言，检查是否漏了 _one
  const pluralIssues = [];
  if (!SINGLE_PLURAL.has(code)) {
    const raw = JSON.parse(readFileSync(join(localeDir, `${code}.json`), "utf8"));
    const rawKeys = new Set();
    (function walk(obj, prefix = "") {
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object") walk(v, path);
        else rawKeys.add(path);
      }
    })(raw);
    for (const key of rawKeys) {
      if (!key.endsWith("_other")) continue;
      const base = key.slice(0, -"_other".length);
      if (rawKeys.has(`${base}_one`)) continue;
      // 只有 count 变化的文案才需要 _one；这里保守地只提示
      pluralIssues.push(base);
    }
  }

  const ok = missing.length === 0;
  console.log(`${ok ? "✔" : "✖"} ${code}`);

  if (missing.length) {
    errors += missing.length;
    console.log(`   缺少 ${missing.length} 个 key：`);
    for (const k of missing.slice(0, 30)) console.log(`     - ${k}`);
    if (missing.length > 30) console.log(`     … 其余 ${missing.length - 30} 个省略`);
  }
  if (extra.length) {
    warnings += extra.length;
    console.log(`   多余 ${extra.length} 个 key（源语言已删除？）：${extra.slice(0, 10).join(", ")}`);
  }
  if (identical.length) {
    warnings += identical.length;
    console.log(`   与中文一致的条目 ${identical.length} 个（确认是否漏翻）：`);
    for (const k of identical.slice(0, 10)) console.log(`     - ${k}`);
  }
  if (untranslated.length) {
    warnings += untranslated.length;
    console.log(`   仍是中文的条目 ${untranslated.length} 个：${untranslated.slice(0, 10).join(", ")}`);
  }
  if (pluralIssues.length) {
    console.log(`   缺少 _one 复数形式的条目 ${pluralIssues.length} 个：${pluralIssues.slice(0, 10).join(", ")}`);
  }
  console.log("");
}

if (errors > 0) {
  console.error(`✖ 检查未通过：${errors} 个 key 缺失，${warnings} 条警告`);
  process.exit(1);
}
console.log(`✔ 检查通过（${warnings} 条警告）`);
