"use client";

import { useSearchParams } from "next/navigation";
import { CommandLine } from "@/components/CommandLine";
import { Notice } from "@/components/Notice";
import { failureFor } from "@/lib/login-reasons";
import { CONTACT_URL } from "@/lib/site";

export function LoginFailed() {
  const failure = failureFor(useSearchParams().get("reason"));
  return (
    <Notice title={failure.title}>
      <p>
        {failure.body}
        {!failure.command && (
          <>
            {" "}
            <a href={CONTACT_URL}>Open an issue on GitHub</a>
          </>
        )}
      </p>
      {failure.command && <CommandLine command={failure.command} />}
    </Notice>
  );
}
