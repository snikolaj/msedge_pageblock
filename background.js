// Background script for Focus Mode extension

let currentRules = [];
let currentFocusContext = '';

// TODO: Replace with your actual Gemini API key from the prepi file
const GEMINI_API_KEY = '[INSERT-YOUR-API-KEY-HERE]';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

// Initialize extension
chrome.runtime.onInstalled.addListener(function() {
    console.log('Focus Mode extension installed');
    loadSettings();
    updateIcon();
});

// Listen for tab updates to check AI relevance
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only process when the URL changes and is loading
    if (changeInfo.status === 'loading' && changeInfo.url) {
        console.log(`[AI BLOCKING] Tab updated - ID: ${tabId}, URL: ${changeInfo.url}, Status: ${changeInfo.status}`);
        await handleTabNavigation(tabId, changeInfo.url);
    }
});

// Listen for new tabs being created
chrome.tabs.onCreated.addListener(async (tab) => {
    if (tab.url && tab.url !== 'chrome://newtab/') {
        console.log(`[AI BLOCKING] New tab created - ID: ${tab.id}, URL: ${tab.url}`);
        await handleTabNavigation(tab.id, tab.url);
    }
});

// Load settings on startup
chrome.runtime.onStartup.addListener(function() {
    loadSettings();
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'updateRules') {
        currentFocusContext = request.context || '';
        console.log(`[AI BLOCKING] Rules updated - Focus context: "${currentFocusContext}", Enabled: ${request.enabled}, URLs: ${request.urls?.length || 0}`);
        updateBlockingRules(request.enabled, request.urls)
            .then(() => {
                sendResponse({ success: true });
            })
            .catch((error) => {
                console.error('Error updating rules:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep message channel open for async response
    }
});

function loadSettings() {
    chrome.storage.sync.get(['focusModeEnabled', 'blockedUrlsList', 'focusContext'], function(result) {
        const isEnabled = result.focusModeEnabled || false;
        const urls = result.blockedUrlsList || [];
        currentFocusContext = result.focusContext || '';
        updateBlockingRules(isEnabled, urls);
    });
}

/**
 * URL PARSER DOCUMENTATION
 * ======================
 * 
 * The parseUrlInput() function transforms user input into structured data for rule generation.
 * Here's how it works step-by-step:
 * 
 * STEP 1: Clean the input
 * - Remove protocol (https:// or http://) if present
 * - Trim whitespace
 * - Remove trailing slash
 * 
 * STEP 2: Detect if URL has a path
 * - Check if input contains '/' character
 * - Split into host part (before /) and path part (after /)
 * 
 * STEP 3: Determine if it's a subdomain
 * - Split host by '.' to count parts
 * - If more than 2 parts AND doesn't start with 'www.' = subdomain
 * 
 * EXAMPLES:
 * 
 * Input: "https://reddit.com/"
 * → hostPart: "reddit.com"
 * → pathPart: ""
 * → hasPath: false
 * → isSubdomain: false (only 2 parts: reddit + com)
 * 
 * Input: "old.reddit.com"
 * → hostPart: "old.reddit.com" 
 * → pathPart: ""
 * → hasPath: false
 * → isSubdomain: true (3 parts: old + reddit + com, no www)
 * 
 * Input: "www.reddit.com"
 * → hostPart: "www.reddit.com"
 * → pathPart: ""
 * → hasPath: false  
 * → isSubdomain: false (starts with www, treated as base domain)
 * 
 * Input: "reddit.com/r/"
 * → hostPart: "reddit.com"
 * → pathPart: "/r/"
 * → hasPath: true
 * → isSubdomain: false
 * 
 * Input: "old.reddit.com/gallery/"
 * → hostPart: "old.reddit.com"
 * → pathPart: "/gallery/"
 * → hasPath: true
 * → isSubdomain: true
 * 
 * RULE GENERATION LOGIC:
 * - Base domain (reddit.com) → blocks ALL subdomains: *.reddit.com
 * - Subdomain (old.reddit.com) → blocks ONLY that subdomain + www variant
 * - Path (/r/) → blocks that specific path on target domain(s)
 */

function parseUrlInput(input) {
    console.log('BG Parse: Input received:', input);
    // Remove protocol if present and trim
    let url = input.replace(/^https?:\/\//, '').trim();
    
    // Remove trailing slash
    url = url.replace(/\/$/, '');
    
    // Check if it has a path
    const hasPath = url.includes('/');
    const pathPart = hasPath ? url.substring(url.indexOf('/')) : '';
    const hostPart = hasPath ? url.substring(0, url.indexOf('/')) : url;
    
    // Special handling for Gmail - treat it as a base domain to catch all variations
    const isGmailSpecial = hostPart === 'mail.google.com' || hostPart === 'gmail.com';
    
    // Check if it's a subdomain (more than 2 parts and doesn't start with www)
    const hostParts = hostPart.split('.');
    const isSubdomain = hostParts.length > 2 && !hostPart.startsWith('www.') && !isGmailSpecial;
    
    const result = {
        original: url,
        hostPart,
        pathPart,
        hasPath,
        isSubdomain,
        isGmailSpecial
    };
    console.log('BG Parse: Parsed result:', result);
    return result;
}

function generateRulesForUrl(url, baseId) {
    const parsed = parseUrlInput(url);
    console.log(`BG GenerateRules: Generating for parsed input "${url}", parsed object:`, parsed);
    const rules = [];
    let currentId = baseId;
    
    // Special Gmail handling - create comprehensive blocking rules
    if (parsed.isGmailSpecial) {
        console.log('BG GenerateRules: Applying Gmail special handling');
        // Block all Gmail variations with multiple patterns and resource types
        const gmailPatterns = [
            'mail.google.com',
            'gmail.com',
            'www.gmail.com'
        ];
        
        gmailPatterns.forEach(pattern => {
            // Pattern 1: Standard domain blocking
            rules.push({
                id: currentId++,
                priority: 2, // Higher priority for Gmail
                action: {
                    type: 'redirect',
                    redirect: {
                        url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                    }
                },
                condition: {
                    urlFilter: `||${pattern}/`,
                    resourceTypes: ['main_frame']
                }
            });
            
            // Pattern 2: Wildcard with protocol
            rules.push({
                id: currentId++,
                priority: 2,
                action: {
                    type: 'redirect',
                    redirect: {
                        url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                    }
                },
                condition: {
                    urlFilter: `*://${pattern}/*`,
                    resourceTypes: ['main_frame']
                }
            });
            
            // Pattern 3: Specific Gmail paths
            rules.push({
                id: currentId++,
                priority: 2,
                action: {
                    type: 'redirect',
                    redirect: {
                        url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                    }
                },
                condition: {
                    urlFilter: `*://${pattern}/mail/*`,
                    resourceTypes: ['main_frame']
                }
            });
            
            // Pattern 4: Block sub-resources too (in case Gmail loads via AJAX)
            rules.push({
                id: currentId++,
                priority: 2,
                action: {
                    type: 'redirect',
                    redirect: {
                        url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                    }
                },
                condition: {
                    urlFilter: `||${pattern}/`,
                    resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest']
                }
            });
            
            // Pattern 5: Very specific Gmail URL pattern
            if (pattern === 'mail.google.com') {
                rules.push({
                    id: currentId++,
                    priority: 3, // Even higher priority
                    action: {
                        type: 'redirect',
                        redirect: {
                            url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                        }
                    },
                    condition: {
                        urlFilter: `https://mail.google.com/mail/u/*`,
                        resourceTypes: ['main_frame']
                    }
                });
            }
        });
        
        console.log(`BG GenerateRules: Generated Gmail rules for ${url}:`, JSON.stringify(rules));
        return { rules, nextId: currentId };
    }
    
    if (parsed.hasPath) {
        if (parsed.isSubdomain) {
            // Subdomain with path - block only that specific subdomain path
            rules.push({
                id: currentId++,
                priority: 1,
                action: {
                    type: 'redirect',
                    redirect: {
                        url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                    }
                },
                condition: {
                    urlFilter: `||${parsed.hostPart}${parsed.pathPart}`,
                    resourceTypes: ['main_frame']
                }
            });
            
            // Also block www variant of subdomain
            rules.push({
                id: currentId++,
                priority: 1,
                action: {
                    type: 'redirect',
                    redirect: {
                        url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                    }
                },
                condition: {
                    urlFilter: `||www.${parsed.hostPart}${parsed.pathPart}`,
                    resourceTypes: ['main_frame']
                }
            });
        } else {
            // Base domain with path - block on ALL subdomains and base
            rules.push({
                id: currentId++,
                priority: 1,
                action: {
                    type: 'redirect',
                    redirect: {
                        url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                    }
                },
                condition: {
                    urlFilter: `||${parsed.hostPart}${parsed.pathPart}`,
                    resourceTypes: ['main_frame']
                }
            });
        }
    } else if (parsed.isSubdomain) {
        // Specific subdomain - block ONLY that exact subdomain
        rules.push({
            id: currentId++,
            priority: 1,
            action: {
                type: 'redirect',
                redirect: {
                    url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                }
            },
            condition: {
                urlFilter: `||${parsed.hostPart}/`,
                resourceTypes: ['main_frame']
            }
        });
        
        // Also block www variant of subdomain (if it doesn't already have www)
        if (!parsed.hostPart.startsWith('www.')) {
            rules.push({
                id: currentId++,
                priority: 1,
                action: {
                    type: 'redirect',
                    redirect: {
                        url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                    }
                },
                condition: {
                    urlFilter: `||www.${parsed.hostPart}/`,
                    resourceTypes: ['main_frame']
                }
            });
        }
    } else { // This is for base domains (neither path nor subdomain, and not Gmail special)
        rules.push({
            id: currentId++,
            priority: 1,
            action: {
                type: 'redirect',
                redirect: {
                    url: chrome.runtime.getURL('blocked.html') + '?blocked=' + encodeURIComponent(parsed.original)
                }
            },
            condition: {
                // Ensure this blocks wildcard subdomains as well for true base domains
                // The filter "||example.com/" effectively blocks *.example.com and example.com.
                urlFilter: `||${parsed.hostPart}/`,
                resourceTypes: ['main_frame']
            }
        });
    }
    
    console.log(`BG GenerateRules: Generated non-Gmail rules for ${url}:`, JSON.stringify(rules));
    return { rules, nextId: currentId };
}

async function clearAllDynamicRules() {
    try {
        console.log('BG ClearRules: Getting existing dynamic rules...');
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        
        if (existingRules.length > 0) {
            const existingRuleIds = existingRules.map(rule => rule.id);
            console.log(`BG ClearRules: Attempting to remove rule IDs:`, existingRuleIds);
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: existingRuleIds
            });
            console.log(`BG ClearRules: Cleared ${existingRuleIds.length} existing dynamic rules.`);
        } else {
            console.log('BG ClearRules: No existing dynamic rules to clear.');
        }
        currentRules = [];
    } catch (error) {
        console.error('BG ClearRules: Error clearing dynamic rules:', error);
        throw error;
    }
}

async function updateBlockingRules(enabled, urls) {
    console.log('BG UpdateRules: Received:', { enabled, urls });
    try {
        await clearAllDynamicRules();

        if (!enabled || urls.length === 0) {
            console.log('BG UpdateRules: Focus mode disabled or no URLs to block. Rules cleared.');
            // Verify no rules exist
            const verifyRulesEmpty = await chrome.declarativeNetRequest.getDynamicRules();
            console.log('BG UpdateRules: Verified dynamic rules (should be empty):', JSON.stringify(verifyRulesEmpty));
            return;
        }

        let allRules = [];
        let currentId = 1;
        
        urls.forEach((url) => {
            if (url.trim()) {
                const { rules: generatedRules, nextId } = generateRulesForUrl(url.trim(), currentId); // Renamed 'rules' to 'generatedRules' to avoid conflict
                allRules = allRules.concat(generatedRules);
                currentId = nextId;
                generatedRules.forEach(rule => currentRules.push(rule.id)); // currentRules is for tracking IDs for potential removal, seems okay.
            }
        });

        if (allRules.length > 0) {
            console.log('BG UpdateRules: Attempting to add rules:', JSON.stringify(allRules));
            await chrome.declarativeNetRequest.updateDynamicRules({
                addRules: allRules
            });
            console.log(`BG UpdateRules: Added ${allRules.length} blocking rules for ${urls.length} URLs.`);
            const verifyRules = await chrome.declarativeNetRequest.getDynamicRules();
            console.log('BG UpdateRules: Verified dynamic rules after adding:', JSON.stringify(verifyRules));
        } else {
            console.log('BG UpdateRules: No rules were generated to add.');
             const verifyRulesEmpty = await chrome.declarativeNetRequest.getDynamicRules();
            console.log('BG UpdateRules: Verified dynamic rules (should be empty if none generated):', JSON.stringify(verifyRulesEmpty));
        }

    } catch (error) {
        console.error('BG UpdateRules: Error:', error);
        // Log current rules state even on error
        try {
            const rulesOnError = await chrome.declarativeNetRequest.getDynamicRules();
            console.error('BG UpdateRules: Dynamic rules state during error:', JSON.stringify(rulesOnError));
        } catch (e) {
            console.error('BG UpdateRules: Could not get dynamic rules during error handling:', e);
        }
        throw error; // Re-throw to be caught by the caller in onMessage
    }
}

// Handle extension icon click to show current status
chrome.action.onClicked.addListener(function(tab) {
    chrome.storage.sync.get(['focusModeEnabled'], function(result) {
        const isEnabled = result.focusModeEnabled || false;
        const iconPath = isEnabled ? 'icon-active.png' : 'icon-inactive.png';
        
        chrome.action.setIcon({
            path: iconPath,
            tabId: tab.id
        });
    });
});

// Update icon based on focus mode status
function updateIcon() {
    chrome.storage.sync.get(['focusModeEnabled'], function(result) {
        const isEnabled = result.focusModeEnabled || false;
        const iconPath = isEnabled ? 'icon-active.png' : 'icon-inactive.png';
        
        chrome.action.setIcon({
            path: iconPath
        });
    });
}

// Listen for storage changes to update icon
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'sync' && changes.focusModeEnabled) {
        updateIcon();
    }
});

