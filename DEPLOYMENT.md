# Deployment checklist

The Ontario Fishing Lake Finder is intentionally deployed as its own Vercel project. Do not merge the implementation back into `chrisizworski-com` or the National Tools hub.

## Required Vercel import

Import GitHub repository:

`izworskic/ontario-fishing-lake-finder`

Recommended Vercel project name:

`ontario-fishing-lake-finder`

Framework preset: Other / no framework build command required.

Production branch: `main`

No environment variables are currently required.

## Release verification

Before routing public traffic:

1. `GET /api/health` returns HTTP 200 with `ok: true`.
2. `GET /api/lakes?species=Brook%20Trout&thermal=cold&limit=8` returns source-backed lake records.
3. Select one returned Waterbody ID and call `/api/lakes?mode=detail&id=<ID>&species=Brook%20Trout`.
4. Confirm the detail response retains `matchScore` and independently returns `tripScore` / `tripScoreBreakdown`.
5. Confirm selected-lake detail can expose fishing access, Crown/CLUPA context, roads/barriers, active fires, SWOB observations, Ontario 511 events and an Environment Canada City Page forecast window when those sources return data.
6. Confirm missing upstream evidence remains missing instead of being fabricated.
7. Confirm the UI works at phone width and desktop width.

## Canonical public route

Intended canonical URL:

`https://chrisizworski.com/ontario-fishing-lake-finder/`

Once the standalone production deployment is verified, the main-site repo should only add routing/discovery integration. It should not duplicate this application or API.

## Score contract

- **Lake Match**: target species/lake evidence and data fit.
- **Trip Context**: Lake Match combined with current access/road/fire/weather/traffic context.
- **Weather Window**: forecast comfort/exposure from Environment Canada hourly data.

None of these scores is a catch probability, fish-population estimate, safety clearance, legal access determination, route guarantee or drive-time estimate.
