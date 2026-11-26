import Link from "next/link";
import { Notice } from "@/components/Notice";

export default function NotFound() {
  return (
    <Notice title="Lost in the clouds.">
      <p>
        This page does not exist. <Link href="/">Go to the home page</Link>
      </p>
    </Notice>
  );
}
