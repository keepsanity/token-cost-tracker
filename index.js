import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types, getGeneratingModel, getRequestHeaders } from '../../../../script.js';
import { getTokenCountAsync } from '../../../tokenizers.js';
import { POPUP_RESULT, POPUP_TYPE, Popup, callGenericPopup } from '../../../popup.js';

const EXTENSION_NAME = 'tokenCostTracker';
const EXTENSION_FOLDER = 'third-party/token-cost-tracker';
const DATA_DIR = 'token-cost-tracker';

// ── i18n ─────────────────────────────────────────────────────

const isKo = (navigator.language || '').startsWith('ko');

const I18N = {
    title:              isKo ? '토큰 사용량 트래커' : 'Token Cost Tracker',
    enableTracking:     isKo ? '사용량 추적 활성화' : 'Enable Cost Tracking',
    autoDelete:         isKo ? '30일 후 자동 삭제' : 'Auto-delete after 30 days',
    openTracker:        isKo ? '토큰 사용량 트래커 열기' : 'Open Token Cost Tracker',
    close:              isKo ? '닫기' : 'Close',
    back:               isKo ? '뒤로' : 'Back',
    export_:            isKo ? '내보내기' : 'Export',
    clearAll:           isKo ? '전체 삭제' : 'Clear All',
    noData:             isKo ? '추적 데이터가 없습니다.\n대화를 시작하면 여기에 표시됩니다.' : 'No tracking data yet.\nStart a conversation and data will appear here.',
    noRecords:          isKo ? '이 날짜의 기록이 없습니다.' : 'No records for this date.',
    gens:               (n) => isKo ? `${n}건` : `${n} gen${n > 1 ? 's' : ''}`,
    total:              (days) => isKo ? `합계 (${days}일)` : `Total (${days} days)`,
    generations:        (n) => isKo ? `${n}건 생성` : `${n} generations`,
    dayTotal:           isKo ? '일별 합계' : 'Day total',
    generation:         (n) => isKo ? `${n}건` : `${n} generation${n !== 1 ? 's' : ''}`,
    deleteDay:          isKo ? '일별 삭제' : 'Delete day',
    confirmClearAll:    isKo ? '전체 데이터를 삭제하시겠습니까?' : 'Clear all data?',
    confirmClearDesc:   isKo ? '모든 추적 기록이 영구적으로 삭제됩니다.' : 'This will permanently delete all tracking records.',
    allCleared:         isKo ? '전체 데이터가 삭제되었습니다.' : 'All data cleared.',
    dataExported:       isKo ? '데이터를 내보냈습니다.' : 'Data exported.',
    recordDeleted:      isKo ? '기록이 삭제되었습니다.' : 'Record deleted.',
    dayDeleted:         isKo ? '해당 일자가 삭제되었습니다.' : 'Day deleted.',
    confirmDeleteDay:   (d) => isKo ? `${d}의 모든 기록을 삭제하시겠습니까?` : `Delete all records for ${d}?`,
    cannotUndo:         isKo ? '이 작업은 되돌릴 수 없습니다.' : 'This cannot be undone.',
    prompt:             isKo ? '프롬프트' : 'Prompt',
    completion:         isKo ? '컴플리션' : 'Completion',
    sentPrompt:         isKo ? '보낸 프롬프트' : 'Sent Prompt',
    aiResponse:         isKo ? 'AI 응답' : 'AI Response',
};

// ── Pricing per 1M tokens (USD) ──────────────────────────────

