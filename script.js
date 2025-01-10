// Initialize global variables
let map;
let markers = [];
let locations = [];
let optimalVenue = null;
const searchRadius = 5000; // 5km default
let allVenues = [];
let selectedVenue = null;

// Add venue subtype configurations
const venueSubtypes = {
    restaurant: {
        label: 'Cuisine Type',
        options: [
            { value: '', label: 'Any Cuisine' },
            { value: 'chinese', label: 'Chinese' },
            { value: 'italian', label: 'Italian' },
            { value: 'japanese', label: 'Japanese' },
            { value: 'mexican', label: 'Mexican' },
            { value: 'indian', label: 'Indian' },
            { value: 'thai', label: 'Thai' },
            { value: 'vietnamese', label: 'Vietnamese' },
            { value: 'mediterranean', label: 'Mediterranean' },
            { value: 'american', label: 'American' }
        ]
    },
    cafe: {
        label: 'Cafe Type',
        options: [
            { value: '', label: 'Any Cafe' },
            { value: 'coffee', label: 'Coffee Shop' },
            { value: 'tea', label: 'Tea House' },
            { value: 'bakery', label: 'Bakery Cafe' }
        ]
    },
    bar: {
        label: 'Bar Type',
        options: [
            { value: '', label: 'Any Bar' },
            { value: 'pub', label: 'Pub' },
            { value: 'wine_bar', label: 'Wine Bar' },
            { value: 'sports_bar', label: 'Sports Bar' },
            { value: 'cocktail', label: 'Cocktail Bar' }
        ]
    }
};

// Initialize the map
function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 37.7749, lng: -122.4194 }, // Default to San Francisco
        zoom: 12
    });
}

// Initialize when the page loads
window.onload = function () {
    initMap();
    // Initialize the autocomplete for the input field
    const input = document.getElementById('address-input');
    const autocomplete = new google.maps.places.Autocomplete(input);

    // Add event listener for venue type changes
    document.getElementById('venue-select').addEventListener('change', updateSubtypeSelector);

    // Initial call to set up subtype selector
    updateSubtypeSelector();
};

// Add a new location
async function addLocation() {
    const input = document.getElementById('address-input');
    const address = input.value.trim();

    if (!address) return;

    const geocoder = new google.maps.Geocoder();
    try {
        const result = await geocodeAddress(address);
        if (result) {
            const location = {
                id: Date.now().toString(),
                address: result.formatted_address,
                lat: result.geometry.location.lat(),
                lng: result.geometry.location.lng()
            };

            locations.push(location);
            addLocationToList(location);
            addMarkerToMap(location);
            updateMapBounds();
            updateFindButton();
            input.value = '';
        }
    } catch (error) {
        console.error('Geocoding error:', error);
        alert('Could not find this address. Please try again.');
    }
}

// Geocode an address
function geocodeAddress(address) {
    return new Promise((resolve, reject) => {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address }, (results, status) => {
            if (status === 'OK' && results[0]) {
                resolve(results[0]);
            } else {
                reject(status);
            }
        });
    });
}

// Add a location to the list in the UI
function addLocationToList(location) {
    const list = document.getElementById('locations-list');
    const li = document.createElement('li');
    li.innerHTML = `
        <span class="location-text">${location.address}</span>
        <button class="delete-btn" onclick="removeLocation('${location.id}')">Remove</button>
    `;
    list.appendChild(li);
}

// Add a marker to the map
function addMarkerToMap(location) {
    const marker = new google.maps.Marker({
        position: { lat: location.lat, lng: location.lng },
        map: map
    });
    markers.push(marker);
}

// Remove a location
function removeLocation(id) {
    const index = locations.findIndex(loc => loc.id === id);
    if (index !== -1) {
        locations.splice(index, 1);
        markers[index].setMap(null);
        markers.splice(index, 1);
        updateLocationsList();
        updateMapBounds();
        updateFindButton();
    }
}

// Update the locations list in the UI
function updateLocationsList() {
    const list = document.getElementById('locations-list');
    list.innerHTML = '';
    locations.forEach(location => addLocationToList(location));
}

