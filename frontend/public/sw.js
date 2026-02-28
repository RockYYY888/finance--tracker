const CACHE_NAME = "asset-tracker-shell-v2";
const APP_SHELL_PATHS = ["/", "/manifest.webmanifest"];
const STATIC_ASSET_PREFIX = "/assets/";

function shouldSkipRequest(request, requestUrl) {
	return (
		request.method !== "GET" ||
		requestUrl.origin !== self.location.origin ||
		requestUrl.pathname.startsWith("/api") ||
		request.headers.has("Authorization") ||
		request.headers.has("X-API-Key") ||
		request.cache === "no-store"
	);
}

function isCacheableAssetRequest(request, requestUrl) {
	if (requestUrl.search) {
		return false;
	}

	if (APP_SHELL_PATHS.includes(requestUrl.pathname)) {
		return true;
	}

	if (!requestUrl.pathname.startsWith(STATIC_ASSET_PREFIX)) {
		return false;
	}

	return ["font", "image", "script", "style", "worker"].includes(request.destination);
}

function canPersistResponse(response) {
	if (!response || !response.ok || response.type === "opaque") {
		return false;
	}

	const cacheControl = response.headers.get("Cache-Control") ?? "";
	return !/no-store|private/i.test(cacheControl);
}

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_PATHS)),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches.keys().then(async (keys) => {
			await Promise.all(
				keys
					.filter((key) => key !== CACHE_NAME)
					.map((key) => caches.delete(key)),
			);
			await self.clients.claim();
		}),
		),
	);
});

self.addEventListener("fetch", (event) => {
	const requestUrl = new URL(event.request.url);
	if (shouldSkipRequest(event.request, requestUrl)) {
		return;
	}

	if (event.request.mode === "navigate") {
		event.respondWith(
			(async () => {
				try {
					const response = await fetch(event.request);
					if (requestUrl.pathname === "/" && canPersistResponse(response)) {
						const cache = await caches.open(CACHE_NAME);
						await cache.put("/", response.clone());
					}
					return response;
				} catch {
					return (await caches.match("/")) ?? Response.error();
				}
			})(),
		);
		return;
	}

	if (!isCacheableAssetRequest(event.request, requestUrl)) {
		return;
	}

	event.respondWith(
		caches.match(event.request).then(async (cached) => {
			if (cached) {
				return cached;
			}

			const response = await fetch(event.request);
			if (canPersistResponse(response)) {
				const cache = await caches.open(CACHE_NAME);
				await cache.put(event.request, response.clone());
			}

			return response;
		}),
	);
});