const MODEL_PRICING = {
    // ── OpenAI (updated March 2026) ──
    'gpt-5-mini':        { input: 0.25,  output: 1.00 },
    'gpt-5':             { input: 1.25,  output: 10.00 },
    'gpt-4.5':           { input: 75.00, output: 150.00 },
    'gpt-4.1-mini':      { input: 0.40,  output: 1.60 },
    'gpt-4.1-nano':      { input: 0.10,  output: 0.40 },
    'gpt-4.1':           { input: 2.00,  output: 8.00 },
    'gpt-4o-mini':       { input: 0.15,  output: 0.60 },
    'gpt-4o':            { input: 2.50,  output: 10.00 },
    'gpt-4-turbo':       { input: 10.00, output: 30.00 },
    'gpt-4':             { input: 30.00, output: 60.00 },
    'gpt-3.5-turbo':     { input: 0.50,  output: 1.50 },
    'o4-mini':           { input: 1.10,  output: 4.40 },
    'o3-pro':            { input: 100.00, output: 400.00 },
    'o3-mini':           { input: 1.10,  output: 4.40 },
    'o3':                { input: 2.00,  output: 8.00 },
    'o1-pro':            { input: 150.00, output: 600.00 },
    'o1-mini':           { input: 3.00,  output: 12.00 },
    'o1':                { input: 15.00, output: 60.00 },

    // ── Anthropic Claude (updated March 2026) ──
    'claude-opus-4.6':   { input: 5.00,  output: 25.00 },
    'claude-sonnet-4.6': { input: 3.00,  output: 15.00 },
    'claude-opus-4.5':   { input: 5.00,  output: 25.00 },
    'claude-sonnet-4.5': { input: 3.00,  output: 15.00 },
    'claude-haiku-4.5':  { input: 1.00,  output: 5.00 },
    'claude-sonnet-4':   { input: 3.00,  output: 15.00 },
    'claude-opus-4':     { input: 15.00, output: 75.00 },
    'claude-3-5-sonnet': { input: 3.00,  output: 15.00 },
    'claude-3-5-haiku':  { input: 0.80,  output: 4.00 },
    'claude-3-opus':     { input: 15.00, output: 75.00 },
    'claude-3-sonnet':   { input: 3.00,  output: 15.00 },
    'claude-3-haiku':    { input: 0.25,  output: 1.25 },

    // ── Google Gemini (updated March 2026) ──
    'gemini-3.1-pro':    { input: 2.00,  output: 12.00 },
    'gemini-3-flash':    { input: 0.50,  output: 3.00 },
    'gemini-2.5-pro':    { input: 1.25,  output: 10.00 },
    'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
    'gemini-2.5-flash':  { input: 0.30,  output: 2.50 },
    'gemini-2.0-flash':  { input: 0.10,  output: 0.40 },
    'gemini-1.5-pro':    { input: 1.25,  output: 5.00 },
    'gemini-1.5-flash':  { input: 0.075, output: 0.30 },

    // ── DeepSeek (updated March 2026 - V3.2 unified pricing) ──
    'deepseek-chat':     { input: 0.28,  output: 0.42 },
    'deepseek-reasoner': { input: 0.28,  output: 0.42 },

    // ── Mistral (updated March 2026) ──
    'mistral-large-2512': { input: 0.50, output: 1.50 },
    'mistral-large':     { input: 2.00,  output: 6.00 },
    'mistral-medium-3':  { input: 0.40,  output: 2.00 },
    'mistral-small':     { input: 0.20,  output: 0.60 },
    'mistral-nemo':      { input: 0.02,  output: 0.02 },
    'ministral-8b':      { input: 0.10,  output: 0.10 },

    // ── xAI Grok (updated March 2026) ──
    'grok-4.1-fast':     { input: 0.20,  output: 0.50 },
    'grok-4':            { input: 3.00,  output: 15.00 },
    'grok-3-fast':       { input: 5.00,  output: 25.00 },
    'grok-3-mini':       { input: 0.30,  output: 0.50 },
    'grok-3':            { input: 3.00,  output: 15.00 },
    'grok-2':            { input: 2.00,  output: 10.00 },

    // ── Cohere ──
    'command-r-plus':    { input: 2.50,  output: 10.00 },
    'command-r':         { input: 0.15,  output: 0.60 },
    'command-a':         { input: 2.50,  output: 10.00 },
};

// ── Default Settings (stored in extension_settings) ──────────

const DEFAULT_SETTINGS = {
    enabled: true,
    autoDeleteEnabled: true,
    autoDeleteDays: 30,
    currencySymbol: '$',
    customPricing: {},
};

// ── Settings helpers ─────────────────────────────────────────

function getSettings() {
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const s = extension_settings[EXTENSION_NAME];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (s[key] === undefined) {
            s[key] = structuredClone(DEFAULT_SETTINGS[key]);
        }
    }
    return s;
}

function saveSettings() {
    saveSettingsDebounced();
}

// ── Pricing logic ────────────────────────────────────────────

function getModelPricing(modelId) {
    const settings = getSettings();
    if (settings.customPricing[modelId]) {
        return settings.customPricing[modelId];
    }

    // Normalize dots to hyphens: pricing keys use "4.5" but API model IDs use "4-5"
    const normalized = modelId.toLowerCase().replace(/\./g, '-');
    let bestMatch = null;
    let bestLen = 0;

    for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
        const normalizedKey = key.replace(/\./g, '-');
        if (normalized.includes(normalizedKey) && normalizedKey.length > bestLen) {
            bestMatch = pricing;
            bestLen = normalizedKey.length;
        }
    }

    return bestMatch || { input: 0, output: 0 };
}

function calculateCost(model, promptTokens, completionTokens) {
    const pricing = getModelPricing(model);
    return (promptTokens / 1_000_000) * pricing.input
         + (completionTokens / 1_000_000) * pricing.output;
}

