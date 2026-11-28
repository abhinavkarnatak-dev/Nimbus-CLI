import type { Metadata } from "next";
import { Notice } from "@/components/Notice";

export const metadata: Metadata = {
  title: "Logged in",
  robots: { index: false },
  alternates: { canonical: null },
};

export default function LoggedIn() {
  return (
    <Notice title="You’re in.">
      <p>Nimbus is logged in. Close this tab and go back to your terminal.</p>
    </Notice>
  );
}
