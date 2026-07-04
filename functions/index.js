export function onRequest(context) {
  // 简单重定向到静态资源
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/cipheror.html'
    }
  });
} 