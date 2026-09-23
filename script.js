// all roads: find the fairest place for a group to meet.
//
// Addresses come straight from Google Places autocomplete (no server round trip
// to add a person). A single backend call then searches for whatever was typed
// around the middle of the group and ranks results by travel time for everyone.

const API_URL = 'https://api-clevp6kv7a-uc.a.run.app';
const MAPS_API_KEY = 'AIzaSyDmSZmqad5vg0w3rltsNvCeqBbIqhy-wTY';
const MAP_ID = '619c1f9bd3f72bc7';
const DEFAULT_CENTER = { lat: 39.9526, lng: -75.1652 }; // Philadelphia
const DEFAULT_QUERY = 'restaurant';
const MAX_PEOPLE = 10;
const PAGE_SIZE = 5;
const PERSON_COLORS = ['#e8862a', '#d6456b', '#1f6f78', '#7a4fc9', '#2f8f4e', '#c2412d', '#2d6fd1', '#9a6b1f', '#b0389a', '#4b5563'];
const MODE_CODES = { driving: 'd', transit: 't', walking: 'w' };

const state = {
    people: [],        // { id, input, row, loc: { lat, lng, label } | null, autocomplete, marker }
    mode: 'driving',
    venues: [],
    selectedId: null,
    shown: PAGE_SIZE,
    lastSearch: null,  // { query, mode } of the results on screen
    searchPeople: [],  // [{ lat, lng, label }] the results on screen were computed for
    searchSeq: 0,
    pendingSelectId: null
};

const details = new Map(); // placeId -> Promise of place details

let map = null;
let venueMarkers = [];
let nextPersonId = 1;

const $ = (id) => document.getElementById(id);

// ---------- Helpers ----------

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const letterFor = (index) => String.fromCharCode(65 + index);
const colorFor = (index) => PERSON_COLORS[index % PERSON_COLORS.length];

const formatDuration = (seconds) => {
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

const compactNumber = new Intl.NumberFormat('en', { notation: 'compact' });

const isDesktop = () => window.matchMedia('(min-width: 960px)').matches;

async function callApi(body) {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== 'success') {
        const error = new Error(result.message || `Request failed (${response.status})`);
        error.status = response.status;
        throw error;
    }
    return result.data;
}

// An error whose message is safe to show as-is
function userError(message) {
    const error = new Error(message);
    error.userFacing = true;
    return error;
}

function setStatus(message) {
    $('status').textContent = message || '';
}

// ---------- People ----------

function filledPeople() {
    return state.people.filter((p) => p.input.value.trim());
}

function addPerson({ text = '', loc = null, focus = false } = {}) {
    if (state.people.length >= MAX_PEOPLE) return null;

    const person = { id: nextPersonId++, loc: null, autocomplete: null, marker: null };
    const row = document.createElement('li');
    row.className = 'person';
    row.innerHTML = `
        <span class="person-badge" aria-hidden="true"></span>
        <div class="person-input-wrap">
            <input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="next">
            <button type="button" class="remove-btn" aria-label="Remove">×</button>
        </div>
    `;
    person.row = row;
    person.input = row.querySelector('input');
    person.input.value = text;

    person.input.addEventListener('input', () => {
        // Editing the text invalidates a previously picked place
        if (person.loc) setPersonLocation(person, null);
        refreshPeople();
    });
    person.input.addEventListener('keydown', (event) => {
        // Enter picks from the suggestion list; don't submit the form
        if (event.key === 'Enter') event.preventDefault();
    });
    row.querySelector('.remove-btn').addEventListener('click', () => removePerson(person));

    state.people.push(person);
    $('people').appendChild(row);
    if (map) attachAutocomplete(person);
    if (loc) setPersonLocation(person, loc);
    refreshPeople();
    if (focus) person.input.focus();
    return person;
}

function removePerson(person) {
    if (state.people.length <= 2) {
        // Keep at least two rows; just clear this one
        person.input.value = '';
        setPersonLocation(person, null);
        refreshPeople();
        person.input.focus();
        return;
    }
    setPersonLocation(person, null);
    person.row.remove();
    state.people = state.people.filter((p) => p !== person);
    refreshPeople();
}

