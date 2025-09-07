document.addEventListener('DOMContentLoaded', function() {
    const focusToggle = document.getElementById('focusToggle');
    const toggleLabel = document.getElementById('toggleLabel');
    const focusContext = document.getElementById('focusContext');
    const blockedUrls = document.getElementById('blockedUrls');
    const whitelistedUrls = document.getElementById('whitelistedUrls');
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');
    const timerSection = document.getElementById('timerSection');
    const timerCountdown = document.getElementById('timerCountdown');
    
    let timerInterval = null;
    let timerEndTime = null;

    // Load saved settings
    loadSettings();

    // Event listeners
    focusToggle.addEventListener('change', function() {
        if (focusToggle.checked) {
            // Starting focus mode - set 30-minute timer
            const now = Date.now();
            timerEndTime = now + (30 * 60 * 1000); // 30 minutes from now
            chrome.storage.sync.set({ timerEndTime: timerEndTime });
            startTimer();
        } else {
            // Check if timer is still active
            if (timerEndTime && Date.now() < timerEndTime) {
                // Prevent disabling - revert the toggle
                focusToggle.checked = true;
                showStatus('Focus Mode is locked for ' + getTimeRemaining() + '. Cannot disable yet!', 'error');
                return;
            } else {
                // Timer expired or not set - allow disabling
                stopTimer();
                chrome.storage.sync.remove('timerEndTime');
            }
        }
        updateToggleLabel();
        saveSettings();
    });

    saveBtn.addEventListener('click', saveSettings);

    function loadSettings() {
        chrome.storage.sync.get(['focusModeEnabled', 'blockedUrls', 'whitelistedUrls', 'focusContext', 'timerEndTime'], function(result) {
            focusToggle.checked = result.focusModeEnabled || false;
            blockedUrls.value = result.blockedUrls || '';
            whitelistedUrls.value = result.whitelistedUrls || '';
            focusContext.value = result.focusContext || '';
            
            // Load timer state
            if (result.timerEndTime) {
                timerEndTime = result.timerEndTime;
                const now = Date.now();
                if (now < timerEndTime) {
                    // Timer is still active
                    startTimer();
                } else {
                    // Timer expired - clean up
                    chrome.storage.sync.remove('timerEndTime');
                    timerEndTime = null;
                }
            }
            
            updateToggleLabel();
        });
    }

    function updateToggleLabel() {
        toggleLabel.textContent = focusToggle.checked ? 'Focus Mode: ON' : 'Focus Mode: OFF';
        toggleLabel.style.color = focusToggle.checked ? '#28a745' : '#6c757d';
    }

    function saveSettings() {
        const isEnabled = focusToggle.checked;
        const urls = blockedUrls.value.trim();
        const whitelistUrls = whitelistedUrls.value.trim();

        // Validate and clean blocked URLs
        const urlList = urls.split('\n')
            .map(url => url.trim())
            .filter(url => url.length > 0)
            .map(url => {
                // Remove protocol if present
                url = url.replace(/^https?:\/\//, '');
                // Remove www. prefix if present
                url = url.replace(/^www\./, '');
                // Remove trailing slash
                url = url.replace(/\/$/, '');
                return url;
            });
            
        // Validate and clean whitelist URLs
        const whitelistUrlList = whitelistUrls.split('\n')
            .map(url => url.trim())
            .filter(url => url.length > 0)
            .map(url => {
                // Remove protocol if present
                url = url.replace(/^https?:\/\//, '');
                // Remove www. prefix if present
                url = url.replace(/^www\./, '');
                // Remove trailing slash
                url = url.replace(/\/$/, '');
                return url;
            });

        // Add this log
        console.log('Popup: Sending to background:', { isEnabled, urls: urlList, whitelist: whitelistUrlList, rawUrlsInput: urls });

        const context = focusContext.value.trim();

        // Save to storage
        chrome.storage.sync.set({
            focusModeEnabled: isEnabled,
            blockedUrls: urls,
            blockedUrlsList: urlList,
            whitelistedUrls: whitelistUrls,
            whitelistedUrlsList: whitelistUrlList,
            focusContext: context
        }, function() {
            if (chrome.runtime.lastError) {
                showStatus('Error saving settings!', 'error');
                return;
            }

            // Update the background script
            chrome.runtime.sendMessage({
                action: 'updateRules',
                enabled: isEnabled,
                urls: urlList,
                whitelist: whitelistUrlList,
                context: context
            }, function(response) {
                if (chrome.runtime.lastError) {
                    showStatus('Error updating blocking rules!', 'error');
                } else {
                    showStatus('Settings saved successfully!', 'success');
                }
            });
        });
    }

    function showStatus(message, type) {
        status.textContent = message;
        status.className = `status ${type}`;
        setTimeout(() => {
            status.textContent = '';
            status.className = 'status';
        }, 3000);
    }

    // Timer helper functions
    function startTimer() {
        timerSection.style.display = 'block';
        updateTimerDisplay();
        timerInterval = setInterval(updateTimerDisplay, 1000);
    }
    
    function stopTimer() {
        timerSection.style.display = 'none';
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }
    
    function updateTimerDisplay() {
        if (!timerEndTime) return;
        
        const now = Date.now();
        const remaining = timerEndTime - now;
        
        if (remaining <= 0) {
            // Timer expired
            stopTimer();
            timerEndTime = null;
            chrome.storage.sync.remove('timerEndTime');
            showStatus('Focus Mode timer expired. You can now disable Focus Mode.', 'success');
            return;
        }
        
        timerCountdown.textContent = getTimeRemaining();
    }
    
    function getTimeRemaining() {
        if (!timerEndTime) return '00:00';
        
        const now = Date.now();
        const remaining = Math.max(0, timerEndTime - now);
        const minutes = Math.floor(remaining / (1000 * 60));
        const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
        
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    // Auto-save when typing in textareas (with 1500ms delay)
    let saveTimeout;
    blockedUrls.addEventListener('input', function() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveSettings, 1500);
    });
    
    whitelistedUrls.addEventListener('input', function() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveSettings, 1500);
    });
    
    focusContext.addEventListener('input', function() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveSettings, 1500);
    });
});
