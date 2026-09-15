interface ClearbitCompany {
  domain?: string;
  logo?: string;
}

const LOGO_LOOKUP_TIMEOUT_MS = 3000;

// The third-party logo value is stored and later rendered to every viewer, so
// only hosts we trust to serve images may reach the <img> src.
const ALLOWED_LOGO_HOSTS = new Set(["logo.clearbit.com", "www.google.com"]);

function asAllowedLogoUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && ALLOWED_LOGO_HOSTS.has(parsed.hostname.toLowerCase())
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export async function findCompanyLogo(company: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(company)}`,
      { cache: "no-store", signal: AbortSignal.timeout(LOGO_LOOKUP_TIMEOUT_MS) }
    );

    if (!response.ok) {
      return null;
    }

    const companies = (await response.json()) as ClearbitCompany[];

    if (companies.length === 0) {
      return null;
    }

    const match = companies.find((item) => item.domain || item.logo) ?? companies[0];

    // Google S2 favicon endpoint is much more reliable than third-party logo URLs.
    if (match.domain) {
      return `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(match.domain)}`;
    }

    // Only ever store and render https logo URLs from an allowlisted host.
    return asAllowedLogoUrl(match.logo);
  } catch {
    return null;
  }
}
