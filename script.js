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

// State management functions
function encodeState() {
    const state = {
        locations: locations,
        selectedVenue: selectedVenue,
        allVenues: allVenues,
        venueType: document.getElementById('venue-select').value,
        subtype: document.getElementById('subtype-select')?.value || ''
    };
    // Convert Unicode to URI-safe base64
    const jsonString = JSON.stringify(state);
    const base64 = btoa(unescape(encodeURIComponent(jsonString)));
    return encodeURIComponent(base64);
}

function decodeState(encodedState) {
    try {
        // Convert URI-safe base64 back to Unicode
        const jsonString = decodeURIComponent(escape(atob(decodeURIComponent(encodedState))));
        const state = JSON.parse(jsonString);
        return state;
    } catch (error) {
        console.error('Error decoding state:', error);
        return null;
    }
}

function updateURL() {
    const stateParam = encodeState();
    const newURL = `${window.location.pathname}#state=${stateParam}`;
    window.history.pushState({ path: newURL }, '', newURL);
}

function loadStateFromURL() {
    const hash = window.location.hash;
    if (!hash || !hash.includes('state=')) return false;

    const encodedState = hash.split('state=')[1];
    const state = decodeState(encodedState);
    if (!state) return false;

    // Restore state
    locations = state.locations;
    selectedVenue = state.selectedVenue;
    allVenues = state.allVenues;

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

    // If there's a selected venue, display it
    if (selectedVenue) {
        displayOptimalVenue(selectedVenue);
        displayNearbyVenues(allVenues, selectedVenue);
        addOptimalVenueMarker(selectedVenue);
    }

    return true;
}

// Initialize map (called by Google Maps API when loaded)
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
            updateURL(); // Update URL with new state
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
        updateURL(); // Update URL with new state
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

    const button = document.getElementById('find-venue-btn');
    button.classList.add('loading');
    button.disabled = true;

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
            updateURL(); // Update URL with new state

            // Calculate optimal scroll position
            const mapElement = document.getElementById('map');
            const headerHeight = document.querySelector('.site-header').offsetHeight;
            const inputSection = document.querySelector('.input-section').offsetHeight;
            const mapTop = mapElement.getBoundingClientRect().top + window.pageYOffset;
            const targetScroll = mapTop - 20; // 20px padding

            window.scrollTo({
                top: targetScroll,
                behavior: 'smooth'
            });
        } else {
            alert('No suitable venues found. Try increasing the search radius or changing the venue type.');
        }
    } catch (error) {
        console.error('Error finding optimal venue:', error);
        alert('An error occurred while finding the optimal venue. Please try again.');
    } finally {
        button.classList.remove('loading');
        button.disabled = locations.length < 2;
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
            keyword: subtype
        };

        service.nearbySearch(request, async (results, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                const operationalPlaces = results.filter(place =>
                    place.business_status === 'OPERATIONAL' || !place.business_status
                );

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

// Get place details
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
                    'current_opening_hours',
                    'website',
                    'url',
                    'business_status'
                ]
            },
            (result, status) => {
                if (status === google.maps.places.PlacesServiceStatus.OK) {
                    console.log('Place details result:', result);  // Debug log

                    // Convert current_opening_hours to the format we're using
                    if (result.current_opening_hours) {
                        const isOpenNow = result.current_opening_hours.open_now;
                        console.log('Is open now:', isOpenNow);  // Debug log

                        result.opening_hours = {
                            weekday_text: result.current_opening_hours.weekday_text || [],
                            isOpen: isOpenNow
                        };
                    }
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
                ...venue,
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

// Find the optimal location
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

    const priceLevel = venue.price_level ? '$'.repeat(venue.price_level) : '';
    const rating = venue.rating ? `★ ${venue.rating.toFixed(1)}` : '';
    const ratingCount = venue.user_ratings_total ? `(${venue.user_ratings_total} reviews)` : '';

    let html = `
        <div class="venue-header">
            <div class="venue-header-content">
                <h3>${venue.name}</h3>
                <div class="venue-meta">
                    ${priceLevel ? `<span class="venue-price">${priceLevel}</span>` : ''}
                    ${rating ? `<span class="venue-rating">${rating} ${ratingCount}</span>` : ''}
                    ${venue.opening_hours ? `
                        <span class="venue-status ${venue.opening_hours.isOpen ? 'open' : 'closed'}">
                            ${venue.opening_hours.isOpen ? 'Open Now' : 'Closed'}
                        </span>
                    ` : ''}
                </div>
            </div>
            <button onclick="shareResults()" class="share-btn">
                Share Results
            </button>
        </div>
        <p class="venue-address"><strong>Address:</strong> ${venue.address}</p>
        ${venue.opening_hours ? `
            <button class="expand-btn" onclick="toggleHours(this)">
                Hours <span class="expand-icon">▼</span>
            </button>
            <div class="venue-hours hidden">
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

// Add function to toggle hours visibility
function toggleHours(button) {
    const hoursDiv = button.nextElementSibling;
    const icon = button.querySelector('.expand-icon');
    const isHidden = hoursDiv.classList.contains('hidden');

    hoursDiv.classList.toggle('hidden');
    icon.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
}

// Add optimal venue marker
function addOptimalVenueMarker(venue) {
    if (optimalVenue) {
        optimalVenue.map = null;
    }

    const pin = new google.maps.marker.PinElement({
        background: '#2563eb',
        glyphColor: '#FFFFFF'
    });

    optimalVenue = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: venue.lat, lng: venue.lng },
        content: pin.element
    });

    map.setCenter({ lat: venue.lat, lng: venue.lng });
    map.setZoom(14);
}

// Display nearby venues
function displayNearbyVenues(venues, optimal) {
    const nearbyVenuesList = document.getElementById('nearby-venues-list');
    nearbyVenuesList.innerHTML = '';

    venues.sort((a, b) => a.totalTravelTime - b.totalTravelTime);

    venues.forEach(venue => {
        const isSelected = venue === optimal;
        const totalMinutes = Math.round(venue.totalTravelTime / 60);
        const avgMinutes = Math.round(totalMinutes / locations.length);

        const venueCard = document.createElement('div');
        venueCard.className = `venue-card${isSelected ? ' selected' : ''}`;

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

// Handle venue selection
function selectVenue(venue) {
    selectedVenue = venue;

    const venueCards = document.querySelectorAll('.venue-card');
    venueCards.forEach(card => {
        card.classList.remove('selected');
        if (card.querySelector('h4').textContent === venue.name) {
            card.classList.add('selected');
        }
    });

    displayOptimalVenue(venue);
    addOptimalVenueMarker(venue);
    updateURL(); // Update URL with new state
}

// Share results
async function shareResults() {
    try {
        // Update URL first to ensure it's current
        updateURL();

        // Try to use the Share API if available and not on desktop browsers
        if (navigator.share && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            try {
                await navigator.share({
                    title: 'All Roads - Meeting Place',
                    text: 'Check out this perfect meeting place I found!',
                    url: window.location.href
                });
                return;
            } catch (shareError) {
                console.log('Share API error, falling back to clipboard:', shareError);
                // Continue to clipboard fallback
            }
        }

        // Fallback to clipboard
        await navigator.clipboard.writeText(window.location.href);

        const shareBtn = document.querySelector('.share-btn');
        const originalText = shareBtn.textContent;
        shareBtn.textContent = 'Copied!';

        // Reset button text after 2 seconds
        setTimeout(() => {
            shareBtn.textContent = originalText;
        }, 2000);
    } catch (error) {
        console.error('Error sharing:', error);
        alert('Could not share results. Please try copying the URL manually.');
    }
} 