// Update map bounds to show all markers
function updateMapBounds() {
    if (locations.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    locations.forEach(location => {
        bounds.extend({ lat: location.lat, lng: location.lng });
    });
    map.fitBounds(bounds);
}

// Enable/disable the find venue button based on number of locations
function updateFindButton() {
    const button = document.getElementById('find-venue-btn');
    button.disabled = locations.length < 2;
}

// Find the optimal venue
async function findOptimalVenue() {
    if (locations.length < 2) return;

    const venueType = document.getElementById('venue-select').value;
    const center = calculateCenter();

    try {
        const venues = await findNearbyVenues(center, venueType);
        const venuesWithTravelTimes = await calculateTravelTimes(venues);
        allVenues = venuesWithTravelTimes;
        const optimal = findOptimalLocation(venuesWithTravelTimes);

        if (optimal) {
            selectedVenue = optimal;
            displayOptimalVenue(optimal);
            displayNearbyVenues(venuesWithTravelTimes, optimal);
            addOptimalVenueMarker(optimal);
        } else {
            alert('No suitable venues found. Try increasing the search radius or changing the venue type.');
        }
    } catch (error) {
        console.error('Error finding optimal venue:', error);
        alert('An error occurred while finding the optimal venue. Please try again.');
    }
}

// Calculate the center point of all locations
function calculateCenter() {
    const bounds = new google.maps.LatLngBounds();
    locations.forEach(location => {
        bounds.extend({ lat: location.lat, lng: location.lng });
    });
    return bounds.getCenter();
}

// Find nearby venues using Places API
function findNearbyVenues(center, type) {
    return new Promise((resolve, reject) => {
        const service = new google.maps.places.PlacesService(map);
        const subtypeSelect = document.getElementById('subtype-select');
        const subtype = subtypeSelect ? subtypeSelect.value : '';

        const request = {
            location: center,
            radius: searchRadius,
            type: type,
            keyword: subtype // Add the subtype as a keyword to filter results
        };

        service.nearbySearch(request, async (results, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                // Filter out non-operational businesses
                const operationalPlaces = results.filter(place =>
                    place.business_status === 'OPERATIONAL' || !place.business_status
                );

                // Get detailed information for each operational place
                const detailedResults = await Promise.all(
                    operationalPlaces.slice(0, 20).map(async place => {
                        try {
                            const details = await getPlaceDetails(place.place_id);
                            return {
                                ...place,
                                rating: details.rating,
                                user_ratings_total: details.user_ratings_total,
                                price_level: details.price_level,
                                opening_hours: details.opening_hours,
                                website: details.website,
                                url: details.url,
                                business_status: details.business_status
                            };
                        } catch (error) {
                            console.error('Error fetching place details:', error);
                            return place;
                        }
                    })
                );
                resolve(detailedResults);
            } else {
                reject(status);
            }
        });
    });
}

// Add function to get place details
function getPlaceDetails(placeId) {
    return new Promise((resolve, reject) => {
        const service = new google.maps.places.PlacesService(map);
        service.getDetails(
            {
                placeId: placeId,
                fields: [
                    'rating',
                    'user_ratings_total',
                    'price_level',
                    'opening_hours',
                    'website',
                    'url',
                    'business_status'
                ]
            },
            (result, status) => {
                if (status === google.maps.places.PlacesServiceStatus.OK) {
                    resolve(result);
                } else {
                    reject(status);
                }
            }
        );
    });
}

// Calculate travel times for all venues
async function calculateTravelTimes(venues) {
    const service = new google.maps.DistanceMatrixService();
    const venuesWithTimes = [];

    for (const venue of venues) {
        if (!venue.geometry?.location) continue;

        try {
            const response = await new Promise((resolve, reject) => {
                service.getDistanceMatrix({
                    origins: locations.map(loc => ({ lat: loc.lat, lng: loc.lng })),
                    destinations: [venue.geometry.location],
                    travelMode: google.maps.TravelMode.DRIVING
                }, (response, status) => {
                    if (status === 'OK') resolve(response);
                    else reject(status);
                });
            });

            const travelTimes = response.rows.map((row, index) => ({
                locationId: locations[index].id,
                duration: row.elements[0].duration?.value || 0
            }));

            const totalTime = travelTimes.reduce((total, time) => total + time.duration, 0);

            venuesWithTimes.push({
                ...venue, // Include all venue details
                name: venue.name,
                address: venue.vicinity,
                lat: venue.geometry.location.lat(),
                lng: venue.geometry.location.lng(),
                rating: venue.rating,
                user_ratings_total: venue.user_ratings_total,
                price_level: venue.price_level,
                opening_hours: venue.opening_hours,
                website: venue.website,
                url: venue.url,
                travelTimes: travelTimes,
                totalTravelTime: totalTime
            });
        } catch (error) {
            console.error('Error calculating travel time:', error);
        }
    }

    return venuesWithTimes;
}

// Find the venue with the lowest total travel time
function findOptimalLocation(venues) {
    if (venues.length === 0) return null;
    return venues.reduce((prev, current) =>
        prev.totalTravelTime < current.totalTravelTime ? prev : current
    );
}

