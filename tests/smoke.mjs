/**
 * dsh-memory-router 冒烟测试：node tests/smoke.mjs
 * 依赖 D:\日常 存在（真实工作区）。
 */
import assert from 'node:assert'

import { apply } from '../lib/index.js'

let captured = null
const ctx = {
  effect: (fn) => fn(),
  systemPrompt: {
    context: (options) => {
      captured = options
      return () => {}
    },
  },
}

apply(ctx)
assert.ok(captured !== null, '未注册 systemPrompt.context')

const run = (cwd) => captured.text({ agent: { session: { header: { cwd } } } })

assert.ok(run('D:\\日常').includes('记忆索引'), '日常模式应注入索引')
assert.ok(run('D:\\日常\\01-笔记').includes('记忆索引'), '子目录应回落到工作区根的索引')
assert.strictEqual(run('D:\\程序'), '', '开发工作区应零注入')
assert.strictEqual(run(undefined), '', '无 cwd 应零注入')
assert.ok(!run('D:\\日常').includes('AGENTS.md'), 'AGENTS.md 不应重复列进上下文清单')

console.log('smoke OK')
