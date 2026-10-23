/**
 * dsh-memory-router —— 按工作区自动切换记忆策略。
 *
 * 两类工作区：
 *   日常（daily）：新会话自动注入「记忆索引 + 上下文文件清单」，约 300 token
 *   其他（开发）  ：零注入，靠 AGENTS.md 约定按需读取，不花一分 token
 *
 * 判定依据是会话的 cwd（context.agent.session.header.cwd），所以同一个 DSH 里
 * 开不同工作区的会话，行为自动不同，不需要手动切开关。
 *
 * 配置：<DSH_HOME>/memory-router.json（不存在则用内置默认）
 *   { "enabled": true, "daily": ["D:\\日常"], "maxContextFiles": 20 }
 *
 * 本文件只 import node: 内置模块，保持零运行时依赖。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'memory-router'
export const inject = ['systemPrompt']

const CONFIG_FILE = 'memory-router.json'
const INDEX_REL = path.join('07-记忆', '索引.md')
const DEFAULT_CONFIG = { enabled: true, daily: ['D:\\日常'], maxContextFiles: 20 }
const DEFAULT_DAILY = 'D:\\日常'
const MAX_INDEX_CHARS = 4000
const CACHE_TTL_MS = 4000
const SKIP_DIRS = new Set(['07-记忆', '99-归档', 'node_modules', '.git', '.obsidian', '.trash'])
/** AGENTS.md 由 DSH 自己注入，列进清单纯属重复。 */
const SKIP_FILES = new Set(['agents.md'])

/** 配置与注入文本的进程内缓存，避免每次装配都打磁盘。 */
let cachedConfig = null
let cachedConfigAt = 0
const memo = new Map()

function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  return path.join(os.homedir(), '.dsh')
}

/** 统一成小写、无尾斜杠的绝对路径，仅用于比较。 */
function norm(p) {
  if (typeof p !== 'string' || p === '') return ''
  let s = path.resolve(p)
  if (s.length > 3 && (s.endsWith('\\') || s.endsWith('/'))) s = s.slice(0, -1)
  return s.toLowerCase()
}

function loadConfig() {
  const file = path.join(dshHome(), CONFIG_FILE)
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const daily = Array.isArray(parsed.daily)
      ? parsed.daily.filter((x) => typeof x === 'string' && x.trim() !== '').slice(0, 20)
      : []
    const maxContextFiles = Number.isFinite(parsed.maxContextFiles)
      ? Math.max(0, Math.min(60, Math.floor(parsed.maxContextFiles)))
      : DEFAULT_CONFIG.maxContextFiles
    return {
      enabled: parsed.enabled !== false,
      daily: daily.length > 0 ? daily : DEFAULT_CONFIG.daily,
      maxContextFiles,
    }
  } catch {
    // 配置缺失或损坏 → 回默认，绝不能让插件整体失效
    return { ...DEFAULT_CONFIG, daily: [DEFAULT_DAILY] }
  }
}

function getConfig() {
  const now = Date.now()
  if (cachedConfig !== null && now - cachedConfigAt < CACHE_TTL_MS) return cachedConfig
  cachedConfig = loadConfig()
  cachedConfigAt = now
  return cachedConfig
}

/**
 * cwd 命中日常列表就返回【工作区根】的绝对路径，否则 null。
 * 返回根而非 cwd：在 `D:\日常\01-笔记` 里开会话，也应该读 `D:\日常\07-记忆\` 的索引。
 */
function findDailyRoot(cwd) {
  const config = getConfig()
  if (!config.enabled) return null
  const target = norm(cwd)
  if (target === '') return null
  for (const entry of config.daily) {
    const root = norm(entry)
    if (root === '') continue
    if (target === root || target.startsWith(root + path.sep)) return path.resolve(entry)
  }
  return null
}

function readIndex(root) {
  try {
    let text = readFileSync(path.join(root, INDEX_REL), 'utf8')
    if (text.trim() === '') return null
    // 索引文件自带一级标题，注入块里已有「## 记忆索引」，去掉免重复
    text = text.replace(/^\uFEFF?#[^\n]*\r?\n+/, '')
    return text.length > MAX_INDEX_CHARS ? `${text.slice(0, MAX_INDEX_CHARS)}\n…（索引过长，已截断）` : text
  } catch {
    return null
  }
}

/** 取 Markdown 的一级标题作说明，取不到就留空。只读前 1KB。 */
function titleOf(file) {
  try {
    const head = readFileSync(file, 'utf8').slice(0, 1024)
    const line = head.split(/\r?\n/).find((l) => l.trim().startsWith('# '))
    if (line) return line.replace(/^#+\s*/, '').trim().slice(0, 60)
  } catch {
    // 读不到就当无标题
  }
  return ''
}

function fmtDate(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function listContextFiles(root, max) {
  if (max <= 0) return []
  const found = []
  const walk = (dir, depth) => {
    if (depth > 2 || found.length >= max * 4) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= max * 4) return
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        walk(full, depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !SKIP_FILES.has(entry.name.toLowerCase())) {
        try {
          found.push({ rel: path.relative(root, full), title: titleOf(full), mtime: statSync(full).mtimeMs })
        } catch {
          // 单个文件失败不影响整体
        }
      }
    }
  }
  walk(root, 0)
  found.sort((a, b) => b.mtime - a.mtime)
  return found.slice(0, max)
}

function compose(root) {
  const config = getConfig()
  const parts = ['【记忆区 · 日常模式，自动加载】']

  const index = readIndex(root)
  parts.push(index !== null ? `## 记忆索引\n${index.trim()}` : '## 记忆索引\n本工作区还没有 `07-记忆\\索引.md`，需要时再创建。')

  const files = listContextFiles(root, config.maxContextFiles)
  if (files.length > 0) {
    const lines = files.map((f) => `- \`${f.rel}\` — ${f.title !== '' ? f.title : '（无标题）'}（${fmtDate(f.mtime)}）`)
    parts.push(`## 上下文文件\n${lines.join('\n')}`)
  }

  parts.push('> 索引里相关的条目再用 read 打开，无关的忽略。写记忆前先看 `07-记忆\\README.md`。')
  return parts.join('\n\n')
}

function textFor(cwd) {
  const key = norm(cwd)
  const now = Date.now()
  const hit = memo.get(key)
  if (hit !== undefined && now - hit.at < CACHE_TTL_MS) return hit.text
  let text = ''
  try {
    text = compose(cwd)
  } catch {
    text = ''
  }
  memo.set(key, { text, at: now })
  if (memo.size > 32) memo.clear()
  return text
}

export function apply(ctx) {
  ctx.effect(() => {
    try {
      return ctx.systemPrompt.context({
        name: 'memory-router:auto',
        order: 240,
        text: (context) => {
          try {
            const cwd = context?.agent?.session?.header?.cwd
            if (typeof cwd !== 'string' || cwd === '') return ''
            const root = findDailyRoot(cwd)
            if (root === null) return ''
            return textFor(root)
          } catch {
            return ''
          }
        },
      })
    } catch (error) {
      // 幂等保护：loader 重复装配时同名注册会抛 already registered
      if (error instanceof Error && error.message.includes('already registered')) {
        console.warn('[memory-router] memory-router:auto 已注册，跳过重复注册')
        return () => {}
      }
      throw error
    }
  }, 'dsh-memory-router: auto memory')
}

/** 供测试用：清空缓存。 */
export function __resetCacheForTest() {
  cachedConfig = null
  cachedConfigAt = 0
  memo.clear()
}
