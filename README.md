# Campus Price Map

A mobile web app that shows UBC students where the cheapest coffee, Red Bull, or sandwich is on campus right now, crowdsourced by students and benchmarked against StatCan prices.

Built at HackCamp 2026.

## Stack

- **Lovable** web app with its built-in Supabase database
- **Leaflet + OpenStreetMap** for the campus map
- **Gemini API** to read price tag photos
- **Databricks** for location price scores and the StatCan comparison

## Repo layout

- `data/` seed prices from the campus price walk, item and location lists, StatCan table 18-10-0245-01 (BC)
- `notebooks/` Databricks notebooks for scoring
- `prompts/` Lovable and Gemini prompts

## Team

- Person A, Product & Data
- Person B, Builder