// ── Storage helpers (server-side file API) ───────────────────
// Files stored at: user/files/tct-{date}.json (flat naming, no subdirectories)
// Index stored at: user/files/tct-index.json

const FILE_PREFIX = 'tct-'; // prefix for all TCT files in user/files/

function getTodayKey() {
    return new Date().toISOString().slice(0, 10);
}

async function serverSave(filename, data) {
    const json = JSON.stringify(data, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const res = await fetch('/api/files/upload', {
        method: 'POST',
        credentials: 'include',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name: `${FILE_PREFIX}${filename}`, data: base64 }),
    });
    if (!res.ok) throw new Error(`[TCT] Save failed: ${res.status}`);
}

async function serverLoad(filename) {
    const res = await fetch(`/user/files/${FILE_PREFIX}${filename}`, {
        method: 'GET',
        credentials: 'include',
        headers: getRequestHeaders(),
    });
    if (!res.ok) return null;
    try {
        return await res.json();
    } catch {
        return null;
    }
}

async function serverDelete(filename) {
    const res = await fetch('/api/files/delete', {
        method: 'POST',
        credentials: 'include',
        headers: getRequestHeaders(),
        body: JSON.stringify({ path: `user/files/${FILE_PREFIX}${filename}` }),
    });
    if (!res.ok) console.warn(`[TCT] Delete failed: ${res.status}`);
}

// Index: tracks which date files exist (small, fast to load)
async function loadIndex() {
    return (await serverLoad('index.json')) || [];
}

async function saveIndex(keys) {
    await serverSave('index.json', keys);
}

async function addDateToIndex(dateKey) {
    const idx = await loadIndex();
    if (!idx.includes(dateKey)) {
        idx.push(dateKey);
        idx.sort().reverse();
        await saveIndex(idx);
    }
}

async function removeDateFromIndex(dateKey) {
    let idx = await loadIndex();
    idx = idx.filter(k => k !== dateKey);
    await saveIndex(idx);
}

// Per-day record files
async function getRecordsForDate(dateKey) {
    return (await serverLoad(`${dateKey}.json`)) || [];
}

async function saveRecordsForDate(dateKey, records) {
    if (records.length === 0) {
        await serverDelete(`${dateKey}.json`);
        await removeDateFromIndex(dateKey);
    } else {
        await serverSave(`${dateKey}.json`, records);
        await addDateToIndex(dateKey);
    }
}

async function getAllDateKeys() {
    return await loadIndex();
}

async function recordGeneration(model, api, promptTokens, completionTokens, cost, userMessage, aiResponse, sentPrompt) {
    const dateKey = getTodayKey();
    const records = await getRecordsForDate(dateKey);

    records.push({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        model,
        api,
        promptTokens,
        completionTokens,
        cost,
        userMessage,
        aiResponse,
        sentPrompt: sentPrompt || '',
    });

    await saveRecordsForDate(dateKey, records);
}

async function deleteRecord(dateKey, recordId) {
    const records = await getRecordsForDate(dateKey);
    const filtered = records.filter(r => r.id !== recordId);
    await saveRecordsForDate(dateKey, filtered);
}

async function deleteDate(dateKey) {
    await serverDelete(`${dateKey}.json`);
    await removeDateFromIndex(dateKey);
}

async function clearAllData() {
    const keys = await loadIndex();
    for (const key of keys) {
        await serverDelete(`${key}.json`);
    }
    await saveIndex([]);
}

async function pruneOldData() {
    const settings = getSettings();
    if (!settings.autoDeleteEnabled) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - settings.autoDeleteDays);
    const cutoffKey = cutoff.toISOString().slice(0, 10);

    const keys = await loadIndex();
    let pruned = 0;
    for (const key of keys) {
        if (key < cutoffKey) {
            await serverDelete(`${key}.json`);
            pruned++;
        }
    }
    if (pruned > 0) {
        const remaining = keys.filter(k => k >= cutoffKey);
        await saveIndex(remaining);
        console.log(`[TCT] Pruned ${pruned} days of old data`);
    }
}

