# Deployment contract

The Ontario Fishing Lake Finder is deployed only from `izworskic/ontario-fishing-lake-finder` to its own Vercel project. Do not move implementation back into `chrisizworski-com`, the National Tools hub, Replit, or another runtime.

## Production path

GitHub `main` is the release source of truth.

Workflow: `.github/workflows/vercel-production.yml`

Target Vercel team: `izworski-gmailcoms-projects`

Expected project name: `ontario-fishing-lake-finder`

The workflow:

1. checks out `main`;
2. runs the full test suite;
3. deploys to Vercel production using the repository secret `VERCEL_TOKEN`;
4. verifies `/api/health`;
5. verifies a real Brook Trout lake search returns source-backed Ontario records.

No application environment variables are currently required.

## Required repository secret

`VERCEL_TOKEN`

The token must be stored as a GitHub Actions repository secret. Never commit it to a workflow, source file, issue, pull request, log, or deployment configuration.

## Release verification

Before routing public traffic:

1. `GET /api/health` returns HTTP 200 with `ok: true`.
2. `GET /api/lakes?species=Brook%20Trout&thermal=cold&limit=8` returns source-backed lake records.
3. All-lakes discovery reports Ontario Waterbody Location Identifier catalog coverage rather than silently using fisheries records as the master lake inventory.
4. Select one returned Waterbody ID and call `/api/lakes?mode=detail&id=<ID>&species=Brook%20Trout`.
5. Confirm the detail response retains `matchScore` and independently returns `tripScore` / `tripScoreBreakdown` when fisheries evidence exists.
6. Confirm selected-lake detail can expose fishing access, Crown/CLUPA context, roads/barriers, active fires, SWOB observations, Ontario 511 events and an Environment Canada City Page forecast window when those sources return data.
7. Confirm missing upstream evidence remains missing instead of being fabricated.
8. Confirm the UI works at phone width and desktop width.

## Canonical public route

Intended canonical URL:

`https://chrisizworski.com/ontario-fishing-lake-finder/`

The main-site repo should only provide routing/discovery integration after the standalone Vercel production deployment is verified. It must not duplicate the application or API.

## Score contract

- **Lake Match**: target species/lake evidence and data fit.
- **Trip Context**: Lake Match combined with current access/road/fire/weather/traffic context.
- **Weather Window**: forecast comfort/exposure from Environment Canada hourly data.

None of these scores is a catch probability, fish-population estimate, safety clearance, legal access determination, route guarantee or drive-time estimate.
