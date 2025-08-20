const titleEl = document.getElementById("title");
const typeEl = document.getElementById("type");
const captureBtn = document.getElementById("captureBtn");

// This function runs the scraper and updates the popup
async function analyze() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Inject the scraper.js file into the current page
  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["scraper.js"],
  });
}

// Listen for the message from our scraper.js script
chrome.runtime.onMessage.addListener((message) => {
  const { type, data } = message.payload;

  // Update the popup's UI with the detected information
  titleEl.textContent = data.title;
  typeEl.textContent = type.charAt(0).toUpperCase() + type.slice(1); // Capitalize type
  captureBtn.disabled = false;

  // Set up the capture button to send the detailed data
  captureBtn.onclick = () => {
    let menhirUrl = `menhir://capture?type=${type}&title=${encodeURIComponent(
      data.title
    )}&source=${encodeURIComponent(data.source)}`;

    if (data.price) {
      menhirUrl += `&price=${encodeURIComponent(data.price)}`;
    }
    // For webpages and products, we also send a potential cover image URL
    if (type !== "image" && data.image) {
      menhirUrl += `&image=${encodeURIComponent(data.image)}`;
    }

    window.open(menhirUrl);
    window.close();
  };
});

// Run the analysis as soon as the popup opens
analyze();
