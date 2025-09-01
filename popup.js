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
    await injectScript(tabId, () => {
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    // We still need a very brief pause for the browser to repaint.
    await new Promise((resolve) => setTimeout(resolve, 150));

    await chrome.scripting.insertCSS({
      target: { tabId },
      css: hideScrollbarCSS,
    });
    await injectScript(tabId, unfixElementsScript);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Get all necessary page dimensions, now including the pixel ratio
    const pageDetails = await injectScript(tabId, () => ({
      totalHeight: document.body.scrollHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      dpr: window.devicePixelRatio || 1, // <-- The resolution fix starts here
    }));

    const { totalHeight, viewportHeight, viewportWidth, dpr } = pageDetails;
    let capturedHeight = 0;
    const screenshots = [];
    let isDone = false;

    // This is your trusted capture loop, unchanged
    while (!isDone) {
      let nextScrollY = capturedHeight + viewportHeight;
      if (nextScrollY >= totalHeight) {
        nextScrollY = totalHeight - viewportHeight;
        isDone = true;
      }
      await injectScript(tabId, (y) => window.scrollTo(0, y), [capturedHeight]);
      await new Promise((resolve) => setTimeout(resolve, 400)); // Adjusted delay
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: "jpeg",
        quality: 90,
      });
      screenshots.push({ dataUrl, y: capturedHeight });
      capturedHeight = nextScrollY;
      if (isDone) {
        await injectScript(tabId, (y) => window.scrollTo(0, y), [totalHeight]);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const finalDataUrl = await chrome.tabs.captureVisibleTab(null, {
          format: "jpeg",
          quality: 90,
        });
        screenshots.push({
          dataUrl: finalDataUrl,
          y: totalHeight - viewportHeight,
          isFinal: true,
        });
      }
    }

    // Stitch the images together with resolution scaling
    return new Promise((resolve) => {
      const canvas = document.createElement("canvas");
      // Scale the canvas to the physical pixel size
      canvas.width = viewportWidth * dpr;
      canvas.height = totalHeight * dpr;
      const ctx = canvas.getContext("2d");

      let drawnCount = 0;
      screenshots.forEach(({ dataUrl, y, isFinal }) => {
        const img = new Image();
        img.onload = () => {
          let cropSourceY = 0;
          let cropHeight = img.height;
          let destY = y * dpr; // Scale destination Y-coordinate
          let destHeight = img.height;

          // Your trusted cropping logic for the final image
          if (isFinal) {
            const remainingCssPixels = totalHeight - y;
            cropSourceY =
              img.height - remainingCssPixels * (img.height / viewportHeight);
            cropHeight = img.height - cropSourceY;
            destHeight = remainingCssPixels * dpr; // Scale destination height
          }

          ctx.drawImage(
            img,
            0, // sourceX
            cropSourceY, // sourceY
            img.width, // sourceWidth
            cropHeight, // sourceHeight
            0, // destinationX
            destY, // destinationY (scaled)
            canvas.width, // destinationWidth
            destHeight // destinationHeight (scaled)
          );

          drawnCount++;
          if (drawnCount === screenshots.length) {
            resolve(canvas.toDataURL("image/jpeg", 0.3)); // Adjusted quality
          }
        };
        img.src = dataUrl;
      });
    });
  } finally {
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
