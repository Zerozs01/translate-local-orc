document.addEventListener('DOMContentLoaded', () => {
  const translateButton = document.getElementById('translate');
  if (translateButton) {
    translateButton.addEventListener('click', () => {
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0].url) {
          const currentUrl = encodeURIComponent(tabs[0].url);
          const translateUrl = `https://translate.google.com/?sl=auto&tl=th&op=websites&url=${currentUrl}`;
          window.open(translateUrl, 'Google Translate', 'width=1000,height=800');
        }
      });
    });
  }
}); 