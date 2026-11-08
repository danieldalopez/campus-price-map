// Stand-in for "next/server" in tests (see register.ts). Outside Next.js there is no request to wait for.
export async function connection(): Promise<void> {}
