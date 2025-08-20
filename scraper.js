// This function will be injected into the active webpage
function analyzePage() {
  let type = "webpage"; // Start with a default type
  let data = {};

  // --- Product Detection ---
  // Look for clues like a price, an "add to cart" button, or schema.org metadata
  const priceElement = document.querySelector(
    '[itemprop="price"], .price, #price, [class*="price"]'
  );
  const addToCartButton = document.querySelector(
    '[id*="add-to-cart"], [class*="add-to-cart"], [class*="addtocart"]'
  );
  if (priceElement || addToCartButton) {
    type = "product";
    if (priceElement) {
      data.price = priceElement.innerText
        .trim()
        .match(/[\$€£]?\s*(\d+[,.]?\d*)/)[1];
    }
  }

  // --- Image Page Detection ---
  // A simple check: is the page URL an image, or is the page mostly just a single image?
  if (
    window.location.href.match(/\.(jpeg|jpg|gif|png|webp)$/i) ||
    (document.images.length === 1 && document.body.childElementCount <= 2)
  ) {
    type = "image";
  }

  // --- General Data Extraction (for all types) ---
  // Use Open Graph tags for the best data, with fallbacks to the standard title
  data.title =
    document.querySelector('meta[property="og:title"]')?.content ||
    document.title;
  data.image =
    document.querySelector('meta[property="og:image"]')?.content || "";
  data.source = window.location.href;

  // Return the final analysis object
  return { type, data };
}

// When the script is executed, it sends the analysis back to the extension's popup
chrome.runtime.sendMessage({ payload: analyzePage() });
