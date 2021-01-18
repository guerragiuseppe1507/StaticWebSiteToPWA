const CACHE_VERSION = 1;

const OFFLINE_PAGE = '/offline.html';
const NOT_FOUND_PAGE = '/404.html';

const BASE_CACHE_FILES = [
    '/index.html'
];

const OFFLINE_CACHE_FILES = [
    OFFLINE_PAGE
];

const NOT_FOUND_CACHE_FILES = [
    NOT_FOUND_PAGE
];

const CACHE_VERSIONS = {
    assets: 'assets-v' + CACHE_VERSION,
    content: 'content-v' + CACHE_VERSION,
    offline: 'offline-v' + CACHE_VERSION,
    notFound: '404-v' + CACHE_VERSION,
};

// Set the cache time limit in seconds for eny specific file name
const MAX_FCL = {
    '/': 3600,
    html: 3600,
    json: 86400,
    js: 86400,
    css: 86400,
};

const CACHE_BLACKLIST = [
];

const SUPPORTED_METHODS = [
    'GET',
];

/**
 * Returns true if a specifica url should not be cached
 * @param {string} url
 * @returns {boolean}
 */
function isBlacklisted(url) {
    return (CACHE_BLACKLIST.length > 0) ? !CACHE_BLACKLIST.filter((rule) => {
        if (typeof rule === 'function') {
            return !rule(url);
        } else {
            return false;
        }
    }).length : false
}

/**
 * Rteturns extension of a file
 * @param {string} url
 * @returns {string}
 */
function getFileExtension(url) {
    let extension = url.split('.').reverse()[0].split('?')[0];
    return (extension.endsWith('/')) ? '/' : extension;
}

/**
 * Return a file cache limit basing on file extension
 * @param {string} url
 */
function getFCL(url) {
    if (typeof url === 'string') {
        let extension = getFileExtension(url);
        if (typeof MAX_FCL[extension] === 'number') {
            return MAX_FCL[extension];
        } else {
            return null;
        }
    } else {
        return null;
    }
}

/**
 * Cache all files liste in the file properties
 * @returns {Promise}
 */
function installServiceWorker() {
    return Promise.all(
        [
            caches.open(CACHE_VERSIONS.assets)
                .then((cache) => { return cache.addAll(BASE_CACHE_FILES); }),
            caches.open(CACHE_VERSIONS.offline)
                .then((cache) => { return cache.addAll(OFFLINE_CACHE_FILES); }),
            caches.open(CACHE_VERSIONS.notFound)
                .then((cache) => { return cache.addAll(NOT_FOUND_CACHE_FILES); })
        ]
    ).then(() => {
        return self.skipWaiting();
    });
}

/**
 * Remove all caches listed in CACHE_VERSIONS
 * @returns {Promise}
 */
function cleanupLegacyCache() {

    let currentCaches = Object.keys(CACHE_VERSIONS)
        .map((key) => { return CACHE_VERSIONS[key]; });

    return new Promise(
        (resolve, reject) => { caches.keys()
            .then((keys) => {
                return legacyKeys = keys
                    .filter((key) => { return !~currentCaches.indexOf(key); });
            })
            .then((legacy) => {
                if (legacy.length) {
                    Promise.all(legacy.map((legacyKey) => { return caches.delete(legacyKey) }))
                        .then(() => { resolve() })
                        .catch((err) => { reject(err); });
                } else {
                    resolve();
                }
            })
            .catch(() => { reject(); });
        }
    );
}

function precacheUrl(url) {
    if (!isBlacklisted(url)) {
        caches.open(CACHE_VERSIONS.content)
            .then((cache) => { cache.match(url)
                .then((response) => {
                    if (!response) {
                        return fetch(url)
                    } else {
                        // already in cache, nothing to do.
                        return null
                    }
                })
                .then((response) => {
                    if (response) {
                        return cache.put(url, response.clone());
                    } else {
                        return null;
                    }
                });
            })
    }
}

self.addEventListener('install', event => {
    event.waitUntil(
        Promise.all([
            installServiceWorker(),
            self.skipWaiting(),
        ])
    );
});

// The activate handler takes care of cleaning up old caches.
self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all(
            [
                cleanupLegacyCache(),
                self.clients.claim(),
                self.skipWaiting(),
            ]
        ).catch((err) => {
            event.skipWaiting();
        })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(caches.open(CACHE_VERSIONS.content)
        .then((cache) => { return cache.match(event.request)
            .then((response) => {
                if (response) {
                    let headers = response.headers.entries();
                    let date = null;

                    for (let pair of headers) {
                        if (pair[0] === 'date') {
                            date = new Date(pair[1]);
                        }
                    }

                    if (date) {
                        let age = parseInt((new Date().getTime() - date.getTime()) / 1000);
                        let ttl = getFCL(event.request.url);

                        if (ttl && age > ttl) {
                            return new Promise((resolve) => {
                                return fetch(event.request.clone())
                                    .then((updatedResponse) => {
                                        if (updatedResponse) {
                                            cache.put(event.request, updatedResponse.clone());
                                            resolve(updatedResponse);
                                        } else {
                                            resolve(response)
                                        }
                                    }).catch(() => { resolve(response); });
                            }).catch((err) => { return response; });
                        } else return response;
                    } else return response;
                } else return null;
            })
            .then((response) => {
                if (response) {
                    return response;
                } else {
                    return fetch(event.request.clone()).then((response) => {
                        if (response.status < 400) { //Any valid request
                            if (~SUPPORTED_METHODS.indexOf(event.request.method) && !isBlacklisted(event.request.url)) {
                                cache.put(event.request, response.clone());
                            }
                            return response;
                        } else {
                            return caches.open(CACHE_VERSIONS.notFound).then((cache) => {
                                return cache.match(NOT_FOUND_PAGE);
                            })
                        }
                    })
                    .then((response) => {
                        if (response) {
                            return response;
                        }
                    })
                    .catch(() => {
                        return caches.open(CACHE_VERSIONS.offline)
                            .then((offlineCache) => { return offlineCache.match(OFFLINE_PAGE) })
                    });
                }
            }).catch((error) => {
                console.error('  Error in fetch handler:', error);
                throw error;
            });
        })
    );
});


self.addEventListener('message', (event) => {
    if (
        typeof event.data === 'object' &&
        typeof event.data.action === 'string'
    ) {
        switch (event.data.action) {
            case 'cache':
                precacheUrl(event.data.url);
                break;
            default:
                console.log('Unknown action: ' + event.data.action);
                break;
        }
    }
});