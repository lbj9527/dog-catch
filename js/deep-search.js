/**
 * Dog-Catch 深度搜索脚本
 * 基于 cat-catch 的 search.js 移植
 * 用于深度检测页面中的媒体资源
 */

(function __DOG_CATCH_DEEP_SEARCH__() {
    'use strict';
    
    const DEBUG = false;
    const filter = new Set();
    const reKeyURL = /URI="(.*)"/;
    const dataRE = /^data:(application|video|audio)\//i;
    const joinBaseUrlTask = [];
    const baseUrl = new Set();
    const regexVimeo = /^https:\/\/[^\.]*\.vimeocdn\.com\/exp=.*\/playlist\.json\?/i;
    const videoSet = new Set();
    
    // 提取基础URL
    extractBaseUrl(location.href);

    // Worker 劫持 - 移植自 cat-catch
    const isRunningInWorker = typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope;
    if (!isRunningInWorker) {
        const _Worker = Worker;
        window.Worker = function (scriptURL, options) {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', scriptURL, false);
                xhr.send();
                if (xhr.status === 200) {
                    const blob = new Blob([`(${__DOG_CATCH_DEEP_SEARCH__.toString()})();`, xhr.response], { type: 'text/javascript' });
                    const newWorker = new _Worker(URL.createObjectURL(blob), options);
                    newWorker.addEventListener("message", function (event) {
                        if (event.data?.action == "dogCatchAddKey" || event.data?.action == "dogCatchAddMedia") {
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
        window.Worker.toString = function () {
            return _Worker.toString();
        }
    }

    // 劫持 JSON.parse 来检测媒体资源
    const _JSONparse = JSON.parse;
    JSON.parse = function () {
        let data = _JSONparse.apply(this, arguments);
        findMedia(data);
        return data;
    }
    JSON.parse.toString = function () {
        return _JSONparse.toString();
    }

    /**
     * 在数据中查找媒体资源
     */
    async function findMedia(data, depth = 0) {
        DEBUG && console.log('Dog-Catch 深度搜索:', data);
        let index = 0;
        if (!data) { return; }
        
        // 检测加密密钥
        if (data instanceof Array && data.length == 16) {
            const isKey = data.every(function (value) {
                return typeof value == 'number' && value <= 256
            });
            if (isKey) {
                postData({ action: "dogCatchAddKey", key: data, href: location.href, ext: "key" });
                return;
            }
        }
        
        if (data instanceof ArrayBuffer && data.byteLength == 16) {
            postData({ action: "dogCatchAddKey", key: data, href: location.href, ext: "key" });
            return;
        }
        
        for (let key in data) {
            if (index != 0) { depth = 0; } index++;
            if (typeof data[key] == "object") {
                // 查找疑似key
                if (data[key] instanceof Array && data[key].length == 16) {
                    const isKey = data[key].every(function (value) {
                        return typeof value == 'number' && value <= 256
                    });
                    isKey && postData({ action: "dogCatchAddKey", key: data[key], href: location.href, ext: "key" });
                    continue;
                }
                if (depth > 10) { continue; }  // 防止死循环 最大深度
                findMedia(data[key], ++depth);
                continue;
            }
            if (typeof data[key] == "string") {
                if (isUrl(data[key])) {
                    const ext = getExtension(data[key]);
                    if (ext) {
                        const url = data[key].startsWith("//") ? (location.protocol + data[key]) : data[key];
                        extractBaseUrl(url);
                        postData({ action: "dogCatchAddMedia", url: url, href: location.href, ext: ext });
                    }
                    continue;
                }
                // M3U8 检测
                if (data[key].substring(0, 7).toUpperCase() == "#EXTM3U") {
                    toUrl(data[key]);
                    continue;
                }
                // Data URL 检测
                if (dataRE.test(data[key].substring(0, 17))) {
                    const text = getDataM3U8(data[key]);
                    text && toUrl(text);
                    continue;
                }
                // MPD 检测
                if (data[key].toLowerCase().includes("urn:mpeg:dash:schema:mpd")) {
                    toUrl(data[key], "mpd");
                    continue;
                }
            }
        }
    }

    // 劫持 XMLHttpRequest
    const _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method) {
        method = method.toUpperCase();
        DEBUG && console.log('Dog-Catch XHR:', this);
        this.addEventListener("readystatechange", function (event) {
            if (this.status != 200) { return; }

            // 处理vimeo
            this.responseURL.includes("vimeocdn.com") && vimeo(this.responseURL, this.response);

            // 查找疑似key
            if (this.responseType == "arraybuffer" && this.response?.byteLength && this.response.byteLength == 32) {
                postData({ action: "dogCatchAddKey", key: this.response, href: location.href, ext: "key" });
            }
            if (this.responseType == "arraybuffer" && this.response?.byteLength && this.response.byteLength == 16) {
                postData({ action: "dogCatchAddKey", key: this.response, href: location.href, ext: "key" });
            }
            if (this.responseType == "arraybuffer" && this.responseURL.includes(".ts")) {
                extractBaseUrl(this.responseURL);
            }
            if (typeof this.response == "object") {
                findMedia(this.response);
                return;
            }
            if (this.response == "" || typeof this.response != "string") { return; }
            
            // Data URL 检测
            if (dataRE.test(this.response)) {
                const text = getDataM3U8(this.response);
                text && toUrl(text);
                return;
            }
            if (dataRE.test(this.responseURL)) {
                const text = getDataM3U8(this.responseURL);
                text && toUrl(text);
                return;
            }
            
            // URL 检测
            if (isUrl(this.response)) {
                const ext = getExtension(this.response);
                ext && postData({ action: "dogCatchAddMedia", url: this.response, href: location.href, ext: ext });
                return;
            }
            
            // M3U8 检测
            if (this.response.toUpperCase().includes("#EXTM3U")) {
                if (this.response.substring(0, 7) == "#EXTM3U") {
                    if (method == "GET") {
                        toUrl(addBaseUrl(getBaseUrl(this.responseURL), this.response));
                        postData({ action: "dogCatchAddMedia", url: this.responseURL, href: location.href, ext: "m3u8" });
                        return;
                    }
                    toUrl(this.response);
                    return;
                }
                if (isJSON(this.response)) {
                    if (method == "GET") {
                        postData({ action: "dogCatchAddMedia", url: this.responseURL, href: location.href, ext: "json" });
                        return;
                    }
                    toUrl(this.response, "json");
                    return;
                }
            }
            
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

    // 劫持 fetch
    const _fetch = fetch;
    fetch = async function (input, init) {
        let response;
        try {
            response = await _fetch.apply(this, arguments);
        } catch (error) {
            console.error("Dog-Catch Fetch error:", error);
            throw error;
        }
        const clone = response.clone();
        DEBUG && console.log('Dog-Catch Fetch:', response);
        
        response.arrayBuffer()
            .then(arrayBuffer => {
                if (arrayBuffer.byteLength == 16) {
                    postData({ action: "dogCatchAddKey", key: arrayBuffer, href: location.href, ext: "key" });
                    return;
                }
                let text = new TextDecoder().decode(arrayBuffer);
                if (text == "") { return; }
                if (typeof input == "object") { input = input.url; }
                let isJson = isJSON(text);
                if (isJson) {
                    findMedia(isJson);
                    return;
                }
                if (text.substring(0, 7).toUpperCase() == "#EXTM3U") {
                    if (init?.method == undefined || (init.method && init.method.toUpperCase() == "GET")) {
                        toUrl(addBaseUrl(getBaseUrl(input), text));
                        postData({ action: "dogCatchAddMedia", url: input, href: location.href, ext: "m3u8" });
                        return;
                    }
                    toUrl(text);
                    return;
                }
                if (dataRE.test(text.substring(0, 17))) {
                    const data = getDataM3U8(text);
                    data && toUrl(data);
                    return;
                }
            });
        return clone;
    }
    fetch.toString = function () {
        return _fetch.toString();
    }

    // 劫持 btoa/atob
    const _btoa = btoa;
    btoa = function (data) {
        const base64 = _btoa.apply(this, arguments);
        if (base64.length == 24 && base64.substring(22, 24) == "==") {
            postData({ action: "dogCatchAddKey", key: base64, href: location.href, ext: "base64Key" });
        }
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
        if (base64.length == 24 && base64.substring(22, 24) == "==") {
            postData({ action: "dogCatchAddKey", key: base64, href: location.href, ext: "base64Key" });
        }
        if (data.substring(0, 7).toUpperCase() == "#EXTM3U") {
            toUrl(data);
        }
        if (data.endsWith("</MPD>")) {
            toUrl(data, "mpd");
        }
        return data;
    }
    atob.toString = function () {
        return _atob.toString();
    }

    // 劫持 Array.prototype.join - 移植自 cat-catch
    const _arrayJoin = Array.prototype.join;
    Array.prototype.join = function () {
        const data = _arrayJoin.apply(this, arguments);
        if (data.substring(0, 7).toUpperCase() == "#EXTM3U") {
            toUrl(data);
        }
        return data;
    }
    Array.prototype.join.toString = function () {
        return _arrayJoin.toString();
    }

    // 劫持 Array.prototype.slice - 移植自 cat-catch
    const _slice = Array.prototype.slice;
    Array.prototype.slice = function (start, end) {
        const data = _slice.apply(this, arguments);
        if (end == 16 && this.length == 32) {
            for (let item of data) {
                if (typeof item != "number" || item > 255) { return data; }
            }
            postData({ action: "dogCatchAddKey", key: data, href: location.href, ext: "key" });
        }
        return data;
    }
    Array.prototype.slice.toString = function () {
        return _slice.toString();
    }

    // 劫持 String.fromCharCode - 移植自 cat-catch
    const _fromCharCode = String.fromCharCode;
    let m3u8Text = '';
    String.fromCharCode = function () {
        const data = _fromCharCode.apply(this, arguments);
        if (data.length < 7) { return data; }
        if (data.substring(0, 7) == "#EXTM3U" || data.includes("#EXTINF:")) {
            m3u8Text += data;
            if (m3u8Text.includes("#EXT-X-ENDLIST")) {
                toUrl(m3u8Text.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST");
                m3u8Text = '';
            }
            return data;
        }
        const key = data.replaceAll("\u0010", "");
        if (key.length == 32) {
            postData({ action: "dogCatchAddKey", key: key, href: location.href, ext: "key" });
        }
        return data;
    }
    String.fromCharCode.toString = function () {
        return _fromCharCode.toString();
    }

    // 劫持 escape - 移植自 cat-catch
    const _escape = escape;
    escape = function (str) {
        if (str?.length && str.length == 24 && str.substring(22, 24) == "==") {
            postData({ action: "dogCatchAddKey", key: str, href: location.href, ext: "base64Key" });
        }
        return _escape(str);
    }
    escape.toString = function () {
        return _escape.toString();
    }

    // 劫持 String.prototype.indexOf - 移植自 cat-catch
    const _indexOf = String.prototype.indexOf;
    String.prototype.indexOf = function (searchValue, fromIndex) {
        const out = _indexOf.apply(this, arguments);
        if (searchValue === '#EXTM3U' && out !== -1) {
            const data = this.substring(fromIndex);
            toUrl(data);
        }
        return out;
    }
    String.prototype.indexOf.toString = function () {
        return _indexOf.toString();
    }

    // TypedArray 劫持 - 移植自 cat-catch
    const uint32ArrayToUint8Array_ = (array) => {
        const newArray = new Uint8Array(16);
        for (let i = 0; i < 4; i++) {
            newArray[i * 4] = (array[i] >> 24) & 0xff;
            newArray[i * 4 + 1] = (array[i] >> 16) & 0xff;
            newArray[i * 4 + 2] = (array[i] >> 8) & 0xff;
            newArray[i * 4 + 3] = array[i] & 0xff;
        }
        return newArray;
    }

    function findTypedArray(target, args) {
        let instance = new target(...args);
        if (instance.byteLength == 16) {
            postData({ action: "dogCatchAddKey", key: instance.buffer, href: location.href, ext: "key" });
        }
        if (instance.length == 4 && target.name == "Uint32Array") {
            const uint8Array = uint32ArrayToUint8Array_(instance);
            if (uint8Array.byteLength == 16) {
                postData({ action: "dogCatchAddKey", key: instance.buffer, href: location.href, ext: "key" });
            }
        }
        return instance;
    }

    // Uint8Array
    const _Uint8Array = Uint8Array;
    Uint8Array = new Proxy(_Uint8Array, {
        construct(target, args) {
            return findTypedArray(target, args);
        }
    });

    // Uint16Array
    const _Uint16Array = Uint16Array;
    Uint16Array = new Proxy(_Uint16Array, {
        construct(target, args) {
            return findTypedArray(target, args);
        }
    });

    // Uint32Array
    const _Uint32Array = Uint32Array;
    Uint32Array = new Proxy(_Uint32Array, {
        construct(target, args) {
            return findTypedArray(target, args);
        }
    });

    // Int8Array.prototype.subarray
    const _subarray = Int8Array.prototype.subarray;
    Int8Array.prototype.subarray = function (start, end) {
        const data = _subarray.apply(this, arguments);
        if (data.byteLength == 16) {
            const uint8 = new _Uint8Array(data);
            for (let item of uint8) {
                if (typeof item != "number" || item > 255) { return data; }
            }
            postData({ action: "dogCatchAddKey", key: uint8.buffer, href: location.href, ext: "key" });
        }
        return data;
    }
    Int8Array.prototype.subarray.toString = function () {
        return _subarray.toString();
    }

    // DataView 劫持 - 移植自 cat-catch
    function isRepeatedExpansion(buffer, targetLength) {
        if (buffer.byteLength % targetLength !== 0) return null;
        const view = new DataView(buffer);
        const targetView = new DataView(buffer, 0, targetLength);
        for (let i = targetLength; i < buffer.byteLength; i += targetLength) {
            for (let j = 0; j < targetLength; j++) {
                if (view.getUint8(i + j) !== targetView.getUint8(j)) {
                    return null;
                }
            }
        }
        return buffer.slice(0, targetLength);
    }

    const _DataView = DataView;
    DataView = new Proxy(_DataView, {
        construct(target, args) {
            let instance = new target(...args);
            instance.setInt32 = new Proxy(instance.setInt32, {
                apply(target, thisArg, argArray) {
                    Reflect.apply(target, thisArg, argArray);
                    if (thisArg.byteLength == 16) {
                        postData({ action: "dogCatchAddKey", key: thisArg.buffer, href: location.href, ext: "key" });
                    }
                    return;
                }
            });
            if (instance.byteLength == 16 && instance.buffer.byteLength == 16) {
                postData({ action: "dogCatchAddKey", key: instance.buffer, href: location.href, ext: "key" });
            }
            if (instance.byteLength == 256 || instance.byteLength == 128) {
                const _buffer = isRepeatedExpansion(instance.buffer, 16);
                if (_buffer) {
                    postData({ action: "dogCatchAddKey", key: _buffer, href: location.href, ext: "key" });
                }
            }
            return instance;
        }
    });

    // 辅助函数 - 移植自 cat-catch

    /**
     * 检查是否为有效URL - 移植自 cat-catch
     */
    function isUrl(str) {
        return (str.startsWith("http://") || str.startsWith("https://") || str.startsWith("//"));
    }

    /**
     * 获取文件扩展名 - 移植自 cat-catch
     */
    function getExtension(str) {
        let ext;
        try {
            if (str.startsWith("//")) {
                str = location.protocol + str;
            }
            ext = new URL(str);
        } catch (e) { return undefined; }
        ext = ext.pathname.split(".");
        if (ext.length == 1) { return undefined; }
        ext = ext[ext.length - 1].toLowerCase();
        if (ext == "m3u8" ||
            ext == "m3u" ||
            ext == "mpd" ||
            ext == "mp4" ||
            ext == "mp3" ||
            ext == "flv" ||
            ext == "key" ||
            ext == "webm" ||
            ext == "avi" ||
            ext == "mov" ||
            ext == "mkv" ||
            ext == "3gp" ||
            ext == "wmv" ||
            ext == "asf" ||
            ext == "rm" ||
            ext == "rmvb" ||
            ext == "m4v" ||
            ext == "aac" ||
            ext == "wav" ||
            ext == "ogg" ||
            ext == "m4a" ||
            ext == "wma" ||
            ext == "flac" ||
            ext == "ts" ||
            ext == "m4s"
        ) { return ext; }
        return false;
    }

    /**
     * 检查是否为JSON
     */
    function isJSON(str) {
        if (!str || typeof str !== 'string') return false;
        try {
            return JSON.parse(str);
        } catch {
            return false;
        }
    }

    /**
     * 从Data URL中提取M3U8内容
     */
    function getDataM3U8(dataUrl) {
        if (!dataUrl || !dataUrl.startsWith('data:')) return null;
        try {
            const base64Data = dataUrl.split(',')[1];
            if (!base64Data) return null;
            const decoded = atob(base64Data);
            if (decoded.includes('#EXTM3U') || decoded.includes('#EXTINF')) {
                return decoded;
            }
        } catch (e) {
            console.error('解析Data URL失败:', e);
        }
        return null;
    }

    /**
     * 提取基础URL
     */
    function extractBaseUrl(url) {
        if (!url) return;
        try {
            const urlObj = new URL(url);
            const basePath = urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
            baseUrl.add(basePath);
        } catch (e) {
            console.error('提取基础URL失败:', e);
        }
    }

    /**
     * 获取基础URL
     */
    function getBaseUrl(url) {
        if (!url) return '';
        try {
            const urlObj = new URL(url);
            return urlObj.origin + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
        } catch {
            return '';
        }
    }

    /**
     * 添加基础URL到相对路径
     */
    function addBaseUrl(baseUrl, content) {
        if (!content || !baseUrl) return content;

        // 处理M3U8内容中的相对路径
        return content.replace(/^(?!https?:\/\/|\/\/)(.+\.ts)/gm, baseUrl + '$1');
    }

    /**
     * 检查是否为完整的M3U8 - 移植自 cat-catch
     */
    function isFullM3u8(text) {
        let tsLists = text.split("\n");
        for (let ts of tsLists) {
            if (ts[0] == "#") { continue; }
            if (isUrl(ts)) { return true; }
            return false;
        }
        return false;
    }

    /**
     * 处理TS协议
     */
    function TsProtocol(text) {
        if (!text) return text;
        // 为没有协议的TS文件添加当前页面的协议
        return text.replace(/^(?!https?:\/\/)(.+\.ts)/gm, location.protocol + '//$1');
    }

    /**
     * 转换为URL并发送数据
     */
    function toUrl(text, ext = "m3u8") {
        if (!text) { return; }
        // 处理ts地址无protocol
        text = TsProtocol(text);
        if (isFullM3u8(text)) {
            let url = URL.createObjectURL(new Blob([new TextEncoder("utf-8").encode(text)]));
            postData({ action: "dogCatchAddMedia", url: url, href: location.href, ext: ext });
            return;
        }
        baseUrl.forEach((url) => {
            url = URL.createObjectURL(new Blob([new TextEncoder("utf-8").encode(addBaseUrl(url, text))]));
            postData({ action: "dogCatchAddMedia", url: url, href: location.href, ext: ext });
        });
        joinBaseUrlTask.push((url) => {
            url = URL.createObjectURL(new Blob([new TextEncoder("utf-8").encode(addBaseUrl(url, text))]));
            postData({ action: "dogCatchAddMedia", url: url, href: location.href, ext: ext });
        });
    }

    /**
     * 发送数据到background脚本
     */
    function postData(data) {
        let value = data.url ? data.url : data.key;
        if (value instanceof ArrayBuffer || value instanceof Array) {
            if (value.byteLength == 0) { return; }
            data.key = ArrayToBase64(value);
            value = data.key;
        }
        if (data.action == "dogCatchAddKey" && data.key && data.key.startsWith("AAAAAAAAAAAAAAAAAAAA")) {
            return;
        }
        if (filter.has(value)) { return false; }
        filter.add(value);
        data.requestId = Date.now().toString() + filter.size;

        // 在 Worker 中发送消息
        if (isRunningInWorker) {
            try {
                self.postMessage(data);
            } catch (e) {
                console.error('Dog-Catch Worker 发送消息失败:', e);
            }
            return;
        }

        // 在主线程中发送消息
        try {
            // 首先尝试通过 window.postMessage 发送（用于页面脚本）
            if (typeof window !== 'undefined' && window.postMessage) {
                window.postMessage(data, '*');
            }

            // 然后尝试通过 chrome.runtime 发送（用于内容脚本）
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                chrome.runtime.sendMessage({
                    Message: "addMedia",
                    url: data.url,
                    href: data.href,
                    extraExt: data.ext,
                    mime: data.mime,
                    requestId: data.requestId,
                    requestHeaders: data.requestHeaders
                });
            }
        } catch (e) {
            console.error('Dog-Catch 发送消息失败:', e);
        }
    }

    /**
     * 数组转Base64 - 移植自 cat-catch
     */
    function ArrayToBase64(data) {
        try {
            let bytes = new _Uint8Array(data);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += _fromCharCode(bytes[i]);
            }
            if (typeof _btoa == "function") {
                return _btoa(binary);
            }
            return _btoa(binary);
        } catch (e) {
            return false;
        }
    }

    /**
     * 处理Vimeo视频
     */
    async function vimeo(originalUrl, json) {
        if (!json || !regexVimeo.test(originalUrl) || videoSet.has(originalUrl)) return;

        const data = isJSON(json);
        if (!data?.base_url || !data?.video) return;

        videoSet.add(originalUrl);

        try {
            const url = new URL(originalUrl);
            const pathBase = url.pathname.substring(0, url.pathname.lastIndexOf('/')) + "/";
            const baseURL = new URL(url.origin + pathBase + data.base_url).href;

            let M3U8List = ["#EXTM3U", "#EXT-X-INDEPENDENT-SEGMENTS", "#EXT-X-VERSION:3"];

            for (let video of data.video) {
                if (!video.segments || video.segments.length === 0) continue;

                M3U8List.push(`#EXT-X-STREAM-INF:BANDWIDTH=${video.bitrate},RESOLUTION=${video.width}x${video.height}`);

                let segmentList = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:10"];

                for (let segment of video.segments) {
                    segmentList.push(`#EXTINF:${segment.duration},`);
                    segmentList.push(baseURL + segment.url);
                }

                segmentList.push("#EXT-X-ENDLIST");

                const segmentM3U8 = segmentList.join('\n');
                const segmentUrl = URL.createObjectURL(new Blob([segmentM3U8], { type: 'application/vnd.apple.mpegurl' }));
                M3U8List.push(segmentUrl);
            }

            M3U8List.push("#EXT-X-ENDLIST");
            const masterM3U8 = M3U8List.join('\n');
            const masterUrl = URL.createObjectURL(new Blob([masterM3U8], { type: 'application/vnd.apple.mpegurl' }));

            postData({ action: "dogCatchAddMedia", url: masterUrl, href: location.href, ext: "m3u8" });
        } catch (e) {
            console.error('处理Vimeo视频失败:', e);
        }
    }

    // 初始化完成
    DEBUG && console.log('Dog-Catch 深度搜索脚本已加载');

})();
