// ============================================================
// 编程老师工作台 - Service Worker
// 缓存策略：Stale-While-Revalidate（核心资源）+ Cache First（静态资源）
// ============================================================

const CACHE_VERSION = 'v1';
const CACHE_NAME = `workbench-${CACHE_VERSION}`;

// 需要预缓存的核心资源
const PRECACHE_URLS = [
  './workbench_pwa.html',
  './manifest.json'
];

// 安装事件：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching core resources');
        return cache.addAll(PRECACHE_URLS).catch((err) => {
          console.warn('[SW] Pre-cache failed (non-critical):', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// 激活事件：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('workbench-') && name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Removing old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// 请求拦截：自定义缓存策略
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跳过非 GET 请求
  if (request.method !== 'GET') return;

  // 跳过 Supabase API 请求（始终走网络）
  if (url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in')) {
    return;
  }

  // 策略1：HTML 页面 - Network First with Cache Fallback
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 更新缓存
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // 网络失败时使用缓存
          return caches.match(request).then((cachedResponse) => {
            return cachedResponse || caches.match('./workbench_pwa.html');
          });
        })
    );
    return;
  }

  // 策略2：Supabase SDK CDN - Cache First
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname.includes('unpkg.com')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // 策略3：其他静态资源 - Stale While Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      }).catch(() => null);

      return cachedResponse || fetchPromise || new Response('Offline', { status: 503 });
    })
  );
});

// 后台同步事件（当网络恢复时触发）
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-data') {
    event.waitUntil(
      // 通知所有客户端执行同步
      self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SYNC_REQUESTED' });
        });
      })
    );
  }
});

// 推送通知（预留）
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || '编程老师工作台', {
        body: data.body || '数据已同步',
        icon: './manifest.json',
        badge: './manifest.json'
      })
    );
  }
});

console.log('[SW] Service Worker loaded');
