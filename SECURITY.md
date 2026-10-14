# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability** on this repository
(GitHub private vulnerability reporting). Include what is affected, steps to reproduce and the
impact you expect. You will get an acknowledgement within 7 days; please allow a reasonable delay
for a fix before any public disclosure.

## Scope

In scope: the three built files (`vantage.html`, `vantage-presentation.html`, `vantage-lab.html`)
and how they handle links (URL parameters). Out of scope: the development server (local use only),
and issues in third-party dependencies already tracked upstream.

## What is already in place

- No server, no account, no network: each build is a single offline HTML file. A
  Content-Security-Policy in every built file forbids loading or sending anything over the network.
- URL parameters (stadium, seat, event, reveal, time…) are matched against known values only;
  unknown or hostile values fall back to defaults.
- Strings inserted into the interface are escaped; displayed data comes from the bundled, fictitious
  configuration.
- The public build is checked at build time to contain no Lab or presenter controls.
- The development server listens on localhost only.
- Dependencies are watched by Dependabot and `npm audit` runs in CI.
