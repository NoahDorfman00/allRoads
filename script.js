// Initialize global variables
let map;
let markers = [];
let locations = [];
let optimalVenue = null;
const searchRadius = 5000; // 5km default
let allVenues = [];
let selectedVenue = null;
let displayedVenueCount = 5;

// Firebase Functions base URLs
const FIREBASE_FUNCTIONS = {
    geocodeAddress: 'https://geocodeaddress-clevp6kv7a-uc.a.run.app',
    findNearbyVenues: 'https://findnearbyvenues-clevp6kv7a-uc.a.run.app',
    getPlaceDetails: 'https://getplacedetails-clevp6kv7a-uc.a.run.app',
    calculateTravelTimes: 'https://calculatetraveltimes-clevp6kv7a-uc.a.run.app',
    findOptimalVenue: 'https://findoptimalvenue-clevp6kv7a-uc.a.run.app'
};

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

// Helper function for API calls
async function callFirebaseFunction(endpoint, data) {
    try {
        console.log(`Calling ${endpoint} with data:`, data);
        const response = await fetch(FIREBASE_FUNCTIONS[endpoint], {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        console.log(`Response status:`, response.status);
        const result = await response.json();
        console.log(`Response data:`, result);

        if (result.status === 'success') {
            return result.data;
        }
        throw new Error(result.message || 'API call failed');
    } catch (error) {
        console.error(`Error calling ${endpoint}:`, error);
        console.error('Full error object:', JSON.stringify(error, null, 2));
        throw error;
    }
}

// State management functions
function encodeState() {
    // Only store minimal info
    const state = {
        locations: locations.map(loc => ({
            address: loc.address,
            lat: loc.lat,
            lng: loc.lng
        })),
        venueType: document.getElementById('venue-select').value,
        subtype: document.getElementById('subtype-select')?.value || ''
    };
    const jsonString = JSON.stringify(state);
    let base64 = btoa(unescape(encodeURIComponent(jsonString)));
    base64 = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return base64;
}

function decodeState(encodedState) {
    try {
        // Convert from URL-safe base64 to standard base64
        let base64 = encodedState.replace(/-/g, '+').replace(/_/g, '/');
        // Pad with '=' if needed
        while (base64.length % 4) base64 += '=';
        const jsonString = decodeURIComponent(escape(atob(base64)));
        const state = JSON.parse(jsonString);
        return state;
    } catch (error) {
        console.error('Error decoding state:', error);
        return null;
    }
}

function updateURL() {
    const stateParam = encodeState();
    const newURL = `${window.location.pathname}?state=${stateParam}`;
    window.history.pushState({ path: newURL }, '', newURL);
}

function loadStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    const encodedState = params.get('state');
    if (!encodedState) return false;

    const state = decodeState(encodedState);
    if (!state) return false;

    // Restore minimal state
    locations = state.locations || [];
    selectedVenue = null;
    allVenues = [];

    // Update UI
    document.getElementById('venue-select').value = state.venueType;
    updateSubtypeSelector();
    if (state.subtype) {
        const subtypeSelect = document.getElementById('subtype-select');
        if (subtypeSelect) subtypeSelect.value = state.subtype;
    }

    // Update map and markers
    locations.forEach(location => {
        addMarkerToMap(location);
        addLocationToList(location);
    });
    updateMapBounds();
    updateFindButton();

    // If there are at least 2 locations, re-fetch venues and recalculate everything
    if (locations.length >= 2) {
        findOptimalVenue();
    }

    return true;
}

// Initialize map
window.initMap = async function () {
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 39.9526, lng: -75.1652 }, // Default to Philadelphia
        zoom: 12,
        mapId: '619c1f9bd3f72bc7'
    });

    // Initialize the autocomplete for the input field
    const input = document.getElementById('address-input');
    const autocomplete = new google.maps.places.Autocomplete(input);

    // Add event listener for venue type changes
    document.getElementById('venue-select').addEventListener('change', updateSubtypeSelector);

    // Initial call to set up subtype selector
    updateSubtypeSelector();

    // Try to load state from URL
    loadStateFromURL();
};

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

// Add a new location
async function addLocation() {
    const input = document.getElementById('address-input');
    const address = input.value.trim();

    if (!address) return;

    try {
        const result = await callFirebaseFunction('geocodeAddress', { address });

        const location = {
            id: Date.now().toString(),
            address: result.formatted_address,
            lat: result.geometry.location.lat,
            lng: result.geometry.location.lng
        };

        locations.push(location);
        addLocationToList(location);
        addMarkerToMap(location);
        updateMapBounds();
        updateFindButton();
        updateURL();
        input.value = '';
    } catch (error) {
        console.error('Geocoding error:', error);
        alert('Could not find this address. Please try again.');
    }
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
    const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: location.lat, lng: location.lng }
    });
    markers.push(marker);
}

