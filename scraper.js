// This function will be injected into the active webpage
function analyzePage() {
  let type = "webpage"; // Start with a default type
  let data = {};

  // --- Helper function to find the best possible image ---
  function findBestImage() {
    // Helper to check if a string is a valid-looking URL
    const isValidUrl = (str) =>
      str && (str.startsWith("http") || str.startsWith("/"));

    // 1. Check for Open Graph image first
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && isValidUrl(ogImage.content)) {
      return ogImage.content;
    }

    // 2. Fallback for Twitter Card image
    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    if (twitterImage && isValidUrl(twitterImage.content)) {
      return twitterImage.content;
    }

    // 3. Fallback for e-commerce sites using Schema.org metadata
    const schemaImage = document.querySelector('[itemprop="image"]');
    if (schemaImage && isValidUrl(schemaImage.src)) {
      return schemaImage.src;
    }

    // 4. Last resort: find the largest, most prominent image on the page
    let largestImage = null;
    let maxArea = 0;
    const images = document.querySelectorAll(
      'main img, article img, [class*="product"] img'
    );

    for (const img of images) {
      if (img.naturalWidth > 200 && img.naturalHeight > 200) {
        const area = img.naturalWidth * img.naturalHeight;
        if (area > maxArea) {
          maxArea = area;
          largestImage = img;
        }
      }
    }
    if (largestImage && isValidUrl(largestImage.src)) {
      return largestImage.src;
    }

    return ""; // No suitable image found
  }

  // --- Product Detection ---
  const priceElement = document.querySelector(
    '[itemprop="price"], .price, #price, [class*="price"]'
  );
  const addToCartButton = document.querySelector(
    '[id*="add-to-cart"], [class*="add-to-cart"], [class*="addtocart"]'
  );
  if (priceElement || addToCartButton) {
    type = "product";
    if (priceElement) {
      const priceMatch = priceElement.innerText
        .trim()
        .match(/[\$€£]?\s*(\d+[,.]?\d*)/);
      if (priceMatch) data.price = priceMatch[1];
    }
  }

  // --- Image Page Detection ---
  if (
    window.location.href.match(/\.(jpeg|jpg|gif|png|webp)$/i) ||
    (document.images.length === 1 && document.body.childElementCount <= 2)
  ) {
    type = "image";
  }

  // --- General Data Extraction ---
  data.title =
    document.querySelector('meta[property="og:title"]')?.content ||
    document.title;
  data.source = window.location.href;
  data.image = findBestImage(); // Use our new, smarter function

  // Return the final analysis object
  return { type, data };
}

// When the script is executed, it sends the analysis back to the extension's popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyzePage") {
    sendResponse(analyzePage());
  }
});
