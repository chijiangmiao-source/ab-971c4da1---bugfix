// verify 专用：对“固定歧义”与“固定冲突”两个样例做显式断言——
// 核对最优补全数、规范补全矩阵、问号裁决，以及冲突突变对与三项细胞见证。
// 全部通过则退出码 0，否则 1。
import { solve } from '../src/solver.js'

let failures = 0
function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`)
  } else {
    console.error(`  ✗ ${msg}`)
    failures++
  }
}

console.log('样例 A：固定歧义（同优可变）')
{
  const matrix = [
    [1, 0, -1],
    [-1, 0, 0],
    [0, 1, -1],
    [0, -1, 0],
  ]
  const costs = [
    { c0: 5, c1: 5 }, // (0,2)
    { c0: 9, c1: 1 }, // (1,0)
    { c0: 2, c1: 2 }, // (2,2)
    { c0: 0, c1: 7 }, // (3,1)
  ]
  const res = solve({ matrix, costs })
  assert(res.status === 'ok', `求解成功（实际：${res.status}）`)
  assert(res.optimumCost === 8n, `最优总代价 = 8（实际：${res.optimumCost}）`)
  assert(res.optimumCount === 3n, `最优补全数 = 3（实际：${res.optimumCount}）`)
  const expectedCanonical = [
    [1, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]
  assert(JSON.stringify(res.matrix) === JSON.stringify(expectedCanonical),
    `规范补全矩阵正确（实际：${JSON.stringify(res.matrix)}）`)
  const kind = (r, c) => res.calls.find((x) => x.r === r && x.c === c).kind
  assert(kind(0, 2) === 'free', '(0,2) 为同优可变')
  assert(kind(2, 2) === 'free', '(2,2) 为同优可变')
  assert(kind(1, 0) === 'fixed1', '(1,0) 为固定 1')
  assert(kind(3, 1) === 'fixed0', '(3,1) 为固定 0')
}

console.log('样例 B：固定数据三配型冲突')
{
  const matrix = [
    [1, 1, 0], // 11 见证
    [1, 0, 0], // 10 见证
    [0, 1, 1], // 01 见证
    [0, 0, 0],
  ]
  const res = solve({ matrix, costs: [] })
  assert(res.status === 'conflict', `识别为冲突（实际：${res.status}）`)
  assert(res.conflicts.length === 1, `冲突突变对数 = 1（实际：${res.conflicts.length}）`)
  const cf = res.conflicts[0]
  assert(cf.a === 0 && cf.b === 1, `冲突对为 M1 × M2（实际：M${cf.a + 1} × M${cf.b + 1}）`)
  assert(JSON.stringify(cf.p11) === JSON.stringify([0]), `11 见证 = C1（实际：${cf.p11.map((r) => r + 1)}）`)
  assert(JSON.stringify(cf.p10) === JSON.stringify([1]), `10 见证 = C2（实际：${cf.p10.map((r) => r + 1)}）`)
  assert(JSON.stringify(cf.p01) === JSON.stringify([2]), `01 见证 = C3（实际：${cf.p01.map((r) => r + 1)}）`)
}

console.log('样例 C：任意精度计数（不相交列上的对称代价 → 2^k）')
{
  const matrix = [
    [1, 0, -1],
    [0, 0, -1],
    [0, 1, -1],
    [0, 0, -1],
  ]
  const costs = Array.from({ length: 4 }, () => ({ c0: '0', c1: '0' }))
  const res = solve({ matrix, costs })
  assert(res.status === 'ok', `求解成功（实际：${res.status}）`)
  assert(res.optimumCount === 16n, `补全数 = 2^4 = 16（实际：${res.optimumCount}）`)
}

console.log('样例 D：唯一零代价带标签补全（同剖面列代价不同，回归对称剪枝缺陷）')
{
  // M1、M2 四个格子全问号，M3 全固定 0；M1 仅 C1 偏好填 1，其余偏好填 0
  const matrix = [
    [-1, -1, 0],
    [-1, -1, 0],
    [-1, -1, 0],
    [-1, -1, 0],
  ]
  const costs = [
    { c0: 1, c1: 0 }, { c0: 0, c1: 1 },
    { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
    { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
    { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
  ]
  const res = solve({ matrix, costs })
  assert(res.status === 'ok', `求解成功（实际：${res.status}）`)
  assert(res.optimumCost === 0n, `最优总代价 = 0（实际：${res.optimumCost}）`)
  assert(res.optimumCount === 1n, `最优补全数 = 1（实际：${res.optimumCount}）`)
  const expectedCanonical = [
    [1, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  assert(JSON.stringify(res.matrix) === JSON.stringify(expectedCanonical),
    `规范补全矩阵正确（实际：${JSON.stringify(res.matrix)}）`)
  const kind = (r, c) => res.calls.find((x) => x.r === r && x.c === c).kind
  assert(kind(0, 0) === 'fixed1', '(C1,M1) 为固定 1')
  for (const [r, c] of [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]) {
    assert(kind(r, c) === 'fixed0', `(C${r + 1},M${c + 1}) 为固定 0`)
  }
  assert(JSON.stringify(res.cloneTree.absentMutations) === JSON.stringify([1, 2]),
    `空突变为 M2、M3（实际：${res.cloneTree.absentMutations.map((c) => c + 1)}）`)
  const child = res.cloneTree.root.children[0]
  assert(!!child && JSON.stringify(child.mutations) === JSON.stringify([0]),
    `克隆树节点携带 M1（实际：${child ? child.mutations : '无节点'}）`)
  assert(!!child && JSON.stringify(child.carriers) === JSON.stringify([0]),
    `M1 载体仅 C1（实际：${child ? child.carriers.map((r) => r + 1) : '无节点'}）`)

  // 列顺序调整：P=偏好 C1=1 的列，Z=偏好 0 的列，F=全固定 0 列（6 种排列）
  for (const perm of [['P', 'Z', 'F'], ['P', 'F', 'Z'], ['Z', 'P', 'F'], ['Z', 'F', 'P'], ['F', 'P', 'Z'], ['F', 'Z', 'P']]) {
    const m2 = []
    const c2 = []
    for (let r = 0; r < 4; r++) {
      const row = []
      for (const k of perm) {
        if (k === 'F') row.push(0)
        else {
          row.push(-1)
          c2.push(k === 'P' && r === 0 ? { c0: 1, c1: 0 } : { c0: 0, c1: 1 })
        }
      }
      m2.push(row)
    }
    const pCol = perm.indexOf('P')
    const rr = solve({ matrix: m2, costs: c2 })
    assert(rr.optimumCost === 0n && rr.optimumCount === 1n, `列序 ${perm} 仍为唯一零代价`)
    assert(rr.matrix[0][pCol] === 1 && rr.matrix.flat().filter((v) => v === 1).length === 1,
      `列序 ${perm} 下 1 仅出现在 (C1,M${pCol + 1})`)
    assert(JSON.stringify(rr.cloneTree.root.children[0].mutations) === JSON.stringify([pCol]),
      `列序 ${perm} 克隆树载体随列置换平移`)
  }

  // 相同结构、不同代价偏好：零代价带标签解为 M2={C3}
  const alt = costs.map((p) => ({ ...p }))
  // 行优先第 6 个问号为 (C3,M2)
  alt[5] = { c0: 1, c1: 0 }
  // 恢复 (C1,M1) 为偏好 0（第 1 个问号）
  alt[0] = { c0: 0, c1: 1 }
  const r2 = solve({ matrix, costs: alt })
  assert(r2.optimumCost === 0n && r2.optimumCount === 1n, '不同偏好下仍为唯一零代价')
  assert(r2.matrix[2][1] === 1 && r2.matrix.flat().filter((v) => v === 1).length === 1,
    '不同偏好下 M2 仅由 C3 携带')
}

if (failures) {
  console.error(`\nverify 样例核对失败：${failures} 项`)
  process.exit(1)
}
console.log('\n全部 verify 样例核对通过。')