async function exportAllData() {
    const keys = await getAllDateKeys();
    const data = {};
    for (const key of keys) {
        data[key] = await getRecordsForDate(key);
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `token-cost-tracker-${getTodayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success(I18N.dataExported);
}

// ── Token tracking ───────────────────────────────────────────
// Architecture:
// 1. Fetch interceptor intercepts ALL API calls to generate endpoints.
//    ALWAYS stores request info (model, sentPrompt) in pendingApiCalls map.
//    For SSE: reads cloned stream for usage data (updates the call entry).
//    For JSON: parses usage from response (OpenAI, Anthropic, Gemini formats).
// 2. GENERATION_ENDED: captures chat context, waits for SSE if needed,
//    then consumes the latest pendingApiCall (with or without usage data).
// 3. Background calls: if a call isn't consumed within 5s, auto-record.

const pendingApiCalls = new Map();
let pendingUserMessage = '';
let callIdCounter = 0;

function captureLastUserMessage() {
    try {
        const { chat } = SillyTavern.getContext();
        if (!chat) return;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i].is_user && !chat[i].is_system) {
                pendingUserMessage = chat[i].mes || '';
                return;
            }
        }
    } catch (e) {
        console.warn('[TCT] captureLastUserMessage error:', e);
    }
}

async function onGenerationEnded() {
    const settings = getSettings();
    if (!settings.enabled) return;

    // Wait for SSE reader to finish (only if there's an unresolved SSE call)
    const hasUnresolvedSSE = () => Array.from(pendingApiCalls.values()).some(c => c.isSSE && !c.hasUsage);
    if (hasUnresolvedSSE()) await new Promise(r => setTimeout(r, 500));
    if (hasUnresolvedSSE()) await new Promise(r => setTimeout(r, 1000));

    const { chat } = SillyTavern.getContext();
    if (!chat || chat.length === 0) return;

    const lastMsg = chat[chat.length - 1];
    if (lastMsg.is_user || lastMsg.is_system) return;

    const model = lastMsg.extra?.model || getGeneratingModel() || 'unknown';
    const api = lastMsg.extra?.api || '';
    const aiResponse = lastMsg.mes || '';

    let userMessage = pendingUserMessage || '';
    pendingUserMessage = '';
    if (!userMessage) {
        for (let i = chat.length - 2; i >= 0; i--) {
            if (chat[i].is_user && !chat[i].is_system) {
                userMessage = chat[i].mes || '';
                break;
            }
        }
    }

    // Find and consume the latest pending API call (within 30s)
    let call = null;
    let callId = null;
    for (const [id, c] of pendingApiCalls) {
        if ((Date.now() - c.timestamp) < 30000 && (!call || c.timestamp > call.timestamp)) {
            call = c;
            callId = id;
        }
    }
    if (callId != null) pendingApiCalls.delete(callId);

    let promptTokens = 0;
    let completionTokens = 0;
    let sentPrompt = '';

    if (call) {
        sentPrompt = call.sentPrompt || '';

        if (call.hasUsage) {
            promptTokens = call.promptTokens;
            completionTokens = call.completionTokens;
            console.log(`[TCT] Actual API usage: prompt=${promptTokens}, completion=${completionTokens}`);
        } else {
            // Intercepted but no usage data → estimate
            completionTokens = lastMsg.extra?.token_count || 0;
            if (!completionTokens && aiResponse) {
                try { completionTokens = await getTokenCountAsync(aiResponse); } catch {}
            }
            if (sentPrompt) {
                try { promptTokens = await getTokenCountAsync(sentPrompt); } catch {}
            }
            console.log(`[TCT] Estimated (no usage): prompt≈${promptTokens}, completion≈${completionTokens}`);
        }
    } else {
        // No intercepted data at all → pure estimation
        completionTokens = lastMsg.extra?.token_count || 0;
        if (!completionTokens && aiResponse) {
            try { completionTokens = await getTokenCountAsync(aiResponse); } catch {}
        }
        try {
            const promptText = chat
                .slice(0, chat.length - 1)
                .filter(m => m.mes && !m.is_system)
                .map(m => m.mes)
                .join('\n');
            if (promptText.length > 0) promptTokens = await getTokenCountAsync(promptText);
        } catch {}
        console.log(`[TCT] Pure estimation: prompt≈${promptTokens}, completion≈${completionTokens}`);
    }

    if (completionTokens === 0 && promptTokens === 0 && !aiResponse) return;

    const cost = calculateCost(model, promptTokens, completionTokens);
    await recordGeneration(model, api, promptTokens, completionTokens, cost, userMessage, aiResponse, sentPrompt);
    console.log(`[TCT] Recorded: ${model}, $${cost.toFixed(6)}`);
}

// ── Fetch interceptor ────────────────────────────────────────

const GENERATE_ENDPOINTS = [
    '/api/backends/chat-completions/generate',
    '/api/backends/text-completions/generate',
    '/api/backends/kobold/generate',
];

const MAX_PROMPT_LENGTH = 100000;

function extractRequestInfo(options) {
    try {
        const body = JSON.parse(options?.body || '{}');
        const model = body.model || 'unknown';
        let sentPrompt = '';

        if (Array.isArray(body.messages)) {
            sentPrompt = body.messages
                .map(m => `[${m.role || '?'}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
                .join('\n---\n');
        } else if (typeof body.prompt === 'string') {
            sentPrompt = body.prompt;
        }

        if (sentPrompt.length > MAX_PROMPT_LENGTH) {
            sentPrompt = sentPrompt.slice(0, MAX_PROMPT_LENGTH) + '\n\n... (truncated)';
        }

        return { model, sentPrompt };
    } catch (e) {
        console.warn('[TCT] extractRequestInfo error:', e);
        return { model: 'unknown', sentPrompt: '' };
    }
}

