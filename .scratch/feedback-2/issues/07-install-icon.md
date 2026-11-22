# 07 Install prompt as a discreet header icon

Status: resolved

From the product owner (2026-11-22, after seeing ticket 06 live): "Can we make it more discreet? Maybe like a phone download symbol instead of taking so much real estate at the top?"

Built:
- The install card is gone from Home. A small icon button sits in the Home header, just left of the bell, same size (48 hit area, 24 icon), colour and stroke: a phone (lucide `Smartphone`) with a small download arrow (`Download`) inside it. Label: "Get Rotaloop on your phone". `src/components/home/InstallIcon.tsx`.
- Same show rules as before, minus dismissing: website only, phone/tablet, in a browser tab (not from the Home Screen). No "Not now"; the 30-day dismiss code and its storage are removed.
- A small accent dot on the icon until it has been tapped once on this device (localStorage `rotaloop.installIconSeen`; if storage fails, no dot).
- Tapping: iPhone/iPad opens the steps sheet; Android with the saved `beforeinstallprompt` runs the browser's prompt; otherwise the menu-steps sheet. `appinstalled` or an accepted prompt hides the icon.
- `installCardVariant` lost its dismiss/now facts; `installSubtitle` was dropped (tests updated).
- `npm run e2e:nav` phone steps: iPhone shows the icon with the dot, tap opens the steps, "Got it" closes, dot gone after reload; Android with a faked prompt calls it and the icon hides; Firefox opens menu steps; desktop shows no icon.
