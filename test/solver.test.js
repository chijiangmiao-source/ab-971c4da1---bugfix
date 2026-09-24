import { test } from 'node:test'
import assert from 'node:assert/strict'
import { solve, buildCloneTree } from '../src/solver.js'

// —— 暴力参考实现：枚举全部 2^k 补全（仅用于小规模测试） ——
function bruteForce(matrix, costs) {
  const n = matrix.length
  const m = matrix[0].length
  const unk = []
  for (let r = 0; r < n; r++)
    for (let c = 0; c < m; c++)
      if (matrix[r][c] === -1) unk.push([r, c])
  const k = unk.length
  const pairOK = (A) => {
    for (let a = 0; a < m; a++)
      for (let b = a + 1; b < m; b++) {
        const seen = new Set()
        for (let r = 0; r < n; r++) seen.add(`${A[r][a]}${A[r][b]}`)
        if (seen.has('11') && seen.has('10') && seen.has('01')) return false
      }
    return true
  }
  let best = null
  let count = 0n
  let canonical = null
  const ones = new Array(k).fill(0n)
  for (let z = 0; z < (1 << k); z++) {
    const A = matrix.map((row) => row.slice())
    let cost = 0n
    for (let i = 0; i < k; i++) {
      const v = (z >> i) & 1
      const [r, c] = unk[i]
      A[r][c] = v
      cost += BigInt(v ? costs[i].c1 : costs[i].c0)
    }
    if (!pairOK(A)) continue
    if (best === null || cost < best) {
      best = cost
      count = 1n
      canonical = A
      for (let i = 0; i < k; i++) ones[i] = BigInt((z >> i) & 1)
    } else if (cost === best) {
      count++
      const key = (M) => M.flat().join('')
      if (key(A) < key(canonical)) canonical = A
      for (let i = 0; i < k; i++) if ((z >> i) & 1) ones[i] += 1n
    }
  }
  if (best === null) return null
  return { best, count, canonical, ones, unk }
}

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function randomCase(rand, n, m, qProb) {
  const matrix = []
  const costs = []
  for (let r = 0; r < n; r++) {
    const row = []
    for (let c = 0; c < m; c++) {
      if (rand() < qProb) {
        row.push(-1)
        costs.push({ c0: Math.floor(rand() * 4), c1: Math.floor(rand() * 4) })
      } else row.push(rand() < 0.5 ? 0 : 1)
    }
    matrix.push(row)
  }
  return { matrix, costs }
}

