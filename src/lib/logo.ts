interface ClearbitCompany {
  domain?: string;
  logo?: string;
}

export async function findCompanyLogo(company: string): Promise<string | null> {
  try {
    const response = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(company)}`,
      { cache: "no-store" }
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

    if (match.logo) {
      return match.logo;
    }

    return null;
  } catch {
    return null;
  }
}