function setPersonLocation(person, loc) {
    person.loc = loc;
    person.row.classList.toggle('resolved', Boolean(loc));
    if (person.marker) {
        person.marker.map = null;
        person.marker = null;
    }
    if (loc && map) {
        person.marker = createPersonMarker(person);
        if (!state.venues.length) fitMap();
    }
    updateMapVisibility();
    updateAutocompleteBias();
}

function refreshPeople() {
    state.people.forEach((person, index) => {
        const badge = person.row.querySelector('.person-badge');
        badge.textContent = letterFor(index);
        person.row.style.setProperty('--person-color', colorFor(index));
        person.input.placeholder = index === 0 ? 'Your address or place' : 'Friend’s address or place';
        person.input.setAttribute('aria-label', `Person ${letterFor(index)} location`);
        const removable = state.people.length > 2 || person.input.value;
        person.row.querySelector('.remove-btn').hidden = !removable;
        person.row.querySelector('.remove-btn').setAttribute('aria-label', state.people.length > 2 ? `Remove person ${letterFor(index)}` : 'Clear');
        if (person.marker) updatePersonMarker(person, index);
    });
    $('add-person').disabled = state.people.length >= MAX_PEOPLE;
    $('find-btn').disabled = filledPeople().length < 2;
}

function attachAutocomplete(person) {
    if (person.autocomplete || !window.google?.maps?.places) return;
    person.autocomplete = new google.maps.places.Autocomplete(person.input, {
        fields: ['geometry', 'name', 'formatted_address']
    });
    person.autocomplete.addListener('place_changed', () => {
        const place = person.autocomplete.getPlace();
        if (!place?.geometry?.location) return; // Typed text without a pick; geocoded on search
        setPersonLocation(person, {
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            label: place.name || place.formatted_address
        });
        refreshPeople();
        focusNextEmpty(person);
    });
    updateAutocompleteBias();
}

// Suggest places near whoever has already been added
function updateAutocompleteBias() {
    if (!window.google?.maps) return;
    const anchor = state.people.find((p) => p.loc)?.loc;
    if (!anchor) return;
    const bounds = new google.maps.Circle({ center: anchor, radius: 50000 }).getBounds();
    state.people.forEach((p) => p.autocomplete?.setBounds(bounds));
}

function focusNextEmpty(after) {
    const next = state.people.find((p) => p !== after && !p.input.value.trim());
    if (next) next.input.focus();
    else if (!$('query').value.trim()) $('query').focus();
    else after.input.blur();
}

