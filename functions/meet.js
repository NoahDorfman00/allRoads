// Meeting-place search: find places matching a free-text query around the
// middle of everyone's locations, then rank them by how fair the trip is.
// `mapsGet(path, params)` performs a Google Maps web-service call and returns its JSON.

const TRAVEL_MODES = ['driving', 'walking', 'bicycling', 'transit'];
const MAX_PEOPLE = 10;
const MAX_CANDIDATES = 20;
const MATRIX_ELEMENT_LIMIT = 100; // Distance Matrix per-request element cap
const MATRIX_DESTINATION_LIMIT = 25;

const toRad = (deg) => (deg * Math.PI) / 180;

// Great-circle distance in meters
const haversine = (a, b) => {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

const centroid = (points) => ({
    lat: points.reduce((sum, p) => sum + p.lat, 0) / points.length,
    lng: points.reduce((sum, p) => sum + p.lng, 0) / points.length
});

const normalize = (text) => (text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, '');

// When the query looks like a brand or a specific name ("starbucks", "trader joe's"),
// keep only places whose name matches, so a Starbucks search only shows Starbucks.
// Generic queries ("coffee", "tacos") rarely match most names, so they're left alone.
const filterByName = (places, query) => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (!words.length || !places.length) return places;
    const matches = places.filter((place) => {
        const name = normalize(place.name).replace(/\s+/g, '');
        return words.every((word) => name.includes(word));
    });
    return matches.length >= Math.min(3, places.length) || matches.length >= places.length / 2
        ? matches
        : places;
};

const chunk = (items, size) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
};

// Travel times in seconds as matrix[destinationIndex][originIndex] (null when unreachable).
// Batches destinations so each request stays within the Distance Matrix limits.
const travelTimeMatrix = async (mapsGet, origins, destinations, mode) => {
    const perRequest = Math.max(1, Math.min(
        MATRIX_DESTINATION_LIMIT,
        Math.floor(MATRIX_ELEMENT_LIMIT / origins.length)
    ));
    const originParam = origins.map((o) => `${o.lat},${o.lng}`).join('|');

    const responses = await Promise.all(chunk(destinations, perRequest).map((batch) =>
        mapsGet('distancematrix', {
            origins: originParam,
            destinations: batch.map((d) => `${d.lat},${d.lng}`).join('|'),
            mode
        })
    ));

    const matrix = [];
    responses.forEach((data, batchIndex) => {
        if (data.status !== 'OK') {
            throw new Error(`Distance Matrix failed: ${data.status} ${data.error_message || ''}`);
        }
        data.destination_addresses.forEach((_, d) => {
            matrix[batchIndex * perRequest + d] = data.rows.map((row) =>
                row.elements[d].status === 'OK' ? row.elements[d].duration.value : null
            );
        });
    });
    return matrix;
};

const searchMeetingPlaces = async (mapsGet, { locations, query, mode }) => {
    const people = locations.map((l) => ({ lat: Number(l.lat), lng: Number(l.lng) }));
    const center = centroid(people);
    const spread = Math.max(...people.map((p) => haversine(center, p)));
    // Search around the middle, scaled to how far apart everyone is
    const radius = Math.round(Math.min(50000, Math.max(1500, spread * 0.5)));

    const search = await mapsGet('place/textsearch', {
        query,
        location: `${center.lat},${center.lng}`,
        radius
    });
    if (search.status !== 'OK' && search.status !== 'ZERO_RESULTS') {
        throw new Error(`Text search failed: ${search.status} ${search.error_message || ''}`);
    }

    // Location is only a bias for text search, so drop anything far from the middle
    const nearby = (search.results || []).filter((place) =>
        place.business_status !== 'CLOSED_PERMANENTLY' &&
        haversine(center, place.geometry.location) <= radius * 2 + 2000
    );
    const candidates = filterByName(nearby, query).slice(0, MAX_CANDIDATES);
    if (!candidates.length) return { center, venues: [] };

    const matrix = await travelTimeMatrix(
        mapsGet,
        people,
        candidates.map((place) => place.geometry.location),
        mode
    );

    const venues = candidates
        .map((place, i) => {
            const times = matrix[i];
            if (!times || times.some((t) => t === null)) return null;
            return {
                placeId: place.place_id,
                name: place.name,
                address: place.formatted_address,
                location: place.geometry.location,
                rating: place.rating || null,
                ratingCount: place.user_ratings_total || 0,
                priceLevel: place.price_level ?? null,
                openNow: place.opening_hours?.open_now ?? null,
                times,
                maxTime: Math.max(...times),
                avgTime: times.reduce((a, b) => a + b, 0) / times.length
            };
        })
        .filter(Boolean)
        // Fairest first: shortest longest-trip (to the minute), then shortest average trip
        .sort((a, b) =>
            Math.round(a.maxTime / 60) - Math.round(b.maxTime / 60) || a.avgTime - b.avgTime
        );

    return { center, venues };
};

// Returns an error message, or null when the search request is valid
const validateSearch = ({ locations, mode }) => {
    const validLocations = Array.isArray(locations) &&
        locations.length >= 2 && locations.length <= MAX_PEOPLE &&
        locations.every((l) => Number.isFinite(Number(l?.lat)) && Number.isFinite(Number(l?.lng)));
    if (!validLocations) return `Provide 2-${MAX_PEOPLE} locations`;
    if (!TRAVEL_MODES.includes(mode)) return 'Invalid travel mode';
    return null;
};

module.exports = {
    filterByName,
    haversine,
    centroid,
    travelTimeMatrix,
    searchMeetingPlaces,
    validateSearch
};
