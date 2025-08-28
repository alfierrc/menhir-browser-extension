const titleEl = document.getElementById("title");
const typeEl = document.getElementById("type");
const captureBtn = document.getElementById("captureBtn");

// This function now takes the analysis result and sets up the button
function setupCaptureButton(type, data) {
  titleEl.textContent = data.title;
  typeEl.textContent = type.charAt(0).toUpperCase() + type.slice(1);
  captureBtn.disabled = false;

  captureBtn.onclick = () => {
    let menhirUrl = `menhir://capture?type=${type}&title=${encodeURIComponent(
      data.title
    )}&source=${encodeURIComponent(data.source)}`;

    if (data.price) menhirUrl += `&price=${encodeURIComponent(data.price)}`;
    if (data.currency)
      menhirUrl += `&currency=${encodeURIComponent(data.currency)}`; // Add this line
    if (data.image) menhirUrl += `&image=${encodeURIComponent(data.image)}`;

    window.open(menhirUrl);
    window.close();
  };
}

// The main function that runs when the popup opens
async function analyze() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Send a message to our content script and wait for the analysis
  const response = await chrome.tabs.sendMessage(tab.id, {
    action: "analyzePage",
  });

  if (!response) {
    titleEl.textContent = "Cannot access page content.";
    return;
  }

  const { type, data } = response;

  titleEl.textContent = data.title;
  typeEl.textContent = type.charAt(0).toUpperCase() + type.slice(1);
  captureBtn.disabled = false;

  captureBtn.onclick = async () => {
    // If it's a webpage, take a screenshot
    if (type === "webpage") {
      const screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: "jpeg",
        quality: 85,
      });

      const screenshotId = Date.now().toString();

      // Send the screenshot to the local server in the main app
      try {
        await fetch("http://localhost:28080/capture-screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            screenshotId: screenshotId,
            data: screenshotDataUrl,
          }),
        });
      } catch (e) {
        console.error("Failed to send screenshot to Menhir app.", e);
        titleEl.textContent = "Error: Is the Menhir app running?";
        return;
      }

      // Trigger the capture in the main app, referencing the screenshotId
      const menhirUrl = `menhir://capture?type=webpage&title=${encodeURIComponent(
        data.title
      )}&source=${encodeURIComponent(
        data.source
      )}&screenshotId=${screenshotId}`;

      window.open(menhirUrl);
      window.close();
    } else {
      // For all other types (product, image), use the old logic
      let menhirUrl = `menhir://capture?type=${type}&title=${encodeURIComponent(
        data.title
      )}&source=${encodeURIComponent(data.source)}`;

      if (data.price) menhirUrl += `&price=${encodeURIComponent(data.price)}`;
      if (data.currency)
        menhirUrl += `&currency=${encodeURIComponent(data.currency)}`;
      if (data.vendor)
        menhirUrl += `&vendor=${encodeURIComponent(data.vendor)}`;
      if (data.image) menhirUrl += `&image=${encodeURIComponent(data.image)}`;

      window.open(menhirUrl);
      window.close();
    }
  };
}

// Inject the script and then run the analysis
async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab.url;

  // --- NEW: Check for direct image URL first ---
  if (url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) {
    console.log("Direct image URL detected.");

    // 1. Clean the URL by removing everything after the first '?'
    const cleanUrl = url.split("?")[0];

    // 2. Get the filename from the *clean* URL
    const filename = cleanUrl.substring(cleanUrl.lastIndexOf("/") + 1);

    const data = {
      title: filename,
      source: url, // Keep the original URL for reference
      image: cleanUrl, // Use the clean URL for downloading
    };
    setupCaptureButton("image", data);
    return; // Stop here, no need to scrape
  }

  // --- Fallback to scraping for regular HTML pages ---
  console.log("HTML page detected, injecting scraper.");

  const listener = (message) => {
    if (message.payload) {
      setupCaptureButton(message.payload.type, message.payload.data);
      chrome.runtime.onMessage.removeListener(listener);
    }
  };
  chrome.runtime.onMessage.addListener(listener);

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["scraper.js"],
  });
  analyze();
}

// Run the function when the popup opens
initialize();
