import type { Outlet } from "./outlet";

/**
 * PLACEHOLDER FIXTURE, Step 1 only. This is NOT our price-walk data.
 *
 * Used only while data/outlets.csv is missing or has no rows with coordinates.
 * Five real UBC outlets, coordinates taken from OpenStreetMap (Nominatim) on
 * Nov 7, 2026. IDs are P01 to P05 on purpose so they can never be mistaken for
 * the sheet's L01 to L21. `type` and `operator` are our best guess, unchecked.
 * Hours are left empty rather than invented.
 *
 * Delete this file once data/outlets.csv lands (Step 4 switches Home to
 * /api/locations anyway).
 */
export const PLACEHOLDER_OUTLETS: Outlet[] = [
  {
    id: "P01",
    name: "Blue Chip Cafe",
    area: "AMS Student Nest",
    operator: "ams",
    type: "cafe",
    address: "6133 University Blvd",
    hoursWeekday: null,
    hoursWeekend: null,
    lat: 49.266332,
    lng: -123.249892,
    isBenchmark: false,
  },
  {
    id: "P02",
    name: "JJ Bean",
    area: "University Boulevard",
    operator: "chain",
    type: "cafe",
    address: "6005 University Blvd",
    hoursWeekday: null,
    hoursWeekend: null,
    lat: 49.266356,
    lng: -123.24682,
    isBenchmark: false,
  },
  {
    id: "P03",
    name: "Magma Café",
    area: "Earth Sciences Building",
    operator: "independent",
    type: "cafe",
    address: "2207 Main Mall",
    hoursWeekday: null,
    hoursWeekend: null,
    lat: 49.262707,
    lng: -123.251826,
    isBenchmark: false,
  },
  {
    id: "P04",
    name: "Firehouse Subs",
    area: "Agronomy Road",
    operator: "chain",
    type: "restaurant",
    address: "6190 Agronomy Rd",
    hoursWeekday: null,
    hoursWeekend: null,
    lat: 49.261297,
    lng: -123.246499,
    isBenchmark: false,
  },
  {
    id: "P05",
    name: "The Original Beanery",
    area: "Fairview Crescent",
    operator: "independent",
    type: "cafe",
    address: "Fairview Crescent",
    hoursWeekday: null,
    hoursWeekend: null,
    lat: 49.263645,
    lng: -123.239321,
    isBenchmark: false,
  },
];
