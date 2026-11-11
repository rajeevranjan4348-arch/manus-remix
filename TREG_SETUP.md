# Treg integration for Manus Remix

This integration uses Treg's documented API at https://treg.to and keeps the team token server-side.

## Netlify environment variables

Set these in **Netlify → Site configuration → Environment variables** for the deploy contexts you use:

- `TREG_TOKEN`: a freshly rotated Treg team token (secret; never commit it)
- `TREG_ORG`: `dd-8` (defaults to this value if omitted)

Redeploy after adding the variables. Do not use a `VITE_*` prefix for the token: Vite exposes those values to browser code.

## API

- `GET /.netlify/functions/treg?q=...` (or `GET /api/treg?q=...`): search Treg's endpoint catalog.
- `POST /.netlify/functions/treg` (or `POST /api/treg`): call a catalog endpoint with JSON:
  ```json
  {
    "endpointId": "provider.endpoint.action",
    "method": "POST",
    "query": {},
    "data": {}
  }
  ```

The browser helper is `src/lib/treg.ts` (`searchTregCatalog`, `callTregEndpoint`). The proxy restricts endpoint IDs and HTTP methods, applies timeouts, and never returns the configured token.

## Security note

A token pasted into chat or any public/client-side location should be treated as exposed. Revoke/rotate it in Treg, then store the replacement only as the Netlify `TREG_TOKEN` environment variable. No token is included in this repository.
