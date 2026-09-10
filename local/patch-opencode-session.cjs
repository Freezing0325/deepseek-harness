// patch-opencode-session.cjs — 给 npm 版 DSH 的 pi-ai 适配层补上 x-opencode-session 头
//
// 背景：OpenCode Go（opencode.ai/zen/go）从 09/05 起要求推理请求带
//       `x-opencode-session`（值=每会话稳定 ID），缺头会报错。
//       DSH 源码版已修（my-custom 分支，packages/llm/llm-pi-ai/src/adapter.ts），
//       但 `deepseek tui` 走的是 npm 版 dsh（~/.dsh/profiles/dsh-tui + npm 全局 dsh），
//       用的是 npm 安装的 @deepseek-ai/dsh-llm-pi-ai 编译产物，需要单独补。
//
// 用法：
//   node patch-opencode-session.cjs            # 自动探测已知的两份副本
//   node patch-opencode-session.cjs <文件...>  # 指定目标文件
//
// 特性：幂等（已打过就跳过）；改动前留 <文件>.bak-opencode-session-<时间戳>；
//       锚点找不到或数量异常时报错退出，绝不做半截改动。
// 注意：`npm update -g @deepseek-ai/dsh` 会覆盖这两份产物 —— 升级后重跑本脚本即可。

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

/** 已知的 pi-ai 适配层编译产物位置（存在才会处理）。 */
function defaultTargets() {
  const candidates = [
    // 1) npm 全局 dsh 内嵌的副本
    process.env.APPDATA
      && path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh',
        'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js'),
    // 2) profile 共享副本（npm 版 dsh 加载插件时实际解析到的那份）
    path.join(os.homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai',
      'dsh-llm-pi-ai', 'lib', 'index.js'),
  ].filter(Boolean)
  return candidates.filter(file => fs.existsSync(file))
}

/** 插入到 requestHeaders 之后、适配器类文档之前。 */
const ANCHOR_CLASS_DOC = '/**\n* pi-ai-backed multi-provider adapter.'
/** 编译产物里唯一的 headers 组装调用点。 */
const ANCHOR_CALL_SITE = 'headers: requestHeaders(profile.headers)'

const HELPER_BLOCK = [
  '/** Header carrying the per-conversation session for providers that route by it. */',
  'const OPENCODE_SESSION_HEADER = "x-opencode-session";',
  'const SESSION_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;',
  'function normalizeSessionId(sessionId) {',
  '\treturn SESSION_UUID_PATTERN.exec(sessionId)?.[0] ?? sessionId;',
  '}',
  'function opencodeSessionHeader(provider, sessionId) {',
  '\tif (sessionId === void 0 || !provider.startsWith("opencode")) return {};',
  '\treturn { [OPENCODE_SESSION_HEADER]: normalizeSessionId(sessionId) };',
  '}',
  '',
].join('\n')

/** 按调用点所在行的缩进，生成运行时优先（覆盖静态 headers 项）的合并写法。 */
function callSiteReplacement(indent) {
  const inner = `${indent}\t`
  return [
    'headers: {',
    `${inner}...requestHeaders(profile.headers),`,
    `${inner}...opencodeSessionHeader(options.provider, options.sessionId === void 0 ? void 0 : String(options.sessionId))`,
    `${indent}}`,
  ].join('\n')
}

function countOccurrences(text, needle) {
  let count = 0
  let index = text.indexOf(needle)
  while (index !== -1) {
    count += 1
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}

function patchFile(file) {
  const source = fs.readFileSync(file, 'utf8')
  if (source.includes('x-opencode-session')) {
    return 'already patched (skipped)'
  }
  if (countOccurrences(source, ANCHOR_CLASS_DOC) !== 1) {
    throw new Error(`class-doc anchor found ${countOccurrences(source, ANCHOR_CLASS_DOC)} times (expected 1)`)
  }
  if (countOccurrences(source, ANCHOR_CALL_SITE) !== 1) {
    throw new Error(`call-site anchor found ${countOccurrences(source, ANCHOR_CALL_SITE)} times (expected 1)`)
  }

  const callIndex = source.indexOf(ANCHOR_CALL_SITE)
  const lineStart = source.lastIndexOf('\n', callIndex) + 1
  const indent = /^[\t ]*/.exec(source.slice(lineStart, callIndex))[0]

  const patched = source
    .replace(ANCHOR_CLASS_DOC, `${HELPER_BLOCK}${ANCHOR_CLASS_DOC}`)
    .replace(ANCHOR_CALL_SITE, callSiteReplacement(indent))

  const backup = `${file}.bak-opencode-session-${Date.now()}`
  fs.copyFileSync(file, backup)
  fs.writeFileSync(file, patched)
  return `patched (backup: ${path.basename(backup)})`
}

/**
 * Assert the deployed bytes behave: the helper block is extracted back out of
 * the patched file and exercised, so the check covers what actually ships
 * rather than what this script meant to write.
 * @param file - patched `lib/index.js`.
 * @returns a one-line summary of the passing cases.
 */
function verifyFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  const start = text.indexOf('/** Header carrying the per-conversation session')
  const fnStart = text.indexOf('function opencodeSessionHeader(provider, sessionId) {', start)
  if (start === -1 || fnStart === -1) throw new Error('deployed helper block not found')
  const block = text.slice(start, text.indexOf('\n}', fnStart) + 2)
  // 取自本脚本写入的常量块（非外部输入），仅用于行为自检。
  const opencodeSessionHeader = new Function(`${block}; return opencodeSessionHeader;`)()
  const cases = [
    ['opencode-go', 'session-11111111-2222-3333-4444-555555555555', '11111111-2222-3333-4444-555555555555'],
    ['opencode-go-messages', 'plain-probe-id', 'plain-probe-id'],
    ['deepseek', 'session-11111111-2222-3333-4444-555555555555', undefined],
    ['opencode-go', undefined, undefined],
  ]
  for (const [provider, sessionId, expected] of cases) {
    const sent = opencodeSessionHeader(provider, sessionId)['x-opencode-session']
    if (sent !== expected) {
      throw new Error(`provider=${provider} session=${sessionId ?? '(none)'} -> ${sent ?? '(none)'},`
        + ` expected ${expected ?? '(none)'}`)
    }
  }
  return `${cases.length} behavior case(s) pass`
}

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultTargets()
if (targets.length === 0) {
  console.error('patch-opencode-session: no target found; pass the lib/index.js paths explicitly')
  process.exit(1)
}

let failures = 0
for (const file of targets) {
  console.log(`${path.basename(path.dirname(path.dirname(file)))} @ ${file}`)
  try {
    console.log(`  patch:  ${patchFile(file)}`)
  } catch (error) {
    failures += 1
    console.error(`  patch:  FAILED: ${error.message}`)
    continue
  }
  try {
    console.log(`  verify: ${verifyFile(file)}`)
  } catch (error) {
    failures += 1
    console.error(`  verify: FAILED: ${error.message}`)
  }
}
process.exit(failures === 0 ? 0 : 1)
