export async function onRequest({ request }) {
  try {
    // 从请求URL中获取目标URL
    const targetUrl = getTargetUrl(request.url);

    // 检查是否提供了URL
    if (!targetUrl) {
      return new Response('缺少目标URL参数', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' }
      });
    }

    // 记录请求信息
    console.log(`代理请求: ${targetUrl}`);

    // 构建请求头 - 转发部分原始请求头
    const headers = new Headers();
    const forwardHeaders = [
      'user-agent',
      'accept',
      'accept-language',
      'accept-encoding',
      'content-type'
    ];
    
    forwardHeaders.forEach(header => {
      if (request.headers.get(header)) {
        headers.set(header, request.headers.get(header));
      }
    });

    // 请求目标网站
    const targetRequest = new Request(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? await request.blob() : undefined,
      redirect: 'follow',
    });

    // 发送请求并获取响应
    const response = await fetch(targetRequest);

    // 构建响应头
    const responseHeaders = new Headers();
    for (const [key, value] of response.headers.entries()) {
      // 忽略某些响应头以避免冲突
      if (!['content-encoding', 'content-length', 'connection'].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    }

    // 添加CORS头
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    // 添加代理标识
    responseHeaders.set('X-Proxied-By', 'EdgeOne-Pages-Proxy');

    // 获取响应内容
    const body = await response.arrayBuffer();

    // 返回代理响应
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders
    });
  } catch (error) {
    // 错误处理
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
