// This function will be injected into the active webpage
function analyzePage() {
  let type = "webpage";
  let data = {};
  let productFound = false;

  // --- HELPER FUNCTIONS ---
  // Cleans image URLs by removing query parameters
  function cleanImageUrl(url) {
    if (!url) return "";
    return url.split("?")[0];
  }

  // Gets content from a meta tag by property or name
  function getMeta(selector) {
    return document.querySelector(
      `meta[property="${selector}"], meta[name="${selector}"]`
    )?.content;
  }

  // --- STRATEGY 1: Look for JSON-LD Structured Data (Most Reliable) ---
  const jsonLdScripts = document.querySelectorAll(
    'script[type="application/ld+json"]'
  );
  for (const script of jsonLdScripts) {
    try {
      const jsonData = JSON.parse(script.textContent);
      const graph = Array.isArray(jsonData["@graph"])
        ? jsonData["@graph"]
        : [jsonData];
      const productNode = graph.find(
        (node) => node && node["@type"] === "Product"
      );

      if (productNode) {
        type = "product";
        data.title = productNode.name;
        data.image = cleanImageUrl(productNode.image?.url || productNode.image);
        if (productNode.brand) data.vendor = productNode.brand.name;
        if (productNode.offers) {
          const offer = Array.isArray(productNode.offers)
            ? productNode.offers[0]
            : productNode.offers;
          data.price = offer.price;
          data.currency = offer.priceCurrency;
        }
        productFound = true;
        break;
      }
    } catch (e) {
      /* Ignore parsing errors */
    }
  }

  // --- STRATEGY 2: Fallback to Open Graph Meta Tags ---
  if (!productFound) {
    const ogType = getMeta("og:type");
    const productPriceAmount = getMeta("product:price:amount");
    if (ogType === "product" && productPriceAmount) {
      type = "product";
      data.title = getMeta("og:title");
      data.price = productPriceAmount;
      data.currency = getMeta("product:price:currency");
      data.image = cleanImageUrl(getMeta("og:image"));
      data.vendor = getMeta("og:site_name");
      productFound = true;
    }
  }

  // --- STRATEGY 3: Fallback to DOM Scraping ---
  if (!productFound) {
    const priceElement = document.querySelector(
      '[data-test-id*="Price"], [itemprop="price"], .price, #price, [class*="price"]'
    );
    if (priceElement) {
      type = "product";
      const priceText = priceElement.innerText.trim();
      const currencyMatch = priceText.match(/[$€£]/);
      data.currency = currencyMatch ? currencyMatch[0] : null;
      const amountMatch = priceText.match(/[\d,.]+/);
      if (amountMatch) data.price = amountMatch[0].replace(/,/g, "");
    }
  }

  // --- Image Page Detection ---
  if (
    window.location.href.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i) ||
    (document.images.length === 1 && document.body.childElementCount <= 2)
  ) {
    type = "image";
  }

  // --- Final Data Cleanup and Image Fallback ---
  if (!data.title) data.title = getMeta("og:title") || document.title;
  if (!data.image) {
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
    if (largestImage) data.image = cleanImageUrl(largestImage.src);
  }
  data.source = window.location.href;

  return { type, data };
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyzePage") {
    sendResponse(analyzePage());
  }
});
