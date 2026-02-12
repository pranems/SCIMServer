# SCIMServer v0.8.10 – Runtime Secret Hardening

## Highlights
- Enforces unique `JWT_SECRET` and `OAUTH_CLIENT_SECRET` values at deployment time; dev-only fallbacks log warnings instead of shipping baked credentials.
- Updates `setup.ps1`, `deploy.ps1`, and `deploy-azure.ps1` to prompt for or auto-generate the new secrets and propagate them to Azure Container Apps.
- Adds documentation updates so Docker/Azure users supply the new secrets alongside `SCIM_SHARED_SECRET`.
- Bumps frontend fallback version label and adjusts GitHub workflows to reference the new tag.

## Upgrade Command
```powershell
iex (irm 'https://raw.githubusercontent.com/kayasax/SCIMServer/master/scripts/update-scimserver-direct.ps1'); Update-SCIMServerDirect -Version v0.8.10 -ResourceGroup <rg> -AppName <app> -NoPrompt
```

## Post-Upgrade Checklist
- [ ] GHCR publish workflow succeeds for tag `v0.8.10`
- [ ] Production deployment defines `SCIM_SHARED_SECRET`, `JWT_SECRET`, and `OAUTH_CLIENT_SECRET`
- [ ] Confirm unexpected external SCIM traffic stops after redeploying with rotated secrets
