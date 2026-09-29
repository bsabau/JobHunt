import { after } from "next/server";
import { setApplicationLogo } from "@/lib/db";
import { findCompanyLogo } from "@/lib/logo";

// Looks up the company's logo after the response has been sent, so creating
// or renaming a card never waits on the third-party lookup (up to 3 s). The
// card shows its initial until the next load. `company` is the stored,
// trimmed name; the write is skipped if the card has been renamed since.
export function scheduleLogoLookup(applicationId: number, company: string): void {
  after(async () => {
    try {
      const logoUrl = await findCompanyLogo(company);
      await setApplicationLogo(applicationId, company, logoUrl);
    } catch (error) {
      console.error("Logo lookup failed", error);
    }
  });
}
