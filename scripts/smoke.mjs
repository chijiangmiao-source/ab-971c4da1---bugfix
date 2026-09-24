// HTTP 冒烟：启动生产服务器（HOST_PORT 可配置，默认随机端口），
// 核对 /healthz 与首页，随后关闭。供 verify 一次性服务与本地使用。
import { spawn } from 'node:child_process'
import http from 'node:http'

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
      // Worker 中应包含求解器痕迹（层状 DP 等中文/关键字由压缩保留性差，改为检查可执行 JS 非空）
      check('Worker chunk 非空且为 JS', wr.body.length > 100)

      // 功能性核对：以假 self 执行生产 Worker，求解“唯一零代价带标签补全”场景，
      // 展示结果必须与求解器代码测试一致（代价 0 / 计数 1 / M1 仅 C1 携带）
      const scenario = {
        matrix: [
          [-1, -1, 0],
          [-1, -1, 0],
          [-1, -1, 0],
          [-1, -1, 0],
        ],
        costs: [
          { c0: 1, c1: 0 }, { c0: 0, c1: 1 },
          { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
          { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
          { c0: 0, c1: 1 }, { c0: 0, c1: 1 },
        ],
      }
      const posted = []
      const fakeSelf = { postMessage: (m) => posted.push(m) }
      try {
        new Function('self', wr.body)(fakeSelf)
        fakeSelf.onmessage({ data: { id: 1, input: scenario } })
      } catch (e) {
        check('Worker chunk 可执行并响应消息', false, String(e && e.message || e))
        continue
      }
      const out = posted.find((m) => m.id === 1)
      check('Worker 返回求解响应', !!out && out.ok === true, out && !out.ok ? out.message : '')
      if (out && out.ok) {
        const res = out.result
        check('Worker 最优总代价 = 0', res.optimumCost === '0', `实际 ${res.optimumCost}`)
        check('Worker 最优补全数 = 1', res.optimumCount === '1', `实际 ${res.optimumCount}`)
        check('Worker 规范矩阵为 M1 仅 C1 携带',
          JSON.stringify(res.matrix) === JSON.stringify([[1, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]),
          JSON.stringify(res.matrix))
        const kind = (rr, cc) => (res.calls.find((x) => x.r === rr && x.c === cc) || {}).kind
        check('Worker 裁决：(C1,M1) 固定 1、其余七个问号固定 0',
          kind(0, 0) === 'fixed1' &&
          [[0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]].every(([a, b]) => kind(a, b) === 'fixed0'))
        check('Worker 克隆树：M1 载体 C1，M2/M3 为空突变',
          JSON.stringify(res.cloneTree.absentMutations) === '[1,2]' &&
          JSON.stringify(res.cloneTree.root.children[0].mutations) === '[0]' &&
          JSON.stringify(res.cloneTree.root.children[0].carriers) === '[0]')
      }
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
