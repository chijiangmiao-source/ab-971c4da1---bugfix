import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { solve } from '../src/solver.js'

// 在 jsdom 中引导真实的 src/main.js，用“真实求解器驱动”的 Worker 替身。
function boot() {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const { window } = dom
  const g = globalThis
  g.window = window
  g.document = window.document
  g.navigator = window.navigator
  g.HTMLElement = window.HTMLElement
  g.Event = window.Event
  g.MouseEvent = window.MouseEvent

  // Worker 替身：与 src/worker.js 相同的序列化，同步回传真实求解结果
  class FakeWorker {
    constructor() { this.onmessage = null; this.onerror = null }
    postMessage(msg) {
      const { id, input } = msg
      let payload
      try {
        const result = solve(input)
        payload = {
          id,
          ok: true,
          result: {
            ...result,
            ...(result.optimumCost !== undefined
              ? { optimumCost: result.optimumCost.toString(), optimumCount: result.optimumCount.toString() }
              : {}),
          },
        }
      } catch (e) {
        payload = { id, ok: false, message: String(e.message || e) }
      }
      this.onmessage({ data: payload })
    }
  }
  g.Worker = FakeWorker
  return dom
}

function fire(el, type) {
  el.dispatchEvent(new window.Event(type, { bubbles: true }))
}

let dom
test.before(async () => {
  dom = boot()
  await import('../src/main.js')
})

