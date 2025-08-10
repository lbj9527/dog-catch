// Dog-Catch 深度搜索脚本
// 严格移植 cat-catch 的 search.js 实现

(function __DOG_CATCH_SEARCH_SCRIPT__() {
    const isRunningInWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
    const DOG_CATCH_DEBUG = false;
    
    // 防止 console.log 被劫持
    if (!isRunningInWorker && DOG_CATCH_DEBUG && console.log.toString() != 'function log() { [native code] }') {
        const newIframe = top.document.createElement("iframe");
        newIframe.style.display = "none";
        top.document.body.appendChild(newIframe);
        window.console.log = newIframe.contentWindow.console.log;
    }

    // 通信函数 - 向 content script 发送消息
    function postData(data) {
        if (isRunningInWorker) {
            self.postMessage(data);
        } else {
            window.postMessage(data, "*");
        }
    }

    // Worker 劫持 - 严格移植 cat-catch 的实现
    if (!isRunningInWorker) {
        const _Worker = Worker;
        window.Worker = function (scriptURL, options) {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', scriptURL, false);
                xhr.send();
                if (xhr.status === 200) {
                    const blob = new Blob([`(${__DOG_CATCH_SEARCH_SCRIPT__.toString()})();`, xhr.response], { type: 'text/javascript' });
                    const newWorker = new _Worker(URL.createObjectURL(blob), options);
                    newWorker.addEventListener("message", function (event) {
                        if (event.data?.action == "catCatchAddKey" || event.data?.action == "catCatchAddMedia") {
                            postData(event.data);
                        }
                    });
                    return newWorker;
                }
            } catch (error) {
                return new _Worker(scriptURL, options);
            }
            return new _Worker(scriptURL, options);
        }
    }

    // 正则表达式 - 严格移植 cat-catch 的正则
    const dataRE = /(#EXTM3U|#EXTINF:|\.m3u8|\.mpd)/i;
    const urlRE = /https?:\/\/[^\s"'<>]+/g;

    // 工具函数
    function isJSON(str) {
        try {
            return JSON.parse(str);
        } catch (e) {
            return false;
        }
    }

    function getDataM3U8(data) {
        const match = data.match(/#EXTM3U[\s\S]*?(?=#EXT-X-ENDLIST|$)/);
        return match ? match[0] : null;
    }

    function toUrl(data, ext = "m3u8") {
        if (!data) return;
        
        // 提取 URL
        const urls = data.match(urlRE);
        if (urls) {
            urls.forEach(url => {
                postData({
                    action: "catCatchAddMedia",
                    url: url,
                    href: location.href,
                    ext: ext,
                    mime: ext === "m3u8" ? "application/vnd.apple.mpegurl" : "application/dash+xml"
                });
            });
        }
        
        // 直接发送数据内容
        postData({
            action: "catCatchAddMedia",
            url: "data:" + (ext === "m3u8" ? "application/vnd.apple.mpegurl" : "application/dash+xml") + "," + encodeURIComponent(data),
            href: location.href,
            ext: ext,
            mime: ext === "m3u8" ? "application/vnd.apple.mpegurl" : "application/dash+xml"
        });
    }

    function extractBaseUrl(url) {
        try {
            const urlObj = new URL(url);
            const baseUrl = urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
            postData({
                action: "catCatchAddMedia",
                url: baseUrl,
                href: location.href,
                ext: "ts",
                mime: "video/mp2t"
            });
        } catch (e) {
            // 忽略无效 URL
        }
    }

    function vimeo(url, response) {
        try {
            if (typeof response === 'string') {
                const data = isJSON(response);
                if (data && data.video) {
                    findMedia(data.video);
                }
            }
        } catch (e) {
            // 忽略错误
        }
    }

    // 检查重复扩展 - 严格移植 cat-catch 的实现
    function isRepeatedExpansion(buffer, keyLength) {
        if (buffer.byteLength % keyLength !== 0) return null;
        
        const view = new Uint8Array(buffer);
        const firstChunk = view.slice(0, keyLength);
        
        for (let i = keyLength; i < view.length; i += keyLength) {
            const chunk = view.slice(i, i + keyLength);
            for (let j = 0; j < keyLength; j++) {
                if (firstChunk[j] !== chunk[j]) {
                    return null;
                }
            }
        }
        
        return firstChunk;
    }

    // 深度媒体查找函数 - 严格移植 cat-catch 的实现
    async function findMedia(data, depth = 0) {
        DOG_CATCH_DEBUG && console.log(data);
        let index = 0;
        if (!data) { return; }
        
        // 检查 16 字节密钥数组
        if (data instanceof Array && data.length == 16) {
            const isKey = data.every(function (value) {
                return typeof value == 'number' && value <= 256
            });
            if (isKey) {
                postData({ action: "catCatchAddKey", key: data, href: location.href, ext: "key" });
                return;
            }
        }
        
        // 检查 16 字节 ArrayBuffer 密钥
        if (data instanceof ArrayBuffer && data.byteLength == 16) {
            postData({ action: "catCatchAddKey", key: data, href: location.href, ext: "key" });
            return;
        }
        
        // 递归查找对象中的媒体资源
        for (let key in data) {
            if (index != 0) { depth = 0; } 
            index++;
            
            if (typeof data[key] == "object") {
                // 查找疑似 16 字节密钥
                if (data[key] instanceof Array && data[key].length == 16) {
                    const isKey = data[key].every(function (value) {
                        return typeof value == 'number' && value <= 256
                    });
                    isKey && postData({ action: "catCatchAddKey", key: data[key], href: location.href, ext: "key" });
                    continue;
                }
                
                if (depth > 10) { continue; }  // 防止死循环 最大深度
                findMedia(data[key], ++depth);
                continue;
            }
            
            if (typeof data[key] != "string") { continue; }
            
            // 检查 URL 字符串
            if (data[key].startsWith("http") && (data[key].includes(".m3u8") || data[key].includes(".mpd"))) {
                postData({
                    action: "catCatchAddMedia",
                    url: data[key],
                    href: location.href,
                    ext: data[key].includes(".m3u8") ? "m3u8" : "mpd",
                    mime: data[key].includes(".m3u8") ? "application/vnd.apple.mpegurl" : "application/dash+xml"
                });
            }
            
            // 检查 M3U8 内容
            if (data[key].includes("#EXTM3U") || data[key].includes("#EXTINF:")) {
                toUrl(data[key], "m3u8");
            }
            
            // 检查 MPD 内容
            if (data[key].includes("</MPD>")) {
                toUrl(data[key], "mpd");
            }
        }
    }

    // XMLHttpRequest 劫持 - 严格移植 cat-catch 的实现
    const _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method) {
        method = method.toUpperCase();
        DOG_CATCH_DEBUG && console.log(this);
        
        this.addEventListener("readystatechange", function (event) {
            DOG_CATCH_DEBUG && console.log(this);
            if (this.status != 200) { return; }

            // 处理 vimeo
            this.responseURL.includes("vimeocdn.com") && vimeo(this.responseURL, this.response);

            // 查找疑似 32 字节密钥
            if (this.responseType == "arraybuffer" && this.response?.byteLength && this.response.byteLength == 32) {
                postData({ action: "catCatchAddKey", key: this.response, href: location.href, ext: "key" });
            }
            
            // 查找疑似 16 字节密钥
            if (this.responseType == "arraybuffer" && this.response?.byteLength && this.response.byteLength == 16) {
                postData({ action: "catCatchAddKey", key: this.response, href: location.href, ext: "key" });
            }
            
            // 处理 TS 文件
            if (this.responseType == "arraybuffer" && this.responseURL.includes(".ts")) {
                extractBaseUrl(this.responseURL);
            }
            
            // 处理对象响应
            if (typeof this.response == "object") {
                findMedia(this.response);
                return;
            }
            
            if (this.response == "" || typeof this.response != "string") { return; }
            
            // 检查响应内容中的 M3U8
            if (dataRE.test(this.response)) {
                const text = getDataM3U8(this.response);
                text && toUrl(text);
                return;
            }
            
            // 检查响应 URL 中的 M3U8
            if (dataRE.test(this.responseURL)) {
                const text = getDataM3U8(this.responseURL);
                text && toUrl(text);
                return;
            }

            // 尝试解析 JSON
            const isJson = isJSON(this.response);
            if (isJson) {
                findMedia(isJson);
                return;
            }
        });
        
        _xhrOpen.apply(this, arguments);
    }
    
    XMLHttpRequest.prototype.open.toString = function () {
        return _xhrOpen.toString();
    }

    // Fetch API 劫持 - 严格移植 cat-catch 的实现
    const _fetch = fetch;
    fetch = async function (input, init) {
        let response;
        try {
            response = await _fetch.apply(this, arguments);
        } catch (error) {
            console.error("Fetch error:", error);
            throw error;
        }

        const clone = response.clone();
        DOG_CATCH_DEBUG && console.log(response);

        response.arrayBuffer()
            .then(arrayBuffer => {
                DOG_CATCH_DEBUG && console.log({ arrayBuffer, input });

                // 检查 16 字节密钥
                if (arrayBuffer.byteLength == 16) {
                    postData({ action: "catCatchAddKey", key: arrayBuffer, href: location.href, ext: "key" });
                    return;
                }

                let text = new TextDecoder().decode(arrayBuffer);
                if (text == "") { return; }

                if (typeof input == "object") { input = input.url; }

                // 尝试解析 JSON
                let isJson = isJSON(text);
                if (isJson) {
                    findMedia(isJson);
                    return;
                }

                // 检查 M3U8 内容
                if (dataRE.test(text)) {
                    const m3u8Text = getDataM3U8(text);
                    m3u8Text && toUrl(m3u8Text);
                    return;
                }

                // 检查 URL 中的 M3U8
                if (typeof input === 'string' && dataRE.test(input)) {
                    const m3u8Text = getDataM3U8(input);
                    m3u8Text && toUrl(m3u8Text);
                    return;
                }
            })
            .catch(error => {
                DOG_CATCH_DEBUG && console.error("Fetch processing error:", error);
            });

        return clone;
    }

    fetch.toString = function () {
        return _fetch.toString();
    }

    // btoa/atob 劫持 - 严格移植 cat-catch 的实现
    const _btoa = btoa;
    btoa = function (data) {
        const base64 = _btoa.apply(this, arguments);
        DOG_CATCH_DEBUG && console.log(base64, data, base64.length);

        // 检查 24 字符长度的 Base64 密钥
        if (base64.length == 24 && base64.substring(22, 24) == "==") {
            postData({ action: "catCatchAddKey", key: base64, href: location.href, ext: "base64Key" });
        }

        // 检查 M3U8 内容
        if (data.substring(0, 7).toUpperCase() == "#EXTM3U") {
            toUrl(data);
        }

        return base64;
    }
    btoa.toString = function () {
        return _btoa.toString();
    }

    const _atob = atob;
    atob = function (base64) {
        const data = _atob.apply(this, arguments);
        DOG_CATCH_DEBUG && console.log(base64, data, base64.length);

        // 检查 24 字符长度的 Base64 密钥
        if (base64.length == 24 && base64.substring(22, 24) == "==") {
            postData({ action: "catCatchAddKey", key: base64, href: location.href, ext: "base64Key" });
        }

        // 检查 M3U8 内容
        if (data.substring(0, 7).toUpperCase() == "#EXTM3U") {
            toUrl(data);
        }

        // 检查 MPD 内容
        if (data.endsWith("</MPD>")) {
            toUrl(data, "mpd");
        }

        return data;
    }
    atob.toString = function () {
        return _atob.toString();
    }

    // String.fromCharCode 劫持 - 严格移植 cat-catch 的实现
    const _fromCharCode = String.fromCharCode;
    let m3u8Text = '';
    String.fromCharCode = function () {
        const data = _fromCharCode.apply(this, arguments);
        if (data.length < 7) { return data; }

        // 检查 M3U8 内容
        if (data.substring(0, 7) == "#EXTM3U" || data.includes("#EXTINF:")) {
            m3u8Text += data;
            if (m3u8Text.includes("#EXT-X-ENDLIST")) {
                toUrl(m3u8Text.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST");
                m3u8Text = '';
            }
            return data;
        }

        // 检查 32 字符密钥
        const key = data.replaceAll("\u0010", "");
        if (key.length == 32) {
            postData({ action: "catCatchAddKey", key: key, href: location.href, ext: "key" });
        }

        return data;
    }
    String.fromCharCode.toString = function () {
        return _fromCharCode.toString();
    }

    // Array.prototype.slice 劫持 - 严格移植 cat-catch 的实现
    const _slice = Array.prototype.slice;
    Object.defineProperty(Array.prototype, 'slice', {
        value: function () {
            const instance = _slice.apply(this, arguments);

            // 检查 256 或 128 字节的重复扩展
            if (instance.byteLength == 256 || instance.byteLength == 128) {
                const _buffer = isRepeatedExpansion(instance.buffer, 16);
                if (_buffer) {
                    postData({ action: "catCatchAddKey", key: _buffer, href: location.href, ext: "key" });
                }
            }
            return instance;
        }
    });

    // escape 劫持 - 严格移植 cat-catch 的实现
    const _escape = escape;
    escape = function (str) {
        if (str?.length && str.length == 24 && str.substring(22, 24) == "==") {
            postData({ action: "catCatchAddKey", key: str, href: location.href, ext: "base64Key" });
        }
        return _escape(str);
    }
    escape.toString = function () {
        return _escape.toString();
    }

    console.log("Dog-Catch search script injected successfully");
})();
