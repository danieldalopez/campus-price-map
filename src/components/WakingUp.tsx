/** "Waking up prices…" after 3 s of loading (Lakebase wakes from scale to zero). docs/SPEC.md section 11. */
export function WakingUp({ show, className = "" }: { show: boolean; className?: string }) {
  return (
    <p role="status" className={show ? `waking-up ${className}` : "sr-only"}>
      {show ? (
        <>
          <span aria-hidden="true" className="waking-up__dot" />
          Waking up prices…
        </>
      ) : null}
    </p>
  );
}
