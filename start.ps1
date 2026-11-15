Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$env:DSH_HOME = (Resolve-Path 'apps/desktop/.desktop-build/review-orb/home').Path
$env:DSH_DESKTOP_OPEN_DEVTOOLS = '0'
pnpm run start:desktop