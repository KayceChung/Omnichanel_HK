// SeatOS is the operator-facing management portal for 12Go products.
// All 12Go inventory reads/writes for this operator go through the SeatOS API.

const BASE = 'https://hkbuslineandopentour.seatos.com';

function buildFetchTripsRequest(startDate, endDate, page = 1, perPage = 100) {
  return {
    method: 'GET',
    url: `${BASE}/v3/trips?start_date=${startDate}&end_date=${endDate}&page=${page}&per_page=${perPage}`,
    headers: { Accept: 'application/json' },
  };
}

// Map a SeatOS trip object to OmniChannel's product shape
function tripToProduct(trip) {
  return {
    title: trip.route_name,
    description: trip.class_name,
    base_price: null,
    currency: 'VND',
    status: trip.status === 'active' ? 'active' : 'inactive',
    meta: {
      seatos_trip_id:  trip.id,
      departure:       trip.departureDatetime,
      class_id:        trip.class_id,
      class_code:      trip.class_code,
      route_id:        trip.route_id,
      original_seats:  trip.original_seats,
      total_quota:     trip.occupancy?.totalQuota,
      booked:          trip.occupancy?.existedQuota,
      stops:           trip.stops,
    },
  };
}

module.exports = { buildFetchTripsRequest, tripToProduct };