// Extract usage from multiple API response formats
function extractUsageFromResponse(data) {
    if (!data) return null;

    // OpenAI: { usage: { prompt_tokens, completion_tokens } }
    if (data.usage?.prompt_tokens != null || data.usage?.completion_tokens != null) {
        return { promptTokens: data.usage.prompt_tokens || 0, completionTokens: data.usage.completion_tokens || 0 };
    }
    // Anthropic: { usage: { input_tokens, output_tokens } }
    if (data.usage?.input_tokens != null || data.usage?.output_tokens != null) {
        return { promptTokens: data.usage.input_tokens || 0, completionTokens: data.usage.output_tokens || 0 };
    }
    // Google Gemini: { usageMetadata: { promptTokenCount, candidatesTokenCount } }
    if (data.usageMetadata?.promptTokenCount != null) {
        return { promptTokens: data.usageMetadata.promptTokenCount || 0, completionTokens: data.usageMetadata.candidatesTokenCount || 0 };
    }
    // Google Gemini nested: { response: { usageMetadata: ... } }
    if (data.response?.usageMetadata?.promptTokenCount != null) {
        return { promptTokens: data.response.usageMetadata.promptTokenCount || 0, completionTokens: data.response.usageMetadata.candidatesTokenCount || 0 };
    }
    return null;
}

function installFetchInterceptor() {
    const originalFetch = window.fetch;

    window.fetch = async function (url, options) {
        const response = await originalFetch.apply(this, arguments);

        if (!getSettings().enabled) return response;
        if (options?.method?.toUpperCase() !== 'POST') return response;
        const urlStr = typeof url === 'string' ? url : url?.url || '';
        if (!GENERATE_ENDPOINTS.some(ep => urlStr.includes(ep))) return response;

        const contentType = response.headers.get('content-type') || '';
        const requestInfo = extractRequestInfo(options);
        const callId = ++callIdCounter;
        const isSSE = contentType.includes('text/event-stream');

        console.log(`[TCT] Intercepted #${callId}: type=${contentType.split(';')[0]}, model=${requestInfo.model}`);

        // ALWAYS store call info immediately (even before usage data is known)
        const callEntry = {
            timestamp: Date.now(),
            model: requestInfo.model,
            sentPrompt: requestInfo.sentPrompt,
            promptTokens: 0,
            completionTokens: 0,
            hasUsage: false,
            isSSE,
            extractedResponse: '',
        };
        pendingApiCalls.set(callId, callEntry);

        if (isSSE) {
            try {
                const clone = response.clone();
                readSSEStreamForUsage(clone, callId).catch(e => console.warn('[TCT] SSE read rejected:', e));
            } catch (e) {
                console.warn('[TCT] SSE clone error:', e);
            }
        } else if (!contentType.includes('text/plain')) {
            try {
                const clone = response.clone();
                const data = await clone.json();

                // Extract usage from multiple formats
                const usage = extractUsageFromResponse(data);
                if (usage) {
                    callEntry.promptTokens = usage.promptTokens;
                    callEntry.completionTokens = usage.completionTokens;
                    callEntry.hasUsage = true;
                    console.log(`[TCT] #${callId} usage: prompt=${usage.promptTokens}, completion=${usage.completionTokens}`);
                } else {
                    console.debug(`[TCT] #${callId} no usage. Keys: ${Object.keys(data).join(', ')}`);
                }

                // Extract AI response text from choices (for background call recording)
                if (data.choices?.[0]?.message?.content) {
                    callEntry.extractedResponse = data.choices[0].message.content;
                } else if (data.choices?.[0]?.text) {
                    callEntry.extractedResponse = data.choices[0].text;
                }
            } catch (e) {
                console.warn('[TCT] JSON parse error:', e);
            }
        }

        // Background / cleanup timeout
        // SSE = chat generation (consumed by GENERATION_ENDED) → long cleanup (120s)
        // JSON = likely background/extension call → short auto-record (5s)
        const bgTimeout = isSSE ? 120000 : 5000;
        setTimeout(async () => {
            const call = pendingApiCalls.get(callId);
            if (!call) return; // already consumed by GENERATION_ENDED
            pendingApiCalls.delete(callId);

            // SSE calls that weren't consumed = cancelled/failed generation, just clean up
            if (call.isSSE) {
                console.log(`[TCT] Cleaned up unclaimed SSE call #${callId}`);
                return;
            }

            // Non-SSE: record as background call
            let pt = call.promptTokens;
            let ct = call.completionTokens;
            if (!call.hasUsage) {
                if (call.sentPrompt) {
                    try { pt = await getTokenCountAsync(call.sentPrompt); } catch {}
                }
                if (call.extractedResponse) {
                    try { ct = await getTokenCountAsync(call.extractedResponse); } catch {}
                }
            }
            const api = getApiFromModel(call.model);
            const cost = calculateCost(call.model, pt, ct);
            await recordGeneration(call.model, api, pt, ct, cost, '(background)', call.extractedResponse || '', call.sentPrompt);
            console.log(`[TCT] Background #${callId}: ${call.model}, prompt=${pt}, completion=${ct}, $${cost.toFixed(6)}`);
        }, bgTimeout);

        return response;
    };

    console.log('[TCT] Fetch interceptor installed');
}

