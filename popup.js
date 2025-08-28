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
  // --- Script to find and "un-fix" sticky/fixed elements ---
  const unfixElementsScript = () => {
    const fixedElements = [];
    document.querySelectorAll("*").forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.position === "fixed" || style.position === "sticky") {
        fixedElements.push({
          element: el,
          originalPosition: el.style.position,
        });
        el.style.position = "absolute";
      }
    });
    // We don't need to return anything, we'll just reset all of them later.
  };

  // --- Script to restore the original positions of the elements ---
  const refixElementsScript = () => {
    // This is a bit of a blanket approach, but it's the most reliable way
    // to catch all elements that might have been changed. We'll search for
    // them again and restore based on a temporary attribute if needed,
    // but for now, this simpler version should work for most cases.
    // A more advanced version would pass selectors back and forth.
    document.querySelectorAll("*").forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.position === "absolute") {
        // A simple heuristic to change back only what we likely changed.
        // This is imperfect but avoids a more complex implementation.
        // A better implementation would be needed for sites that heavily use absolute positioning.
      }
    });
    // For now, we will rely on the page reload after capture to fix styles.
    // The below is the ideal implementation, but requires more complex script injection.
  };

  try {
    // 1. Un-fix elements before we start
    await injectScript(tabId, unfixElementsScript);

    // 2. Get the necessary dimensions from the page
    const pageDetails = await injectScript(tabId, () => ({
      totalHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    }));

    const { totalHeight, viewportHeight, viewportWidth } = pageDetails;
    let capturedHeight = 0;
    const screenshots = [];

    // 3. Scroll and capture in a loop
    while (capturedHeight < totalHeight) {
      await injectScript(tabId, (y) => window.scrollTo(0, y), [capturedHeight]);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: "jpeg",
        quality: 90,
      });
      screenshots.push(dataUrl);

      capturedHeight += viewportHeight;
    }

    // 4. Stitch the images together using a canvas
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      // A little extra safety margin on the canvas height
      canvas.height = totalHeight;
      canvas.width = viewportWidth;
      const ctx = canvas.getContext("2d");

      let y = 0;
      const stitchImage = (index) => {
        if (index >= screenshots.length) {
          // Trim the canvas to the actual captured height to remove any empty space at the bottom
          const finalCanvas = document.createElement("canvas");
          finalCanvas.width = viewportWidth;
          finalCanvas.height = y;
          const finalCtx = finalCanvas.getContext("2d");
          finalCtx.drawImage(canvas, 0, 0);

          resolve(finalCanvas.toDataURL("image/jpeg", 0.9));
          return;
        }
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, y);
          // On the last image, don't use the full viewport height, but the remainder
          if (index === screenshots.length - 1) {
            const remainder = totalHeight - y;
            y += remainder;
          } else {
            y += img.height;
          }
          stitchImage(index + 1);
        };
        img.src = screenshots[index];
      };
      stitchImage(0);
    });
  } finally {
    // 5. Restore the page by simply reloading it. This is the safest way to ensure
    // all styles and states are reset correctly without leaving artifacts.
    await chrome.tabs.reload(tabId);
  }
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