// Remove a location
function removeLocation(id) {
    const index = locations.findIndex(loc => loc.id === id);
    if (index !== -1) {
        locations.splice(index, 1);
        markers[index].map = null;
        markers.splice(index, 1);
        updateLocationsList();
        updateMapBounds();
        updateFindButton();
        updateURL();
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

// Calculate the center point of all locations
function calculateCenter() {
    if (locations.length === 0) return null;

    const total = locations.reduce(
        (acc, loc) => ({
            lat: acc.lat + loc.lat,
            lng: acc.lng + loc.lng
        }),
        { lat: 0, lng: 0 }
    );

    return {
        lat: total.lat / locations.length,
        lng: total.lng / locations.length
    };
}

// Update the find venue button state
function updateFindButton() {
    const button = document.getElementById('find-venue-btn');
    button.disabled = locations.length < 2;
}

// Find the optimal venue
async function findOptimalVenue() {
    displayedVenueCount = 5; // Reset the count
    const button = document.getElementById('find-venue-btn');
    button.classList.add('loading');
    button.disabled = true;

    try {
        const center = calculateCenter();
        if (!center) return;

        const type = document.getElementById('venue-select').value;
        const subtypeSelect = document.getElementById('subtype-select');
        const subtype = subtypeSelect ? subtypeSelect.value : '';

        // First get nearby venues
        const venues = await callFirebaseFunction('findNearbyVenues', {
            center,
            type,
            subtype,
            radius: searchRadius
        });

        console.log('Nearby venues found:', venues);

        // Then find the optimal venue
        const result = await callFirebaseFunction('findOptimalVenue', {
            locations,
            venues
        });

        console.log('Optimal venue result:', result);
        console.log('Travel times for optimal venue:', result.optimal.travelTimes);

        const { optimal, allVenues: venuesWithTimes } = result;
        selectedVenue = optimal;
        allVenues = venuesWithTimes;

        // Log the selected venue's travel times
        console.log('Selected venue travel times:', selectedVenue.travelTimes);
        console.log('Location IDs:', locations.map(loc => loc.id));

        displayOptimalVenue(optimal);
        displayNearbyVenues(venuesWithTimes, optimal);
        addOptimalVenueMarker(optimal);
        updateURL();
    } catch (error) {
        console.error('Error finding optimal venue:', error);
        alert('An error occurred while finding venues. Please try again.');
    } finally {
        button.classList.remove('loading');
        button.disabled = locations.length < 2;
    }
}

// Display the optimal venue
async function displayOptimalVenue(venue) {
    try {
        const details = await callFirebaseFunction('getPlaceDetails', {
            placeId: venue.place_id
        });

        console.log('Venue details:', details);
        console.log('Venue travel times before display:', venue.travelTimes);
        console.log('Locations with IDs:', locations);

        const venueDetails = document.getElementById('venue-details');
        venueDetails.innerHTML = `
            <div class="venue-header">
                <div class="venue-header-content">
                    <h3>${details.name}</h3>
                    <p class="venue-address">${details.formatted_address}</p>
                    <div class="venue-meta">
                        ${details.rating ? `<span class="venue-rating">${details.rating} ⭐️</span>` : ''}
                        ${details.price_level ? `<span class="venue-price">${'$'.repeat(details.price_level)}</span>` : ''}
                        ${details.opening_hours ? `
                            <span class="venue-status ${details.opening_hours.open_now ? 'open' : 'closed'}">
                                ${details.opening_hours.open_now ? 'Open Now' : 'Closed'}
                            </span>
                        ` : ''}
                    </div>
                </div>
                <button class="share-btn" onclick="shareVenue()">Share</button>
            </div>
            
            ${details.opening_hours ? `
                <button class="expand-btn" onclick="toggleHours(this)">
                    Operating Hours <span class="expand-icon">▼</span>
                </button>
                <div class="venue-hours hidden">
                    <ul>
                        ${details.opening_hours.weekday_text.map(day => `<li>${day}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            
            <div class="venue-links">
                ${details.website ? `
                    <a href="${details.website}" target="_blank" class="website-link">Visit Website</a>
                ` : ''}
                <a href="https://www.google.com/maps/place/?q=place_id:${venue.place_id}" target="_blank" class="maps-link">View on Maps</a>
            </div>

            <div class="directions-header">Travel Times</div>
            <ul class="directions-list">
                ${locations.map((loc, index) => {
            const travelTime = Array.isArray(venue.travelTimes) ? venue.travelTimes[index] : null;
            return `
                    <li>
                        <div class="location-info">
                            <div class="location-address">${loc.address}</div>
                            <div class="travel-time">${travelTime ? Math.round(travelTime / 60) : 'Calculating...'} minutes</div>
                        </div>
                        <a href="https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(loc.address)}&destination=place_id:${venue.place_id}&travelmode=driving" 
                           target="_blank" 
                           class="directions-link">
                            Get Directions
                        </a>
                    </li>
                `}).join('')}
            </ul>
        `;

        document.getElementById('optimal-venue').classList.remove('hidden');
        const map = document.getElementById('map');
        map.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        console.error('Error displaying venue details:', error);
    }
}

// Display nearby venues
function displayNearbyVenues(venues, optimal) {
    const nearbyVenuesList = document.getElementById('nearby-venues-list');
    nearbyVenuesList.innerHTML = '';

    // If we have a previously selected venue different from optimal, swap them in the venues list
    if (selectedVenue && selectedVenue.place_id !== optimal.place_id) {
        const selectedIndex = venues.findIndex(v => v.place_id === selectedVenue.place_id);
        const optimalIndex = venues.findIndex(v => v.place_id === optimal.place_id);
        if (selectedIndex !== -1 && optimalIndex !== -1) {
            [venues[selectedIndex], venues[optimalIndex]] = [venues[optimalIndex], venues[selectedIndex]];
        }
    }

    const filteredVenues = venues
        .filter(venue => venue.place_id !== selectedVenue?.place_id)
        .sort((a, b) => a.maxTravelTime - b.maxTravelTime);

    // Display the current batch of venues
    filteredVenues
        .slice(0, displayedVenueCount)
        .forEach(venue => {
            const venueElement = document.createElement('div');
            venueElement.className = 'venue-card';
            venueElement.onclick = () => selectVenue(venue);
            venueElement.innerHTML = `
                <h4>${venue.name}</h4>
                <div class="venue-meta">
                    ${venue.rating ? `<span class="venue-rating">${venue.rating} ⭐️</span>` : ''}
                    ${venue.price_level ? `<span class="venue-price">${'$'.repeat(venue.price_level)}</span>` : ''}
                </div>
                <p class="venue-address">${venue.vicinity}</p>
                <div class="venue-travel-time">
                    <div>Max travel: ${venue.maxTravelTime ? Math.round(venue.maxTravelTime / 60) : 'Calculating...'} min</div>
                    <div>Avg travel: ${venue.avgTravelTime ? Math.round(venue.avgTravelTime / 60) : 'Calculating...'} min</div>
                </div>
            `;
            nearbyVenuesList.appendChild(venueElement);
        });

    // Add "Load More" button if there are more venues to show
    if (filteredVenues.length > displayedVenueCount) {
        const loadMoreButton = document.createElement('button');
        loadMoreButton.className = 'load-more-btn';
        loadMoreButton.onclick = () => {
            displayedVenueCount += 5;
            displayNearbyVenues(venues, optimal);
        };
        loadMoreButton.innerHTML = 'Load More Options';
        nearbyVenuesList.appendChild(loadMoreButton);
    }
}

// Add a marker for the optimal venue
function addOptimalVenueMarker(venue) {
    // Remove any existing optimal venue marker
    if (optimalVenue) {
        optimalVenue.map = null;
    }

    // Create a new marker
    optimalVenue = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: {
            lat: venue.geometry.location.lat,
            lng: venue.geometry.location.lng
        },
        title: venue.name
    });

    // Update map bounds to include the new marker
    const bounds = new google.maps.LatLngBounds();
    locations.forEach(location => {
        bounds.extend({ lat: location.lat, lng: location.lng });
    });
    bounds.extend({
        lat: venue.geometry.location.lat,
        lng: venue.geometry.location.lng
    });
    map.fitBounds(bounds);
}

// Add share functionality
async function shareVenue() {
    if (!selectedVenue) return;

    const url = window.location.href;
    const shareBtn = document.querySelector('.share-btn');
    const originalText = shareBtn.textContent;

    try {
        if (navigator.share && navigator.canShare?.({ url })) {
            await navigator.share({
                url: url
            });
        } else {
            await navigator.clipboard.writeText(url);
            shareBtn.textContent = 'Copied!';
            setTimeout(() => {
                shareBtn.textContent = originalText;
            }, 2000);
        }
    } catch (error) {
        console.error('Error sharing:', error);
        // Fallback to clipboard copy if sharing fails
        try {
            await navigator.clipboard.writeText(url);
            shareBtn.textContent = 'Copied!';
            setTimeout(() => {
                shareBtn.textContent = originalText;
            }, 2000);
        } catch (clipboardError) {
            console.error('Error copying to clipboard:', clipboardError);
            shareBtn.textContent = 'Share failed';
            setTimeout(() => {
                shareBtn.textContent = originalText;
            }, 2000);
        }
    }
}

// Add function to toggle hours visibility
function toggleHours(button) {
    const hoursDiv = button.nextElementSibling;
    const icon = button.querySelector('.expand-icon');
    if (hoursDiv.classList.contains('hidden')) {
        hoursDiv.classList.remove('hidden');
        icon.textContent = '▲';
    } else {
        hoursDiv.classList.add('hidden');
        icon.textContent = '▼';
    }
}

// Add function to select a different venue
async function selectVenue(venue) {
    displayedVenueCount = 5; // Reset the count
    const previousVenue = selectedVenue;
    selectedVenue = venue;
    await displayOptimalVenue(venue);
    addOptimalVenueMarker(venue);
    displayNearbyVenues(allVenues, venue);
    updateURL();
} 