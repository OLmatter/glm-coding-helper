// ==UserScript==
// @name         智谱 GLM Coding Plan 抢购助手 + 本地 OCR 自动验证码
// @namespace    http://tampermonkey.net/
// @version      23.2
// @description  GLM Coding Rush / 智谱 GLM Coding Plan 抢购助手，一键抢购油猴脚本 / Tampermonkey userscript，配合本地 CPU/GPU OCR 自动识别中文点选验证码并点击，支持多窗口并发、限流重试和支付页安全保护
// @author       mumumi
// @include      https://*bigmodel.cn/glm-coding*
// @match        https://bigmodel.cn/glm-coding*
// @match        https://www.bigmodel.cn/glm-coding*
// @match        https://platform.minimaxi.com/*
// @match        https://*.gtimg.com/*
// @match        https://*.captcha.qcloud.com/*
// @include      https://*bigmodel.cn/html/rate-limit.html*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=bigmodel.cn
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      localhost:8888
// @connect      127.0.0.1:8888
// @connect      gtimg.com
// @connect      *.gtimg.com
// @connect      captcha.qcloud.com
// @connect      *.captcha.qcloud.com
// @connect      turing.captcha.qcloud.com
// @run-at       document-start
// @license      GNU GPLv3
// @source       https://greasyfork.org/zh-CN/scripts/572157-glm-coding-plan%E6%8A%A2%E8%B4%AD%E5%8A%A9%E6%89%8B
// @credit       Based on mumumi's GLM Coding Plan helper; thanks to the original author.
// ==/UserScript==
(function () {
    'use strict';
    const SCRIPT_VERSION = '23.2';
    const BOOT_BAR_ID = 'glm-helper-status-bar';
    const __glmHost = (() => { try { return location.hostname || ''; } catch { return ''; } })();
    const __inMiniMax = __glmHost === 'platform.minimaxi.com';
    if (__inMiniMax) {
        initMiniMaxTokenPlanEntry();
        return;
    }
    const __inTencentCaptchaFrame = __glmHost.includes('gtimg.com') || __glmHost.includes('captcha.qcloud.com');
    if (__inTencentCaptchaFrame) {
        initTencentCaptchaDirectBridge();
        return;
    }
    function initTencentCaptchaDirectBridge() {
        const DIRECT_OCR_URL = 'http://127.0.0.1:8888/captcha_direct';
        const RUNTIME_PAUSE_KEY = 'glm_runtime_paused_v1';
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        let solving = false;
        let lastBgUrl = '';
        const captchaCfg = (() => {
            try {
                const raw = GM_getValue('glm_coding_config_v5', '{}');
                return { AUTO_CAPTCHA_CLICK: true, AUTO_CAPTCHA_CONFIRM: false, ...JSON.parse(raw || '{}') };
            } catch {
                return { AUTO_CAPTCHA_CLICK: true, AUTO_CAPTCHA_CONFIRM: false };
            }
        })();
        function log(msg) {
            console.log('[glm-captcha-direct] ' + msg);
        }
        function isRuntimePaused() {
            try { return GM_getValue(RUNTIME_PAUSE_KEY, false) === true; } catch { return false; }
        }
        function visible(el) {
            if (!el) return false;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }
        function bgUrlFrom(el) {
            if (!el) return '';
            const text = (el.style && el.style.backgroundImage ? el.style.backgroundImage : '') || getComputedStyle(el).backgroundImage || '';
            const match = text.match(/url\(["']?([^"')]+)["']?\)/);
            if (!match) return '';
            try { return new URL(match[1], location.href).href; }
            catch { return match[1]; }
        }
        function findBgElement() {
            const selectors = [
                '#slideBg',
                '.tencent-captcha-dy__verify-bg-img',
                '[class*="verify-bg"]',
                '.tencent-captcha-dy__bg-img',
                '.tencent-captcha-dy__image-area',
            ];
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (visible(el) && bgUrlFrom(el)) return el;
            }
            return null;
        }
        function findPromptText() {
            const selectors = [
                '#instructionText',
                '.tencent-captcha-dy__header-text',
                '.tencent-captcha-dy__header-title-wrap .tencent-captcha-dy__header-text',
                '[class*="header-text"]',
            ];
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (!visible(el)) continue;
                const raw = (el.textContent || el.getAttribute('aria-label') || '').trim();
                const cleaned = raw
                    .replace(/^\s*\u8BF7\u4F9D\u6B21\u70B9\u51FB[:\uff1a]?\s*/, '')
                    .replace(/\s+/g, '');
                const chars = (cleaned.match(/[\u4e00-\u9fff]/g) || []).slice(-3);
                if (chars.length >= 3) return chars.join('');
            }
            return '';
        }
        function fetchImageDataUrl(url) {
            function doFetch() {
                return fetch(url, { credentials: 'include' })
                    .then(r => r.blob())
                    .then(blob => new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = () => reject(new Error('FileReader failed'));
                        reader.readAsDataURL(blob);
                    }));
            }
            function doGM() {
                return new Promise((resolve, reject) => {
                    if (typeof GM_xmlhttpRequest === 'undefined') {
                        reject(new Error('GM_xmlhttpRequest unavailable'));
                        return;
                    }
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url,
                        responseType: 'blob',
                        onload: (res) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = () => reject(new Error('FileReader failed'));
                            reader.readAsDataURL(res.response);
                        },
                        onerror: () => reject(new Error('image download failed')),
                    });
                });
            }
            return doFetch().catch(() => doGM());
        }
        function postDirect(dataUrl, chars) {
            const body = JSON.stringify({
                image: dataUrl,
                text: chars,
                ts: Date.now(),
                source: 'tencent_iframe_direct',
            });
            function doFetch() {
                return fetch(DIRECT_OCR_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                }).then(r => r.json());
            }
            function doGM() {
                return new Promise((resolve, reject) => {
                    if (typeof GM_xmlhttpRequest === 'undefined') {
                        reject(new Error('GM_xmlhttpRequest unavailable'));
                        return;
                    }
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: DIRECT_OCR_URL,
                        headers: { 'Content-Type': 'application/json' },
                        data: body,
                        onload: (res) => {
                            try { resolve(JSON.parse(res.responseText)); }
                            catch { reject(new Error('bad direct OCR JSON')); }
                        },
                        onerror: () => reject(new Error('direct OCR request failed')),
                    });
                });
            }
            return doFetch().catch(() => doGM());
        }
        function dispatchClick(el, nx, ny, label) {
            const rect = el.getBoundingClientRect();
            const win = el.ownerDocument.defaultView || window;
            const clientX = rect.left + nx * rect.width;
            const clientY = rect.top + ny * rect.height;
            const base = { bubbles: true, cancelable: true, view: win, clientX, clientY, button: 0, buttons: 1 };
            const pointer = { ...base, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: 0.5 };
            try { if (win.PointerEvent) el.dispatchEvent(new win.PointerEvent('pointerdown', pointer)); } catch {}
            el.dispatchEvent(new win.MouseEvent('mousedown', base));
            try { if (win.PointerEvent) el.dispatchEvent(new win.PointerEvent('pointerup', pointer)); } catch {}
            el.dispatchEvent(new win.MouseEvent('mouseup', base));
            el.dispatchEvent(new win.MouseEvent('click', base));
            log('clicked ' + (label || '') + ' @ ' + nx.toFixed(3) + ',' + ny.toFixed(3));
        }
        function clickConfirm() {
            const selectors = [
                '.verify-btn',
                '.tencent-captcha-dy__verify-confirm-btn',
                '.tencent-captcha-dy__btn-confirm',
                '.tencent-captcha-dy__footer .btn',
            ];
            for (const selector of selectors) {
                const btn = document.querySelector(selector);
                if (visible(btn)) {
                    btn.click();
                    log('confirm clicked: ' + selector);
                    return true;
                }
            }
            return false;
        }
        function hasError() {
            const note = document.querySelector('#tcaptcha_note, .tencent-captcha-dy__verify-error-text');
            return visible(note);
        }
        async function solveOnce() {
            if (isRuntimePaused()) return;
            if (!captchaCfg.AUTO_CAPTCHA_CLICK) return;
            const bgEl = findBgElement();
            if (!bgEl) return;
            const bgUrl = bgUrlFrom(bgEl);
            if (!bgUrl || bgUrl === lastBgUrl) return;
            const chars = findPromptText();
            if (chars.length < 3) return;
            if (hasError()) {
                const reload = document.querySelector('#reload, .tencent-captcha-dy__footer-icon--refresh img');
                if (reload) reload.click();
                lastBgUrl = '';
                return;
            }
            lastBgUrl = bgUrl;
            log('capture ' + chars + ' from ' + bgUrl.slice(0, 90));
            const dataUrl = await fetchImageDataUrl(bgUrl);
            const response = await postDirect(dataUrl, chars);
            const result = response && response.result;
            if (!result || !result.success || !Array.isArray(result.click_coords)) {
                log('direct OCR failed: ' + JSON.stringify(response).slice(0, 200));
                return;
            }
            for (const point of result.click_coords) {
                const nx = Number(point.nx);
                const ny = Number(point.ny);
                if (!Number.isFinite(nx) || !Number.isFinite(ny)) continue;
                dispatchClick(bgEl, nx, ny, point.char || '');
                await sleep(180);
            }
            await sleep(250);
            if (!isRuntimePaused() && captchaCfg.AUTO_CAPTCHA_CONFIRM) clickConfirm();
        }
        async function tick() {
            if (solving) return;
            solving = true;
            try { await solveOnce(); }
            catch (e) {
                log('error: ' + e.message);
                lastBgUrl = '';
            } finally {
                solving = false;
            }
        }
        log('started on ' + location.hostname);
        const observer = new MutationObserver(() => setTimeout(tick, 80));
        const root = document.body || document.documentElement;
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
        setTimeout(tick, 500);
        setInterval(tick, 1200);
    }
    // ── 去重保护：防止篡猴里装了改名导致的两个实例同时运行 ──────────────────
    function ensureStatusBarNode() {
        let bar = document.getElementById(BOOT_BAR_ID);
        if (bar) return bar;
        const parent = document.body || document.documentElement;
        if (!parent) return null;
        bar = document.createElement('div');
        bar.id = BOOT_BAR_ID;
        bar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;padding:7px 16px;font:13px/1.5 system-ui,sans-serif;color:#fff;display:flex;align-items:center;justify-content:space-between;box-shadow:0 -2px 8px rgba(0,0,0,.25);transition:background .4s';
        const text = document.createElement('span');
        const x = document.createElement('button');
        x.textContent = '×';
        x.style.cssText = 'background:rgba(255,255,255,.2);border:none;color:#fff;width:22px;height:22px;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;flex-shrink:0';
        x.onclick = () => { bar.remove(); };
        bar.append(text, x);
        parent.appendChild(bar);
        return bar;
    }
    function setBootBar(html, bg = '#1677ff') {
        const run = () => {
            const bar = ensureStatusBarNode();
            if (!bar) return;
            bar.style.background = bg;
            bar.firstElementChild.innerHTML = `🤖 <b>抢购助手 v${SCRIPT_VERSION}</b> &nbsp;|&nbsp; ${html}`;
        };
        if (document.body || document.documentElement) run();
        else document.addEventListener('DOMContentLoaded', run, { once: true });
    }
    function requestBackendHealth(timeoutMs = 2500) {
        return new Promise((resolve, reject) => {
            const url = 'http://127.0.0.1:8888/health?from=glm_helper_' + Date.now();
            let done = false;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                reject(new Error('timeout'));
            }, timeoutMs);
            function finish(ok, value) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                ok ? resolve(value) : reject(value);
            }
            if (typeof GM_xmlhttpRequest === 'function') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url,
                    timeout: timeoutMs,
                    onload: (res) => {
                        try { finish(true, JSON.parse(res.responseText || '{}')); }
                        catch (e) { finish(false, e); }
                    },
                    onerror: () => finish(false, new Error('request failed')),
                    ontimeout: () => finish(false, new Error('timeout')),
                });
                return;
            }
            fetch(url, { cache: 'no-store' })
                .then(r => r.json())
                .then(data => finish(true, data))
                .catch(e => finish(false, e));
        });
    }
    function bootBackendProbe() {
        setBootBar('准备中：默认不主动点击订阅；按 <b>F9</b> 开启自动点击，或等待 Rush 目标时间。正在检查本地 OCR 后端...', '#1677ff');
        requestBackendHealth().then((h) => {
            const ready = `${h.ready_workers ?? '?'} / ${h.workers ?? '?'}`;
            const status = h.status || 'unknown';
            const color = status === 'ok' ? '#237804' : '#d46b08';
            setBootBar(`已连接本地 OCR 后端：${status}，worker ${ready}，端口 ${h.port || 8888}。默认不自动点击订阅；按 <b>F9</b> 开启，按 <b>F8</b> 暂停。`, color);
        }).catch(() => {
            setBootBar('未连接本地 OCR 后端：请先启动后端 127.0.0.1:8888。脚本仍会准备页面，但验证码识别不可用；默认不自动点击订阅，按 <b>F9</b> 可手动开启。', '#d46b08');
        });
    }
    if (document.documentElement.dataset.glmHelper === '1') {
        setBootBar('检测到页面上已有一个抢购助手实例，本实例未重复启动。若没有状态提示，请在篡改猴里只保留最新版脚本。', '#d46b08');
        return;
    }
    document.documentElement.dataset.glmHelper = '1';
    bootBackendProbe();
    // ── 最早读配置（document-start 时还没有主流程）──────────────────────────
    const EARLY_STORAGE_KEY = 'glm_coding_config_v5';
    const SAFE_DEFAULTS_VERSION = 4;
    const _ec = (() => { try { return JSON.parse(GM_getValue(EARLY_STORAGE_KEY, '{}')); } catch { return {}; } })();
    if (_ec.SAFE_DEFAULTS_VERSION !== SAFE_DEFAULTS_VERSION) {
        _ec.AUTO_CLOSE_INVALID = false;
        _ec.AUTO_CLICK_SUB = false;
        const oldRushTarget = (_ec.RUSH_TARGET_HOUR == null && _ec.RUSH_TARGET_MIN == null && _ec.RUSH_TARGET_SEC == null) ||
            (Number(_ec.RUSH_TARGET_HOUR) === 9 && Number(_ec.RUSH_TARGET_MIN) === 59 && Number(_ec.RUSH_TARGET_SEC) === 58);
        if (oldRushTarget) {
            _ec.RUSH_TARGET_HOUR = 10;
            _ec.RUSH_TARGET_MIN = 0;
            _ec.RUSH_TARGET_SEC = 0;
        }
        if (_ec.RUSH_RELEASE_ADVANCE_MS == null || Number(_ec.RUSH_RELEASE_ADVANCE_MS) === 40) {
            _ec.RUSH_RELEASE_ADVANCE_MS = 0;
        }
        _ec.SAFE_DEFAULTS_VERSION = SAFE_DEFAULTS_VERSION;
        GM_setValue(EARLY_STORAGE_KEY, JSON.stringify(_ec));
    }
    const EARLY_AUTO_CLOSE_INVALID = _ec.AUTO_CLOSE_INVALID === true;
    const GLM_DISCOUNT_CODE = ['9G', 'XW', 'L9', 'KC', 'GZ'].join('');
    const GLM_CODING_URL = () => `https://www.bigmodel.cn/glm-coding?ic=${GLM_DISCOUNT_CODE}&closedialog=true`;
    function ensureDiscountEntry() {
        try {
            if (!/\/glm-coding(?:\/|$)/.test(location.pathname || '')) return false;
            const u = new URL(location.href);
            u.protocol = 'https:';
            u.hostname = 'www.bigmodel.cn';
            if (location.protocol === 'https:' && location.hostname === 'www.bigmodel.cn' &&
                u.searchParams.get('ic') === GLM_DISCOUNT_CODE && u.searchParams.get('closedialog') === 'true') return false;
            u.searchParams.set('ic', GLM_DISCOUNT_CODE);
            u.searchParams.set('closedialog', 'true');
            location.replace(u.toString());
            return true;
        } catch {
            return false;
        }
    }
    function initMiniMaxTokenPlanEntry() {
        const MINIMAX_CODE = ['IKhX', 'TPYb', 'QC'].join('');
        const MINIMAX_TOKEN_PLAN_URL = () => `https://platform.minimaxi.com/subscribe/token-plan?code=${MINIMAX_CODE}&source=link`;
        try {
            GM_registerMenuCommand('打开 MiniMax Token Plan 优惠入口', () => {
                location.href = MINIMAX_TOKEN_PLAN_URL();
            });
        } catch {}
        try {
            const u = new URL(location.href);
            if (u.pathname !== '/subscribe/token-plan') return;
            if (u.searchParams.get('code') === MINIMAX_CODE && u.searchParams.get('source') === 'link') return;
            u.searchParams.set('code', MINIMAX_CODE);
            u.searchParams.set('source', 'link');
            location.replace(u.toString());
        } catch {}
    }
    // ── 限流页立即跳回主页 ────────────────────────────────────────────────────
    if (!location.href.includes('rate-limit.html') && ensureDiscountEntry()) return;
    if (location.href.includes('rate-limit.html') && EARLY_AUTO_CLOSE_INVALID) {
        location.replace(GLM_CODING_URL());
        return;
    }
    if (location.href.includes('rate-limit.html')) {
        window.addEventListener('DOMContentLoaded', () => {
            const notice = document.createElement('div');
            notice.textContent = 'GLM Coding Helper: auto-close is disabled. Handle this rate-limit page manually, or enable auto-close in the helper config.';
            notice.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:10px 16px;background:#d46b08;color:#fff;font:14px/1.5 system-ui,sans-serif';
            document.body.appendChild(notice);
        });
        return;
    }
    // ── v8.0: 无条件激活售罄按钮 - JSON.parse 劫持 ──────────────────────────
    const _oP = JSON.parse;
    JSON.parse = function (t, r) {
        const o = _oP(t, r);
        try { (function f(x) {
            if (!x || typeof x !== 'object') return;
            if ('isSoldOut' in x && x.isSoldOut === true) x.isSoldOut = false;
            if ('soldOut'   in x && x.soldOut   === true) x.soldOut   = false;
            if ('disabled'  in x && x.disabled  === true && (x.price !== undefined || x.productId || x.title)) x.disabled = false;
            if ('stock'     in x && x.stock     === 0) x.stock = 999;
            for (const k in x) f(x[k]);
        })(o); } catch {}
        return o;
    };
    // ── 购买状态（fetch 拦截器 ↔ UI 主循环共享）─────────────────────────────
    const PS = {
        inProgress : false,
        result     : null,      // null | 'success' | 'sold_out' | 'busy' | 'error'
        bizId      : null,
        payAmount  : null,
        rawCode    : null,      // v8.9: 记录原始错误码(555/500等)
    };
    let everSucceeded = false;  // v8.9: 一旦拿到过有效 bizId，永不关闭弹窗
    // ── fetch 拦截（/api/biz/pay/preview 和 check）──────────────────────────
    const _oF = window.fetch;
    // v8.0: 从 Cookie 提取 token 和从页面提取组织/项目信息
    function getAuthHeaders() {
        const token = document.cookie.match(/bigmodel_token_production=([^;]+)/)?.[1] || '';
        const headers = {
            'authorization': token,
            'content-type': 'application/json;charset=UTF-8',
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'zh',
            'set-language': 'zh'
        };
        // 尝试从 localStorage 获取组织和项目 ID
        try {
            const orgId = localStorage.getItem('bigmodel_organization') || '';
            const projId = localStorage.getItem('bigmodel_project') || '';
            headers['bigmodel-organization'] = orgId;
            headers['bigmodel-project'] = projId;
        } catch {}
        return headers;
    }
    window.fetch = async function (...a) {
        const url = (typeof a[0] === 'string' ? a[0] : a[0]?.url) || '';
        // 拦截 preview：只发一次，不重试（验证码只能用一次）
        if (url.includes('/api/biz/pay/preview')) {
            PS.inProgress = true;
            PS.result     = null;
            PS.bizId      = null;
            PS.payAmount  = null;
            // 提取原始 body
            const [urlOrReq, init = {}] = a;
            let body = init.body;
            if (!body && urlOrReq instanceof Request) {
                body = await urlOrReq.clone().text();
            }
            const authHeaders = getAuthHeaders();
            try {
                const r = await _oF(url, {
                    method: 'POST',
                    headers: authHeaders,
                    body: body,
                    credentials: 'include'
                });
                const txt = await r.text();
                let d;
                try { d = _oP(txt); } catch { d = {}; }
                console.log('[GLM v8.0 DEBUG] preview响应:', d);
                console.log('[GLM v8.0 DEBUG] soldOut值:', d?.data?.soldOut, '类型:', typeof d?.data?.soldOut);
                if (d?.code === 200 && d?.data?.bizId) {
                    PS.result    = 'success';
                    PS.bizId     = d.data.bizId;
                    PS.payAmount = d.data.payAmount;
                    PS.inProgress = false;
                    everSucceeded = true;
                    return new Response(txt, { status: 200, headers: { 'Content-Type': 'application/json' } });
                } else if (d?.code === 555 || (d?.code >= 500 && d?.code !== 200)) {
                    console.log(`[GLM v8.9] preview 错误 code:${d?.code} msg:${d?.msg}，脚本将自动重试`);
                    PS.result = 'busy';
                    PS.rawCode = d?.code;
                    PS.inProgress = false;
                    return new Response(
                        JSON.stringify({ code: 500, msg: '系统繁忙，脚本自动重试中', data: null, success: false }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } }
                    );
                } else if (d?.code === 200 && d?.data?.soldOut === true) {
                    console.log('[GLM v8.9] preview返回200+soldOut，原样透传，脚本记录sold_out');
                    PS.result = 'sold_out';
                    PS.inProgress = false;
                    return new Response(txt, { status: r.status, headers: { 'Content-Type': 'application/json' } });
                } else {
                    console.log('[GLM v8.9] preview 非预期错误 code:', d?.code, 'msg:', d?.msg, '→ 标记busy');
                    PS.result = 'busy';
                    PS.rawCode = d?.code;
                    PS.inProgress = false;
                    return new Response(txt, { status: r.status, headers: { 'Content-Type': 'application/json' } });
                }
            } catch (e) {
                PS.result = 'error';
                PS.inProgress = false;
                throw e;
            }
        }
        // 拦截 check：如果 bizId 为 null，直接返回失败
        if (url.includes('/api/biz/pay/check')) {
            if (url.includes('bizId=null') || !PS.bizId) {
                return new Response(
                    '{"code":500,"msg":"无效的 bizId","data":null,"success":false}',
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                );
            }
        }
        const res = await _oF.apply(this, a);
        const rCt = res.headers.get('content-type') || '';
        if (rCt.includes('json') && (url.includes('/api/') || url.includes('bigmodel'))) {
            try {
                const txt = await res.clone().text();
                const mod = txt
                    .replace(/"isSoldOut"\s*:\s*true/g, '"isSoldOut":false')
                    .replace(/"soldOut"\s*:\s*true/g, '"soldOut":false')
                    .replace(/"stock"\s*:\s*0/g, '"stock":999')
                    .replace(/"disabled"\s*:\s*true/g, '"disabled":false')
                    .replace(/"available"\s*:\s*false/g, '"available":true')
                    .replace(/"purchasable"\s*:\s*false/g, '"purchasable":true');
                if (mod !== txt) console.log('[GLM v8.4] API响应已修改:', url.slice(0, 80));
                return new Response(mod, { status: res.status, statusText: res.statusText, headers: res.headers });
            } catch (e) { return res; }
        }
        return res;
    };
    // XHR 兜底（重定向到上方 fetch 拦截器）
    const _xO = XMLHttpRequest.prototype.open;
    const _xS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u, ...r) { this._u = u; this._m = m; return _xO.call(this, m, u, ...r); };
    XMLHttpRequest.prototype.send = function (...a) {
        if ((this._u || '').includes('/api/biz/pay/preview')) {
            const self = this;
            window.fetch(this._u, { method: this._m || 'POST', body: a[0], credentials: 'include' }).then(async r => {
                const txt = await r.text();
                const dp = (k, v) => Object.defineProperty(self, k, { value: v, configurable: true });
                dp('readyState', 4); dp('status', 200); dp('statusText', 'OK');
                dp('responseText', txt); dp('response', txt);
                const ev = new Event('readystatechange');
                if (typeof self.onreadystatechange === 'function') self.onreadystatechange(ev);
                self.dispatchEvent(ev);
                ['load', 'loadend'].forEach(t => {
                    const e = new ProgressEvent(t);
                    if (typeof self[`on${t}`] === 'function') self[`on${t}`](e);
                    self.dispatchEvent(e);
                });
            });
            return;
        }
        return _xS.apply(this, a);
    };
    // ── 每日套餐状态（localStorage，按日隔离）────────────────────────────────
    // -1未知  0进行中(重启复位)  1今日售罄  2今日已购
    const _today = new Date().toISOString().slice(0, 10);
    const _dsKey = `glm_ds_${_today}`;
    let _ds = (() => { try { return JSON.parse(localStorage.getItem(_dsKey) || '{}'); } catch { return {}; } })();
    Object.keys(_ds).forEach(k => { if (_ds[k] === 0) _ds[k] = -1; });
    _flush();
    function _flush()       { localStorage.setItem(_dsKey, JSON.stringify(_ds)); }
    function getS(t, p)     { return _ds[`${t}-${p}`] ?? -1; }
    function setS(t, p, v)  { _ds[`${t}-${p}`] = v; _flush(); }
    if (Object.values(_ds).includes(2)) {
        setTimeout(() => setBar('🎉 今日已订阅成功，脚本停止。', '#237804'), 800);
        return;
    }
    // ── 配置 ──────────────────────────────────────────────────────────────────
    const STORAGE_KEY = 'glm_coding_config_v5';
    const RUNTIME_PAUSE_KEY = 'glm_runtime_paused_v1';
    const TABS_MAP    = { 1: '连续包月', 2: '连续包季', 3: '连续包年' };
    const PKGS_MAP    = { 1: 'Lite',    2: 'Pro',      3: 'Max'      };
    const DEF = {
        TABS_PRIORITY     : '1',
        PACKAGES_PRIORITY : '2,3,1',
        CHECK_INTERVAL    : 80,
        SMART_REFRESH     : true,
        AUTO_CLOSE_INVALID: false,
        AUTO_CLICK_SUB    : false,
        AUTO_CAPTCHA_CLICK : true,
        AUTO_CAPTCHA_CONFIRM: false,
        CAPTCHA_CLICK_DELAY_MODE : 'range',
        CAPTCHA_CLICK_DELAY_MS   : 325,
        CAPTCHA_CLICK_DELAY_MIN_MS: 250,
        CAPTCHA_CLICK_DELAY_MAX_MS: 400,
        CAPTCHA_CLICK_DELAY_JITTER_PERCENT: 20,
        RUSH_ENABLED        : false,
        RUSH_TARGET_HOUR    : 10,
        RUSH_TARGET_MIN     : 0,
        RUSH_TARGET_SEC     : 0,
        RUSH_HOLD_WINDOW_MS : 10000,
        RUSH_RELEASE_ADVANCE_MS: 0,
        HOTKEY_PAUSE: 'F8',
        HOTKEY_AUTO_CLICK_SUB: 'F9',
    };
    function loadCfg() { try { const s = GM_getValue(STORAGE_KEY, null); return s ? { ...DEF, ...JSON.parse(s) } : { ...DEF }; } catch { return { ...DEF }; } }
    function saveCfg(c) { GM_setValue(STORAGE_KEY, JSON.stringify(c)); }
    const CFG = loadCfg();
    let runtimePaused = (() => { try { return GM_getValue(RUNTIME_PAUSE_KEY, false) === true; } catch { return false; } })();
    const RUSH_LATENCY_KEY = 'glm_rush_latency_v1';
    function rushNumber(value, fallback) {
        const n = parseInt(value, 10);
        return Number.isFinite(n) ? n : fallback;
    }
    function getRushTargetTimestamp(now = Date.now()) {
        const target = new Date(now);
        target.setHours(
            rushNumber(CFG.RUSH_TARGET_HOUR, 10),
            rushNumber(CFG.RUSH_TARGET_MIN, 0),
            rushNumber(CFG.RUSH_TARGET_SEC, 0),
            0
        );
        return target.getTime();
    }
    function getRushRemainingMs(now = Date.now()) {
        return getRushTargetTimestamp(now) - now;
    }
    function isRushTargetReached(now = Date.now()) {
        return CFG.RUSH_ENABLED && getRushRemainingMs(now) <= 0;
    }
    function readyModeText() {
        if (CFG.AUTO_CLICK_SUB) return `自动点击订阅已开启，${autoClickSubHotkey()} 可关闭`;
        if (CFG.RUSH_ENABLED) {
            const remaining = Math.max(0, getRushRemainingMs());
            if (remaining > 0) return `准备中：默认不主动点击订阅，按 ${autoClickSubHotkey()} 手动开启，或等待目标时间 <b>${fmt(remaining)}</b>`;
            return '目标时间已到：允许自动点击订阅';
        }
        return `准备中：默认不主动点击订阅，按 ${autoClickSubHotkey()} 开启，或手动点击订阅`;
    }
    function medianRush(values) {
        const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
        if (!sorted.length) return null;
        return sorted[Math.floor(sorted.length / 2)];
    }
    function computeRushReleaseAdvance(rttMs) {
        if (!Number.isFinite(rttMs)) return 0;
        const oneWay = Math.max(0, rttMs / 2);
        return Math.max(0, Math.min(180, Math.round(oneWay - 20)));
    }
    async function calibrateRushLatency() {
        if (!CFG.RUSH_ENABLED) return;
        const samples = [];
        const url = GLM_CODING_URL() + '&rush_probe=' + Date.now();
        for (let i = 0; i < 3; i++) {
            try {
                const t0 = performance.now();
                await fetch(url + '_' + i, { method: 'GET', credentials: 'include', cache: 'no-store' });
                samples.push(performance.now() - t0);
            } catch (e) {}
            if (i < 2) await new Promise(r => setTimeout(r, 160));
        }
        const rtt = medianRush(samples);
        if (rtt == null) return;
        const manualAdvance = Math.max(0, parseInt(CFG.RUSH_RELEASE_ADVANCE_MS, 10) || 0);
        const autoAdvance = computeRushReleaseAdvance(rtt);
        const advance = manualAdvance > 0 ? manualAdvance : autoAdvance;
        const payload = { rttMs: Math.round(rtt), advanceMs: advance, at: Date.now(), source: manualAdvance > 0 ? 'manual' : 'auto' };
        GM_setValue(RUSH_LATENCY_KEY, JSON.stringify(payload));
        console.log('[GLM] rush latency calibrated:', payload);
    }
    GM_registerMenuCommand('⚙️ 打开配置面板', openConfigPanel);
    GM_registerMenuCommand('🗑️ 清除今日套餐状态缓存', () => { localStorage.removeItem(_dsKey); alert('今日状态已清除，即将刷新。'); location.reload(); });
    GM_registerMenuCommand('🚀 一键多开窗口', openMultipleWindows);
    function normalizeHotkeyString(value, fallback = '') {
        const raw = String(value || '').trim();
        if (!raw) return fallback;
        const aliases = {
            esc: 'Escape',
            escape: 'Escape',
            ins: 'Insert',
            insert: 'Insert',
            del: 'Delete',
            delete: 'Delete',
            space: 'Space',
            ' ': 'Space',
            pause: 'Pause',
            home: 'Home',
            end: 'End',
            pgup: 'PageUp',
            pageup: 'PageUp',
            pgdn: 'PageDown',
            pagedown: 'PageDown',
        };
        const parts = raw.split('+').map(s => s.trim()).filter(Boolean);
        const mods = [];
        let key = '';
        for (const part of parts) {
            const lower = part.toLowerCase();
            if (lower === 'ctrl' || lower === 'control') { if (!mods.includes('Ctrl')) mods.push('Ctrl'); continue; }
            if (lower === 'alt') { if (!mods.includes('Alt')) mods.push('Alt'); continue; }
            if (lower === 'shift') { if (!mods.includes('Shift')) mods.push('Shift'); continue; }
            if (lower === 'meta' || lower === 'cmd' || lower === 'win') { if (!mods.includes('Meta')) mods.push('Meta'); continue; }
            if (/^f([1-9]|1[0-2])$/i.test(part)) key = part.toUpperCase();
            else if (aliases[lower]) key = aliases[lower];
            else if (part.length === 1) key = part.toUpperCase();
            else key = part;
        }
        if (!key) return fallback;
        return [...mods, key].join('+');
    }
    function hotkeyFromEvent(e) {
        const mods = [];
        if (e.ctrlKey) mods.push('Ctrl');
        if (e.altKey) mods.push('Alt');
        if (e.shiftKey) mods.push('Shift');
        if (e.metaKey) mods.push('Meta');
        let key = e.key || '';
        if (!key || ['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return '';
        if (key === ' ') key = 'Space';
        if (/^f([1-9]|1[0-2])$/i.test(key)) key = key.toUpperCase();
        else if (key.length === 1) key = key.toUpperCase();
        return [...mods, key].join('+');
    }
    function hotkeyMatches(e, hotkey) {
        return normalizeHotkeyString(hotkey) === hotkeyFromEvent(e);
    }
    const pauseHotkey = () => normalizeHotkeyString(CFG.HOTKEY_PAUSE, 'F8');
    const autoClickSubHotkey = () => normalizeHotkeyString(CFG.HOTKEY_AUTO_CLICK_SUB, 'F9');
    GM_registerMenuCommand(`⏯️ 暂停/恢复脚本 (${pauseHotkey()})`, toggleRuntimePause);
    GM_registerMenuCommand(`🖱️ 切换自动点击订阅 (${autoClickSubHotkey()})`, toggleAutoClickSub);
    function saveRuntimeCfgPatch(patch) {
        Object.assign(CFG, patch);
        saveCfg({ ...CFG });
    }
    function setRuntimePaused(paused, source = 'hotkey') {
        runtimePaused = paused === true;
        GM_setValue(RUNTIME_PAUSE_KEY, runtimePaused);
        if (runtimePaused) {
            setBar(`⏸️ 脚本已暂停（${source}）。${pauseHotkey()} 恢复。`, '#722ed1');
        } else {
            setBar(`▶️ 脚本已恢复（${source}）。`, '#237804');
        }
    }
    function toggleRuntimePause() {
        setRuntimePaused(!runtimePaused);
    }
    function toggleAutoClickSub() {
        const next = !CFG.AUTO_CLICK_SUB;
        saveRuntimeCfgPatch({ AUTO_CLICK_SUB: next });
        setBar(`${next ? '✅ 已开启' : '🛑 已关闭'}自动点击订阅（${autoClickSubHotkey()}）`, next ? '#237804' : '#d46b08');
    }
    function isEditableHotkeyTarget(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    }
    function handleControlHotkeys(e) {
        if (isEditableHotkeyTarget(e.target)) return false;
        if (hotkeyMatches(e, pauseHotkey())) {
            e.preventDefault();
            toggleRuntimePause();
            return true;
        }
        if (hotkeyMatches(e, autoClickSubHotkey())) {
            e.preventDefault();
            toggleAutoClickSub();
            return true;
        }
        return false;
    }
    // ── v8.0: ESC 键快速关闭弹窗 ──────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        if (handleControlHotkeys(e)) return;
        if (e.key === 'Escape' || e.keyCode === 27) {
            const busyDlg = document.querySelector('.el-dialog__wrapper .empty-data-wrap');
            if (busyDlg) {
                const wrapper = busyDlg.closest('.el-dialog__wrapper');
                if (wrapper && getComputedStyle(wrapper).display !== 'none') {
                    closeModal(wrapper);
                    console.log('[GLM] ESC 关闭系统繁忙弹窗');
                    return;
                }
            }
            const payDlg = getPayDialog();
            if (payDlg) {
                closePayDialog();
                console.log('[GLM] ESC 关闭支付弹窗');
            }
        } else if (e.key === 'Enter' || e.keyCode === 13 || e.key === ' ') {
            e.preventDefault();
            var confirmBtn = document.querySelector('.tencent-captcha-dy__verify-confirm-btn');
            if (confirmBtn) {
                var cr = confirmBtn.getBoundingClientRect();
                if (cr.width > 0 && cr.height > 0) {
                    confirmBtn.click();
                    console.log('[GLM] ' + e.key + ' 点击验证码确认按钮');
                    return;
                }
            }
            var altBtn = document.querySelector('.tencent-captcha-dy__btn-confirm');
            if (altBtn) {
                var ar = altBtn.getBoundingClientRect();
                if (ar.width > 0 && ar.height > 0) {
                    altBtn.click();
                    console.log('[GLM] ' + e.key + ' 点击验证码确认按钮(alt)');
                    return;
                }
            }
        }
    });
    // ── v8.0: 一键多开窗口函数 ────────────────────────────────────────────────
    function openMultipleWindows() {
        const count = prompt('请输入要打开的窗口数量（默认 2，上限 10；窗口越多越容易撞 RPM 风控，按需选择）:', '2');
        if (!count) return;
        const n = parseInt(count);
        if (isNaN(n) || n < 1 || n > 10) { alert('请输入 1-10 之间的数字'); return; }
        const baseUrl = GLM_CODING_URL();
        for (let i = 0; i < n; i++) {
            setTimeout(() => {
                const url = baseUrl + (i > 0 ? `&wi=${i}` : '');
                GM_openInTab(url, { active: false, insert: true, setParent: true });
            }, i * 300);
        }
        alert(`✅ 已打开 ${n} 个标签页！\n\n多窗口抢购流程：\n1. 每个窗口自动解验证码（不点确定）\n2. 等待到 10:00:00 + 错开时间\n3. 自动点击确认发送请求\n\n💡 窗口0最先点，之后每个错开2秒\n⚠️ 默认推荐 2 个窗口，单窗口单发是当前最稳的策略，多窗口会按窗口数放大请求数量，直接撞 RPM 上限`);
    }
    // ── 扫描队列（过滤今日已确认售罄）────────────────────────────────────────
    const tabs      = String(CFG.TABS_PRIORITY).split(',').map(Number).filter(Boolean);
    const pkgs      = String(CFG.PACKAGES_PRIORITY).split(',').map(Number).filter(Boolean);
    const allTargets = tabs.flatMap(t => pkgs.map(p => ({ tab: t, pkg: p })));
    const scanQueue = allTargets.filter(({ tab: t, pkg: p }) => getS(t, p) !== 1);
    if (!scanQueue.length) {
        scanQueue.push(...allTargets);
        setTimeout(() => setBar('📭 今日缓存显示全售罄，仍会重新扫描确认。', '#434343'), 800);
    }
    // ── 状态机变量 ────────────────────────────────────────────────────────────
    let state = 'SCANNING';   // SCANNING | TASK_UNIT | DONE
    // SCANNING / TASK_UNIT
    let qIdx = 0, sweepRestocks = [], lastTabSwitch = 0, sweepBusyCount = 0, emptySweepCount = 0;
    const soldOutHits = Object.create(null);
    let taskTarget = null, taskPhase = 'IDLE', taskClickTime = 0, taskRLCount = 0;
    let lastCloseReason = '';
    const MAX_RL = 3, MODAL_WAIT = 15000, EMPTY_SWEEP_CONFIRM = 3, SOLD_OUT_CONFIRM = 2;
    // ── 工具函数 ──────────────────────────────────────────────────────────────
    function parseRestock(text) {
        const m = (text || '').match(/0?(\d{1,2})月0?(\d{1,2})日\s*(\d{1,2}):0?(\d{1,2})/);
        if (!m) return null;
        const t = new Date(new Date().getFullYear(), +m[1] - 1, +m[2], +m[3], +m[4]);
        return { dateStr: `${+m[1]}月${+m[2]}日`, msUntil: t - Date.now() };
    }
    function todayStr() { const d = new Date(); return `${d.getMonth() + 1}月${d.getDate()}日`; }
    function fmt(ms) {
        if (ms <= 0) return '0秒';
        const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
        return h ? `${h}h${m % 60}m` : m ? `${m}分${s % 60}秒` : `${s}秒`;
    }
    function calcSleepMs(ms) {
        if (ms > 3600000) return 240000;
        if (ms > 1800000) return 180000;
        if (ms >  900000) return 120000;
        if (ms >  300000) return  60000;
        if (ms >  120000) return  30000;
        if (ms >   60000) return  10000;
        if (ms >   10000) return   3000;
        return 0;
    }
    function clampInt(value, min, max, fallback) {
        const n = parseInt(value, 10);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
    }
    function randInt(min, max) {
        min = Math.floor(Number(min) || 0);
        max = Math.floor(Number(max) || 0);
        if (max < min) { const t = min; min = max; max = t; }
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    function isRealBizId(id) { return id && !id.startsWith('debug-'); }
    // ── v8.19: 黄金时间判断（9:30-11:00）────────────────────────────────────
    function isGoldenTime() {
        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();
        const time = h * 60 + m;
        const start = 9 * 60 + 30;  // 9:30
        const end = 11 * 60 + 0;    // 11:00
        return time >= start && time <= end;
    }
    // ── DOM 访问 ──────────────────────────────────────────────────────────────
    const tabEl     = n => document.querySelectorAll('#switchTabBox .switch-tab-item')[n - 1];
    const btnEl     = n => document.querySelector(`.glm-coding-package-list > div:nth-child(${n}) > div > .package-card-btn-box > button`);
    const canBuy    = b => b && !b.disabled && !b.classList.contains('is-disabled') && !b.classList.contains('disabled') && !/售罄|补货|暂时/.test(b.innerText || '');
    const isSoldOut = b => /售罄|补货|暂时/.test(b?.innerText || '');
    const isBusy    = b => /抢购人数过多|请刷新/.test(b?.innerText || '');
    // ── 弹窗检测 ──────────────────────────────────────────────────────────────
    function findRLModal() {
        for (const w of document.querySelectorAll('.el-dialog__wrapper'))
            if (getComputedStyle(w).display !== 'none' && (w.innerText || '').includes('当前购买人数较多')) return w;
        return null;
    }
    function getPayDialog() {
        const d = document.querySelector('.pay-dialog');
        if (!d) return null;
        const w = d.closest('.el-dialog__wrapper');
        if (!w || getComputedStyle(w).display === 'none') return null;
        if ((w.innerText || '').includes('当前购买人数较多')) return null;
        return d;
    }
    function isPayDialog()     { return !!getPayDialog(); }
    function isSuccessDialog() {
        const w = document.querySelector('.pay-success-dialog-box')?.closest('.el-dialog__wrapper');
        return w ? getComputedStyle(w).display !== 'none' : false;
    }
    function closeModal(w)   { w?.querySelector('.el-dialog__close')?.click(); }
    function closePayDialog() {
        const d = getPayDialog();
        if (d) closeModal(d.closest('.el-dialog__wrapper'));
    }
    // ── v8.9: 小飞机检测：弹窗里出现系统繁忙的"小飞机"图标 ───────────────────
    function hasAirplaneInDialog() {
        const dlg = document.querySelector('.pay-dialog');
        if (!dlg) return false;
        return !!dlg.querySelector('.empty-data-wrap, .empty-data');
    }
    function isAirplanePayDialog(rlWrapper) {
        if (!rlWrapper) return false;
        return !!rlWrapper.querySelector('.pay-dialog .empty-data-wrap, .pay-dialog .empty-data');
    }
    // ── 对话框实付金额读取（双通道）──────────────────────────────────────────
    //   通道A：扫码区 .info-price 最后一个 <span>（纯数字，如"149"）
    //   通道B：计算明细区"实付金额"对应的 .price-item（含￥，如"￥149"）
    //
    //   两通道任一 > 0 即视为有效。
    function readDialogPrices() {
        const dlg = getPayDialog();
        if (!dlg) return null;
        // 通道A
        let scanPrice = 0;
        const infoPrice = dlg.querySelector('.info-price');
        if (infoPrice) {
            const spans = infoPrice.querySelectorAll('span');
            // price-icon 是 ￥，后面的 span 是数值
            for (let i = spans.length - 1; i >= 0; i--) {
                const v = parseFloat(spans[i].textContent.trim());
                if (!isNaN(v) && v > 0) { scanPrice = v; break; }
            }
        }
        // 通道B
        let actualPrice = 0;
        dlg.querySelectorAll('.calculate-content-item').forEach(li => {
            if ([...li.querySelectorAll('div')].some(d => d.textContent.includes('实付金额'))) {
                const v = parseFloat((li.querySelector('.price-item')?.textContent || '').replace(/[￥,]/g, '').trim());
                if (!isNaN(v) && v > 0) actualPrice = v;
            }
        });
        return { scanPrice, actualPrice, any: scanPrice > 0 || actualPrice > 0 };
    }
    // ── v8.9: 弹窗关闭决策（三态返回）────────────────────────────────────────
    // 返回: 'close' → 关弹窗试下一个 | 'keep' → 不关 | 'warn' → 异常，告知用户
    function checkPayDialog() {
        const dlg = getPayDialog();
        if (!dlg) return 'keep';
        if (window.__glmRushConfirmed) {
            window.__glmRushDialogSeen = 1;
            return 'keep';
        }
        // 只有当前拿到有效 bizId，才锁住支付弹窗，避免历史成功状态误判
        if (everSucceeded && PS.bizId) return 'keep';
        // 接口还没返回
        if (PS.inProgress) return 'keep';
        // ── 情况 A：接口 555 系统繁忙 → 关弹窗试下一个
        if (PS.result === 'busy') return 'close';
        // ── 情况 B：接口返回 200+soldOut → 关弹窗试下一个（但前端可能因 JSON.parse 劫持而正常显示了价格）
        if (PS.result === 'sold_out') {
            if (Date.now() - taskClickTime >= 1500) {
                const prices = readDialogPrices();
                if (prices?.any) {
                    console.log('[GLM v8.9] soldOut但DOM有价格，保留弹窗（前端劫持覆盖了soldOut）');
                    return 'keep';
                }
            }
            return 'close';
        }
        // ── 情况 D：接口没说售罄/繁忙，但弹窗里出现小飞机 → 异常不一致
        if (hasAirplaneInDialog()) return 'warn';
        // ── 情况 C：接口成功 + 有价格 → 不关
        return 'keep';
    }
    // ── 底部状态栏 ────────────────────────────────────────────────────────────
    var _bar = null;
    function setBar(html, bg = '#1677ff') {
        if (!_bar) {
            _bar = ensureStatusBarNode();
            if (!_bar) return;
        }
        _bar.style.background = bg;
        _bar.firstElementChild.innerHTML = `🤖 <b>抢购助手</b> &nbsp;|&nbsp; ${html}`;
    }
    // ── 支付报警：视口边框红色闪烁 ────────────────────────────────────────────
    let _alarm = null;
    function showPayAlarm() {
        if (_alarm) return;
        if (!document.getElementById('glm-alarm-s')) {
            const s = document.createElement('style'); s.id = 'glm-alarm-s';
            s.textContent = '@keyframes glm-al{0%,100%{box-shadow:inset 0 0 0 12px rgba(220,38,38,.92)}50%{box-shadow:inset 0 0 0 12px rgba(220,38,38,.08)}}';
            document.head.appendChild(s);
        }
        _alarm = document.createElement('div');
        _alarm.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;animation:glm-al .5s steps(1) infinite';
        const lbl = document.createElement('div');
        lbl.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);background:rgba(220,38,38,.95);color:#fff;padding:5px 22px;border-radius:20px;font:700 15px system-ui,sans-serif;white-space:nowrap;letter-spacing:.5px';
        lbl.textContent = '⚠️  请立即扫码支付！';
        _alarm.appendChild(lbl);
        document.body.appendChild(_alarm);
    }
    // ── 推广弹窗 ──────────────────────────────────────────────────────────────
    function triggerPromo() {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2147483645;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(5px);font-family:system-ui,sans-serif';
        ov.innerHTML = `
            <div style="background:#fff;width:480px;border-radius:16px;overflow:hidden;box-shadow:0 25px 50px -12px rgba(0,0,0,.5);max-height:90vh;display:flex;flex-direction:column">
                <div style="background:linear-gradient(135deg,#1e3c72,#2a5298);padding:24px 24px 20px;color:#fff">
                    <h2 style="margin:0 0 6px;font-size:20px">GLM Coding Plan 全部售罄 🫠</h2>
                    <p style="margin:0;opacity:.85;font-size:14px">配置的所有套餐今日已售罄，补货后脚本将继续监控</p>
                </div>
                <div style="padding:18px 20px;overflow-y:auto;flex:1;color:#333;font-size:14px;line-height:1.7">
                    <div>脚本已停止当前轮次。你可以保持页面打开，等下一轮补货时重新启动。</div>
                    <div style="margin-top:10px">当前使用作者内置 GLM Coding Plan 折扣入口</div>
                </div>
                <div style="padding:14px 20px;border-top:1px solid #f0f0f0;text-align:right">
                    <button id="promo-x" style="background:none;border:1px solid #ddd;color:#888;padding:7px 18px;border-radius:6px;cursor:pointer;font-size:13px">关闭并停止脚本</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        ov.querySelector('#promo-x').onclick = () => ov.remove();
        ov.onclick = e => { if (e.target === ov) ov.remove(); };
    }
    // ── 配置面板 ──────────────────────────────────────────────────────────────
    function buildTransferBox(ct, dataMap, selectedStr, title) {
        const sel   = selectedStr.split(',').filter(Boolean);
        const avail = Object.keys(dataMap).filter(k => !sel.includes(k));
        ct.innerHTML = `
            <div style="font-size:13px;font-weight:bold;margin-bottom:8px;color:#444">${title}</div>
            <div style="display:flex;align-items:stretch;gap:10px;margin-bottom:20px;height:140px">
                <div style="flex:1;border:1px solid #ddd;border-radius:6px;display:flex;flex-direction:column;background:#fafafa">
                    <div style="padding:6px 10px;border-bottom:1px solid #ddd;font-size:12px;color:#666;background:#f0f0f0;border-radius:6px 6px 0 0">备选池</div>
                    <ul class="tf-left" style="list-style:none;padding:5px;margin:0;flex:1;overflow-y:auto">
                        ${avail.map(k => `<li data-val="${k}" class="tf-item">${dataMap[k]}</li>`).join('')}
                    </ul>
                </div>
                <div style="display:flex;flex-direction:column;justify-content:center;gap:8px">
                    <button type="button" class="tf-btn tf-r">▶</button>
                    <button type="button" class="tf-btn tf-l">◀</button>
                </div>
                <div style="flex:1;border:1px solid #ddd;border-radius:6px;display:flex;flex-direction:column;background:#fff">
                    <div style="padding:6px 10px;border-bottom:1px solid #ddd;font-size:12px;color:#666;background:#e6f7ff;border-radius:6px 6px 0 0">选中且排序（自上而下）</div>
                    <ul class="tf-right" style="list-style:none;padding:5px;margin:0;flex:1;overflow-y:auto">
                        ${sel.map(k => `<li data-val="${k}" class="tf-item">${dataMap[k]}</li>`).join('')}
                    </ul>
                </div>
                <div style="display:flex;flex-direction:column;justify-content:center;gap:8px">
                    <button type="button" class="tf-btn tf-up">▲</button>
                    <button type="button" class="tf-btn tf-dn">▼</button>
                </div>
            </div>`;
        const L = ct.querySelector('.tf-left'), R = ct.querySelector('.tf-right');
        ct.querySelectorAll('ul').forEach(ul => ul.addEventListener('click', e => {
            if (e.target.tagName === 'LI') { ct.querySelectorAll('.tf-item').forEach(i => i.classList.remove('active')); e.target.classList.add('active'); }
        }));
        ct.querySelector('.tf-r').onclick  = () => { const a = L.querySelector('.active'); if (a) { R.appendChild(a); a.classList.remove('active'); } };
        ct.querySelector('.tf-l').onclick  = () => { const a = R.querySelector('.active'); if (a) { L.appendChild(a); a.classList.remove('active'); } };
        ct.querySelector('.tf-up').onclick = () => { const a = R.querySelector('.active'); if (a?.previousElementSibling) R.insertBefore(a, a.previousElementSibling); };
        ct.querySelector('.tf-dn').onclick = () => { const a = R.querySelector('.active'); if (a?.nextElementSibling) R.insertBefore(a.nextElementSibling, a); };
        return () => [...R.querySelectorAll('.tf-item')].map(i => i.dataset.val).join(',');
    }
    function openConfigPanel() {
        document.getElementById('glm-cfg-ov')?.remove();
        const delayMin = Number.isFinite(parseInt(CFG.CAPTCHA_CLICK_DELAY_MIN_MS, 10)) ? parseInt(CFG.CAPTCHA_CLICK_DELAY_MIN_MS, 10) : 250;
        const delayMaxRaw = Number.isFinite(parseInt(CFG.CAPTCHA_CLICK_DELAY_MAX_MS, 10)) ? parseInt(CFG.CAPTCHA_CLICK_DELAY_MAX_MS, 10) : 400;
        const delayMax = Math.max(delayMin, delayMaxRaw);
        if (!document.getElementById('glm-tf-s')) {
            const s = document.createElement('style'); s.id = 'glm-tf-s';
            s.textContent = '.tf-item{padding:6px 10px;margin-bottom:4px;border-radius:4px;cursor:pointer;font-size:13px;color:#333;border:1px solid transparent;transition:all .15s}.tf-item:hover{background:#f5f5f5}.tf-item.active{background:#e6f7ff;border-color:#91d5ff;color:#1890ff;font-weight:700}.tf-btn{padding:4px 8px;font-size:10px;cursor:pointer;border:1px solid #d9d9d9;border-radius:4px;background:#fff;color:#555;height:28px;transition:.2s}.tf-btn:hover{border-color:#40a9ff;color:#40a9ff}';
            document.head.appendChild(s);
        }
        const ov = document.createElement('div'); ov.id = 'glm-cfg-ov';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2147483646;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);font-family:system-ui,sans-serif';
        const panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;color:#333;width:560px;padding:24px;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.3);max-height:90vh;overflow-y:auto';
        panel.innerHTML = `
            <h3 style="margin:0 0 20px;font-size:18px;color:#1a1a1a">⚙️ 抢购助手配置</h3>
            <div id="glm-wp"></div>
            <div id="glm-wt"></div>
            <div style="margin-bottom:20px;padding-top:10px;border-top:1px dashed #eee;display:flex;flex-direction:column;gap:12px">
                <label style="display:flex;align-items:center;cursor:pointer">
                    <input type="checkbox" id="glm-sm" ${CFG.SMART_REFRESH ? 'checked' : ''} style="margin-right:8px">
                    <span style="font-size:14px;color:#555">启用智能刷新（梯度嗅探补货时间）</span>
                </label>
                <label style="display:flex;align-items:center;cursor:pointer">
                    <input type="checkbox" id="glm-aci" ${CFG.AUTO_CLOSE_INVALID ? 'checked' : ''} style="margin-right:8px">
                    <span style="font-size:14px;color:#555">自动关闭无效支付/限流弹窗（默认关闭）</span>
                    <span title="默认关闭，需手动开启才会自动关闭。&#10;开启后自动关闭以下弹窗并重试：&#10;1. 接口返回售罄但前端弹出的支付弹窗（二维码支付链接缺参数，扫码也无法付款）&#10;2. 限流弹窗（自动关闭后继续重试）&#10;关闭后遇到异常弹窗会停脚本，需手动处理" style="margin-left:6px;cursor:help;color:#999;font-size:14px;border:1px solid #ccc;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;line-height:1">?</span>
                </label>
                <label style="display:flex;align-items:center;cursor:pointer">
                    <input type="checkbox" id="glm-acs" ${CFG.AUTO_CLICK_SUB ? 'checked' : ''} style="margin-right:8px">
                    <span style="font-size:14px;color:#555">自动点击订阅（默认关闭）</span>
                    <span title="默认关闭，避免脚本加载后自动触发购买链路。&#10;开启后脚本发现可购买的套餐会自动点击订阅按钮；也可用快捷键临时开启。&#10;Rush mode 到目标时间后可自动点击。" style="margin-left:6px;cursor:help;color:#999;font-size:14px;border:1px solid #ccc;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;line-height:1">?</span>
                </label>
                <label style="display:flex;align-items:center;cursor:pointer">
                    <input type="checkbox" id="glm-acc" ${CFG.AUTO_CAPTCHA_CLICK ? 'checked' : ''} style="margin-right:8px">
                    <span style="font-size:14px;color:#555">自动点击验证码文字</span>
                    <span title="开启后会把本地识别出的验证码文字坐标自动点到图上。关闭后只识别和记录，不自动点图。" style="margin-left:6px;cursor:help;color:#999;font-size:14px;border:1px solid #ccc;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;line-height:1">?</span>
                </label>
                <label style="display:flex;align-items:center;cursor:pointer">
                    <input type="checkbox" id="glm-acf" ${CFG.AUTO_CAPTCHA_CONFIRM ? 'checked' : ''} style="margin-right:8px">
                    <span style="font-size:14px;color:#555">自动点击验证码确定</span>
                    <span title="默认关闭。开启后点完验证码文字会自动点确定；关闭后需要你手动点确定。" style="margin-left:6px;cursor:help;color:#999;font-size:14px;border:1px solid #ccc;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;line-height:1">?</span>
                </label>
                <div style="padding-left:26px;display:flex;flex-direction:column;gap:10px">
                    <div style="display:flex;align-items:center;gap:8px">
                        <span style="font-size:13px;color:#666">验证码点字延时策略</span>
                        <span title="每次点字都会在最小值和最大值之间随机取一个延时。" style="cursor:help;color:#999;font-size:14px;border:1px solid #ccc;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;line-height:1">?</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <span style="font-size:13px;color:#888">最小延时</span>
                        <input type="number" id="glm-cdmin" value="${delayMin}" min="1" max="10000" style="width:72px;padding:3px 6px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;text-align:center">
                        <span style="font-size:13px;color:#888">ms</span>
                        <span style="font-size:13px;color:#888">最大延时</span>
                        <input type="number" id="glm-cdmax" value="${delayMax}" min="1" max="10000" style="width:72px;padding:3px 6px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;text-align:center">
                        <span style="font-size:13px;color:#888">ms</span>
                    </div>
                </div>
                <div style="border-top:1px dashed #eee;padding-top:12px;margin-top:4px"></div>
                <label style="display:flex;align-items:center;cursor:pointer">
                    <input type="checkbox" id="glm-re" ${CFG.RUSH_ENABLED ? 'checked' : ''} style="margin-right:8px">
                    <span style="font-size:14px;color:#555">冲刺模式（定时确认）</span>
                    <span title="开启后，脚本目标时间前不会自动点击订阅；目标时间已到才允许进入购买链路。验证码确定仍按实测 RTT 保守释放：不早于预测安全点，不晚于目标时间。" style="margin-left:6px;cursor:help;color:#999;font-size:14px;border:1px solid #ccc;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;line-height:1">?</span>
                </label>
                <div style="display:flex;align-items:center;gap:6px;padding-left:26px">
                    <span style="font-size:13px;color:#888">目标时间</span>
                    <input type="number" id="glm-rh" value="${CFG.RUSH_TARGET_HOUR}" min="0" max="23" style="width:52px;padding:3px 6px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;text-align:center">
                    <span style="font-size:14px;color:#888">:</span>
                    <input type="number" id="glm-rm" value="${CFG.RUSH_TARGET_MIN}" min="0" max="59" style="width:52px;padding:3px 6px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;text-align:center">
                    <span style="font-size:14px;color:#888">:</span>
                    <input type="number" id="glm-rs" value="${CFG.RUSH_TARGET_SEC}" min="0" max="59" style="width:52px;padding:3px 6px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;text-align:center">
                </div>
                <div style="border-top:1px dashed #eee;padding-top:12px;margin-top:4px"></div>
                <div style="padding-left:26px;display:flex;flex-direction:column;gap:8px">
                    <div style="display:flex;align-items:center;gap:8px">
                        <span style="font-size:13px;color:#666">快捷键</span>
                        <span title="默认使用外挂工具常见的单键 F8/F9，避开浏览器常见快捷键。点输入框后直接按想设置的键；在输入框、文本框、下拉框和可编辑区域内不会触发快捷键。" style="cursor:help;color:#999;font-size:14px;border:1px solid #ccc;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;line-height:1">?</span>
                    </div>
                    <div style="display:grid;grid-template-columns:120px 1fr;gap:8px;align-items:center">
                        <span style="font-size:13px;color:#888">暂停/恢复</span>
                        <input id="glm-hk-pause" value="${pauseHotkey()}" readonly style="width:120px;padding:5px 8px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;text-align:center;background:#fafafa;cursor:pointer">
                        <span style="font-size:13px;color:#888">自动点击订阅</span>
                        <input id="glm-hk-sub" value="${autoClickSubHotkey()}" readonly style="width:120px;padding:5px 8px;border:1px solid #d9d9d9;border-radius:4px;font-size:13px;text-align:center;background:#fafafa;cursor:pointer">
                    </div>
                    <div style="font-size:12px;color:#999">推荐：F8/F9、Insert/Home/End。避免 F5/F11/F12、Ctrl/Alt 组合和输入法快捷键。</div>
                </div>
            </div>
            <div style="display:flex;justify-content:space-between;gap:10px">
                <button id="glm-multi" style="padding:8px 16px;border:1px solid #52c41a;background:#f6ffed;color:#52c41a;border-radius:6px;cursor:pointer;font-weight:600">🚀 一键多开</button>
                <div style="display:flex;gap:10px">
                    <button id="glm-cc" style="padding:8px 16px;border:1px solid #ddd;background:#f5f5f5;border-radius:6px;cursor:pointer;color:#666">取消</button>
                    <button id="glm-cs" style="padding:8px 20px;border:none;background:#1890ff;color:#fff;border-radius:6px;cursor:pointer;font-weight:700">保存并刷新</button>
                </div>
            </div>`;
        ov.appendChild(panel);
        document.body.appendChild(ov);
        const getPkgs = buildTransferBox(document.getElementById('glm-wp'), PKGS_MAP, CFG.PACKAGES_PRIORITY, '套餐优先级');
        const getTabs = buildTransferBox(document.getElementById('glm-wt'), TABS_MAP, CFG.TABS_PRIORITY, '订阅周期优先级');
        function bindHotkeyInput(input) {
            input.title = '点击后按键录入';
            input.addEventListener('keydown', e => {
                e.preventDefault();
                e.stopPropagation();
                const hk = hotkeyFromEvent(e);
                if (hk) input.value = hk;
            });
            input.addEventListener('focus', () => input.select());
        }
        bindHotkeyInput(panel.querySelector('#glm-hk-pause'));
        bindHotkeyInput(panel.querySelector('#glm-hk-sub'));
        panel.querySelector('#glm-cc').onclick = () => ov.remove();
        panel.querySelector('#glm-multi').onclick = () => { openMultipleWindows(); };
        panel.querySelector('#glm-cs').onclick = () => {
            const p = getPkgs(), t = getTabs();
            if (!p || !t) { alert('请至少各选一个！'); return; }
            saveCfg({
                TABS_PRIORITY     : t,
                PACKAGES_PRIORITY : p,
                SMART_REFRESH     : panel.querySelector('#glm-sm').checked,
                CHECK_INTERVAL    : CFG.CHECK_INTERVAL,
                AUTO_CLOSE_INVALID: panel.querySelector('#glm-aci').checked,
                AUTO_CLICK_SUB    : panel.querySelector('#glm-acs').checked,
                AUTO_CAPTCHA_CLICK: panel.querySelector('#glm-acc').checked,
                AUTO_CAPTCHA_CONFIRM: panel.querySelector('#glm-acf').checked,
                CAPTCHA_CLICK_DELAY_MODE: 'range',
                CAPTCHA_CLICK_DELAY_MS: Math.round((parseInt(panel.querySelector('#glm-cdmin').value, 10) + parseInt(panel.querySelector('#glm-cdmax').value, 10)) / 2),
                CAPTCHA_CLICK_DELAY_MIN_MS: parseInt(panel.querySelector('#glm-cdmin').value, 10),
                CAPTCHA_CLICK_DELAY_MAX_MS: parseInt(panel.querySelector('#glm-cdmax').value, 10),
                CAPTCHA_CLICK_DELAY_JITTER_PERCENT: CFG.CAPTCHA_CLICK_DELAY_JITTER_PERCENT,
                RUSH_ENABLED: panel.querySelector('#glm-re').checked,
                RUSH_TARGET_HOUR: parseInt(panel.querySelector('#glm-rh').value, 10),
                RUSH_TARGET_MIN: parseInt(panel.querySelector('#glm-rm').value, 10),
                RUSH_TARGET_SEC: parseInt(panel.querySelector('#glm-rs').value, 10),
                RUSH_RELEASE_ADVANCE_MS: CFG.RUSH_RELEASE_ADVANCE_MS,
                HOTKEY_PAUSE: normalizeHotkeyString(panel.querySelector('#glm-hk-pause').value, 'F8'),
                HOTKEY_AUTO_CLICK_SUB: normalizeHotkeyString(panel.querySelector('#glm-hk-sub').value, 'F9'),
                SAFE_DEFAULTS_VERSION,
            });
            ov.remove(); alert('已保存，即将刷新。'); location.reload();
        };
        ov.onclick = e => { if (e.target === ov) ov.remove(); };
    }
    // ═══════════════════════════════════════════════════════════════════════════
    //  主循环
    // ═══════════════════════════════════════════════════════════════════════════
    function tick() {
        if (state === 'DONE') return;
        if (runtimePaused) {
            setBar(`⏸️ 脚本已暂停。${pauseHotkey()} 恢复。`, '#722ed1');
            return;
        }
        if (window.__glmRushConfirmed && window.__glmRushDialogSeen && !getPayDialog()) {
            window.__glmRushConfirmed = 0;
            window.__glmRushDialogSeen = 0;
            console.log('[GLM] rush lock cleared');
        }
        if (ensureDiscountEntry()) return;
        if (state === 'TASK_UNIT') { doTaskUnit(); return; }
        doScan();
    }
    // ═══════════════════════════════════════════════════════════════════════════
    //  SCANNING / TASK_UNIT 逻辑
    // ═══════════════════════════════════════════════════════════════════════════
    function doScan() {
        if (qIdx >= scanQueue.length) { onSweepDone(); return; }
        const { tab, pkg } = scanQueue[qIdx];
        const te = tabEl(tab);
        if (!te) return;
        if (!te.classList.contains('active')) {
            te.click(); te.scrollIntoView({ behavior: 'auto', block: 'center' });
            lastTabSwitch = Date.now(); setBar(`🔄 切换到 ${TABS_MAP[tab]}...`); return;
        }
        if (Date.now() - lastTabSwitch < 400) return;
        const b = btnEl(pkg);
        if (canBuy(b)) {
            taskTarget = { tab, pkg }; taskPhase = 'IDLE'; taskRLCount = 0;
            soldOutHits[`${tab}-${pkg}`] = 0;
            setS(tab, pkg, 0); state = 'TASK_UNIT';
            setBar(`🎯 发现可购！${TABS_MAP[tab]} · ${PKGS_MAP[pkg]}，${readyModeText()}`, CFG.RUSH_ENABLED && !CFG.AUTO_CLICK_SUB ? '#722ed1' : '#389e0d');
            return;
        }
        if (isBusy(b)) {
            sweepBusyCount++;
            setBar(`⚡ 系统繁忙 ${TABS_MAP[tab]} · ${PKGS_MAP[pkg]}，跳过...`);
            qIdx++; return;
        }
        const ri = parseRestock(b?.innerText);
        if (ri?.dateStr === todayStr() && ri.msUntil > 0) sweepRestocks.push(ri);
        setBar(`🔍 扫描 ${TABS_MAP[tab]} · ${PKGS_MAP[pkg]} (${qIdx + 1}/${scanQueue.length})`);
        qIdx++;
    }
    function onSweepDone() {
        if (sweepBusyCount >= scanQueue.length) {
            setBar('⚠️ 所有套餐当前都在系统繁忙，刷新页面重试...', '#d46b08');
            setTimeout(() => location.replace(GLM_CODING_URL()), 1500);
            return;
        }
        if (!sweepRestocks.length) {
            emptySweepCount++;
            qIdx = 0; sweepRestocks = []; sweepBusyCount = 0;
            if (emptySweepCount < EMPTY_SWEEP_CONFIRM) {
                setBar(`📭 暂未发现可买/补货时间，继续确认 ${emptySweepCount}/${EMPTY_SWEEP_CONFIRM}...`, '#434343');
                return;
            }
            emptySweepCount = 0;
            setBar('📭 连续多轮未发现库存，继续高频扫描...', '#434343');
            return;
        }
        emptySweepCount = 0;
        sweepRestocks.sort((a, b) => a.msUntil - b.msUntil);
        const nearest = sweepRestocks[0];
        const sleep   = calcSleepMs(nearest.msUntil);
        qIdx = 0; sweepRestocks = []; sweepBusyCount = 0;
        if (sleep === 0) {
            setBar(`⚡ 补货倒计时 <b>${fmt(nearest.msUntil)}</b>，高频监控！`, '#d4380d');
            return;
        }
        if (CFG.SMART_REFRESH) {
            setBar(`🕙 补货还需 <b>${fmt(nearest.msUntil)}</b>，持续扫描中`, '#434343');
        }
    }
    function doTaskUnit() {
        const { tab, pkg } = taskTarget;
        const te = tabEl(tab);
        if (!te) return;
        if (!te.classList.contains('active')) { te.click(); return; }
        const b = btnEl(pkg);
        if (taskPhase === 'IDLE') {
            if (isSoldOut(b)) { exitTask(); return; }
            if (!canBuy(b)) {
                setBar(`⏳ 等待按钮就绪... ${TABS_MAP[tab]} · ${PKGS_MAP[pkg]}`, '#d46b08');
                return;
            }
            const rushReached = isRushTargetReached();
            if (!CFG.AUTO_CLICK_SUB && !rushReached) {
                if (CFG.RUSH_ENABLED) {
                    const remaining = Math.max(0, getRushRemainingMs());
                    setBar(`🎯 <b>发现可购！${TABS_MAP[tab]} · ${PKGS_MAP[pkg]}</b>，冲刺模式等待目标时间 <b>${fmt(remaining)}</b>；也可按 ${autoClickSubHotkey()} 手动开启自动点击`, '#722ed1');
                } else {
                    setBar(`🎯 <b>发现可购！${TABS_MAP[tab]} · ${PKGS_MAP[pkg]}</b>，默认不自动点击；请手动点击或按 ${autoClickSubHotkey()} 开启`, '#389e0d');
                }
                return;
            }
            PS.result = null; PS.inProgress = true;
            b.click(); taskClickTime = Date.now(); taskPhase = 'WAITING';
            setBar(`🔄 已点击，接口重试中... ${TABS_MAP[tab]} · ${PKGS_MAP[pkg]}（限流 ${taskRLCount}/${MAX_RL}）`, '#d46b08');
            return;
        }
        if (taskPhase === 'WAITING') {
            const rlw = findRLModal();
            if (rlw) {
                if (isAirplanePayDialog(rlw)) {
                    if (PS.result !== 'busy' && PS.result !== 'sold_out') {
                        setBar('⚠️ API返回200但弹窗显示小飞机（"购买人数较多"），可能是前后端不一致。不自动关闭，请手动确认后关闭弹窗，脚本会继续。', '#ff4d4f');
                        return;
                    }
                    if (!CFG.AUTO_CLOSE_INVALID) {
                        state = 'DONE';
                        setBar('Auto-close is disabled. Please check this payment/rate-limit popup manually.', '#d46b08');
                        return;
                    }
                    closeModal(rlw);
                    const curName = `${TABS_MAP[tab]}·${PKGS_MAP[pkg]}`;
                    const nextIdx = qIdx + 1;
                    const isLoop = nextIdx >= scanQueue.length;
                    qIdx = isLoop ? 0 : nextIdx;
                    taskTarget = null; taskPhase = 'IDLE'; taskRLCount = 0;
                    state = 'SCANNING';
                    const reason = PS.result === 'busy'
                        ? `✈️ 系统繁忙(${PS.rawCode || 555})，关闭弹窗`
                        : `📉 ${curName} 售罄`;
                    lastCloseReason = reason;
                    setBar(`${reason}，${isLoop ? '🔄 轮询一圈，从头重试...' : '试下一个...'}`, '#d46b08');
                    return;
                }
                if (!CFG.AUTO_CLOSE_INVALID) {
                    setBar('⚠️ 限流弹窗（"购买人数较多"），请手动关闭后重试', '#d46b08');
                    return;
                }
                closeModal(rlw); taskRLCount++;
                if (taskRLCount >= MAX_RL) {
                    if (isGoldenTime()) {
                        setBar('🔥 黄金时间！连续限流但禁止刷新，继续重试！', '#ff4d4f');
                        taskRLCount = 0; taskPhase = 'IDLE';
                    } else {
                        setBar(`🔁 连续 ${MAX_RL} 次限流，即将刷新...`, '#cf1322');
                        setTimeout(() => location.replace(GLM_CODING_URL()), 50);
                    }
                    return;
                }
                setBar(`⚠️ 限流 ${taskRLCount}/${MAX_RL}，自动关闭后重试...`, '#d46b08');
                taskPhase = 'IDLE'; return;
            }
            if (isPayDialog()) {
                const verdict = checkPayDialog();
                if (verdict === 'close') {
                    if (!CFG.AUTO_CLOSE_INVALID) {
                        state = 'DONE';
                        setBar('⚠️ 检测到异常支付弹窗，请手动确认是否需要扫码！', '#d46b08');
                        return;
                    }
                    const reason = PS.result === 'busy'
                        ? `✈️ 系统繁忙(${PS.rawCode || 555})，关闭弹窗`
                        : `📉 ${TABS_MAP[taskTarget.tab]}·${PKGS_MAP[taskTarget.pkg]} 售罄`;
                    closePayDialog();
                    lastCloseReason = reason;
                    const nextIdx = qIdx + 1;
                    const isLoop = nextIdx >= scanQueue.length;
                    qIdx = isLoop ? 0 : nextIdx;
                    taskTarget = null; taskPhase = 'IDLE'; taskRLCount = 0;
                    state = 'SCANNING';
                    setBar(`${reason}，${isLoop ? '🔄 轮询一圈，从头重试...' : '试下一个...'} `, '#d46b08');
                    return;
                }
                if (verdict === 'warn') {
                    setBar('⚠️ 弹窗显示小飞机但API未返回繁忙/售罄，前后端不一致。不自动关闭，请手动确认。如果有二维码请扫码支付！', '#ff4d4f');
                    return;
                }
                const prices = readDialogPrices();
                if (everSucceeded && PS.bizId || prices?.any) {
                    state = 'DONE';
                    if (everSucceeded && PS.bizId) showPayAlarm();
                    setBar('💳 <b>支付弹窗已出现！请立即扫码支付！</b> 脚本已停止。', '#16a34a');
                } else {
                    setBar(`🔄 ${TABS_MAP[tab]}·${PKGS_MAP[pkg]} 弹窗等待确认...`, '#1677ff');
                }
                return;
            }
            if (isSuccessDialog()) {
                setS(tab, pkg, 2); state = 'DONE';
                setBar('🎉 订阅成功！恭喜！', '#237804'); return;
            }
            if (!PS.inProgress && PS.result === 'sold_out' && Date.now() - taskClickTime > 2000) {
                exitTask(); return;
            }
            const elapsed = Date.now() - taskClickTime;
            const prefix = lastCloseReason ? `${lastCloseReason} → ` : '';
            if (PS.inProgress) {
                setBar(`${prefix}⏳ ${TABS_MAP[tab]}·${PKGS_MAP[pkg]} 接口请求中... (${(elapsed/1000).toFixed(1)}s)`, '#1677ff');
            } else {
                setBar(`${prefix}🔐 ${TABS_MAP[tab]}·${PKGS_MAP[pkg]} 等待验证码... (${(elapsed/1000).toFixed(1)}s)`, '#1677ff');
            }
            if (elapsed > MODAL_WAIT) {
                if (isSoldOut(b)) exitTask(); else taskPhase = 'IDLE';
            }
        }
    }
    function exitTask() {
        // v8.0: 黄金时间内不标记售罄，持续重试
        if (!isGoldenTime()) {
            const key = `${taskTarget.tab}-${taskTarget.pkg}`;
            soldOutHits[key] = (soldOutHits[key] || 0) + 1;
            if (soldOutHits[key] >= SOLD_OUT_CONFIRM) setS(taskTarget.tab, taskTarget.pkg, 1);
        }
        setBar(`📦 ${TABS_MAP[taskTarget.tab]} · ${PKGS_MAP[taskTarget.pkg]} 售罄，继续...`);
        qIdx++; taskTarget = null; taskPhase = 'IDLE'; taskRLCount = 0;
        state = 'SCANNING';
    }
    // ── v8.4: DOM 级按钮强制启用（安全网）─────────────────────────────────────
    function forceEnableButtons() {
        document.querySelectorAll('.buy-btn[disabled], .buy-btn.is-disabled, .buy-btn.disabled').forEach(b => {
            b.removeAttribute('disabled');
            b.classList.remove('is-disabled', 'disabled');
        });
    }
    // ── 启动 ──────────────────────────────────────────────────────────────────
    // v8.0: 未登录检测
    function checkLogin() {
        const token = document.cookie.match(/bigmodel_token_production=([^;]+)/)?.[1];
        if (!token) {
            setBar('⚠️ 未登录，请先注册/登录', '#ff4d4f');
            setTimeout(() => {
                if (confirm('检测到未登录，是否前往注册页面？\n\n使用邀请码注册可获得额外优惠！')) {
                    window.location.href = 'https://www.bigmodel.cn/invite?icode=PKFZ8PflAmrZ4AYh%2BAPxo33uFJ1nZ0jLLgipQkYjpcA%3D';
                }
            }, 1000);
            return false;
        }
        return true;
    }
    if (checkLogin()) {
        setBar(`✅ 脚本已加载，${readyModeText()}`, CFG.RUSH_ENABLED && !CFG.AUTO_CLICK_SUB ? '#722ed1' : '#1677ff');
        calibrateRushLatency();
        setInterval(tick, CFG.CHECK_INTERVAL);
        const _startDOM = () => {
            setInterval(forceEnableButtons, 500);
            new MutationObserver(forceEnableButtons).observe(document.body, {
                childList: true, subtree: true,
                attributes: true, attributeFilter: ['disabled', 'class']
            });
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _startDOM);
        else _startDOM();
    }
})();
// ---- captcha prompt bridge v2: multi-window rush mode ----
(function () {
    'use strict';
    if (window.__glmCaptchaPromptBridge === 1) return;
    window.__glmCaptchaPromptBridge = 1;
    const RUSH_CFG = (() => {
        try {
            const raw = GM_getValue('glm_coding_config_v5', '{}');
            const cfg = JSON.parse(raw || '{}');
            const ph = parseInt(cfg.RUSH_TARGET_HOUR, 10);
            const pm = parseInt(cfg.RUSH_TARGET_MIN, 10);
            const ps = parseInt(cfg.RUSH_TARGET_SEC, 10);
            const manualAdvance = Math.max(0, parseInt(cfg.RUSH_RELEASE_ADVANCE_MS, 10) || 0);
            const latencyRaw = GM_getValue('glm_rush_latency_v1', '{}');
            const latency = JSON.parse(latencyRaw || '{}');
            const latencyFresh = latency && Number.isFinite(Number(latency.advanceMs)) && Date.now() - Number(latency.at || 0) < 10 * 60 * 1000;
            const releaseAdvanceMs = manualAdvance > 0 ? manualAdvance : (latencyFresh ? Math.max(0, Math.min(180, Number(latency.advanceMs))) : 0);
            return {
                enabled: cfg.RUSH_ENABLED === true,
                targetHour: Number.isFinite(ph) ? ph : 10,
                targetMin: Number.isFinite(pm) ? pm : 0,
                targetSec: Number.isFinite(ps) ? ps : 0,
                holdWindowMs: Math.max(0, parseInt(cfg.RUSH_HOLD_WINDOW_MS, 10) || 10000),
                releaseAdvanceMs: releaseAdvanceMs,
                staggerMs: 2000,
                pollInterval: 50,
                pollTimeout: 20000,
            };
        } catch {
            return { enabled: false, targetHour: 10, targetMin: 0, targetSec: 0, holdWindowMs: 10000, releaseAdvanceMs: 0, staggerMs: 2000, pollInterval: 50, pollTimeout: 20000 };
        }
    })();
    const CAPTCHA_CFG = (() => {
        try {
            const raw = GM_getValue('glm_coding_config_v5', '{}');
            return {
                AUTO_CAPTCHA_CLICK: true,
                AUTO_CAPTCHA_CONFIRM: false,
                CAPTCHA_CLICK_DELAY_MODE: 'fixed',
                CAPTCHA_CLICK_DELAY_MS: 325,
                CAPTCHA_CLICK_DELAY_MIN_MS: 250,
                CAPTCHA_CLICK_DELAY_MAX_MS: 400,
                CAPTCHA_CLICK_DELAY_JITTER_PERCENT: 20,
                ...JSON.parse(raw || '{}')
            };
        } catch {
            return {
                AUTO_CAPTCHA_CLICK: true,
                AUTO_CAPTCHA_CONFIRM: false,
                CAPTCHA_CLICK_DELAY_MODE: 'fixed',
                CAPTCHA_CLICK_DELAY_MS: 325,
                CAPTCHA_CLICK_DELAY_MIN_MS: 250,
                CAPTCHA_CLICK_DELAY_MAX_MS: 400,
                CAPTCHA_CLICK_DELAY_JITTER_PERCENT: 20
            };
        }
    })();
    function clampCaptchaInt(value, min, max, fallback) {
        var n = parseInt(value, 10);
        if (!Number.isFinite(n)) return fallback;
        return Math.max(min, Math.min(max, n));
    }
    function randCaptchaInt(min, max) {
        min = Math.floor(Number(min) || 0);
        max = Math.floor(Number(max) || 0);
        if (max < min) { var t = min; min = max; max = t; }
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    function normalizeCaptchaDirectDelayMode(mode) {
        mode = String(mode || 'fixed').trim().toLowerCase();
        return (mode === 'range' || mode === 'jitter') ? mode : 'fixed';
    }
    function readCaptchaDirectDelayOverride() {
        try {
            var raw = window.__glmCaptchaDelayExperiment;
            if (!raw) return null;
            if (typeof raw === 'string') return JSON.parse(raw);
            if (typeof raw === 'object') return raw;
        } catch {}
        return null;
    }
    function normalizeCaptchaDirectDelayConfig(config) {
        config = config || {};
        var stepDelays = Array.isArray(config.stepDelays)
            ? config.stepDelays.map(function (value) {
                return clampCaptchaInt(value, 1, 10000, 220);
            }).filter(function (value) {
                return Number.isFinite(value) && value > 0;
            })
            : null;
        return {
            delayMode: normalizeCaptchaDirectDelayMode(config.delayMode),
            gapMs: clampCaptchaInt(config.gapMs, 1, 10000, 220),
            minGapMs: clampCaptchaInt(config.minGapMs, 1, 10000, 200),
            maxGapMs: clampCaptchaInt(config.maxGapMs, 1, 10000, 500),
            jitterPercent: clampCaptchaInt(config.jitterPercent, 0, 1000, 20),
            stepDelays: stepDelays && stepDelays.length ? stepDelays : null,
        };
    }
    function getCaptchaDirectDelayConfig() {
        var baseConfig = normalizeCaptchaDirectDelayConfig({
            delayMode: CAPTCHA_CFG.CAPTCHA_CLICK_DELAY_MODE,
            gapMs: CAPTCHA_CFG.CAPTCHA_CLICK_DELAY_MS,
            minGapMs: CAPTCHA_CFG.CAPTCHA_CLICK_DELAY_MIN_MS,
            maxGapMs: CAPTCHA_CFG.CAPTCHA_CLICK_DELAY_MAX_MS,
            jitterPercent: CAPTCHA_CFG.CAPTCHA_CLICK_DELAY_JITTER_PERCENT,
        });
        var override = readCaptchaDirectDelayOverride();
        if (!override) return baseConfig;
        return normalizeCaptchaDirectDelayConfig({
            delayMode: override.delayMode != null ? override.delayMode : baseConfig.delayMode,
            gapMs: override.gapMs != null ? override.gapMs : baseConfig.gapMs,
            minGapMs: override.minGapMs != null ? override.minGapMs : baseConfig.minGapMs,
            maxGapMs: override.maxGapMs != null ? override.maxGapMs : baseConfig.maxGapMs,
            jitterPercent: override.jitterPercent != null ? override.jitterPercent : baseConfig.jitterPercent,
            stepDelays: Array.isArray(override.stepDelays) ? override.stepDelays : baseConfig.stepDelays,
        });
    }
    function getWindowIndex() {
        const params = new URLSearchParams(location.search);
        return parseInt(params.get('wi') || '0', 10);
    }
    function getTargetTimestamp() {
        const now = new Date();
        const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
            RUSH_CFG.targetHour, RUSH_CFG.targetMin, RUSH_CFG.targetSec, 0);
        const offset = getWindowIndex() * RUSH_CFG.staggerMs;
        return target.getTime() + offset;
    }
    const captchaSession = {
        lastText: '',
        lastBgUrl: '',
        sent: false,
        state: 'idle',
    };
    function getCaptchaLastText() { return captchaSession.lastText; }
    function setCaptchaLastText(text) { captchaSession.lastText = text || ''; }
    function getCaptchaLastBgUrl() { return captchaSession.lastBgUrl; }
    function setCaptchaLastBgUrl(url) { captchaSession.lastBgUrl = url || ''; }
    function isCaptchaSent() { return captchaSession.sent === true; }
    function setCaptchaSent(sent) { captchaSession.sent = sent === true; }
    function getCaptchaState() { return captchaSession.state; }
    function setCaptchaState(state) { captchaSession.state = state; }
    function resetCaptchaSession() {
        setCaptchaSent(false);
        setCaptchaLastText('');
        setCaptchaLastBgUrl('');
    }
    function serverRequest(method, path, data) {
        function doFetch() {
            return fetch('http://localhost:8888' + path, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: data ? JSON.stringify(data) : undefined,
            }).then(r => r.json());
        }
        function doGM() {
            return new Promise((resolve, reject) => {
                if (typeof GM_xmlhttpRequest === 'undefined') {
                    reject(new Error('GM_xmlhttpRequest unavailable'));
                    return;
                }
                GM_xmlhttpRequest({
                    method: method,
                    url: 'http://localhost:8888' + path,
                    headers: { 'Content-Type': 'application/json' },
                    data: data ? JSON.stringify(data) : undefined,
                    onload: (r) => {
                        try { resolve(JSON.parse(r.responseText)); }
                        catch { resolve({ raw: r.responseText }); }
                    },
                    onerror: (e) => reject(new Error('GM_xmlhttpRequest error: ' + e)),
                });
            });
        }
        return doFetch().catch(() => doGM());
    }
    function pollResult(ts) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            function poll() {
                if (Date.now() - start > RUSH_CFG.pollTimeout) {
                    reject(new Error('poll timeout'));
                    return;
                }
                serverRequest('POST', '/result', { ts: ts }).then(d => {
                    if (d.has_result) resolve(d.result);
                    else setTimeout(poll, RUSH_CFG.pollInterval);
                }).catch(() => setTimeout(poll, RUSH_CFG.pollInterval));
            }
            poll();
        });
    }
    function waitForTargetTime() {
        return new Promise(resolve => {
            const targetTs = getTargetTimestamp();
            const remaining = targetTs - Date.now();
            if (remaining <= 0) { resolve(); return; }
            const winIdx = getWindowIndex();
            console.log('[captcha-rush] #' + winIdx + ' wait ' + Math.ceil(remaining / 1000) + 's to target...');
            function check() {
                if (Date.now() >= targetTs) resolve();
                else setTimeout(check, 50);
            }
            setTimeout(check, Math.max(0, remaining - 5000));
        });
    }
    function shouldHoldRushConfirm(nowTs) {
        if (!RUSH_CFG.enabled) return false;
        const targetTs = getTargetTimestamp();
        const remaining = targetTs - nowTs;
        return remaining > RUSH_CFG.releaseAdvanceMs && remaining <= RUSH_CFG.holdWindowMs;
    }
    function waitForRushRelease() {
        return new Promise(resolve => {
            function check() {
                const remaining = getTargetTimestamp() - Date.now();
                if (remaining <= RUSH_CFG.releaseAdvanceMs) resolve();
                else setTimeout(check, remaining > 2000 ? 20 : 5);
            }
            check();
        });
    }
    function findAndClickConfirm() {
        var selectors = [
            '.tencent-captcha-dy__btn-confirm',
            '.tencent-captcha-dy__footer .btn',
            '[class*="captcha"] [class*="confirm"]',
            '[class*="captcha"] [class*="submit"]',
        ];
        for (var si = 0; si < selectors.length; si++) {
            var btns = document.querySelectorAll(selectors[si]);
            for (var bi = 0; bi < btns.length; bi++) {
                var btn = btns[bi];
                if (!btn) continue;
                var style = getComputedStyle(btn);
                if (style.display === 'none' || style.visibility === 'hidden') continue;
                var rect = btn.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;
                console.log('[captcha-rush] click confirm: ' + selectors[si]);
                btn.click();
                return true;
            }
        }
        return false;
    }
    function rushStatus(html, bg) {
        try { setBar(html, bg); } catch (e) {}
    }
    async function handleCaptchaRush(chars) {
        var winIdx = getWindowIndex();
        var payloadText = chars.join('');
        setCaptchaState('solving');
        rushStatus('\uD83D\uDD10 [#' + winIdx + '] \u9A8C\u8BC1\u7801\u8BC6\u522B\u4E2D: ' + payloadText + '...', '#1890ff');
        try {
            var sendRes = await serverRequest('POST', '/captcha', { text: payloadText, ts: Date.now() });
            var ts = sendRes.ts;
            if (!ts) throw new Error('no ts');
            console.log('[captcha-rush] [#' + winIdx + '] sent ts=' + ts);
            rushStatus('\u23F3 [#' + winIdx + '] \u7B49\u5F85\u8BC6\u522B...', '#faad14');
            var result = await pollResult(ts);
            if (!result || !result.result || !result.result.success) {
                setCaptchaState('idle');
                resetCaptchaSession();
                rushStatus('\u274C [#' + winIdx + '] \u8BC6\u522B\u5931\u8D25: ' + (result && result.result ? result.result.error : '?') + ' \u2192 \u5FEB\u901F\u91CD\u8BD5', '#ff4d4f');
                return;
            }
            var predText = result.result.pred_text;
            var conf = result.result.confidence;
            console.log('[captcha-rush] [#' + winIdx + '] done: ' + predText + ' conf=' + conf);
            rushStatus('\u2705 [#' + winIdx + '] \u9A8C\u8BC1\u7801\u5DF2\u89E3: ' + predText + ' (' + (conf * 100).toFixed(0) + '%)', '#52c41a');
            var coords = result.result.click_coords || [];
            console.log('[captcha-rush] [#' + winIdx + '] click_coords count=' + coords.length + ' result=' + JSON.stringify(result.result).substring(0, 200));
            if (coords.length > 0) {
                var clickTarget = document.querySelector('.tencent-captcha-dy__verify-bg-img') ||
                                  document.querySelector('[class*="verify-bg"]') ||
                                  document.querySelector('.tencent-captcha-dy__image-area') ||
                                  findCaptchaContainer();
                if (clickTarget) {
                    console.log('[captcha-rush] click target: ' + clickTarget.tagName + '.' + (clickTarget.className||'').substring(0,40));
                    var tgtRect = clickTarget.getBoundingClientRect();
                    console.log('[captcha-rush] target rect: ' + Math.round(tgtRect.width) + 'x' + Math.round(tgtRect.height) + ' @ (' + Math.round(tgtRect.left) + ',' + Math.round(tgtRect.top) + ')');
                    rushStatus('\u2705 [#' + winIdx + '] \u6B63\u5728\u70B9\u51FB ' + coords.length + ' \u5B57...', '#237804');
                    for (var ci = 0; ci < coords.length; ci++) {
                        var c = coords[ci];
                        var nx = c.nx || (c.rel_x / 422);
                        var ny = c.ny || (c.rel_y / 305);
                        var cx = tgtRect.left + nx * tgtRect.width;
                        var cy = tgtRect.top + ny * tgtRect.height;
                        console.log('[captcha-rush] click #' + (ci+1) + ' "' + c.char + '" norm=(' + nx.toFixed(3) + ',' + ny.toFixed(3) + ') screen=(' + Math.round(cx) + ',' + Math.round(cy) + ')');
                        dispatchClickAt(clickTarget, nx * tgtRect.width, ny * tgtRect.height, String(ci + 1));
                        await new Promise(function(r) { setTimeout(r, 350); });
                    }
                    rushStatus('\u2705 [#' + winIdx + '] \u70B9\u51FB\u5B8C\u6215! \u7B49\u5F85\u5361\u70B9...', '#237804');
                } else {
                    console.warn('[captcha-rush] [#' + winIdx + '] no click target found');
                }
            }
            await new Promise(function(r) { setTimeout(r, 500); });
            setCaptchaState('idle');
            (async function() {
                var isRushMode = isGoldenTime();
                if (isRushMode) {
                    await waitForTargetTime();
                    rushStatus('\uD83D\uDE80 [#' + winIdx + '] \u5361\u70B9\u53D1\u9001!', '#ff4d4f');
                } else {
                    await new Promise(function(r) { setTimeout(r, 300); });
                    rushStatus('\uD83D\uDE80 [#' + winIdx + '] \u81EA\u52A8\u786E\u8BA4...', '#237804');
                }
                setCaptchaState('confirming');
                var clicked = findAndClickConfirm();
                if (clicked) {
                    setCaptchaState('confirmed');
                    rushStatus('\uD83C\uDFAF [#' + winIdx + '] \u5DF2\u70B9\u786E\u8BA4!' + (isRushMode ? ' (\u5361\u70B0)' : ''), '#237804');
                } else {
                    setCaptchaState('idle');
                    rushStatus('\u26A0\uFE0F [#' + winIdx + '] \u672A\u627E\u5230\u786E\u8BA4\u6309\u94AE!', '#faad14');
                }
            })();
        } catch (e) {
            setCaptchaState('idle');
            resetCaptchaSession();
            console.error('[captcha-rush] error:', e);
            rushStatus('\u274C [#' + getWindowIndex() + '] \u5F02\u5E38: ' + e.message + ' \u2192 \u5FEB\u901F\u91CD\u8BD5', '#ff4d4f');
        }
    }
    function visible(el) {
        if (!el) return false;
        var style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        var rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }
    function getCaptchaPromptText(el) {
        if (!el) return '';
        var raw = (
            el.getAttribute('aria-label') ||
            el.getAttribute('title') ||
            el.textContent ||
            ''
        ).trim();
        return raw.replace(/^\u8BF7\u4F9D\u6B21\u70B9\u51FB[:\uff1a]?\s*/, '').trim();
    }
    function isPointClickPrompt(text) {
        if (!text) return false;
        if (/(\u62D6\u52A8|\u62FC\u56FE|\u6ED1\u5757)/.test(text)) return false;
        if (/^\u8BF7\u4F9D\u6B21\u70B9\u51FB/.test(text)) return true;
        var chars = (text.match(/[\u4e00-\u9fff]/g) || []);
        return chars.length >= 3 && chars.length <= 8;
    }
    function extractCaptchaChars(text) {
        var chars = (text || '').match(/[\u4e00-\u9fff]/g) || [];
        return chars.slice(-3);
    }
    function findCaptchaContainer() {
        var MIN_AREA = 20000;
        var candidates = [];
        var selectors = [
            '.tencent-captcha-dy__image',
            '.tencent-captcha-dy__bg-img',
            '.tencent-captcha-dy__bg',
            '.tencent-captcha-dy__body',
            '[class*="captcha-dy"] [class*="image"]',
            '[class*="captcha-dy"] [class*="bg"]',
            'img[class*="captcha"]',
            'div[class*="captcha"] img',
            'canvas[class*="captcha"]',
            '[class*="captcha-dy"] img',
            '[class*="captcha-dy"] canvas',
        ];
        for (var i = 0; i < selectors.length; i++) {
            var els = document.querySelectorAll(selectors[i]);
            for (var k = 0; k < els.length; k++) {
                var el = els[k];
                if (!el || !visible(el)) continue;
                var r = el.getBoundingClientRect();
                var area = r.width * r.height;
                if (area >= MIN_AREA) {
                    candidates.push({ el: el, area: area, w: r.width, h: r.height });
                    console.log('[captcha] candidate: ' + selectors[i] + ' size=' + Math.round(r.width) + 'x' + Math.round(r.height));
                }
            }
        }
        if (candidates.length === 0) {
            var allImgs = document.querySelectorAll('img');
            for (var j = 0; j < allImgs.length; j++) {
                var img = allImgs[j];
                if (!visible(img)) continue;
                var ir = img.getBoundingClientRect();
                var iarea = ir.width * ir.height;
                if (iarea >= MIN_AREA) {
                    var parent = img.closest('[class*="captcha"]');
                    if (parent) {
                        candidates.push({ el: img, area: iarea, w: ir.width, h: ir.height });
                    }
                }
            }
        }
        if (candidates.length === 0) {
            var wrapSelectors = [
                '.tencent-captcha-dy__wrap',
                '.tencent-captcha-dy__container',
                '[id*="tcaptcha"]',
                '[class*="captcha-dy"][class*="wrap"]',
                '[class*="captcha-dy"][class*="content"]',
            ];
            for (var wi = 0; wi < wrapSelectors.length; wi++) {
                var wrapEl = document.querySelector(wrapSelectors[wi]);
                if (wrapEl && visible(wrapEl)) {
                    var wr = wrapEl.getBoundingClientRect();
                    if (wr.width * wr.height >= MIN_AREA) {
                        console.log('[captcha] fallback to wrap: ' + wrapSelectors[wi] + ' size=' + Math.round(wr.width) + 'x' + Math.round(wr.height));
                        return wrapEl;
                    }
                }
            }
            return null;
        }
        candidates.sort(function(a, b) { return b.area - a.area; });
        var best = candidates[0];
        console.log('[captcha] selected container: ' + best.w + 'x' + best.h + ' area=' + Math.round(best.area));
        console.log('[captcha] tag=' + best.el.tagName + ' class=' + (best.el.className || '').substring(0, 80));
        console.log('[captcha] bg=' + window.getComputedStyle(best.el).backgroundImage.substring(0, 100));
        var _dbgAll = best.el.querySelectorAll('*');
        for (var di = 0; di < Math.min(_dbgAll.length, 20); di++) {
            var de = _dbgAll[di];
            var dr = de.getBoundingClientRect();
            if (dr.width * dr.height < 500) continue;
            var dbgBg = '';
            try { dbgBg = window.getComputedStyle(de).backgroundImage.substring(0, 80); } catch(e) {}
            var dbgSrc = '';
            if (de.tagName === 'IMG') dbgSrc = ' src=' + (de.src || '').substring(0, 60);
            if (de.tagName === 'CANVAS') dbgSrc = ' canvas=' + de.width + 'x' + de.height;
            console.log('[captcha-dbg] ' + de.tagName + '.' + (de.className||'').substring(0,30) + ' ' + Math.round(dr.width) + 'x' + Math.round(dr.height) + dbgSrc + ' bg=' + dbgBg);
        }
        return best.el;
    }
    function captureElementAsBase64(el) {
        try {
            if (el.tagName === 'CANVAS') {
                return el.toDataURL('image/png');
            }
            if (el.tagName === 'IMG') {
                var c = document.createElement('canvas');
                c.width = el.naturalWidth || el.width || 300;
                c.height = el.naturalHeight || el.height || 200;
                var ctx = c.getContext('2d');
                ctx.drawImage(el, 0, 0);
                return c.toDataURL('image/png');
            }
            var allImgChildren = el.querySelectorAll('img');
            for (var mi = 0; mi < allImgChildren.length; mi++) {
                var mimg = allImgChildren[mi];
                if (!visible(mimg)) continue;
                var mw = mimg.naturalWidth || mimg.width || 0;
                var mh = mimg.naturalHeight || mimg.height || 0;
                if (mw * mh >= 10000) {
                    console.log('[captcha] using child img for capture, size=' + mw + 'x' + mh);
                    var ic = document.createElement('canvas');
                    ic.width = mw;
                    ic.height = mh;
                    var ictx = ic.getContext('2d');
                    ictx.drawImage(mimg, 0, 0);
                    return ic.toDataURL('image/png');
                }
            }
            var canvasChild = el.querySelector('canvas');
            if (canvasChild && visible(canvasChild)) {
                console.log('[captcha] using child canvas for capture');
                return canvasChild.toDataURL('image/png');
            }
            var bgUrl = null;
            var computedBg = window.getComputedStyle(el).backgroundImage;
            if (computedBg && computedBg !== 'none' && computedBg.indexOf('url(') !== -1) {
                bgUrl = computedBg.replace(/url\(["']?/, '').replace(/["']?\)$/, '');
                console.log('[captcha] found css background-image, url=' + bgUrl.substring(0, 80));
            }
            if (!bgUrl) {
                var _walkEl = el;
                for (var bi = 0; bi < 10 && _walkEl; bi++) {
                    var parentBg = window.getComputedStyle(_walkEl).backgroundImage;
                    if (parentBg && parentBg !== 'none' && parentBg.indexOf('url(') !== -1) {
                        bgUrl = parentBg.replace(/url\(["']?/, '').replace(/["']?\)$/, '');
                        console.log('[captcha] found bg on ancestor level ' + bi + ', url=' + bgUrl.substring(0, 80));
                        break;
                    }
                    _walkEl = _walkEl.parentElement;
                }
            }
            if (bgUrl) {
                return new Promise(function(resolve) {
                    var bgImg = new Image();
                    bgImg.crossOrigin = 'anonymous';
                    bgImg.onload = function() {
                        console.log('[captcha] bg image loaded, size=' + bgImg.naturalWidth + 'x' + bgImg.naturalHeight);
                        var bc = document.createElement('canvas');
                        bc.width = bgImg.naturalWidth || bgImg.width || 330;
                        bc.height = bgImg.naturalHeight || bgImg.height || 236;
                        var bctx = bc.getContext('2d');
                        bctx.drawImage(bgImg, 0, 0);
                        resolve(bc.toDataURL('image/png'));
                    };
                    bgImg.onerror = function() { resolve(null); };
                    bgImg.src = bgUrl;
                });
            }
            var rect = el.getBoundingClientRect();
            var w = Math.floor(rect.width * window.devicePixelRatio);
            var h = Math.floor(rect.height * window.devicePixelRatio);
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('width', w);
            svg.setAttribute('height', h);
            var fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
            fo.setAttribute('width', w);
            fo.setAttribute('height', h);
            var clone = el.cloneNode(true);
            var allStyles = window.getComputedStyle(el);
            var styleStr = '';
            for (var si = 0; si < allStyles.length; si++) {
                var prop = allStyles[si];
                styleStr += prop + ':' + allStyles.getPropertyValue(prop) + ';';
            }
            clone.setAttribute('style', styleStr);
            fo.appendChild(clone);
            svg.appendChild(fo);
            var svgData = new XMLSerializer().serializeToString(svg);
            var svgBase64 = btoa(unescape(encodeURIComponent(svgData)));
            var dataUrl = 'data:image/svg+xml;base64,' + svgBase64;
            var imgForDraw = new Image();
            imgForDraw.src = dataUrl;
            return new Promise(function(resolve) {
                imgForDraw.onload = function() {
                    var fc = document.createElement('canvas');
                    fc.width = w;
                    fc.height = h;
                    var fctx = fc.getContext('2d');
                    fctx.drawImage(imgForDraw, 0, 0);
                    resolve(fc.toDataURL('image/png'));
                };
                imgForDraw.onerror = function() { resolve(null); };
            });
        } catch(e) {
            console.error('[captcha] capture error:', e);
            return null;
        }
    }
    function dispatchClickAt(el, relX, relY, label) {
        var rect = el.getBoundingClientRect();
        var clientX = rect.left + relX;
        var clientY = rect.top + relY;
        var evtWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        var opts = { bubbles: true, cancelable: true, view: evtWin, clientX: clientX, clientY: clientY,
            screenX: clientX + evtWin.screenX, screenY: clientY + evtWin.screenY,
            button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true };
        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        console.log('[captcha] clicked @ (' + Math.round(clientX) + ',' + Math.round(clientY) + ')');
        showClickMarker(clientX, clientY, label || '');
    }
    var _clickMarkers = [];
    function clearClickMarkers() {
        for (var mi = 0; mi < _clickMarkers.length; mi++) {
            if (_clickMarkers[mi] && _clickMarkers[mi].parentNode) {
                _clickMarkers[mi].parentNode.removeChild(_clickMarkers[mi]);
            }
        }
        _clickMarkers = [];
    }
    function showClickMarker(x, y, label) {
        try {
            var hostDoc = document;
            if (typeof unsafeWindow !== 'undefined' && unsafeWindow.document) {
                hostDoc = unsafeWindow.document;
            }
            var marker = hostDoc.createElement('div');
            marker.style.cssText = 'position:fixed;left:' + (x - 18) + 'px;top:' + (y - 18) +
                'px;width:36px;height:36px;border-radius:50%;border:3px solid #ff0000;' +
                'background:rgba(255,0,0,0.25);pointer-events:none;z-index:2147483647;' +
                'box-shadow:0 0 8px rgba(255,0,0,0.8);display:flex;align-items:center;justify-content:center;' +
                'font-size:14px;font-weight:bold;color:#ff0000;font-family:monospace;';
            marker.textContent = label || '';
            hostDoc.body.appendChild(marker);
            _clickMarkers.push(marker);
            setTimeout(function() {
                if (marker.parentNode) marker.parentNode.removeChild(marker);
                var idx = _clickMarkers.indexOf(marker);
                if (idx > -1) _clickMarkers.splice(idx, 1);
            }, 700);
        } catch(e) {
            console.error('[captcha] marker error:', e);
        }
    }
    function findCaptchaPromptElement() {
        var selectors = [
            '.tencent-captcha-dy__header-text',
            '.tencent-captcha-dy__header-title-wrap .tencent-captcha-dy__header-text',
            "div[class*='tencent-captcha'] div[class*='header-text']",
            '[aria-label]',
        ];
        for (var i = 0; i < selectors.length; i++) {
            var el = document.querySelector(selectors[i]);
            if (!el || !visible(el)) continue;
            var text = getCaptchaPromptText(el);
            if (!isPointClickPrompt(text)) continue;
            var chars = extractCaptchaChars(text);
            if (chars.length >= 3) {
                return { selector: selectors[i], text: text, chars: chars };
            }
        }
        return null;
    }
    function captchaBgUrlFrom(el) {
        if (!el) return '';
        var bg = '';
        try { bg = (el.style && el.style.backgroundImage) || window.getComputedStyle(el).backgroundImage || ''; } catch(e) {}
        var match = bg.match(/url\(["']?([^"')]+)/);
        if (!match) return '';
        try { return new URL(match[1], location.href).href; } catch(e) { return match[1]; }
    }
    function findCaptchaBgElementDirect() {
        var selectors = [
            '#slideBg',
            '.tencent-captcha-dy__verify-bg-img',
            '.tencent-captcha-dy__bg-img',
            '[class*="verify-bg"]',
            '[class*="bg-img"]',
            '.tencent-captcha-dy__image-area'
        ];
        for (var i = 0; i < selectors.length; i++) {
            var els = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < els.length; j++) {
                var el = els[j];
                if (visible(el) && captchaBgUrlFrom(el)) return el;
            }
        }
        return null;
    }
    function fetchCaptchaImageDirect(url) {
        function doFetch() {
            return fetch(url).then(function(r) { return r.blob(); }).then(function(blob) {
                return new Promise(function(resolve, reject) {
                    var reader = new FileReader();
                    reader.onload = function() { resolve(reader.result); };
                    reader.onerror = function() { reject(new Error('FileReader failed')); };
                    reader.readAsDataURL(blob);
                });
            });
        }
        function doGM() {
            return new Promise(function(resolve, reject) {
                if (typeof GM_xmlhttpRequest === 'undefined') {
                    reject(new Error('GM_xmlhttpRequest unavailable'));
                    return;
                }
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    responseType: 'blob',
                    onload: function(r) {
                        var reader = new FileReader();
                        reader.onload = function() { resolve(reader.result); };
                        reader.onerror = function() { reject(new Error('FileReader failed')); };
                        reader.readAsDataURL(r.response);
                    },
                    onerror: function() { reject(new Error('image download failed')); }
                });
            });
        }
        return doFetch().catch(function() { return doGM(); });
    }
    function resolveCaptchaDirectTarget(bgEl, bgUrl) {
        bgEl = bgEl || findCaptchaBgElementDirect();
        if (!bgEl) throw new Error('no captcha background element');
        bgUrl = bgUrl || captchaBgUrlFrom(bgEl);
        if (!bgUrl) throw new Error('no captcha background url');
        return { bgEl: bgEl, bgUrl: bgUrl };
    }
    async function requestCaptchaDirectResult(payloadText, bgUrl) {
        console.log('[captcha-direct-page] bg:', bgUrl.substring(0, 120));
        var image = await fetchCaptchaImageDirect(bgUrl);
        var resp = await serverRequest('POST', '/captcha_direct', {
            image: image,
            text: payloadText,
            remark: payloadText,
            ts: Date.now(),
            source: 'glm-coding-helper-page-direct'
        });
        var result = resp && resp.result;
        if (!result || !result.success || !Array.isArray(result.click_coords)) {
            throw new Error('bad direct result: ' + JSON.stringify(resp).substring(0, 180));
        }
        return result;
    }
    function normalizeCaptchaDirectCoord(coord, rect) {
        var nx = Number(coord.nx);
        var ny = Number(coord.ny);
        if (!Number.isFinite(nx) && Number.isFinite(Number(coord.rel_x))) nx = Number(coord.rel_x) / rect.width;
        if (!Number.isFinite(ny) && Number.isFinite(Number(coord.rel_y))) ny = Number(coord.rel_y) / rect.height;
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
        return { nx: nx, ny: ny };
    }
    function createCaptchaDirectClickSchedule() {
        return {
            ...getCaptchaDirectDelayConfig(),
            afterClicksMs: 350,
        };
    }
    function buildCaptchaDirectFixedDelayPlan(result, schedule) {
        var delays = [];
        for (var i = 0; i < result.click_coords.length; i++) {
            delays.push(schedule.gapMs);
        }
        return delays;
    }
    function buildCaptchaDirectRangeDelayPlan(result, schedule) {
        var minGap = Math.min(schedule.minGapMs, schedule.maxGapMs);
        var maxGap = Math.max(schedule.minGapMs, schedule.maxGapMs);
        var delays = [];
        for (var i = 0; i < result.click_coords.length; i++) {
            delays.push(randCaptchaInt(minGap, maxGap));
        }
        return delays;
    }
    function buildCaptchaDirectJitterDelayPlan(result, schedule) {
        var baseGap = schedule.gapMs;
        var jitterPercent = Math.max(0, schedule.jitterPercent);
        var jitterDelta = Math.round(baseGap * jitterPercent / 100);
        var minGap = Math.max(1, baseGap - jitterDelta);
        var maxGap = Math.max(minGap, baseGap + jitterDelta);
        var delays = [];
        for (var i = 0; i < result.click_coords.length; i++) {
            delays.push(randCaptchaInt(minGap, maxGap));
        }
        return delays;
    }
    function buildCaptchaDirectStepDelayPlan(result, schedule) {
        var delays = [];
        var stepDelays = Array.isArray(schedule.stepDelays) ? schedule.stepDelays : [];
        for (var i = 0; i < result.click_coords.length; i++) {
            delays.push(stepDelays[i] != null ? stepDelays[i] : schedule.gapMs);
        }
        return delays;
    }
    function resolveCaptchaDirectDelayPlanBuilder(schedule) {
        if (Array.isArray(schedule.stepDelays) && schedule.stepDelays.length) return buildCaptchaDirectStepDelayPlan;
        if (schedule.delayMode === 'range') return buildCaptchaDirectRangeDelayPlan;
        if (schedule.delayMode === 'jitter') return buildCaptchaDirectJitterDelayPlan;
        return buildCaptchaDirectFixedDelayPlan;
    }
    function buildCaptchaDirectDelayPlan(result, schedule) {
        return resolveCaptchaDirectDelayPlanBuilder(schedule)(result, schedule);
    }
    function buildCaptchaDirectClickPlan(rect, result, schedule) {
        var delays = buildCaptchaDirectDelayPlan(result, schedule);
        var steps = [];
        for (var i = 0; i < result.click_coords.length; i++) {
            var coord = result.click_coords[i];
            var normalized = normalizeCaptchaDirectCoord(coord, rect);
            if (!normalized) continue;
            steps.push({
                x: normalized.nx * rect.width,
                y: normalized.ny * rect.height,
                label: coord.char || String(i + 1),
                delayMs: delays[i],
            });
        }
        return {
            steps: steps,
            afterClicksMs: schedule.afterClicksMs,
        };
    }
    async function sleepCaptchaDirectClickGap(delayMs) {
        await new Promise(function(r) { setTimeout(r, delayMs); });
    }
    async function sleepCaptchaDirectAfterClicks(plan) {
        await new Promise(function(r) { setTimeout(r, plan.afterClicksMs); });
    }
    async function runCaptchaDirectClickStep(bgEl, step, shouldWaitAfter) {
        dispatchClickAt(bgEl, step.x, step.y, step.label);
        if (shouldWaitAfter) {
            await sleepCaptchaDirectClickGap(step.delayMs);
        }
    }
    async function clickCaptchaDirectCoords(bgEl, result) {
        var schedule = createCaptchaDirectClickSchedule();
        var rect = bgEl.getBoundingClientRect();
        var plan = buildCaptchaDirectClickPlan(rect, result, schedule);
        console.log('[captcha-direct-page] click result:', JSON.stringify(result).substring(0, 260));
        for (var i = 0; i < plan.steps.length; i++) {
            await runCaptchaDirectClickStep(bgEl, plan.steps[i], i < plan.steps.length - 1);
        }
        await sleepCaptchaDirectAfterClicks(plan);
    }
    async function finishCaptchaDirectConfirm() {
        if (RUSH_CFG.enabled) {
            var nowTs = Date.now();
            var targetTs = getTargetTimestamp();
            var remaining = targetTs - nowTs;
            if (remaining > RUSH_CFG.holdWindowMs) {
                console.log('[captcha-rush] outside hold window, skip auto confirm for ' + Math.ceil(remaining / 1000) + 's');
                return;
            }
            if (shouldHoldRushConfirm(nowTs)) {
                console.log('[captcha-rush] hold confirm for ' + Math.max(0, targetTs - nowTs).toFixed(0) + 'ms');
                await waitForRushRelease();
                console.log('[captcha-rush] release confirm');
            }
            var clicked = findAndClickConfirm();
            if (clicked) window.__glmRushConfirmed = Date.now();
        } else if (CAPTCHA_CFG.AUTO_CAPTCHA_CONFIRM) {
            findAndClickConfirm();
        } else {
            console.log('[captcha-direct-page] captcha confirm is disabled; waiting for manual confirm');
        }
    }
    async function handleCaptchaDirectInPage(chars, bgEl, bgUrl) {
        if (!CAPTCHA_CFG.AUTO_CAPTCHA_CLICK) {
            console.log('[captcha-direct-page] auto captcha click disabled');
            return;
        }
        if (getCaptchaState() === 'solving') return;
        setCaptchaState('solving');
        var payloadText = chars.join('');
        try {
            var target = resolveCaptchaDirectTarget(bgEl, bgUrl);
            var result = await requestCaptchaDirectResult(payloadText, target.bgUrl);
            await clickCaptchaDirectCoords(target.bgEl, result);
            await finishCaptchaDirectConfirm();
        } catch (e) {
            console.error('[captcha-direct-page] error:', e);
            resetCaptchaSession();
        } finally {
            setCaptchaState('idle');
        }
    }
    function collectCaptchaChallenge() {
        var found = findCaptchaPromptElement();
        if (!found) {
            setCaptchaSent(false);
            return null;
        }
        var bgEl = findCaptchaBgElementDirect();
        var bgUrl = captchaBgUrlFrom(bgEl);
        if (!bgEl || !bgUrl) {
            setCaptchaSent(false);
            return null;
        }
        var payloadText = found.chars.join('');
        if (!payloadText) {
            setCaptchaSent(false);
            return null;
        }
        return { found: found, bgEl: bgEl, bgUrl: bgUrl, payloadText: payloadText };
    }
    function syncCaptchaChallengeText(challenge) {
        if (challenge.payloadText !== getCaptchaLastText() || challenge.bgUrl !== getCaptchaLastBgUrl()) {
            setCaptchaLastText(challenge.payloadText);
            setCaptchaLastBgUrl(challenge.bgUrl);
            setCaptchaSent(false);
            console.log('[captcha] sel:', challenge.found.selector);
            console.log('[captcha] raw:', challenge.found.text);
            console.log('[captcha] prompt:', challenge.payloadText);
        }
    }
    function tryStartCaptchaDirectSolve(challenge) {
        if (isCaptchaSent()) return;
        setCaptchaSent(true);
        console.log('[captcha] page direct solver:', challenge.payloadText);
        handleCaptchaDirectInPage(challenge.found.chars, challenge.bgEl, challenge.bgUrl).catch(function(e) {
            console.error('[captcha-direct-page] unhandled:', e);
        });
    }
    async function checkCaptchaPrompt() {
        if (getCaptchaState() === 'solving') return;
        var challenge = collectCaptchaChallenge();
        if (!challenge) return;
        syncCaptchaChallengeText(challenge);
        tryStartCaptchaDirectSolve(challenge);
    }
    setInterval(checkCaptchaPrompt, 50);
    console.log('[captcha] bridge v2 started | rush=' + RUSH_CFG.enabled + ' | wi=' + getWindowIndex() + ' | target=' + String(RUSH_CFG.targetHour).padStart(2,'0') + ':' + String(RUSH_CFG.targetMin).padStart(2,'0') + ':' + String(RUSH_CFG.targetSec).padStart(2,'0') + '+' + (getWindowIndex() * RUSH_CFG.staggerMs / 1000) + 's');
})();
