export async function onRequest({ request }) {
  try {
    const targetUrl = getTargetUrl(request.url);

    if (!targetUrl) {
      return new Response('缺少目标URL参数', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
      });
    }

    console.log(`高级代理请求: ${targetUrl}`);

    // 请求目标网站
    const headers = new Headers();
    const forwardHeaders = [
      'user-agent',
      'accept',
      'accept-language',
      'accept-encoding',
      'content-type',
      'referer',
      'cache-control'
    ];
    
    forwardHeaders.forEach(header => {
      if (request.headers.get(header)) {
        headers.set(header, request.headers.get(header));
      }
    });

    // 发起请求
    const targetRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.blob() : undefined,
      redirect: 'follow',
    });

    const response = await fetch(targetRequest);

    // 处理响应头
    const responseHeaders = new Headers();
    for (const [key, value] of response.headers.entries()) {
      if (!['content-encoding', 'content-length', 'connection', 'transfer-encoding'].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    }

    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('X-Proxied-By', 'EdgeOne-Pages-Advanced-Proxy');

    // 处理响应内容
    const contentType = response.headers.get('content-type') || '';
    
    // 判断是否是HTML内容
    if (contentType.includes('text/html')) {
      let html = await response.text();
      
      const requestUrl = new URL(request.url);
      const proxyBase = `${requestUrl.protocol}//${requestUrl.host}/advanced-proxy?url=`;
      
      // 解析原始URL，以便正确替换链接
      const parsedTargetUrl = new URL(targetUrl);
      
      // 替换HTML中的链接
      html = replaceLinksImproved(html, parsedTargetUrl, proxyBase);
      
      responseHeaders.set('Content-Type', 'text/html; charset=UTF-8');
      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    } else {
      // 对于非HTML内容，直接返回
      const body = await response.arrayBuffer();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });
    }
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

/**
 * 改进的链接替换函数
 * @param {string} html - HTML内容
 * @param {URL} targetUrl - 目标URL对象
 * @param {string} proxyBase - 代理基础URL
 * @returns {string} - 替换链接后的HTML
 */
function replaceLinksImproved(html, targetUrl, proxyBase) {
  const targetOrigin = targetUrl.origin;
  const targetHost = targetUrl.host;
  const targetPath = targetUrl.pathname;
  
  // 获取当前目录路径（用于相对路径解析）
  const currentDir = targetPath.substring(0, targetPath.lastIndexOf('/') + 1);
  
  // 1. 替换绝对URL (href="http://example.com/page")
  html = html.replace(/(href|src)=(["'])(https?:\/\/[^"']+)(["'])/gi, (match, attr, quote1, url, quote2) => {
    // 避免重复处理已经是代理URL的链接
    if (url.includes('/advanced-proxy?url=')) return match;
    return `${attr}=${quote1}${proxyBase}${encodeURIComponent(url)}${quote2}`;
  });
  
  // 2. 替换以//开头的协议相对URL (href="//example.com/page")
  html = html.replace(/(href|src)=(["'])\/\/([^"']+)(["'])/gi, (match, attr, quote1, url, quote2) => {
    const absoluteUrl = `${targetUrl.protocol}//${url}`;
    return `${attr}=${quote1}${proxyBase}${encodeURIComponent(absoluteUrl)}${quote2}`;
  });

  // 3. 替换根相对路径 (href="/page")
  html = html.replace(/(href|src)=(["'])(\/[^"']*)(["'])/gi, (match, attr, quote1, path, quote2) => {
    return `${attr}=${quote1}${proxyBase}${encodeURIComponent(targetOrigin + path)}${quote2}`;
  });

  // 4. 替换相对路径 (href="page" 或 href="./page")
  html = html.replace(/(href|src)=(["'])(?!https?:\/\/)(?!\/\/)(?!\/)(?!#)(?!javascript:)(?!data:)([^"']+)(["'])/gi, 
    (match, attr, quote1, path, quote2) => {
      // 如果路径以./开头，移除./
      if (path.startsWith('./')) {
        path = path.substring(2);
      }
      
      // 构建完整URL
      let fullUrl;
      if (path.startsWith('?')) {
        // 查询参数，添加到当前页面路径
        fullUrl = targetOrigin + targetPath + path;
      } else {
        // 构建相对路径URL
        fullUrl = targetOrigin + (currentDir + path).replace(/\/\.?\//g, '/').replace(/\/+/g, '/');
      }
      
      return `${attr}=${quote1}${proxyBase}${encodeURIComponent(fullUrl)}${quote2}`;
    }
  );

  // 5. 替换CSS中的url()
  html = html.replace(/url\((["']?)([^)'"]+)(["']?)\)/gi, (match, quote1, url, quote2) => {
    // 跳过不需要处理的URL类型
    if (url.startsWith('data:') || url.startsWith('#') || url.includes('/advanced-proxy?url=')) {
      return match;
    }
    
    // 处理不同类型的URL
    let fullUrl;
    
    // 绝对URL
    if (url.match(/^https?:\/\//i)) {
      fullUrl = url;
    }
    // 协议相对URL
    else if (url.startsWith('//')) {
      fullUrl = `${targetUrl.protocol}${url}`;
    }
    // 根相对路径
    else if (url.startsWith('/')) {
      fullUrl = targetOrigin + url;
    }
    // 普通相对路径
    else {
      // 移除./前缀
      if (url.startsWith('./')) {
        url = url.substring(2);
      }
      
      // 构建完整URL
      fullUrl = targetOrigin + (currentDir + url).replace(/\/\.?\//g, '/').replace(/\/+/g, '/');
    }
    
    return `url(${quote1}${proxyBase}${encodeURIComponent(fullUrl)}${quote2})`;
  });

  // 6. 替换表单action属性
  html = html.replace(/action=(["'])(https?:\/\/[^"']+|\/[^"']+|[^"':]+)(["'])/gi, (match, quote1, url, quote2) => {
    // 跳过已经是代理URL的链接
    if (url.includes('/advanced-proxy?url=')) return match;
    
    let fullUrl;
    
    // 绝对URL
    if (url.match(/^https?:\/\//i)) {
      fullUrl = url;
    }
    // 根相对路径
    else if (url.startsWith('/')) {
      fullUrl = targetOrigin + url;
    }
    // 普通相对路径
    else {
      // 移除./前缀
      if (url.startsWith('./')) {
        url = url.substring(2);
      }
      
      fullUrl = targetOrigin + (currentDir + url).replace(/\/\.?\//g, '/').replace(/\/+/g, '/');
    }
    
    return `action=${quote1}${proxyBase}${encodeURIComponent(fullUrl)}${quote2}`;
  });

  return html;
} 
