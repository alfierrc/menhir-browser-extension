const titleEl = document.getElementById("title");
const typeEl = document.getElementById("type");
const captureBtn = document.getElementById("captureBtn");

// Helper script to inject functions into the page
async function injectScript(tabId, func, args = []) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return result[0].result;
}

// The robust, scroll-and-stitch screenshot function
async function captureFullPage(tabId) {
  const unfixElementsScript = () => {
    document.querySelectorAll("*").forEach((el) => {
      const style = window.getComputedStyle(el);
      if (style.position === "fixed" || style.position === "sticky") {
        el.style.position = "absolute";
      }
    });
  };
  const hideScrollbarCSS =
    "body::-webkit-scrollbar { display: none !important; }";

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      css: hideScrollbarCSS,
    });
    await injectScript(tabId, unfixElementsScript);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get page dimensions, now including the device pixel ratio
    const pageDetails = await injectScript(tabId, () => ({
      totalHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      dpr: window.devicePixelRatio || 1,
    }));

    const { totalHeight, viewportHeight, viewportWidth, dpr } = pageDetails;
    let screenshots = [];
    let capturedHeight = 0;

    // The scroll-and-capture loop
    while (capturedHeight < totalHeight) {
      await injectScript(tabId, (y) => window.scrollTo(0, y), [capturedHeight]);
      await new Promise((resolve) => setTimeout(resolve, 400));

      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: "jpeg",
        quality: 90,
      });
      screenshots.push({ dataUrl, y: capturedHeight });

      capturedHeight += viewportHeight;
    }

    // Stitch the images together, now aware of the pixel ratio
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      // Scale the canvas to match the physical pixel dimensions
      canvas.width = viewportWidth * dpr;
      canvas.height = totalHeight * dpr;
      const ctx = canvas.getContext("2d");

      let loadedImages = 0;
      screenshots.forEach(({ dataUrl, y }) => {
        const img = new Image();
        img.onload = () => {
          // Draw the image at the correct physical pixel position
          ctx.drawImage(img, 0, y * dpr);
          loadedImages++;
          if (loadedImages === screenshots.length) {
            // If the final stitched image is taller than the canvas,
            // we create a new canvas of the correct size to trim the excess.
            const finalCanvas = document.createElement("canvas");
            finalCanvas.width = canvas.width;
            finalCanvas.height = totalHeight * dpr;
            const finalCtx = finalCanvas.getContext("2d");
            finalCtx.drawImage(canvas, 0, 0);
            resolve(finalCanvas.toDataURL("image/jpeg", 0.3));
          }
        };
        img.src = dataUrl;
      });
    });
  } finally {
    // Restore the page by reloading it
    await chrome.tabs.reload(tabId);
  }
}

// This single function now correctly handles all capture types
function setupCaptureButton(type, data) {
  titleEl.textContent = data.title;
  typeEl.textContent = type.charAt(0).toUpperCase() + type.slice(1);
  captureBtn.disabled = false;

  captureBtn.onclick = async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    // For products and webpages, we take a screenshot
    if (type === "webpage") {
      try {
        titleEl.textContent = `Capturing ${type}...`;
        captureBtn.disabled = true;

        const screenshotDataUrl =
          type === "webpage"
            ? await captureFullPage(tab.id)
            : await chrome.tabs.captureVisibleTab(null, {
                format: "jpeg",
                quality: 85,
              });

        const screenshotId = Date.now().toString();

        await fetch("http://localhost:28080/capture-screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ screenshotId, data: screenshotDataUrl }),
        });

        let menhirUrl = `menhir://capture?type=${type}&title=${encodeURIComponent(
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
        captureBtn.disabled = false;
      }
    } else {
      // For direct images, we just pass the URL
      let menhirUrl = `menhir://capture?type=${type}&title=${encodeURIComponent(
        data.title
      )}&source=${encodeURIComponent(data.source)}&image=${encodeURIComponent(
        data.image
      )}`;

      window.open(menhirUrl);
      window.close();
    }
  };
}

// The main initialization function, now much simpler
async function initialize() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab.url;

  // Handle direct image URLs (this part is unchanged)
  if (url.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i)) {
    const cleanUrl = url.split("?")[0];
    const filename = cleanUrl.substring(cleanUrl.lastIndexOf("/") + 1);
    setupCaptureButton("image", {
      title: filename,
      source: url,
      image: cleanUrl,
    });
    return;
  }

  // --- This is the corrected logic for HTML pages ---
  try {
    // 1. Ensure the scraper script is injected and ready.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["scraper.js"],
    });

    // 2. Send a message to the script, asking it to perform the analysis.
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: "analyzePage",
    });

    // 3. Use the response to set up the capture button.
    if (response) {
      setupCaptureButton(response.type, response.data);
    } else {
      throw new Error("No response from scraper script.");
    }
  } catch (e) {
    console.error("Error communicating with scraper script:", e);
    titleEl.textContent = "Page could not be analyzed.";
    // This can happen on special pages like the Chrome Web Store, etc.
  }
}

initialize();
