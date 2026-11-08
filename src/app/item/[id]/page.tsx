import { Suspense } from "react";
import ResultsScreen, { ResultsSkeleton } from "@/components/ResultsScreen";

/**
 * Results for one item (SPEC section 7). With cacheComponents on, `params` is request-time data, so it is
 * read inside Suspense; prices load in the browser from /api/prices, which validates the id.
 */
export default function ItemPage({ params }: PageProps<"/item/[id]">) {
  return (
    <Suspense fallback={<ResultsSkeleton />}>
      {params.then(({ id }) => (
        <ResultsScreen itemId={id} />
      ))}
    </Suspense>
  );
}
