function buildPushRequest(product) {
  return {
    method: 'POST',
    url: 'https://api.12go.asia/partner/v1/products',
    headers: { 'Content-Type': 'application/json' },
    body: {
      name:        product.title,
      description: product.description,
      price:       product.base_price,
      currency:    product.currency,
    },
  };
}

function parseResponse(response) {
  return {
    external_id: response?.product_id ?? response?.id ?? null,
    raw: response,
  };
}

module.exports = { buildPushRequest, parseResponse };
