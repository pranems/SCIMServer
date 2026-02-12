# SCIMServer v0.8.9 – Keepalive Pagination Polish

## Highlights
- Activity feed now automatically skips pages that only contain hidden Entra keepalive checks, keeping operators focused on meaningful events.
- Session memory and documentation updated to reference v0.8.9.

## Upgrade Command
```powershell
iex (irm 'https://raw.githubusercontent.com/kayasax/SCIMServer/master/scripts/update-scimserver-direct.ps1'); Update-SCIMServerDirect -Version v0.8.9 -ResourceGroup <rg> -AppName <app> -NoPrompt
```

## Verification Checklist
- [ ] `npm run build` in `web/`
- [ ] `npm run build` in `api/`
- [ ] Activity feed navigation hides keepalive noise without empty pages
- [ ] GHCR publish workflow succeeds for tag `v0.8.9`