async function readSSEStreamForUsage(response, callId) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
        }

        const lines = buffer.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;
            try {
                const data = JSON.parse(trimmed.slice(6));

                // OpenAI format
                if (data.usage?.prompt_tokens) inputTokens = data.usage.prompt_tokens;
                if (data.usage?.completion_tokens) outputTokens = data.usage.completion_tokens;

                // Anthropic format
                if (data.type === 'message_start' && data.message?.usage?.input_tokens) {
                    inputTokens = data.message.usage.input_tokens;
                }
                if (data.type === 'message_delta' && data.usage?.output_tokens) {
                    outputTokens = data.usage.output_tokens;
                }
            } catch {
                // Expected for non-JSON SSE lines
            }
        }

        console.log(`[TCT] #${callId} SSE: input=${inputTokens}, output=${outputTokens}`);

        const call = pendingApiCalls.get(callId);
        if (call && (inputTokens || outputTokens)) {
            call.promptTokens = inputTokens;
            call.completionTokens = outputTokens;
            call.hasUsage = true;
        }
    } catch (e) {
        console.warn('[TCT] SSE read error:', e);
    }
}

function getApiFromModel(model) {
    const m = (model || '').toLowerCase();
    if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'openai';
    if (m.includes('claude')) return 'claude';
    if (m.includes('gemini')) return 'makersuite';
    if (m.includes('grok')) return 'xai';
    if (m.includes('deepseek')) return 'deepseek';
    if (m.includes('mistral') || m.includes('ministral')) return 'mistralai';
    if (m.includes('command')) return 'cohere';
    return '';
}

// ── Formatting helpers ───────────────────────────────────────

function formatTokens(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toLocaleString();
}