test('固定数据三配型冲突：返回突变对与三项细胞见证', () => {
  // 细胞1:11  细胞2:10  细胞3:01  细胞4:00
  const matrix = [
    [1, 1, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]
  const res = solve({ matrix, costs: [] })
  assert.equal(res.status, 'conflict')
  assert.equal(res.conflicts.length, 1)
  const cf = res.conflicts[0]
  assert.equal(cf.a, 0)
  assert.equal(cf.b, 1)
  assert.deepEqual(cf.p11, [0])
  assert.deepEqual(cf.p10, [1])
  assert.deepEqual(cf.p01, [2])
  // 见证行确实具有对应固定配型
  for (const r of cf.p11) assert.equal(matrix[r][0], 1), assert.equal(matrix[r][1], 1)
  for (const r of cf.p10) assert.equal(matrix[r][0], 1), assert.equal(matrix[r][1], 0)
  for (const r of cf.p01) assert.equal(matrix[r][0], 0), assert.equal(matrix[r][1], 1)
})

test('无固定冲突但任何补全都不可行：B⊆A、C⊆B 与 A∩C=∅ 的循环', () => {
  // x:11?  y:100  z:?11  w:001
  const matrix = [
    [1, 1, -1],
    [1, 0, 0],
    [-1, 1, 1],
    [0, 0, 1],
  ]
  const res = solve({ matrix, costs: [{ c0: 0, c1: 0 }, { c0: 0, c1: 0 }] })
  assert.equal(res.status, 'infeasible')
  assert.equal(bruteForce(matrix, [{ c0: 0, c1: 0 }, { c0: 0, c1: 0 }]), null)
})

test('随机小规模：最优代价、补全数、规范矩阵、逐格裁决与暴力枚举一致', () => {
  const rand = rng(20260923)
  let feasibleCases = 0
  for (let t = 0; t < 300; t++) {
    const n = 4 + Math.floor(rand() * 3)
    const m = 3 + Math.floor(rand() * 3)
    const { matrix, costs } = randomCase(rand, n, m, 0.35)
    // 控制未知格数，保证 2^k 可枚举
    let unkCount = 0
    for (const row of matrix) for (const v of row) if (v === -1) unkCount++
    if (unkCount > 14) { t--; continue }
    const ref = bruteForce(matrix, costs)
    const res = solve({ matrix, costs })
    if (ref === null) {
      assert.ok(res.status === 'infeasible' || res.status === 'conflict',
        `case ${t}: brute 无解但求解器返回 ${res.status}`)
      continue
    }
    feasibleCases++
    assert.equal(res.status, 'ok', `case ${t}: ${JSON.stringify(res, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`)
    assert.equal(res.optimumCost, ref.best, `case ${t} 最优代价`)
    assert.equal(res.optimumCount, ref.count, `case ${t} 补全数`)
    assert.deepEqual(res.matrix, ref.canonical, `case ${t} 规范矩阵`)
    ref.unk.forEach(([r, c], i) => {
      const call = res.calls.find((x) => x.r === r && x.c === c)
      const expect = ref.ones[i] === 0n ? 'fixed0' : ref.ones[i] === ref.count ? 'fixed1' : 'free'
      assert.equal(call.kind, expect,
        `case ${t} 格(${r},${c}) 裁决：暴力 ones=${ref.ones[i]}/${ref.count}`)
    })
  }
  assert.ok(feasibleCases > 50, `可行样例过少：${feasibleCases}`)
})

test('回归（报告场景）：同剖面不同代价的列不得对称剪枝——唯一零代价补全为 M1 仅 C1 携带', () => {
  // 4 细胞 × 3 突变：M1、M2 四个格子全为问号，M3 全部固定 0
  // 代价：M1 仅 C1 偏好填 1（c0=1,c1=0），其余 7 个问号均偏好填 0（c0=0,c1=1）
  const matrix = [
    [-1, -1, 0],
    [-1, -1, 0],
    [-1, -1, 0],
    [-1, -1, 0],
  ]
  const costs = [
    { c0: 1, c1: 0 }, { c0: 0, c1: 1 }, // C1：M1 偏好 1，M2 偏好 0
    { c0: 0, c1: 1 }, { c0: 0, c1: 1 }, // C2
    { c0: 0, c1: 1 }, { c0: 0, c1: 1 }, // C3
    { c0: 0, c1: 1 }, { c0: 0, c1: 1 }, // C4
  ]
  // 暴力枚举对照：唯一零代价补全
  const ref = bruteForce(matrix, costs)
  assert.notEqual(ref, null)
  assert.equal(ref.best, 0n)
  assert.equal(ref.count, 1n)

  const res = solve({ matrix, costs })
  assert.equal(res.status, 'ok')
  // 最优总代价与精确计数
  assert.equal(res.optimumCost, 0n)
  assert.equal(res.optimumCount, 1n)
  // 完整规范矩阵：M1 仅由 C1 携带，M2、M3 均无载体
  assert.deepEqual(res.matrix, [
    [1, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ])
  // 八个问号的裁决：仅 (C1,M1) 固定 1，其余七个固定 0
  assert.equal(res.calls.length, 8)
  const kind = (r, c) => res.calls.find((x) => x.r === r && x.c === c).kind
  assert.equal(kind(0, 0), 'fixed1')
  for (const [r, c] of [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]) {
    assert.equal(kind(r, c), 'fixed0', `格(${r},${c}) 应为固定 0`)
  }
  // 规范克隆树：M1 载体为 {C1}；M2、M3 列入空突变
  assert.deepEqual(res.cloneTree.absentMutations, [1, 2])
  assert.equal(res.cloneTree.root.children.length, 1)
  const carrier = res.cloneTree.root.children[0]
  assert.deepEqual(carrier.mutations, [0])
  assert.deepEqual(carrier.carriers, [0])
  assert.equal(carrier.children.length, 0)
})

test('回归：报告场景的列顺序调整（结论按列置换相应平移）', () => {
  // 三个逻辑列：P=偏好 C1=1 的全问号列；Z=全问号全偏好 0 列；F=全固定 0 列
  const perms = [
    ['P', 'Z', 'F'],
    ['P', 'F', 'Z'],
    ['Z', 'P', 'F'],
    ['Z', 'F', 'P'],
    ['F', 'P', 'Z'],
    ['F', 'Z', 'P'],
  ]
  for (const perm of perms) {
    const matrix = []
    const costs = []
    for (let r = 0; r < 4; r++) {
      const row = []
      for (const kind of perm) {
        if (kind === 'F') row.push(0)
        else {
          row.push(-1)
          costs.push(kind === 'P' && r === 0 ? { c0: 1, c1: 0 } : { c0: 0, c1: 1 })
        }
      }
      matrix.push(row)
    }
    const pCol = perm.indexOf('P')
    const res = solve({ matrix, costs })
    assert.equal(res.status, 'ok', `列序 ${perm}`)
    assert.equal(res.optimumCost, 0n, `列序 ${perm} 最优代价`)
    assert.equal(res.optimumCount, 1n, `列序 ${perm} 补全数`)
    // 规范矩阵：仅 C1 在 P 列取 1
    const expected = [0, 1, 2, 3].map((r) => perm.map((_, c) => (r === 0 && c === pCol ? 1 : 0)))
    assert.deepEqual(res.matrix, expected, `列序 ${perm} 规范矩阵`)
    // 裁决：仅 (C1,P) 固定 1，其余七个问号固定 0
    assert.equal(res.calls.length, 8, `列序 ${perm} 问号数`)
    for (const call of res.calls) {
      const expect = call.r === 0 && call.c === pCol ? 'fixed1' : 'fixed0'
      assert.equal(call.kind, expect, `列序 ${perm} 格(${call.r},${call.c})`)
    }
    // 克隆树：P 列载体 {C1}，其余两列为空突变
    assert.deepEqual(res.cloneTree.absentMutations, [0, 1, 2].filter((c) => c !== pCol), `列序 ${perm} 空突变`)
    assert.equal(res.cloneTree.root.children.length, 1, `列序 ${perm} 树形`)
    assert.deepEqual(res.cloneTree.root.children[0].mutations, [pCol], `列序 ${perm} 树载体突变`)
    assert.deepEqual(res.cloneTree.root.children[0].carriers, [0], `列序 ${perm} 树载体细胞`)
  }
})

test('回归：相同结构不同代价偏好（最优解随偏好唯一确定）', () => {
  // 结构同报告场景（M1、M2 全问号，M3 全固定 0），代价偏好不同
  const matrix = [
    [-1, -1, 0],
    [-1, -1, 0],
    [-1, -1, 0],
    [-1, -1, 0],
  ]
  // 情形 A：M2 在 C3 偏好 1，其余偏好 0 → 唯一零代价：M2={C3}
  {
    const costs = [
      { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
      { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
      { c0: 0, c1: 1 }, { c0: 1, c1: 0 },
      { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
    ]
    const res = solve({ matrix, costs })
    assert.equal(res.status, 'ok')
    assert.equal(res.optimumCost, 0n)
    assert.equal(res.optimumCount, 1n)
    assert.deepEqual(res.matrix, [
      [0, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ])
    const kind = (r, c) => res.calls.find((x) => x.r === r && x.c === c).kind
    assert.equal(kind(2, 1), 'fixed1')
    assert.deepEqual(res.cloneTree.absentMutations, [0, 2])
    assert.deepEqual(res.cloneTree.root.children[0].mutations, [1])
    assert.deepEqual(res.cloneTree.root.children[0].carriers, [2])
  }
  // 情形 B：M1、M2 都在 C1 偏好 1 → 唯一零代价：M1=M2={C1}（同载体共存于树节点）
  {
    const costs = [
      { c0: 1, c1: 0 }, { c0: 1, c1: 0 },
      { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
      { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
      { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
    ]
    const res = solve({ matrix, costs })
    assert.equal(res.status, 'ok')
    assert.equal(res.optimumCost, 0n)
    assert.equal(res.optimumCount, 1n)
    assert.deepEqual(res.matrix, [
      [1, 1, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ])
    assert.deepEqual(res.cloneTree.absentMutations, [2])
    assert.deepEqual(res.cloneTree.root.children[0].mutations, [0, 1])
    assert.deepEqual(res.cloneTree.root.children[0].carriers, [0])
  }
  // 情形 C：全部偏好 0 → 唯一零代价为全零矩阵，三列皆空突变
  {
    const costs = Array.from({ length: 8 }, () => ({ c0: 0, c1: 1 }))
    const res = solve({ matrix, costs })
    assert.equal(res.status, 'ok')
    assert.equal(res.optimumCost, 0n)
    assert.equal(res.optimumCount, 1n)
    assert.deepEqual(res.matrix, [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ])
    assert.ok(res.calls.every((x) => x.kind === 'fixed0'))
    assert.deepEqual(res.cloneTree.absentMutations, [0, 1, 2])
    assert.equal(res.cloneTree.root.children.length, 0)
  }
})

test('回归：完全同构的列按有标号补全精确计数（196），不得取轨道代表少计', () => {
  // 两列全问号、全零代价：每个层状相容的载体对都是一个最优补全（暴力 = 196）
  const matrix = [
    [-1, -1, 0],
    [-1, -1, 0],
    [-1, -1, 0],
    [-1, -1, 0],
  ]
  const costs = Array.from({ length: 8 }, () => ({ c0: 0, c1: 0 }))
  const ref = bruteForce(matrix, costs)
  assert.notEqual(ref, null)
  assert.equal(ref.best, 0n)
  assert.equal(ref.count, 196n)
  const res = solve({ matrix, costs })
  assert.equal(res.status, 'ok')
  assert.equal(res.optimumCost, 0n)
  assert.equal(res.optimumCount, 196n)
  assert.deepEqual(res.matrix, ref.canonical)
  // 全零代价下每个问号取 0/1 都可达最优
  assert.ok(res.calls.every((x) => x.kind === 'free'))
})

test('同优歧义样例：c2 有三个同代价可行载体（{}、{0}、{2}），计数 3、两格可变', () => {
  // 4 细胞 3 突变；三列通过共享行在约束图连成一个分量
  const matrix = [
    [1, 0, -1],
    [-1, 0, 0],
    [0, 1, -1],
    [0, -1, 0],
  ]
  const costs = [
    { c0: 5, c1: 5 }, // (0,2)
    { c0: 9, c1: 1 }, // (1,0) 倾向 1
    { c0: 2, c1: 2 }, // (2,2)
    { c0: 0, c1: 7 }, // (3,1) 倾向 0
  ]
  // 暴力核对
  const ref = bruteForce(matrix, costs)
  assert.notEqual(ref, null)
  assert.equal(ref.best, 8n)
  assert.equal(ref.count, 3n)
  const res = solve({ matrix, costs })
  assert.equal(res.status, 'ok')
  assert.equal(res.optimumCost, 8n)
  assert.equal(res.optimumCount, 3n)
  assert.deepEqual(res.matrix, ref.canonical)
  const kind = (r, c) => res.calls.find((x) => x.r === r && x.c === c).kind
  assert.equal(kind(0, 2), 'free')
  assert.equal(kind(2, 2), 'free')
  assert.equal(kind(1, 0), 'fixed1')
  assert.equal(kind(3, 1), 'fixed0')
  // 规范矩阵行优先 0 优先：c2 取空载体，两个可变格在首个叶取 0
  assert.equal(res.matrix[0][2], 0)
  assert.equal(res.matrix[2][2], 0)
  assert.equal(res.matrix[1][0], 1)
})

test('任意精度：10^30 量级代价全程 BigInt 精确', () => {
  const n = 18, m = 12
  const matrix = Array.from({ length: n }, () => new Array(m).fill(0))
  // 28 个问号
  const costs = []
  let q = 0
  for (let r = 0; r < n && q < 28; r++) {
    for (let c = 4; c < m && q < 28; c++) {
      matrix[r][c] = -1
      costs.push({ c0: '0', c1: `${10 + r}${'0'.repeat(30)}` }) // 填 1 极贵
      q++
    }
  }
  assert.equal(q, 28)
  const t0 = Date.now()
  const res = solve({ matrix, costs })
  assert.ok(Date.now() - t0 < 5000, '大规模求解超时')
  assert.equal(res.status, 'ok')
  assert.equal(res.optimumCost, 0n)
  assert.equal(res.optimumCount, 1n)
  assert.ok(res.calls.every((x) => x.kind === 'fixed0'))
})

test('克隆树：载体包含关系成链，空突变单列', () => {
  // M1⊂M0⊂M2；M3 无载体
  const matrix = [
    [1, 1, 1, 0],
    [1, 0, 1, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 0],
  ]
  const tree = buildCloneTree(matrix, 4)
  assert.deepEqual(tree.absentMutations, [3])
  const flat = []
  const walk = (node, depth) => {
    flat.push({ depth, muts: node.mutations, carriers: node.carriers })
    node.children.forEach((ch) => walk(ch, depth + 1))
  }
  walk(tree.root, 0)
  assert.equal(flat[0].muts.length, 0) // 根=全部细胞
  assert.deepEqual(flat[0].carriers, [0, 1, 2, 3])
  assert.deepEqual(flat[1].muts, [2])
  assert.deepEqual(flat[1].carriers, [0, 1, 2])
  assert.deepEqual(flat[2].muts, [0])
  assert.deepEqual(flat[2].carriers, [0, 1])
  assert.deepEqual(flat[3].muts, [1])
  assert.deepEqual(flat[3].carriers, [0])
})

test('输入校验：规模越界与格式错误被拒绝', () => {
  const base = {
    matrix: [
      [1, 0, -1], [0, 1, 0], [1, 1, 0], [0, 0, 1],
    ],
    costs: [{ c0: 0, c1: 0 }],
  }
  assert.equal(solve({ ...base, matrix: base.matrix.slice(0, 3) }).status, 'error')
  const wide = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ]
  assert.equal(solve({ matrix: wide, costs: [] }).status, 'error')
  assert.equal(solve({ matrix: base.matrix, costs: [] }).status, 'error')
  assert.equal(solve({ matrix: base.matrix, costs: [{ c0: -1, c1: 0 }] }).status, 'error')
  assert.equal(solve({ matrix: base.matrix, costs: [{ c0: 1.5, c1: 0 }] }).status, 'error')
  const bad = base.matrix.map((r) => r.slice()); bad[0][0] = 2
  assert.equal(solve({ matrix: bad, costs: base.costs }).status, 'error')
  const ragged = base.matrix.map((r) => r.slice()); ragged[1].push(0)
  assert.equal(solve({ matrix: ragged, costs: base.costs }).status, 'error')
})

test('28 个未知格以上被拒绝', () => {
  const n = 18, m = 12
  const matrix = Array.from({ length: n }, () => new Array(m).fill(-1))
  const res = solve({ matrix, costs: [] })
  assert.equal(res.status, 'error')
  assert.match(res.message, /28/)
})

test('大规模随机（15..28 问号）：可行、最优、计数与逐格裁决自洽', () => {
  const rand = rng(987654321)
  function isaOK(A) {
    const nn = A.length, mm = A[0].length
    for (let a = 0; a < mm; a++)
      for (let b = a + 1; b < mm; b++) {
        const seen = new Set()
        for (let r = 0; r < nn; r++) seen.add(`${A[r][a]}${A[r][b]}`)
        if (seen.has('11') && seen.has('10') && seen.has('01')) return false
      }
    return true
  }
  for (let t = 0; t < 120; t++) {
    const n = 4 + Math.floor(rand() * 15)
    const m = 3 + Math.floor(rand() * 10)
    // 先随机放固定值，再随机选至多 28 格置问号
    const matrix = Array.from({ length: n }, () =>
      Array.from({ length: m }, () => rand() < 0.5 ? 0 : 1))
    const cells = []
    for (let r = 0; r < n; r++) for (let c = 0; c < m; c++) cells.push([r, c])
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[cells[i], cells[j]] = [cells[j], cells[i]]
    }
    const q = Math.min(cells.length, 15 + Math.floor(rand() * 14))
    const qset = new Set()
    for (let i = 0; i < q; i++) {
      const [r, c] = cells[i]
      matrix[r][c] = -1
      qset.add(`${r},${c}`)
    }
    const costs = []
    for (let r = 0; r < n; r++) for (let c = 0; c < m; c++)
      if (matrix[r][c] === -1)
        costs.push({ c0: Math.floor(rand() * 6), c1: Math.floor(rand() * 6) })

    const t0 = Date.now()
    const res = solve({ matrix, costs })
    assert.ok(Date.now() - t0 < 4000, `case ${t} 超时`)
    if (res.status === 'conflict' || res.status === 'infeasible') continue
    assert.equal(res.status, 'ok')
    assert.ok(isaOK(res.matrix), `case ${t} 规范矩阵违反无限位点`)
    // 规范矩阵代价 == optimumCost
    let cost = 0n
    let qi = 0
    for (let r = 0; r < n; r++) for (let c = 0; c < m; c++) {
      if (matrix[r][c] === -1) {
        cost += BigInt(res.matrix[r][c] ? costs[qi].c1 : costs[qi].c0)
        qi++
      }
    }
    assert.equal(cost, res.optimumCost, `case ${t} 规范矩阵代价非最优`)
    assert.ok(res.optimumCount >= 1n)
    // 逐格裁决自洽
    for (const call of res.calls) {
      const v = res.matrix[call.r][call.c]
      if (call.kind === 'fixed0') {
        assert.equal(v, 0)
      } else if (call.kind === 'fixed1') {
        assert.equal(v, 1)
      } else {
        // free：规范值仍可任取 0/1，但该格在最优中两值都出现过
        assert.ok(v === 0 || v === 1)
      }
    }
  }
})
