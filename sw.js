// sw.js — Serve the picked File with HTTP Range responses at /__localvideo
// NOTE: Must be served over HTTPS and controlled (reload after first install).

const filesByClient = new Map();

self.addEventListener("install", (event) => {
  // Activate quickly
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SET_FILE") {
    // Store per-client (tab)
    filesByClient.set(event.source.id, data.file);
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ type: "FILE_SET" });
    } else {
      event.source.postMessage({ type: "FILE_SET" });
    }
  }
});

function parseRange(rangeHeader, size) {
  // Example: "bytes=0-1023"
  if (!rangeHeader) return null;
  const m = /bytes=(\d*)-(\d*)/i.exec(rangeHeader);
  if (!m) return null;

  let start = m[1] ? parseInt(m[1], 10) : NaN;
  let end   = m[2] ? parseInt(m[2], 10) : NaN;

  if (Number.isNaN(start) && !Number.isNaN(end)) {
    // suffix bytes: bytes=-500 (last 500 bytes)
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

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname !== "/__localvideo") return;

  event.respondWith((async () => {
    const file = filesByClient.get(event.clientId);
    if (!file) {
      return new Response("No file set for this tab. Reload and pick again.", { status: 404 });
    }

    const size = file.size;
    const type = file.type || "video/mp4";
    const rangeHeader = event.request.headers.get("Range");
    const range = parseRange(rangeHeader, size);

    if (!range) {
      // Full response
      return new Response(file, {
        status: 200,
        headers: {
          "Content-Type": type,
          "Content-Length": String(size),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
      });
    }

    const { start, end } = range;
    const chunk = file.slice(start, end + 1);

    return new Response(chunk, {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
      },
    });
  })());
});
