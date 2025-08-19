document.getElementById("captureBtn").addEventListener("click", () => {
  // Get the currently active tab in the browser
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];

    // Encode the data to be safely passed in a URL
    const title = encodeURIComponent(tab.title);
    const url = encodeURIComponent(tab.url);

    // Construct the custom protocol URL that your Electron app will handle
    const menhirUrl = `menhir://capture?title=${title}&url=${url}`;

    // This is the key step: we "open" the link. The operating system
    // sees the 'menhir://' part and routes it to your running Electron app.
    window.open(menhirUrl);

    // Close the popup window after the action is sent
    window.close();
  });
});
