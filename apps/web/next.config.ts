import type { NextConfig } from "next";

// create-next-app 16 enables Cache Components by default. This project uses the
// classic App Router caching shape that CLAUDE.md specifies (fetch with
// `next: { tags }`, a long route `revalidate`, and `revalidateTag`), so the
// flags are left off. The choice is recorded in the ISR ADR when that PR lands.
const nextConfig: NextConfig = {};

export default nextConfig;
