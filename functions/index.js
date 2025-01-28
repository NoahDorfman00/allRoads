/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const axios = require("axios");
const functions = require("firebase-functions");
const { defineSecret } = require('firebase-functions/params');

// Initialize Firebase Admin
admin.initializeApp();

// Define the secret parameter
const googleMapsApiKey = defineSecret('GOOGLE_MAPS_API_KEY');

// Helper function to handle errors
const handleError = (error, response) => {
    logger.error(error);
    response.status(500).json({
        status: "error",
        message: "An internal error occurred",
        error: error.message
    });
};

// Helper function to format successful responses
const sendSuccess = (response, data) => {
    response.status(200).json({
        status: "success",
        data: data
    });
};

// Helper function to set CORS headers
const setCorsHeaders = (response) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');
};

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });

// GET: Basic health check endpoint
exports.healthCheck = onRequest(
    {
        region: 'us-central1',
        memory: '256MiB',
        cors: true
    },
    (request, response) => {
        try {
            logger.info("Health check endpoint called");
            sendSuccess(response, { message: "API is running" });
        } catch (error) {
            handleError(error, response);
        }
    }
);

// GET: Fetch data example
exports.getData = onRequest((request, response) => {
    try {
        // CORS headers
        response.set('Access-Control-Allow-Origin', '*');

        if (request.method !== 'GET') {
            response.status(405).send('Method Not Allowed');
            return;
        }

        // Example data - replace with your actual data fetching logic
        const data = {
            items: [
                { id: 1, name: "Item 1" },
                { id: 2, name: "Item 2" }
            ]
        };

        sendSuccess(response, data);
    } catch (error) {
        handleError(error, response);
    }
});

// POST: Process data example
exports.processData = onRequest((request, response) => {
    try {
        // CORS headers
        response.set('Access-Control-Allow-Origin', '*');

        // Handle preflight requests
        if (request.method === 'OPTIONS') {
            response.set('Access-Control-Allow-Methods', 'POST');
            response.set('Access-Control-Allow-Headers', 'Content-Type');
            response.status(204).send('');
            return;
        }

        if (request.method !== 'POST') {
            response.status(405).send('Method Not Allowed');
            return;
        }

        const data = request.body;

        // Validate input
        if (!data || !data.message) {
            response.status(400).json({
                status: "error",
                message: "Missing required field: message"
            });
            return;
        }

        // Process the data - replace with your actual processing logic
        const processedData = {
            originalMessage: data.message,
            processed: true,
            timestamp: new Date().toISOString()
        };

        sendSuccess(response, processedData);
    } catch (error) {
        handleError(error, response);
    }
});

