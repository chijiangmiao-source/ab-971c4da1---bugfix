// HTTP 冒烟：启动生产服务器（HOST_PORT 可配置，默认随机端口），
// 核对 /healthz 与首页；并直接执行 HTTP 取回的 Web Worker 构建产物，
// 发求解消息核对展示结果（最优代价/计数/规范矩阵/裁决/克隆树），随后关闭。
import { spawn } from 'node:child_process'
import http from 'node:http'
import vm from 'node:vm'

const PORT = Number(process.env.SMOKE_PORT || 0) || 0
const baseEnv = { ...process.env }

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.setTimeout(5000, () => req.destroy(new Error('timeout')))
  })
}

const server = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...baseEnv, HOST_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let loggedPort = PORT
server.stdout.on('data', (d) => {
  const m = String(d).match(/listening on http:\/\/[^:]+:(\d+)/)
  if (m) loggedPort = Number(m[1])
  process.stdout.write('[server] ' + d)
})
server.stderr.on('data', (d) => process.stderr.write('[server] ' + d))

let failures = 0
function check(name, cond, detail = '') {
  if (cond) console.log(`  ✓ ${name}`)
  else { console.log(`  ✗ ${name} ${detail}`); failures++ }
}

async function waitForHealth(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await get(`http://127.0.0.1:${loggedPort}/healthz`)
      if (r.status === 200 && /ok/.test(r.body)) return true
    } catch { /* 重试 */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

// 直接执行 HTTP 取回的 Worker 构建产物（自包含 IIFE），向其 postMessage
// 求解场景，核对回传结果与代码测试一致——即页面 Worker 实际展示的结果。
function runWorkerBundle(code, input) {
  let reply = null
  const sandbox = {
    self: {
      postMessage(msg) { reply = msg },
      set onmessage(fn) { this._onmessage = fn },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: 'worker-bundle.js' })
  sandbox.self._onmessage({ data: { id: 1, input } })
  return reply
}

async function checkWorkerResult(code, asset) {
  // 带标签零代价补全场景：4 细胞 × 3 突变，前两列 8 个问号，第三列固定 0。
  const input = {
    matrix: [
      [-1, -1, 0],
      [-1, -1, 0],
      [-1, -1, 0],
      [-1, -1, 0],
    ],
    // 行优先问号序：(0,0)(0,1)(1,0)(1,1)(2,0)(2,1)(3,0)(3,1)
    costs: [
      { c0: 1, c1: 0 },
      { c0: 0, c1: 1 },
      { c0: 0, c1: 1 },
      { c0: 0, c1: 1 },
      { c0: 0, c1: 1 },
      { c0: 0, c1: 1 },
      { c0: 0, c1: 1 },
      { c0: 0, c1: 1 },
    ],
  }
  let out
  try {
    out = runWorkerBundle(code, input)
  } catch (e) {
    check(`${asset} Worker 产物可执行并求解`, false, String(e && e.message || e))
    return
  }
  const tag = `${asset} Worker 求解结果`
  check(`${tag}：成功回传`, !!out && out.ok === true, JSON.stringify(out && out.message))
  if (!out || !out.ok) return
  const res = out.result
  // Worker 将 BigInt 序列化为十进制字符串，页面直接展示
  check(`${tag}：最优总代价展示为 0`, res.optimumCost === '0', `实际 ${res.optimumCost}`)
  check(`${tag}：最优补全数展示为 1`, res.optimumCount === '1', `实际 ${res.optimumCount}`)
  check(`${tag}：规范矩阵 M1 仅 C1 携带`, JSON.stringify(res.matrix) === JSON.stringify([
    [1, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  ]), JSON.stringify(res.matrix))
  const kind = (r, c) => (res.calls.find((x) => x.r === r && x.c === c) || {}).kind
  check(`${tag}：八格裁决 1×fixed1 + 7×fixed0`,
    kind(0, 0) === 'fixed1' &&
      [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]].every(([r, c]) => kind(r, c) === 'fixed0'),
    JSON.stringify(res.calls))
  const leaf = res.cloneTree && res.cloneTree.root && res.cloneTree.root.children[0]
  check(`${tag}：克隆树 M1 载体仅 C1，空突变为 M2/M3`,
    !!leaf && JSON.stringify(leaf.mutations) === '[0]' && JSON.stringify(leaf.carriers) === '[0]' &&
      JSON.stringify(res.cloneTree.absentMutations) === '[1,2]',
    JSON.stringify(res.cloneTree))
}

try {
  if (!(await waitForHealth(Date.now() + 8000))) {
    console.error('服务器未能在 8s 内就绪')
    process.exit(1)
  }
  const h = await get(`http://127.0.0.1:${loggedPort}/healthz`)
  check('健康路径 /healthz 返回 200 与 ok', h.status === 200 && JSON.parse(h.body).status === 'ok')

  const index = await get(`http://127.0.0.1:${loggedPort}/`)
  check('首页 / 返回 200', index.status === 200, `status=${index.status}`)
  check('首页包含应用标题与模块入口', /完美谱系补全/.test(index.body) && /\/src\/main\.js|assets\/.*\.js/.test(index.body),
    'missing title or entry')
  check('首页引用了样式表', /style\.css|assets\/.*\.css/.test(index.body))

  // HTML 中引用的全部本地资源（脚本/样式，支持 ./ 与 / 前缀）
  const refs = [...index.body.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => {
    let p = m[1]
    if (p.startsWith('./')) p = p.slice(1)
    if (!p.startsWith('/')) p = '/' + p
    return p
  })
  const jsAssets = refs.filter((p) => p.endsWith('.js'))
  const cssAssets = refs.filter((p) => p.endsWith('.css'))
  check('首页引用了至少一个 JS 与 CSS 资源', jsAssets.length >= 1 && cssAssets.length >= 1,
    `js=${jsAssets.length} css=${cssAssets.length}`)
  for (const asset of refs) {
    const r = await get(`http://127.0.0.1:${loggedPort}${asset}`)
    check(`资源可访问：${asset.split('/').pop()}`, r.status === 200, `status=${r.status}`)
  }

  // 入口 JS 中以 Vite worker chunk 形式引用的 Worker 文件
  for (const asset of jsAssets) {
    const r = await get(`http://127.0.0.1:${loggedPort}${asset}`)
    const workers = [...r.body.matchAll(/new URL\(["'`](\.?\/?)?(worker-[^"'`]+\.js)["'`]/g)].map((m) => '/assets/' + m[2])
    for (const w of workers) {
      const wr = await get(`http://127.0.0.1:${loggedPort}${w}`)
      check(`Web Worker chunk 可访问：${w.split('/').pop()}`, wr.status === 200, `status=${wr.status}`)
      check('Worker chunk 非空且为 JS', wr.body.length > 100)
      await checkWorkerResult(wr.body, w)
    }
  }

  const traversal = await get(`http://127.0.0.1:${loggedPort}/../package.json`)
  check('路径穿越被拒（403 或规范化后不泄露源码）', traversal.status === 403 || !/solver/.test(traversal.body))
} catch (e) {
  console.error('冒烟异常：', e)
  failures++
} finally {
  server.kill('SIGTERM')
}

setTimeout(() => process.exit(failures ? 1 : 0), 300)
