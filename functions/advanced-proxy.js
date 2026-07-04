export async function onRequest({ request }) {
  try {
    const targetUrl = getTargetUrl(request.url);

    if (!targetUrl) {
      return new Response('缺少目标URL参数', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
      });
    }

    const parsedTargetUrl = new URL(targetUrl);
    const requestUrl = new URL(request.url);
    const proxyBase = `${requestUrl.protocol}//${requestUrl.host}/advanced-proxy?url=`;

    console.log(`高级代理请求: ${targetUrl}`);

    const headers = new Headers();
    const forwardHeaders = [
      'user-agent',
      'accept',
      'accept-language',
      'content-type',
      'cache-control'
    ];

    forwardHeaders.forEach(header => {
      const value = request.headers.get(header);

      if (value) {
        headers.set(header, value);
      }
    });

    const targetRequest = new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.blob() : undefined,
      redirect: 'follow',
    });

    const response = await fetch(targetRequest);
    const responseHeaders = buildResponseHeaders(response.headers);
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      const html = rewriteHtml(await response.text(), parsedTargetUrl, proxyBase);

      responseHeaders.set('Content-Type', 'text/html; charset=UTF-8');

      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    if (contentType.includes('text/css')) {
      const css = rewriteCss(await response.text(), parsedTargetUrl, proxyBase);

      responseHeaders.set('Content-Type', 'text/css; charset=UTF-8');

      return new Response(css, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }

    return new Response(await response.arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    console.error(`代理请求失败: ${error.message}`);

    return new Response(`代理请求失败: ${error.message}`, {
      status: 500,
      headers: {
        'Content-Type': 'text/plain; charset=UTF-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

function buildResponseHeaders(headers) {
  const responseHeaders = new Headers();
  const blockedHeaders = [
    'content-encoding',
    'content-length',
    'connection',
    'transfer-encoding',
    'content-security-policy',
    'content-security-policy-report-only',
    'x-frame-options',
    'strict-transport-security',
    'report-to',
    'nel'
  ];

  for (const [key, value] of headers.entries()) {
    if (!blockedHeaders.includes(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }

  responseHeaders.set('Access-Control-Allow-Origin', '*');
  responseHeaders.set('X-Proxied-By', 'EdgeOne-Pages-Advanced-Proxy');

  return responseHeaders;
}

function getTargetUrl(requestUrl) {
  const { search } = new URL(requestUrl);
  const match = search.match(/[?&]url=/);

  if (!match) {
    return null;
  }

  const targetUrl = search.slice(match.index + match[0].length);

  if (/^https?%3A%2F%2F/i.test(targetUrl)) {
    try {
      return decodeURIComponent(targetUrl);
    } catch (error) {
      return targetUrl;
    }
  }

  return targetUrl.replace(/%23/gi, '#');
}

function rewriteHtml(html, baseUrl, proxyBase) {
  let rewritten = html;

  rewritten = rewritten.replace(/\s(integrity|nonce)=(['"])[\s\S]*?\2/gi, '');

  rewritten = rewritten.replace(/\s(href|src|action|poster|data-src|data-href)=(['"])([^'"]*)\2/gi, (match, attr, quote, value) => {
    const proxiedUrl = toProxyUrl(value, baseUrl, proxyBase);

    if (!proxiedUrl) {
      return match;
    }

    return ` ${attr}=${quote}${proxiedUrl}${quote}`;
  });

  rewritten = rewritten.replace(/\s(srcset|data-srcset)=(['"])([^'"]*)\2/gi, (match, attr, quote, value) => {
    const proxiedSrcset = rewriteSrcset(value, baseUrl, proxyBase);

    if (!proxiedSrcset) {
      return match;
    }

    return ` ${attr}=${quote}${proxiedSrcset}${quote}`;
  });

  rewritten = rewritten.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
    return `<style${attrs}>${rewriteCss(css, baseUrl, proxyBase)}</style>`;
  });

  rewritten = rewritten.replace(/<meta\s+([^>]*http-equiv=(['"])refresh\2[^>]*)>/gi, (match, attrs) => {
    return match.replace(/content=(['"])([^'"]*)\1/i, (contentMatch, quote, value) => {
      const rewrittenContent = value.replace(/url=([^;]+)/i, (urlMatch, url) => {
        const proxiedUrl = toProxyUrl(url.trim(), baseUrl, proxyBase);
        return proxiedUrl ? `url=${proxiedUrl}` : urlMatch;
      });

      return `content=${quote}${rewrittenContent}${quote}`;
    });
  });

  return rewritten;
}

function rewriteCss(css, baseUrl, proxyBase) {
  let rewritten = css;

  rewritten = rewritten.replace(/url\((['"]?)([^)'"]+)(['"]?)\)/gi, (match, openQuote, value, closeQuote) => {
    const proxiedUrl = toProxyUrl(value.trim(), baseUrl, proxyBase);

    if (!proxiedUrl) {
      return match;
    }

    return `url(${openQuote}${proxiedUrl}${closeQuote})`;
  });

  rewritten = rewritten.replace(/@import\s+(?:url\()?(['"])([^'"]+)\1\)?/gi, (match, quote, value) => {
    const proxiedUrl = toProxyUrl(value.trim(), baseUrl, proxyBase);

    if (!proxiedUrl) {
      return match;
    }

    return `@import ${quote}${proxiedUrl}${quote}`;
  });

  return rewritten;
}

function rewriteSrcset(srcset, baseUrl, proxyBase) {
  return srcset.split(',').map(item => {
    const trimmed = item.trim();

    if (!trimmed) {
      return trimmed;
    }

    const parts = trimmed.split(/\s+/);
    const proxiedUrl = toProxyUrl(parts[0], baseUrl, proxyBase);

    if (!proxiedUrl) {
      return trimmed;
    }

    return [proxiedUrl, ...parts.slice(1)].join(' ');
  }).join(', ');
}

function toProxyUrl(value, baseUrl, proxyBase) {
  if (!value || shouldSkipUrl(value)) {
    return null;
  }

  try {
    const absoluteUrl = new URL(value, baseUrl).href;
    return `${proxyBase}${encodeURIComponent(absoluteUrl)}`;
  } catch (error) {
    return null;
  }
}

function shouldSkipUrl(value) {
  const normalized = value.trim().toLowerCase();

  return normalized.startsWith('#') ||
    normalized.startsWith('javascript:') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('blob:') ||
    normalized.startsWith('about:') ||
    normalized.includes('/advanced-proxy?url=');
}
