import HomeScreen from "@/components/HomeScreen";

/**
 * Home: the map is the app (SPEC section 7). The page is a static shell; items and outlets load in the
 * browser from /api/items and /api/locations (rule 4: the browser only talks to our API).
 */
export default function Home() {
  return <HomeScreen />;
}