/**
 * AI RELEVANCE CHECKING FUNCTIONS
 * ===============================
 */

/**
 * Check if a URL is relevant to the current focus context using Gemini AI
 * @param {string} url - The URL to check
 * @param {string} context - The user's focus context
 * @returns {Promise<boolean>} - True if relevant, false if should be blocked
 */
async function checkUrlRelevance(url, context) {
    console.log(`[AI BLOCKING] Starting AI relevance check for URL: ${url}`);
    console.log(`[AI BLOCKING] Focus context: "${context}"`);
    
    if (!context || !context.trim()) {
        console.log(`[AI BLOCKING] No context provided, allowing URL through`);
        return true;
    }

    if (GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
        console.warn(`[AI BLOCKING] Gemini API key not configured (still placeholder). Allowing URL through.`);
        return true;
    }

    try {
        const prompt = `You are a focus assistant helping someone stay on task. 

User's current focus context: "${context}"
URL they're trying to visit: "${url}"

Determine if this URL is relevant to their current focus context. Consider:
- Direct relevance to their stated task/topic
- Educational or research value for their context
- Tools or resources that would help with their work
- Reference materials or documentation

Respond with only "RELEVANT" if the URL would help with their focus context, or "IRRELEVANT" if it would be a distraction.`;

        console.log(`[AI BLOCKING] Sending API request to Gemini...`);
        console.log(`[AI BLOCKING] API URL: ${GEMINI_API_URL}?key=${GEMINI_API_KEY.substring(0, 10)}...`);
        
        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }]
            })
        });

        console.log(`[AI BLOCKING] API response status: ${response.status}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[AI BLOCKING] API request failed: ${response.status} - ${errorText}`);
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        console.log(`[AI BLOCKING] API response data:`, JSON.stringify(data, null, 2));
        
        const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();
        
        console.log(`[AI BLOCKING] AI response text: "${aiResponse}"`);
        console.log(`[AI BLOCKING] AI relevance result: ${aiResponse === 'RELEVANT' ? 'RELEVANT (allowing)' : 'IRRELEVANT (blocking)'}`);
        
        // Return true if relevant (allow), false if irrelevant (block)
        return aiResponse === 'RELEVANT';
        
    } catch (error) {
        console.error(`[AI BLOCKING] Error checking URL relevance with AI:`, error);
        console.log(`[AI BLOCKING] Failing open - allowing URL through due to error`);
        // On error, allow the URL through (fail open)
        return true;
    }
}

