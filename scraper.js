function analyzePage() {
  let type = "webpage";
  let data = {};
  let productFoundByJson = false;

  function cleanImageUrl(url) {
    if (!url) return "";
    // Removes query parameters like ?v=... or &width=...
    return url.split("?")[0];
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
        data.title = productNode.name || data.title;
        const imageUrl = productNode.image?.url || productNode.image;
        data.image = cleanImageUrl(imageUrl); // Clean the URL

        if (productNode.brand) data.vendor = productNode.brand.name;

        if (productNode.offers) {
          const offer = Array.isArray(productNode.offers)
            ? productNode.offers[0]
            : productNode.offers;
          data.price = offer.price;
          data.currency = offer.priceCurrency;
        }
        productFoundByJson = true;
        break; // Stop after finding the first valid product
      }
    } catch (e) {
      /* Ignore JSON parsing errors */
    }
  }

  // --- STRATEGY 2: Fallback to DOM Scraping if JSON-LD fails ---
  if (!productFoundByJson) {
    const priceElement = document.querySelector(
      '[data-test-id*="Price"], [itemprop="price"], .price, #price, [class*="price"]'
    );
    const addToCartButton = document.querySelector(
      '[data-test-id*="AddToCart"], [id*="add-to-cart"], [class*="add-to-cart"]'
    );

    if (priceElement || addToCartButton) {
      type = "product";
      if (priceElement) {
        const priceText = priceElement.innerText.trim();
        const currencyMatch = priceText.match(/[$€£]/);
        data.currency = currencyMatch ? currencyMatch[0] : null;

        const amountMatch = priceText.match(/[\d,.]+/);
        if (amountMatch) {
          data.price = amountMatch[0].replace(/,/g, "");
        }
      }
      const titleElement = document.querySelector("h1");
      if (titleElement && titleElement.children.length > 1) {
        data.vendor = titleElement.children[0]?.innerText.trim();
      }
    }
  }

  // --- Image Page Detection (run this check regardless of product status) ---
  if (
    window.location.href.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i) ||
    (document.images.length === 1 && document.body.childElementCount <= 2)
  ) {
    type = "image";
  }

  // --- General Data Extraction & Final Image Fallback ---
  const findBestImage = () => {
    const isValidUrl = (str) =>
      str && (str.startsWith("http") || str.startsWith("/"));
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage && isValidUrl(ogImage.content)) return ogImage.content;
    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    if (twitterImage && isValidUrl(twitterImage.content))
      return twitterImage.content;
    const schemaImage = document.querySelector('[itemprop="image"]');
    if (schemaImage && isValidUrl(schemaImage.src)) return schemaImage.src;

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
    if (largestImage && isValidUrl(largestImage.src)) return largestImage.src;
    return "";
  };

  // Fill in any missing data
  if (!data.title)
    data.title =
      document.querySelector('meta[property="og:title"]')?.content ||
      document.title;
  if (!data.image) data.image = findBestImage();
  data.source = window.location.href;

  return { type, data };
}

// When the script is executed, it sends the analysis back to the extension's popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "analyzePage") {
    sendResponse(analyzePage());
  }
});
