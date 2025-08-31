// Get the blocked URL and reason from query parameters
const urlParams = new URLSearchParams(window.location.search);
const blockedUrl = urlParams.get('url') || urlParams.get('blocked');
const blockReason = urlParams.get('reason');

if (blockedUrl) {
    document.getElementById('blockedUrl').textContent = decodeURIComponent(blockedUrl);
} else {
    document.getElementById('blockedUrl').textContent = 'Unknown website';
}

// Customize the page based on block reason
if (blockReason === 'ai-blocked') {
    document.getElementById('blockIcon').textContent = '🤖';
    document.getElementById('blockTitle').textContent = 'AI Focus Assistant';
    document.getElementById('blockSubtitle').textContent = 'This website was blocked by your AI focus assistant';
    document.getElementById('blockMessage').innerHTML = '<p>The AI determined this website is not relevant to your current focus context. Stay on track with your goals!</p>';
    document.getElementById('focusTip').style.display = 'block';
}

function openExtensionPopup() {
    // This will try to open the extension popup
    // Note: In newer Chrome versions, this may not work due to security restrictions
    try {
        chrome.runtime.sendMessage({action: 'openPopup'});
    } catch (e) {
        alert('Please click the Focus Mode extension icon in your browser toolbar to manage settings.');
    }
}

// Add some interactive elements
document.addEventListener('DOMContentLoaded', function() {
    // Add a subtle animation
    const container = document.querySelector('.container');
    container.style.opacity = '0';
    container.style.transform = 'translateY(20px)';
    
    setTimeout(() => {
        container.style.transition = 'all 0.5s ease';
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
    }, 100);
});
