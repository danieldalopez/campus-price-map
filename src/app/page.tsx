import HomeScreen from "@/components/HomeScreen";
import { loadOutlets } from "@/lib/local-outlets";

/** Home: the map is the app (SPEC section 7). */
export default function Home() {
  // Step 1: read data/outlets.csv straight from the repo (placeholder if it's missing).
  // Step 4 switches this to /api/locations.
  const { outlets, source } = loadOutlets();
  return <HomeScreen outlets={outlets} source={source} />;
}
