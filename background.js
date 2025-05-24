// Background script for Focus Mode extension

let currentRules = [];

// Initialize extension
chrome.runtime.onInstalled.addListener(function() {
    console.log('Focus Mode extension installed');
    loadSettings();
});

// Load settings on startup
chrome.runtime.onStartup.addListener(function() {
    loadSettings();
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'updateRules') {
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
    chrome.storage.sync.get(['focusModeEnabled', 'blockedUrlsList'], function(result) {
        const isEnabled = result.focusModeEnabled || false;
        const urls = result.blockedUrlsList || [];
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
    // Remove protocol if present and trim
    let url = input.replace(/^https?:\/\//, '').trim();
    
    // Remove trailing slash
    url = url.replace(/\/$/, '');
    
    // Check if it has a path
    const hasPath = url.includes('/');
    const pathPart = hasPath ? url.substring(url.indexOf('/')) : '';
    const hostPart = hasPath ? url.substring(0, url.indexOf('/')) : url;
    
    // Check if it's a subdomain (more than 2 parts and doesn't start with www)
    const hostParts = hostPart.split('.');
    const isSubdomain = hostParts.length > 2 && !hostPart.startsWith('www.');
    
    return {
        original: url,
        hostPart,
        pathPart,
        hasPath,
        isSubdomain
    };
}

function generateRulesForUrl(url, baseId) {
    const parsed = parseUrlInput(url);
    const rules = [];
    let currentId = baseId;
    
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
    } else {
        // Base domain - block ALL subdomains and base domain
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
    }
    
    return { rules, nextId: currentId };
}

async function clearAllDynamicRules() {
    try {
        // Get ALL existing dynamic rules from the browser
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        
        if (existingRules.length > 0) {
            const existingRuleIds = existingRules.map(rule => rule.id);
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: existingRuleIds
            });
            console.log(`Cleared ${existingRuleIds.length} existing dynamic rules`);
        }
        
        // Reset our tracking array
        currentRules = [];
    } catch (error) {
        console.error('Error clearing dynamic rules:', error);
        throw error;
    }
}

async function updateBlockingRules(enabled, urls) {
    try {
        // ALWAYS clear ALL dynamic rules first - this ensures clean state
        await clearAllDynamicRules();

        // If focus mode is disabled or no URLs, we're done (everything is cleared)
        if (!enabled || urls.length === 0) {
            console.log('Focus mode disabled or no URLs to block');
            return;
        }

        // Create new blocking rules
        let allRules = [];
        let currentId = 1;
        
        urls.forEach((url) => {
            if (url.trim()) {
                const { rules, nextId } = generateRulesForUrl(url.trim(), currentId);
                allRules = allRules.concat(rules);
                currentId = nextId;
                
                // Track all rule IDs
                rules.forEach(rule => currentRules.push(rule.id));
            }
        });

        // Add the new rules
        if (allRules.length > 0) {
            await chrome.declarativeNetRequest.updateDynamicRules({
                addRules: allRules
            });
            console.log(`Added ${allRules.length} blocking rules for ${urls.length} URLs`);
        }

    } catch (error) {
        console.error('Error updating blocking rules:', error);
        throw error;
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