function useMyLocation() {
    if (!navigator.geolocation) {
        setStatus('Location isn’t available in this browser.');
        return;
    }
    const button = $('use-location');
    button.disabled = true;
    setStatus('');
    navigator.geolocation.getCurrentPosition(
        (position) => {
            button.disabled = false;
            const target = state.people.find((p) => !p.input.value.trim()) || addPerson();
            if (!target) return;
            const loc = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                label: 'My location'
            };
            target.input.value = loc.label;
            setPersonLocation(target, loc);
            refreshPeople();
            focusNextEmpty(target);
            labelCurrentLocation(target, loc);
        },
        () => {
            button.disabled = false;
            setStatus('Couldn’t get your location. Check location permissions and try again.');
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
}

// Geocode anything typed but not picked from the suggestions
async function resolvePeople(people) {
    await Promise.all(people.filter((p) => !p.loc).map(async (person) => {
        const text = person.input.value.trim();
        try {
            const result = await callApi({ action: 'geocode', address: text });
            if (person.input.value.trim() !== text) return; // Edited meanwhile
            setPersonLocation(person, { lat: result.lat, lng: result.lng, label: text });
        } catch (error) {
            if (error.status === 404) throw userError(`Couldn’t find “${text}”. Try picking a suggestion from the list.`);
            throw error;
        }
    }));
    if (people.some((p) => !p.loc)) throw userError('Some addresses changed while searching. Please try again.');
}

// Swap "My location" for a real address so shared links make sense to others
async function labelCurrentLocation(person, loc) {
    try {
        const result = await callApi({ action: 'geocode', latlng: `${loc.lat},${loc.lng}` });
        if (person.loc !== loc) return; // Changed meanwhile
        const label = result.address.split(',').slice(0, 2).join(',');
        loc.label = label;
        person.input.value = label;
        if (person.marker) person.marker.title = label;
    } catch (error) {
        console.error('Reverse geocoding failed', error);
    }
}

// ---------- Search ----------

function currentQuery() {
    return $('query').value.trim() || DEFAULT_QUERY;
}

async function runSearch({ scroll = true } = {}) {
    const people = filledPeople();
    if (people.length < 2) {
        setStatus('Add at least two people.');
        return;
    }

    const seq = ++state.searchSeq;
    const query = currentQuery();
    const mode = state.mode;
    const button = $('find-btn');
    setStatus('');
    button.classList.add('loading');
    button.textContent = 'Finding the middle…';
    button.disabled = true;
    $('results').classList.add('busy');
    document.activeElement?.blur?.();

    try {
        await resolvePeople(people);
        const data = await callApi({
            action: 'search',
            query,
            mode,
            locations: people.map((p) => ({ lat: p.loc.lat, lng: p.loc.lng }))
        });
        if (seq !== state.searchSeq) return; // A newer search started

        state.venues = data.venues;
        state.searchPeople = people.map((p) => ({ ...p.loc }));
        state.lastSearch = { query, mode };
        state.shown = PAGE_SIZE;
        // Restore the venue picked in a shared link, otherwise select the fairest
        const wanted = data.venues.findIndex((v) => v.placeId === state.pendingSelectId);
        if (wanted >= PAGE_SIZE) state.shown = wanted + 1;
        state.selectedId = wanted >= 0 ? state.pendingSelectId : data.venues[0]?.placeId || null;
        state.pendingSelectId = null;

        renderResults();
        renderVenueMarkers();
        fitMap();
        writeUrl();
        if (scroll && !isDesktop()) $('map-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        if (seq !== state.searchSeq) return;
        console.error(error);
        setStatus(error.userFacing ? error.message : 'Something went wrong finding places. Please try again.');
    } finally {
        if (seq === state.searchSeq) {
            button.classList.remove('loading');
            button.textContent = 'Find the middle';
            refreshPeople();
            $('results').classList.remove('busy');
        }
    }
}

// ---------- Results ----------

function renderResults() {
    const section = $('results');
    const list = $('venue-list');
    const { query } = state.lastSearch;
    section.hidden = false;
    $('results-title').textContent = state.venues.length ? `Best “${query}” spots` : 'No matches';
    $('share-btn').hidden = !state.venues.length;
    section.querySelector('.results-hint').hidden = !state.venues.length;

    if (!state.venues.length) {
        list.innerHTML = `<li class="empty">No “${escapeHtml(query)}” found between you. Try something broader, like “coffee” or “restaurant”.</li>`;
        $('more-btn').hidden = true;
        return;
    }

    list.innerHTML = state.venues.slice(0, state.shown).map(renderVenue).join('');
    const remaining = state.venues.length - state.shown;
    $('more-btn').hidden = remaining <= 0;
    $('more-btn').textContent = `Show ${Math.min(remaining, PAGE_SIZE)} more`;
}

function renderVenue(venue, index) {
    const selected = venue.placeId === state.selectedId;
    const meta = [];
    if (venue.rating) meta.push(`★ ${venue.rating.toFixed(1)}${venue.ratingCount ? ` (${compactNumber.format(venue.ratingCount)})` : ''}`);
    if (venue.priceLevel) meta.push('$'.repeat(venue.priceLevel));
    if (venue.openNow === true) meta.push('<span class="open">Open now</span>');
    if (venue.openNow === false) meta.push('<span class="closed">Closed now</span>');

    const times = venue.times.map((seconds, i) => `
        <span class="time-chip" style="--person-color:${colorFor(i)}">
            <span class="dot">${letterFor(i)}</span>${formatDuration(seconds)}
        </span>`).join('');

    return `
        <li class="venue${selected ? ' selected' : ''}" data-id="${escapeHtml(venue.placeId)}">
            <button type="button" class="venue-summary" aria-expanded="${selected}">
                <span class="venue-rank">${index + 1}</span>
                <span class="venue-main">
                    <span class="venue-name">${escapeHtml(venue.name)}${index === 0 ? '<span class="best-tag">Fairest</span>' : ''}</span>
                    ${meta.length ? `<span class="venue-meta">${meta.join(' · ')}</span>` : ''}
                    ${selected ? '' : `<span class="times">${times}</span>`}
                </span>
            </button>
            ${selected ? renderVenueBody(venue) : ''}
        </li>`;
}

function renderVenueBody(venue) {
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue.name)}&query_place_id=${encodeURIComponent(venue.placeId)}`;
    const directions = state.searchPeople.map((person, i) => {
        const url = `https://www.google.com/maps/dir/?api=1&origin=${person.lat},${person.lng}` +
            `&destination=${encodeURIComponent(venue.name)}&destination_place_id=${encodeURIComponent(venue.placeId)}` +
            `&travelmode=${state.lastSearch.mode}`;
        return `
            <li style="--person-color:${colorFor(i)}">
                <a href="${url}" target="_blank" rel="noopener">
                    <span class="dot">${letterFor(i)}</span>
                    <span class="dir-text">
                        <span class="dir-time">${formatDuration(venue.times[i])}</span>
                        <span class="dir-label">from ${escapeHtml(person.label)}</span>
                    </span>
                    <span class="dir-link">Directions ↗</span>
                </a>
            </li>`;
    }).join('');

    return `
        <div class="venue-body">
            <p class="venue-address">${escapeHtml(venue.address)}</p>
            <div class="venue-actions">
                <a class="action-btn primary" href="${mapsUrl}" target="_blank" rel="noopener">Open in Maps</a>
                <button type="button" class="action-btn" data-action="details" aria-expanded="false">Hours &amp; info</button>
            </div>
            <div class="venue-extra" hidden></div>
            <ul class="directions">${directions}</ul>
        </div>`;
}