test('UI 端到端：唯一零代价补全场景——Worker 展示结果与求解器代码测试一致', () => {
  const $ = (id) => document.getElementById(id)

  // 清洁状态：4 细胞 × 3 突变（先清空再应用规模，避免上一个用例的草稿残留）
  $('clearAll').click()
  $('nRows').value = '4'
  $('nCols').value = '3'
  $('applySize').click()

  // M1、M2 的四个格子全部设为问号（默认全 0，M3 保持固定 0）
  const selects = [...$('grid').querySelectorAll('select.cell')]
  const setCell = (r, c, v) => {
    const sel = selects[r * 3 + c]
    sel.value = v
    fire(sel, 'change')
  }
  for (let r = 0; r < 4; r++) {
    setCell(r, 0, '?')
    setCell(r, 1, '?')
  }
  assert.equal($('unkCount').textContent, '8')

  // 代价：M1 仅 C1 偏好填 1（c0=1,c1=0）；其余 7 个问号偏好填 0（c0=0,c1=1）
  const costInput = (r, c, which) =>
    document.querySelector(`input.cost[data-r="${r}"][data-c="${c}"][data-which="${which}"]`)
  const setCost = (r, c, c0, c1) => {
    const i0 = costInput(r, c, 'c0'); i0.value = c0; fire(i0, 'input')
    const i1 = costInput(r, c, 'c1'); i1.value = c1; fire(i1, 'input')
  }
  setCost(0, 0, '1', '0')
  for (const [r, c] of [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]) setCost(r, c, '0', '1')

  $('solveBtn').click()

  // Worker 返回的展示结果：最优总代价 0、最优补全数 1
  assert.equal($('resultSection').classList.contains('hidden'), false)
  assert.equal($('optCost').textContent, '0')
  assert.equal($('optCount').textContent, '1')

  // 规范矩阵：M1 仅 C1 携带（固定 1），其余七个问号均为固定 0
  const cell = (r, c) => [...$('resultMatrix').querySelectorAll('tr')][r + 1].children[c + 1]
  assert.equal(cell(0, 0).textContent, '1')
  assert.ok(cell(0, 0).classList.contains('fixed1'))
  for (const [r, c] of [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]) {
    assert.equal(cell(r, c).textContent, '0', `格(${r},${c}) 应为 0`)
    assert.ok(cell(r, c).classList.contains('fixed0'), `格(${r},${c}) 应标为固定 0`)
  }

  // 克隆树：M1 载体为 C1；M2、M3 列入空突变说明
  const treeText = $('tree').textContent
  assert.match(treeText, /M1/)
  assert.match(treeText, /载体：C1/)
  assert.equal($('absentNote').classList.contains('hidden'), false)
  assert.match($('absentNote').textContent, /M2、M3/)

  // 可复算记录与求解器代码测试的期望完全一致
  const dump = JSON.parse($('jsonDump').textContent)
  assert.equal(dump.result.optimumCost, '0')
  assert.equal(dump.result.optimumCount, '1')
  assert.deepEqual(dump.result.matrix, [
    [1, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ])
  assert.equal(dump.result.calls.length, 8)
  const kind = (r, c) => dump.result.calls.find((x) => x.r === r && x.c === c).kind
  assert.equal(kind(0, 0), 'fixed1')
  for (const [r, c] of [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]) {
    assert.equal(kind(r, c), 'fixed0', `记录中格(${r},${c}) 应为固定 0`)
  }
  assert.deepEqual(dump.result.cloneTree.absentMutations, [1, 2])
})

test('UI 端到端：示例求解→计数/规范矩阵/可变标记/克隆树；编辑后旧结果立即失效；非法输入保留草稿', () => {
  const $ = (id) => document.getElementById(id)

  // —— 1. 载入歧义示例并求解 ——
  $('loadSample').click()
  // 问号数应为 4
  assert.equal($('unkCount').textContent, '4')
  $('solveBtn').click()

  // 结果区出现，指标正确（字符串形式，任意精度）
  assert.equal($('resultSection').classList.contains('hidden'), false)
  assert.equal($('optCost').textContent, '8')
  assert.equal($('optCount').textContent, '3')

  // 规范矩阵中的问号格裁决类
  const cell = (r, c) => [...$('resultMatrix').querySelectorAll('tr')][r + 1].children[c + 1]
  assert.ok(cell(0, 2).classList.contains('free'))
  assert.ok(cell(2, 2).classList.contains('free'))
  assert.ok(cell(1, 0).classList.contains('fixed1'))
  assert.ok(cell(3, 1).classList.contains('fixed0'))

  // 克隆树至少渲染根节点与若干子节点
  assert.ok($('tree').querySelectorAll('.treenode').length >= 2)
  // JSON 可复算记录包含输入与结果
  const dump = JSON.parse($('jsonDump').textContent)
  assert.equal(dump.result.optimumCount, '3')
  assert.equal(dump.input.matrix[0][2], -1)

  // —— 2. 改动一个固定值后，旧结果必须立即失效（不得用旧结果冒充） ——
  const firstSelect = $('grid').querySelectorAll('select.cell')[0]
  firstSelect.value = '1'
  fire(firstSelect, 'change')
  assert.equal($('resultSection').classList.contains('hidden'), true)

  // —— 3. 非法规模：保留草稿，不重建为错误规模 ——
  const rowsBefore = $('grid').querySelectorAll('tr').length
  $('nRows').value = '99'
  $('applySize').click()
  assert.equal($('errorBox').classList.contains('hidden'), false)
  assert.match($('errorBox').textContent, /4.*18|规模非法/)
  assert.equal($('grid').querySelectorAll('tr').length, rowsBefore, '草稿行未被破坏')
  $('nRows').value = '6'

  // —— 4. 冲突示例：展示突变对与三项见证 ——
  $('loadConflict').click()
  $('solveBtn').click()
  assert.equal($('resultSection').classList.contains('hidden'), true)
  assert.equal($('conflictBox').classList.contains('hidden'), false)
  const ctext = $('conflictBox').textContent
  assert.match(ctext, /M1\s*×\s*M2/)
  assert.match(ctext, /11 见证 C1/)
  assert.match(ctext, /10 见证 C2/)
  assert.match(ctext, /01 见证 C3/)

  // —— 5. 非法代价：拦截且不产生结果，草稿保留 ——
  $('loadSample').click()
  const costInput = document.querySelector('input.cost')
  costInput.value = 'abc'
  fire(costInput, 'input')
  $('solveBtn').click()
  assert.equal($('errorBox').classList.contains('hidden'), false)
  assert.match($('errorBox').textContent, /非负整数/)
  assert.equal($('resultSection').classList.contains('hidden'), true)
})
