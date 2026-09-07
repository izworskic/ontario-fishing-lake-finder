# Ontario Fishing Lake Finder — Agent Rules

This repository owns the Ontario Fishing Lake Finder decision engine and UI.

## Product goal
Help an angler decide which Ontario lake fits a specific fishing trip by synthesizing official fish/lake records with access and live trip context.

## Hard rules
- Never describe a fit or trip score as catch probability, fish abundance, or a guarantee of success.
- Never invent missing fish, stocking, access, road, Crown-land, regulation, weather, or fire data.
- Crown-land datasets are planning/mapping context only. Do not convert them into legal camping/access claims.
- FMZ and regulation summaries are planning context. Always route the user to the current Ontario regulations and waterbody-specific exceptions.
- Fire perimeter/location data can lag and is not a substitute for emergency instructions.
- Weather observations are station observations, not guaranteed conditions at the lake.
- Keep source provenance visible in the API and UI.
- Prefer official Ontario / Government of Canada sources for core evidence.

## Architecture
- `api/` owns serverless public endpoints.
- `lib/` owns source clients, normalization, geometry and scoring.
- `public/` owns the standalone product UI.
- `tests/` owns truth/score/source contracts.

The main ChrisIzworski.com repo and National Tools hub should link/route to this product but should not absorb this implementation.
