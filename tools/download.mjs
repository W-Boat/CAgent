/**
 * 通过本地 HTTP 代理 (CONNECT 隧道) 下载文件。
 * 用途：本机 curl / .NET 的 Schannel 凭据库异常，无法直接走代理做 TLS，
 *       而 Node 使用自带的 OpenSSL 与 CA 包，可以正常连通。
 *
 * 用法: node download.mjs <url> <dest>
 */
import http from "node:http"
import https from "node:https"
import tls from "node:tls"
import fs from "node:fs"
import path from "node:path"

const PROXY_HOST = process.env.DSH_PROXY_HOST || "127.0.0.1"
const PROXY_PORT = Number(process.env.DSH_PROXY_PORT || 7890)

const [, , url, dest] = process.argv
if (!url || !dest) {
  console.error("用法: node download.mjs <url> <dest>")
  process.exit(2)
}

function tunnel(host, port) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: PROXY_HOST,
      port: PROXY_PORT,
      method: "CONNECT",
      path: `${host}:${port}`,
      headers: { Host: `${host}:${port}` },
      timeout: 30000,
    })
    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`代理 CONNECT 失败: ${res.statusCode}`))
        return
      }
      resolve(socket)
    })
    req.on("timeout", () => {
      req.destroy(new Error("代理连接超时"))
    })
    req.on("error", reject)
    req.end()
  })
}

async function fetchToFile(target, outPath, hop = 0) {
  if (hop > 8) throw new Error("重定向次数过多")
  const u = new URL(target)
  const port = u.port ? Number(u.port) : 443
  const socket = await tunnel(u.hostname, port)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: u.hostname,
        port,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          "user-agent": "node-download/1.0",
          accept: "*/*",
        },
        createConnection: () =>
          tls.connect({ socket, servername: u.hostname }),
      },
      (res) => {
        const code = res.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          const next = new URL(res.headers.location, target).href
          res.resume()
          socket.destroy()
          fetchToFile(next, outPath, hop + 1).then(resolve, reject)
          return
        }
        if (code !== 200) {
          res.resume()
          socket.destroy()
          reject(new Error(`HTTP ${code} for ${target}`))
          return
        }
        const total = Number(res.headers["content-length"] || 0)
        let done = 0
        let lastTick = Date.now()
        fs.mkdirSync(path.dirname(outPath), { recursive: true })
        const out = fs.createWriteStream(outPath)
        res.on("data", (chunk) => {
          done += chunk.length
          const now = Date.now()
          if (now - lastTick > 2000) {
            lastTick = now
            const pct = total ? ((done / total) * 100).toFixed(1) + "%" : "?"
            process.stdout.write(
              `\r  ${(done / 1048576).toFixed(1)}MB / ${total ? (total / 1048576).toFixed(1) + "MB" : "?"} ${pct}   `,
            )
          }
        })
        res.pipe(out)
        out.on("finish", () => {
          process.stdout.write("\n")
          console.log(
            `[ok] ${outPath}  ${(done / 1048576).toFixed(1)} MB`,
          )
          resolve(outPath)
        })
        out.on("error", reject)
      },
    )
    req.on("error", reject)
    req.end()
  })
}

try {
  await fetchToFile(url, dest)
} catch (err) {
  console.error(`\n[失败] ${err.message}`)
  process.exit(1)
}