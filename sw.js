// sw.js - Serve local video files with HTTP Range responses for iOS compatibility

const filesByClient = new Map();

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SET_FILE') {
    const clientId = event.source.id;
    // Store file with unique ID
    if (!filesByClient.has(clientId)) {
      filesByClient.set(clientId, new Map());
    }
    filesByClient.get(clientId).set(data.fileId, data.file);
    
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: 'FILE_SET', fileId: data.fileId });
    } else {
      event.source.postMessage({ type: 'FILE_SET', fileId: data.fileId });
    }
  } else if (data.type === 'REMOVE_FILE') {
    const clientFiles = filesByClient.get(event.source.id);
    if (clientFiles) {
      clientFiles.delete(data.fileId);
    }
  } else if (data.type === 'CLEAR_FILES') {
    filesByClient.delete(event.source.id);
  }
});

function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const m = /bytes=(\d*)-(\d*)/i.exec(rangeHeader);
  if (!m) return null;

  let start = m[1] ? parseInt(m[1], 10) : NaN;
  let end = m[2] ? parseInt(m[2], 10) : NaN;

  if (Number.isNaN(start) && !Number.isNaN(end)) {
    const suffix = end;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else if (!Number.isNaN(start) && Number.isNaN(end)) {
    end = size - 1;
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Match /__localvideo at any path depth
  if (!url.pathname.endsWith('/__localvideo')) return;

  event.respondWith((async () => {
    const fileId = url.searchParams.get('id');
    const clientFiles = filesByClient.get(event.clientId);
    const file = clientFiles ? clientFiles.get(fileId) : null;
    
    if (!file) {
      return new Response('No file set. Please select a file.', { status: 404 });
    }

    const size = file.size;
    const type = file.type || 'video/mp4';
    const rangeHeader = event.request.headers.get('Range');
    const range = parseRange(rangeHeader, size);

    if (!range) {
      return new Response(file, {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
      });
    }

    const { start, end } = range;
    const chunk = file.slice(start, end + 1);

    return new Response(chunk, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  })());
});