function selectVenue(placeId, { fromMap = false } = {}) {
    const index = state.venues.findIndex((v) => v.placeId === placeId);
    if (index === -1) return;
    state.selectedId = placeId;
    if (index >= state.shown) state.shown = index + 1;
    renderResults();
    renderVenueMarkers();
    writeUrl();

    const venue = state.venues[index];
    if (map && !map.getBounds()?.contains(venue.location)) map.panTo(venue.location);
    if (fromMap) {
        document.querySelector(`.venue[data-id="${CSS.escape(placeId)}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

async function showDetails(item, button) {
    const placeId = item.dataset.id;
    const extra = item.querySelector('.venue-extra');
    button.setAttribute('aria-expanded', String(extra.hidden));
    if (!extra.hidden) {
        extra.hidden = true;
        return;
    }
    extra.hidden = false;
    extra.textContent = 'Loading…';
    button.disabled = true;

    if (!details.has(placeId)) {
        details.set(placeId, callApi({ action: 'details', placeId }).catch((error) => {
            details.delete(placeId);
            throw error;
        }));
    }
    try {
        const info = await details.get(placeId);
        const hours = info.opening_hours?.weekday_text;
        const parts = [];
        if (info.website) {
            const host = new URL(info.website).hostname.replace(/^www\./, '');
            parts.push(`<a class="action-btn" href="${escapeHtml(info.website)}" target="_blank" rel="noopener">${escapeHtml(host)} ↗</a>`);
        }
        if (info.formatted_phone_number) {
            parts.push(`<a class="action-btn" href="tel:${escapeHtml(info.formatted_phone_number.replace(/[^\d+]/g, ''))}">${escapeHtml(info.formatted_phone_number)}</a>`);
        }
        extra.innerHTML = `
            ${parts.length ? `<div class="venue-actions">${parts.join('')}</div>` : ''}
            ${hours ? `<ul>${hours.map((day) => `<li>${escapeHtml(day)}</li>`).join('')}</ul>` : '<p>No hours listed.</p>'}
        `;
    } catch (error) {
        console.error(error);
        extra.textContent = 'Couldn’t load details. Try again.';
    } finally {
        button.disabled = false;
    }
}

async function share() {
    writeUrl();
    const url = window.location.href;
    const button = $('share-btn');
    const flash = (text) => {
        button.textContent = text;
        setTimeout(() => { button.textContent = 'Share'; }, 2000);
    };
    try {
        if (navigator.share) {
            await navigator.share({ url });
            return;
        }
    } catch (error) {
        if (error.name === 'AbortError') return; // User closed the share sheet
    }
    try {
        await navigator.clipboard.writeText(url);
        flash('Link copied!');
    } catch {
        flash('Couldn’t copy');
    }
}

// ---------- Map ----------

function loadGoogleMaps() {
    window.initMap = initMap;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_API_KEY}&libraries=places,marker&callback=initMap&loading=async`;
    script.async = true;
    script.onerror = () => console.error('Failed to load Google Maps');
    document.head.appendChild(script);
}

function initMap() {
    map = new google.maps.Map($('map'), {
        center: state.people.find((p) => p.loc)?.loc || DEFAULT_CENTER,
        zoom: 11,
        mapId: MAP_ID,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        gestureHandling: isDesktop() ? 'greedy' : 'cooperative'
    });

    state.people.forEach((person) => {
        attachAutocomplete(person);
        if (person.loc) person.marker = createPersonMarker(person);
    });
    refreshPeople();
    renderVenueMarkers();
    fitMap();
}

function createPersonMarker(person) {
    const content = document.createElement('div');
    content.className = 'person-marker';
    const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: person.loc.lat, lng: person.loc.lng },
        content,
        zIndex: 1000
    });
    updatePersonMarker({ ...person, marker }, state.people.indexOf(person));
    return marker;
}

