// Builds the request descriptor the extension executes against Klook's supplier API.
// The extension injects live session cookies/headers; we only define the shape here.

function buildPushRequest(product) {
  return {
    method: 'POST',
    url: 'https://supply.klook.com/api/v1/activities',
    headers: { 'Content-Type': 'application/json' },
    body: {
      title:       product.title,
      description: product.description,
      base_price:  product.base_price,
      currency:    product.currency,
    },
  };
}

function parseResponse(response) {
  return {
    external_id: response?.data?.activity_id ?? response?.activity_id ?? null,
    raw: response,
  };
}

module.exports = { buildPushRequest, parseResponse };