function formatDate(dateKey) {
    const d = new Date(dateKey + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTime(isoString) {
    const d = new Date(isoString);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function getModelIcon(api) {
    const iconName = api || 'generic';
    return `<img class="icon-svg tct-model-icon" src="/img/${escapeHtml(iconName)}.svg" title="${escapeHtml(iconName)}" onerror="this.src='/img/generic.svg'">`;
}

// ── Popup views ──────────────────────────────────────────────

async function openTrackerPopup() {
    const container = document.createElement('div');
    container.className = 'tct-popup';

    // Render the calendar view initially
    await renderCalendarView(container);

    await callGenericPopup(container, POPUP_TYPE.TEXT, '', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        okButton: I18N.close,
    });
}

// ── View 1: Calendar (date list) ─────────────────────────────

async function renderCalendarView(container) {
    const sym = getSettings().currencySymbol || '$';
    const keys = await getAllDateKeys();

    let totalCost = 0;
    let totalCount = 0;
    const dateInfos = [];

    for (const key of keys) {
        const records = await getRecordsForDate(key);
        const dayCost = records.reduce((sum, r) => sum + r.cost, 0);
        totalCost += dayCost;
        totalCount += records.length;
        dateInfos.push({ key, count: records.length, cost: dayCost });
    }

    let html = `<div class="tct-header"><h3><i class="fa-solid fa-chart-line"></i> ${I18N.title}</h3></div>`;
    html += '<div class="tct-body">';

    if (dateInfos.length === 0) {
        html += `<div class="tct-empty"><i class="fa-solid fa-inbox" style="font-size:2em;margin-bottom:10px;display:block;"></i>${I18N.noData.replace('\n', '<br>')}</div>`;
    } else {
        html += '<div class="tct-date-grid">';
        for (const info of dateInfos) {
            html += `<div class="tct-date-btn" data-date="${info.key}">
                <div class="tct-date-label">${formatDate(info.key)}</div>
                <div class="tct-date-cost">${sym}${info.cost.toFixed(4)}</div>
                <div class="tct-date-count">${I18N.gens(info.count)}</div>
            </div>`;
        }
        html += '</div>';
    }

    html += '</div>'; // tct-body

    html += '<div class="tct-footer">';
    if (dateInfos.length > 0) {
        html += `<div class="tct-total-summary">${I18N.total(keys.length)}: <span class="tct-total-cost">${sym}${totalCost.toFixed(4)}</span> &middot; ${I18N.generations(totalCount)}</div>`;
    }
    html += '<div class="tct-footer-buttons">';
    html += `<div class="menu_button tct-export-btn"><i class="fa-solid fa-file-export"></i> ${I18N.export_}</div>`;
    html += `<div class="menu_button redWarningBG tct-clear-btn"><i class="fa-solid fa-trash"></i> ${I18N.clearAll}</div>`;
    html += '</div></div>';

    container.innerHTML = html;

    // Event listeners
    container.querySelectorAll('.tct-date-btn').forEach(btn => {
        btn.addEventListener('click', () => renderDayView(container, btn.dataset.date));
    });

    container.querySelector('.tct-export-btn')?.addEventListener('click', exportAllData);

    container.querySelector('.tct-clear-btn')?.addEventListener('click', async () => {
        const confirm = await Popup.show.confirm(I18N.confirmClearAll, I18N.confirmClearDesc);
        if (confirm !== POPUP_RESULT.AFFIRMATIVE) return;
        await clearAllData();
        toastr.success(I18N.allCleared);
        await renderCalendarView(container);
    });
}

// ── View 2: Day records ──────────────────────────────────────

async function renderDayView(container, dateKey) {
    const sym = getSettings().currencySymbol || '$';
    const records = await getRecordsForDate(dateKey);
    const dayCost = records.reduce((sum, r) => sum + r.cost, 0);

    let html = `<div class="tct-header">
        <h3>${formatDate(dateKey)}</h3>
        <div style="display:flex;gap:8px;align-items:center;">
            <div class="tct-day-delete" data-date="${dateKey}"><i class="fa-solid fa-trash"></i> ${I18N.deleteDay}</div>
            <div class="tct-back-btn" data-view="calendar"><i class="fa-solid fa-arrow-left"></i> ${I18N.back}</div>
        </div>
    </div>`;

    html += '<div class="tct-body">';

    if (records.length === 0) {
        html += `<div class="tct-empty">${I18N.noRecords}</div>`;
    } else {
        html += '<div class="tct-record-list">';
        for (const r of records) {
            html += `<div class="tct-record-card" data-id="${r.id}">
                <div class="tct-record-icon">${getModelIcon(r.api)}</div>
                <div class="tct-record-info">
                    <div class="tct-record-model">${escapeHtml(r.model)}</div>
                    <div class="tct-record-tokens">In: ${formatTokens(r.promptTokens)} &middot; Out: ${formatTokens(r.completionTokens)} &middot; ${formatTime(r.timestamp)}</div>
                </div>
                <div class="tct-record-cost">${sym}${r.cost.toFixed(4)}</div>
                <div class="tct-record-delete" data-id="${r.id}" title="Delete this record"><i class="fa-solid fa-xmark"></i></div>
            </div>`;
        }
        html += '</div>';
    }

    html += '</div>'; // tct-body

    html += '<div class="tct-footer">';
    html += `<div class="tct-day-summary">${I18N.dayTotal}: <span class="tct-total-cost">${sym}${dayCost.toFixed(4)}</span> &middot; ${I18N.generation(records.length)}</div>`;
    html += '</div>';

    container.innerHTML = html;

    // Back button
    container.querySelector('.tct-back-btn')?.addEventListener('click', () => renderCalendarView(container));

    // Record click → detail view
    container.querySelectorAll('.tct-record-card').forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't navigate if clicking delete button
            if (e.target.closest('.tct-record-delete')) return;
            const record = records.find(r => r.id === card.dataset.id);
            if (record) renderDetailView(container, dateKey, record);
        });
    });

    // Individual record delete
    container.querySelectorAll('.tct-record-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await deleteRecord(dateKey, btn.dataset.id);
            toastr.success(I18N.recordDeleted);
            await renderDayView(container, dateKey);
        });
    });

    // Day delete
    container.querySelector('.tct-day-delete')?.addEventListener('click', async () => {
        const confirm = await Popup.show.confirm(I18N.confirmDeleteDay(formatDate(dateKey)), I18N.cannotUndo);
        if (confirm !== POPUP_RESULT.AFFIRMATIVE) return;
        await deleteDate(dateKey);
        toastr.success(I18N.dayDeleted);
        await renderCalendarView(container);
    });
}

