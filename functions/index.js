const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const axios = require("axios");
const { defineSecret } = require('firebase-functions/params');

const googleMapsApiKey = defineSecret('GOOGLE_MAPS_API_KEY');

const handleError = (error, response) => {
    logger.error(error);
    response.status(500).json({
        status: "error",
        message: "An internal error occurred",
        error: error.message
    });
};

const sendSuccess = (response, data) => {
    response.status(200).json({
        status: "success",
        data: data
    });
};

// ---------------------------------------------------------------------------
// Single endpoint used by the frontend. One service means at most one cold
// start (the page pings it on load to warm it up).
//
//   GET                                          -> warm-up ping
//   POST { action: 'search', locations, query, mode }
//   POST { action: 'details', placeId }
//   POST { action: 'geocode', address }
// ---------------------------------------------------------------------------

const meet = require('./meet');

const mapsGet = async (path, params) => {
    const { data } = await axios.get(`https://maps.googleapis.com/maps/api/${path}/json`, {
        params: { ...params, key: googleMapsApiKey.value() },
        timeout: 10000
    });
    return data;
};

const badRequest = (response, message) =>
    response.status(400).json({ status: "error", message });

exports.api = onRequest(
    {
        region: 'us-central1',
        memory: '256MiB',
        cors: true,
        secrets: [googleMapsApiKey]
    },
    async (request, response) => {
        if (request.method === 'GET') {
            sendSuccess(response, { ok: true });
            return;
        }
        if (request.method !== 'POST') {
            response.status(405).send('Method Not Allowed');
            return;
        }

        const body = request.body || {};
        try {
            if (body.action === 'search') {
                const params = {
                    locations: body.locations,
                    query: String(body.query || '').trim().slice(0, 100) || 'restaurant',
                    mode: body.mode || 'driving'
                };
                const invalid = meet.validateSearch(params);
                if (invalid) return badRequest(response, invalid);
                sendSuccess(response, await meet.searchMeetingPlaces(mapsGet, params));
            } else if (body.action === 'details') {
                if (!body.placeId) return badRequest(response, 'placeId is required');
                const data = await mapsGet('place/details', {
                    place_id: body.placeId,
                    fields: 'name,formatted_address,website,formatted_phone_number,opening_hours,url'
                });
                if (data.status !== 'OK') throw new Error(`Place details failed: ${data.status}`);
                sendSuccess(response, data.result);
            } else if (body.action === 'geocode') {
                // Forward ({ address }) or reverse ({ latlng: "lat,lng" }) geocoding
                const address = String(body.address || '').trim();
                const latlng = String(body.latlng || '').trim();
                if (!address && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(latlng)) {
                    return badRequest(response, 'address or latlng is required');
                }
                const data = await mapsGet('geocode', address ? { address } : { latlng });
                if (data.status !== 'OK' || !data.results[0]) {
                    response.status(404).json({ status: "error", message: "Address not found" });
                    return;
                }
                const result = data.results[0];
                sendSuccess(response, {
                    address: result.formatted_address,
                    lat: result.geometry.location.lat,
                    lng: result.geometry.location.lng
                });
            } else {
                badRequest(response, 'Unknown action');
            }
        } catch (error) {
            handleError(error, response);
        }
    }
);
