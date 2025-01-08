# AllRoads - Optimal Meeting Place Finder

A simple web application that helps groups find the perfect meeting place based on everyone's travel times. Instead of using simple geographic centrality, this app considers actual travel times to find the most convenient location for everyone.

## Features

- Input multiple starting locations with Google Places autocomplete
- Choose from various venue types (restaurants, bars, cafes, parks)
- Uses actual travel times rather than straight-line distances
- Interactive Google Maps integration
- Real-time optimal venue calculation
- Clean, modern UI

## Prerequisites

Before you begin, you'll need:
- A Google Maps API key with the following APIs enabled:
  - Maps JavaScript API
  - Places API
  - Geocoding API
  - Distance Matrix API

## Setup

1. Clone this repository or download the files
2. Replace `YOUR_API_KEY` in the `index.html` file with your actual Google Maps API key
3. Open `index.html` in a web browser

For development, you can use a local server. For example, with Python:
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

Then visit `http://localhost:8000` in your web browser.

## Usage

1. Enter the addresses of all participants using the input field
2. Select the desired venue type (restaurant, bar, cafe, or park)
3. Click "Find Optimal Venue" to calculate the best meeting place
4. The app will display the optimal venue and show all locations on the map

## How it Works

The application:
1. Converts all input addresses to coordinates using Google's Geocoding service
2. Finds nearby venues of the selected type using the Places API
3. Calculates travel times from each starting point to each potential venue using the Distance Matrix API
4. Determines the venue with the lowest total travel time for all participants

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
# allRoads