// ── View 3: Record detail ────────────────────────────────────

function renderDetailView(container, dateKey, record) {
    const sym = getSettings().currencySymbol || '$';

    let html = `<div class="tct-header">
        <h3>${getModelIcon(record.api)} ${escapeHtml(record.model)}</h3>
        <div class="tct-back-btn" data-view="day"><i class="fa-solid fa-arrow-left"></i> ${I18N.back}</div>
    </div>`;

    html += '<div class="tct-body">';

    html += `<div class="tct-detail-meta">
        <span><i class="fa-regular fa-clock"></i> ${new Date(record.timestamp).toLocaleString()}</span>
        <span><i class="fa-solid fa-arrow-up"></i> ${I18N.prompt}: ${formatTokens(record.promptTokens)}</span>
        <span><i class="fa-solid fa-arrow-down"></i> ${I18N.completion}: ${formatTokens(record.completionTokens)}</span>
        <span class="tct-total-cost"><i class="fa-solid fa-coins"></i> ${sym}${record.cost.toFixed(4)}</span>
    </div>`;

    if (record.sentPrompt) {
        html += `<div class="tct-detail-section">
            <h4><i class="fa-solid fa-file-lines"></i> ${I18N.sentPrompt}</h4>
            <div class="tct-detail-content tct-prompt-content">${escapeHtml(record.sentPrompt)}</div>
        </div>`;
    }

    if (record.aiResponse) {
        html += `<div class="tct-detail-section">
            <h4><i class="fa-solid fa-comment-dots"></i> ${I18N.aiResponse}</h4>
            <div class="tct-detail-content">${escapeHtml(record.aiResponse)}</div>
        </div>`;
    }

    html += '</div>'; // tct-body

    container.innerHTML = html;

    // Back button → day view
    container.querySelector('.tct-back-btn')?.addEventListener('click', () => renderDayView(container, dateKey));
}

// ── Settings panel binding ───────────────────────────────────

function bindSettingsEvents() {
    const settings = getSettings();

    // Apply i18n to settings panel
    const panel = document.getElementById('token_cost_tracker_settings');
    if (panel) {
        panel.querySelector('.inline-drawer-header b').textContent = I18N.title;
        const labels = panel.querySelectorAll('.checkbox_label span');
        if (labels[0]) labels[0].textContent = I18N.enableTracking;
        if (labels[1]) labels[1].textContent = I18N.autoDelete;
        const openBtn = panel.querySelector('#tct_open_popup span');
        if (openBtn) openBtn.textContent = I18N.openTracker;
    }

    const enabledCb = document.getElementById('tct_enabled');
    if (enabledCb) {
        enabledCb.checked = settings.enabled;
        enabledCb.addEventListener('change', () => {
            settings.enabled = enabledCb.checked;
            saveSettings();
        });
    }

    const autoDeleteCb = document.getElementById('tct_auto_delete');
    if (autoDeleteCb) {
        autoDeleteCb.checked = settings.autoDeleteEnabled;
        autoDeleteCb.addEventListener('change', () => {
            settings.autoDeleteEnabled = autoDeleteCb.checked;
            saveSettings();
        });
    }

    document.getElementById('tct_open_popup')?.addEventListener('click', openTrackerPopup);
}

// ── Init ─────────────────────────────────────────────────────

jQuery(async () => {
    getSettings();

    try {
        const html = await renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings');
        $('#extensions_settings2').append(html);
    } catch (err) {
        console.error('[TCT] Failed to load settings template:', err);
        return;
    }

    bindSettingsEvents();

    // Capture user message early (before generation completes)
    if (event_types.USER_MESSAGE_RENDERED) {
        eventSource.on(event_types.USER_MESSAGE_RENDERED, (messageId) => {
            const { chat } = SillyTavern.getContext();
            if (chat?.[messageId]?.mes) {
                pendingUserMessage = chat[messageId].mes;
            }
        });
    }
    if (event_types.GENERATION_STARTED) {
        eventSource.on(event_types.GENERATION_STARTED, captureLastUserMessage);
    }

    // Track tokens after each generation (normal chat)
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);

    // Intercept fetch for ALL API calls (streaming + non-streaming)
    installFetchInterceptor();

    // Auto-prune old data on load
    await pruneOldData();

    console.log('[TCT] Extension loaded');
});