function updatePersonMarker(person, index) {
    const content = person.marker.content;
    content.innerHTML = `<span>${letterFor(index)}</span>`;
    content.style.setProperty('--person-color', colorFor(index));
    person.marker.title = person.loc.label;
}

function renderVenueMarkers() {
    if (!map) return;
    venueMarkers.forEach((marker) => { marker.map = null; });
    venueMarkers = state.venues.slice(0, state.shown).map((venue, index) => {
        const selected = venue.placeId === state.selectedId;
        const content = document.createElement('div');
        content.className = `venue-marker${selected ? ' selected' : ''}`;
        content.textContent = index + 1;
        const marker = new google.maps.marker.AdvancedMarkerElement({
            map,
            position: venue.location,
            content,
            title: venue.name,
            zIndex: selected ? 999 : 500 - index
        });
        marker.addListener('click', () => selectVenue(venue.placeId, { fromMap: true }));
        return marker;
    });
}

// On phones, keep the map out of the way until there's something to show
function updateMapVisibility() {
    const hasPoints = state.venues.length > 0 || state.people.some((p) => p.loc);
    $('map-wrap').classList.toggle('empty', !hasPoints);
}

function fitMap() {
    updateMapVisibility();
    if (!map) return;
    const points = state.people.filter((p) => p.loc).map((p) => p.loc)
        .concat(state.venues.slice(0, state.shown).map((v) => v.location));
    if (!points.length) return;
    if (points.length === 1) {
        map.setCenter(points[0]);
        map.setZoom(13);
        return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(point));
    map.fitBounds(bounds, 48);
}

// ---------- Shareable URL ----------

