// Initialize global variables
let map;
let markers = [];
let locations = [];
let optimalVenue = null;
const searchRadius = 5000; // 5km default
let allVenues = [];
let selectedVenue = null;

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
        const request = {
            location: center,
            radius: searchRadius,
            type: type
        };

        service.nearbySearch(request, (results, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                resolve(results.slice(0, 20)); // Limit to 20 venues
            } else {
                reject(status);
            }
        });
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
                name: venue.name,
                address: venue.vicinity,
                lat: venue.geometry.location.lat(),
                lng: venue.geometry.location.lng(),
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

    // Basic venue information
    let html = `
        <p><strong>Name:</strong> ${venue.name}</p>
        <p><strong>Address:</strong> ${venue.address}</p>
        <h3 class="directions-header">Travel times and directions:</h3>
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

// Add function to display nearby venues
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
        venueCard.onclick = () => selectVenue(venue);

        venueCard.innerHTML = `
            <h4>${venue.name}</h4>
            <div class="venue-address">${venue.address}</div>
            <div class="venue-travel-time">Average travel time: ${avgMinutes} minutes</div>
        `;

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