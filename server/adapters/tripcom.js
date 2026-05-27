function buildPushRequest(product) {
  return {
    method: 'POST',
    url: 'https://supply.trip.com/restapi/soa2/18437/createProduct',
    headers: { 'Content-Type': 'application/json' },
    body: {
      productName:        product.title,
      productDescription: product.description,
      salePrice:          product.base_price,
      currency:           product.currency,
    },
  };
}

function parseResponse(response) {
  return {
    external_id: response?.data?.productId ?? response?.productId ?? null,
    raw: response,
  };
}

module.exports = { buildPushRequest, parseResponse };
