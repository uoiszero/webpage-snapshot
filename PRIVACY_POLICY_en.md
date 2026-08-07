# Privacy Policy for Webpage Snapshot

**Last updated:** [Date]

## Overview

Webpage Snapshot is a Chrome extension (Manifest V3) that lets users select any element on a webpage and save it as a PNG image to their local device, using an SVG foreignObject + Canvas rendering pipeline.

This policy explains what information the extension collects, how it uses permissions, and how data is processed.

## Key Statement

**Webpage Snapshot does not collect, store, transmit, or share any personal data.** All processing happens locally in the user's browser.

## Data Collection

We do **not** collect any data, including but not limited to:

- Personal information (name, email, account identifiers, etc.)
- Browsing history or content of visited web pages
- IP addresses or device identifiers
- Usage statistics or behavioral analytics

The extension uses **no** analytics tools, trackers, advertising SDKs, or cookies, and loads **no** remote code.

## Permissions Usage

The extension requests the following permissions, used solely for its core functionality:

1. **downloads** — Saves the generated PNG to the user's local Downloads folder only when the user explicitly clicks "Save". Images are never uploaded to any server.

2. **Host permissions (`<all_urls>`)** — Used for two purposes:
   - Inject the content script so the user can select and capture any element on any webpage they visit.
   - Allow the background service worker to fetch cross-origin image resources and convert them to data URLs, so images render correctly in the captured screenshot.

   This permission exists solely to enable the screenshot feature. The extension does not read, modify, or intercept any page data unrelated to capturing the element the user selected.

## How Data Is Processed

- When the user selects an element, the extension clones that element's DOM subtree and inlines computed styles, entirely **within the user's browser**.
- Image resources are fetched and converted to data URLs **in memory only**, solely for rendering the screenshot.
- The final PNG is generated locally via the SVG foreignObject + Canvas pipeline and saved to the user's local Downloads folder or copied to the clipboard **only when the user explicitly performs the action**.
- Page content, screenshots, and any other data **never leave the user's device**.

## Third-Party Sharing

We do not sell, rent, or share any data with third parties. The extension makes no network requests other than fetching the image resources needed to render the screenshot the user requested.

## Data Retention & Deletion

The extension retains no data. Screenshot files are stored on the user's own device in their Downloads folder and are fully controlled by the user — deleting a file removes it permanently. No user data exists on our servers, because no data is ever transmitted to us.

## Children's Privacy

The extension does not collect personal information from anyone, including children under 13.

## Security

All processing is performed locally on the user's device. No data transmission occurs, so there is no risk of data interception.

## Changes to This Policy

We may update this policy from time to time. Any changes will be reflected on this page.

## Contact

If you have questions about this privacy policy, please contact us at: [uo.is.zero@gmail.com](mailto:uo.is.zero@gmail.com)