function writeUrl() {
    if (!state.lastSearch) return;
    // Keep commas and spaces readable so shared links stay short
    const encode = (value) => encodeURIComponent(value).replace(/%2C/gi, ',').replace(/%20/g, '+');
    const coord = (n) => String(Number(n.toFixed(5)));
    const params = state.searchPeople.map((p) => `p=${coord(p.lat)},${coord(p.lng)},${encode(p.label)}`);
    params.push(`q=${encode(state.lastSearch.query)}`);
    if (state.lastSearch.mode !== 'driving') params.push(`m=${MODE_CODES[state.lastSearch.mode]}`);
    if (state.selectedId && state.selectedId !== state.venues[0]?.placeId) params.push(`v=${encode(state.selectedId)}`);
    history.replaceState(null, '', `${location.pathname}?${params.join('&')}`);
}

// Returns { people: [{ lat, lng, label }], query, mode, selectedId } or null
function readUrl() {
    const params = new URLSearchParams(location.search);

    // Links shared before the redesign used a base64 JSON "state" param
    if (params.has('state')) {
        try {
            let base64 = params.get('state').replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) base64 += '=';
            const old = JSON.parse(decodeURIComponent(escape(atob(base64))));
            return {
                people: (old.locations || []).map((l) => ({ lat: l.lat, lng: l.lng, label: l.address })),
                query: old.subtype || old.venueType || '',
                mode: 'driving',
                selectedId: null
            };
        } catch (error) {
            console.error('Could not read shared link', error);
            return null;
        }
    }

    const people = params.getAll('p').map((value) => {
        const [lat, lng, ...label] = value.split(',');
        return { lat: Number(lat), lng: Number(lng), label: label.join(',') || 'Location' };
    }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!people.length) return null;

    const mode = Object.keys(MODE_CODES).find((m) => MODE_CODES[m] === params.get('m')) || 'driving';
    return { people, query: params.get('q') || '', mode, selectedId: params.get('v') };
}

// ---------- Setup ----------

function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('#mode button').forEach((button) => {
        button.setAttribute('aria-checked', String(button.dataset.mode === mode));
    });
}

function syncChips() {
    const query = $('query').value.trim().toLowerCase();
    document.querySelectorAll('.chip').forEach((chip) => {
        chip.classList.toggle('active', chip.dataset.query === query);
    });
}

function canSearch() {
    return filledPeople().length >= 2 && !$('find-btn').classList.contains('loading');
}

function init() {
    // Wake the backend now so it's warm by the time everyone's been added
    fetch(API_URL).catch(() => {});
    loadGoogleMaps();

    $('search-form').addEventListener('submit', (event) => {
        event.preventDefault();
        runSearch();
    });
    $('add-person').addEventListener('click', () => addPerson({ focus: true }));
    $('use-location').addEventListener('click', useMyLocation);
    $('query').addEventListener('input', syncChips);

    $('chips').addEventListener('click', (event) => {
        const chip = event.target.closest('.chip');
        if (!chip) return;
        $('query').value = chip.dataset.query;
        syncChips();
        if (canSearch()) runSearch();
    });

    $('mode').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-mode]');
        if (!button || button.dataset.mode === state.mode) return;
        setMode(button.dataset.mode);
        if (state.lastSearch && canSearch()) runSearch({ scroll: false });
    });

    $('venue-list').addEventListener('click', (event) => {
        const item = event.target.closest('.venue');
        if (!item) return;
        const detailsButton = event.target.closest('[data-action="details"]');
        if (detailsButton) {
            showDetails(item, detailsButton);
        } else if (event.target.closest('.venue-summary')) {
            selectVenue(item.dataset.id);
        }
    });

    $('more-btn').addEventListener('click', () => {
        state.shown += PAGE_SIZE;
        renderResults();
        renderVenueMarkers();
        fitMap();
    });
    $('share-btn').addEventListener('click', share);

    const shared = readUrl();
    if (shared) {
        shared.people.slice(0, MAX_PEOPLE).forEach((p) => addPerson({ text: p.label, loc: p }));
        $('query').value = shared.query;
        setMode(shared.mode);
        state.pendingSelectId = shared.selectedId;
    }
    while (state.people.length < 2) addPerson();
    syncChips();

    if (shared && filledPeople().length >= 2) runSearch({ scroll: false });
}

document.addEventListener('DOMContentLoaded', init);
