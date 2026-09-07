# Ontario Fishing Lake Finder

Source-backed Ontario fishing lake discovery and decision intelligence for ChrisIzworski.com.

## Product contract

- Rank lakes for a user's fishing/trip criteria using explainable evidence.
- Never represent the fit score as fish abundance, catch probability, or a guarantee of success.
- Missing source data stays missing; do not invent lakes, access, stocking, regulations, or conditions.
- Use Ontario's Waterbody Location Identifier as the primary lake join key where available.
- Keep current regulations and legal/access verification separate from planning intelligence.

## Core source families

- Ontario Aquatic Resource Area
- Ontario Waterbody Location Identifier
- Ontario Fishing Access Point
- Ontario recreational fish stocking data
- Ontario Fishing Regulations Summary / Fish ON-Line

## Architecture

This repository owns the Ontario Fishing Lake Finder implementation. `chrisizworski-com` and the National Tools hub should act as routing/discovery surfaces, not own this decision engine.
