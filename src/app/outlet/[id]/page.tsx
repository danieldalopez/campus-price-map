import { Suspense } from "react";
import OutletScreen, { OutletSkeleton } from "@/components/OutletScreen";

/**
 * The Outlet page (SPEC section 7). With cacheComponents on, `params` is request-time data, so it is read
 * inside Suspense; the outlet loads in the browser from /api/outlet/[id], which validates the id.
 */
export default function OutletPage({ params }: PageProps<"/outlet/[id]">) {
  return (
    <Suspense fallback={<OutletSkeleton />}>
      {params.then(({ id }) => (
        <OutletScreen outletId={id} />
      ))}
    </Suspense>
  );
}
