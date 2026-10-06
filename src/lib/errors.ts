/**
 * Domain errors shared between the libraries that raise them and the API layer that maps
 * them to status codes. Kept in their own module so `api.ts` does not have to import the
 * audit runner — and everything it pulls in — just to name an error class.
 */

/** The crawl retrieved no usable page, so there is nothing to score. Maps to 422. */
export class SiteUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteUnreachableError';
  }
}
