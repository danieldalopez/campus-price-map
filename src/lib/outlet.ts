/** One campus outlet, as in the `locations` table (SPEC section 6). */
export type Outlet = {
  id: string;
  name: string;
  area: string | null;
  operator: string | null;
  type: string | null;
  address: string | null;
  hoursWeekday: string | null;
  hoursWeekend: string | null;
  lat: number;
  lng: number;
  /** Save-On-Foods Wesbrook: the grocery baseline, never ranked. */
  isBenchmark: boolean;
};

/** Price tier from serving.outlet_scores; null shows as "?" (no tier yet). */
export type Tier = "$" | "$$" | "$$$";

/** UBC map centre and zoom for Home (SPEC section 7). */
export const UBC_CENTRE: [number, number] = [49.2606, -123.246];
export const HOME_ZOOM = 15;
