# Street Rentals

Street Rentals is a web app for finding nearby bike and scooter rentals by city, ZIP code, or current location. It shows rental options on an interactive map with live availability, provider details, and useful station or vehicle information.

## Features

- Search by city or ZIP code
- Use current location on supported browsers
- Interactive map with pan and zoom
- Adjustable search radius
- Nearby rental list with filters
- Detail panel for selected rentals
- Live availability from public shared mobility feeds
- Responsive layout for desktop and mobile

## Built With

- HTML, CSS, and JavaScript
- Node.js
- Netlify Functions
- OpenLayers
- OpenStreetMap/CARTO map tiles
- Public GBFS mobility feeds
- Nominatim geocoding

## Local Development

```bash
npm start
```

Then open:

```text
http://localhost:4173
```

## Netlify Deployment

This project is configured for Netlify with:

- `public/` as the publish directory
- `netlify/functions/` for serverless functions
- `/api/rentals` rewritten to the Netlify Function

Netlify should read `netlify.toml` automatically when deployed from GitHub.

## Notes

Street Rentals uses free public data sources. Availability depends on whether a city or provider publishes open GBFS rental feeds.
