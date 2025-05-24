document.addEventListener('DOMContentLoaded', function() {
    const focusToggle = document.getElementById('focusToggle');
    const toggleLabel = document.getElementById('toggleLabel');
    const blockedUrls = document.getElementById('blockedUrls');
    const saveBtn = document.getElementById('saveBtn');
    const status = document.getElementById('status');

    // Load saved settings
    loadSettings();

    // Event listeners
    focusToggle.addEventListener('change', function() {
        updateToggleLabel();
        saveSettings();
    });

    saveBtn.addEventListener('click', saveSettings);

    function loadSettings() {
        chrome.storage.sync.get(['focusModeEnabled', 'blockedUrls'], function(result) {
            focusToggle.checked = result.focusModeEnabled || false;
            blockedUrls.value = result.blockedUrls || '';
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

        // Validate and clean URLs
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

        // Save to storage
        chrome.storage.sync.set({
            focusModeEnabled: isEnabled,
            blockedUrls: urls,
            blockedUrlsList: urlList
        }, function() {
            if (chrome.runtime.lastError) {
                showStatus('Error saving settings!', 'error');
                return;
            }

            // Update the background script
            chrome.runtime.sendMessage({
                action: 'updateRules',
                enabled: isEnabled,
                urls: urlList
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

    // Auto-save when typing in textarea (with 1500ms delay)
    let saveTimeout;
    blockedUrls.addEventListener('input', function() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(saveSettings, 1500);
    });
}); 