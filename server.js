/**
 * 生产入口：代理 Next.js，并让所有 URL 自动携带分享参数 sharecode。
 *
 * 背景：托管网关要求「每一个请求」都带 ?sharecode=xxx —— 包括 /_next/static 下的
 * CSS、JS 以及 /api 接口。而 Next 生成的资源地址是裸路径，浏览器直接取会 403。
 * 另外网关只做校验、转发时会丢掉该参数，应用自身读不到，因此这里保留一个兜底值。
 *
 * 这里在出口处把参数补全：
 *   1. HTML 里所有 src/href 的内部路径追加 sharecode
 *   2. 注入一段脚本：客户端 fetch / XHR / 站内跳转自动带上 sharecode
 *   3. 站内链接改为整页跳转，避免客户端路由去拉不带参数的 chunk 而 403
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const INTERNAL_PORT = PORT + 2000;

/** 网关转发前会丢弃 sharecode，这里保留部署时拿到的分享码作为兜底 */
const DEFAULT_CODE = process.env.SHARECODE || '3CDX4V4DL4';
let cachedCode = '';

const nextBin = path.join(__dirname, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextBin, 'start', '-p', String(INTERNAL_PORT)], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(INTERNAL_PORT) },
});

child.on('exit', (code) => {
  console.error(`[proxy] next exited with code ${code}`);
  process.exit(code || 1);
});

/** 注入到 <head> 的补丁脚本 */
const PATCH_SCRIPT = `<script>(function(){try{
var code=new URLSearchParams(location.search).get('sharecode');
if(!code)return;
function add(u){try{
  var x=new URL(u,location.href);
  if(x.origin!==location.origin)return null;
  if(x.searchParams.get('sharecode')===code)return null;
  x.searchParams.set('sharecode',code);
  return x;
}catch(e){return null;}}
var of=window.fetch;
if(of){window.fetch=function(i,o){try{
  if(typeof i==='string'){var u=add(i);if(u)i=u.toString();}
  else if(i&&i.url){var u2=add(i.url);if(u2)i=new Request(u2.toString(),i);}
}catch(e){}return of.call(this,i,o);};}
var xo=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
  var a=[].slice.call(arguments);
  try{var x=add(String(u));if(x)a[1]=x.toString();}catch(e){}
  return xo.apply(this,a);};
document.addEventListener('click',function(e){
  if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
  var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
  if(!a||a.target==='_blank')return;
  var url;try{url=new URL(a.getAttribute('href'),location.href);}catch(err){return;}
  if(url.origin!==location.origin)return;
  var u=add(url.toString())||url;
  e.preventDefault();e.stopPropagation();
  location.assign(u.toString());
},true);
}catch(e){}})();</script>`;

/** 给内部路径补上 sharecode（相对/绝对同源路径都处理） */
function addCodeToPath(value, code) {
  if (!value) return value;
  if (value.startsWith('//') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value; // 外链、data: 等跳过
  if (value.startsWith('#')) return value;
  if (value.includes('sharecode=')) return value;
  const sep = value.includes('?') ? '&' : '?';
  return `${value}${sep}sharecode=${encodeURIComponent(code)}`;
}

function rewriteHtml(html, code) {
  if (!code) return html;
  let out = html.replace(/(\s(?:src|href)=")(\/(?!\/)[^"]*)(")/g, (_m, pre, url, post) => {
    return `${pre}${addCodeToPath(url, code)}${post}`;
  });
  out = out.replace(/<head([^>]*)>/i, (m) => `${m}${PATCH_SCRIPT}`);
  if (out === html) {
    out = PATCH_SCRIPT + html;
  }
  return out;
}

function extractCode(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const code = url.searchParams.get('sharecode');
    if (code) {
      cachedCode = code;
      return code;
    }
  } catch {
    /* ignore */
  }
  return cachedCode || DEFAULT_CODE;
}

const server = http.createServer((req, res) => {
  const code = extractCode(req);
  if (req.url && req.url.startsWith('/__diag')) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(
      JSON.stringify({
        url: req.url,
        resolvedCode: code,
        cachedCode,
        headers: req.headers,
      })
    );
    return;
  }
  const proxyReq = http.request(
    {
      host: '127.0.0.1',
      port: INTERNAL_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${INTERNAL_PORT}`,
        'accept-encoding': 'identity',
      },
    },
    (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      if (contentType.includes('text/html')) {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.push(c));
        proxyRes.on('end', () => {
          const html = rewriteHtml(Buffer.concat(chunks).toString('utf8'), code);
          const buf = Buffer.from(html, 'utf8');
          const headers = { ...proxyRes.headers };
          delete headers['content-length'];
          delete headers['content-encoding'];
          delete headers['transfer-encoding'];
          headers['content-length'] = String(buf.length);
          headers['cache-control'] = 'no-store';
          headers['x-proxy-code'] = code;
          res.writeHead(proxyRes.statusCode || 200, headers);
          res.end(buf);
        });
      } else {
        const headers = { ...proxyRes.headers };
        delete headers['content-length'];
        delete headers['transfer-encoding'];
        headers['x-proxy-code'] = code;
        res.writeHead(proxyRes.statusCode || 200, headers);
        proxyRes.pipe(res);
      }
    }
  );

  proxyReq.on('error', (err) => {
    console.error('[proxy] upstream error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    }
    res.end('upstream unavailable');
  });

  req.pipe(proxyReq);
});

// 等 Next 起来再监听，避免首屏 502
const deadline = Date.now() + 60000;
(function waitForNext() {
  const probe = http.get(
    { host: '127.0.0.1', port: INTERNAL_PORT, path: '/', timeout: 2000 },
    (r) => {
      r.resume();
      start();
    }
  );
  probe.on('error', retry);
  probe.on('timeout', () => {
    probe.destroy();
    retry();
  });
  function retry() {
    if (Date.now() > deadline) {
      console.error('[proxy] next did not start in time, starting anyway');
      return start();
    }
    setTimeout(waitForNext, 500);
  }
})();

let started = false;
function start() {
  if (started) return;
  started = true;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[proxy] listening on 0.0.0.0:${PORT} -> 127.0.0.1:${INTERNAL_PORT}`);
  });
}
