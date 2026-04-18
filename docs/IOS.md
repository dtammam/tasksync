# iOS Build Guide

## Overview

The TaskSync iOS app is a native wrapper around the existing SvelteKit PWA, built with [Capacitor](https://capacitorjs.com/). It loads the web app inside a WKWebView, which gives the app its own persistent storage sandbox that is not subject to iOS Safari's 7-day storage eviction policy.

The web codebase remains a standalone PWA that works in browsers. The iOS wrapper is additive -- it does not change any web functionality.

## Prerequisites

iOS development requires macOS. You cannot build or run the iOS app on Linux or Windows.

- **macOS** (any recent version that supports the required Xcode version)
- **Xcode 15+** (install from the Mac App Store)
- **Node.js 20+** (install from [nodejs.org](https://nodejs.org/) or via a version manager like `nvm`)
- **CocoaPods** (Capacitor uses it for iOS dependency management)

To install CocoaPods:

```
sudo gem install cocoapods
```

## Step-by-step build instructions

All commands are run from the repository root unless otherwise noted.

1. Install web dependencies:

```
cd web && npm install
```

2. Build the SvelteKit app (produces static output in `web/build/`):

```
cd web && npm run build
```

3. Sync web assets into the Xcode project:

```
cd web && npx cap sync ios
```

This copies the contents of `web/build/` into the iOS Xcode project and installs any native Capacitor plugin dependencies via CocoaPods.

4. Open the project in Xcode:

```
cd web && npx cap open ios
```

5. In Xcode, select a simulator or a connected device from the device toolbar at the top of the window, then press **Cmd+R** to build and run.

You should see the TaskSync app launch in the simulator or on your device.

## Xcode settings

These settings are already configured in the generated Xcode project, but are worth knowing about:

- **Deployment target:** iOS 16.0+. This ensures stable WKWebView features including service worker support and modern Web API coverage. Do not lower this below 16.0.
- **Bundle identifier:** `com.tasksync.app`. This is set in `web/capacitor.config.ts` and synced to Xcode automatically. To change it, edit `capacitor.config.ts` and re-run `npx cap sync ios`.
- **Development team:** Required for device builds. To configure it, open the Xcode project, select the **App** target, go to the **Signing & Capabilities** tab, and select your team from the "Team" dropdown.

## Simulator vs device builds

**Simulator builds** do not require code signing. Select any iOS simulator from the device toolbar in Xcode and press Cmd+R. This is the fastest way to test during development.

**Device builds** require code signing with at minimum a free personal team. Connect your iOS device via USB or Wi-Fi, select it in the device toolbar, configure a development team (see "Code signing notes" below), and press Cmd+R.

## Code signing notes

There are two tiers of Apple code signing relevant to this project:

**Free personal team (no cost):**
- Works for installing directly onto your own device during development
- Certificates expire after 7 days, after which you need to re-build and re-install
- Limited to 3 devices
- No TestFlight access, no App Store distribution
- To set up: open Xcode, go to **Xcode > Settings > Accounts**, add your Apple ID, then select "Personal Team" in the project's Signing & Capabilities tab

**Paid Apple Developer account ($99/year):**
- Required for TestFlight distribution and App Store submission
- Certificates last 1 year
- Unlimited devices via TestFlight
- To set up: enroll at [developer.apple.com](https://developer.apple.com/), then add the account in Xcode Settings > Accounts

For both options, enable **Automatically manage signing** in the Signing & Capabilities tab. Xcode will handle provisioning profiles and certificates for you.

## TestFlight distribution

TestFlight lets you distribute the app to testers without going through the App Store. This requires a paid Apple Developer account.

1. In Xcode, select **Product > Archive** (make sure a real device or "Any iOS Device" is selected, not a simulator)
2. When the archive completes, the Xcode Organizer window opens
3. Click **Distribute App**, then choose **App Store Connect** as the distribution method
4. Follow the prompts to upload the build
5. Log in to [App Store Connect](https://appstoreconnect.apple.com/), go to your app, and navigate to the **TestFlight** tab
6. Once Apple processes the build (usually within a few minutes), add testers by email or via a public link

App Store submission is out of scope for this project. TestFlight and direct device installs are the supported distribution methods.

## Storage persistence

This section explains the core reason the iOS app exists: persistent storage.

**The problem:** iOS Safari enforces Intelligent Tracking Prevention (ITP), which evicts IndexedDB, localStorage, and other client-side storage after 7 days without user interaction on the domain. This eviction policy applies to Safari tabs AND home-screen PWAs. Home-screen PWAs run in an ephemeral WKWebView process managed by Safari, so they are subject to the same ITP rules.

For TaskSync, this means that a user who does not open the PWA for 7 days loses all locally stored tasks, settings, and offline data. While server sync restores task data, the experience is poor -- the app appears empty on launch until sync completes.

**How the native app solves this:** A native iOS app that uses WKWebView gets its own `WKWebsiteDataStore`, which is tied to the app's sandbox rather than to Safari's ITP domain tracking. Storage in a native app's WKWebView persists as long as the app remains installed on the device. There is no 7-day deadline.

Capacitor loads content from `capacitor://localhost`, an internal URL scheme that further isolates storage from Safari's domain tracking. The app's IndexedDB, localStorage, and OPFS data all live in the app's sandbox and are not subject to ITP eviction.

**Caveat:** If the user deletes and reinstalls the app, all local data is lost. This is expected behavior (identical to clearing browser data). Server sync restores task state when the app reconnects.

## Configurable server URL

The app includes a configurable server URL for self-hosted users who run their own TaskSync server:

- **First-launch prompt:** When running inside the native Capacitor shell with no server URL configured, the app shows a one-time prompt asking the user to enter their server URL. The user can enter a URL and save it, or skip to configure it later. This prompt does not appear when running in a browser.
- **Settings panel:** The server URL can be changed at any time from **Settings > Server**. The panel shows the current URL, a text input to change it, and a "Reset to default" option.
- **URL validation:** The app validates that the entered URL uses `http://` or `https://` and is a well-formed URL. Invalid URLs are rejected with inline feedback.

## Troubleshooting

**`npx cap sync` must be re-run after every web build.**
After running `npm run build`, always run `npx cap sync ios` before building in Xcode. Otherwise, the Xcode project will use stale web assets.

**CocoaPods install issues.**
If `npx cap sync ios` fails with CocoaPods errors, try:

```
pod repo update
cd web/ios/App && pod install
```

**Xcode signing errors.**
If Xcode reports signing errors when building for a device, verify that a development team is selected in the **Signing & Capabilities** tab of the App target. See the "Code signing notes" section above.

**"No such module 'Capacitor'" error.**
This means CocoaPods dependencies were not installed. Run:

```
cd web/ios/App && pod install
```

Then clean the Xcode build folder (**Product > Clean Build Folder**, or Shift+Cmd+K) and try again.

**Build succeeds but the app shows a white screen.**
Verify that `web/build/` contains files (run `npm run build`), then re-run `npx cap sync ios` to copy them into the Xcode project.

**Capacitor CLI not found.**
Run `cd web && npm install` to install dev dependencies. The Capacitor CLI (`@capacitor/cli`) is listed as a dev dependency in `web/package.json`.

**App launches but cannot connect to the server.**
If you are running a self-hosted server, make sure you have configured the server URL in Settings > Server (or via the first-launch prompt). The default URL assumes a local development server, which is not reachable from a device unless you are on the same network.