// POST: Geocode an address
exports.geocodeAddress = onRequest(
    {
        region: 'us-central1',
        memory: '256MiB',
        cors: true,
        secrets: [googleMapsApiKey]
    },
    async (request, response) => {
        try {
            logger.info('Geocode address request received:', request.body);

            if (request.method === 'OPTIONS') {
                response.status(204).send('');
                return;
            }

            if (request.method !== 'POST') {
                response.status(405).send('Method Not Allowed');
                return;
            }

            const { address } = request.body;
            if (!address) {
                response.status(400).json({
                    status: "error",
                    message: "Address is required"
                });
                return;
            }

            const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleMapsApiKey.value()}`;
            logger.info('Making request to Google Maps API');

            const result = await axios.get(geocodeUrl);

            logger.info('Google Maps API response status:', result.data.status);

            if (result.data.status === 'OK' && result.data.results[0]) {
                sendSuccess(response, result.data.results[0]);
            } else {
                logger.error('Geocoding failed:', {
                    status: result.data.status,
                    errorMessage: result.data.error_message
                });
                response.status(404).json({
                    status: "error",
                    message: "Address not found",
                    details: {
                        status: result.data.status,
                        error_message: result.data.error_message
                    }
                });
            }
        } catch (error) {
            logger.error('Error in geocodeAddress:', {
                message: error.message,
                stack: error.stack
            });
            if (error.response) {
                logger.error('Google Maps API error response:', {
                    status: error.response.status,
                    data: error.response.data
                });
            }
            handleError(error, response);
        }
    }
);

// POST: Find nearby venues
exports.findNearbyVenues = onRequest(
    {
        region: 'us-central1',
        memory: '256MiB',
        cors: true,
        secrets: [googleMapsApiKey]
    },
    async (request, response) => {
        try {
            if (request.method === 'OPTIONS') {
                response.status(204).send('');
                return;
            }

            if (request.method !== 'POST') {
                response.status(405).send('Method Not Allowed');
                return;
            }

            const { center, type, subtype, radius } = request.body;

            if (!center || !type) {
                response.status(400).json({
                    status: "error",
                    message: "Center location and venue type are required"
                });
                return;
            }

            let keyword = subtype || '';
            const searchRadius = radius || 5000;

            const result = await axios.get(
                `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${center.lat},${center.lng}&radius=${searchRadius}&type=${type}&keyword=${keyword}&key=${googleMapsApiKey.value()}`
            );

            sendSuccess(response, result.data.results);
        } catch (error) {
            handleError(error, response);
        }
    }
);

// POST: Get place details
exports.getPlaceDetails = onRequest(
    {
        region: 'us-central1',
        memory: '256MiB',
        cors: true,
        secrets: [googleMapsApiKey]
    },
    async (request, response) => {
        try {
            if (request.method === 'OPTIONS') {
                response.status(204).send('');
                return;
            }

            if (request.method !== 'POST') {
                response.status(405).send('Method Not Allowed');
                return;
            }

            const { placeId } = request.body;

            if (!placeId) {
                response.status(400).json({
                    status: "error",
                    message: "Place ID is required"
                });
                return;
            }

            const result = await axios.get(
                `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_address,geometry,rating,opening_hours,photos,website,formatted_phone_number&key=${googleMapsApiKey.value()}`
            );

            sendSuccess(response, result.data.result);
        } catch (error) {
            handleError(error, response);
        }
    }
);

// POST: Calculate travel times
exports.calculateTravelTimes = onRequest(
    {
        region: 'us-central1',
        memory: '256MiB',
        cors: true,
        secrets: [googleMapsApiKey]
    },
    async (request, response) => {
        try {
            if (request.method === 'OPTIONS') {
                response.status(204).send('');
                return;
            }

            if (request.method !== 'POST') {
                response.status(405).send('Method Not Allowed');
                return;
            }

            const { origins, destination } = request.body;

            if (!origins || !destination || !Array.isArray(origins)) {
                response.status(400).json({
                    status: "error",
                    message: "Origins array and destination are required"
                });
                return;
            }

            const originsString = origins
                .map(loc => `${loc.lat},${loc.lng}`)
                .join('|');

            const result = await axios.get(
                `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originsString}&destinations=${destination.lat},${destination.lng}&mode=driving&key=${googleMapsApiKey.value()}`
            );

            sendSuccess(response, result.data);
        } catch (error) {
            handleError(error, response);
        }
    }
);

// POST: Find optimal venue
exports.findOptimalVenue = onRequest(
    {
        region: 'us-central1',
        memory: '256MiB',
        cors: true,
        secrets: [googleMapsApiKey]
    },
    async (request, response) => {
        try {
            if (request.method === 'OPTIONS') {
                response.status(204).send('');
                return;
            }

            if (request.method !== 'POST') {
                response.status(405).send('Method Not Allowed');
                return;
            }

            const { locations, venues } = request.body;

            if (!locations || !venues || !Array.isArray(locations) || !Array.isArray(venues)) {
                response.status(400).json({
                    status: "error",
                    message: "Locations and venues arrays are required"
                });
                return;
            }

            // Calculate travel times for each venue
            const venuesWithTravelTimes = await Promise.all(
                venues.map(async (venue) => {
                    const originsString = locations
                        .map(loc => `${loc.lat},${loc.lng}`)
                        .join('|');

                    const result = await axios.get(
                        `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originsString}&destinations=${venue.geometry.location.lat},${venue.geometry.location.lng}&mode=driving&key=${googleMapsApiKey.value()}`
                    );

                    const travelTimes = result.data.rows.map(row => row.elements[0].duration.value);
                    const maxTravelTime = Math.max(...travelTimes);
                    const avgTravelTime = travelTimes.reduce((a, b) => a + b, 0) / travelTimes.length;

                    return {
                        ...venue,
                        maxTravelTime,
                        avgTravelTime,
                        travelTimes
                    };
                })
            );

            // Find the optimal venue (lowest maximum travel time)
            const optimalVenue = venuesWithTravelTimes.reduce((best, current) => {
                if (!best || current.maxTravelTime < best.maxTravelTime) {
                    return current;
                }
                return best;
            });

            sendSuccess(response, {
                optimal: optimalVenue,
                allVenues: venuesWithTravelTimes
            });
        } catch (error) {
            handleError(error, response);
        }
    }
);
