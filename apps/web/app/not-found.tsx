import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/Notice";

export const metadata: Metadata = {
  title: "Page not found",
  // Next marks it noindex itself; no canonical for a missing page
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <Notice title="Lost in the clouds.">
      <p>
        This page does not exist. <Link href="/">Go to the home page</Link>
      </p>
    </Notice>
  );
}
