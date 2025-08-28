const titleEl = document.getElementById("title");
const typeEl = document.getElementById("type");
const captureBtn = document.getElementById("captureBtn");

async function injectScript(tabId, func, args = []) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return result[0].result;
}

async function captureFullPage(tabId) {
  // 1. Get the necessary dimensions from the page
  const pageDetails = await injectScript(tabId, () => ({
    totalHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));

  const { totalHeight, viewportHeight, viewportWidth } = pageDetails;
  let capturedHeight = 0;
  const screenshots = [];

  // 2. Scroll and capture in a loop
  while (capturedHeight < totalHeight) {
    // Ensure the page is scrolled to the correct position
    await injectScript(tabId, (y) => window.scrollTo(0, y), [capturedHeight]);

    // Allow a brief moment for the page to render after scrolling
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Capture the visible part of the tab
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "jpeg",
      quality: 90,
    });
    screenshots.push(dataUrl);

    capturedHeight += viewportHeight;
  }

  // 3. Stitch the images together using a canvas
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = viewportWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext("2d");

    let y = 0;
    const stitchImage = (index) => {
      if (index >= screenshots.length) {
        // When all images are drawn, export the canvas
        resolve(canvas.toDataURL("image/jpeg", 0.9));
        return;
      }
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, y);
        y += img.height;
        stitchImage(index + 1);
      };
      img.src = screenshots[index];
    };
    stitchImage(0);
  });
}

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
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    let screenshotDataUrl;

    try {
      if (type === "webpage") {
        // Use our new full-page capture method
        screenshotDataUrl = await captureFullPage(tab.id);
      } else {
        // Fallback to the visible tab for other types
        screenshotDataUrl = await chrome.tabs.captureVisibleTab(null, {
          format: "jpeg",
          quality: 85,
        });
      }

      const screenshotId = Date.now().toString();

      // Send the screenshot to the local server in the main app
      await fetch("http://localhost:28080/capture-screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          screenshotId: screenshotId,
          data: screenshotDataUrl,
        }),
      });

      // Trigger the capture in the main app, referencing the screenshotId
      const menhirUrl = `menhir://capture?type=${type}&title=${encodeURIComponent(
        data.title
      )}&source=${encodeURIComponent(
        data.source
      )}&screenshotId=${screenshotId}`;

      if (data.price) menhirUrl += `&price=${encodeURIComponent(data.price)}`;
      if (data.currency)
        menhirUrl += `&currency=${encodeURIComponent(data.currency)}`;
      if (data.vendor)
        menhirUrl += `&vendor=${encodeURIComponent(data.vendor)}`;

      window.open(menhirUrl);
      window.close();
    } catch (e) {
      console.error("Failed to send screenshot to Menhir app.", e);
      titleEl.textContent = "Error: Is the Menhir app running?";
      return;
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