/**
 * Check if a URL is a local file or extension page
 * @param {string} url - The URL to check
 * @returns {boolean} - True if it's a local/internal URL
 */
function isLocalUrl(url) {
    return url.startsWith('chrome://') || 
           url.startsWith('chrome-extension://') || 
           url.startsWith('file://') || 
           url.startsWith('about:') ||
           url.startsWith('moz-extension://') ||
           url.startsWith('edge://') ||
           url.startsWith('opera://');
}

/**
 * Handle tab navigation and check if URL should be blocked
 * @param {number} tabId - The tab ID
 * @param {string} url - The URL being navigated to
 */
async function handleTabNavigation(tabId, url) {
    try {
        console.log(`[AI BLOCKING] Processing navigation - Tab: ${tabId}, URL: ${url}`);
        
        // Skip local URLs as requested
        if (isLocalUrl(url)) {
            console.log(`[AI BLOCKING] Skipping local URL: ${url}`);
            return;
        }

        // Get current settings
        const result = await chrome.storage.sync.get(['focusModeEnabled', 'blockedUrlsList', 'focusContext']);
        const isEnabled = result.focusModeEnabled || false;
        const blockedUrls = result.blockedUrlsList || [];
        const focusContext = result.focusContext || '';
        
        console.log(`[AI BLOCKING] Settings - Enabled: ${isEnabled}, Context: "${focusContext}", Blocked URLs: ${blockedUrls.length}`);
        
        if (!isEnabled) {
            console.log(`[AI BLOCKING] Focus mode disabled, allowing URL: ${url}`);
            return;
        }

        // First check regular blocklist
        const isRegularBlocked = blockedUrls.some(blockedUrl => {
            if (blockedUrl.trim() === '') return false;
            try {
                const matches = url.toLowerCase().includes(blockedUrl.toLowerCase());
                if (matches) {
                    console.log(`[AI BLOCKING] URL matches regular blocklist: ${blockedUrl}`);
                }
                return matches;
            } catch (e) {
                console.error(`[AI BLOCKING] Error checking blocklist item "${blockedUrl}":`, e);
                return false;
            }
        });

        if (isRegularBlocked) {
            console.log(`[AI BLOCKING] URL blocked by regular rules, letting declarativeNetRequest handle it: ${url}`);
            return;
        }

        // If we have a focus context, check AI relevance
        if (focusContext && focusContext.trim()) {
            console.log(`[AI BLOCKING] Checking AI relevance for URL: ${url}`);
            const isRelevant = await checkUrlRelevance(url, focusContext);
            
            console.log(`[AI BLOCKING] AI relevance result: ${isRelevant ? 'RELEVANT' : 'IRRELEVANT'}`);
            
            if (!isRelevant) {
                console.log(`[AI BLOCKING] Blocking URL: ${url} (not relevant to context: ${focusContext})`);
                await blockUrlTemporarily(url, tabId);
            } else {
                console.log(`[AI BLOCKING] Allowing URL: ${url} (relevant to context)`);
            }
        } else {
            console.log(`[AI BLOCKING] No focus context set, allowing URL: ${url}`);
        }
    } catch (error) {
        console.error(`[AI BLOCKING] Error in handleTabNavigation for ${url}:`, error);
    }
}

/**
 * Temporarily block a specific URL by redirecting the tab
 * @param {string} url - The URL to block
 * @param {number} tabId - The tab ID to redirect
 */
async function blockUrlTemporarily(url, tabId) {
    try {
        console.log(`[AI BLOCKING] Redirecting tab ${tabId} to blocked page`);
        const blockedPageUrl = chrome.runtime.getURL('blocked.html') + '?url=' + encodeURIComponent(url) + '&reason=ai-blocked';
        console.log(`[AI BLOCKING] Blocked page URL: ${blockedPageUrl}`);
        
        await chrome.tabs.update(tabId, { url: blockedPageUrl });
        console.log(`[AI BLOCKING] Successfully redirected tab ${tabId}`);
    } catch (error) {
        console.error(`[AI BLOCKING] Error blocking URL temporarily:`, error);
    }
}