// Display the optimal venue in the UI
function displayOptimalVenue(venue) {
    const venueElement = document.getElementById('optimal-venue');
    const detailsElement = document.getElementById('venue-details');

    // Format price level and rating information
    const priceLevel = venue.price_level ? '$'.repeat(venue.price_level) : '';
    const rating = venue.rating ? `★ ${venue.rating.toFixed(1)}` : '';
    const ratingCount = venue.user_ratings_total ? `(${venue.user_ratings_total} reviews)` : '';

    // Basic venue information
    let html = `
        <div class="venue-header">
            <h3>${venue.name}</h3>
            <div class="venue-meta">
                ${priceLevel ? `<span class="venue-price">${priceLevel}</span>` : ''}
                ${rating ? `<span class="venue-rating">${rating} ${ratingCount}</span>` : ''}
            </div>
        </div>
        <p class="venue-address"><strong>Address:</strong> ${venue.address}</p>
        ${venue.opening_hours ? `
            <div class="venue-hours">
                <h4>Hours:</h4>
                <ul>
                    ${venue.opening_hours.weekday_text.map(day => `<li>${day}</li>`).join('')}
                </ul>
            </div>
        ` : ''}
        ${venue.website ? `
            <div class="venue-links">
                <a href="${venue.website}" target="_blank" class="website-link">Visit Website</a>
                <a href="${venue.url}" target="_blank" class="maps-link">View on Google Maps</a>
            </div>
        ` : ''}
        <h4 class="directions-header">Travel times and directions:</h4>
        <ul class="directions-list">
    `;

    // Add directions links and travel times for each starting location
    locations.forEach(location => {
        const travelTime = venue.travelTimes.find(t => t.locationId === location.id);
        const minutes = Math.round((travelTime?.duration || 0) / 60);
        const directionsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(location.address)}&destination=${encodeURIComponent(venue.address)}`;

        html += `
            <li>
                <div class="location-info">
                    <span class="location-address">${location.address}</span>
                    <span class="travel-time">${minutes} minutes</span>
                </div>
                <a href="${directionsUrl}" target="_blank" class="directions-link">Get Directions</a>
            </li>
        `;
    });

    html += '</ul>';
    detailsElement.innerHTML = html;
    venueElement.classList.remove('hidden');
}

// Add a marker for the optimal venue
function addOptimalVenueMarker(venue) {
    // Remove previous optimal venue marker if it exists
    if (optimalVenue) {
        optimalVenue.setMap(null);
    }

    optimalVenue = new google.maps.Marker({
        position: { lat: venue.lat, lng: venue.lng },
        map: map,
        icon: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png'
    });

    map.setCenter({ lat: venue.lat, lng: venue.lng });
    map.setZoom(14);
}

// Display nearby venues
function displayNearbyVenues(venues, optimal) {
    const nearbyVenuesList = document.getElementById('nearby-venues-list');
    nearbyVenuesList.innerHTML = '';

    // Sort venues by total travel time
    venues.sort((a, b) => a.totalTravelTime - b.totalTravelTime);

    venues.forEach(venue => {
        const isSelected = venue === optimal;
        const totalMinutes = Math.round(venue.totalTravelTime / 60);
        const avgMinutes = Math.round(totalMinutes / locations.length);

        const venueCard = document.createElement('div');
        venueCard.className = `venue-card${isSelected ? ' selected' : ''}`;

        // Format price level and rating information
        const priceLevel = venue.price_level ? '$'.repeat(venue.price_level) : '';
        const rating = venue.rating ? `★ ${venue.rating.toFixed(1)}` : '';
        const ratingCount = venue.user_ratings_total ? `(${venue.user_ratings_total} reviews)` : '';

        venueCard.innerHTML = `
            <h4>${venue.name}</h4>
            <div class="venue-meta">
                ${priceLevel ? `<span class="venue-price">${priceLevel}</span>` : ''}
                ${rating ? `<span class="venue-rating">${rating} ${ratingCount}</span>` : ''}
            </div>
            <div class="venue-address">${venue.address}</div>
            <div class="venue-travel-time">Average travel time: ${avgMinutes} minutes</div>
        `;

        venueCard.addEventListener('click', () => selectVenue(venue));
        nearbyVenuesList.appendChild(venueCard);
    });
}

// Add function to handle venue selection
function selectVenue(venue) {
    selectedVenue = venue;

    // Update UI to show selected venue
    const venueCards = document.querySelectorAll('.venue-card');
    venueCards.forEach(card => {
        card.classList.remove('selected');
        if (card.querySelector('h4').textContent === venue.name) {
            card.classList.add('selected');
        }
    });

    // Update the main venue display and map
    displayOptimalVenue(venue);
    addOptimalVenueMarker(venue);
}

// Add function to show/hide subtype selector
function updateSubtypeSelector() {
    const venueType = document.getElementById('venue-select').value;
    const subtypeContainer = document.getElementById('subtype-container');

    if (venueSubtypes[venueType]) {
        const { label, options } = venueSubtypes[venueType];
        subtypeContainer.innerHTML = `
            <label for="subtype-select">${label}</label>
            <select id="subtype-select">
                ${options.map(opt => `
                    <option value="${opt.value}">${opt.label}</option>
                `).join('')}
            </select>
        `;
        subtypeContainer.classList.remove('hidden');
    } else {
        subtypeContainer.innerHTML = '';
        subtypeContainer.classList.add('hidden');
    }
} 