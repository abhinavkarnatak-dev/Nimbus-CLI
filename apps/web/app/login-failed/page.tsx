import type { Metadata } from "next";
import { Suspense } from "react";
import { Notice } from "@/components/Notice";
import { UNKNOWN_FAILURE } from "@/lib/login-reasons";
import { LoginFailed } from "./LoginFailed";

export const metadata: Metadata = {
  title: "Login failed",
  robots: { index: false },
  alternates: { canonical: null },
};

export default function LoginFailedPage() {
  return (
    <>
      {/* The reason is read in the browser; this shows when JavaScript is off */}
      <noscript>
        <Notice title={UNKNOWN_FAILURE.title}>
          <p>Run nimbus login again in your terminal.</p>
        </Notice>
      </noscript>
      <Suspense>
        <LoginFailed />
      </Suspense>
    </>
  );
}
