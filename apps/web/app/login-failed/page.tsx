import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginFailed } from "./LoginFailed";

export const metadata: Metadata = {
  title: "Login failed",
  robots: { index: false },
};

export default function LoginFailedPage() {
  return (
    <Suspense>
      <LoginFailed />
    </Suspense>
  );
}
